// Who may use the AI phone, and what Clover bills for it (the phone is its own paid Clover App Market app).
//
// voiceAiEntitled(merchantId, purpose) — alias phoneEntitled — answers yes / no with a reason:
//  0. Phone app not set on this server (no CLOVER_PHONE_APP_ID): yes, reason "gate_off". The AI phone then works
//     exactly as before the app existed (our own restaurants, no Clover billing).
//  1. One of our own restaurants (PHONE_OWN_MERCHANTS): yes, never billed.
//  2. Phone app not installed for the merchant (no phone token), or installed but waiting for the owner: no.
//  3. Otherwise Clover's billing_info for the phone app, saved for 15 minutes (any App event of the phone app marks it
//     stale): ACTIVE → yes (billable) · in free trial → yes (never billed) · LAPSED → yes for live calls during 7
//     days, then no · SUPPRESSED / INACTIVE / anything else → no.
//  4. Clover does not answer: a live call goes through while the last good answer (ACTIVE or trial) is less than 3
//     days old; a setup step (turning on a line, getting a number) is refused until Clover answers again.
//  It never checks whether Food Hub is installed: each app works on its own.
//  A refused live call is never dropped — the phone code forwards it to the restaurant's regular number.
//
// A live call never waits long on Clover: asking Clover (token refresh + billing_info) has a budget of 2.5 s, the
// billing read itself a 2.5 s timeout and no 429 retry. When Clover fails or runs out of time, it is not asked again for
// 2 minutes (calls in between answer at once from the saved status and the grace rules). A token refresh that runs out
// of time keeps going in the background (it is never cut short: its answer holds the only copy of the new single-use
// refresh token) and saves its result for the next call.
//
// The saved status lives in its own key per merchant (clover_phone_billing:<merchantId>), never in the token map, so
// this per-call write can never put back an older token record of another merchant.
//
// recordPhoneOrder(merchantId, cloverOrderId) counts one completed, paid phone order (never a call). Beyond the month's
// allowance of the merchant's tier it charges one per-order event in Clover, only while the merchant is ACTIVE (not in
// trial, not ours). An order beyond the allowance taken during a grace answer (LAPSED for a few days, or Clover not
// answering) is kept as "pending" and charged on the next ACTIVE answer; a charge Clover refuses is tried again (3 times
// in all). Each order is saved BEFORE its charge is sent, and marked "sending" while it is in flight: an order whose
// answer was lost (timeout, database error after Clover answered) is never charged twice — it is shown to the owner
// instead (phoneUsage().uncertain). settlePhoneUsage(merchantId) sends what is pending (for a cron; the next order does
// it too). Each Clover order is counted once.
//
// appInstalled(app, merchantId) — whether a Clover app (key or App ID) holds a token for that merchant.
// phoneCloverToken(merchantId) — token for phone features: the phone app's own first, then Food Hub's (env tokens
// included). Food Hub features never use the phone token (clover.ts cloverToken is unchanged).
//
// Wiring into lib/foodhub/phone/** is a follow-up pull request (the AI phone code is not touched here): see docs/CLOVER_MULTI_APP.md.
// Clover is never called from tests (fetch is mocked).
import { logActivity } from '../activity';
import { stripSlash } from '../config';
import { getRepo } from '../repo';
import { cloverToken } from './clover';
import { cloverApp, cloverAppByAppId, cloverPhoneAppEnabled, isCloverAppKey, phoneOwnMerchants, type CloverAppKey } from './clover-apps';
import { cloverFetch } from './clover-http';
import {
  billingPatch, cloverAppToken, patchCloverBillingState, readCloverBilling, readCloverBillingState, readCloverConnection, type CloverBilling,
} from './clover-oauth';

export const BILLING_CACHE_MS = 15 * 60_000;
export const LAPSED_GRACE_DAYS = 7;
export const UNREACHABLE_GRACE_MS = 3 * 24 * 3600_000;
/** Longest a live call waits on Clover (Twilio gives a voice webhook about 15 s in all). */
export const CHECK_BUDGET_MS = 2_500;
/** After Clover failed or ran out of time, it is not asked again for this long. */
export const CHECK_RETRY_AFTER_MS = 2 * 60_000;
const DAY_MS = 24 * 3600_000;

/** Monthly phone orders included in each tier before the per-order charge (owner's draft pricing). */
export const PHONE_ALLOWANCE = { essentiel: 150, pro: 500 } as const;

/** 'call' = a live call (lenient: grace periods apply); 'setup' = turning on a line or getting a number (strict). */
export type PhonePurpose = 'call' | 'setup';

