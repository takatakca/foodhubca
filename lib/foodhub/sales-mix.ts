// Sales mix: what sells, when and through which channel — every platform (Uber Eats, DoorDash, SkipTheDishes,
// Too Good To Go) AND our own direct orders (phone, AI phone, website, Clover, manual entry) in one view.
// The same dish is merged across channels (by its Clover item id, else by its normalised name, per brand).
// Breakdowns: by item, by local hour, by weekday (with the average per day), day × hour heatmap, by channel,
// by fulfillment (delivery / pickup / dine-in), by brand and by location, each compared with the previous period.
//
// "Sales" here = the order SUBTOTAL: food and drinks before tax, delivery fee, tip and platform fees (when a subtotal
// is missing: total − tax − delivery fee − tip). This differs from the Insights page (analytics.ts), which counts
// order TOTALS. Read-only: nothing is sent anywhere.
//
// Direct orders: an order still 'awaiting_payment' (phone order held until its payment link is paid) is not a sale
// and not a lost sale: it is left out. Their time is `placedAt` (the real order time: a Clover website order
// imported late keeps its Clover time), falling back to `createdAt`. Direct orders are stored by import time, so
// they are read up to DIRECT_IMPORT_SLACK_MS past the period end and then cut by their real order time.
// A phone cart with several brands is ONE direct order whose other brands' lines are named "[Brand] Dish": each
// brand gets its own lines (prefix removed) and its share of the subtotal, and the order is still counted once.
//
// Reads: the current and the previous period are read separately (each up to `cap` rows, newest first), so a busy
// current period never eats the comparison. `range.truncated` = the current period hit the cap (older orders of the
// period are missing); `range.previousIncomplete` = the previous period hit the cap. When either is true the change
// % are unreliable (`range.comparable` = false): the page hides them and the export leaves them blank.
// Limit: direct orders are stored without a location index, so a location filter on them runs in memory after the
// newest `cap` direct orders of every location are read. `truncated` can then be true because of other locations'
// orders: it means "some orders may be missing", never a false "complete".
import { getCatalog } from './catalog';
import { CHANNEL_LABELS } from './config';
import { DIRECT_ORDERS } from './delivery/store';
import type { DirectOrder } from './delivery/types';
import { localDate } from './hours';
import { getRepo } from './repo';
import { ROW_CAP, type TableData } from './reports';
import { foodhubTimeZone, localParts, startOfLocalDayMs } from './time';
import type { ChannelKey, Fulfillment, OrderLine, StoredOrder } from './types';

export type PlatformSource = ChannelKey;
export type DirectSourceKey = 'phone' | 'phone_ai' | 'website' | 'clover' | 'manual';
export type SourceKey = PlatformSource | DirectSourceKey;
export type SourceGroup = 'platform' | 'direct';
export type DirectMode = 'include' | 'exclude' | 'only';
export type SalesMixTableKey = 'items' | 'hours' | 'weekdays' | 'sources' | 'fulfillment';

export const PLATFORM_SOURCES: PlatformSource[] = ['uber_eats', 'doordash', 'skip', 'tgtg'];
export const DIRECT_SOURCES: DirectSourceKey[] = ['phone', 'phone_ai', 'website', 'clover', 'manual'];
export const SOURCE_KEYS: SourceKey[] = [...PLATFORM_SOURCES, ...DIRECT_SOURCES];
export const SALES_MIX_TABLES: SalesMixTableKey[] = ['items', 'hours', 'weekdays', 'sources', 'fulfillment'];
export const DIRECT_MODES: DirectMode[] = ['include', 'exclude', 'only'];

