// TAKATAK Food Hub billing through Clover: the subscription status of each merchant, and the metered charge
// "Extra brand, per platform, per month" (prices in clover-pricing.ts, owner steps in docs/CLOVER_BILLING.md).
//
// 1. Subscription status — foodhubBillingStatus(merchantId): Clover's billing_info for the Food Hub app (tier, trial,
//    ACTIVE / LAPSED…), saved 15 minutes in its own key (clover_foodhub_billing:<merchantId>), never in the token map.
//    The newest of that copy and the one the App webhook keeps on the connection is used.
//
// 2. Extra-brand units — countExtraBrands(): for one Clover merchant, the brands with at least one store connected on
//    Uber Eats, DoorDash or SkipTheDishes (Food Hub's store mappings; a store follows its own Clover merchant, else the
//    default one, like orders do). The first brand is included in the subscription: the one the owner marked "marque
//    principale" for that merchant, else the oldest (its first store mapped earliest). Each other brand counts one unit
//    per platform it is on (a brand on Uber Eats at two locations of the same merchant is still one unit). A brand
//    deactivated in Business setup is not counted. Too Good To Go is never counted.
//
// 3. Monthly report — runExtraBrandBilling(): OFF unless FOODHUB_CLOVER_METERED_ENABLED=true (and the metered ID is in
//    CLOVER_METERED_EXTRA_BRAND_ID). Every run (the sync calls it at most once an hour; /api/foodhub/cron/clover-billing
//    too) keeps, per merchant and month, the highest unit count seen while the merchant's subscription was PAID (ACTIVE,
//    not in the free trial, on the Standard tier). A run that cannot read the brands or the main-brand marks records
//    nothing (never a count from defaults). During the next month, that count is sent once to Clover:
//      POST /v3/apps/{appId}/merchants/{mId}/metereds/{meteredId}?count=N
//    Idempotent per merchant and month: each try is claimed with one atomic database write (so two containers never
//    send it both), the month is saved as "sending" BEFORE the request goes out, then "reported". Only an answer that
//    shows Clover did not process it (a 4xx, or no connection at all) is tried again on later runs (3 tries in all,
//    then "failed"); a timeout, a broken connection, a 5xx or a 408 is "uncertain" and never sent again automatically
//    (the owner checks it in Clover). A month is only reported during the month after it.
//    Merchants in FOODHUB_BILLING_EXEMPT_MERCHANTS or PHONE_OWN_MERCHANTS (comma lists) are never counted or reported.
//    Count 0 = nothing sent. Every report, refusal and change of count is written to the billing log (Settings → Clover app).
//
// 4. Dry run — previewExtraBrandBilling(): exactly what each merchant would be billed, without writing or sending.
// 5. Price notice — quoteExtraBrand() / quoteExtraStores(): the extra cost of connecting stores (all at once) or of
//    adding a brand, for the console.
//
// Clover is never called from tests (fetch is mocked).
import { logActivity } from '../activity';
import { getCatalog } from '../catalog';
import { stripSlash } from '../config';
import { getRepo } from '../repo';
import type { ChannelStore } from '../types';
import { defaultCloverMerchant } from './clover';
import { billingExemptMerchants, cloverApp } from './clover-apps';
import { phoneMonth as billingMonth } from './clover-entitlement';
import { cloverFetch } from './clover-http';
import {
  billingPatch, cloverAppToken, connectedCloverMerchantIds, listCloverConnections, patchCloverBillingState, readCloverBilling,
  readCloverBillingState, readCloverConnection, type CloverBilling,
} from './clover-oauth';
import {
  BILLED_PLATFORMS, billingStatusText, billingTone, extraBrandNotice, extraBrandsMonthlyCad, extraUnitsNotice, isBilledPlatform,
  TRIAL_DAYS, type BilledPlatform, type BillingView, type Bilingual, type ExtraUnitLine,
} from './clover-pricing';

export { billingMonth };

export const BILLING_STATUS_CACHE_MS = 15 * 60_000;
/** The sync runs every few minutes: the billing run happens at most once an hour. */
export const BILLING_TICK_MS = 60 * 60_000;
export const MAX_REPORT_ATTEMPTS = 3;
const DAY_MS = 24 * 3600_000;
const LOG_KEY = 'clover_billing_log';
const LOG_MAX = 300;
const TICK_KEY = 'clover_extra_brands_tick';
const PRIMARY_KEY = 'clover_billing_primary_brand';
const periodKey = (mid: string, month: string) => `clover_extra_brands:${mid}:${month}`;

// ---------- Settings (environment) ----------

