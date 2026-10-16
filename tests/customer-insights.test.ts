// Customer insights: new / occasional / frequent across every platform and direct orders, anonymous ids only.
// All data below is invented (555-01xx phones, example.com e-mails, placeholder brands).
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCustomerInsights, directCustomerKey, hashCustomerKey, normalizePhone, tierOf } from '../lib/foodhub/customer-insights';
import { DIRECT_ORDERS } from '../lib/foodhub/delivery/store';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelKey } from '../lib/foodhub/types';

const DAY = 86400_000;
const FROM = '2026-09-01T04:00:00.000Z'; // Sept 1, local midnight (Montréal)
const TO = '2026-10-01T04:00:00.000Z';
const NOW = Date.parse('2026-10-02T12:00:00Z');
const at = (iso: string, deltaMs = 0) => new Date(Date.parse(iso) + deltaMs).toISOString();

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = 'America/Toronto';
  (globalThis as any).__foodhubMem = undefined;
});

let seq = 0;
async function plat(when: string, opts: { channel?: ChannelKey; customer?: string | null; brand?: string; total?: number; status?: 'cancelled' | 'completed'; location?: string; name?: string } = {}) {
  const channel = opts.channel ?? 'uber_eats';
  const raw = opts.customer ? (channel === 'uber_eats' ? { eater: { id: opts.customer } } : { consumer: { id: opts.customer } }) : {};
  const total = opts.total ?? 20;
  const { order } = await getRepo().insertOrderIfNew({
    channel, marketplace: channel, externalOrderId: `ext-${++seq}`, channelStoreId: 'store-test', brandName: opts.brand ?? 'Brand A', customerName: opts.name,
    fulfillment: 'delivery', placedAt: when, createdAt: when, currency: 'CAD', subtotal: total, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total, lines: [], raw,
    locationCode: opts.location ?? 'LOC_A',
  });
  if (opts.status) await getRepo().updateOrder(order.id, { status: opts.status });
  return order;
}

async function direct(when: string, opts: { phone?: string; email?: string; name?: string; brand?: string; total?: number; status?: string; source?: string; location?: string } = {}) {
  const id = `do_${++seq}`;
  const data = {
    id, number: `T-${seq}`, source: opts.source ?? 'phone', brandName: opts.brand ?? 'Brand A', locationCode: opts.location ?? 'LOC_A',
    customer: { name: opts.name, phone: opts.phone, email: opts.email }, fulfillment: 'delivery',
    dropoff: { street: '1 Test Street', city: 'Testville', postalCode: 'H0H 0H0' },
    lines: [], subtotal: opts.total ?? 30, tax: 0, deliveryFee: 0, tip: 0, total: opts.total ?? 30, currency: 'CAD', payment: 'paid',
    status: opts.status ?? 'completed', containsAlcohol: false, placedAt: when, events: [], createdAt: when, updatedAt: when,
  };
  await getRepo().putDocs(DIRECT_ORDERS, [{ id, key: data.locationCode, at: when, data }]);
}

const run = (extra: Partial<Parameters<typeof buildCustomerInsights>[0]> = {}, range = { from: FROM, to: TO }, now = NOW) => buildCustomerInsights({ ...range, ...extra }, now);

