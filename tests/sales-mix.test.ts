// Sales mix (task 43, package sales-mix): every platform + direct orders, the same dish merged across channels,
// local hour / weekday (DST-safe), lost sales, previous period, filters, popular rule, CSV / Excel export and the route.
// All data below is invented (no real store, person or phone).
import { beforeEach, describe, expect, it } from 'vitest';
import { factSales, itemKey, salesMixTable, sourceOf } from '../lib/foodhub/sales-mix';
import { renderReport } from '../lib/foodhub/reports';

type Line = { name: string; quantity: number; total: number; posItemRef?: string };
const line = (name: string, quantity: number, total: number, posItemRef?: string): Line => ({ name, quantity, total, posItemRef });

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = 'America/Toronto';
  (globalThis as any).__foodhubMem = undefined;
});

let seq = 0;
async function platform(o: { channel: 'uber_eats' | 'doordash' | 'skip' | 'tgtg'; at: string; brand?: string; loc?: string; lines?: Line[]; subtotal?: number; total?: number; tax?: number; deliveryFee?: number; tip?: number; status?: string; fulfillment?: 'delivery' | 'pickup' | 'dine_in' }) {
  const { getRepo } = await import('../lib/foodhub/repo');
  const repo = getRepo();
  const lines = (o.lines ?? [line('Test dish', 1, 10)]).map((l) => ({ ...l, unitPrice: l.total / (l.quantity || 1), modifiers: [] }));
  const subtotal = o.subtotal ?? lines.reduce((s, l) => s + l.total, 0);
  const { order } = await repo.insertOrderIfNew({
    channel: o.channel, marketplace: o.channel, externalOrderId: `ext-${++seq}`, channelStoreId: 'store-test', brandName: o.brand ?? 'Brand A', fulfillment: o.fulfillment ?? 'delivery',
    placedAt: o.at, createdAt: o.at, currency: 'CAD', subtotal, tax: o.tax ?? 0, deliveryFee: o.deliveryFee ?? 0, tip: o.tip ?? 0, discount: 0, total: o.total ?? subtotal, lines, raw: {}, locationCode: o.loc ?? 'LOC_A',
  });
  if (o.status) await repo.updateOrder(order.id, { status: o.status as any });
  return order;
}

async function direct(o: { source: 'phone' | 'phone_ai' | 'website' | 'clover_online' | 'clover' | 'manual'; at: string; brand?: string; loc?: string; lines?: Line[]; subtotal?: number; total?: number; status?: string; fulfillment?: 'pickup' | 'delivery' }) {
  const { getRepo } = await import('../lib/foodhub/repo');
  const { DIRECT_ORDERS } = await import('../lib/foodhub/delivery/store');
  const lines = (o.lines ?? [line('Test dish', 1, 10)]).map((l) => ({ ...l, unitPrice: l.total / (l.quantity || 1), modifiers: [] }));
  const subtotal = o.subtotal ?? lines.reduce((s, l) => s + l.total, 0);
  const id = `dir_${++seq}`;
  const data = { id, number: `T-${seq}`, source: o.source, brandName: o.brand ?? 'Brand A', locationCode: o.loc ?? 'LOC_A', customer: {}, fulfillment: o.fulfillment ?? 'pickup', lines, subtotal, tax: 0, deliveryFee: 0, tip: 0,
    total: o.total ?? subtotal, currency: 'CAD', payment: 'paid', status: o.status ?? 'completed', containsAlcohol: false, placedAt: o.at, events: [], createdAt: o.at, updatedAt: o.at };
  await getRepo().putDocs(DIRECT_ORDERS, [{ id, key: o.loc ?? 'LOC_A', at: o.at, data }]);
}

const mix = async (q: Record<string, unknown>, now = Date.parse('2027-01-01T00:00:00Z')) => {
  const { buildSalesMix } = await import('../lib/foodhub/sales-mix');
  return buildSalesMix({ from: '2026-10-05T04:00:00.000Z', to: '2026-10-12T04:00:00.000Z', ...q } as any, now);
};

