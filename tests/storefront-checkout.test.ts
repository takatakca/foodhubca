// ON2GO storefront: checkout through the existing direct-order pipeline (source 'website', sourceRef 'sf_…'), pay at
// the counter vs online (held + payment link opened in the browser, nothing texted), paylink failure → cancel + an
// explicit fallback, rate limits, honeypot, 413, and a tracking endpoint without personal data.
// Clover (clover-direct, the payment link) and texts (notify) are mocked: nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  clover: [] as any[],
  sms: [] as Array<{ to: string; body: string }>,
  linkFails: false,
  ready: true,
}));

vi.mock('../lib/foodhub/delivery/clover-direct', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/delivery/clover-direct')>()),
  createDirectOrderInClover: vi.fn(async (o: any) => { h.clover.push(o); return { ok: true, posOrderId: `CLV-TEST-${h.clover.length}`, merchantId: 'MID-TEST' }; }),
}));
vi.mock('../lib/foodhub/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/notify')>()),
  sendSms: vi.fn(async (m: { to: string; body: string }) => { h.sms.push(m); return { ok: true, channel: 'sms', message: 'sent' }; }),
  postToChat: vi.fn(async () => ({ ok: true, channel: 'chat', message: 'ok' })),
}));
vi.mock('../lib/foodhub/delivery/paylink', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/delivery/paylink')>();
  return {
    ...real,
    paylinkReadiness: vi.fn(async () => (h.ready ? { ok: true, merchantId: 'MID-TEST' } : { ok: false, reason: 'No Clover Hosted Checkout key' })),
    startPayLink: vi.fn(async (order: any) => (h.linkFails ? { ok: false, error: 'Clover said no' } : { ok: true, smsOk: false, order: { ...order, paylink: { token: 'TESTTOKEN0123456789abcdef' } } })),
    cancelHeldOrder: vi.fn(real.cancelHeldOrder),
  };
});

import { saveHours } from '../lib/foodhub/hours';
import { getDirectOrder, listDirectOrders } from '../lib/foodhub/delivery/store';
import { cancelHeldOrder, startPayLink } from '../lib/foodhub/delivery/paylink';
import { getRepo } from '../lib/foodhub/repo';
import { clearStorefrontCache } from '../lib/foodhub/storefront/catalog';
import { ordersBySource, placeStorefrontOrder, trackOrder } from '../lib/foodhub/storefront/checkout';
import { resetStorefrontRateLimits } from '../lib/foodhub/storefront/rate-limit';
import { getStorefrontSettings, saveStorefrontSettings } from '../lib/foodhub/storefront/settings';
import { POST as checkoutRoute } from '../app/api/storefront/checkout/route';
import { GET as trackRoute } from '../app/api/storefront/track/[token]/route';
import { BRAND, LOC, SLUG, at, everyDay, fixtureMenu } from './helpers/storefront-fixture';

const owner = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const NOW = at(13);

async function setup(over: { enabled?: boolean; brand?: boolean; payOnline?: boolean; payAtPickup?: boolean } = {}) {
  const base = await getStorefrontSettings();
  await saveStorefrontSettings({ enabled: over.enabled ?? true, brands: { [BRAND]: { ...base.brands[BRAND], enabled: over.brand ?? true, payOnline: over.payOnline ?? true, payAtPickup: over.payAtPickup ?? true } } }, owner);
  clearStorefrontCache();
}

const cart = (over: Record<string, unknown> = {}) => ({
  slug: SLUG, lang: 'fr', pay: 'pickup', src: 'instagram',
  customer: { name: 'Client Test', phone: '514 555 0177', email: 'client@example.test' },
  lines: [{ ref: 'i-pita', qty: 1, price: 0.01, options: [{ group: 'g-size', ref: 'm-reg' }, { group: 'g-duo', ref: 'd-pepsi' }] }],
  ...over,
});

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  delete process.env.FOODHUB_FEATURE_STOREFRONT;
  h.clover = []; h.sms = []; h.linkFails = false; h.ready = true;
  vi.mocked(startPayLink).mockClear();
  vi.mocked(cancelHeldOrder).mockClear();
  resetStorefrontRateLimits();
  clearStorefrontCache();
  await getRepo().saveMenu(fixtureMenu());
  await saveHours({ locations: { [LOC]: everyDay('11:00', '23:00') }, brands: {}, holidays: [] });
});

