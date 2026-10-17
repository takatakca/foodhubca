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
import { isRelayStore } from './adapters/relay';
import { intersectIntervals, seedState, type AnalyticsQuery } from './analytics';
import { UserError } from './auth';
import { getCatalog } from './catalog';
import { CHANNEL_LABELS } from './config';
import { effectiveHours, getHours, holidaysFor, localDate, openIntervals } from './hours';
import { COL, refKey } from './recon/engine';
import type { PayoutLine } from './recon/statements';
import { getRepo } from './repo';
import { ROW_CAP } from './reports';
import { foodhubTimeZone, startOfLocalDayMs } from './time';
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
// Strict: an unknown field (a typo) or an empty / unreadable body is a 400, never a silent "saved" with nothing changed.
const GOALS_SCHEMA = z.strictObject({
  missingIncorrectPct: pctField.optional(),
  lateReadyPct: pctField.optional(),
  avoidableCancelPct: pctField.optional(),
  downtimePct: pctField.optional(),
  lateGraceMin: graceField.optional(),
}).refine((o) => Object.values(o).some((v) => v !== undefined), 'nothing to save');

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

/** Validates (each % 0–100, grace an integer 0–60), saves over the current goals and logs it. Invalid input → UserError (a 400). */
export async function saveOpsGoals(input: unknown, actor: Actor): Promise<OpsGoals> {
  const parsed = GOALS_SCHEMA.safeParse(input);
  if (!parsed.success) {
    throw new UserError(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'goals'}: ${i.message}`).join('; '));
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
/** Cap of the second payout-line read (lines with a payout date only, 7–45 days after the range). */
export const LATE_LINE_CAP = 10_000;

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

/**
 * courier.ts fills readyAt at pickup when nobody tapped Ready: such an order has no real ready time. (Its "delivered"
 * path without a pickup update leaves readyAt empty: see neverMarkedReady.)
 */
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
/** A delivered / picked-up order nobody marked ready: ready time filled in at pickup, or no ready time at all. */
export const neverMarkedReady = (o: Pick<StoredOrder, 'timeline'>) => isAutoReady(o) || !o.timeline?.readyAt;

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
  /** Previous period's percent; null when that period did not have enough data to compare with. */
  previous: number | null;
  previousStatus: OpsStatus;
  /** value − previous, in percentage points (0 when previous is null). */
  changePts: number;
  numerator: number;
  denominator: number;
  goal: number;
  status: OpsStatus;
  extra: Record<string, unknown>;
}
export type OpsRowMetric = Omit<OpsMetric, 'previous' | 'previousStatus' | 'changePts'>;
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
  const notMarked = done.filter(neverMarkedReady).length;
  // 3) avoidable cancellations
  const byCause: Record<CancelCause, number> = { store: 0, pos: 0, platform: 0, customer: 0, unknown: 0 };
  const avoidable: StoredOrder[] = [];
  for (const o of orders) {
    const c = cancelCause(o);
    if (!c) continue;
    byCause[c]++;
    if (AVOIDABLE.has(c)) avoidable.push(o);
  }
  return {
    missingIncorrect: { num: missNum, den: done.length, extra: { reportedByKitchen: reported, errorCharged: charged, errorChargeAmount: r2(amount) } },
    lateReady: { num: lateNum, den: lateDen, extra: { avgMinutesLate: lateNum ? r1(lateMin / lateNum) : 0, notMarkedReady: notMarked, notMarkedReadyPct: pct(notMarked, done.length) } },
    avoidableCancel: {
      num: avoidable.length, den: orders.length,
      // No free-text cancel reasons in the response: platform or staff text can carry a customer's name or phone number.
      extra: { byCause, lostSales: r2(avoidable.reduce((s, o) => s + (Number(o.total) || 0), 0)) },
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

function storeDowntime(stores: ChannelStore[], activityOf: Map<string, ActivityEntry[]>, hours: Awaited<ReturnType<typeof getHours>>, from: number, to: number, days: number, tz: string): StoreDowntime[] {
  return stores.map((s) => {
    const week = effectiveHours(hours, s.brandName, s.locationCode);
    if (!week || to <= from) return { store: s, hoursSet: Boolean(week), openMs: 0, offMs: 0, byCause: emptyCauses() };
    const open: Interval[] = openIntervals(week, holidaysFor(hours, s.locationCode, localDate(from, tz), days + 1), from, to, tz);
    const openMs = open.reduce((a, [x, y]) => a + (y - x), 0);
    const activity = activityOf.get(s.id) ?? [];
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
  const days = Math.max(1, Math.round(span / DAY));
  // Previous period = the same number of local calendar days before `from` (buildAnalytics' rule): stepped day by day
  // so a range across a DST change still starts at local midnight and lines up with the Insights page.
  let prevFrom = from - span;
  if (startOfLocalDayMs(from, tz) === from) { prevFrom = from; for (let i = 0; i < days; i++) prevFrom = startOfLocalDayMs(prevFrom - 12 * 3600_000, tz); }
  const prevTo = from;
  // Downtime stops at "now": the rest of today has not happened yet (orders cannot exist there anyway).
  const toEff = Math.min(toReq, Math.max(now, from));
  const repo = getRepo();
  const iso = (t: number) => new Date(t).toISOString();
  const [goals, catalog, hours, curRaw, prevRaw, allStores, activity, lineDocs, lateLineDocs, anyLine] = await Promise.all([
    getOpsGoals(),
    getCatalog(),
    getHours(),
    // One capped query per period (as buildAnalytics does): a busy range can never cut the previous period silently.
    repo.listOrders({ since: iso(from), until: iso(toReq), limit: ROW_CAP, locationCodes: q.locationCodes }),
    repo.listOrders({ since: iso(prevFrom), until: iso(prevTo), limit: ROW_CAP, locationCodes: q.locationCodes }),
    repo.listStores(),
    repo.listActivity({ since: iso(prevFrom - 30 * DAY), until: iso(toEff), kinds: ['store_status'], limit: ROW_CAP, locationCodes: q.locationCodes }),
    // Every line kind in the window: Uber lines carry Food Hub's order id in orderRef2 while the doc key is orderRef,
    // so a `keys` query would miss them. Only error_charge lines are kept below. A line is dated by its orderDate when
    // it has one (the common case), so the window hugs the two periods: a capped read keeps lines of these orders.
    repo.listDocs<PayoutLine>(COL.lines, { since: iso(prevFrom - 7 * DAY), until: iso(toReq + 7 * DAY), limit: ROW_CAP }),
    // A line with no orderDate is dated by its payout date, which can come weeks later: a smaller read of that late
    // window keeps only such error charges.
    repo.listDocs<PayoutLine>(COL.lines, { since: iso(toReq + 7 * DAY), until: iso(toReq + 45 * DAY), limit: LATE_LINE_CAP }),
    repo.listDocs(COL.lines, { limit: 1 }),
  ]);
  const notes: string[] = ['direct_orders_not_included'];
  if (!anyLine.length) notes.push('no_statements_imported');
  if (lineDocs.length >= ROW_CAP || lateLineDocs.length >= LATE_LINE_CAP) notes.push('statements_truncated');

  // Error-charge lines indexed by channel + exact order reference (no short-code fallback).
  const lines: LineIndex = new Map();
  for (const d of [...lineDocs, ...lateLineDocs.filter((x) => !x.data?.orderDate)]) {
    const l = d.data;
    if (!l || l.kind !== 'error_charge') continue;
    const keys = new Set([refKey(l.orderRef), refKey(l.orderRef2)].filter(Boolean) as string[]);
    for (const k of keys) {
      const key = `${l.channel}|${k}`;
      const list = lines.get(key);
      if (list) list.push(l); else lines.set(key, [l]);
    }
  }

  const locName = (code?: string | null) => (code ? catalog.locations.find((l) => l.code === code)?.name ?? code : 'Unmapped location');
  const storeByRef = new Map(allStores.map((s) => [`${s.channel}|${s.channelStoreId}`, s]));
  const storeOf = (o: StoredOrder) => storeByRef.get(`${o.channel}|${o.channelStoreId}`) ?? null;
  // One brand per order, used for the filter and the brand row alike: the mapped store's brand wins over the order's own text.
  const brandOf = (o: StoredOrder) => storeOf(o)?.brandName || o.brandName || '';
  // Location: the order's own code first — it is what the location scope (a manager's locations) is applied to.
  const locOf = (o: StoredOrder) => o.locationCode || storeOf(o)?.locationCode || '';
  const storeIds = q.storeIds?.length ? new Set(q.storeIds) : null;
  const keep = (o: StoredOrder) =>
    o.channel in CHANNEL_LABELS && o.marketplace !== 'other' && // platform orders only (direct orders: not in v1)
    (!q.channels?.length || q.channels.includes(o.channel)) &&
    (!q.brands?.length || q.brands.includes(brandOf(o))) &&
    (!storeIds || storeIds.has(storeOf(o)?.id ?? ''));
  const cur = curRaw.filter(keep);
  const prev = prevRaw.filter(keep);

  // Downtime: the stores in scope with their opening hours. Relay stores ("relay:…") receive orders only and never a
  // store status, so they would always look 100 % online: they are left out of downtime (and said so).
  const scoped = allStores.filter((s) =>
    (!q.locationCodes?.length || q.locationCodes.includes(s.locationCode)) &&
    (!q.channels?.length || q.channels.includes(s.channel)) &&
    (!q.brands?.length || q.brands.includes(s.brandName)) &&
    (!storeIds || storeIds.has(s.id)));
  const stores = scoped.filter((s) => !isRelayStore(s));
  if (stores.length < scoped.length) notes.push('relay_stores_no_status');
  const activityOf = new Map<string, ActivityEntry[]>();
  for (const e of activity) {
    if (!e.storeId) continue;
    const list = activityOf.get(e.storeId);
    if (list) list.push(e); else activityOf.set(e.storeId, [e]);
  }
  const downCur = storeDowntime(stores, activityOf, hours, from, toEff, days, tz);
  const downPrev = storeDowntime(stores, activityOf, hours, prevFrom, prevTo, days, tz);
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
    // A previous period without enough data (a new store, 0 orders) is no baseline: no fake "+20 pts vs 0 %" trend.
    const m = curAll.metrics[k]; const p = prevAll.metrics[k];
    const comparable = p.status !== 'no_data';
    return [k, { ...m, previous: comparable ? p.value : null, previousStatus: p.status, changePts: comparable ? r2(m.value - p.value) : 0 }];
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
  const byBrand = rows('brand', (o) => brandOf(o) || 'unmapped', (s) => s.brandName || 'unmapped', (key) => (key === 'unmapped' ? { label: 'Unmapped brand' } : { label: key, brandName: key }));
  const byLocation = rows('location', (o) => locOf(o) || 'unmapped', (s) => s.locationCode || 'unmapped', (key) => (key === 'unmapped' ? { label: 'Unmapped location' } : { label: locName(key), locationCode: key }));
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

  // Orders and store status only; cut payout statements have their own note ('statements_truncated').
  const truncated = [curRaw, prevRaw, activity].some((l) => l.length >= ROW_CAP);
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
