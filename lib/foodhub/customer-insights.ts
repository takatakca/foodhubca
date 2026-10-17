// Customer insights: new / occasional / frequent customers across every delivery platform AND the restaurant's own
// direct orders (phone, AI phone, website, Clover). One phone number is one customer across all direct sources.
// Privacy: raw customer keys, names, phones, emails, addresses and raw payloads never leave this module. The result
// only carries aggregates and anonymous `c_…` ids (HMAC of the tenant + key, under a key derived for this purpose
// only). Read-only: nothing is sent anywhere.
//
// Definitions (period = [from, to)):
//   new         no counted order in the 180 days before `from`
//   frequent    4+ counted orders in [min(from, to − 90 d), to)   (a period longer than 90 days: the whole period)
//   occasional  any other returning customer
//   lapsed      ordered in the 90 days before `from`, not in the period
// Counted = a platform order that is not cancelled, or a direct order that is neither cancelled nor still waiting for
// its payment link (an unpaid pay-link order was never cooked or paid).
import crypto from 'node:crypto';
import { CHANNEL_LABELS } from './config';
import { DIRECT_ORDERS } from './delivery/store';
import type { DirectOrder } from './delivery/types';
import { customerKey } from './analytics';
import { localDate } from './hours';
import { getRepo, type Doc } from './repo';
import { ROW_CAP } from './reports';
import { tenantId } from './tenant';
import { foodhubTimeZone } from './time';
import type { ChannelKey, StoredOrder } from './types';

export type DirectMode = 'include' | 'exclude' | 'only';
export const DIRECT_MODES: readonly DirectMode[] = ['include', 'exclude', 'only'];
export type CustomerTier = 'new' | 'occasional' | 'frequent';
export type InsightChannel = ChannelKey | 'direct';

export interface CustomerInsightsQuery {
  from: string;
  to: string;
  locationCodes?: string[];
  channels?: ChannelKey[];
  brands?: string[];
  /** Default: include when no platform is picked, exclude when platforms are picked. */
  direct?: DirectMode;
}

const DAY = 86400_000;
/** No counted order in this many days before the period = a new customer. */
const NEW_LOOKBACK_DAYS = 180;
/** Window used to count orders for occasional vs frequent, and to find lapsed customers. */
const WINDOW_DAYS = 90;
/** Orders in the window that make a customer frequent. */
const FREQUENT_MIN_ORDERS = 4;
const TOP_N = 20;
const UNMAPPED_BRAND = 'Unmapped store';
const DIRECT_LABEL = 'Direct orders';

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A direct order counts once it is real: not cancelled, and not a pay-link order that was never paid. */
export const COUNTED_DIRECT = (o: Pick<DirectOrder, 'status'>) => o.status !== 'cancelled' && o.status !== 'awaiting_payment';

// ---------- identity ----------

/** Digits only; a North-American 11-digit number loses its leading 1; anything but 10 digits is no phone. */
export function normalizePhone(phone: string | null | undefined): string | null {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** Shared key space for every direct source (phone, AI phone, website, Clover, manual): phone first, then e-mail. */
export function directCustomerKey(o: { customer?: { phone?: string | null; email?: string | null } | null }): string | null {
  const tel = normalizePhone(o.customer?.phone);
  if (tel) return `direct:tel:${tel}`;
  const mail = String(o.customer?.email ?? '').trim().toLowerCase();
  return mail.includes('@') ? `direct:mail:${mail}` : null;
}

const HASH_INFO = 'takatak-customer-hash-v1';
const DEV_HASH_KEY = Buffer.from('takatak-dev-only-customer-hash');
const derivedHashKeys = new Map<string, Buffer>();

/**
 * Key behind the anonymous ids, never a raw secret: with SESSION_SECRET, HMAC(SESSION_SECRET, purpose) (domain
 * separation from the session cookies); with only DASHBOARD_PASSWORD, scrypt(password, purpose) like session.ts, so a
 * c_ id of a known phone is not a fast offline oracle for the owner password. Dev fallback outside production only.
 */
function hashKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  const password = process.env.DASHBOARD_PASSWORD;
  const cacheKey = secret ? `s:${secret}` : password ? `p:${password}` : '';
  if (!cacheKey) {
    if (process.env.NODE_ENV !== 'production') return DEV_HASH_KEY;
    throw new Error('Customer insights need SESSION_SECRET or DASHBOARD_PASSWORD on the server.');
  }
  let key = derivedHashKeys.get(cacheKey);
  if (!key) {
    key = secret ? crypto.createHmac('sha256', secret).update(HASH_INFO).digest() : crypto.scryptSync(password!, HASH_INFO, 32);
    derivedHashKeys.clear(); // only the current secret matters
    derivedHashKeys.set(cacheKey, key);
  }
  return key;
}