describe('sources and sales', () => {
  it('(1) maps every source: platforms stay themselves, phone_ai stays separate, clover_online is the website', () => {
    expect(sourceOf({ channel: 'doordash' })).toBe('doordash');
    expect(sourceOf({ source: 'phone' })).toBe('phone');
    expect(sourceOf({ source: 'phone_ai' })).toBe('phone_ai');
    expect(sourceOf({ source: 'website' })).toBe('website');
    expect(sourceOf({ source: 'clover_online' })).toBe('website');
    expect(sourceOf({ source: 'clover' })).toBe('clover');
    expect(sourceOf({ source: 'manual' })).toBe('manual');
  });

  it('(2) sales = subtotal; without one, total − tax − delivery fee − tip, never below 0', () => {
    expect(factSales({ subtotal: 20, total: 31, tax: 3, deliveryFee: 5, tip: 3 })).toBe(20);
    expect(factSales({ subtotal: 0, total: 31.5, tax: 3.15, deliveryFee: 4.99, tip: 2 })).toBe(21.36);
    expect(factSales({ subtotal: 0, total: 2, tax: 3, deliveryFee: 0, tip: 0 })).toBe(0);
    expect(factSales({ total: NaN as any })).toBe(0);
  });
});

describe('(3) one dish across every channel', () => {
  it('itemKey merges by Clover id, else by name without accents / case / spaces; brands stay apart', () => {
    expect(itemKey('Brand A', { posItemRef: 'CLV1', name: 'Poutine' })).toBe('Brand A|pos:CLV1');
    expect(itemKey('Brand A', { name: '  Poutine   Végé ' })).toBe(itemKey('Brand A', { name: 'poutine vege' }));
    expect(itemKey('Brand A', { name: 'Poutine' })).not.toBe(itemKey('Brand B', { name: 'Poutine' }));
  });

  it('merges the same posItemRef from Uber Eats, DoorDash and the phone, and accent/case name variants', async () => {
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: [line('Poutine classique', 1, 10, 'CLV1')] });
    await platform({ channel: 'doordash', at: '2026-10-06T17:00:00Z', lines: [line('POUTINE CLASSIQUE (DD)', 2, 20, 'CLV1')] });
    await direct({ source: 'phone', at: '2026-10-06T18:00:00Z', lines: [line('Poutine classique', 1, 10, 'CLV1')] });
    await platform({ channel: 'skip', at: '2026-10-06T19:00:00Z', lines: [line('Crème brûlée', 1, 5)] });
    await direct({ source: 'website', at: '2026-10-06T19:30:00Z', lines: [line('creme  BRULEE', 2, 10)] });
    await platform({ channel: 'uber_eats', at: '2026-10-06T20:00:00Z', brand: 'Brand B', lines: [line('Poutine classique', 1, 9, 'CLV1')] });
    const m = await mix({});
    const poutine = m.items.find((i) => i.key === 'Brand A|pos:CLV1')!;
    expect(poutine).toMatchObject({ qty: 4, sales: 40, orders: 3, name: 'Poutine classique', avgPrice: 10, bySource: { uber_eats: 1, doordash: 2, phone: 1 } });
    const creme = m.items.find((i) => i.key === 'Brand A|name:creme brulee')!;
    expect(creme).toMatchObject({ qty: 3, sales: 15, bySource: { skip: 1, website: 2 } });
    expect(m.items.find((i) => i.key === 'Brand B|pos:CLV1')).toMatchObject({ qty: 1, brand: 'Brand B' });
    expect(m.items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(m.items[0].key).toBe('Brand A|pos:CLV1');
  });
});