describe('refusals', () => {
  it('switch or brand off → 404; closed or paused → 409 with the reason', async () => {
    expect((await placeStorefrontOrder(cart(), 'ip-1', NOW)).status).toBe(404);
    await setup({ enabled: false });
    expect((await placeStorefrontOrder(cart(), 'ip-1', NOW)).status).toBe(404);
    await setup({ brand: false });
    expect((await placeStorefrontOrder(cart(), 'ip-1', NOW)).status).toBe(404);
    await setup();
    const closed = await placeStorefrontOrder(cart(), 'ip-1', at(23, 30));
    expect(closed).toMatchObject({ ok: false, status: 409, reason: 'closed' });
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-test-1', brandName: BRAND, locationCode: LOC, autoAccept: true, online: false, meta: {} } as any);
    clearStorefrontCache();
    expect(await placeStorefrontOrder(cart(), 'ip-1', NOW)).toMatchObject({ ok: false, status: 409, reason: 'paused' });
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
  });

  it('honeypot filled, bad cart, unknown item, bad phone: refused, nothing created', async () => {
    await setup();
    expect((await placeStorefrontOrder(cart({ website: 'http://spam.example' }), 'ip-1', NOW)).status).toBe(400);
    expect((await placeStorefrontOrder(cart({ lines: [] }), 'ip-1', NOW)).status).toBe(400);
    expect((await placeStorefrontOrder(cart({ customer: { name: 'A', phone: '12345678' } }), 'ip-1', NOW))).toMatchObject({ status: 400, error: 'Entrez un numéro de téléphone valide.' });
    expect((await placeStorefrontOrder(cart({ lines: [{ ref: 'ghost', qty: 1 }] }), 'ip-1', NOW)).status).toBe(422);
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
  });

  it('the route answers 413 above 32 KB and 400 on bad JSON', async () => {
    const big = new Request('https://hub.test/api/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cart({ pad: 'x'.repeat(33 * 1024) })) });
    expect((await checkoutRoute(big)).status).toBe(413);
    const bad = new Request('https://hub.test/api/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect((await checkoutRoute(bad)).status).toBe(400);
  });

  it('rate limits: 3 orders per 30 min per phone, 5 per 10 min per address', async () => {
    await setup();
    for (let i = 0; i < 3; i++) expect((await placeStorefrontOrder(cart(), `ip-${i}`, NOW + i * 1000)).ok).toBe(true);
    const fourth = await placeStorefrontOrder(cart(), 'ip-9', NOW + 5000);
    expect(fourth).toMatchObject({ ok: false, status: 429, reason: 'rate_limited' });
    expect((await placeStorefrontOrder(cart(), 'ip-9', NOW + 31 * 60_000)).ok).toBe(true);
    resetStorefrontRateLimits();
    for (let i = 0; i < 5; i++) expect((await placeStorefrontOrder(cart({ customer: { name: 'Client', phone: `514555010${i}` } }), 'ip-same', at(14) + i * 1000)).ok).toBe(true);
    expect(await placeStorefrontOrder(cart({ customer: { name: 'Client', phone: '5145550109' } }), 'ip-same', at(14) + 6000)).toMatchObject({ status: 429 });
  });
});

describe('orders through the direct-order pipeline', () => {
  it('pay at the counter → a website order (sf_ ref), server prices, Clover ticket now, confirmation text', async () => {
    await setup();
    const r = await placeStorefrontOrder(cart(), 'ip-1', NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.payUrl).toBeUndefined();
    expect(r.trackUrl).toBe(`/commander/${SLUG}/suivi/${r.track}`);
    const [o] = await listDirectOrders({ limit: 10 });
    expect(o).toMatchObject({ source: 'website', brandName: BRAND, locationCode: LOC, fulfillment: 'pickup', payment: 'pay_at_pickup', status: 'in_kitchen', posOrderId: 'CLV-TEST-1' });
    expect(o.sourceRef).toMatch(/^sf_[A-Za-z0-9_-]{8,}$/);
    expect(o.notes).toBe('Commande en ligne (Commander direct) · instagram');
    expect(o.lines[0]).toMatchObject({ unitPrice: 12.5, total: 15, posItemRef: 'CLV-ITEM-PITA' });
    expect(o.total).toBe(r.total);
    expect(o.total).toBe(17.25); // 15 + 14.975 % taxes
    expect(h.clover).toHaveLength(1);
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].to).toBe('+15145550177');
    expect(startPayLink).not.toHaveBeenCalled();
    expect(await ordersBySource(7, NOW)).toEqual([{ brand: BRAND, src: 'instagram', orders: 1 }]);
  });

  it('pay online → held order, payment link opened in the browser (notify none, 20 min, no reminder), nothing in Clover yet, no text', async () => {
    await setup();
    const r = await placeStorefrontOrder(cart({ pay: 'online', lang: 'en' }), 'ip-1', NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.payUrl).toBe('/p/TESTTOKEN0123456789abcdef');
    const [o] = await listDirectOrders({ limit: 10 });
    expect(o).toMatchObject({ source: 'website', status: 'awaiting_payment', payment: 'unpaid' });
    expect(vi.mocked(startPayLink).mock.calls[0][1]).toMatchObject({ lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    expect(h.clover).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
  });

  it('online payment not ready → no order, explicit fallback; link failure → held order cancelled without a text + fallback', async () => {
    await setup();
    h.ready = false;
    expect(await placeStorefrontOrder(cart({ pay: 'online' }), 'ip-1', NOW)).toMatchObject({ ok: false, status: 409, fallback: 'pay_at_pickup' });
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
    h.ready = true; h.linkFails = true;
    const r = await placeStorefrontOrder(cart({ pay: 'online' }), 'ip-2', NOW);
    expect(r).toMatchObject({ ok: false, status: 409, fallback: 'pay_at_pickup' });
    expect(vi.mocked(cancelHeldOrder).mock.calls[0][3]).toEqual({ text: false });
    const [o] = await listDirectOrders({ limit: 10 });
    expect(o.status).toBe('cancelled');
    expect(h.sms).toHaveLength(0);
    expect(h.clover).toHaveLength(0);
    // No silent switch: the customer retries with "pay at the counter".
    const retry = await placeStorefrontOrder(cart({ pay: 'pickup' }), 'ip-2', NOW);
    expect(retry.ok).toBe(true);
    // A brand that only takes online payment answers an error, never a pickup order.
    await setup({ payAtPickup: false });
    h.ready = false;
    expect(await placeStorefrontOrder(cart({ pay: 'online', customer: { name: 'B', phone: '5145550166' } }), 'ip-3', NOW)).toMatchObject({ ok: false, status: 503 });
    expect((await placeStorefrontOrder(cart({ pay: 'pickup', customer: { name: 'B', phone: '5145550166' } }), 'ip-3', NOW)).status).toBe(409);
  });
});

describe('tracking', () => {
  it('returns number, status, brand and ready time only — never the customer', async () => {
    await setup();
    const r = await placeStorefrontOrder(cart(), 'ip-1', NOW);
    if (!r.ok) throw new Error(r.error);
    const view = await trackOrder(r.track);
    expect(Object.keys(view!).sort()).toEqual(['brand', 'number', 'readyAt', 'status']);
    const res = await trackRoute(new Request(`https://hub.test/api/storefront/track/${r.track}`), { params: Promise.resolve({ token: r.track }) });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    for (const pii of ['Client Test', '5550177', 'client@example.test', 'Chicken', '17.25', 'instagram']) expect(text).not.toContain(pii);
    expect(JSON.parse(text)).toMatchObject({ ok: true, status: 'in_kitchen', brand: 'Pi Pita' });
    expect((await trackRoute(new Request('https://hub.test/x'), { params: Promise.resolve({ token: 'not-a-real-token-at-all-000' }) })).status).toBe(404);
    expect(await trackOrder('../../etc')).toBeNull();
    const o = (await listDirectOrders({ limit: 1 }))[0];
    expect((await getDirectOrder(o.id))?.customer.name).toBe('Client Test'); // kept on the order, never on the tracking page
  });
});