const idList = (v: string | undefined) => String(v || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/** Merchants never billed for extra brands: the list shared by both apps (clover-apps.ts). */
export { billingExemptMerchants };

/** Clover subscription IDs of the Food Hub "Standard" tier (CLOVER_FOODHUB_STANDARD_PLAN_IDS, comma-separated). */
export function standardPlanIds(): Set<string> {
  return new Set(idList(process.env.CLOVER_FOODHUB_STANDARD_PLAN_IDS));
}

/**
 * Null when the merchant is on the Standard tier (extra brands are billed on top of it); otherwise the tier, for the
 * dry run ("not billed: tier X"). With CLOVER_FOODHUB_STANDARD_PLAN_IDS set, the subscription ID decides; otherwise
 * the tier name must say "Standard" and its price must not be $0. Unknown = not billed.
 */
export function tierNotBilled(b: CloverBilling | null | undefined): string | null {
  if (!b) return 'unknown';
  const name = b.plan || b.planId || 'unknown';
  const ids = standardPlanIds();
  if (ids.size > 0) return b.planId && ids.has(b.planId) ? null : name;
  if (b.amountCents === 0) return name;
  return /standard/i.test(String(b.plan || '')) ? null : name;
}

/** Sending extra-brand charges to Clover is on only with FOODHUB_CLOVER_METERED_ENABLED=true. */
export function meteredBillingEnabled(): boolean {
  return String(process.env.FOODHUB_CLOVER_METERED_ENABLED || '').trim().toLowerCase() === 'true';
}

/** The Clover metered ID of "Extra brand, per platform, per month" (CLOVER_METERED_EXTRA_BRAND_ID). */
export function extraBrandMeteredId(): string | null {
  const v = String(process.env.CLOVER_METERED_EXTRA_BRAND_ID || '').trim();
  return v || null;
}

export function previousBillingMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// ---------- 1. Subscription status ----------

export interface FoodHubBillingStatus {
  merchantId: string;
  billing: CloverBilling | null;
  view: BillingView | null;
  text: Bilingual;
  tone: ReturnType<typeof billingTone>;
  /** Paid Standard subscription (ACTIVE, not in trial, Standard tier): extra brands are billable. */
  paid: boolean;
  /** ACTIVE and past the trial but on another tier than Standard (e.g. an old $0 tier): the tier, never billed. */
  notBilledTier: string | null;
  checkedAt: string | null;
  /** The answer came from the saved copy, not from Clover just now. */
  cached: boolean;
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

function newest(a: CloverBilling | null | undefined, b: CloverBilling | null | undefined): CloverBilling | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return (ms(b.checkedAt) ?? 0) > (ms(a.checkedAt) ?? 0) ? b : a;
}

/** The console's view of a billing_info answer: trial days left from Clover's trial end, else 14 days after the install. */
export function billingView(b: CloverBilling | null, connectedAt: string | null | undefined, now = Date.now()): BillingView | null {
  if (!b) return null;
  let trialDaysLeft: number | null = null;
  let trialEstimated = false;
  if (b.inTrial) {
    const end = ms(b.trialEndsAt) ?? (ms(connectedAt) !== null ? ms(connectedAt)! + TRIAL_DAYS * DAY_MS : null);
    trialEstimated = ms(b.trialEndsAt) === null && end !== null;
    if (end !== null) trialDaysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));
  }
  return { status: b.status, inTrial: b.inTrial, plan: b.plan, daysLapsed: b.daysLapsed, trialDaysLeft, trialEstimated, amountCents: b.amountCents ?? null };
}

function statusOf(mid: string, billing: CloverBilling | null, connectedAt: string | null | undefined, now: number, cached: boolean): FoodHubBillingStatus {
  const view = billingView(billing, connectedAt, now);
  const tone = billingTone(view);
  const tier = tone === 'active' ? tierNotBilled(billing) : null;
  return {
    merchantId: mid, billing, view, tone, paid: tone === 'active' && tier === null, notBilledTier: tier, cached, checkedAt: billing?.checkedAt ?? null,
    text: { fr: billingStatusText(view, 'fr'), en: billingStatusText(view, 'en') },
  };
}

/** The merchant's Food Hub subscription in Clover (saved 15 minutes; `refresh` asks Clover now). */
export async function foodhubBillingStatus(merchantId: string, opts: { now?: number; refresh?: boolean } = {}): Promise<FoodHubBillingStatus> {
  const now = opts.now ?? Date.now();
  const mid = String(merchantId || '').trim();
  const conn = mid ? await readCloverConnection(mid, 'foodhub').catch(() => null) : null;
  if (!conn) return statusOf(mid, null, null, now, true);
  const st = await readCloverBillingState(mid, 'foodhub').catch(() => null);
  const saved = newest(st?.billing ?? null, conn.billing ?? null);
  const savedAt = ms(saved?.checkedAt);
  const fresh = saved && !st?.billingStale && savedAt !== null && now - savedAt >= 0 && now - savedAt < BILLING_STATUS_CACHE_MS;
  if (fresh && !opts.refresh) return statusOf(mid, saved, conn.connectedAt, now, true);
  if (conn.status !== 'pending') {
    const token = await cloverAppToken('foodhub', mid, Math.floor(now / 1000)).catch(() => null);
    const answer = token ? await readCloverBilling(mid, token, 'foodhub', { timeoutMs: 5_000, retries: 0 }).catch(() => null) : null;
    if (answer) {
      await patchCloverBillingState(mid, { ...billingPatch(st, answer), checkFailedAt: null }, 'foodhub').catch(() => undefined);
      return statusOf(mid, answer, conn.connectedAt, now, false);
    }
  }
  return statusOf(mid, saved, conn.connectedAt, now, true);
}

