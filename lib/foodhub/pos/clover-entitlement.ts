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
// recordPhoneOrder(merchantId, cloverOrderId) counts one completed, paid phone order (never a call) and sends the
// per-order charge to Clover only when the merchant is ACTIVE (not in trial, not ours) and the month's allowance of its
// tier is used up. Each Clover order is counted and reported once.
//
// appInstalled(app, merchantId) — whether a Clover app (key or App ID) holds a token for that merchant.
// phoneCloverToken(merchantId) — token for phone features: the phone app's own first, then Food Hub's (env tokens
// included). Food Hub features never use the phone token (clover.ts cloverToken is unchanged).
//
// Wiring into lib/foodhub/phone/** comes after the AI phone pull request is merged: see docs/CLOVER_MULTI_APP.md.
// Clover is never called from tests (fetch is mocked).
import { logActivity } from '../activity';
import { stripSlash } from '../config';
import { getRepo } from '../repo';
import { cloverToken } from './clover';
import { cloverApp, cloverAppByAppId, cloverPhoneAppEnabled, isCloverAppKey, phoneOwnMerchants, type CloverAppKey } from './clover-apps';
import { cloverFetch } from './clover-http';
import { billingPatch, cloverAppToken, patchCloverConnection, readCloverBilling, readCloverConnection, type CloverBilling } from './clover-oauth';

export const BILLING_CACHE_MS = 15 * 60_000;
export const LAPSED_GRACE_DAYS = 7;
export const UNREACHABLE_GRACE_MS = 3 * 24 * 3600_000;
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
  /** When Clover's answer used here was read (null = no answer used). */
  checkedAt: string | null;
  /** The answer came from the 15-minute saved copy. */
  cached: boolean;
}

function verdict(ok: boolean, reason: EntitlementReason, b: CloverBilling | null = null, cached = false): Entitlement {
  return {
    ok, reason, billable: ok && reason === 'active',
    status: b?.status ?? null, inTrial: Boolean(b?.inTrial), plan: b?.plan ?? null, checkedAt: b?.checkedAt ?? null, cached,
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

/** Is the AI phone allowed for this merchant right now? (alias: phoneEntitled) */
export async function voiceAiEntitled(merchantId: string, purpose: PhonePurpose = 'call', opts: { now?: number } = {}): Promise<Entitlement> {
  const now = opts.now ?? Date.now();
  const mid = String(merchantId || '').trim();
  if (!cloverPhoneAppEnabled()) return verdict(true, 'gate_off');
  if (mid && phoneOwnMerchants().has(mid)) return verdict(true, 'own_merchant');
  const c = mid ? await readCloverConnection(mid, 'phone') : null;
  if (!c) return verdict(false, 'not_installed');
  if (c.status === 'pending') return verdict(false, 'pending_approval');

  const saved = c.billing ?? null;
  const savedAt = ms(saved?.checkedAt);
  if (saved && !c.billingStale && savedAt !== null && now - savedAt >= 0 && now - savedAt < BILLING_CACHE_MS) {
    return decide(saved, purpose, c.lapsedSince, now, true);
  }

  const token = await cloverAppToken('phone', mid, Math.floor(now / 1000)).catch(() => null);
  const fresh = token ? await readCloverBilling(mid, token, 'phone').catch(() => null) : null;
  if (fresh) {
    const patch = billingPatch(c, fresh);
    await patchCloverConnection(mid, patch, 'phone').catch(() => false);
    return decide(fresh, purpose, patch.lapsedSince, now, false);
  }

  // Clover did not answer: live calls ride on the last good answer for 3 days; setup waits for a real answer.
  const lastGood = ms(c.billingLastGoodAt);
  if (purpose === 'call' && lastGood !== null && now - lastGood < UNREACHABLE_GRACE_MS) {
    return verdict(true, 'clover_unreachable_grace', saved);
  }
  return verdict(false, 'clover_unreachable', saved);
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

/** Orders included per month for a Clover plan name (Pro → 500, anything else → Essentiel's 150). */
export function phoneAllowance(plan: string | null | undefined): number {
  return /\bpro\b/i.test(String(plan || '')) ? PHONE_ALLOWANCE.pro : PHONE_ALLOWANCE.essentiel;
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

interface PhoneUsage { orders: string[]; reported: string[]; failed: string[] }
const usageKey = (mid: string, month: string) => `clover_phone_usage:${mid}:${month}`;

export async function phoneUsage(merchantId: string, now = Date.now()): Promise<{ month: string; orders: number; reported: number; failed: number }> {
  const month = phoneMonth(now);
  const u = (await getRepo().getKv<PhoneUsage>(usageKey(merchantId, month)).catch(() => null)) ?? { orders: [], reported: [], failed: [] };
  return { month, orders: u.orders.length, reported: u.reported.length, failed: u.failed.length };
}

export type PhoneOrderOutcome =
  | 'reported' | 'duplicate' | 'bad_input' | 'within_allowance' | 'not_billable' | 'no_metered_id' | 'clover_refused';

export interface PhoneOrderResult {
  counted: boolean;
  reported: boolean;
  outcome: PhoneOrderOutcome;
  /** Entitlement reason when the order is not billable (trial, own merchant, gate off…). */
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

/** Clover App Market metered event (one per billable order beyond the allowance). */
async function postMetered(mid: string, token: string, meteredId: string): Promise<{ ok: boolean; status: number }> {
  const appId = cloverApp('phone').appId || '';
  const url = `${apiBase()}/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(mid)}/metereds/${encodeURIComponent(meteredId)}?count=1`;
  try {
    const res = await cloverFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Count one completed, paid phone order; send the per-order charge only beyond the month's allowance of an ACTIVE subscription. */
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
    const u = (await repo.getKv<PhoneUsage>(key).catch(() => null)) ?? { orders: [], reported: [], failed: [] };
    const prev = await repo.getKv<PhoneUsage>(usageKey(mid, previousMonth(month))).catch(() => null);
    if (u.orders.includes(oid) || prev?.orders.includes(oid)) {
      const saved = await readCloverConnection(mid, 'phone').catch(() => null);
      return { counted: false, reported: false, outcome: 'duplicate', used: u.orders.length, allowance: phoneAllowance(saved?.billing?.plan), month };
    }
    const ent = await voiceAiEntitled(mid, 'call', { now });
    const allowance = phoneAllowance(ent.plan);
    u.orders.push(oid);
    const done = async (outcome: PhoneOrderOutcome, reported = false, reason?: EntitlementReason): Promise<PhoneOrderResult> => {
      await repo.setKv(key, u);
      return { counted: true, reported, outcome, ...(reason ? { reason } : {}), used: u.orders.length, allowance, month };
    };
    // Billable only when the phone app is sold here, the merchant is ACTIVE (not trial, not ours), with a fresh answer.
    if (!ent.billable) return done('not_billable', false, ent.reason);
    if (u.orders.length <= allowance) return done('within_allowance');
    const meteredId = String(process.env.CLOVER_PHONE_METERED_ORDER_ID || '').trim();
    if (!meteredId) return done('no_metered_id');
    const token = await cloverAppToken('phone', mid, Math.floor(now / 1000)).catch(() => null);
    const r = token ? await postMetered(mid, token, meteredId) : { ok: false, status: 0 };
    if (r.ok) {
      u.reported.push(oid);
      return done('reported', true);
    }
    u.failed.push(oid);
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_phone_metered_failed', status: 'failed',
      summary: `Clover refused the phone-order charge for merchant ${mid} (HTTP ${r.status}). The order is counted; it was not billed.` }).catch(() => undefined);
    return done('clover_refused');
  });
}