type Label = { fr: string; en: string };
export const SOURCE_LABELS: Record<SourceKey, Label> = {
  uber_eats: { fr: CHANNEL_LABELS.uber_eats, en: CHANNEL_LABELS.uber_eats },
  doordash: { fr: CHANNEL_LABELS.doordash, en: CHANNEL_LABELS.doordash },
  skip: { fr: CHANNEL_LABELS.skip, en: CHANNEL_LABELS.skip },
  tgtg: { fr: CHANNEL_LABELS.tgtg, en: CHANNEL_LABELS.tgtg },
  phone: { fr: 'Téléphone', en: 'Phone' },
  phone_ai: { fr: 'Téléphone IA', en: 'AI phone' },
  website: { fr: 'Site web', en: 'Website' },
  clover: { fr: 'Clover', en: 'Clover' },
  manual: { fr: 'Saisie manuelle', en: 'Manual entry' },
};
export const GROUP_LABELS: Record<SourceGroup, Label> = { platform: { fr: 'Plateforme', en: 'Platform' }, direct: { fr: 'Directe', en: 'Direct' } };
export const FULFILLMENT_LABELS: Record<Fulfillment, Label> = { delivery: { fr: 'Livraison', en: 'Delivery' }, pickup: { fr: 'À emporter', en: 'Pickup' }, dine_in: { fr: 'Sur place', en: 'Dine-in' } };
const UNMAPPED: Label = { fr: 'Non associé', en: 'Unmapped' };

export const isSourceKey = (k: unknown): k is SourceKey => typeof k === 'string' && (SOURCE_KEYS as string[]).includes(k);
export const isSalesMixTable = (k: unknown): k is SalesMixTableKey => typeof k === 'string' && (SALES_MIX_TABLES as string[]).includes(k);
export const isDirectMode = (k: unknown): k is DirectMode => typeof k === 'string' && (DIRECT_MODES as string[]).includes(k);

/** Platform channel → itself; direct order source → its channel ('clover_online' is the restaurant's website button). */
export function sourceOf(o: { channel: ChannelKey } | { source: DirectOrder['source'] }): SourceKey {
  if ('channel' in o) return o.channel;
  switch (o.source) {
    case 'phone': return 'phone';
    case 'phone_ai': return 'phone_ai';
    case 'website': case 'clover_online': return 'website';
    case 'clover': return 'clover';
    default: return 'manual';
  }
}
export const groupOf = (s: SourceKey): SourceGroup => ((PLATFORM_SOURCES as string[]).includes(s) ? 'platform' : 'direct');

const r2 = (n: number) => { const v = Math.round((Number(n) || 0) * 100) / 100; return Number.isFinite(v) ? v : 0; };
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);
/** Same rule as analytics.ts: no previous value → +100 % when there is a current value, else 0. */
const change = (cur: number, prev: number) => (prev ? r2(((cur - prev) / prev) * 100) : cur ? 100 : 0);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Food and drinks before tax, delivery fee, tip and platform fees. */
export function factSales(o: { subtotal?: number | null; total?: number | null; tax?: number | null; deliveryFee?: number | null; tip?: number | null }): number {
  const sub = num(o.subtotal);
  if (sub > 0) return r2(sub);
  return r2(Math.max(0, num(o.total) - num(o.tax) - num(o.deliveryFee) - num(o.tip)));
}

const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** One dish across every channel: by its Clover item id when known, else by its normalised name — always per brand. */
export function itemKey(brand: string, line: Pick<OrderLine, 'posItemRef' | 'name'>): string {
  return line.posItemRef ? `${brand}|pos:${line.posItemRef}` : `${brand}|name:${norm(line.name)}`;
}

/** One order from any channel, in a common shape. */
export interface SalesFact {
  /** Order id: the brand parts of one mixed-brand direct order share it (the order is counted once). */
  id: string;
  source: SourceKey;
  group: SourceGroup;
  brand: string;
  locationCode: string;
  fulfillment: Fulfillment;
  /** Order time: platform `createdAt`; direct `placedAt`, else `createdAt`. */
  createdAt: string;
  counted: boolean;
  sales: number;
  lines: Array<Pick<OrderLine, 'name' | 'quantity' | 'total' | 'posItemRef'>>;
}

