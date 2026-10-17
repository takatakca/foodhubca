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
//   - Exactly once per call: the call SID is claimed with one atomic insert (repo.claimKv) before anything else.
//   - Every change out of "pending" is claimed too, so a server working from an out-of-date copy never writes over
//     another's result: each attempt has ONE owner (claimKv on call + attempt), whether it sends the minutes or closes
//     the record (not billable, no metered ID); a record that only keeps waiting is never written. The POST itself has
//     its own claim, shared with the clean-up of an interrupted attempt: an attempt is either sent or given up, never both.
//   - Saved BEFORE the charge goes out ("sending"). A lost answer (timeout, Clover 5xx, a network error after the
//     connection was made, a database error after Clover answered, a server stopped mid-charge) = "uncertain": logged
//     for the owner (once per call), NEVER sent again. settlePhoneMinutes() turns a "sending" left behind into
//     "uncertain" and logs it.
//   - Retried (3 attempts in all) only after a definite failure before Clover processed anything: no token, the
//     connection never opened (DNS, refused), or a Clover 4xx answer (Clover refused it: nothing was charged).
//     settlePhoneMinutes() sends what is pending (expansion tick, every 10 minutes), oldest first, at most 25 sends per
//     run; minutes waiting for Clover cost nothing in that budget, so one unreachable merchant never holds up the others.
// Clover's metered call: POST /v3/apps/{appId}/merchants/{mId}/metereds/{CLOVER_PHONE_METERED_MINUTE_ID}?count={minutes}.
// Clover is never called from tests (fetch is mocked).
import { logActivity } from '../activity';
import { stripSlash } from '../config';
import { getRepo } from '../repo';
import { billingExemptMerchants, cloverApp, cloverPhoneAppEnabled } from './clover-apps';
import { phoneMonth, previousMonth, voiceAiEntitled, type Entitlement, type EntitlementReason } from './clover-entitlement';
import { cloverFetch } from './clover-http';
import { cloverAppToken, readCloverBillingState, readCloverConnection } from './clover-oauth';

/** TAKATAK Phone list prices (CAD), shown in the console; Clover's dashboard holds the real ones. */
export const PHONE_PRICE = { monthlyCad: 50, perMinuteCad: 0.25, trialDays: 14 } as const;

export const PHONE_MINUTES = 'phone_minutes';
const CLAIM = (sid: string) => `clover_phone_minutes_claim:${sid}`;
/** The owner of one attempt (it sends the minutes, or closes the record). */
const SEND_CLAIM = (sid: string, attempt: number) => `clover_phone_minutes_send:${sid}:${attempt}`;
/** The POST of one attempt (the sender, or the clean-up of an interrupted attempt: one of the two, never both). */
const POST_CLAIM = (sid: string, attempt: number) => `clover_phone_minutes_post:${sid}:${attempt}`;
/** The owner is told once per call that a charge is uncertain. */
const UNCERTAIN_LOG = (sid: string) => `clover_phone_minutes_uncertain_log:${sid}`;
export const MAX_MINUTE_ATTEMPTS = 3;
/** Sends per settle run (records that keep waiting do not count). */
const SETTLE_BATCH = 25;
/** An attempt claimed this long ago and still "pending" (or a "sending" this old) was interrupted. */
const STUCK_CLAIM_MS = 10 * 60_000;