describe('(4) local hour and weekday', () => {
  it('uses Montréal time across the fall-back week and counts each weekday’s days', async () => {
    // Mon Oct 26 2026 10:00 EDT (14:00Z) and Sun Nov 1 2026 10:00 EST (15:00Z, after the change) and 23:30 EST Sun = 04:30Z Mon.
    await platform({ channel: 'uber_eats', at: '2026-10-26T14:00:00Z' });
    await platform({ channel: 'uber_eats', at: '2026-11-01T15:00:00Z' });
    await direct({ source: 'phone', at: '2026-11-02T04:30:00Z' });
    // Oct 26 → Nov 4 inclusive (10 local days)
    const m = await mix({ from: '2026-10-26T04:00:00.000Z', to: '2026-11-05T05:00:00.000Z' });
    expect(m.byHour).toHaveLength(24);
    expect(m.byHour[10].orders).toBe(2);
    expect(m.byHour[23].orders).toBe(1);
    expect(m.byWeekday).toHaveLength(7);
    expect(m.byWeekday[0].orders).toBe(1); // Monday
    expect(m.byWeekday[6].orders).toBe(2); // Sunday 10:00 + 23:30
    expect(m.byWeekday.map((d) => d.days)).toEqual([2, 2, 2, 1, 1, 1, 1]);
    expect(m.byWeekday[6].avgSalesPerDay).toBe(20);
    expect(m.heatmap.orders[6][10]).toBe(1);
    expect(m.heatmap.orders[6][23]).toBe(1);
    expect(m.heatmap.sales[0][10]).toBe(10);
  });

  it('spring-forward week: one day per weekday, 7 in all', async () => {
    const m = await mix({ from: '2026-03-02T05:00:00.000Z', to: '2026-03-09T04:00:00.000Z' });
    expect(m.byWeekday.map((d) => d.days)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('(5)(6) lost sales and the previous period', () => {
  it('cancelled orders only count as lost', async () => {
    await platform({ channel: 'doordash', at: '2026-10-06T16:00:00Z', lines: [line('Wrap', 2, 24)] });
    await platform({ channel: 'doordash', at: '2026-10-06T17:00:00Z', lines: [line('Wrap', 1, 12)], status: 'cancelled' });
    await direct({ source: 'phone_ai', at: '2026-10-06T18:00:00Z', lines: [line('Wrap', 1, 12)], status: 'cancelled' });
    const m = await mix({});
    expect(m.totals).toMatchObject({ orders: 1, sales: 24, itemsSold: 2, lostOrders: 2, lostSales: 24 });
    expect(m.items[0]).toMatchObject({ qty: 2, lostQty: 2, sales: 24, orders: 1 });
    const dd = m.bySource.find((s) => s.key === 'doordash')!;
    expect(dd).toMatchObject({ orders: 1, sales: 24, lostOrders: 1, lostSales: 12, group: 'platform', label: 'DoorDash' });
    expect(m.bySource.find((s) => s.key === 'phone_ai')).toMatchObject({ orders: 0, sales: 0, lostOrders: 1, group: 'direct', label: 'Téléphone IA', labelEn: 'AI phone' });
  });

  it('compares with the same length just before', async () => {
    await platform({ channel: 'uber_eats', at: '2026-09-30T16:00:00Z', lines: [line('Wrap', 1, 10)] }); // previous week
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: [line('Wrap', 3, 30)] });
    await platform({ channel: 'uber_eats', at: '2026-09-20T16:00:00Z', lines: [line('Wrap', 9, 90)] }); // before both
    const m = await mix({});
    expect(m.range.previousFrom).toBe('2026-09-28T04:00:00.000Z');
    expect(m.range.previousTo).toBe('2026-10-05T04:00:00.000Z');
    expect(m.totals).toMatchObject({ sales: 30, prevSales: 10, salesChange: 200, orders: 1, prevOrders: 1, ordersChange: 0 });
    expect(m.items[0]).toMatchObject({ qty: 3, prevQty: 1, change: 200 });
    expect(m.bySource[0]).toMatchObject({ prevSales: 10, change: 200 });
  });
});

describe('(7) filters', () => {
  beforeEach(async () => {
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', loc: 'LOC_A' });
    await platform({ channel: 'doordash', at: '2026-10-06T16:10:00Z', loc: 'LOC_B', brand: 'Brand B' });
    await direct({ source: 'phone', at: '2026-10-06T16:20:00Z', loc: 'LOC_A' });
    await direct({ source: 'clover', at: '2026-10-06T16:30:00Z', loc: 'LOC_B' });
  });
  const keys = (m: Awaited<ReturnType<typeof mix>>) => m.bySource.map((s) => s.key).sort();

  it('direct=include (default), exclude and only', async () => {
    expect(keys(await mix({}))).toEqual(['clover', 'doordash', 'phone', 'uber_eats']);
    expect(keys(await mix({ direct: 'exclude' }))).toEqual(['doordash', 'uber_eats']);
    expect(keys(await mix({ direct: 'only' }))).toEqual(['clover', 'phone']);
  });

  it('picking platform channels drops direct orders unless direct=include', async () => {
    expect(keys(await mix({ channels: ['doordash'] }))).toEqual(['doordash']);
    expect(keys(await mix({ channels: ['doordash'], direct: 'include' }))).toEqual(['clover', 'doordash', 'phone']);
  });

  it('sources (unknown ignored), locations, brands and the empty scope', async () => {
    expect(keys(await mix({ sources: ['phone', 'nope', 'uber_eats'] }))).toEqual(['phone', 'uber_eats']);
    expect(keys(await mix({ sources: ['nope'] }))).toEqual(['clover', 'doordash', 'phone', 'uber_eats']);
    expect(keys(await mix({ locationCodes: ['LOC_B'] }))).toEqual(['clover', 'doordash']);
    expect(keys(await mix({ brands: ['Brand B'] }))).toEqual(['doordash']);
    const none = await mix({ locationCodes: ['__none__'] });
    expect(none.totals.orders).toBe(0);
    expect(none.items).toEqual([]);
    expect(none.bySource).toEqual([]);
  });

  it('by location uses the catalog name (code when unknown) and by fulfillment', async () => {
    const m = await mix({});
    expect(m.byLocation.map((l) => l.label).sort()).toEqual(['LOC_A', 'LOC_B']);
    expect(m.byFulfillment.map((f) => [f.key, f.label, f.labelEn]).sort()).toEqual([['delivery', 'Livraison', 'Delivery'], ['pickup', 'À emporter', 'Pickup']]);
    expect(m.byFulfillment.reduce((s, f) => s + f.share, 0)).toBe(100);
  });
});

describe('(8) popular', () => {
  it('top max(3, 10 % of sold items) are popular', async () => {
    const lines = Array.from({ length: 35 }, (_, i) => line(`Dish ${String(i).padStart(2, '0')}`, 1, 100 - i));
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines });
    const m = await mix({});
    expect(m.items.filter((i) => i.popular).map((i) => i.rank)).toEqual([1, 2, 3, 4]); // ceil(3.5) = 4
    (globalThis as any).__foodhubMem = undefined;
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: lines.slice(0, 5) });
    expect((await mix({})).items.filter((i) => i.popular)).toHaveLength(3);
  });
});

