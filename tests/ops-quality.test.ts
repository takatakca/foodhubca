// Operations quality (lib/foodhub/ops-quality.ts): 4 metrics vs the owner's goals, every platform at once.
// Test data is invented (Brand A, LOC_A, store-a…).
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityEntry, ChannelKey, OrderStatus, OrderTimeline, WeeklyHours } from '../lib/foodhub/types';

const FROM = '2026-09-14T04:00:00.000Z'; // Monday 2026-09-14 00:00 in Toronto (EDT)
const TO = '2026-09-15T04:00:00.000Z';
const NOW = Date.parse('2026-10-01T12:00:00Z');
const OWNER = { username: 'owner', name: 'Owner', source: 'dashboard' as const };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = 'America/Toronto';
  (globalThis as any).__foodhubMem = undefined;
});

async function mods() {
  const { getRepo } = await import('../lib/foodhub/repo');
  const ops = await import('../lib/foodhub/ops-quality');
  const { COL } = await import('../lib/foodhub/recon/engine');
  const { saveHours } = await import('../lib/foodhub/hours');
  return { repo: getRepo(), ops, COL, saveHours };
}

async function store(channel: ChannelKey, channelStoreId: string, brandName: string, locationCode = 'LOC_A') {
  const { repo } = await mods();
  return repo.upsertStore({ channel, channelStoreId, brandName, locationCode, autoAccept: false, online: true, meta: {} });
}

let seq = 0;
async function order(o: { channel?: ChannelKey; storeRef?: string; brand?: string; status: OrderStatus; timeline?: OrderTimeline; total?: number; createdAt?: string; readyBy?: string; id?: string }) {
  const { repo } = await mods();
  const at = o.createdAt ?? new Date(Date.parse('2026-09-14T16:00:00Z') + (seq++ % 600) * 60_000).toISOString();
  const channel = o.channel ?? 'uber_eats';
  const { order: row } = await repo.insertOrderIfNew({
    channel, marketplace: channel, externalOrderId: o.id ?? `EXT-${++seq}`, channelStoreId: o.storeRef ?? 'store-a', brandName: o.brand ?? 'Brand A', locationCode: 'LOC_A',
    fulfillment: 'delivery', placedAt: at, readyBy: o.readyBy, currency: 'CAD', subtotal: o.total ?? 20, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: o.total ?? 20, lines: [], raw: {}, createdAt: at,
  });
  await repo.patchOrder(row.id, o.timeline ?? {}, { status: o.status });
  return row;
}

const line = (id: string, channel: ChannelKey, orderRef: string, net: number, kind = 'error_charge') => ({
  id, key: orderRef.toLowerCase(), at: '2026-09-20T12:00:00.000Z',
  data: { id, importId: 'imp-1', channel, orderRef, orderRef2: null, storeRef: null, orderDate: '2026-09-20', payoutDate: null, payoutRef: null, kind, description: 'Error charge', sales: 0, tax: 0, commission: 0, commissionTax: 0, promotions: 0, adjustments: net, otherFees: 0, net, hasBreakdown: false, row: 1 },
});

const WEEK: WeeklyHours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open: '11:00', close: '20:00' }]])) as unknown as WeeklyHours;

describe('missing or incorrect orders', () => {
  it('counts kitchen-reported missing items and matching error-charge lines; another channel does not match', async () => {
    const { repo, ops, COL } = await mods();
    await store('uber_eats', 'store-a', 'Brand A');
    await order({ status: 'completed', id: 'EXT-MISS', timeline: { missingItems: [{ name: 'Fries', quantity: 1, at: '2026-09-14T17:00:00Z' }] } });
    await order({ status: 'dispatched', id: 'EXT-CHARGE' });
    await order({ status: 'completed', id: 'EXT-OTHER' });
    for (let i = 0; i < 7; i++) await order({ status: 'completed' });
    await order({ status: 'cancelled', id: 'EXT-CXL', timeline: { missingItems: [{ name: 'Drink', quantity: 1, at: '2026-09-14T17:00:00Z' }] } }); // not delivered: not in the denominator
    await repo.putDocs(COL.lines, [
      line('l1', 'uber_eats', '#ext-charge', -4.5),
      line('l2', 'doordash', 'EXT-OTHER', -3), // same id, other platform
      line('l3', 'uber_eats', 'EXT-OTHER', 10, 'order'), // not an error charge
    ]);
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.missingIncorrect).toMatchObject({ numerator: 2, denominator: 10, value: 20 });
    expect(r.overall.missingIncorrect.extra).toEqual({ reportedByKitchen: 1, errorCharged: 1, errorChargeAmount: 4.5 });
    expect(r.notes).toContain('direct_orders_not_included');
    expect(r.notes).not.toContain('no_statements_imported');
  });

  it('says when no payout statement was imported', async () => {
    const { ops } = await mods();
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.notes).toContain('no_statements_imported');
  });
});

