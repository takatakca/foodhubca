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
// What Clover bills (TAKATAK Phone: 14-day free trial, then CAD $50/month + CAD $0.25 per minute of call the AI
// handles) is in clover-phone-minutes.ts: `billable` below is true only while the merchant is ACTIVE (not in trial,
// not ours).
//
// appInstalled(app, merchantId) — whether a Clover app (key or App ID) holds a token for that merchant.
// phoneCloverToken(merchantId) — token for phone features: the phone app's own first, then Food Hub's (env tokens
// included). Food Hub features never use the phone token (clover.ts cloverToken is unchanged).
//
// Wired into the phone module by lib/foodhub/phone/gate.ts (live call, pay link, switching a line on): see docs/CLOVER_MULTI_APP.md.
// Clover is never called from tests (fetch is mocked).
import { cloverToken } from './clover';
import { cloverApp, cloverAppByAppId, cloverPhoneAppEnabled, isCloverAppKey, phoneOwnMerchants, type CloverAppKey } from './clover-apps';
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

/** 'call' = a live call (lenient: grace periods apply); 'setup' = turning on a line or getting a number (strict). */
export type PhonePurpose = 'call' | 'setup';

export type EntitlementReason =
  | 'gate_off' | 'own_merchant' | 'not_installed' | 'pending_approval'
  | 'active' | 'trial' | 'lapsed_grace' | 'lapsed' | 'suspended' | 'inactive' | 'unknown_status'
  | 'clover_unreachable_grace' | 'clover_unreachable';

export interface Entitlement {
  ok: boolean;
  reason: EntitlementReason;
  /** True only when per-minute charges may be sent (ACTIVE, not in trial, not one of ours). */
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

/** Billing month in Montréal time, e.g. "2026-10". */
export function phoneMonth(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now));
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${y}-${m}`;
}

/** The month before "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
