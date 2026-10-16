// Operations quality: four metrics with goals the owner sets, for every platform at once (Uber Eats, DoorDash,
// SkipTheDishes, Too Good To Go). Computed from Food Hub's own data only — no platform API call, nothing sent anywhere.
//   1. missingIncorrect — delivered / picked-up orders with a missing item (kitchen) or an error charge (statement);
//   2. lateReady        — orders marked ready more than `lateGraceMin` minutes after the promised time;
//   3. avoidableCancel  — orders cancelled by the restaurant or because of the POS / tablet;
//   4. downtime         — share of opening hours the store was paused, closed or deactivated.
// Each metric is given overall (vs the previous period of the same length), then per store, brand, location and
// platform. Rows add numerators and denominators (never an average of percentages).
import { z } from 'zod';
import { logActivity, type Actor } from './activity';
import { intersectIntervals, seedState, type AnalyticsQuery } from './analytics';
import { getCatalog } from './catalog';
import { CHANNEL_LABELS } from './config';
import { effectiveHours, getHours, holidaysFor, localDate, openIntervals } from './hours';
import { COL, refKey } from './recon/engine';
import type { PayoutLine } from './recon/statements';
import { getRepo } from './repo';
import { ROW_CAP } from './reports';
import { foodhubTimeZone } from './time';
import type { ActivityEntry, ChannelKey, ChannelStore, StoredOrder } from './types';

// ---------------------------------------------------------------- goals

export type OpsMetricKey = 'missingIncorrect' | 'lateReady' | 'avoidableCancel' | 'downtime';
export const OPS_METRICS: OpsMetricKey[] = ['missingIncorrect', 'lateReady', 'avoidableCancel', 'downtime'];

export interface OpsGoals {
  missingIncorrectPct: number;
  lateReadyPct: number;
  avoidableCancelPct: number;
  downtimePct: number;
  /** Minutes after the promised ready time before an order counts as late. */
  lateGraceMin: number;
}

export const DEFAULT_OPS_GOALS: OpsGoals = { missingIncorrectPct: 1, lateReadyPct: 5, avoidableCancelPct: 1, downtimePct: 1, lateGraceMin: 5 };
export const OPS_GOALS_KEY = 'ops_quality_goals_v1';

const pctField = z.number().min(0).max(100);
const graceField = z.number().int().min(0).max(60);
const FIELD_SCHEMA: Record<keyof OpsGoals, z.ZodNumber> = {
  missingIncorrectPct: pctField, lateReadyPct: pctField, avoidableCancelPct: pctField, downtimePct: pctField, lateGraceMin: graceField,
};
const GOALS_SCHEMA = z.object({
  missingIncorrectPct: pctField.optional(),
  lateReadyPct: pctField.optional(),
  avoidableCancelPct: pctField.optional(),
  downtimePct: pctField.optional(),
  lateGraceMin: graceField.optional(),
});

/** Stored goals merged over the defaults; a stored field that is not valid is ignored (the default stays). */
export async function getOpsGoals(): Promise<OpsGoals> {
  const stored = await getRepo().getKv<Record<string, unknown>>(OPS_GOALS_KEY).catch(() => null);
  const out: OpsGoals = { ...DEFAULT_OPS_GOALS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(FIELD_SCHEMA) as Array<keyof OpsGoals>) {
      const parsed = FIELD_SCHEMA[k].safeParse(stored[k]);
      if (parsed.success) out[k] = parsed.data;
    }
  }
  return out;
}