export type EntitlementReason =
  | 'gate_off' | 'own_merchant' | 'not_installed' | 'pending_approval'
  | 'active' | 'trial' | 'lapsed_grace' | 'lapsed' | 'suspended' | 'inactive' | 'unknown_status'
  | 'clover_unreachable_grace' | 'clover_unreachable';

export interface Entitlement {
  ok: boolean;
  reason: EntitlementReason;
  /** True only when per-order charges may be sent (ACTIVE, not in trial, not one of ours). */
  billable: boolean;
  status: string | null;
  inTrial: boolean;
  plan: string | null;
  /** Clover subscription ID of the plan (maps the tier exactly). */
  planId: string | null;
  /** When Clover's answer used here was read (null = no answer used). */
  checkedAt: string | null;
  /** The answer came from the saved copy (15 minutes), not from Clover just now. */
  cached: boolean;
}

function verdict(ok: boolean, reason: EntitlementReason, b: CloverBilling | null = null, cached = false): Entitlement {
  return {
    ok, reason, billable: ok && reason === 'active',
    status: b?.status ?? null, inTrial: Boolean(b?.inTrial), plan: b?.plan ?? null, planId: b?.planId ?? null, checkedAt: b?.checkedAt ?? null, cached,
  };
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Decide from one Clover answer. */
function decide(b: CloverBilling, purpose: PhonePurpose, lapsedSince: string | null | undefined, now: number, cached: boolean): Entitlement {
  const status = String(b.status || '').toUpperCase();
  if (status === 'SUPPRESSED') return verdict(false, 'suspended', b, cached);
  if (status === 'INACTIVE') return verdict(false, 'inactive', b, cached);
  if (b.inTrial && (status === 'ACTIVE' || status === '')) return verdict(true, 'trial', b, cached);
  if (status === 'ACTIVE') return verdict(true, 'active', b, cached);
  if (status === 'LAPSED') {
    const since = ms(lapsedSince);
    const days = typeof b.daysLapsed === 'number' ? b.daysLapsed : since !== null ? (now - since) / DAY_MS : 0;
    return purpose === 'call' && days <= LAPSED_GRACE_DAYS ? verdict(true, 'lapsed_grace', b, cached) : verdict(false, 'lapsed', b, cached);
  }
  return verdict(false, 'unknown_status', b, cached);
}

const TIMED_OUT = Symbol('timed out');
function withinBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), budgetMs); });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Ask Clover now (token, then billing_info with a short timeout) and save the answer — or the failure — for the next calls. */
async function askClover(mid: string, now: number, readTimeoutMs: number): Promise<{ billing: CloverBilling; lapsedSince: string | null } | null> {
  const token = await cloverAppToken('phone', mid, Math.floor(now / 1000)).catch(() => null);
  const fresh = token ? await readCloverBilling(mid, token, 'phone', { timeoutMs: readTimeoutMs, retries: 0 }).catch(() => null) : null;
  if (!fresh) {
    await patchCloverBillingState(mid, { checkFailedAt: new Date(now).toISOString() }, 'phone').catch(() => undefined);
    return null;
  }
  const prev = await readCloverBillingState(mid, 'phone');
  const patch = { ...billingPatch(prev, fresh), checkFailedAt: null };
  await patchCloverBillingState(mid, patch, 'phone').catch(() => undefined);
  return { billing: fresh, lapsedSince: patch.lapsedSince ?? null };
}