describe('identity helpers', () => {
  it('(1) normalizePhone keeps 10 digits, drops a leading 1, refuses the rest', () => {
    expect(normalizePhone('+1 (514) 555-0100')).toBe('5145550100');
    expect(normalizePhone('514.555.0100')).toBe('5145550100');
    expect(normalizePhone('555-0100')).toBeNull();
    expect(normalizePhone('2 514 555 0100')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('(2) directCustomerKey: phone first, then e-mail, then null', () => {
    expect(directCustomerKey({ customer: { phone: '514-555-0101', email: 'a@example.com' } })).toBe('direct:tel:5145550101');
    expect(directCustomerKey({ customer: { phone: '555-0101', email: '  A@Example.COM ' } })).toBe('direct:mail:a@example.com');
    expect(directCustomerKey({ customer: { email: 'not-an-email' } })).toBeNull();
    expect(directCustomerKey({ customer: {} })).toBeNull();
  });

  it('(3) the anonymous id is stable, distinct per key and c_ + 12 hex', () => {
    const a = hashCustomerKey('direct:tel:5145550100');
    expect(a).toBe(hashCustomerKey('direct:tel:5145550100'));
    expect(a).not.toBe(hashCustomerKey('direct:tel:5145550101'));
    expect(a).toMatch(/^c_[0-9a-f]{12}$/);
    expect(hashCustomerKey('uber_eats:eater-1')).toMatch(/^c_[0-9a-f]{12}$/);
  });

  it('tierOf', () => {
    expect(tierOf({ hasOrderBefore: false, ordersInWindow: 9 })).toBe('new');
    expect(tierOf({ hasOrderBefore: true, ordersInWindow: 3 })).toBe('occasional');
    expect(tierOf({ hasOrderBefore: true, ordersInWindow: 4 })).toBe('frequent');
  });
});

describe('buildCustomerInsights', () => {
  it('(4) tier boundaries: 180-day lookback, 3 vs 4 orders in 90 days, a period longer than 90 days', async () => {
    // A: one order 1 minute inside the 180-day lookback → returning (occasional)
    await plat(at(FROM, -180 * DAY + 60_000), { customer: 'cust-a' });
    await plat(at(FROM, 2 * DAY), { customer: 'cust-a' });
    // B: one order 1 minute before the lookback → still new
    await plat(at(FROM, -180 * DAY - 60_000), { customer: 'cust-b' });
    await plat(at(FROM, 3 * DAY), { customer: 'cust-b' });
    // C: 1 before + 2 in the period = 3 in 90 days → occasional
    await plat(at(FROM, -10 * DAY), { customer: 'cust-c' });
    await plat(at(FROM, 4 * DAY), { customer: 'cust-c' });
    await plat(at(FROM, 5 * DAY), { customer: 'cust-c' });
    // D: 1 before + 3 in the period = 4 in 90 days → frequent
    await plat(at(FROM, -10 * DAY), { customer: 'cust-d' });
    for (const d of [6, 7, 8]) await plat(at(FROM, d * DAY), { customer: 'cust-d' });

    const r = await run();
    expect(r.totals.customers).toBe(4);
    expect(r.tiers.new.customers).toBe(1);
    expect(r.tiers.occasional.customers).toBe(2);
    expect(r.tiers.frequent.customers).toBe(1);
    expect(r.tiers.frequent.orders).toBe(3);
    expect(r.repeatRate).toBe(75);
    expect(r.tiers.new.pctCustomers).toBe(25);
    expect(r.definitions).toEqual({ newLookbackDays: 180, windowDays: 90, frequentMinOrders: 4 });

    // A 153-day period: the frequency window is the whole period (min(from, to − 90 d) = from)
    (globalThis as any).__foodhubMem = undefined;
    const longFrom = '2026-05-01T04:00:00.000Z';
    await plat(at(longFrom, -20 * DAY), { customer: 'cust-e' });
    for (const d of [1, 5, 20, 30]) await plat(at(longFrom, d * DAY), { customer: 'cust-e' }); // all > 90 days before TO
    const long = await run({}, { from: longFrom, to: TO });
    expect(long.range.days).toBe(153);
    expect(long.tiers.frequent.customers).toBe(1);
    expect(long.top[0]).toMatchObject({ tier: 'frequent', orders: 4, firstOrder: '2026-05-02', lastOrder: '2026-05-31' });
  });

  it('(5) cancelled orders are not counted, in the period or in the history', async () => {
    await plat(at(FROM, -10 * DAY), { customer: 'cust-x', status: 'cancelled' });
    await plat(at(FROM, 1 * DAY), { customer: 'cust-x' });
    await plat(at(FROM, 2 * DAY), { customer: 'cust-y', status: 'cancelled', total: 99 });
    await direct(at(FROM, 2 * DAY), { phone: '514-555-0110', status: 'cancelled', total: 50 });
    const r = await run();
    expect(r.totals).toMatchObject({ customers: 1, orders: 1, sales: 20 });
    expect(r.tiers.new.customers).toBe(1); // the cancelled history order does not make cust-x returning
  });

  it('(6) lapsed and multi-brand customers; one phone is one customer across direct sources', async () => {
    await plat(at(FROM, -30 * DAY), { customer: 'gone', total: 40 }); // lapsed (inside the 90 days before)
    await plat(at(FROM, -120 * DAY), { customer: 'old', total: 40 }); // older than 90 days → not lapsed
    await plat(at(FROM, -30 * DAY), { customer: 'back' });
    await plat(at(FROM, 3 * DAY), { customer: 'back' });
    await direct(at(FROM, 1 * DAY), { phone: '514-555-0120', brand: 'Brand A', source: 'phone', total: 25 });
    await direct(at(FROM, 2 * DAY), { phone: '+1 514 555 0120', brand: 'Brand B', source: 'website', total: 35 });
    await direct(at(FROM, 3 * DAY), { phone: '15145550120', brand: 'Brand B', source: 'phone_ai', total: 10 });
    const r = await run();
    expect(r.lapsed).toEqual({ customers: 1, salesBefore: 40 });
    expect(r.totals.customers).toBe(2);
    expect(r.multiBrand).toEqual({ customers: 1, pct: 50, sales: 70 });
    const directRow = r.byChannel.find((c) => c.key === 'direct')!;
    expect(directRow).toMatchObject({ label: 'Direct orders', orders: 3, identifiedOrders: 3, customers: 1, new: 1, sales: 70 });
    expect(r.top[0]).toMatchObject({ orders: 3, sales: 70, channels: ['direct'], brands: ['Brand A', 'Brand B'] });
    const b = r.byBrand.find((x) => x.brand === 'Brand B')!;
    expect(b).toMatchObject({ customers: 1, new: 1, repeatRate: 0, sales: 45 });
  });

  it('(7) filters: direct exclude / only, platforms picked exclude direct by default, an empty scope gives nothing', async () => {
    await plat(at(FROM, 1 * DAY), { customer: 'u-1', channel: 'uber_eats' });
    await plat(at(FROM, 1 * DAY), { customer: 'd-1', channel: 'doordash', brand: 'Brand B' });
    await direct(at(FROM, 1 * DAY), { phone: '514-555-0130' });
    await direct(at(FROM, 1 * DAY), { email: 'other@example.com', location: 'LOC_B' });

    const all = await run();
    expect(all.totals.customers).toBe(4);
    expect((await run({ direct: 'exclude' })).byChannel.map((c) => c.key).sort()).toEqual(['doordash', 'uber_eats']);
    const only = await run({ direct: 'only' });
    expect(only.byChannel.map((c) => c.key)).toEqual(['direct']);
    expect(only.totals.customers).toBe(2);
    const uber = await run({ channels: ['uber_eats'] });
    expect(uber.byChannel.map((c) => c.key)).toEqual(['uber_eats']);
    expect(uber.direct).toBe('exclude');
    const uberPlus = await run({ channels: ['uber_eats'], direct: 'include' });
    expect(uberPlus.byChannel.map((c) => c.key).sort()).toEqual(['direct', 'uber_eats']);
    expect((await run({ brands: ['Brand B'] })).totals.customers).toBe(1);
    expect((await run({ locationCodes: ['LOC_B'] })).totals.customers).toBe(1);
    const none = await run({ locationCodes: ['__none__'] });
    expect(none.totals).toMatchObject({ customers: 0, orders: 0, sales: 0 });
    expect(none.byChannel).toEqual([]);
  });

  it('filters apply to the history too: new means new to the selected platforms', async () => {
    await plat(at(FROM, -20 * DAY), { customer: 'same-id', channel: 'doordash' });
    await plat(at(FROM, 2 * DAY), { customer: 'same-id', channel: 'doordash' });
    await plat(at(FROM, -20 * DAY), { customer: 'brand-hop', brand: 'Brand A' });
    await plat(at(FROM, 2 * DAY), { customer: 'brand-hop', brand: 'Brand B' });
    expect((await run({ channels: ['doordash'] })).tiers.occasional.customers).toBe(1);
    const b = await run({ brands: ['Brand B'] });
    expect(b.tiers.new.customers).toBe(1); // new to Brand B even though it ordered Brand A before
  });

  it('(8) coverage counts unidentified orders', async () => {
    await plat(at(FROM, 1 * DAY), { customer: 'id-1', total: 10 });
    await plat(at(FROM, 1 * DAY), { customer: 'id-2', total: 10 });
    await plat(at(FROM, 1 * DAY), { customer: null, total: 10 });
    await direct(at(FROM, 1 * DAY), { total: 30 }); // no phone, no e-mail
    const r = await run();
    expect(r.totals).toMatchObject({ customers: 2, orders: 4, sales: 60, identifiedOrders: 2, identifiedSales: 20, coveragePct: 50, unidentifiedOrders: 2, unidentifiedSales: 40 });
    expect(r.tiers.new.pctSales).toBe(100);
    expect(r.byChannel.find((c) => c.key === 'uber_eats')).toMatchObject({ orders: 3, identifiedOrders: 2, coveragePct: 66.67 });
  });

  it('(9) never returns a name, phone, e-mail, address or platform customer id', async () => {
    await plat(at(FROM, 1 * DAY), { customer: 'cust-xyz', channel: 'doordash', name: 'Test Person' });
    await plat(at(FROM, -5 * DAY), { customer: 'cust-xyz', channel: 'doordash', name: 'Test Person' });
    await direct(at(FROM, 2 * DAY), { name: 'Test Person', phone: '514-555-0199', email: 'test@example.com' });
    await direct(at(FROM, 3 * DAY), { name: 'Test Person', email: 'test@example.com' });
    const r = await run();
    expect(r.totals.customers).toBe(3);
    const json = JSON.stringify(r);
    for (const secret of ['Test Person', '514-555-0199', '5145550199', 'test@example.com', 'cust-xyz', 'Test Street', 'H0H']) expect(json).not.toContain(secret);
    for (const c of r.top) expect(c.id).toMatch(/^c_[0-9a-f]{12}$/);
  });

  it('(10) an empty range gives only finite numbers', async () => {
    const r = await run();
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
    expect(r.totals).toEqual({ customers: 0, orders: 0, sales: 0, identifiedOrders: 0, identifiedSales: 0, coveragePct: 0, unidentifiedOrders: 0, unidentifiedSales: 0 });
    expect(r.tiers.new).toEqual({ customers: 0, pctCustomers: 0, orders: 0, sales: 0, pctSales: 0, aov: 0 });
    expect(r.repeatRate).toBe(0);
    expect(r.range.truncated).toBe(false);
  });
});

describe('GET /api/foodhub/customer-insights', () => {
  it('(11) 200 for the owner, 400 on a bad range or a bad direct value', async () => {
    const prev = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    try {
      const { GET } = await import('../app/api/foodhub/customer-insights/route');
      const get = (qs: string) => GET(new Request(`http://hub.local/api/foodhub/customer-insights?${qs}`, { headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}` } }) as any, {} as never);
      await direct(at(FROM, 1 * DAY), { phone: '514-555-0140' });
      const res = await get('from=2026-09-01&to=2026-09-30');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.totals.customers).toBe(1);
      expect(body.top[0].id).toMatch(/^c_[0-9a-f]{12}$/);
      expect(JSON.stringify(body)).not.toContain('5145550140');
      expect((await get('from=2026-10-10&to=2026-10-01')).status).toBe(400);
      expect((await get('from=2026-09-01&to=2026-09-30&direct=maybe')).status).toBe(400);
      expect((await get('from=2026-09-01&to=2026-09-30&direct=only')).status).toBe(200);
      expect((await GET(new Request('http://hub.local/api/foodhub/customer-insights') as any, {} as never)).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = prev;
    }
  });
});