describe('orders ready late', () => {
  it('grace boundary: exactly 5 min is on time, 5 min 1 s is late; auto-ready orders are left out and counted', async () => {
    const { ops } = await mods();
    await store('uber_eats', 'store-a', 'Brand A');
    const target = '2026-09-14T17:00:00.000Z';
    const plus = (s: number) => new Date(Date.parse(target) + s * 1000).toISOString();
    const onTime = { status: 'completed' as const, timeline: { readyTarget: target, readyAt: plus(300) } };
    const late = { status: 'completed' as const, timeline: { readyTarget: target, readyAt: plus(301) } };
    expect(ops.isLateReady(onTime, 5)).toBe(false);
    expect(ops.isLateReady(late, 5)).toBe(true);
    expect(ops.isLateReady({ status: 'cancelled', timeline: late.timeline }, 5)).toBeNull();
    expect(ops.isLateReady({ status: 'completed', timeline: { readyAt: target } }, 5)).toBeNull(); // no promised time
    const auto = { status: 'completed' as const, timeline: { readyTarget: target, readyAt: plus(900), dispatchedAt: plus(900) } };
    expect(ops.isLateReady(auto, 5)).toBeNull();
    expect(ops.isLateReady({ status: 'ready', readyBy: target, timeline: { readyAt: plus(600) } }, 5)).toBe(true); // readyBy when no readyTarget

    await order(onTime);
    await order(late);
    await order(auto);
    for (let i = 0; i < 9; i++) await order({ status: 'completed', timeline: { readyTarget: target, readyAt: plus(-60) } });
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.lateReady).toMatchObject({ numerator: 1, denominator: 11, value: 9.09, status: 'attention', goal: 5 });
    expect(r.overall.lateReady.extra).toEqual({ avgMinutesLate: 5, notMarkedReady: 1, notMarkedReadyPct: 8.33 });
  });
});

describe('avoidable cancellations', () => {
  it('POS / tablet reason → pos, cancelled by the store → store; customer cancels are not avoidable', async () => {
    const { ops } = await mods();
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelledBy: 'customer', cancelReason: 'Clover was down' } })).toBe('pos');
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelReason: 'Problème de tablette' } })).toBe('pos');
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelledBy: 'store', cancelReason: 'Out of chicken' } })).toBe('store');
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelledBy: 'platform' } })).toBe('platform');
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelledBy: 'customer', cancelReason: 'Changed my mind' } })).toBe('customer');
    expect(ops.cancelCause({ status: 'cancelled', timeline: { cancelReason: 'Postal code wrong' } })).toBe('unknown'); // "pos" only as a word
    expect(ops.cancelCause({ status: 'completed' })).toBeNull();

    await store('uber_eats', 'store-a', 'Brand A');
    await order({ status: 'cancelled', total: 30, timeline: { cancelledBy: 'store', cancelReason: 'Out of chicken' } });
    await order({ status: 'cancelled', total: 12.5, timeline: { cancelReason: 'Tablet offline' } });
    await order({ status: 'cancelled', timeline: { cancelledBy: 'customer' } });
    for (let i = 0; i < 7; i++) await order({ status: 'completed' });
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.avoidableCancel).toMatchObject({ numerator: 2, denominator: 10, value: 20 });
    expect(r.overall.avoidableCancel.extra).toMatchObject({ byCause: { store: 1, pos: 1, platform: 0, customer: 1, unknown: 0 }, lostSales: 42.5 });
    expect((r.overall.avoidableCancel.extra.topReasons as Array<{ reason: string }>).map((x) => x.reason).sort()).toEqual(['Out of chicken', 'Tablet offline']);
  });
});