/** Validates (each % 0–100, grace an integer 0–60), saves over the current goals and logs it. Throws on invalid input. */
export async function saveOpsGoals(input: unknown, actor: Actor): Promise<OpsGoals> {
  const parsed = GOALS_SCHEMA.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'goals'}: ${i.message}`).join('; '));
  }
  const clean = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<OpsGoals>;
  const goals: OpsGoals = { ...(await getOpsGoals()), ...clean };
  await getRepo().setKv(OPS_GOALS_KEY, goals);
  await logActivity({
    actor: actor.name, source: actor.source, kind: 'settings', action: 'ops_goals_saved', status: 'success',
    summary: `Operations quality goals saved: missing or incorrect ≤ ${goals.missingIncorrectPct}%, ready late ≤ ${goals.lateReadyPct}% (grace ${goals.lateGraceMin} min), avoidable cancellations ≤ ${goals.avoidableCancelPct}%, downtime ≤ ${goals.downtimePct}%`,
    detail: { goals },
  });
  return goals;
}

// ---------------------------------------------------------------- per-order rules

const r1 = (n: number) => Math.round(n * 10) / 10 || 0;
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const pct = (a: number, b: number) => (b > 0 && Number.isFinite(a) && Number.isFinite(b) ? r2((a / b) * 100) : 0);
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
const DAY = 86400_000;

/** Below this many orders (or open minutes for downtime) a metric says "not enough data" instead of a status. */
export const MIN_ORDERS = 10;
export const MIN_OPEN_MINUTES = 120;

export type CancelCause = 'store' | 'pos' | 'platform' | 'customer' | 'unknown';
const POS_REASON = /\b(pos|clover|technical|technique|integration|intégration|tablet|tablette)\b/i;

/** Why a cancelled order was cancelled (null when the order is not cancelled). A POS / tablet reason wins over who cancelled. */
export function cancelCause(o: Pick<StoredOrder, 'status' | 'timeline'>): CancelCause | null {
  if (o.status !== 'cancelled') return null;
  if (POS_REASON.test(o.timeline?.cancelReason ?? '')) return 'pos';
  const by = o.timeline?.cancelledBy;
  return by === 'store' || by === 'platform' || by === 'customer' ? by : 'unknown';
}
const AVOIDABLE = new Set<CancelCause>(['store', 'pos']);

/** courier.ts fills readyAt at pickup when nobody tapped Ready: such an order has no real ready time. */
export function isAutoReady(o: Pick<StoredOrder, 'timeline'>): boolean {
  const t = o.timeline;
  return Boolean(t?.dispatchedAt && t.readyAt && t.readyAt === t.dispatchedAt);
}

/** True when marked ready more than `graceMin` minutes after the promised time; null when the order is not eligible. */
export function isLateReady(o: Pick<StoredOrder, 'status' | 'timeline' | 'readyBy'>, graceMin: number): boolean | null {
  if (o.status === 'cancelled' || o.status === 'failed') return null;
  const ready = ms(o.timeline?.readyAt);
  const target = ms(o.timeline?.readyTarget ?? o.readyBy);
  if (!Number.isFinite(ready) || !Number.isFinite(target) || isAutoReady(o)) return null;
  return ready - target > graceMin * 60_000;
}

const DONE = (o: StoredOrder) => o.status === 'dispatched' || o.status === 'completed';

// ---------------------------------------------------------------- downtime segments

type Interval = [number, number];
export type DowntimeCause = 'paused_by_staff' | 'paused_auto' | 'platform_paused' | 'deactivated' | 'closed_on_platform' | 'unknown';
export const DOWNTIME_CAUSES: DowntimeCause[] = ['paused_by_staff', 'paused_auto', 'platform_paused', 'deactivated', 'closed_on_platform', 'unknown'];
export interface OfflineSegment { start: number; end: number; cause: DowntimeCause }

/** Same action → state mapping as analytics.offlineIntervals. */
const STATE_OF: Record<string, 'online' | 'offline' | 'closed'> = {
  pause: 'offline', resume: 'online', platform_online: 'online', platform_paused: 'offline', platform_deactivated: 'offline', platform_closed: 'closed', platform_unknown: 'online',
};
function causeOf(e: ActivityEntry): DowntimeCause {
  switch (e.action) {
    case 'pause': return e.source === 'dashboard' ? 'paused_by_staff' : 'paused_auto';
    case 'platform_paused': return 'platform_paused';
    case 'platform_deactivated': return 'deactivated';
    case 'platform_closed': return 'closed_on_platform';
    default: return 'unknown';
  }
}

/**
 * Offline segments of one store in [from, to) with the cause of the change that started each one. Same state rules
 * as analytics.offlineIntervals (failed entries ignored, 'closed' counts as offline): the segment total is equal.
 */
export function offlineSegments(entries: ActivityEntry[], store: Pick<ChannelStore, 'id'>, from: number, to: number, initial: 'online' | 'offline' | 'closed' = 'online'): OfflineSegment[] {
  const changes = entries.filter((e) => e.storeId === store.id && e.kind === 'store_status' && STATE_OF[e.action] && e.status !== 'failed')
    .map((e) => ({ t: Date.parse(e.at), state: STATE_OF[e.action], cause: causeOf(e) })).sort((x, y) => x.t - y.t);
  let state: 'online' | 'offline' | 'closed' = initial;
  let cause: DowntimeCause = 'unknown';
  for (const c of changes) if (c.t <= from) { state = c.state; cause = c.cause; }
  const out: OfflineSegment[] = [];
  let cursor = from;
  const isOff = (s: string) => s === 'offline' || s === 'closed';
  for (const c of changes.filter((x) => x.t > from && x.t < to)) {
    if (isOff(state) && c.t > cursor) out.push({ start: cursor, end: c.t, cause });
    state = c.state; cause = c.cause; cursor = c.t;
  }
  if (isOff(state) && to > cursor) out.push({ start: cursor, end: to, cause });
  return out;
}

// ---------------------------------------------------------------- metric shapes

export type OpsStatus = 'attention' | 'on_track' | 'no_data';
export interface OpsMetric {
  /** Percent, 2 decimals. */
  value: number;
  previous: number;
  /** value − previous, in percentage points. */
  changePts: number;
  numerator: number;
  denominator: number;
  goal: number;
  status: OpsStatus;
  extra: Record<string, unknown>;
}
export type OpsRowMetric = Omit<OpsMetric, 'previous' | 'changePts'>;
export interface OpsRow {
  level: 'store' | 'brand' | 'location' | 'channel';
  key: string;
  label: string;
  channel?: ChannelKey;
  brandName?: string;
  locationCode?: string;
  metrics: Record<OpsMetricKey, OpsRowMetric>;
  topDowntimeCause?: DowntimeCause;
}
export interface OpsTopRow { storeId: string; label: string; value: number; numerator: number; denominator: number; goal: number }
export interface OpsAttention { metric: OpsMetricKey; storeId: string; label: string; value: number; goal: number; numerator: number; denominator: number; cause?: string }

type Raw = { num: number; den: number; extra: Record<string, unknown> };
interface StoreDowntime { store: ChannelStore; hoursSet: boolean; openMs: number; offMs: number; byCause: Record<DowntimeCause, number> }

const GOAL_OF: Record<OpsMetricKey, keyof OpsGoals> = { missingIncorrect: 'missingIncorrectPct', lateReady: 'lateReadyPct', avoidableCancel: 'avoidableCancelPct', downtime: 'downtimePct' };

function finalize(key: OpsMetricKey, raw: Raw, goals: OpsGoals): OpsRowMetric {
  const value = pct(raw.num, raw.den);
  const goal = goals[GOAL_OF[key]];
  const enough = key === 'downtime' ? raw.den >= MIN_OPEN_MINUTES : raw.den >= MIN_ORDERS;
  return { value, numerator: raw.num, denominator: raw.den, goal, status: !enough ? 'no_data' : value > goal ? 'attention' : 'on_track', extra: raw.extra };
}

type LineIndex = Map<string, PayoutLine[]>;

function orderMetrics(orders: StoredOrder[], lines: LineIndex, goals: OpsGoals): Record<Exclude<OpsMetricKey, 'downtime'>, Raw> {
  // 1) missing / incorrect
  const done = orders.filter(DONE);
  let reported = 0; let charged = 0; let amount = 0; let missNum = 0;
  for (const o of done) {
    const kitchen = (o.timeline?.missingItems?.length ?? 0) > 0;
    const k = refKey(o.externalOrderId);
    const matched = k ? lines.get(`${o.channel}|${k}`) ?? [] : [];
    if (kitchen) reported++;
    if (matched.length) { charged++; amount += matched.reduce((s, l) => s + Math.abs(Number(l.net) || 0), 0); }
    if (kitchen || matched.length) missNum++;
  }
  // 2) ready late
  let lateNum = 0; let lateDen = 0; let lateMin = 0;
  for (const o of orders) {
    const late = isLateReady(o, goals.lateGraceMin);
    if (late === null) continue;
    lateDen++;
    if (late) { lateNum++; lateMin += (ms(o.timeline?.readyAt) - ms(o.timeline?.readyTarget ?? o.readyBy)) / 60_000; }
  }
  const notMarked = done.filter(isAutoReady).length;
  // 3) avoidable cancellations
  const byCause: Record<CancelCause, number> = { store: 0, pos: 0, platform: 0, customer: 0, unknown: 0 };
  const avoidable: StoredOrder[] = [];
  for (const o of orders) {
    const c = cancelCause(o);
    if (!c) continue;
    byCause[c]++;
    if (AVOIDABLE.has(c)) avoidable.push(o);
  }
  const reasons = new Map<string, number>();
  for (const o of avoidable) { const r = o.timeline?.cancelReason?.trim() || 'Not given'; reasons.set(r, (reasons.get(r) ?? 0) + 1); }
  return {
    missingIncorrect: { num: missNum, den: done.length, extra: { reportedByKitchen: reported, errorCharged: charged, errorChargeAmount: r2(amount) } },
    lateReady: { num: lateNum, den: lateDen, extra: { avgMinutesLate: lateNum ? r1(lateMin / lateNum) : 0, notMarkedReady: notMarked, notMarkedReadyPct: pct(notMarked, done.length) } },
    avoidableCancel: {
      num: avoidable.length, den: orders.length,
      extra: {
        byCause, lostSales: r2(avoidable.reduce((s, o) => s + (Number(o.total) || 0), 0)),
        topReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, 5),
      },
    },
  };
}

function emptyCauses(): Record<DowntimeCause, number> {
  return Object.fromEntries(DOWNTIME_CAUSES.map((c) => [c, 0])) as Record<DowntimeCause, number>;
}

function downtimeRaw(list: StoreDowntime[]): Raw & { topCause?: DowntimeCause } {
  const withHours = list.filter((d) => d.hoursSet);
  const openMs = withHours.reduce((a, d) => a + d.openMs, 0);
  const offMs = withHours.reduce((a, d) => a + d.offMs, 0);
  const causesMs = emptyCauses();
  for (const d of withHours) for (const c of DOWNTIME_CAUSES) causesMs[c] += d.byCause[c];
  const byCause = Object.fromEntries(DOWNTIME_CAUSES.map((c) => [c, Math.round(causesMs[c] / 60_000)])) as Record<DowntimeCause, number>;
  const top = DOWNTIME_CAUSES.filter((c) => causesMs[c] > 0).sort((a, b) => causesMs[b] - causesMs[a])[0];
  // Numerator / denominator in minutes (1 decimal) so rows add up; the % uses the same minutes.
  const openMinutes = r1(openMs / 60_000); const offlineMinutes = r1(offMs / 60_000);
  return { num: offlineMinutes, den: openMinutes, topCause: top, extra: { openMinutes: Math.round(openMinutes), offlineMinutes: Math.round(offlineMinutes), byCause, storesWithoutHours: list.length - withHours.length } };
}

function storeDowntime(stores: ChannelStore[], activity: ActivityEntry[], hours: Awaited<ReturnType<typeof getHours>>, from: number, to: number, days: number, tz: string): StoreDowntime[] {
  return stores.map((s) => {
    const week = effectiveHours(hours, s.brandName, s.locationCode);
    if (!week || to <= from) return { store: s, hoursSet: Boolean(week), openMs: 0, offMs: 0, byCause: emptyCauses() };
    const open: Interval[] = openIntervals(week, holidaysFor(hours, s.locationCode, localDate(from, tz), days + 1), from, to, tz);
    const openMs = open.reduce((a, [x, y]) => a + (y - x), 0);
    const segments = offlineSegments(activity, s, from, to, seedState(activity, s, from));
    const byCause = emptyCauses();
    let offMs = 0;
    for (const seg of segments) { const m = intersectIntervals([[seg.start, seg.end]], open); offMs += m; byCause[seg.cause] += m; }
    return { store: s, hoursSet: true, openMs, offMs, byCause };
  });
}

// ---------------------------------------------------------------- build

export async function buildOpsQuality(q: AnalyticsQuery & { storeIds?: string[] }, now = Date.now()) {
  const tz = foodhubTimeZone();
  const from = Date.parse(q.from);
  const toReq = Date.parse(q.to);
  const span = Math.max(0, toReq - from);
  const prevFrom = from - span;
  const prevTo = from;
  // Downtime stops at "now": the rest of today has not happened yet (orders cannot exist there anyway).
  const toEff = Math.min(toReq, Math.max(now, from));
  const days = Math.max(1, Math.round(span / DAY));
  const repo = getRepo();
  const [goals, catalog, hours, rawOrders, allStores, activity, lineDocs, anyLine] = await Promise.all([
    getOpsGoals(),
    getCatalog(),
    getHours(),
    repo.listOrders({ since: new Date(prevFrom).toISOString(), until: new Date(toReq).toISOString(), limit: ROW_CAP, locationCodes: q.locationCodes }),
    repo.listStores(),
    repo.listActivity({ since: new Date(prevFrom - 30 * DAY).toISOString(), until: new Date(toEff).toISOString(), kinds: ['store_status'], limit: ROW_CAP }),
    repo.listDocs<PayoutLine>(COL.lines, { since: new Date(prevFrom - 7 * DAY).toISOString(), until: new Date(toReq + 60 * DAY).toISOString(), limit: ROW_CAP }),
    repo.listDocs(COL.lines, { limit: 1 }),
  ]);
  const notes: string[] = ['direct_orders_not_included'];
  if (!anyLine.length) notes.push('no_statements_imported');

  // Error-charge lines indexed by channel + exact order reference (no short-code fallback).
  const lines: LineIndex = new Map();
  for (const d of lineDocs) {
    const l = d.data;
    if (!l || l.kind !== 'error_charge') continue;
    const keys = new Set([refKey(l.orderRef), refKey(l.orderRef2)].filter(Boolean) as string[]);
    for (const k of keys) { const key = `${l.channel}|${k}`; lines.set(key, [...(lines.get(key) ?? []), l]); }
  }

  const locName = (code?: string | null) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : 'Unmapped store');
  const storeByRef = new Map(allStores.map((s) => [`${s.channel}|${s.channelStoreId}`, s]));
  const storeOf = (o: StoredOrder) => storeByRef.get(`${o.channel}|${o.channelStoreId}`) ?? null;
  const storeIds = q.storeIds?.length ? new Set(q.storeIds) : null;
  const keep = (o: StoredOrder) =>
    o.channel in CHANNEL_LABELS && o.marketplace !== 'other' && // platform orders only (direct orders: not in v1)
    (!q.channels?.length || q.channels.includes(o.channel)) &&
    (!q.brands?.length || Boolean(o.brandName && q.brands.includes(o.brandName))) &&
    (!storeIds || storeIds.has(storeOf(o)?.id ?? ''));
  const orders = rawOrders.filter(keep);
  const inRange = (o: StoredOrder, a: number, b: number) => { const t = Date.parse(o.createdAt); return t >= a && t < b; };
  const cur = orders.filter((o) => inRange(o, from, toReq));
  const prev = orders.filter((o) => inRange(o, prevFrom, prevTo));

  // Downtime: the stores in scope with their opening hours.
  const stores = allStores.filter((s) =>
    (!q.locationCodes?.length || q.locationCodes.includes(s.locationCode)) &&
    (!q.channels?.length || q.channels.includes(s.channel)) &&
    (!q.brands?.length || q.brands.includes(s.brandName)) &&
    (!storeIds || storeIds.has(s.id)));
  const downCur = storeDowntime(stores, activity, hours, from, toEff, days, tz);
  const downPrev = storeDowntime(stores, activity, hours, prevFrom, prevTo, days, tz);
  if (downCur.some((d) => !d.hoursSet)) notes.push('no_hours_for_some_stores');

  const metricsOf = (os: StoredOrder[], ds: StoreDowntime[]) => {
    const om = orderMetrics(os, lines, goals);
    const dm = downtimeRaw(ds);
    const metrics = {
      missingIncorrect: finalize('missingIncorrect', om.missingIncorrect, goals),
      lateReady: finalize('lateReady', om.lateReady, goals),
      avoidableCancel: finalize('avoidableCancel', om.avoidableCancel, goals),
      downtime: finalize('downtime', dm, goals),
    } satisfies Record<OpsMetricKey, OpsRowMetric>;
    return { metrics, topDowntimeCause: dm.topCause };
  };

  const curAll = metricsOf(cur, downCur);
  const prevAll = metricsOf(prev, downPrev);
  const overall = Object.fromEntries(OPS_METRICS.map((k) => {
    const m = curAll.metrics[k]; const p = prevAll.metrics[k].value;
    return [k, { ...m, previous: p, changePts: r2(m.value - p) }];
  })) as Record<OpsMetricKey, OpsMetric>;

  // Rows: group orders and stores by the same key, then compute each metric from the group's own counts.
  const rows = (level: OpsRow['level'], orderKey: (o: StoredOrder) => string, storeKey: (s: ChannelStore) => string, describe: (key: string) => Omit<OpsRow, 'level' | 'key' | 'metrics' | 'topDowntimeCause'>): OpsRow[] => {
    const g = new Map<string, { os: StoredOrder[]; ds: StoreDowntime[] }>();
    const get = (k: string) => g.get(k) ?? g.set(k, { os: [], ds: [] }).get(k)!;
    for (const o of cur) get(orderKey(o)).os.push(o);
    for (const d of downCur) get(storeKey(d.store)).ds.push(d);
    return [...g.entries()].map(([key, v]) => {
      const m = metricsOf(v.os, v.ds);
      return { level, key, ...describe(key), metrics: m.metrics, ...(m.topDowntimeCause ? { topDowntimeCause: m.topDowntimeCause } : {}) };
    }).sort((a, b) => a.label.localeCompare(b.label));
  };
  const storeById = new Map(allStores.map((s) => [s.id, s]));
  const byStore = rows('store', (o) => storeOf(o)?.id ?? 'unmapped', (s) => s.id, (key) => {
    const s = storeById.get(key);
    if (!s) return { label: 'Unmapped store' };
    return { label: `${s.brandName} · ${locName(s.locationCode)} · ${CHANNEL_LABELS[s.channel] ?? s.channel}`, channel: s.channel, brandName: s.brandName, locationCode: s.locationCode };
  });
  const byBrand = rows('brand', (o) => o.brandName || storeOf(o)?.brandName || 'unmapped', (s) => s.brandName || 'unmapped', (key) => (key === 'unmapped' ? { label: 'Unmapped store' } : { label: key, brandName: key }));
  const byLocation = rows('location', (o) => o.locationCode || storeOf(o)?.locationCode || 'unmapped', (s) => s.locationCode || 'unmapped', (key) => (key === 'unmapped' ? { label: 'Unmapped store' } : { label: locName(key), locationCode: key }));
  const byChannel = rows('channel', (o) => o.channel, (s) => s.channel, (key) => ({ label: CHANNEL_LABELS[key as ChannelKey] ?? key, channel: key as ChannelKey }));

  const top5 = Object.fromEntries(OPS_METRICS.map((k) => [k, byStore.filter((r) => r.metrics[k].status !== 'no_data')
    .sort((a, b) => b.metrics[k].value - a.metrics[k].value || a.label.localeCompare(b.label)).slice(0, 5)
    .map((r): OpsTopRow => ({ storeId: r.key, label: r.label, value: r.metrics[k].value, numerator: r.metrics[k].numerator, denominator: r.metrics[k].denominator, goal: r.metrics[k].goal }))])) as Record<OpsMetricKey, OpsTopRow[]>;

  const causeFor = (k: OpsMetricKey, r: OpsRow): string | undefined => {
    if (k === 'downtime') return r.topDowntimeCause;
    if (k === 'avoidableCancel') { const c = r.metrics.avoidableCancel.extra.byCause as Record<CancelCause, number>; return c.pos > c.store ? 'pos' : 'store'; }
    if (k === 'missingIncorrect') { const e = r.metrics.missingIncorrect.extra as { reportedByKitchen: number; errorCharged: number }; return e.errorCharged > e.reportedByKitchen ? 'error_charge' : 'reported_by_kitchen'; }
    return undefined;
  };
  const score = (a: OpsAttention) => (a.goal > 0 ? a.value / a.goal : a.value);
  const attention = byStore.flatMap((r) => OPS_METRICS.filter((k) => r.metrics[k].status === 'attention').map((k): OpsAttention => {
    const m = r.metrics[k]; const cause = causeFor(k, r);
    return { metric: k, storeId: r.key, label: r.label, value: m.value, goal: m.goal, numerator: m.numerator, denominator: m.denominator, ...(cause ? { cause } : {}) };
  })).sort((a, b) => score(b) - score(a) || b.value - a.value).slice(0, 10);

  const truncated = [rawOrders, activity, lineDocs].some((l) => l.length >= ROW_CAP);
  return {
    range: { from: new Date(from).toISOString(), to: new Date(toReq).toISOString(), days, previousFrom: new Date(prevFrom).toISOString(), previousTo: new Date(prevTo).toISOString(), timezone: tz, truncated },
    goals,
    overall,
    byStore,
    byBrand,
    byLocation,
    byChannel,
    top5,
    attention,
    notes,
  };
}

export type OpsQuality = Awaited<ReturnType<typeof buildOpsQuality>>;
