// TAKATAK Phone (the AI phone, its own Clover App Market app) — per-minute metering.
//
// Price (owner's decision, 2026-10-17): 14-day free trial, then CAD $50/month, PLUS a Clover metered charge of CAD $0.25
// per MINUTE OF CALL handled by the AI — every minute the AI is on the line, whether or not an order is placed. The
// monthly price and the trial are set in the Clover dashboard; this file only sends the minutes.
//
// Billable minutes of a call (aiHandledSeconds + billableMinutes):
//   - The AI's time starts when the AI answers (its greeting; `aiStartedAt` on the call). A call that never reached the
//     AI (line off, AI paused, no key: straight to a person) has 0 AI seconds.
//   - It ends when the AI hands the call to a person (the moment the <Dial> to the kitchen starts, `aiEndedAt`), when
//     the AI says goodbye, or when the caller hangs up — whichever comes first. The ringing of the person (hold) and the
//     talk with the person after the transfer are never counted.
//   - The end of the call is Twilio's own duration (CallDuration of the final status callback) when Twilio gave one.
//   - minutes = ceil(AI seconds / 60); under 1 s = 0 (nothing sent). 61 s = 2 minutes.
//   - Test calls (console simulator, FOODHUB_PHONE_TEST_CALLERS) are never billed.
//
// When minutes are sent (recordCallMinutes):
//   - Only with FOODHUB_PHONE_METERED_ENABLED=true. Off (the default): nothing is ever sent to Clover and Clover is
//     not even asked; the call is kept as a dry-run "preview" so Settings → Clover app shows what WOULD be billed.
//   - Only to a merchant that is entitled and ACTIVE: never in the free trial, never one of ours (PHONE_OWN_MERCHANTS),
//     never an exempt merchant (FOODHUB_BILLING_EXEMPT_MERCHANTS), never LAPSED / suspended / inactive / uninstalled.
//     When Clover cannot be reached and its last good answer was ACTIVE (not trial), the minutes wait ("pending") and go
//     on the next ACTIVE answer; any other answer drops them (not billed).
//   - Exactly once per call: the call SID is claimed with one atomic insert (repo.claimKv) before anything else, and
//     every send attempt claims its own key too (two servers never send the same attempt).
//   - Saved BEFORE the charge goes out ("sending"). A lost answer (timeout, Clover 5xx, a network error after the
//     connection was made, a database error after Clover answered) = "uncertain": logged for the owner, NEVER sent again.
//   - Retried (3 attempts in all) only after a definite failure before Clover processed anything: no token, the
//     connection never opened (DNS, refused), or a Clover 4xx answer (Clover refused it: nothing was charged).
//     settlePhoneMinutes() sends what is pending (expansion tick, every 10 minutes).
// Clover's metered call: POST /v3/apps/{appId}/merchants/{mId}/metereds/{CLOVER_PHONE_METERED_MINUTE_ID}?count={minutes}.
// Clover is never called from tests (fetch is mocked).
import { logActivity } from '../activity';
import { stripSlash } from '../config';
import { getRepo } from '../repo';
import { cloverApp, cloverPhoneAppEnabled, phoneOwnMerchants } from './clover-apps';
import { phoneMonth, previousMonth, voiceAiEntitled, type EntitlementReason } from './clover-entitlement';
import { cloverFetch } from './clover-http';
import { cloverAppToken, readCloverBillingState, readCloverConnection } from './clover-oauth';

/** TAKATAK Phone list prices (CAD), shown in the console; Clover's dashboard holds the real ones. */
export const PHONE_PRICE = { monthlyCad: 50, perMinuteCad: 0.25, trialDays: 14 } as const;

export const PHONE_MINUTES = 'phone_minutes';
const CLAIM = (sid: string) => `clover_phone_minutes_claim:${sid}`;
const SEND_CLAIM = (sid: string, attempt: number) => `clover_phone_minutes_send:${sid}:${attempt}`;
export const MAX_MINUTE_ATTEMPTS = 3;
const SETTLE_BATCH = 25;
/** An attempt claimed but never marked "sending" for this long was interrupted before its POST. */
const STUCK_CLAIM_MS = 10 * 60_000;