describe('downtime', () => {
  it('counts only opening hours, attributes causes, no hours → no_data; equals analytics.offlineIntervals', async () => {
    const { repo, ops, saveHours } = await mods();
    const { offlineIntervals, seedState } = await import('../lib/foodhub/analytics');
    const a = await store('uber_eats', 'store-a', 'Brand A', 'LOC_A');
    const b = await store('doordash', 'store-b', 'Brand B', 'LOC_B');
    await saveHours({ locations: { LOC_A: WEEK }, brands: {}, holidays: [] });
    const ev = (at: string, action: string, source: ActivityEntry['source'] = 'platform', status: ActivityEntry['status'] = 'success'): ActivityEntry =>
      ({ at, action, source, status, kind: 'store_status', storeId: a.id, actor: 'x', summary: '' });
    // Open 11:00–20:00 local = 15:00Z → 00:01Z (the closing minute is included).
    const entries = [
      ev('2026-09-14T13:00:00.000Z', 'pause', 'dashboard'), // 09:00 local, before opening
      ev('2026-09-14T16:00:00.000Z', 'resume', 'dashboard'), // → 60 min offline during opening hours
      ev('2026-09-14T18:00:00.000Z', 'pause', 'automation', 'failed'), // ignored
      ev('2026-09-14T20:00:00.000Z', 'platform_paused'),
      ev('2026-09-14T20:30:00.000Z', 'platform_online'), // → 30 min
      ev('2026-09-14T23:30:00.000Z', 'platform_closed'), // → 31 min until 00:01Z
    ];
    for (const e of entries) await repo.addActivity(e);
    await repo.addActivity({ ...ev('2026-09-14T17:00:00.000Z', 'pause', 'automation'), storeId: b.id });
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.downtime).toMatchObject({ numerator: 121, denominator: 541, value: 22.37, status: 'attention' });
    expect(r.overall.downtime.extra).toEqual({ openMinutes: 541, offlineMinutes: 121, byCause: { paused_by_staff: 60, paused_auto: 0, platform_paused: 30, deactivated: 0, closed_on_platform: 31, unknown: 0 }, storesWithoutHours: 1 });
    expect(r.notes).toContain('no_hours_for_some_stores');
    const rowA = r.byStore.find((x) => x.key === a.id)!;
    const rowB = r.byStore.find((x) => x.key === b.id)!;
    expect(rowA.topDowntimeCause).toBe('paused_by_staff');
    expect(rowA.label).toBe('Brand A · LOC_A · Uber Eats');
    expect(rowB.metrics.downtime.status).toBe('no_data');
    expect(r.attention.find((x) => x.metric === 'downtime')).toMatchObject({ storeId: a.id, cause: 'paused_by_staff' });

    // Same state rules as analytics: the segment total equals offlineIntervals for the same input.
    const from = Date.parse(FROM); const to = Date.parse(TO);
    const seed = seedState(entries, a, from);
    const segs = ops.offlineSegments(entries, a, from, to, seed);
    const sum = (xs: Array<[number, number]>) => xs.reduce((s, [x, y]) => s + (y - x), 0);
    expect(sum(segs.map((s) => [s.start, s.end] as [number, number]))).toBe(sum(offlineIntervals(entries, a.id, from, to, seed)));
    expect(segs.map((s) => s.cause)).toEqual(['paused_by_staff', 'platform_paused', 'closed_on_platform']);
    // An offline seed with no starting event → unknown.
    expect(ops.offlineSegments([], a, from, to, 'offline')).toEqual([{ start: from, end: to, cause: 'unknown' }]);
  });
});

describe('status thresholds and the attention list', () => {
  it('< 10 orders is no_data, value > goal is attention, value = goal is on track; attention sorted by value / goal', async () => {
    const { ops } = await mods();
    await store('uber_eats', 'store-a', 'Brand A');
    await store('doordash', 'store-b', 'Brand B');
    // store-a: 9 orders, 1 store cancel → not enough data
    await order({ status: 'cancelled', timeline: { cancelledBy: 'store' } });
    for (let i = 0; i < 8; i++) await order({ status: 'completed' });
    let r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.avoidableCancel.status).toBe('no_data');
    expect(r.top5.avoidableCancel).toEqual([]);
    // 10th order: 1/10 = 10 % > goal 1 % → attention
    await order({ status: 'completed' });
    r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.overall.avoidableCancel).toMatchObject({ value: 10, status: 'attention' });
    // store-b: 10 orders, 3 ready late of 10 → 30 % vs goal 5 % (ratio 6) ; store-a cancels 10 % vs 1 % (ratio 10)
    const target = '2026-09-14T17:00:00.000Z';
    for (let i = 0; i < 10; i++) await order({ channel: 'doordash', storeRef: 'store-b', brand: 'Brand B', status: 'completed', timeline: { readyTarget: target, readyAt: i < 3 ? '2026-09-14T17:30:00.000Z' : target } });
    r = await ops.buildOpsQuality({ from: FROM, to: TO }, NOW);
    expect(r.attention.map((x) => [x.metric, x.label])).toEqual([['avoidableCancel', 'Brand A · LOC_A · Uber Eats'], ['lateReady', 'Brand B · LOC_A · DoorDash']]);
    expect(r.top5.lateReady[0]).toMatchObject({ value: 30, numerator: 3, denominator: 10 });
    // Rows add counts: the location row sums both stores.
    const loc = r.byLocation.find((x) => x.key === 'LOC_A')!;
    expect(loc.metrics.avoidableCancel).toMatchObject({ numerator: 1, denominator: 20, value: 5 });
    expect(r.byChannel.map((x) => x.label).sort()).toEqual(['DoorDash', 'Uber Eats']);
    // value equal to the goal → on track
    await ops.saveOpsGoals({ avoidableCancelPct: 10 }, OWNER);
    r = await ops.buildOpsQuality({ from: FROM, to: TO, storeIds: [r.byStore.find((x) => x.channel === 'uber_eats')!.key] }, NOW);
    expect(r.overall.avoidableCancel).toMatchObject({ value: 10, goal: 10, status: 'on_track' });
    expect(r.overall.lateReady.denominator).toBe(0); // store filter keeps store-a only
  });
});

