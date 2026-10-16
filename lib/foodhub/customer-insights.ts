// Customer insights: new / occasional / frequent customers across every delivery platform AND the restaurant's own
// direct orders (phone, AI phone, website, Clover). One phone number is one customer across all direct sources.
// Privacy: raw customer keys, names, phones, emails, addresses and raw payloads never leave this module. The result
// only carries aggregates and anonymous `c_…` ids (HMAC of the tenant + key). Read-only: nothing is sent anywhere.
import crypto from 'node:crypto';
import { customerKey } from './analytics';
import { CHANNEL_LABELS } from './config';
import { DIRECT_ORDERS } from './delivery/store';
import type { DirectOrder } from './delivery/types';
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

function hashSecret(): string {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD || 'takatak-dev-only-customer-hash';
}

/** Anonymous, stable id for one customer key: `c_` + 12 hex characters of HMAC-SHA256(secret, tenant|key). */
export function hashCustomerKey(key: string): string {
  return `c_${crypto.createHmac('sha256', hashSecret()).update(`${tenantId()}|${key}`).digest('hex').slice(0, 12)}`;
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

export async function buildCustomerInsights(q: CustomerInsightsQuery, now = Date.now()) {
  const tz = foodhubTimeZone();
  const from = Date.parse(q.from);
  const to = Date.parse(q.to);
  const days = Math.max(1, Math.round((to - from) / DAY));
  const end = Math.min(to, Math.max(now, from + 1)); // the frequency window ends today for a period still running
  const historyFrom = from - NEW_LOOKBACK_DAYS * DAY;
  const windowFrom = Math.min(from, end - WINDOW_DAYS * DAY);
  const lapsedFrom = from - WINDOW_DAYS * DAY;
  const mode = resolveDirectMode(q);
  const none = q.locationCodes?.includes('__none__') && q.locationCodes.every((c) => c === '__none__');

  const repo = getRepo();
  const since = new Date(historyFrom).toISOString();
  const until = new Date(to).toISOString();
  const noRows = <T,>() => Promise.resolve([] as T[]);
  const [platformRaw, directDocs] = await Promise.all([
    none || mode === 'only' ? noRows<StoredOrder>() : repo.listOrders({ since, until, limit: ROW_CAP, locationCodes: q.locationCodes?.length ? q.locationCodes : undefined }),
    none || mode === 'exclude' ? noRows<Doc<DirectOrder>>() : repo.listDocs<DirectOrder>(DIRECT_ORDERS, { since, until, limit: ROW_CAP }),
  ]);
  const truncated = platformRaw.length >= ROW_CAP || directDocs.length >= ROW_CAP;

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
    if (!o || o.status === 'cancelled') continue;
    if (q.locationCodes?.length && !q.locationCodes.includes(o.locationCode)) continue;
    if (!brandOk(o.brandName)) continue;
    const t = Date.parse(o.createdAt ?? d.at ?? '');
    if (!Number.isFinite(t)) continue;
    recs.push({ key: directCustomerKey(o), channel: 'direct', brand: o.brandName || null, t, sales: num(o.total) });
  }

  // Per-key history
  type Cust = { period: Rec[]; before180: number; inWindow: number; lapsedOrders: number; lapsedSales: number };
  const custs = new Map<string, Cust>();
  const cust = (k: string) => custs.get(k) ?? custs.set(k, { period: [], before180: 0, inWindow: 0, lapsedOrders: 0, lapsedSales: 0 }).get(k)!;
  const period: Rec[] = [];
  for (const r of recs) {
    const inPeriod = r.t >= from && r.t < to;
    if (inPeriod) period.push(r);
    if (!r.key) continue;
    const c = cust(r.key);
    if (inPeriod) c.period.push(r);
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
    for (const [k, tr] of tierByKey) if (tr === tier) { const c = custs.get(k)!; n++; orders += c.period.length; sales += sum(c.period); }
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
    if (new Set(c.period.map((r) => r.brand).filter(Boolean)).size >= 2) { multiN++; multiSales += sum(c.period); }
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
    const bName = r.brand ?? UNMAPPED_BRAND;
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
    return { brand, customers: b.keys.size, ...tc, repeatRate: pct(tc.occasional + tc.frequent, b.keys.size), sales: r2(b.sales) };
  }).sort((a, b) => b.sales - a.sales || a.brand.localeCompare(b.brand));

  // Top customers (anonymous ids only)
  const top = [...tierByKey.entries()].map(([k, tier]) => {
    const c = custs.get(k)!;
    const sales = sum(c.period);
    const ts = c.period.map((r) => r.t);
    return {
      id: hashCustomerKey(k), tier, orders: c.period.length, sales: r2(sales), aov: r2(sales / c.period.length),
      firstOrder: localDate(Math.min(...ts), tz), lastOrder: localDate(Math.max(...ts), tz),
      channels: [...new Set(c.period.map((r) => r.channel))].sort() as InsightChannel[],
      brands: [...new Set(c.period.map((r) => r.brand).filter((b): b is string => Boolean(b)))].sort(),
    };
  }).sort((a, b) => b.sales - a.sales || b.orders - a.orders || a.id.localeCompare(b.id)).slice(0, TOP_N);

  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days, timezone: tz, truncated },
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
