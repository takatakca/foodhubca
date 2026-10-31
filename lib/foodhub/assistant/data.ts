// READ tools of the assistant: Food Hub data for EVERY channel at once — Uber Eats, DoorDash, SkipTheDishes, Too Good
// To Go, the brand websites, phone orders and Clover — through the functions the console already uses (sales mix,
// analytics, ops quality, reviews, disputes and payouts, incidents, Autopilot, menus, prep). Always limited to the
// person's own kitchens; money pages need the analytics permission. Results are compact JSON (no customer names,
// phone numbers or addresses), capped so one answer never floods the model.
import type { AuthUser } from '../auth';
import { CHANNEL_LABELS } from '../config';
import { DEFAULT_PREP, getPrepSettings } from '../prep';
import { getRepo } from '../repo';
import { can } from '../session';
import { foodhubTimeZone, localParts, localWallToUtcMs, startOfLocalDayMs } from '../time';
import type { ChannelKey } from '../types';
import { currentPrice } from './proposals';
import { NO_REVIEW_FILTER, storeStateOf } from './snapshot';

export type Period = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
export const PERIODS: Period[] = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const PLATFORMS: ChannelKey[] = ['uber_eats', 'doordash', 'skip', 'tgtg'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** [from, to) of a named period in Montréal time (custom: from / to as YYYY-MM-DD, to inclusive). */
export function periodRange(period: Period, now = Date.now(), from?: string, to?: string, tz = foodhubTimeZone()): { from: string; to: string; label: string } {
  const day = (ms: number) => startOfLocalDayMs(ms, tz);
  const today = day(now);
  const back = (start: number, n: number) => { let d = start; for (let i = 0; i < n; i++) d = day(d - 12 * 3600_000); return d; };
  const p = localParts(now, tz);
  const dow = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7; // 0 = Monday
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (period) {
    case 'today': return { from: iso(today), to: iso(now), label: 'today' };
    case 'yesterday': return { from: iso(back(today, 1)), to: iso(today), label: 'yesterday' };
    case 'last_7_days': return { from: iso(back(today, 6)), to: iso(now), label: 'last 7 days (today included)' };
    case 'last_30_days': return { from: iso(back(today, 29)), to: iso(now), label: 'last 30 days (today included)' };
    case 'this_week': return { from: iso(back(today, dow)), to: iso(now), label: 'this week (since Monday)' };
    case 'last_week': { const mon = back(today, dow); return { from: iso(back(mon, 7)), to: iso(mon), label: 'last week (Monday–Sunday)' }; }
    case 'this_month': return { from: iso(localWallToUtcMs(p.year, p.month, 1, 0, 0, tz)), to: iso(now), label: 'this month' };
    case 'last_month': {
      const y = p.month === 1 ? p.year - 1 : p.year; const m = p.month === 1 ? 12 : p.month - 1;
      return { from: iso(localWallToUtcMs(y, m, 1, 0, 0, tz)), to: iso(localWallToUtcMs(p.year, p.month, 1, 0, 0, tz)), label: 'last month' };
    }
    case 'custom': {
      if (!from || !DAY.test(from)) return periodRange('last_7_days', now, undefined, undefined, tz);
      const [fy, fm, fd] = from.split('-').map(Number);
      const end = to && DAY.test(to) ? to.split('-').map(Number) : null;
      const start = localWallToUtcMs(fy, fm, fd, 0, 0, tz);
      const stop = end ? day(localWallToUtcMs(end[0], end[1], end[2], 12, 0, tz) + 24 * 3600_000) : now;
      return { from: iso(start), to: iso(Math.min(Math.max(stop, start + 1), Math.max(now, start + 1))), label: `${from} → ${to ?? 'now'}` };
    }
  }
}

export interface ReadCtx { actor: AuthUser; now?: number }
type Out = Record<string, unknown>;
const denied = (en: string, fr: string): Out => ({ error: en, errorFr: fr });
const scopeOf = (actor: AuthUser, location?: string): string[] | undefined => {
  if (location) return actor.locations.length && !actor.locations.includes(location) ? ['__none__'] : [location];
  return actor.locations.length ? actor.locations : undefined;
};
const needsAnalytics = (ctx: ReadCtx, period: Period) => period !== 'today' && !can(ctx.actor.role, 'analytics:view');
const NO_ANALYTICS = denied('Your role sees today only. Sales over a period need the Insights permission.', 'Votre rôle ne voit que la journée. Les ventes sur une période demandent l’accès Statistiques.');

/** Sources the sales mix knows: platforms and direct channels (website, Clover, phone, phone AI, manual). */
export const SALES_SOURCES = ['uber_eats', 'doordash', 'skip', 'tgtg', 'website', 'clover', 'phone', 'phone_ai', 'manual'] as const;

export async function getSales(input: { period: Period; from?: string; to?: string; group_by?: 'source' | 'brand' | 'location' | 'weekday' | 'hour' | 'fulfillment'; brands?: string[]; sources?: string[]; location?: string }, ctx: ReadCtx): Promise<Out> {
  if (needsAnalytics(ctx, input.period)) return NO_ANALYTICS;
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period, now, input.from, input.to);
  const { buildSalesMix } = await import('../sales-mix');
  const mix = await buildSalesMix({ from: range.from, to: range.to, locationCodes: scopeOf(ctx.actor, input.location), brands: input.brands?.length ? input.brands : undefined, sources: input.sources?.length ? input.sources : undefined }, now);
  const g = input.group_by ?? 'source';
  const rows = g === 'source' ? mix.bySource : g === 'brand' ? mix.byBrand : g === 'location' ? mix.byLocation : g === 'fulfillment' ? mix.byFulfillment : null;
  return {
    period: range.label, from: range.from, to: range.to, timezone: mix.range.timezone, comparedWith: { from: mix.range.previousFrom, to: mix.range.previousTo, comparable: mix.range.comparable },
    totals: { sales: r2(mix.totals.sales), orders: mix.totals.orders, avgTicket: mix.totals.aov, itemsSold: mix.totals.itemsSold, salesChangePct: mix.totals.salesChange, ordersChangePct: mix.totals.ordersChange, lostOrders: mix.totals.lostOrders, lostSales: r2(mix.totals.lostSales) },
    groupedBy: g,
    rows: rows
      ? rows.slice(0, 20).map((r) => ({ key: r.key, label: r.labelEn, sales: r.sales, orders: r.orders, avgTicket: r.aov, sharePct: r.share, changePct: r.change, lostOrders: r.lostOrders, lostSales: r.lostSales }))
      : g === 'weekday' ? mix.byWeekday.map((r) => ({ weekday: WEEKDAYS[r.dow], sales: r2(r.sales), orders: r.orders, avgSalesPerDay: r.avgSalesPerDay })) : mix.byHour.filter((r) => r.orders).map((r) => ({ hour: r.hour, sales: r.sales, orders: r.orders })),
    truncated: mix.range.truncated,
    note: 'sales = food sales before tax, tips and delivery fees; every channel (platforms + website + Clover + phone).',
  };
}