describe('(9)(10) export', () => {
  it('French and English headers, weekday names, hours and the file name', async () => {
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: [line('Wrap', 1, 10)] });
    await direct({ source: 'phone', at: '2026-10-06T17:00:00Z', lines: [line('Wrap', 1, 10)] });
    const m = await mix({});
    const fr = salesMixTable(m, 'items');
    expect(fr.columns.slice(0, 11)).toEqual(['Rang', 'Marque', 'Article', 'Quantité', 'Ventes', 'Commandes', 'Part %', 'Prix moyen', 'Quantité préc.', 'Variation %', 'Quantité annulée']);
    expect(fr.columns.length).toBe(13); // + Uber Eats, Téléphone
    expect(fr.filename).toBe('takatak-sales-mix-items-2026-10-05_to_2026-10-11');
    const en = salesMixTable(m, 'items', 'en');
    expect(en.columns.slice(0, 11)).toEqual(['Rank', 'Brand', 'Item', 'Quantity', 'Sales', 'Orders', 'Share %', 'Average price', 'Prev quantity', 'Change %', 'Cancelled quantity']);
    expect(en.rows[0].slice(0, 5)).toEqual([1, 'Brand A', 'Wrap', 2, 20]);
    expect(salesMixTable(m, 'weekdays').rows.map((r) => r[0])).toEqual(['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']);
    expect(salesMixTable(m, 'weekdays', 'en').rows.map((r) => r[0])).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const hours = salesMixTable(m, 'hours');
    expect(hours.rows.map((r) => r[0])).toEqual(Array.from({ length: 24 }, (_, h) => `${h}h`));
    expect(hours.filename).toBe('takatak-sales-mix-hours-2026-10-05_to_2026-10-11');
    expect(salesMixTable(m, 'sources', 'en').columns[0]).toBe('Channel');
    expect(salesMixTable(m, 'fulfillment').rows.map((r) => r[0]).sort()).toEqual(['Livraison', 'À emporter']);
  });

  it('CSV starts with the BOM and neutralises a formula-looking item name', async () => {
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: [line('=cmd', 1, 10)] });
    const file = renderReport(salesMixTable(await mix({}), 'items'), 'csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    const body = String(file.body);
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain(`"'=cmd"`);
    expect(body).not.toMatch(/,=cmd/);
    const xlsx = renderReport(salesMixTable(await mix({}), 'hours'), 'xlsx');
    expect(xlsx.filename.endsWith('.xlsx')).toBe(true);
  });
});