/** FOODHUB_PHONE_METERED_ENABLED=true turns sending on. Anything else: dry run (nothing sent, Clover not asked). */
export function phoneMeteringEnabled(): boolean {
  return String(process.env.FOODHUB_PHONE_METERED_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** Clover ID of the per-minute metered charge (CLOVER_PHONE_METERED_MINUTE_ID). */
export function meteredMinuteId(): string {
  return String(process.env.CLOVER_PHONE_METERED_MINUTE_ID ?? '').trim();
}

/** Never billed: the list shared by both apps (clover-apps.ts). */
export { billingExemptMerchants };

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

/** The owner hears ONCE per call that a charge may or may not have gone through (never sent again). Never throws. */
async function logUncertain(r: PhoneMinuteRecord, detail: string): Promise<void> {
  const first = await getRepo().claimKv(UNCERTAIN_LOG(r.callSid), { at: new Date().toISOString() }).catch(() => true);
  if (!first) return;
  await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_minutes_uncertain', status: 'failed',
    summary: `TAKATAK Phone: ${r.minutes} minute(s) of call ${r.callSid} for merchant ${r.merchantId} may or may not have been billed by Clover (${detail}). Not sent again: check the merchant's Clover usage.` }).catch(() => undefined);
}

/** When this attempt was claimed (its claim's own time), or null. */
async function claimedAt(sid: string, attempt: number): Promise<number | null> {
  return t((await getRepo().getKv<{ at?: string }>(SEND_CLAIM(sid, attempt)).catch(() => null))?.at);
}

/** The record as saved now, if it is still pending on this attempt (nobody moved it on). */
async function stillPending(r: PhoneMinuteRecord): Promise<PhoneMinuteRecord | null> {
  const cur = await getMinuteRecord(r.callSid);
  return cur && cur.state === 'pending' && cur.attempts === r.attempts ? cur : null;
}

/**
 * Send one record's minutes (it is ACTIVE; metering on; the ID set). The attempt is claimed across servers, the POST
 * claimed too, the record saved as "sending" BEFORE the POST, then saved with what Clover said.
 */
async function sendRecord(r: PhoneMinuteRecord, meteredId: string, now: number): Promise<PhoneMinuteRecord> {
  const repo = getRepo();
  if (!(await repo.claimKv(SEND_CLAIM(r.callSid, r.attempts), { at: new Date(now).toISOString() }))) {
    // Another server owns this attempt: its result is (or will be) on the record.
    const cur = await stillPending(r);
    if (!cur) return (await getMinuteRecord(r.callSid)) ?? r;
    // Still "pending" long after the attempt was claimed: its owner stopped. Taking the POST claim proves the POST
    // never started (a definite failure, tried again); when the POST claim is already taken, the owner stopped around
    // the charge: maybe billed, never sent again.
    const since = await claimedAt(r.callSid, r.attempts);
    if (since === null || now - since <= STUCK_CLAIM_MS) return cur;
    if (await repo.claimKv(POST_CLAIM(r.callSid, r.attempts), { at: new Date(now).toISOString(), by: 'cleanup' })) return saveRecord(failed(cur, 'attempt interrupted before sending'));
    const lost = await saveRecord({ ...cur, state: 'uncertain', lastError: 'attempt interrupted around the charge' });
    await logUncertain(lost, 'attempt interrupted around the charge');
    return lost;
  }
  // This attempt is ours: work from the record as saved now, never from an older copy.
  const cur = await stillPending(r);
  if (!cur) return (await getMinuteRecord(r.callSid)) ?? r;
  const token = await cloverAppToken('phone', cur.merchantId, Math.floor(now / 1000)).catch(() => null);
  if (!token) return saveRecord(failed(cur, 'no Clover token for the phone app'));
  // The clean-up of an interrupted attempt took it over (this server was far too slow): it is not sent.
  if (!(await repo.claimKv(POST_CLAIM(cur.callSid, cur.attempts), { at: new Date(now).toISOString(), by: 'send' }))) return (await getMinuteRecord(cur.callSid)) ?? cur;
  const sending = await saveRecord({ ...cur, state: 'sending' }); // saved before the charge goes out
  const out = await postMinutes(cur.merchantId, token, meteredId, cur.minutes);
  try {
    if (out.kind === 'ok') return await saveRecord({ ...sending, state: 'reported', lastError: undefined });
    if (out.kind === 'uncertain') {
      await logUncertain(sending, out.detail);
      return await saveRecord({ ...sending, state: 'uncertain', lastError: out.detail });
    }
    const next = failed(sending, out.detail);
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_minutes_failed', status: 'failed',
      summary: `TAKATAK Phone: Clover did not take ${cur.minutes} minute(s) of call ${cur.callSid} for merchant ${cur.merchantId} (${out.detail}, try ${next.attempts} of ${MAX_MINUTE_ATTEMPTS}); ${next.state === 'failed' ? 'not billed.' : 'tried again later.'}` }).catch(() => undefined);
    return await saveRecord(next);
  } catch (e) {
    // Clover answered but the record could not be saved: it stays "sending" (never sent again); the owner is told now.
    await logUncertain(sending, `Clover answered (${out.kind === 'ok' ? 'billed' : out.detail}) but the record could not be saved`);
    throw e;
  }
}