describe('goals', () => {
  it('defaults, save then merge, invalid input throws, the save is logged', async () => {
    const { repo, ops } = await mods();
    expect(await ops.getOpsGoals()).toEqual(ops.DEFAULT_OPS_GOALS);
    await repo.setKv('ops_quality_goals_v1', { lateReadyPct: 'x', downtimePct: 150, missingIncorrectPct: 2 });
    expect(await ops.getOpsGoals()).toEqual({ ...ops.DEFAULT_OPS_GOALS, missingIncorrectPct: 2 }); // invalid stored fields ignored
    const saved = await ops.saveOpsGoals({ lateReadyPct: 8, lateGraceMin: 10 }, OWNER);
    expect(saved).toEqual({ ...ops.DEFAULT_OPS_GOALS, missingIncorrectPct: 2, lateReadyPct: 8, lateGraceMin: 10 });
    expect(await ops.getOpsGoals()).toEqual(saved);
    await expect(ops.saveOpsGoals({ downtimePct: 101 }, OWNER)).rejects.toThrow(/downtimePct/);
    await expect(ops.saveOpsGoals({ lateGraceMin: 2.5 }, OWNER)).rejects.toThrow(/lateGraceMin/);
    await expect(ops.saveOpsGoals({ lateGraceMin: 61 }, OWNER)).rejects.toThrow();
    await expect(ops.saveOpsGoals({ avoidableCancelPct: '3' }, OWNER)).rejects.toThrow();
    await expect(ops.saveOpsGoals(null, OWNER)).rejects.toThrow();
    expect(await ops.getOpsGoals()).toEqual(saved);
    const log = await repo.listActivity({ kinds: ['settings'] });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'ops_goals_saved', status: 'success', actor: 'Owner', source: 'dashboard' });
    expect(log[0].summary).toContain('8%');
  });
});

describe('routes', () => {
  it('GET 200 for the owner, 400 on a bad range; goals GET / PUT', async () => {
    const prev = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    try {
      const { GET } = await import('../app/api/foodhub/ops-quality/route');
      const goals = await import('../app/api/foodhub/ops-quality/goals/route');
      const auth = { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' };
      const get = (qs: string) => GET(new Request(`http://hub.local/api/foodhub/ops-quality?${qs}`, { headers: auth }) as any, {} as never);
      const ok = await get('from=2026-09-14&to=2026-09-14');
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body).toMatchObject({ ok: true, range: { days: 1 }, goals: { lateReadyPct: 5 } });
      expect(Object.keys(body.overall).sort()).toEqual(['avoidableCancel', 'downtime', 'lateReady', 'missingIncorrect']);
      expect((await get('from=2026-09-20&to=2026-09-10')).status).toBe(400);
      expect((await get('from=nope')).status).toBe(400);
      expect((await GET(new Request('http://hub.local/api/foodhub/ops-quality') as any, {} as never)).status).toBe(401);

      const put = (b: unknown) => goals.PUT(new Request('http://hub.local/api/foodhub/ops-quality/goals', { method: 'PUT', headers: auth, body: JSON.stringify(b) }) as any, {} as never);
      expect((await put({ downtimePct: -1 })).status).toBe(400);
      const saved = await put({ downtimePct: 2.5 });
      expect(saved.status).toBe(200);
      expect((await saved.json()).goals.downtimePct).toBe(2.5);
      const g = await (await goals.GET(new Request('http://hub.local/api/foodhub/ops-quality/goals', { headers: auth }) as any, {} as never)).json();
      expect(g).toMatchObject({ goals: { downtimePct: 2.5 }, defaults: { downtimePct: 1 } });
    } finally {
      if (prev === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = prev;
    }
  });
});

describe('empty range', () => {
  it('only finite numbers, every metric no_data', async () => {
    const { ops, saveHours } = await mods();
    await store('skip', 'store-c', 'Brand C');
    await saveHours({ locations: { LOC_A: WEEK }, brands: {}, holidays: [] });
    const r = await ops.buildOpsQuality({ from: FROM, to: TO }, Date.parse(FROM)); // "now" = start: no open minute has passed yet
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
    for (const k of ['missingIncorrect', 'lateReady', 'avoidableCancel', 'downtime'] as const) expect(r.overall[k]).toMatchObject({ value: 0, status: 'no_data', changePts: 0 });
    expect(r.attention).toEqual([]);
  });
});