/** FOODHUB_PHONE_METERED_ENABLED=true turns sending on. Anything else: dry run (nothing sent, Clover not asked). */
export function phoneMeteringEnabled(): boolean {
  return String(process.env.FOODHUB_PHONE_METERED_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** Clover ID of the per-minute metered charge (CLOVER_PHONE_METERED_MINUTE_ID). */
export function meteredMinuteId(): string {
  return String(process.env.CLOVER_PHONE_METERED_MINUTE_ID ?? '').trim();
}

const idList = (raw: string | undefined) => String(raw ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/** Never billed: FOODHUB_BILLING_EXEMPT_MERCHANTS and our own restaurants (PHONE_OWN_MERCHANTS). */
export function billingExemptMerchants(): Set<string> {
  return new Set([...idList(process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS), ...phoneOwnMerchants()]);
}

/** ceil(seconds / 60); under 1 s (or not a number) = 0. */
export function billableMinutes(aiSeconds: number): number {
  if (!Number.isFinite(aiSeconds) || aiSeconds < 1) return 0;
  return Math.ceil(aiSeconds / 60);
}

const t = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(v) ? v : null;
};

export interface AiTimes {
  startedAt: string;
  /** The AI answered (greeting sent). Absent = the AI never took the call. */
  aiStartedAt?: string;
  /** The AI handed the call to a person / said goodbye. Absent = the AI was on until the end. */
  aiEndedAt?: string;
  endedAt?: string;
  /** Twilio's CallDuration when it gave one (seconds from the answer). */
  durationSec?: number;
}

/** Seconds the AI agent handled on this call (never the hold or the person's part). 0 when the AI never answered. */
export function aiHandledSeconds(c: AiTimes): number {
  const start = t(c.aiStartedAt);
  if (start === null) return 0;
  const callStart = t(c.startedAt) ?? start;
  const twilioEnd = typeof c.durationSec === 'number' && Number.isFinite(c.durationSec) && c.durationSec >= 0 ? callStart + c.durationSec * 1000 : null;
  const callEnd = twilioEnd ?? t(c.endedAt);
  const aiEnd = t(c.aiEndedAt);
  const ends = [callEnd, aiEnd].filter((x): x is number => x !== null);
  if (!ends.length) return 0;
  return Math.max(0, (Math.min(...ends) - start) / 1000);
}

export type MinuteState =
  /** Metering off: kept to show what would be billed. */
  | 'preview'
  /** Under 1 s of AI time. */
  | 'zero'
  | 'not_billable'
  /** No CLOVER_PHONE_METERED_MINUTE_ID: not sent. */
  | 'no_metered_id'
  /** Waiting: Clover unreachable (last answer ACTIVE), or a definite failure before sending (retried). */
  | 'pending'
  /** Charge in flight (saved before the POST). Left like this = the answer was lost: never re-sent. */
  | 'sending'
  | 'reported'
  /** Clover may have charged it (timeout, 5xx): shown to the owner, never re-sent. */
  | 'uncertain'
  /** Refused / not sendable 3 times: given up (not billed). */
  | 'failed';

export interface PhoneMinuteRecord {
  callSid: string;
  merchantId: string;
  /** Billing month (Montréal time) of the call's end. */
  month: string;
  aiSeconds: number;
  minutes: number;
  state: MinuteState;
  reason?: string;
  /** Preview only: these minutes would be billed if metering were on (saved subscription ACTIVE, not trial, not exempt). */
  wouldBill?: boolean;
  /** Definite failures so far (each attempt is sent at most once). */
  attempts: number;
  lastError?: string;
  /** End of the call. */
  at: string;
  updatedAt: string;
}

export type MinuteOutcome = MinuteState | 'duplicate' | 'bad_input' | 'test_call';

export interface MinuteResult {
  outcome: MinuteOutcome;
  minutes: number;
  reason?: string;
}

async function saveRecord(r: PhoneMinuteRecord): Promise<PhoneMinuteRecord> {
  const next = { ...r, updatedAt: new Date().toISOString() };
  await getRepo().putDocs<PhoneMinuteRecord>(PHONE_MINUTES, [{ id: next.callSid, key: next.merchantId, at: next.at, data: next }]);
  return next;
}

export async function getMinuteRecord(callSid: string): Promise<PhoneMinuteRecord | null> {
  return (await getRepo().getDoc<PhoneMinuteRecord>(PHONE_MINUTES, callSid).catch(() => null))?.data ?? null;
}

/** Would this merchant be billed, from what is already saved (no Clover request)? For the dry-run preview. */
async function savedWouldBill(mid: string): Promise<boolean> {
  if (!cloverPhoneAppEnabled() || billingExemptMerchants().has(mid)) return false;
  const c = await readCloverConnection(mid, 'phone').catch(() => null);
  if (!c || c.status === 'pending') return false;
  const b = (await readCloverBillingState(mid, 'phone').catch(() => null))?.billing;
  return String(b?.status ?? '').toUpperCase() === 'ACTIVE' && !b?.inTrial;
}

function apiBase() { return stripSlash(process.env.CLOVER_BASE_URL || 'https://api.clover.com'); }

/** Network errors that prove the request never left (nothing reached Clover): safe to try again. */
const PRE_SEND_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL', 'UND_ERR_CONNECT_TIMEOUT']);

function errCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return String(err?.cause?.code ?? err?.code ?? '');
}

type SendOutcome = { kind: 'ok' } | { kind: 'refused'; status: number; detail: string } | { kind: 'uncertain'; detail: string };

/** One metered POST. 429 is retried inside cloverFetch (Clover did not process it). */
async function postMinutes(mid: string, token: string, meteredId: string, minutes: number): Promise<SendOutcome> {
  const appId = cloverApp('phone').appId || '';
  const url = `${apiBase()}/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(mid)}/metereds/${encodeURIComponent(meteredId)}?count=${minutes}`;
  try {
    const res = await cloverFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) return { kind: 'ok' };
    if (res.status >= 500) return { kind: 'uncertain', detail: `HTTP ${res.status}` };
    return { kind: 'refused', status: res.status, detail: `HTTP ${res.status}` };
  } catch (e) {
    const code = errCode(e);
    if (PRE_SEND_CODES.has(code)) return { kind: 'refused', status: 0, detail: `network ${code}` };
    const name = (e as { name?: string } | null)?.name;
    return { kind: 'uncertain', detail: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : `network ${code || name || 'error'}` };
  }
}