/** Anonymous, stable id for one customer key: `c_` + 12 hex characters of HMAC-SHA256(derived key, tenant|key). */
export function hashCustomerKey(key: string): string {
  return `c_${crypto.createHmac('sha256', hashKey()).update(`${tenantId()}|${key}`).digest('hex').slice(0, 12)}`;
}

/** Tier of a customer who ordered in the period. */
export function tierOf(input: { hasOrderBefore: boolean; ordersInWindow: number }): CustomerTier {
  if (!input.hasOrderBefore) return 'new';
  return input.ordersInWindow >= FREQUENT_MIN_ORDERS ? 'frequent' : 'occasional';
}

// ---------- build ----------

/** One counted order, reduced to what the analysis needs (no personal data). */
interface Rec { key: string | null; channel: InsightChannel; brand: string | null; t: number; sales: number }

export function resolveDirectMode(q: Pick<CustomerInsightsQuery, 'direct' | 'channels'>): DirectMode {
  return q.direct ?? (q.channels?.length ? 'exclude' : 'include');
}

export interface BuildOptions {
  /** Row cap per list (tests lower it to exercise truncation). */
  rowCap?: number;
}

/**
 * Pure function of [from, to) and the stored orders: the result does not depend on today's date. The second argument
 * also accepts a number (`now`, the spec's call shape); it is ignored because nothing here reads the clock.
 */