// ---------- 2. Extra-brand units ----------

export interface BrandLine {
  brand: string;
  platforms: BilledPlatform[];
  /** When its first store (on a billed platform, for this merchant) was mapped. */
  firstStoreAt: string | null;
  /** Billed as an extra brand (not the first brand). */
  extra: boolean;
  units: number;
}

export interface ExtraBrandCount {
  merchantId: string;
  firstBrand: string | null;
  /** 'owner' = marked "marque principale"; 'oldest' = the brand mapped first. */
  firstBrandSource: 'owner' | 'oldest' | null;
  brands: BrandLine[];
  units: number;
  monthlyCad: number;
}

export interface CountInput {
  merchantId: string;
  /** Merchant of a store with no Clover merchant of its own (CLOVER_MERCHANT_ID, or the only connected merchant). */
  defaultMerchant?: string | null;
  /** Brands deactivated in Business setup (never counted). */
  inactiveBrands?: Set<string>;
  /** The brand the owner marked "marque principale" for this merchant. */
  primaryBrand?: string | null;
}

/** Units for one merchant from the store mappings (pure: no database, no Clover). */
export function countExtraBrands(stores: Array<Pick<ChannelStore, 'channel' | 'brandName' | 'cloverMerchantId'> & { createdAt?: string | null }>, input: CountInput): ExtraBrandCount {
  const mid = input.merchantId;
  const byBrand = new Map<string, { platforms: Set<BilledPlatform>; first: number }>();
  for (const s of stores) {
    if (!isBilledPlatform(s.channel)) continue;
    if ((s.cloverMerchantId || input.defaultMerchant || null) !== mid) continue;
    const brand = String(s.brandName || '').trim();
    if (!brand || input.inactiveBrands?.has(brand)) continue;
    const cur = byBrand.get(brand) ?? { platforms: new Set<BilledPlatform>(), first: Number.POSITIVE_INFINITY };
    cur.platforms.add(s.channel);
    const at = ms(s.createdAt ?? null);
    if (at !== null && at < cur.first) cur.first = at;
    byBrand.set(brand, cur);
  }
  const names = [...byBrand.keys()].sort((a, b) => {
    const d = byBrand.get(a)!.first - byBrand.get(b)!.first;
    return Number.isNaN(d) || d === 0 ? a.localeCompare(b, 'fr') : d;
  });
  const primary = input.primaryBrand && byBrand.has(input.primaryBrand) ? input.primaryBrand : null;
  const firstBrand = primary ?? names[0] ?? null;
  const ordered = firstBrand ? [firstBrand, ...names.filter((n) => n !== firstBrand)] : names;
  const brands: BrandLine[] = ordered.map((brand) => {
    const b = byBrand.get(brand)!;
    const platforms = BILLED_PLATFORMS.filter((p) => b.platforms.has(p));
    const extra = brand !== firstBrand;
    return { brand, platforms, firstStoreAt: Number.isFinite(b.first) ? new Date(b.first).toISOString() : null, extra, units: extra ? platforms.length : 0 };
  });
  const units = brands.reduce((n, b) => n + b.units, 0);
  return { merchantId: mid, firstBrand, firstBrandSource: firstBrand ? (primary ? 'owner' : 'oldest') : null, brands, units, monthlyCad: extraBrandsMonthlyCad(units) };
}

interface CountContext { stores: ChannelStore[]; defaultMerchant: string | null; inactiveBrands: Set<string>; primary: Record<string, string> }

/**
 * Everything a count needs. `strict` (the billing run): a failed read of the catalog (deactivated brands) or of the
 * « marque principale » marks throws, so the run records nothing rather than a higher count from defaults (the month
 * keeps its highest count). The read-only quote and the dry run stay forgiving. A failed default-merchant read only
 * leaves stores out, which can never raise a count.
 */
async function countContext(opts: { strict?: boolean } = {}): Promise<CountContext> {
  const strict = Boolean(opts.strict);
  const [stores, catalog, defaultMerchant, primary] = await Promise.all([
    getRepo().listStores(),
    strict ? getCatalog({ strict: true }) : getCatalog().catch(() => ({ brands: [], locations: [] })),
    defaultCloverMerchant().catch(() => null),
    primaryBrands({ strict }),
  ]);
  return { stores, defaultMerchant, inactiveBrands: new Set(catalog.brands.filter((b) => !b.active).map((b) => b.name)), primary };
}

function countFor(mid: string, ctx: CountContext, stores: CountContext['stores'] = ctx.stores): ExtraBrandCount {
  return countExtraBrands(stores, { merchantId: mid, defaultMerchant: ctx.defaultMerchant, inactiveBrands: ctx.inactiveBrands, primaryBrand: ctx.primary[mid] ?? null });
}

/** Units for one merchant right now. */
export async function computeExtraBrands(merchantId: string): Promise<ExtraBrandCount> {
  return countFor(merchantId, await countContext());
}

/** The brand each merchant's owner marked "marque principale" (included in the subscription). `strict`: a failed read throws. */
export async function primaryBrands(opts: { strict?: boolean } = {}): Promise<Record<string, string>> {
  const read = getRepo().getKv<Record<string, string>>(PRIMARY_KEY);
  return (await (opts.strict ? read : read.catch(() => null))) ?? {};
}