/** Is the AI phone allowed for this merchant right now? (alias: phoneEntitled) */
export async function voiceAiEntitled(merchantId: string, purpose: PhonePurpose = 'call', opts: { now?: number; budgetMs?: number } = {}): Promise<Entitlement> {
  const now = opts.now ?? Date.now();
  const budget = typeof opts.budgetMs === 'number' && opts.budgetMs > 0 ? opts.budgetMs : CHECK_BUDGET_MS;
  const mid = String(merchantId || '').trim();
  if (!cloverPhoneAppEnabled()) return verdict(true, 'gate_off');
  if (mid && phoneOwnMerchants().has(mid)) return verdict(true, 'own_merchant');
  const c = mid ? await readCloverConnection(mid, 'phone') : null;
  if (!c) return verdict(false, 'not_installed');
  if (c.status === 'pending') return verdict(false, 'pending_approval');

  const st = await readCloverBillingState(mid, 'phone');
  const saved = st.billing ?? null;
  const savedAt = ms(saved?.checkedAt);
  if (saved && !st.billingStale && savedAt !== null && now - savedAt >= 0 && now - savedAt < BILLING_CACHE_MS) {
    return decide(saved, purpose, st.lapsedSince, now, true);
  }

  // Clover failed a moment ago: answer at once from the grace rules instead of making this call wait on it again.
  const failedAt = ms(st.checkFailedAt);
  const recentlyFailed = failedAt !== null && now - failedAt >= 0 && now - failedAt < CHECK_RETRY_AFTER_MS;
  if (!recentlyFailed) {
    const asked = askClover(mid, now, Math.min(budget, CHECK_BUDGET_MS));
    const fresh = await withinBudget(asked, budget);
    if (fresh === TIMED_OUT) {
      // Out of time: the ask keeps going in the background and saves its answer; until then, Clover is not asked again.
      void asked.catch(() => undefined);
      await patchCloverBillingState(mid, { checkFailedAt: new Date(now).toISOString() }, 'phone').catch(() => undefined);
    } else if (fresh) {
      return decide(fresh.billing, purpose, fresh.lapsedSince, now, false);
    }
  }

  // Clover did not answer: live calls ride on the last good answer for 3 days; setup waits for a real answer.
  const lastGood = ms(st.billingLastGoodAt);
  if (purpose === 'call' && lastGood !== null && now - lastGood < UNREACHABLE_GRACE_MS) {
    return verdict(true, 'clover_unreachable_grace', saved, true);
  }
  return verdict(false, 'clover_unreachable', saved, true);
}

export const phoneEntitled = voiceAiEntitled;

/** Whether a Clover app (our key, or its Clover App ID) holds a token for this merchant (approved or waiting). */
export async function appInstalled(app: CloverAppKey | string, merchantId: string): Promise<boolean> {
  const key = isCloverAppKey(app) ? app : cloverAppByAppId(app);
  if (!key || !merchantId) return false;
  if (key !== 'foodhub' && !cloverApp(key).appId) return false;
  return Boolean(await readCloverConnection(merchantId, key).catch(() => null));
}

/** Token for phone features: the phone app's own token first, then Food Hub's (env tokens, then the Food Hub app). */
export async function phoneCloverToken(merchantId: string): Promise<string | null> {
  if (cloverPhoneAppEnabled()) {
    const own = await cloverAppToken('phone', merchantId).catch(() => null);
    if (own) return own;
  }
  return cloverToken(merchantId);
}

/** Clover subscription IDs of the Pro tier (CLOVER_PHONE_PRO_SUBSCRIPTION_IDS, comma-separated). */
function proSubscriptionIds(): Set<string> {
  return new Set(String(process.env.CLOVER_PHONE_PRO_SUBSCRIPTION_IDS || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean));
}

/** "Pro" as a word, or a word starting with "Pro" + "fession…" (Pro, PRO+, Pro-Plus, Professionnel, Professional). */
const PRO_NAME = /(^|[^a-z0-9])pro(fession[a-z]*)?(?![a-z0-9])/i;

/**
 * Orders included per month for a merchant's plan: Pro → 500, anything else → Essentiel's 150. When the Pro tier's
 * Clover subscription IDs are set (CLOVER_PHONE_PRO_SUBSCRIPTION_IDS), the ID decides; otherwise the plan name does.
 */
export function phoneAllowance(plan: string | null | undefined, planId?: string | null): number {
  const ids = proSubscriptionIds();
  if (ids.size > 0 && planId) return ids.has(planId) ? PHONE_ALLOWANCE.pro : PHONE_ALLOWANCE.essentiel;
  return PRO_NAME.test(String(plan || '')) ? PHONE_ALLOWANCE.pro : PHONE_ALLOWANCE.essentiel;
}

/** Billing month in Montréal time, e.g. "2026-10". */
export function phoneMonth(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now));
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${y}-${m}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** One merchant's phone orders for one month (fh_kv clover_phone_usage:<merchantId>:<YYYY-MM>). */
interface PhoneUsage {
  /** Every counted order. */
  orders: string[];
  /** Charged in Clover. */
  reported: string[];
  /** Clover refused the charge 3 times: given up (the owner sees the count). */
  failed: string[];
  /** Beyond the allowance, not charged yet: sent on the next ACTIVE answer. */
  pending?: string[];
  /** Charge sent, answer never saved (timeout, database error): never re-sent automatically. */
  sending?: string[];
  /** Refusals per order (retry up to MAX_CHARGE_ATTEMPTS). */
  attempts?: Record<string, number>;
}
const usageKey = (mid: string, month: string) => `clover_phone_usage:${mid}:${month}`;
const MAX_CHARGE_ATTEMPTS = 3;
/** Charges sent in one go at most (the rest wait for the next order or the next settle). */
const SETTLE_BATCH = 25;