export async function buildCustomerInsights(q: CustomerInsightsQuery, opts: BuildOptions | number = {}) {
  const tz = foodhubTimeZone();
  const cap = (typeof opts === 'number' ? undefined : opts.rowCap) ?? ROW_CAP;
  const from = Date.parse(q.from);
  const to = Date.parse(q.to);
  const days = Math.max(1, Math.round((to - from) / DAY));
  const historyFrom = from - NEW_LOOKBACK_DAYS * DAY;
  const windowFrom = Math.min(from, to - WINDOW_DAYS * DAY);
  const lapsedFrom = from - WINDOW_DAYS * DAY;
  const mode = resolveDirectMode(q);
  const locs = q.locationCodes?.length ? q.locationCodes : undefined;
  const none = !!locs && locs.every((c) => c === '__none__');

  const repo = getRepo();
  const since = new Date(historyFrom).toISOString();
  const until = new Date(to).toISOString();
  const noRows = <T,>() => Promise.resolve([] as T[]);
  // Shared reads only (repo.listOrders + analytics.customerKey, repo.listDocs): direct orders carry no indexed kitchen
  // column, so their kitchen filter runs below, after the row cap (other kitchens' rows count toward it).
  const [platformRaw, directDocs] = await Promise.all([
    none || mode === 'only' ? noRows<StoredOrder>() : repo.listOrders({ since, until, limit: cap, locationCodes: locs }),
    none || mode === 'exclude' ? noRows<Doc<Partial<DirectOrder>>>() : repo.listDocs<Partial<DirectOrder>>(DIRECT_ORDERS, { since, until, limit: cap }),
  ]);

  // Lists are newest first and capped: when one hits the cap, only orders from its oldest row onward are complete.
  let coveredFrom = historyFrom;
  if (platformRaw.length >= cap) coveredFrom = Math.max(coveredFrom, Date.parse(platformRaw[platformRaw.length - 1].createdAt) || to);
  if (directDocs.length >= cap) { const d = directDocs[directDocs.length - 1]; coveredFrom = Math.max(coveredFrom, Date.parse(d.at ?? d.data?.createdAt ?? '') || to); }
  const truncated = platformRaw.length >= cap || directDocs.length >= cap;

  const brandOk = (b: string | null | undefined) => !q.brands?.length || (b ? q.brands.includes(b) : false);
  const recs: Rec[] = [];
  for (const o of platformRaw) {
    if (o.status === 'cancelled') continue;
    if (q.channels?.length && !q.channels.includes(o.channel)) continue;
    if (!brandOk(o.brandName)) continue;
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    recs.push({ key: customerKey(o), channel: o.channel, brand: o.brandName ?? null, t, sales: num(o.total) });
  }
  for (const d of directDocs) {
    const o = d.data;
    if (!o || !COUNTED_DIRECT(o as Pick<DirectOrder, 'status'>)) continue;
    if (locs && !locs.includes(String(o.locationCode ?? ''))) continue;
    if (!brandOk(o.brandName)) continue;
    const t = Date.parse(o.createdAt ?? d.at ?? '');
    if (!Number.isFinite(t)) continue;
    recs.push({ key: directCustomerKey(o), channel: 'direct', brand: o.brandName || null, t, sales: num(o.total) });
  }

  // Per-key history
  type Cust = { period: Rec[]; sales: number; before180: number; inWindow: number; lapsedOrders: number; lapsedSales: number };
  const custs = new Map<string, Cust>();
  const cust = (k: string) => custs.get(k) ?? custs.set(k, { period: [], sales: 0, before180: 0, inWindow: 0, lapsedOrders: 0, lapsedSales: 0 }).get(k)!;
  const period: Rec[] = [];
  for (const r of recs) {
    const inPeriod = r.t >= from && r.t < to;
    if (inPeriod) period.push(r);
    if (!r.key) continue;
    const c = cust(r.key);
    if (inPeriod) { c.period.push(r); c.sales += r.sales; }
    if (r.t >= historyFrom && r.t < from) c.before180++;
    if (r.t >= windowFrom && r.t < to) c.inWindow++;
    if (r.t >= lapsedFrom && r.t < from) { c.lapsedOrders++; c.lapsedSales += r.sales; }
  }

  const tierByKey = new Map<string, CustomerTier>();
  for (const [k, c] of custs) if (c.period.length) tierByKey.set(k, tierOf({ hasOrderBefore: c.before180 > 0, ordersInWindow: c.inWindow }));

  // Totals
  const sum = (xs: Rec[]) => xs.reduce((s, r) => s + r.sales, 0);
  const identified = period.filter((r) => r.key);
  const salesAll = sum(period);
  const identifiedSales = sum(identified);
  const customers = tierByKey.size;
  const totals = {
    customers,
    orders: period.length,
    sales: r2(salesAll),
    identifiedOrders: identified.length,
    identifiedSales: r2(identifiedSales),
    coveragePct: pct(identified.length, period.length),
    unidentifiedOrders: period.length - identified.length,
    unidentifiedSales: r2(salesAll - identifiedSales),
  };

  // Tiers
  const tierStat = (tier: CustomerTier) => {
    let n = 0; let orders = 0; let sales = 0;
    for (const [k, tr] of tierByKey) if (tr === tier) { const c = custs.get(k)!; n++; orders += c.period.length; sales += c.sales; }
    return { customers: n, pctCustomers: pct(n, customers), orders, sales: r2(sales), pctSales: pct(sales, identifiedSales), aov: orders ? r2(sales / orders) : 0 };
  };
  const tiers = { new: tierStat('new'), occasional: tierStat('occasional'), frequent: tierStat('frequent') };
  const repeatRate = pct(tiers.occasional.customers + tiers.frequent.customers, customers);

  // Lapsed: ordered in the 90 days before the period, not in it
  let lapsedN = 0; let lapsedSales = 0;
  for (const c of custs.values()) if (c.lapsedOrders > 0 && c.period.length === 0) { lapsedN++; lapsedSales += c.lapsedSales; }
  const lapsed = { customers: lapsedN, salesBefore: r2(lapsedSales) };

  // Multi-brand customers in the period
  let multiN = 0; let multiSales = 0;
  for (const k of tierByKey.keys()) {
    const c = custs.get(k)!;
    if (new Set(c.period.map((r) => r.brand).filter(Boolean)).size >= 2) { multiN++; multiSales += c.sales; }
  }
  const multiBrand = { customers: multiN, pct: pct(multiN, customers), sales: r2(multiSales) };

  // Breakdowns
  const tierCounts = (keys: Set<string>) => {
    const out = { new: 0, occasional: 0, frequent: 0 };
    for (const k of keys) out[tierByKey.get(k)!]++;
    return out;
  };
  const chanMap = new Map<InsightChannel, { orders: number; identifiedOrders: number; sales: number; keys: Set<string> }>();
  const brandMap = new Map<string, { sales: number; keys: Set<string> }>();
  for (const r of period) {
    const ch = chanMap.get(r.channel) ?? chanMap.set(r.channel, { orders: 0, identifiedOrders: 0, sales: 0, keys: new Set() }).get(r.channel)!;
    ch.orders++; ch.sales += r.sales;
    if (r.key) { ch.identifiedOrders++; ch.keys.add(r.key); }
    const bName = r.brand || UNMAPPED_BRAND;
    const b = brandMap.get(bName) ?? brandMap.set(bName, { sales: 0, keys: new Set() }).get(bName)!;
    b.sales += r.sales;
    if (r.key) b.keys.add(r.key);
  }
  const byChannel = [...chanMap.entries()].map(([key, c]) => ({
    key, label: key === 'direct' ? DIRECT_LABEL : CHANNEL_LABELS[key],
    orders: c.orders, identifiedOrders: c.identifiedOrders, coveragePct: pct(c.identifiedOrders, c.orders),
    customers: c.keys.size, ...tierCounts(c.keys), sales: r2(c.sales),
  })).sort((a, b) => b.sales - a.sales || a.label.localeCompare(b.label));
  const byBrand = [...brandMap.entries()].map(([brand, b]) => {
    const tc = tierCounts(b.keys);
    // `unmapped`: orders with no brand (the page labels that row in the viewer's language).
    return { brand, unmapped: brand === UNMAPPED_BRAND, customers: b.keys.size, ...tc, repeatRate: pct(tc.occasional + tc.frequent, b.keys.size), sales: r2(b.sales) };
  }).sort((a, b) => b.sales - a.sales || a.brand.localeCompare(b.brand));

  // Top customers (anonymous ids only): rank first, then hash and describe only the TOP_N kept.
  const ranked = [...tierByKey.keys()]
    .map((k) => ({ k, c: custs.get(k)! }))
    .sort((a, b) => b.c.sales - a.c.sales || b.c.period.length - a.c.period.length || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, TOP_N);
  const top = ranked.map(({ k, c }) => {
    let first = Infinity; let last = -Infinity;
    for (const r of c.period) { if (r.t < first) first = r.t; if (r.t > last) last = r.t; }
    return {
      id: hashCustomerKey(k), tier: tierByKey.get(k)!, orders: c.period.length, sales: r2(c.sales), aov: r2(c.sales / c.period.length),
      firstOrder: localDate(first, tz), lastOrder: localDate(last, tz),
      channels: [...new Set(c.period.map((r) => r.channel))].sort() as InsightChannel[],
      brands: [...new Set(c.period.map((r) => r.brand).filter((b): b is string => Boolean(b)))].sort(),
    };
  });

  return {
    range: {
      from: new Date(from).toISOString(), to: new Date(to).toISOString(), days, timezone: tz,
      /** A list hit the row cap: the oldest orders were left out. */
      truncated,
      /** Every order of the period itself was loaded. */
      periodComplete: coveredFrom <= from,
      /** The 180-day history before the period was fully loaded (else new / lapsed are approximate). */
      historyComplete: coveredFrom <= historyFrom,
    },
    direct: mode,
    totals,
    tiers,
    repeatRate,
    lapsed,
    multiBrand,
    byChannel,
    byBrand,
    top,
    definitions: { newLookbackDays: NEW_LOOKBACK_DAYS, windowDays: WINDOW_DAYS, frequentMinOrders: FREQUENT_MIN_ORDERS },
  };
}

export type CustomerInsights = Awaited<ReturnType<typeof buildCustomerInsights>>;