/**
 * Mark (or clear, with null) a merchant's first brand. It applies to the count from now on: the current month keeps
 * the highest count already seen (see recordCount), so the change lowers the bill from next month.
 */
export async function setPrimaryBrand(merchantId: string, brandName: string | null, actor = 'owner'): Promise<Record<string, string>> {
  const mid = String(merchantId || '').trim();
  if (!mid) throw new Error('merchantId is required.');
  const all = { ...(await primaryBrands({ strict: true })) }; // a failed read must never wipe the other merchants' marks
  const brand = brandName ? String(brandName).trim().slice(0, 120) : '';
  if (brand) all[mid] = brand; else delete all[mid];
  await getRepo().setKv(PRIMARY_KEY, all);
  await logActivity({ actor, source: 'dashboard', kind: 'settings', action: 'clover_primary_brand', status: 'success',
    summary: brand ? `Main brand for Clover merchant ${mid}: ${brand} (included in the subscription).` : `Main brand for Clover merchant ${mid} cleared: the oldest brand is included.` });
  return all;
}

// ---------- 3. Monthly report ----------

export type ReportState = 'sending' | 'reported' | 'retry' | 'failed' | 'uncertain' | 'zero' | 'skipped';

export interface ExtraBrandPeriod {
  merchantId: string;
  month: string;
  /** Highest unit count seen this month while the subscription was paid. */
  units: number;
  /** The brands at that count. */
  brands: BrandLine[];
  firstBrand: string | null;
  checks: number;
  lastCheckAt: string | null;
  report?: { state: ReportState; count: number; attempts: number; at: string; httpStatus?: number | null; reason?: string | null } | null;
}

export type BillingLogEvent = 'units_changed' | 'reported' | 'refused' | 'failed' | 'uncertain' | 'zero' | 'skipped';
export interface BillingLogEntry {
  at: string;
  merchantId: string;
  month: string;
  event: BillingLogEvent;
  units: number;
  amountCad: number;
  detail?: string;
}

export async function billingLog(limit = 50): Promise<BillingLogEntry[]> {
  const all = (await getRepo().getKv<BillingLogEntry[]>(LOG_KEY).catch(() => null)) ?? [];
  return all.slice(-Math.max(1, limit)).reverse();
}

let logChain: Promise<unknown> = Promise.resolve();
function addLog(e: BillingLogEntry): Promise<void> {
  const next = logChain.catch(() => undefined).then(async () => {
    const all = (await getRepo().getKv<BillingLogEntry[]>(LOG_KEY).catch(() => null)) ?? [];
    all.push(e);
    await getRepo().setKv(LOG_KEY, all.slice(-LOG_MAX));
  });
  logChain = next;
  return next.catch(() => undefined) as Promise<void>;
}

/** One run per merchant at a time in this process (the month record is read, changed, written). */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  locks.set(key, next);
  void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => undefined);
  return next;
}

async function readPeriod(mid: string, month: string): Promise<ExtraBrandPeriod | null> {
  return getRepo().getKv<ExtraBrandPeriod>(periodKey(mid, month)).catch(() => null);
}

function apiBase() { return stripSlash(process.env.CLOVER_BASE_URL || 'https://api.clover.com'); }

export function meteredPath(merchantId: string, count: number, meteredId = extraBrandMeteredId() || '{meteredId}', appId = cloverApp('foodhub').appId || '{appId}'): string {
  return `/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(merchantId)}/metereds/${encodeURIComponent(meteredId)}?count=${count}`;
}

/** Network errors raised before anything reached Clover (no connection was made): safe to send again. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

export type MeteredOutcome = { ok: boolean; status: number; uncertain: boolean; reason: string | null };

/**
 * Sort a metered answer (or thrown error) into sent / refused / uncertain. Only answers that show Clover did NOT
 * process the request are tried again: a 4xx (429 included: Clover's rate limit) or a connection refused before
 * sending. A timeout, any other thrown error (socket reset, "fetch failed") and any 5xx or 408 may have been recorded
 * by Clover: uncertain, never sent again automatically (the owner checks it in Clover).
 */
export function meteredOutcome(r: { status: number } | { error: unknown }): MeteredOutcome {
  if ('status' in r) {
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, uncertain: false, reason: null };
    if (r.status === 408 || r.status >= 500) return { ok: false, status: r.status, uncertain: true, reason: `http_${r.status}` };
    return { ok: false, status: r.status, uncertain: false, reason: `http_${r.status}` };
  }
  const e = r.error as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return { ok: false, status: 0, uncertain: true, reason: 'timeout' };
  const code = e?.cause?.code ?? e?.code ?? '';
  if (NOT_SENT_CODES.has(code)) return { ok: false, status: 0, uncertain: false, reason: code.toLowerCase() };
  return { ok: false, status: 0, uncertain: true, reason: code ? code.toLowerCase() : 'network' };
}