/** A definite failure: try again later (pending) or give up after MAX_MINUTE_ATTEMPTS. */
function failed(r: PhoneMinuteRecord, detail: string): PhoneMinuteRecord {
  const attempts = r.attempts + 1;
  return { ...r, attempts, lastError: detail, state: attempts >= MAX_MINUTE_ATTEMPTS ? 'failed' : 'pending' };
}

/**
 * Send one record's minutes (it is ACTIVE; metering on; the ID set). The attempt is claimed across servers, the record
 * saved as "sending" BEFORE the POST, then saved with what Clover said.
 */
async function sendRecord(r: PhoneMinuteRecord, meteredId: string, now: number): Promise<PhoneMinuteRecord> {
  if (!(await getRepo().claimKv(SEND_CLAIM(r.callSid, r.attempts), { at: new Date(now).toISOString() }))) {
    // Another server already made this attempt: its result is (or will be) on the record.
    const cur = (await getMinuteRecord(r.callSid)) ?? r;
    // Still "pending" on the same attempt long after it was claimed: that attempt stopped before "sending" was saved,
    // so before any POST (the record is always saved as "sending" first). Count it as a definite failure.
    if (cur.state === 'pending' && cur.attempts === r.attempts && now - (t(cur.updatedAt) ?? now) > STUCK_CLAIM_MS) return saveRecord(failed(cur, 'attempt interrupted before sending'));
    return cur;
  }
  const token = await cloverAppToken('phone', r.merchantId, Math.floor(now / 1000)).catch(() => null);
  if (!token) return saveRecord(failed(r, 'no Clover token for the phone app'));
  const sending = await saveRecord({ ...r, state: 'sending' }); // saved before the charge goes out
  const out = await postMinutes(r.merchantId, token, meteredId, r.minutes);
  if (out.kind === 'ok') return saveRecord({ ...sending, state: 'reported', lastError: undefined });
  if (out.kind === 'uncertain') {
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_minutes_uncertain', status: 'failed',
      summary: `TAKATAK Phone: ${r.minutes} minute(s) of call ${r.callSid} for merchant ${r.merchantId} may or may not have been billed by Clover (${out.detail}). Not sent again: check the merchant's Clover usage.` }).catch(() => undefined);
    return saveRecord({ ...sending, state: 'uncertain', lastError: out.detail });
  }
  const next = failed(sending, out.detail);
  await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_minutes_failed', status: 'failed',
    summary: `TAKATAK Phone: Clover did not take ${r.minutes} minute(s) of call ${r.callSid} for merchant ${r.merchantId} (${out.detail}, try ${next.attempts} of ${MAX_MINUTE_ATTEMPTS}); ${next.state === 'failed' ? 'not billed.' : 'tried again later.'}` }).catch(() => undefined);
  return saveRecord(next);
}