function platformFact(o: StoredOrder): SalesFact {
  const source = sourceOf(o);
  return { id: o.id, source, group: 'platform', brand: o.brandName ?? '', locationCode: o.locationCode ?? '', fulfillment: o.fulfillment === 'pickup' || o.fulfillment === 'dine_in' ? o.fulfillment : 'delivery',
    createdAt: o.createdAt, counted: o.status !== 'cancelled', sales: factSales(o), lines: o.lines ?? [] };
}

/** "[Brand B] Poutine" (a mixed-brand phone cart, see phone/cart.ts cartToLines) → brand + plain dish name. */
const BRAND_PREFIX = /^\[([^\]]+)\]\s+/;
export function splitBrandPrefix(name: string): { brand: string | null; name: string } {
  const s = String(name ?? '');
  const m = BRAND_PREFIX.exec(s);
  return m && m[1].trim() ? { brand: m[1].trim(), name: s.slice(m[0].length) } : { brand: null, name: s };
}

/** One fact per brand: a mixed-brand direct order is split by its lines, its sales shared by line totals. */
export function directFacts(o: DirectOrder): SalesFact[] {
  const base = {
    id: o.id, source: sourceOf(o), group: 'direct' as const, locationCode: o.locationCode ?? '',
    fulfillment: (o.fulfillment === 'delivery' ? 'delivery' : 'pickup') as Fulfillment, createdAt: o.placedAt || o.createdAt, counted: o.status !== 'cancelled',
  };
  const own = o.brandName ?? '';
  const sales = factSales(o);
  const parts = new Map<string, SalesFact['lines']>();
  for (const l of o.lines ?? []) {
    const p = splitBrandPrefix(l.name);
    const brand = p.brand ?? own;
    const list = parts.get(brand) ?? [];
    list.push(p.brand ? { ...l, name: p.name } : l);
    parts.set(brand, list);
  }
  const entries = [...parts.entries()];
  if (entries.length <= 1) return [{ ...base, brand: entries[0]?.[0] ?? own, sales, lines: entries[0]?.[1] ?? [] }];
  const lineSum = (ls: SalesFact['lines']) => ls.reduce((s, l) => s + num(l.total), 0);
  const all = entries.reduce((s, [, ls]) => s + lineSum(ls), 0);
  let left = sales;
  return entries.map(([brand, lines], i) => {
    const share = i === entries.length - 1 ? left : r2(all > 0 ? (sales * lineSum(lines)) / all : sales / entries.length);
    left = r2(left - share);
    return { ...base, brand, sales: r2(share), lines };
  });
}

/** A direct order waiting for its payment link is neither a sale nor a lost sale (not in the kitchen, not in Clover). */
const isDirectSale = (o: DirectOrder | undefined | null): o is DirectOrder => !!o && o.status !== 'awaiting_payment';

/** Direct orders are indexed by when Food Hub stored them; a late import can be stored up to this long after it was placed. */
const DIRECT_IMPORT_SLACK_MS = 2 * 86400_000;

export interface SalesMixQuery {
  from: string;
  to: string;
  locationCodes?: string[];
  /** Platform channels (direct orders are not platforms: see `direct`). */
  channels?: ChannelKey[];
  brands?: string[];
  /** Default: include when no channel is picked, exclude when channels are picked. */
  direct?: DirectMode;
  /** Applied last; unknown keys are ignored. */
  sources?: string[];
}

export interface MixGroupRow {
  key: string;
  label: string;
  labelEn: string;
  group?: SourceGroup;
  orders: number;
  sales: number;
  aov: number;
  share: number;
  prevSales: number;
  change: number;
  lostOrders: number;
  lostSales: number;
}

export interface MixItem {
  rank: number;
  key: string;
  name: string;
  brand: string;
  qty: number;
  sales: number;
  orders: number;
  share: number;
  avgPrice: number;
  prevQty: number;
  change: number;
  lostQty: number;
  popular: boolean;
  bySource: Partial<Record<SourceKey, number>>;
}