export async function getTopItems(input: { period: Period; from?: string; to?: string; brand?: string; sources?: string[]; location?: string; limit?: number; order?: 'best' | 'worst' }, ctx: ReadCtx): Promise<Out> {
  if (needsAnalytics(ctx, input.period)) return NO_ANALYTICS;
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period, now, input.from, input.to);
  const { buildSalesMix } = await import('../sales-mix');
  const mix = await buildSalesMix({ from: range.from, to: range.to, locationCodes: scopeOf(ctx.actor, input.location), brands: input.brand ? [input.brand] : undefined, sources: input.sources?.length ? input.sources : undefined }, now);
  const limit = Math.max(1, Math.min(25, input.limit ?? 10));
  const items = input.order === 'worst' ? [...mix.items].sort((a, b) => a.qty - b.qty || a.sales - b.sales) : mix.items;
  return {
    period: range.label, order: input.order ?? 'best',
    items: items.slice(0, limit).map((i) => ({ rank: i.rank, item: i.name, brand: i.brand, qty: i.qty, sales: i.sales, avgPrice: i.avgPrice, sharePct: i.share, changePct: i.change, lostQty: i.lostQty, bySource: i.bySource })),
    totalItems: mix.items.length,
  };
}

export async function getOrderIssues(input: { period: Period; from?: string; to?: string; brand?: string; platform?: ChannelKey; location?: string }, ctx: ReadCtx): Promise<Out> {
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period, now, input.from, input.to);
  const q = { from: range.from, to: range.to, locationCodes: scopeOf(ctx.actor, input.location), channels: input.platform ? [input.platform] : undefined, brands: input.brand ? [input.brand] : undefined };
  const { buildAnalytics } = await import('../analytics');
  const a = await buildAnalytics(q, now);
  let quality: Out | null = null;
  try {
    const { buildOpsQuality } = await import('../ops-quality');
    const o = await buildOpsQuality(q, now);
    quality = {
      goals: o.goals,
      overall: Object.fromEntries(Object.entries(o.overall as Record<string, { value: number; numerator: number; denominator: number; status: string; goal: number }>).map(([k, m]) => [k, { pct: m.value, count: m.numerator, of: m.denominator, goalPct: m.goal, status: m.status }])),
      needsAttention: o.attention.slice(0, 8).map((x) => ({ metric: x.metric, store: x.label, pct: x.value, goalPct: x.goal, cause: x.cause ?? null })),
    };
  } catch { /* ops quality left out */ }
  return {
    period: range.label,
    orders: (a.kpis as Record<string, { value: number }>).orders?.value ?? null,
    cancellations: { total: a.cancellations.total, lostRevenue: a.cancellations.lostRevenue, byWho: a.cancellations.byWho, byStage: a.cancellations.byStage, byPlatform: a.cancellations.byChannel, topReasons: a.cancellations.reasons },
    itemsLostToCancellations: a.lostItems,
    quality,
    note: 'missingIncorrect = orders with a missing/incorrect item report; lateReady = marked ready after the ready-by time; avoidableCancel = cancelled by the store or the POS; downtime = store offline during opening hours.',
  };
}