const DEFERRABLE: EntitlementReason[] = ['clover_unreachable_grace'];

/** What to do with a record now: send it, keep it pending, or close it as not billable. Metering is on. */
async function decideAndSend(r: PhoneMinuteRecord, now: number): Promise<PhoneMinuteRecord> {
  if (!cloverPhoneAppEnabled()) return saveRecord({ ...r, state: 'not_billable', reason: 'gate_off' });
  if (billingExemptMerchants().has(r.merchantId)) return saveRecord({ ...r, state: 'not_billable', reason: 'exempt' });
  const meteredId = meteredMinuteId();
  if (!meteredId) return saveRecord({ ...r, state: 'no_metered_id' });
  const ent = await voiceAiEntitled(r.merchantId, 'call', { now });
  if (ent.billable) return sendRecord(r, meteredId, now);
  // Clover not answering: minutes of a merchant last seen ACTIVE (not in trial) wait for the next real answer.
  if (DEFERRABLE.includes(ent.reason) && String(ent.status ?? '').toUpperCase() === 'ACTIVE' && !ent.inTrial) {
    return r.state === 'pending' && r.reason === ent.reason ? r : saveRecord({ ...r, state: 'pending', reason: ent.reason });
  }
  return saveRecord({ ...r, state: 'not_billable', reason: ent.reason });
}

export interface CallMinutesInput {
  callSid: string;
  merchantId: string;
  aiSeconds: number;
  /** End of the call (ISO); default now. */
  endedAt?: string;
  /** Console simulator or a test caller: never billed. */
  test?: boolean;
}

/** One ended call: count its AI minutes and, when billable, send them to Clover — exactly once per call SID. */
export async function recordCallMinutes(input: CallMinutesInput, opts: { now?: number } = {}): Promise<MinuteResult> {
  const now = opts.now ?? Date.now();
  const sid = String(input.callSid ?? '').trim();
  const mid = String(input.merchantId ?? '').trim();
  const minutes = billableMinutes(input.aiSeconds);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid) || !/^[A-Z0-9]{8,20}$/i.test(mid)) return { outcome: 'bad_input', minutes: 0 };
  if (input.test) return { outcome: 'test_call', minutes };
  const at = t(input.endedAt) !== null ? new Date(t(input.endedAt)!).toISOString() : new Date(now).toISOString();
  // Exactly once per call, across servers: the first claim wins; a repeated status callback stops here.
  if (!(await getRepo().claimKv(CLAIM(sid), { merchantId: mid, at }))) return { outcome: 'duplicate', minutes };
  let r: PhoneMinuteRecord = {
    callSid: sid, merchantId: mid, month: phoneMonth(t(at) ?? now), aiSeconds: Math.round(Number(input.aiSeconds) || 0), minutes,
    state: 'pending', attempts: 0, at, updatedAt: at,
  };
  if (minutes === 0) r = await saveRecord({ ...r, state: 'zero' });
  else if (!phoneMeteringEnabled()) r = await saveRecord({ ...r, state: 'preview', wouldBill: await savedWouldBill(mid) });
  else {
    r = await saveRecord(r); // on file before Clover is asked anything
    r = await decideAndSend(r, now);
  }
  return { outcome: r.state, minutes, ...(r.reason ? { reason: r.reason } : {}) };
}