function keepFact(f: SalesFact, q: SalesMixQuery, mode: DirectMode, sources: Set<string>): boolean {
  if (q.brands?.length && !q.brands.includes(f.brand)) return false;
  if (f.group === 'platform') {
    if (mode === 'only') return false;
    if (q.channels?.length && !q.channels.includes(f.source as ChannelKey)) return false;
  } else if (mode === 'exclude') return false;
  if (sources.size && !sources.has(f.source)) return false;
  return true;
}

const dowOfParts = (p: { year: number; month: number; day: number }) => (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
const dowOf = (ms: number, tz: string) => dowOfParts(localParts(ms, tz));

/**
 * Local hour and weekday (0 = Monday) of an instant, memoised per 15-minute UTC bucket: every zone offset and DST
 * change is a whole number of quarter hours, so the local hour and date never change inside one bucket.
 */
function hourDowReader(tz: string) {
  const memo = new Map<number, { hour: number; dow: number }>();
  return (ms: number) => {
    const bucket = Math.floor(ms / 900_000);
    let v = memo.get(bucket);
    if (!v) { const p = localParts(ms, tz); v = { hour: p.hour, dow: dowOfParts(p) }; memo.set(bucket, v); }
    return v;
  };
}

/** Distinct orders (the brand parts of one mixed-brand direct order count once). */
const orderCount = (xs: SalesFact[]) => new Set(xs.map((f) => f.id)).size;

export async function buildSalesMix(q: SalesMixQuery, now = Date.now(), cap = ROW_CAP) {
  const tz = foodhubTimeZone();
  const from = Date.parse(q.from);
  const to = Date.parse(q.to);
  const span = Math.max(0, to - from);
  const prevFrom = from - span;
  const days = Math.max(1, Math.round(span / 86400_000));
  const mode: DirectMode = q.direct ?? (q.channels?.length ? 'exclude' : 'include');
  const sources = new Set((q.sources ?? []).filter(isSourceKey));
  const locs = q.locationCodes?.length ? q.locationCodes : undefined;

  const repo = getRepo();
  const iso = (ms: number) => new Date(ms).toISOString();
  // Current and previous period are read apart (each with its own cap), so a busy current period never cuts the
  // previous one. Direct docs are indexed by storage time, which is never before the order time: the current read is
  // widened past `to` for late imports; the direct reads [prevFrom, from) and [from, to + slack) cover the window
  // once, and the facts are then cut by their real order time below.
  const [catalog, platCur, platPrev, dirCur, dirPrev] = await Promise.all([
    getCatalog(),
    repo.listOrders({ since: iso(from), until: iso(to), limit: cap, locationCodes: locs }),
    repo.listOrders({ since: iso(prevFrom), until: iso(from), limit: cap, locationCodes: locs }),
    repo.listDocs<DirectOrder>(DIRECT_ORDERS, { since: iso(from), until: iso(to + DIRECT_IMPORT_SLACK_MS), limit: cap }),
    repo.listDocs<DirectOrder>(DIRECT_ORDERS, { since: iso(prevFrom), until: iso(from), limit: cap }),
  ]);
  // Rows come newest first, so a read that hits the cap is missing its OLDEST rows. The current direct read starts at
  // `from`: when it hits the cap, orders stored between `from` and its oldest row are missing, even if part of the
  // read was imports after `to`, so the flag stays on the whole read. Those missing rows can also be late imports of
  // previous-period orders, so a capped current direct read makes the previous period incomplete too.
  const truncated = platCur.length >= cap || dirCur.length >= cap;
  const previousIncomplete = platPrev.length >= cap || dirPrev.length >= cap || dirCur.length >= cap;
  const comparable = !truncated && !previousIncomplete;
  const direct = [...dirCur, ...dirPrev].map((d) => d.data).filter(isDirectSale).filter((o) => !locs || locs.includes(o.locationCode));

  const facts = [...platCur.map(platformFact), ...platPrev.map(platformFact), ...direct.flatMap(directFacts)].filter((f) => keepFact(f, q, mode, sources));
  const at = (f: SalesFact) => Date.parse(f.createdAt);
  const cur = facts.filter((f) => at(f) >= from && at(f) < to);
  const prev = facts.filter((f) => at(f) >= prevFrom && at(f) < from);
  const counted = cur.filter((f) => f.counted);
  const lost = cur.filter((f) => !f.counted);
  const prevCounted = prev.filter((f) => f.counted);
  const sumSales = (xs: SalesFact[]) => r2(xs.reduce((s, f) => s + f.sales, 0));

  const sales = sumSales(counted);
  const prevSales = sumSales(prevCounted);
  const lostSales = sumSales(lost);
  const prevLostSales = sumSales(prev.filter((f) => !f.counted));
  const itemsSold = counted.reduce((s, f) => s + f.lines.reduce((a, l) => a + num(l.quantity), 0), 0);
  const orders = orderCount(counted);
  const prevOrders = orderCount(prevCounted);
  const totals = {
    orders, sales, aov: orders ? r2(sales / orders) : 0, itemsSold,
    lostOrders: orderCount(lost), lostSales, prevLostSales, lostSalesChange: change(lostSales, prevLostSales),
    prevOrders, prevSales, salesChange: change(sales, prevSales), ordersChange: change(orders, prevOrders),
  };

  // ---------- items ----------
  type Acc = { key: string; brand: string; names: Map<string, number>; qty: number; sales: number; orders: Set<string>; prevQty: number; lostQty: number; bySource: Partial<Record<SourceKey, number>> };
  const acc = new Map<string, Acc>();
  const itemOf = (f: SalesFact, l: SalesFact['lines'][number]) => {
    const key = itemKey(f.brand, l);
    let a = acc.get(key);
    if (!a) { a = { key, brand: f.brand, names: new Map(), qty: 0, sales: 0, orders: new Set(), prevQty: 0, lostQty: 0, bySource: {} }; acc.set(key, a); }
    return a;
  };
  for (const f of cur) for (const l of f.lines) {
    const a = itemOf(f, l);
    const qty = num(l.quantity);
    a.names.set(l.name, (a.names.get(l.name) ?? 0) + Math.max(1, qty));
    if (f.counted) { a.qty += qty; a.sales += num(l.total); a.orders.add(f.id); a.bySource[f.source] = (a.bySource[f.source] ?? 0) + qty; } else a.lostQty += qty;
  }
  for (const f of prevCounted) for (const l of f.lines) {
    const a = itemOf(f, l);
    a.prevQty += num(l.quantity);
    if (!a.names.size) a.names.set(l.name, 0);
  }
  const itemSales = r2([...acc.values()].reduce((s, a) => s + a.sales, 0));
  const sold = [...acc.values()].filter((a) => a.qty > 0).length;
  const popularCut = Math.max(3, Math.ceil(sold * 0.1));
  const displayName = (a: Acc) => [...a.names.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? '';
  const items: MixItem[] = [...acc.values()]
    .sort((x, y) => y.sales - x.sales || y.qty - x.qty || y.prevQty - x.prevQty || x.key.localeCompare(y.key))
    .map((a, i) => ({
      rank: i + 1, key: a.key, name: displayName(a), brand: a.brand, qty: a.qty, sales: r2(a.sales), orders: a.orders.size, share: pct(a.sales, itemSales),
      avgPrice: a.qty ? r2(a.sales / a.qty) : 0, prevQty: a.prevQty, change: change(a.qty, a.prevQty), lostQty: a.lostQty,
      popular: a.qty > 0 && i + 1 <= popularCut, bySource: a.bySource,
    }));

  // ---------- time ----------
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0, aov: 0 }));
  const heatmap = { orders: Array.from({ length: 7 }, () => Array(24).fill(0) as number[]), sales: Array.from({ length: 7 }, () => Array(24).fill(0) as number[]) };
  const byWeekday = Array.from({ length: 7 }, (_, dow) => ({ dow, orders: 0, sales: 0, aov: 0, days: 0, avgSalesPerDay: 0 }));
  const hourDow = hourDowReader(tz);
  const seen = new Set<string>();
  for (const f of counted) {
    const { hour: h, dow: d } = hourDow(at(f));
    // The brand parts of one order share its time: the order is counted once, its sales in full.
    const n = seen.has(f.id) ? 0 : 1;
    seen.add(f.id);
    byHour[h].orders += n; byHour[h].sales += f.sales;
    byWeekday[d].orders += n; byWeekday[d].sales += f.sales;
    heatmap.orders[d][h] += n; heatmap.sales[d][h] += f.sales;
  }
  for (const r of byHour) { r.sales = r2(r.sales); r.aov = r.orders ? r2(r.sales / r.orders) : 0; }
  heatmap.sales = heatmap.sales.map((row) => row.map(r2));
  // Local dates of each weekday in [from, to) (only days already started), stepped day by day so DST never shifts them.
  const end = Math.min(to, Math.max(now, from + 1));
  if (Number.isFinite(from) && Number.isFinite(to)) {
    let guard = 0;
    for (let day = startOfLocalDayMs(from, tz); day < end && guard < 800; day = startOfLocalDayMs(day + 36 * 3600_000, tz), guard++) {
      byWeekday[dowOf(day + 12 * 3600_000, tz)].days++;
    }
  }
  for (const r of byWeekday) { r.sales = r2(r.sales); r.aov = r.orders ? r2(r.sales / r.orders) : 0; r.avgSalesPerDay = r.days ? r2(r.sales / r.days) : 0; }

  // ---------- groups ----------
  const locName = (code: string) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : '');
  const group = (keyOf: (f: SalesFact) => string, label: (k: string) => Label, groupFor?: (k: string) => SourceGroup): MixGroupRow[] => {
    // Orders are counted by id: the brand parts of one order count once per group.
    const m = new Map<string, MixGroupRow & { ids: Set<string>; lostIds: Set<string> }>();
    const get = (key: string) => {
      let g = m.get(key);
      if (!g) { const l = label(key); g = { key, label: l.fr, labelEn: l.en, ...(groupFor ? { group: groupFor(key) } : {}), orders: 0, sales: 0, aov: 0, share: 0, prevSales: 0, change: 0, lostOrders: 0, lostSales: 0, ids: new Set(), lostIds: new Set() }; m.set(key, g); }
      return g;
    };
    for (const f of cur) { const g = get(keyOf(f)); if (f.counted) { g.ids.add(f.id); g.sales += f.sales; } else { g.lostIds.add(f.id); g.lostSales += f.sales; } }
    for (const f of prevCounted) get(keyOf(f)).prevSales += f.sales;
    return [...m.values()].map(({ ids, lostIds, ...g }): MixGroupRow => {
      const s = r2(g.sales); const p = r2(g.prevSales);
      return { ...g, orders: ids.size, lostOrders: lostIds.size, sales: s, prevSales: p, lostSales: r2(g.lostSales), aov: ids.size ? r2(s / ids.size) : 0, share: pct(s, totals.sales), change: change(s, p) };
    }).sort((a, b) => b.sales - a.sales || b.orders - a.orders || a.key.localeCompare(b.key));
  };
  const bySource = group((f) => f.source, (k) => SOURCE_LABELS[k as SourceKey] ?? UNMAPPED, (k) => groupOf(k as SourceKey));
  const byFulfillment = group((f) => f.fulfillment, (k) => FULFILLMENT_LABELS[k as Fulfillment] ?? UNMAPPED);
  const byBrand = group((f) => f.brand, (k) => (k ? { fr: k, en: k } : UNMAPPED));
  const byLocation = group((f) => f.locationCode, (k) => (k ? { fr: locName(k), en: locName(k) } : UNMAPPED));

  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days, previousFrom: new Date(prevFrom).toISOString(), previousTo: new Date(from).toISOString(), timezone: tz, truncated, previousIncomplete, comparable },
    totals,
    items,
    byHour,
    byWeekday,
    heatmap,
    bySource,
    byFulfillment,
    byBrand,
    byLocation,
  };
}