const DEFERRABLE: EntitlementReason[] = ['clover_unreachable_grace'];

/**
 * Close a pending record (not billable, no metered ID). It takes this attempt's claim first, so it never writes over
 * a send of the same attempt made by another server from a fresher copy.
 */
async function closeRecord(r: PhoneMinuteRecord, patch: Pick<PhoneMinuteRecord, 'state'> & { reason?: string }, now: number): Promise<PhoneMinuteRecord> {
  if (!(await getRepo().claimKv(SEND_CLAIM(r.callSid, r.attempts), { at: new Date(now).toISOString(), close: patch.state }))) return (await getMinuteRecord(r.callSid)) ?? r;
  const cur = await stillPending(r);
  if (!cur) return (await getMinuteRecord(r.callSid)) ?? r;
  return saveRecord({ ...cur, ...patch });
}

/**
 * What to do with a pending record now: send it, keep it waiting (nothing written), or close it as not billable.
 * Metering is on. `ent`: the merchant's entitlement when the caller already asked (one answer per merchant per run).
 */
async function decideAndSend(r: PhoneMinuteRecord, now: number, ent?: Entitlement): Promise<PhoneMinuteRecord> {
  if (!cloverPhoneAppEnabled()) return closeRecord(r, { state: 'not_billable', reason: 'gate_off' }, now);
  if (billingExemptMerchants().has(r.merchantId)) return closeRecord(r, { state: 'not_billable', reason: 'exempt' }, now);
  const meteredId = meteredMinuteId();
  if (!meteredId) return closeRecord(r, { state: 'no_metered_id' }, now);
  const e = ent ?? await voiceAiEntitled(r.merchantId, 'call', { now });
  if (e.billable) return sendRecord(r, meteredId, now);
  // Clover not answering: minutes of a merchant last seen ACTIVE (not in trial) wait for the next real answer. The
  // record already says "pending": nothing is written (an older copy must never go back over a newer state).
  if (DEFERRABLE.includes(e.reason) && String(e.status ?? '').toUpperCase() === 'ACTIVE' && !e.inTrial) return { ...r, state: 'pending', reason: e.reason };
  return closeRecord(r, { state: 'not_billable', reason: e.reason }, now);
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

/**
 * Send what is pending (this month and last), oldest first, at most SETTLE_BATCH sends per run (minutes still waiting
 * for Clover cost nothing in that budget). A "sending" left behind (server stopped, record not saved after Clover
 * answered) becomes "uncertain" and is logged for the owner. Off = nothing. For the expansion tick; never throws.
 */
export async function settlePhoneMinutes(opts: { now?: number; merchantId?: string } = {}): Promise<{ reported: number; pending: number; uncertain: number; failed: number; dropped: number }> {
  const out = { reported: 0, pending: 0, uncertain: 0, failed: 0, dropped: 0 };
  if (!phoneMeteringEnabled()) return out;
  const now = opts.now ?? Date.now();
  const month = phoneMonth(now);
  const months = new Set([month, previousMonth(month)]);
  try {
    const docs = await getRepo().listDocs<PhoneMinuteRecord>(PHONE_MINUTES, { since: new Date(now - 70 * 86400_000).toISOString(), ...(opts.merchantId ? { keys: [opts.merchantId] } : {}), limit: 20_000 });
    const all = docs.map((d) => d.data).filter((r) => months.has(r.month));
    const old = (r: PhoneMinuteRecord) => now - (t(r.updatedAt) ?? now) > STUCK_CLAIM_MS;
    for (const r of all.filter((x) => x.state === 'sending' && old(x))) {
      try {
        const cur = await getMinuteRecord(r.callSid);
        if (!cur || cur.state !== 'sending' || !old(cur)) continue;
        const lost = await saveRecord({ ...cur, state: 'uncertain', lastError: cur.lastError ?? 'the answer to the charge was never saved' });
        await logUncertain(lost, 'the answer to the charge was never saved');
        out.uncertain++;
      } catch (e) {
        console.error('[foodhub] phone minutes settle (sending) failed', r.callSid, e instanceof Error ? e.message : e);
      }
    }
    const pending = all.filter((r) => r.state === 'pending').sort((a, b) => (t(a.at) ?? 0) - (t(b.at) ?? 0));
    const ents = new Map<string, Promise<Entitlement>>();
    let sends = 0;
    for (const r of pending) {
      if (sends >= SETTLE_BATCH) break;
      try {
        let ent: Entitlement | undefined;
        if (cloverPhoneAppEnabled() && !billingExemptMerchants().has(r.merchantId) && meteredMinuteId()) {
          if (!ents.has(r.merchantId)) ents.set(r.merchantId, voiceAiEntitled(r.merchantId, 'call', { now }));
          ent = await ents.get(r.merchantId)!;
          if (ent.billable) sends++;
        }
        const after = await decideAndSend(r, now, ent);
        if (after.state === 'reported') out.reported++;
        else if (after.state === 'pending') out.pending++;
        else if (after.state === 'uncertain' || after.state === 'sending') out.uncertain++;
        else if (after.state === 'failed') out.failed++;
        else out.dropped++;
      } catch (e) {
        console.error('[foodhub] phone minutes settle failed', r.callSid, e instanceof Error ? e.message : e);
      }
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
  /** Metering was on but CLOVER_PHONE_METERED_MINUTE_ID was not set: never sent (a warning for the owner). */
  noMeteredIdMinutes: number;
  noMeteredIdCalls: number;
  notBilledMinutes: number;
  /** wouldBill (off) or reported + pending (on) × CAD 0.25. */
  estimateCad: number;
}

/** This month's minutes, per merchant (Settings → Clover app, phone section). Reads only what is saved. */
export async function phoneMinutesSummary(now = Date.now()): Promise<{ enabled: boolean; meteredIdSet: boolean; price: typeof PHONE_PRICE; month: string; total: MinutesSummary; byMerchant: Record<string, MinutesSummary> }> {
  const month = phoneMonth(now);
  const empty = (): MinutesSummary => ({ month, calls: 0, aiMinutes: 0, wouldBillMinutes: 0, reportedMinutes: 0, pendingMinutes: 0, uncertainMinutes: 0, uncertainCalls: 0, failedMinutes: 0, noMeteredIdMinutes: 0, noMeteredIdCalls: 0, notBilledMinutes: 0, estimateCad: 0 });
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
      else if (r.state === 'no_metered_id') { s.noMeteredIdMinutes += r.minutes; s.noMeteredIdCalls++; }
      else s.notBilledMinutes += r.minutes;
    }
  }
  for (const s of [total, ...Object.values(byMerchant)]) {
    s.estimateCad = Math.round((s.wouldBillMinutes + s.reportedMinutes + s.pendingMinutes) * PHONE_PRICE.perMinuteCad * 100) / 100;
  }
  return { enabled: phoneMeteringEnabled(), meteredIdSet: Boolean(meteredMinuteId()), price: PHONE_PRICE, month, total, byMerchant };
}