/** Send what is pending (this month and last). Off = nothing. For the expansion tick; never throws. */
export async function settlePhoneMinutes(opts: { now?: number; merchantId?: string } = {}): Promise<{ reported: number; pending: number; uncertain: number; failed: number; dropped: number }> {
  const out = { reported: 0, pending: 0, uncertain: 0, failed: 0, dropped: 0 };
  if (!phoneMeteringEnabled()) return out;
  const now = opts.now ?? Date.now();
  const month = phoneMonth(now);
  const months = new Set([month, previousMonth(month)]);
  try {
    const docs = await getRepo().listDocs<PhoneMinuteRecord>(PHONE_MINUTES, { since: new Date(now - 70 * 86400_000).toISOString(), ...(opts.merchantId ? { keys: [opts.merchantId] } : {}), limit: 20_000 });
    const pending = docs.map((d) => d.data).filter((r) => r.state === 'pending' && months.has(r.month)).slice(0, SETTLE_BATCH);
    for (const r of pending) {
      const after = await decideAndSend(r, now);
      if (after.state === 'reported') out.reported++;
      else if (after.state === 'pending') out.pending++;
      else if (after.state === 'uncertain' || after.state === 'sending') out.uncertain++;
      else if (after.state === 'failed') out.failed++;
      else out.dropped++;
    }
  } catch (e) {
    console.error('[foodhub] phone minutes settle failed', e instanceof Error ? e.message : e);
  }
  return out;
}

export interface MinutesSummary {
  month: string;
  calls: number;
  /** Every AI minute of the month (billed or not). */
  aiMinutes: number;
  /** Dry run: minutes that WOULD be billed (metering off, merchant ACTIVE). */
  wouldBillMinutes: number;
  reportedMinutes: number;
  pendingMinutes: number;
  /** Sent, answer lost: never re-sent (check in Clover). */
  uncertainMinutes: number;
  uncertainCalls: number;
  failedMinutes: number;
  notBilledMinutes: number;
  /** wouldBill (off) or reported + pending (on) × CAD 0.25. */
  estimateCad: number;
}

/** This month's minutes, per merchant (Settings → Clover app, phone section). Reads only what is saved. */
export async function phoneMinutesSummary(now = Date.now()): Promise<{ enabled: boolean; meteredIdSet: boolean; price: typeof PHONE_PRICE; month: string; total: MinutesSummary; byMerchant: Record<string, MinutesSummary> }> {
  const month = phoneMonth(now);
  const empty = (): MinutesSummary => ({ month, calls: 0, aiMinutes: 0, wouldBillMinutes: 0, reportedMinutes: 0, pendingMinutes: 0, uncertainMinutes: 0, uncertainCalls: 0, failedMinutes: 0, notBilledMinutes: 0, estimateCad: 0 });
  const total = empty();
  const byMerchant: Record<string, MinutesSummary> = {};
  const docs = await getRepo().listDocs<PhoneMinuteRecord>(PHONE_MINUTES, { since: new Date(now - 40 * 86400_000).toISOString(), limit: 20_000 }).catch(() => []);
  for (const { data: r } of docs) {
    if (r.month !== month) continue;
    for (const s of [total, (byMerchant[r.merchantId] ??= empty())]) {
      s.calls++;
      s.aiMinutes += r.minutes;
      if (r.state === 'preview' && r.wouldBill) s.wouldBillMinutes += r.minutes;
      else if (r.state === 'reported') s.reportedMinutes += r.minutes;
      else if (r.state === 'pending') s.pendingMinutes += r.minutes;
      else if (r.state === 'uncertain' || r.state === 'sending') { s.uncertainMinutes += r.minutes; s.uncertainCalls++; }
      else if (r.state === 'failed') s.failedMinutes += r.minutes;
      else s.notBilledMinutes += r.minutes;
    }
  }
  for (const s of [total, ...Object.values(byMerchant)]) {
    s.estimateCad = Math.round((s.wouldBillMinutes + s.reportedMinutes + s.pendingMinutes) * PHONE_PRICE.perMinuteCad * 100) / 100;
  }
  return { enabled: phoneMeteringEnabled(), meteredIdSet: Boolean(meteredMinuteId()), price: PHONE_PRICE, month, total, byMerchant };
}