function normalize(u: PhoneUsage | null): Required<PhoneUsage> {
  return { orders: u?.orders ?? [], reported: u?.reported ?? [], failed: u?.failed ?? [], pending: u?.pending ?? [], sending: u?.sending ?? [], attempts: u?.attempts ?? {} };
}

export async function phoneUsage(merchantId: string, now = Date.now()): Promise<{ month: string; orders: number; reported: number; failed: number; pending: number; uncertain: number }> {
  const month = phoneMonth(now);
  const u = normalize(await getRepo().getKv<PhoneUsage>(usageKey(merchantId, month)).catch(() => null));
  return { month, orders: u.orders.length, reported: u.reported.length, failed: u.failed.length, pending: u.pending.length, uncertain: u.sending.length };
}

export type PhoneOrderOutcome =
  | 'reported' | 'duplicate' | 'bad_input' | 'within_allowance' | 'not_billable' | 'no_metered_id' | 'deferred' | 'clover_refused' | 'clover_uncertain';

export interface PhoneOrderResult {
  counted: boolean;
  reported: boolean;
  outcome: PhoneOrderOutcome;
  /** Entitlement reason when the order is not billable (trial, own merchant, gate off…) or deferred (grace). */
  reason?: EntitlementReason;
  used: number;
  allowance: number;
  month: string;
}

/** One record at a time per merchant in this process (KV read-modify-write). */
const usageLocks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = usageLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  usageLocks.set(key, next);
  void next.finally(() => { if (usageLocks.get(key) === next) usageLocks.delete(key); }).catch(() => undefined);
  return next;
}

function apiBase() { return stripSlash(process.env.CLOVER_BASE_URL || 'https://api.clover.com'); }

/**
 * Clover App Market metered event (one per billable order beyond the allowance). `uncertain` = the request may have
 * reached Clover but its answer was lost (timeout): it must not be sent again automatically.
 */
async function postMetered(mid: string, token: string, meteredId: string): Promise<{ ok: boolean; status: number; uncertain: boolean }> {
  const appId = cloverApp('phone').appId || '';
  const url = `${apiBase()}/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(mid)}/metereds/${encodeURIComponent(meteredId)}?count=1`;
  try {
    const res = await cloverFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    return { ok: res.ok, status: res.status, uncertain: false };
  } catch (e) {
    return { ok: false, status: 0, uncertain: (e as { name?: string } | null)?.name === 'AbortError' };
  }
}

/**
 * Send the pending charges of one month (caller holds the merchant's lock and checked the merchant is ACTIVE).
 * Each order is moved to "sending" and saved before its charge goes out, then to "reported" (or back to "pending").
 */
async function settleMonth(mid: string, month: string, token: string, meteredId: string, preloaded?: Required<PhoneUsage>): Promise<Required<PhoneUsage>> {
  const repo = getRepo();
  const key = usageKey(mid, month);
  const u = preloaded ?? normalize(await repo.getKv<PhoneUsage>(key).catch(() => null));
  for (const oid of u.pending.slice(0, SETTLE_BATCH)) {
    u.pending = u.pending.filter((x) => x !== oid);
    u.sending.push(oid);
    await repo.setKv(key, u); // saved before the charge goes out: a lost answer never charges twice
    const r = await postMetered(mid, token, meteredId);
    u.sending = u.sending.filter((x) => x !== oid);
    if (r.ok) {
      u.reported.push(oid);
      delete u.attempts[oid];
    } else if (r.uncertain) {
      u.sending.push(oid); // Clover may have charged it: shown to the owner, never re-sent automatically
    } else {
      const n = (u.attempts[oid] ?? 0) + 1;
      u.attempts[oid] = n;
      if (n >= MAX_CHARGE_ATTEMPTS) u.failed.push(oid);
      else u.pending.push(oid);
      await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_metered_failed', status: 'failed',
        summary: `Clover refused a phone-order charge for merchant ${mid} (HTTP ${r.status}, try ${n} of ${MAX_CHARGE_ATTEMPTS}). The order is counted; ${n >= MAX_CHARGE_ATTEMPTS ? 'it was not billed.' : 'it will be tried again.'}` }).catch(() => undefined);
    }
    await repo.setKv(key, u);
  }
  return u;
}