export async function getMissedOrders(input: { period: Period; from?: string; to?: string; brand?: string; platform?: ChannelKey; location?: string }, ctx: ReadCtx): Promise<Out> {
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period, now, input.from, input.to);
  const orders = (await getRepo().listOrders({ since: range.from, until: range.to, limit: 20_000, locationCodes: scopeOf(ctx.actor, input.location) }))
    .filter((o) => (!input.brand || o.brandName === input.brand) && (!input.platform || o.channel === input.platform));
  const missed = orders.filter((o) => o.status === 'failed' || (o.status === 'cancelled' && o.timeline?.cancelStage === 'before_accept') || (o.status === 'new' && now - Date.parse(o.createdAt) > 30 * 60_000));
  const by = <K extends string>(f: (o: (typeof missed)[number]) => K) => missed.reduce<Record<string, number>>((m, o) => { const k = f(o); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return {
    period: range.label, orders: orders.length, missed: missed.length, missedPct: orders.length ? r2((missed.length / orders.length) * 100) : 0, lostRevenue: r2(missed.reduce((s, o) => s + (Number(o.total) || 0), 0)),
    byPlatform: by((o) => CHANNEL_LABELS[o.channel] ?? o.channel), byBrand: by((o) => o.brandName ?? 'unmapped'), byLocation: by((o) => o.locationCode ?? 'unmapped'),
    byWhy: by((o) => (o.status === 'failed' ? 'handed back to the platform (failed)' : o.status === 'new' ? 'still waiting for an answer' : `cancelled before accept${o.timeline?.cancelledBy ? ` by ${o.timeline.cancelledBy}` : ''}`)),
    examples: missed.slice(0, 12).map((o) => ({ at: o.createdAt, platform: CHANNEL_LABELS[o.channel], brand: o.brandName ?? null, location: o.locationCode ?? null, total: o.total, status: o.status, reason: o.timeline?.cancelReason ?? null })),
  };
}

export async function getStoreStatus(input: { brand?: string; location?: string; platform?: ChannelKey; downtime_period?: Period }, ctx: ReadCtx): Promise<Out> {
  const scope = scopeOf(ctx.actor, input.location);
  const stores = (await getRepo().listStores()).filter((s) => (!scope || scope.includes(s.locationCode)) && (!input.brand || s.brandName.toLowerCase() === input.brand.toLowerCase()) && (!input.platform || s.channel === input.platform));
  const prep = await getPrepSettings();
  const locs = [...new Set(stores.map((s) => s.locationCode))];
  let downtime: Out | null = null;
  if (input.downtime_period) {
    const now = ctx.now ?? Date.now();
    const range = periodRange(input.downtime_period, now);
    const { buildAnalytics } = await import('../analytics');
    const a = await buildAnalytics({ from: range.from, to: range.to, locationCodes: scope, channels: input.platform ? [input.platform] : undefined, brands: input.brand ? [input.brand] : undefined }, now);
    downtime = { period: range.label, overallUptimePct: a.uptime.overallPct, offlineMinutes: a.uptime.offlineMinutes, worstStores: a.uptime.stores.slice(0, 10).map((u) => ({ storeId: u.storeId, platform: u.label, brand: u.brandName, location: u.locationCode, uptimePct: u.uptimePct, offlineMinutes: u.offlineMinutes, hoursSet: u.hoursSet })) };
  }
  return {
    stores: stores.slice(0, 60).map((s) => ({ storeId: s.id, platform: CHANNEL_LABELS[s.channel], channel: s.channel, brand: s.brandName, location: s.locationCode, state: storeStateOf(s), pausedUntil: s.pausedUntil ?? null, autoAccept: s.autoAccept, statusDetail: (s.meta?.platformStatus as { detail?: string } | undefined)?.detail ?? null })),
    totalStores: stores.length,
    prepTimes: Object.fromEntries(locs.map((code) => { const p = { ...DEFAULT_PREP, ...prep[code] }; return [code, { normal: p.normal, busy: p.busy, busyMode: p.isBusy, inForce: p.isBusy ? p.busy : p.normal }]; })),
    downtime,
  };
}

export async function getReviews(input: { period?: Period; brand?: string; platform?: string; max_stars?: number; unanswered_only?: boolean }, ctx: ReadCtx): Promise<Out> {
  if (!can(ctx.actor.role, 'analytics:view')) return denied('Reviews need the Insights permission.', 'Les avis demandent l’accès Statistiques.');
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period ?? 'last_30_days', now);
  const { findReviews } = await import('../reviews/query');
  const { summarizeReviews } = await import('../reviews/summary');
  const { scoped } = await findReviews({ locations: ctx.actor.locations }, NO_REVIEW_FILTER);
  const list = scoped.filter((r) => Date.parse(r.at) >= Date.parse(range.from) && Date.parse(r.at) < Date.parse(range.to)
    && (!input.brand || (r.brandName ?? '').toLowerCase() === input.brand.toLowerCase()) && (!input.platform || r.platform === input.platform)
    && (!input.max_stars || (r.stars ?? 5) <= input.max_stars) && (!input.unanswered_only || !r.reply));
  const sum = summarizeReviews(list, now).overall;
  return {
    period: range.label, count: sum.count, avgStars: sum.avg, distribution: sum.distribution, unanswered: sum.unanswered, themes: sum.themes.slice(0, 8),
    reviews: list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map((r) => ({ id: r.id, at: r.at, platform: r.platform, brand: r.brandName, location: r.locationCode, stars: r.stars, text: r.text.slice(0, 300), themes: r.themes, replied: Boolean(r.reply) })),
    note: 'Replies are drafted and sent from Insights → Reviews (the assistant never posts a reply).',
  };
}