describe('(11) GET /api/foodhub/sales-mix', () => {
  const call = async (qs: string) => {
    const prev = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    try {
      const { GET } = await import('../app/api/foodhub/sales-mix/route');
      return await GET(new Request(`http://hub.local/api/foodhub/sales-mix?${qs}`, { headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}` } }) as any, {} as never);
    } finally {
      if (prev === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = prev;
    }
  };

  it('json for the owner, csv attachment, 400 on a bad table, direct value or range', async () => {
    await platform({ channel: 'uber_eats', at: '2026-10-06T16:00:00Z', lines: [line('Wrap', 1, 10), line('Fries', 1, 4)] });
    const res = await call('from=2026-10-05&to=2026-10-11&limit=1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, itemsTotal: 2, totals: { orders: 1, sales: 14 } });
    expect(body.items).toHaveLength(1);
    const csv = await call('from=2026-10-05&to=2026-10-11&format=csv&table=hours&lang=en');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('takatak-sales-mix-hours-2026-10-05_to_2026-10-11.csv');
    expect(csv.headers.get('cache-control')).toBe('no-store');
    expect((await call('from=2026-10-05&to=2026-10-11&table=nope')).status).toBe(400);
    expect((await call('from=2026-10-05&to=2026-10-11&direct=maybe')).status).toBe(400);
    expect((await call('from=2026-10-11&to=2026-10-05')).status).toBe(400);
    expect((await call('from=not-a-date')).status).toBe(400);
  });

  it('refuses without sign-in', async () => {
    const { GET } = await import('../app/api/foodhub/sales-mix/route');
    const res = await GET(new Request('http://hub.local/api/foodhub/sales-mix') as any, {} as never);
    expect(res.status).toBe(401);
  });
});

describe('(12) empty period', () => {
  it('only finite numbers, 24 hours and 7 weekdays', async () => {
    const m = await mix({});
    expect(m.byHour).toHaveLength(24);
    expect(m.byWeekday).toHaveLength(7);
    expect(m.heatmap.orders).toHaveLength(7);
    expect(m.heatmap.sales.every((r) => r.length === 24)).toBe(true);
    const nums: number[] = [];
    const walk = (v: unknown) => { if (typeof v === 'number') nums.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(m);
    expect(nums.length).toBeGreaterThan(100);
    expect(nums.every(Number.isFinite)).toBe(true);
    expect(m.totals).toMatchObject({ orders: 0, sales: 0, aov: 0, salesChange: 0, ordersChange: 0 });
    expect(m.range.truncated).toBe(false);
  });
});