/** Send this month's (and last month's) pending charges when the merchant is ACTIVE. Caller holds the lock. */
async function settleLocked(mid: string, now: number, ent: Entitlement, current?: Required<PhoneUsage>): Promise<Required<PhoneUsage> | null> {
  const meteredId = String(process.env.CLOVER_PHONE_METERED_ORDER_ID || '').trim();
  if (!ent.billable || !meteredId) return null;
  const month = phoneMonth(now);
  const prevMonth = previousMonth(month);
  const prev = normalize(await getRepo().getKv<PhoneUsage>(usageKey(mid, prevMonth)).catch(() => null));
  const cur = current ?? null;
  if (!cur?.pending.length && !prev.pending.length) return cur;
  const token = await cloverAppToken('phone', mid, Math.floor(now / 1000)).catch(() => null);
  if (!token) return cur;
  if (prev.pending.length) await settleMonth(mid, prevMonth, token, meteredId, prev);
  return cur?.pending.length ? settleMonth(mid, month, token, meteredId, cur) : cur;
}

/** Send the pending per-order charges of a merchant (for a cron; recordPhoneOrder does it too). */
export async function settlePhoneUsage(merchantId: string, opts: { now?: number } = {}): Promise<{ reported: number; pending: number; uncertain: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const mid = String(merchantId || '').trim();
  return withLock(mid, async () => {
    const key = usageKey(mid, phoneMonth(now));
    const u = normalize(await getRepo().getKv<PhoneUsage>(key).catch(() => null));
    const ent = await voiceAiEntitled(mid, 'call', { now });
    const after = (await settleLocked(mid, now, ent, u)) ?? u;
    return { reported: after.reported.length, pending: after.pending.length, uncertain: after.sending.length, failed: after.failed.length };
  });
}

/** Count one completed, paid phone order; charge it in Clover only beyond the month's allowance of an ACTIVE subscription. */
export async function recordPhoneOrder(merchantId: string, cloverOrderId: string, opts: { now?: number } = {}): Promise<PhoneOrderResult> {
  const now = opts.now ?? Date.now();
  const mid = String(merchantId || '').trim();
  const oid = String(cloverOrderId || '').trim();
  const month = phoneMonth(now);
  if (!/^[A-Z0-9]{8,20}$/i.test(mid) || !/^[A-Za-z0-9_-]{1,64}$/.test(oid)) {
    return { counted: false, reported: false, outcome: 'bad_input', used: 0, allowance: 0, month };
  }
  return withLock(mid, async () => {
    const repo = getRepo();
    const key = usageKey(mid, month);
    const u = normalize(await repo.getKv<PhoneUsage>(key).catch(() => null));
    const prev = await repo.getKv<PhoneUsage>(usageKey(mid, previousMonth(month))).catch(() => null);
    if (u.orders.includes(oid) || prev?.orders?.includes(oid)) {
      const st = await readCloverBillingState(mid, 'phone').catch(() => null);
      return { counted: false, reported: false, outcome: 'duplicate', used: u.orders.length, allowance: phoneAllowance(st?.billing?.plan, st?.billing?.planId), month };
    }
    const ent = await voiceAiEntitled(mid, 'call', { now });
    const allowance = phoneAllowance(ent.plan, ent.planId);
    u.orders.push(oid);
    const result = (outcome: PhoneOrderOutcome, reported = false, reason?: EntitlementReason): PhoneOrderResult =>
      ({ counted: true, reported, outcome, ...(reason ? { reason } : {}), used: u.orders.length, allowance, month });

    const over = u.orders.length > allowance;
    // A grace answer (LAPSED for a few days, Clover not answering) may still turn into a charge once Clover says ACTIVE.
    const deferrable = ent.reason === 'lapsed_grace' || ent.reason === 'clover_unreachable_grace';
    let fixed: { outcome: PhoneOrderOutcome; reason?: EntitlementReason } | null = null;
    if (!ent.billable && !(deferrable && over)) fixed = { outcome: 'not_billable', reason: ent.reason };
    else if (!over) fixed = { outcome: 'within_allowance' };
    else if (!String(process.env.CLOVER_PHONE_METERED_ORDER_ID || '').trim()) fixed = { outcome: 'no_metered_id' };
    else {
      u.pending.push(oid);
      if (!ent.billable) fixed = { outcome: 'deferred', reason: ent.reason };
    }
    await repo.setKv(key, u); // counted and saved before any charge is sent
    // ACTIVE now: send this order's charge and any left pending (grace answers, earlier refusals, last month's).
    const after = ent.billable ? (await settleLocked(mid, now, ent, u)) ?? u : u;
    if (fixed) return result(fixed.outcome, false, fixed.reason);
    if (after.reported.includes(oid)) return result('reported', true);
    if (after.sending.includes(oid)) return result('clover_uncertain');
    if (after.failed.includes(oid) || after.attempts[oid]) return result('clover_refused');
    return result('deferred', false, ent.reason); // no token right now: charged on the next settle
  });
}