export async function getPayouts(input: { period?: Period; platform?: ChannelKey }, ctx: ReadCtx): Promise<Out> {
  if (!can(ctx.actor.role, 'analytics:view')) return denied('Payouts need the Insights permission.', 'Les paiements demandent l’accès Statistiques.');
  if (ctx.actor.locations.length) return denied('Payouts are company-wide: only people who see every kitchen can read them.', 'Les paiements couvrent toute l’entreprise : réservés aux personnes qui voient toutes les cuisines.');
  const now = ctx.now ?? Date.now();
  const range = periodRange(input.period ?? 'this_month', now);
  const { listCases, payoutBatches, RECOVERABLE } = await import('../recon/engine');
  const channels = input.platform ? [input.platform] : undefined;
  const [batches, cases] = await Promise.all([payoutBatches({ from: range.from, to: range.to, channels }).catch(() => []), listCases({ status: ['open', 'disputed'], channels }).catch(() => [])]);
  const recoverable = cases.filter((c) => RECOVERABLE.includes(c.type));
  const sum = (k: 'sales' | 'commission' | 'promotions' | 'refunds' | 'net' | 'otherFees' | 'adjustments') => r2(batches.reduce((a, b) => a + (Number(b[k]) || 0), 0));
  return {
    period: range.label,
    statements: batches.length ? { payouts: batches.length, sales: sum('sales'), commission: sum('commission'), promotions: sum('promotions'), refunds: sum('refunds'), otherFees: sum('otherFees'), adjustments: sum('adjustments'), net: sum('net') } : null,
    byPlatform: PLATFORMS.map((ch) => { const bs = batches.filter((b) => b.channel === ch); return bs.length ? { platform: CHANNEL_LABELS[ch], payouts: bs.length, net: r2(bs.reduce((a, b) => a + b.net, 0)), depositGaps: bs.filter((b) => b.gap).length } : null; }).filter(Boolean),
    moneyToRecover: { cases: recoverable.length, amount: r2(recoverable.reduce((a, c) => a + c.amount, 0)), byType: recoverable.reduce<Record<string, number>>((m, c) => { m[c.type] = r2((m[c.type] ?? 0) + c.amount); return m; }, {}) },
    note: batches.length ? 'From the platform statements imported in Money → Statements.' : 'No platform statement imported for this period (Money → Statements).',
  };
}