/** Clover App Market metered event with a count. */
async function postMetered(mid: string, token: string, meteredId: string, count: number): Promise<MeteredOutcome> {
  try {
    const res = await cloverFetch(`${apiBase()}${meteredPath(mid, count, meteredId, cloverApp('foodhub').appId || '')}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    await res.body?.cancel().catch(() => undefined);
    return meteredOutcome({ status: res.status });
  } catch (e) {
    return meteredOutcome({ error: e });
  }
}

/** A "sending" mark (or send claim) younger than this belongs to a run still waiting for Clover's answer. */
export const SEND_STALE_MS = 5 * 60_000;
/** One atomic claim per merchant, month and try: two containers (rolling deploy) can never send the same try. */
const sendClaimKey = (mid: string, month: string, attempt: number) => `clover_extra_brands_send:${mid}:${month}:${attempt}`;

/** Why a month will (or will not) be sent to Clover. */
export type DueWhy = 'ready' | 'off' | 'no_metered_id' | 'no_app_id' | 'exempt' | 'nothing_recorded' | 'zero' | 'reported' | 'failed' | 'uncertain' | 'sending' | 'not_due';

function dueWhy(rec: ExtraBrandPeriod | null, exempt: boolean): DueWhy {
  if (exempt) return 'exempt';
  if (!meteredBillingEnabled()) return 'off';
  if (!extraBrandMeteredId()) return 'no_metered_id';
  if (!cloverApp('foodhub').appId) return 'no_app_id';
  if (!rec) return 'nothing_recorded';
  const st = rec.report?.state;
  if (st === 'reported' || st === 'failed' || st === 'uncertain' || st === 'zero' || st === 'sending') return st;
  if (rec.units <= 0) return 'zero';
  return 'ready';
}

async function reportMonth(mid: string, month: string, now: number): Promise<ExtraBrandPeriod | null> {
  const repo = getRepo();
  const key = periodKey(mid, month);
  const rec = await readPeriod(mid, month);
  if (!rec) return null;
  const at = new Date(now).toISOString();
  const st = rec.report?.state;
  if (st === 'reported' || st === 'failed' || st === 'uncertain' || st === 'zero') return rec;
  const markInterrupted = async (count: number) => {
    rec.report = { ...(rec.report ?? { attempts: 0 }), count, state: 'uncertain', at, reason: 'interrupted' };
    await repo.setKv(key, rec);
    await addLog({ at, merchantId: mid, month, event: 'uncertain', units: count, amountCad: extraBrandsMonthlyCad(count), detail: 'A previous run stopped while sending: check the charge in Clover before sending it again.' });
    return rec;
  };
  if (st === 'sending') {
    // Another run (maybe another container) is waiting for Clover's answer: leave it alone.
    const sentAt = ms(rec.report!.at);
    if (sentAt !== null && now - sentAt >= 0 && now - sentAt < SEND_STALE_MS) return rec;
    // A run stopped while the request was out: Clover may have it. Never sent again automatically.
    return markInterrupted(rec.report!.count);
  }
  const count = Math.max(0, Math.floor(rec.units));
  const attempts = rec.report?.attempts ?? 0;
  if (count === 0) {
    rec.report = { state: 'zero', count: 0, attempts, at };
    await repo.setKv(key, rec);
    await addLog({ at, merchantId: mid, month, event: 'zero', units: 0, amountCad: 0, detail: 'No extra brand on a paid day this month: nothing sent.' });
    return rec;
  }
  const meteredId = extraBrandMeteredId()!;
  const token = await cloverAppToken('foodhub', mid, Math.floor(now / 1000)).catch(() => null);
  if (!token) {
    if (rec.report?.reason !== 'no_token') {
      await addLog({ at, merchantId: mid, month, event: 'skipped', units: count, amountCad: extraBrandsMonthlyCad(count), detail: 'No Clover token for this merchant (app uninstalled or reconnect needed): tried again on the next run.' });
    }
    rec.report = { state: 'skipped', count, attempts, at, reason: 'no_token' };
    await repo.setKv(key, rec);
    return rec;
  }
  // One atomic claim of this try in the database before anything goes out: a second container running the same
  // month at the same moment (rolling deploy) loses the claim and sends nothing.
  const claimKey = sendClaimKey(mid, month, attempts + 1);
  if (!(await repo.claimKv(claimKey, { at, count }))) {
    const claim = await repo.getKv<{ at?: string }>(claimKey).catch(() => null);
    const claimedAt = ms(claim?.at);
    if (claimedAt !== null && now - claimedAt >= 0 && now - claimedAt < SEND_STALE_MS) return rec; // the other run is on it
    return markInterrupted(count); // claimed long ago but never finished: Clover may have it
  }
  rec.report = { state: 'sending', count, attempts, at };
  await repo.setKv(key, rec); // saved before the request goes out: a lost answer never bills twice
  const r = await postMetered(mid, token, meteredId, count);
  const amountCad = extraBrandsMonthlyCad(count);
  if (r.ok) {
    rec.report = { state: 'reported', count, attempts: attempts + 1, at, httpStatus: r.status };
    await repo.setKv(key, rec);
    await addLog({ at, merchantId: mid, month, event: 'reported', units: count, amountCad, detail: `Sent to Clover: ${count} unit(s).` });
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_extra_brands_reported', status: 'success',
      summary: `Extra brands for ${month} sent to Clover for merchant ${mid}: ${count} unit(s) = $${amountCad} CAD, billed by Clover.` }).catch(() => undefined);
  } else if (r.uncertain) {
    rec.report = { state: 'uncertain', count, attempts: attempts + 1, at, httpStatus: r.status || null, reason: r.reason };
    await repo.setKv(key, rec);
    const what = r.reason === 'timeout' ? 'Clover did not answer in time' : r.status ? `Clover answered HTTP ${r.status} (it may still have recorded the charge)` : 'The connection broke after the request went out';
    await addLog({ at, merchantId: mid, month, event: 'uncertain', units: count, amountCad, detail: `${what}: the charge may have gone through. Not sent again: check it in Clover.` });
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_extra_brands_uncertain', status: 'failed',
      summary: `Extra-brand charge for ${month}, merchant ${mid}: ${what}. Not sent again — check it in the Clover dashboard.` }).catch(() => undefined);
  } else {
    const n = attempts + 1;
    const final = n >= MAX_REPORT_ATTEMPTS;
    rec.report = { state: final ? 'failed' : 'retry', count, attempts: n, at, httpStatus: r.status || null, reason: r.reason };
    await repo.setKv(key, rec);
    const why = r.status ? `Clover refused (HTTP ${r.status})` : `Clover could not be reached (${r.reason}), nothing was sent`;
    await addLog({ at, merchantId: mid, month, event: final ? 'failed' : 'refused', units: count, amountCad, detail: `${why}, try ${n} of ${MAX_REPORT_ATTEMPTS}${final ? ': given up.' : ': tried again on the next run.'}` });
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_extra_brands_failed', status: 'failed',
      summary: `${why} for the extra-brand charge of ${month}, merchant ${mid} (try ${n} of ${MAX_REPORT_ATTEMPTS}).` }).catch(() => undefined);
  }
  return rec;
}

/** Keep this month's highest paid count (only while the subscription is paid). */
async function recordCount(mid: string, month: string, count: ExtraBrandCount, paid: boolean, now: number): Promise<ExtraBrandPeriod> {
  const key = periodKey(mid, month);
  const at = new Date(now).toISOString();
  const rec: ExtraBrandPeriod = (await readPeriod(mid, month)) ?? { merchantId: mid, month, units: 0, brands: [], firstBrand: null, checks: 0, lastCheckAt: null, report: null };
  rec.checks += 1;
  rec.lastCheckAt = at;
  if (paid && count.units > rec.units) {
    const before = rec.units;
    rec.units = count.units;
    rec.brands = count.brands;
    rec.firstBrand = count.firstBrand;
    await addLog({ at, merchantId: mid, month, event: 'units_changed', units: count.units, amountCad: count.monthlyCad,
      detail: `Extra brands this month: ${before} → ${count.units} unit(s) (${count.brands.filter((b) => b.extra).map((b) => `${b.brand} × ${b.units}`).join(', ')}).` });
  }
  await getRepo().setKv(key, rec);
  return rec;
}

export interface RunResult {
  ran: boolean;
  reason?: string;
  month: string;
  /** Why no count was recorded this run (the brands or the main-brand marks could not be read). */
  countSkipped?: string;
  merchants: Array<{ merchantId: string; exempt: boolean; paid: boolean; units: number; counted?: boolean; reported?: ReportState | null }>;
}

/** Record this month's count and send last month's (OFF unless FOODHUB_CLOVER_METERED_ENABLED=true). */
export async function runExtraBrandBilling(opts: { now?: number } = {}): Promise<RunResult> {
  const now = opts.now ?? Date.now();
  const month = billingMonth(now);
  if (!meteredBillingEnabled()) return { ran: false, reason: 'FOODHUB_CLOVER_METERED_ENABLED is not true: nothing is sent to Clover.', month, merchants: [] };
  if (!extraBrandMeteredId()) return { ran: false, reason: 'CLOVER_METERED_EXTRA_BRAND_ID is not set.', month, merchants: [] };
  if (!cloverApp('foodhub').appId) return { ran: false, reason: 'CLOVER_CLIENT_ID is not set.', month, merchants: [] };
  const exempt = billingExemptMerchants();
  // A failed read of the brands or the main-brand marks: this run records no count (never a higher one from
  // defaults); last month's report still goes out from its saved record.
  const skipped: { error: string | null } = { error: null };
  const ctx = await countContext({ strict: true }).catch((e) => {
    skipped.error = e instanceof Error ? e.message : String(e);
    console.error('[foodhub] extra-brand billing: count skipped this run', skipped.error);
    return null;
  });
  const prev = previousBillingMonth(month);
  const out: RunResult['merchants'] = [];
  for (const mid of await connectedCloverMerchantIds('foodhub')) {
    if (exempt.has(mid)) { out.push({ merchantId: mid, exempt: true, paid: false, units: 0 }); continue; }
    const row = await withLock(mid, async () => {
      const status = await foodhubBillingStatus(mid, { now });
      const count = ctx ? countFor(mid, ctx) : null;
      if (count) await recordCount(mid, month, count, status.paid, now);
      const rec = await reportMonth(mid, prev, now);
      return { merchantId: mid, exempt: false, paid: status.paid, units: count?.units ?? 0, counted: Boolean(count), reported: rec?.report?.state ?? null };
    }).catch((e) => {
      console.error('[foodhub] extra-brand billing failed for a merchant', e instanceof Error ? e.message : e);
      return { merchantId: mid, exempt: false, paid: false, units: 0, reported: null };
    });
    out.push(row);
  }
  return { ran: true, month, merchants: out, ...(skipped.error ? { countSkipped: skipped.error } : {}) };
}

/** Called by the sync: runs at most once an hour, only when metered billing is on. */
export async function tickExtraBrandBilling(now = Date.now()): Promise<RunResult | null> {
  if (!meteredBillingEnabled()) return null;
  const last = await getRepo().getKv<{ at: string }>(TICK_KEY).catch(() => null);
  const lastAt = ms(last?.at);
  if (lastAt !== null && now - lastAt >= 0 && now - lastAt < BILLING_TICK_MS) return null;
  await getRepo().setKv(TICK_KEY, { at: new Date(now).toISOString() });
  return runExtraBrandBilling({ now });
}

// ---------- 4. Dry run ----------

export interface MerchantPreview {
  merchantId: string;
  name: string | null;
  exempt: boolean;
  status: FoodHubBillingStatus;
  firstBrandMarked: string | null;
  /** Count from the store mappings right now. */
  live: ExtraBrandCount;
  current: { month: string; units: number; amountCad: number; recorded: boolean };
  due: { month: string; units: number; amountCad: number; why: DueWhy; wouldSend: boolean; request: string | null; state: ReportState | null; at: string | null };
}

export interface BillingPreview {
  enabled: boolean;
  meteredIdSet: boolean;
  exemptCount: number;
  month: string;
  previousMonth: string;
  merchants: MerchantPreview[];
}

/** What each merchant would be billed, without writing anything or sending anything. */
export async function previewExtraBrandBilling(opts: { now?: number; refresh?: boolean } = {}): Promise<BillingPreview> {
  const now = opts.now ?? Date.now();
  const month = billingMonth(now);
  const prev = previousBillingMonth(month);
  const exempt = billingExemptMerchants();
  const ctx = await countContext();
  const conns = (await listCloverConnections('foodhub')).filter((c) => c.status === 'active');
  const merchants: MerchantPreview[] = [];
  for (const c of conns) {
    const mid = c.merchantId;
    const isExempt = exempt.has(mid);
    const [status, cur, last] = await Promise.all([foodhubBillingStatus(mid, { now, refresh: opts.refresh }), readPeriod(mid, month), readPeriod(mid, prev)]);
    const live = countFor(mid, ctx);
    const curUnits = isExempt ? 0 : Math.max(cur?.units ?? 0, status.paid ? live.units : 0);
    const why = dueWhy(last, isExempt);
    const dueUnits = isExempt ? 0 : last?.report?.count ?? last?.units ?? 0;
    const wouldSend = why === 'ready';
    merchants.push({
      merchantId: mid, name: c.name, exempt: isExempt, status, firstBrandMarked: ctx.primary[mid] ?? null, live,
      current: { month, units: curUnits, amountCad: extraBrandsMonthlyCad(curUnits), recorded: Boolean(cur) },
      due: { month: prev, units: dueUnits, amountCad: extraBrandsMonthlyCad(dueUnits), why, wouldSend, request: wouldSend ? `POST ${meteredPath(mid, dueUnits)}` : null, state: last?.report?.state ?? null, at: last?.report?.at ?? null },
    });
  }
  return { enabled: meteredBillingEnabled(), meteredIdSet: Boolean(extraBrandMeteredId()), exemptCount: exempt.size, month, previousMonth: prev, merchants };
}

// ---------- 5. Price notice ----------

export interface ExtraBrandQuote {
  /** Show the price before confirming. */
  applies: boolean;
  reason: 'extra' | 'first_brand' | 'already_counted' | 'not_billed_platform' | 'no_merchant' | 'not_app_merchant' | 'exempt' | 'no_brand_yet';
  addedUnits: number;
  addedCad: number;
  unitsAfter: number;
  monthlyAfterCad: number;
  firstBrand: string | null;
  /** The brands that become billed, and on which platforms (for the wording). */
  lines: ExtraUnitLine[];
  text: Bilingual | null;
}

/** One store being connected (or edited: `storeId`), for the price notice. */
export interface QuoteStore { brandName: string; channel?: string | null; merchantId?: string | null; storeId?: string | null }

const noQuote = (reason: ExtraBrandQuote['reason'], firstBrand: string | null = null): ExtraBrandQuote =>
  ({ applies: false, reason, addedUnits: 0, addedCad: 0, unitsAfter: 0, monthlyAfterCad: 0, firstBrand, lines: [], text: null });

/**
 * The extra monthly cost of connecting one store (brand + platform [+ merchant]), or — without a platform — of adding a
 * new brand. Only for merchants that installed the Food Hub app from the Clover App Market and are not exempt.
 */
export async function quoteExtraBrand(q: QuoteStore): Promise<ExtraBrandQuote> {
  if (!q.channel) return quoteNewBrand(q.brandName, q.merchantId);
  return quoteExtraStores([q]);
}

/**
 * A new brand (Business setup). Brands are not tied to a merchant there: with `merchantId`, the quote is for that
 * merchant only; without one, the notice is worded as a condition ("if it is not the first brand on your merchant").
 */
async function quoteNewBrand(brandName: string, merchantId?: string | null): Promise<ExtraBrandQuote> {
  const brand = String(brandName || '').trim();
  const exempt = billingExemptMerchants();
  const ctx = await countContext();
  const appMerchants = new Set(await connectedCloverMerchantIds('foodhub').catch(() => [] as string[]));
  const mid = String(merchantId || '').trim();
  if (mid) {
    if (exempt.has(mid)) return noQuote('exempt');
    if (!appMerchants.has(mid)) return noQuote('not_app_merchant');
    const c = countFor(mid, ctx);
    if (!c.firstBrand) return noQuote('no_brand_yet');
    if (c.firstBrand === brand) return noQuote('first_brand', brand);
    return { ...noQuote('extra', c.firstBrand), applies: true, text: { fr: extraBrandNotice('fr'), en: extraBrandNotice('en') } };
  }
  const billable = [...appMerchants].filter((m) => !exempt.has(m));
  if (!billable.length) return noQuote('not_app_merchant');
  const withBrand = billable.map((m) => countFor(m, ctx)).filter((c) => c.firstBrand && c.firstBrand !== brand);
  if (!withBrand.length) return noQuote('no_brand_yet');
  return { ...noQuote('extra', withBrand[0].firstBrand), applies: true, text: { fr: extraBrandNotice('fr', { conditional: true }), en: extraBrandNotice('en', { conditional: true }) } };
}

/**
 * Several stores connected together (Uber activation): every store is added to the mappings at once, then each
 * merchant's count is compared before / after once — so two brands going live on a merchant with no brand yet show
 * the second one as extra, and the total is worded by brand and platform.
 */
export async function quoteExtraStores(list: QuoteStore[]): Promise<ExtraBrandQuote> {
  const exempt = billingExemptMerchants();
  const ctx = await countContext();
  const appMerchants = new Set(await connectedCloverMerchantIds('foodhub').catch(() => [] as string[]));
  const items = list.map((q) => ({ ...q, brandName: String(q.brandName || '').trim() })).filter((q) => q.brandName);
  if (!items.length) return noQuote('no_brand_yet');
  let firstSkip: ExtraBrandQuote['reason'] | null = null;
  const byMerchant = new Map<string, typeof items>();
  for (const q of items) {
    const mid = String(q.merchantId || '').trim() || ctx.defaultMerchant;
    const skip: ExtraBrandQuote['reason'] | null = !isBilledPlatform(q.channel) ? 'not_billed_platform'
      : !mid ? 'no_merchant' : exempt.has(mid) ? 'exempt' : !appMerchants.has(mid) ? 'not_app_merchant' : null;
    if (skip) { firstSkip ??= skip; continue; }
    byMerchant.set(mid!, [...(byMerchant.get(mid!) ?? []), q]);
  }
  if (!byMerchant.size) return noQuote(firstSkip ?? 'not_billed_platform');
  const at = new Date().toISOString();
  let added = 0;
  let unitsAfter = 0;
  let firstBrand: string | null = null;
  const lines: ExtraUnitLine[] = [];
  for (const [mid, qs] of byMerchant) {
    const edited = new Set(qs.map((q) => q.storeId).filter(Boolean));
    const others = ctx.stores.filter((s) => !edited.has(s.id));
    const hypothetical = qs.map((q, i) => ({ id: `quote-${i}`, channel: q.channel, brandName: q.brandName, cloverMerchantId: mid, createdAt: at }) as ChannelStore);
    const before = countFor(mid, ctx);
    const after = countFor(mid, ctx, [...others, ...hypothetical]);
    added += after.units - before.units;
    unitsAfter += after.units;
    firstBrand ??= after.firstBrand;
    for (const b of after.brands) {
      const was = before.brands.find((x) => x.brand === b.brand);
      if (b.units <= (was?.units ?? 0)) continue;
      const platforms = was?.extra ? b.platforms.filter((p) => !was.platforms.includes(p)) : b.platforms;
      if (platforms.length) lines.push({ brand: b.brand, platforms });
    }
  }
  const monthlyAfterCad = extraBrandsMonthlyCad(unitsAfter);
  if (added <= 0) {
    const brand = items[0].brandName;
    return { ...noQuote(firstBrand === brand ? 'first_brand' : 'already_counted', firstBrand), unitsAfter, monthlyAfterCad };
  }
  return {
    applies: true, reason: 'extra', addedUnits: added, addedCad: extraBrandsMonthlyCad(added), unitsAfter, monthlyAfterCad, firstBrand, lines,
    text: { fr: extraUnitsNotice('fr', added, lines), en: extraUnitsNotice('en', added, lines) },
  };
}