export type SalesMix = Awaited<ReturnType<typeof buildSalesMix>>;

// ---------- export (CSV / Excel through reports.ts renderReport) ----------

const WEEKDAYS: Record<'fr' | 'en', string[]> = { fr: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };

export function salesMixTable(mix: SalesMix, table: SalesMixTableKey, lang: 'fr' | 'en' = 'fr'): TableData {
  const fr = lang !== 'en';
  const t = (f: string, e: string) => (fr ? f : e);
  const tz = mix.range.timezone;
  const first = localDate(Date.parse(mix.range.from), tz);
  const last = localDate(Date.parse(mix.range.to) - 1, tz);
  const filename = `takatak-sales-mix-${table}-${first}_to_${last}`;
  const groupCols = (name: string) => [name, t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Panier moyen', 'Average order'), t('Part %', 'Share %'), t('Ventes préc.', 'Prev sales'), t('Variation %', 'Change %'), t('Commandes annulées', 'Cancelled orders'), t('Ventes perdues', 'Lost sales')];
  // Change % left blank when a read hit the row cap (the comparison would be wrong).
  const ch = (v: number) => (mix.range.comparable ? v : null);
  const groupRow = (g: MixGroupRow) => [g.orders, g.sales, g.aov, g.share, g.prevSales, ch(g.change), g.lostOrders, g.lostSales];

  if (table === 'items') {
    const present = SOURCE_KEYS.filter((s) => mix.items.some((i) => (i.bySource[s] ?? 0) > 0));
    return {
      title: t('Ventes par article', 'Sales by item'),
      filename,
      columns: [t('Rang', 'Rank'), t('Marque', 'Brand'), t('Article', 'Item'), t('Quantité', 'Quantity'), t('Ventes', 'Sales'), t('Commandes', 'Orders'), t('Part %', 'Share %'), t('Prix moyen', 'Average price'),
        t('Quantité préc.', 'Prev quantity'), t('Variation %', 'Change %'), t('Quantité annulée', 'Cancelled quantity'), ...present.map((s) => `${t('Qté', 'Qty')} ${SOURCE_LABELS[s][lang]}`)],
      rows: mix.items.map((i) => [i.rank, i.brand, i.name, i.qty, i.sales, i.orders, i.share, i.avgPrice, i.prevQty, ch(i.change), i.lostQty, ...present.map((s) => i.bySource[s] ?? 0)]),
    };
  }
  if (table === 'hours') {
    return { title: t('Ventes par heure', 'Sales by hour'), filename, columns: [t('Heure', 'Hour'), t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Panier moyen', 'Average order')],
      rows: mix.byHour.map((h) => [`${h.hour}h`, h.orders, h.sales, h.aov]) };
  }
  if (table === 'weekdays') {
    return { title: t('Ventes par jour de la semaine', 'Sales by day of the week'), filename,
      columns: [t('Jour', 'Day'), t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Panier moyen', 'Average order'), t('Jours', 'Days'), t('Moyenne par jour', 'Average per day')],
      rows: mix.byWeekday.map((d) => [WEEKDAYS[lang][d.dow], d.orders, d.sales, d.aov, d.days, d.avgSalesPerDay]) };
  }
  if (table === 'sources') {
    const cols = groupCols(t('Canal', 'Channel'));
    return { title: t('Ventes par canal', 'Sales by channel'), filename, columns: [cols[0], t('Type', 'Type'), ...cols.slice(1)],
      rows: mix.bySource.map((g) => [fr ? g.label : g.labelEn, g.group ? GROUP_LABELS[g.group][lang] : '', ...groupRow(g)]) };
  }
  return { title: t('Livraison, à emporter, sur place', 'Delivery, pickup, dine-in'), filename, columns: groupCols(t('Mode', 'Fulfillment')),
    rows: mix.byFulfillment.map((g) => [fr ? g.label : g.labelEn, ...groupRow(g)]) };
}