export async function getIncidents(input: { status?: 'open' | 'all'; limit?: number }, ctx: ReadCtx): Promise<Out> {
  const { listIncidents } = await import('../watch/engine');
  const list = await listIncidents({ status: input.status === 'all' ? undefined : ['open', 'acknowledged'], locationCodes: ctx.actor.locations.length ? ctx.actor.locations : undefined, limit: 300 });
  const limit = Math.max(1, Math.min(30, input.limit ?? 12));
  return {
    count: list.length,
    incidents: list.slice(0, limit).map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, status: i.status, title: i.titleEn, titleFr: i.title, detail: (i.detailEn ?? i.detail ?? '').slice(0, 300), brand: i.brandName ?? null, location: i.locationCode ?? null, platform: i.channel ?? null, openedAt: i.openedAt })),
  };
}

export async function getAutopilot(_input: Record<string, never>, _ctx: ReadCtx): Promise<Out> {
  const { getSwitches, NEW_AUTOMATIONS } = await import('../autopilot');
  const { getRuns } = await import('../autopilot/runs');
  const [sw, runs] = await Promise.all([getSwitches(), getRuns().catch(() => ({}))]);
  return {
    automations: NEW_AUTOMATIONS.map((id) => ({ id, on: Boolean(sw[id]?.on), changedAt: sw[id]?.at ?? null, changedBy: sw[id]?.by ?? null })),
    lastRuns: Object.entries(runs).slice(0, 12).map(([id, r]) => ({ id, at: r.at, status: r.status, what: r.en })),
    note: 'Autopilot automations are off by default; only a manager switches them on (Settings → Autopilot). The assistant never switches them.',
  };
}

export async function findMenuItems(input: { query?: string; brand?: string; sold_out_only?: boolean; limit?: number }, ctx: ReadCtx): Promise<Out> {
  const menus = await getRepo().listMenus();
  const q = input.query?.trim().toLowerCase() ?? '';
  const scope = ctx.actor.locations;
  const out: Out[] = [];
  for (const m of menus) {
    if (input.brand && m.brandName.toLowerCase() !== input.brand.toLowerCase()) continue;
    for (const it of m.items) {
      if (q && !it.name.toLowerCase().includes(q) && !(it.nameFr ?? '').toLowerCase().includes(q) && it.ref !== input.query) continue;
      const offAt = Object.entries(m.unavailableByLocation ?? {}).filter(([code, refs]) => refs.includes(it.ref) && (!scope.length || scope.includes(code))).map(([code]) => code);
      if (input.sold_out_only && it.available && !offAt.length) continue;
      out.push({
        brand: m.brandName, ref: it.ref, name: it.name, nameFr: it.nameFr ?? null, available: it.available, soldOutAt: offAt,
        prices: { in_store: currentPrice(m, it, 'in_store'), uber_eats: currentPrice(m, it, 'uber_eats'), doordash: currentPrice(m, it, 'doordash'), skip: currentPrice(m, it, 'skip') },
        ownPlatformPrices: it.channelPrices ?? null,
      });
      if (out.length >= Math.max(1, Math.min(40, input.limit ?? 20))) return { items: out, more: true };
    }
  }
  return { items: out, more: false, note: out.length ? 'prices.* = what the customer pays now (own platform price, else base + platform markup).' : 'No item matches.' };
}
