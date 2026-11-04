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
import { getDirectOrder, listDirectOrders, saveDirectOrder } from '../lib/foodhub/delivery/store';
import { cancelHeldOrder, startPayLink } from '../lib/foodhub/delivery/paylink';
import { getRepo } from '../lib/foodhub/repo';
import { clearStorefrontCache } from '../lib/foodhub/storefront/catalog';
import { TRACK_TTL_MS, ordersBySource, placeStorefrontOrder, trackOrder } from '../lib/foodhub/storefront/checkout';
import { quoteStorefrontCart } from '../lib/foodhub/storefront/quote';
import { OPTIONS as quotePreflight, POST as quoteRoute } from '../app/api/storefront/quote/route';
import { PICKUP_PAGE_LIMIT, reserveCheckout, resetStorefrontRateLimits } from '../lib/foodhub/storefront/rate-limit';
import { getStorefrontSettings, saveStorefrontSettings } from '../lib/foodhub/storefront/settings';
import { OPTIONS as checkoutPreflight, POST as checkoutRoute } from '../app/api/storefront/checkout/route';
import { GET as trackRoute, OPTIONS as trackPreflight } from '../app/api/storefront/track/[token]/route';
import { BRAND, LOC, SLUG, at, everyDay, fixtureMenu } from './helpers/storefront-fixture';

const owner = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const NOW = at(13);

async function setup(over: { enabled?: boolean; brand?: boolean; payOnline?: boolean; payAtPickup?: boolean; pickupMaxTotal?: number } = {}) {
  const base = await getStorefrontSettings();
  await saveStorefrontSettings({ enabled: over.enabled ?? true, brands: { [BRAND]: { ...base.brands[BRAND], enabled: over.brand ?? true, payOnline: over.payOnline ?? true, payAtPickup: over.payAtPickup ?? true, ...(over.pickupMaxTotal ? { pickupMaxTotal: over.pickupMaxTotal } : {}) } } }, owner);
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

describe('server-reviewed checkout and safe retries', () => {
  const key = 'test-attempt-0000000000000001';

  it('quotes current server prices, choices and Canadian taxes without placing or texting an order', async () => {
    await setup();
    const quote = await quoteStorefrontCart(cart(), NOW);
    expect(quote).toMatchObject({ ok: true, status: 200, subtotal: 15, tax: 2.25, total: 17.25, taxes: { province: 'QC' } });
    if (!quote.ok) throw new Error(quote.error);
    expect(quote.quoteId).toMatch(/^[a-f0-9]{64}$/);
    expect(quote.lines[0]).toMatchObject({ ref: 'i-pita', qty: 1, name: 'Pita au poulet', unitPrice: 12.5, total: 15 });
    expect(quote.lines[0].options).toEqual(expect.arrayContaining([expect.objectContaining({ ref: 'd-pepsi', qty: 1, unitPrice: 2.5 })]));
    expect(await listDirectOrders({ limit: 10 })).toEqual([]);
    expect(h.clover).toEqual([]); expect(h.sms).toEqual([]);
    expect(startPayLink).not.toHaveBeenCalled();
  });

  it('requires a new explicit review after a price change and creates nothing on mismatch', async () => {
    await setup();
    const initial = await quoteStorefrontCart(cart(), NOW);
    if (!initial.ok) throw new Error(initial.error);
    const menu = fixtureMenu();
    menu.items.find((item) => item.ref === 'i-pita')!.price = 14;
    await getRepo().saveMenu(menu); clearStorefrontCache();
    const mismatch = await placeStorefrontOrder(cart({ idempotencyKey: key, quoteId: initial.quoteId }), 'ip-review', NOW);
    expect(mismatch).toMatchObject({ ok: false, status: 409, reason: 'quote_changed', quote: { subtotal: 16.5, total: 18.98 } });
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
    expect(h.clover).toHaveLength(0); expect(h.sms).toHaveLength(0);
    if (mismatch.ok || !mismatch.quote) throw new Error('Expected updated quote');
    expect(mismatch.quote.quoteId).not.toBe(initial.quoteId);
    const accepted = await placeStorefrontOrder(cart({ idempotencyKey: key, quoteId: mismatch.quote.quoteId }), 'ip-review', NOW);
    expect(accepted).toMatchObject({ ok: true, total: mismatch.quote.total });
  });

  it('coalesces parallel retries and replays the same receipt after closure without extra texts, charges or rate slots', async () => {
    await setup();
    const payload = cart({ idempotencyKey: key });
    const results = await Promise.all(Array.from({ length: 8 }, () => placeStorefrontOrder(payload, 'ip-retry', NOW)));
    expect(results.every((result) => result.ok)).toBe(true);
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(1);
    expect(h.clover).toHaveLength(1); expect(h.sms).toHaveLength(1);
    expect(await placeStorefrontOrder(payload, 'ip-retry', at(23, 30))).toEqual(results[0]);
    for (const suffix of ['2', '3']) expect((await placeStorefrontOrder(cart({ idempotencyKey: key + suffix }), 'ip-retry', NOW)).ok).toBe(true);
    expect(await placeStorefrontOrder(cart({ idempotencyKey: key + '4' }), 'ip-retry', NOW)).toMatchObject({ status: 429 });
  });

  it('refuses key reuse for changed customer/payment/cart without exposing the old receipt', async () => {
    await setup();
    await placeStorefrontOrder(cart({ idempotencyKey: key }), 'ip-conflict', NOW);
    for (const change of [{ pay: 'online' }, { customer: { name: 'Other', phone: '5145550188' } }, { lines: [{ ref: 'i-juice', qty: 1 }] }]) {
      const conflict = await placeStorefrontOrder(cart({ ...change, idempotencyKey: key }), 'ip-conflict', NOW);
      expect(conflict).toMatchObject({ ok: false, status: 409, reason: 'idempotency_conflict' });
      expect(conflict).not.toHaveProperty('track'); expect(conflict).not.toHaveProperty('payUrl');
    }
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(1);
    expect(h.clover).toHaveLength(1); expect(h.sms).toHaveLength(1);
    expect(await placeStorefrontOrder(cart({ idempotencyKey: 'short' }), 'ip-conflict', NOW)).toMatchObject({ status: 400 });
  });

  it('recovers a saved pickup order when the receipt write was interrupted, without replaying Clover/SMS', async () => {
    await setup();
    const repo = getRepo();
    const realSet = repo.setKv.bind(repo);
    const fail = vi.spyOn(repo, 'setKv').mockImplementation(async (name, value) => {
      if (name.startsWith('sf_checkout:')) throw new Error('simulated interrupted receipt write');
      return realSet(name, value);
    });
    const payload = cart({ idempotencyKey: key });
    await expect(placeStorefrontOrder(payload, 'ip-interrupt', NOW)).rejects.toThrow('interrupted receipt');
    fail.mockRestore();
    expect(await placeStorefrontOrder(payload, 'ip-interrupt', NOW + 1000)).toMatchObject({ status: 409, reason: 'in_progress' });
    const recovered = await placeStorefrontOrder(payload, 'ip-interrupt', NOW + 120_001);
    expect(recovered).toMatchObject({ ok: true });
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(1);
    expect(h.clover).toHaveLength(1); expect(h.sms).toHaveLength(1);
    expect(await placeStorefrontOrder(payload, 'ip-interrupt', NOW + 120_002)).toEqual(recovered);
  });

  it('does not turn a pending durable claim without a known order into a second attempt', async () => {
    await setup();
    const repo = getRepo();
    const realClaim = repo.claimKv.bind(repo);
    const claim = vi.spyOn(repo, 'claimKv').mockImplementation(async (name, value) => {
      if (!name.startsWith('sf_checkout:')) return realClaim(name, value);
      await realClaim(name, value); return false; // another process already owns this attempt
    });
    const payload = cart({ idempotencyKey: key });
    expect(await placeStorefrontOrder(payload, 'ip-pending', NOW)).toMatchObject({ reason: 'in_progress' });
    claim.mockRestore();
    expect(await placeStorefrontOrder(payload, 'ip-pending', NOW + 120_001)).toMatchObject({ reason: 'review_required' });
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
    expect(h.clover).toHaveLength(0); expect(h.sms).toHaveLength(0);
  });

  it('keeps an issued tracking link valid when its restaurant changes the published page slug', async () => {
    await setup();
    const placed = await placeStorefrontOrder(cart({ idempotencyKey: key }), 'ip-slug', NOW);
    if (!placed.ok) throw new Error(placed.error);
    const settings = await getStorefrontSettings();
    await saveStorefrontSettings({ enabled: true, brands: { [BRAND]: { ...settings.brands[BRAND], slug: 'pi-pita-custom' } } }, owner);
    clearStorefrontCache();
    expect(await trackOrder(placed.track, { slug: SLUG })).toMatchObject({ number: placed.number });
    expect(await trackOrder(placed.track, { slug: 'pi-pita-custom' })).toMatchObject({ number: placed.number });
    expect(await trackOrder(placed.track, { slug: 'another-restaurant' })).toBeNull();
    expect(await placeStorefrontOrder(cart({ idempotencyKey: key }), 'ip-slug', NOW + 1)).toEqual(placed);
  });

  it('applies the checkout transport protections to quote: JSON, origin, streaming cap and CORS', async () => {
    await setup();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const req = (headers: Record<string, string>, body = JSON.stringify(cart())) => new Request('https://hub.test/api/storefront/quote', { method: 'POST', headers, body });
      expect((await quoteRoute(req({ 'content-type': 'text/plain' }))).status).toBe(415);
      expect((await quoteRoute(req({ 'content-type': 'application/json', origin: 'https://evil.example' }))).status).toBe(403);
      expect((await quoteRoute(req({ 'content-type': 'application/json' }, JSON.stringify({ pad: 'x'.repeat(33 * 1024) })))).status).toBe(413);
      const good = await quoteRoute(req({ 'content-type': 'application/json', origin: 'https://on2go.ca', 'sec-fetch-site': 'cross-site' }));
      expect(good.status).toBe(200); expect(good.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
      expect(good.headers.get('cache-control')).toBe('no-store');
      const preflight = await quotePreflight(new Request('https://hub.test/api/storefront/quote', { method: 'OPTIONS', headers: { origin: 'https://on2go.ca' } }));
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
      expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
    } finally { vi.mocked(Date.now).mockRestore(); }
  });
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
    expect((await placeStorefrontOrder(cart({ customer: { name: 'A', phone: '12345678' } }), 'ip-1', NOW))).toMatchObject({ status: 400, error: 'Entrez un numéro de téléphone valide du Canada ou des États-Unis.' });
    expect((await placeStorefrontOrder(cart({ customer: { name: 'A', phone: '+44 20 7946 0958' } }), 'ip-1', NOW)).status).toBe(400); // never an international number
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

  it('rate limits hold under parallel requests: 10 at once from one address → 5 pass; from one phone → 3 pass', async () => {
    await setup();
    const sameIp = await Promise.all(Array.from({ length: 10 }, (_, i) => placeStorefrontOrder(cart({ customer: { name: 'Client', phone: `51455502${String(i).padStart(2, '0')}` } }), 'ip-burst', NOW)));
    expect(sameIp.filter((r) => r.ok)).toHaveLength(5);
    expect(sameIp.filter((r) => !r.ok && r.status === 429)).toHaveLength(5);
    resetStorefrontRateLimits();
    const samePhone = await Promise.all(Array.from({ length: 10 }, (_, i) => placeStorefrontOrder(cart({ customer: { name: 'Client', phone: '5145550300' } }), `ip-p${i}`, NOW)));
    expect(samePhone.filter((r) => r.ok)).toHaveLength(3);
    expect(await listDirectOrders({ limit: 50 })).toHaveLength(8);
  });

  it('a failed online attempt gives its slot back (payment not ready → no order, not counted)', async () => {
    await setup();
    h.ready = false;
    for (let i = 0; i < 4; i++) expect(await placeStorefrontOrder(cart({ pay: 'online' }), 'ip-1', NOW + i)).toMatchObject({ status: 409, fallback: 'pay_at_pickup' });
    for (let i = 0; i < 3; i++) expect((await placeStorefrontOrder(cart(), 'ip-1', NOW + 10 + i)).ok).toBe(true);
  });

  it('pay-at-the-counter ceilings: 40 per page per hour; refused reservations keep nothing', async () => {
    for (let i = 0; i < PICKUP_PAGE_LIMIT.max; i++) expect((await reserveCheckout(`ip-${i}`, `+1514555${String(1000 + i)}`, { slug: SLUG, payAtPickup: true }, NOW)).ok).toBe(true);
    expect(await reserveCheckout('ip-x', '+15145559999', { slug: SLUG, payAtPickup: true }, NOW)).toMatchObject({ ok: false, by: 'page' });
    expect((await reserveCheckout('ip-x', '+15145559999', { slug: SLUG, payAtPickup: false }, NOW)).ok).toBe(true); // paid online: not an unpaid order
    expect((await reserveCheckout('ip-y', '+15145559998', { slug: 'other-page', payAtPickup: true }, NOW)).ok).toBe(true);
    const r = await reserveCheckout('ip-z', '+15145559997', { slug: SLUG, payAtPickup: true }, NOW + PICKUP_PAGE_LIMIT.windowMs + 1);
    if (!r.ok) throw new Error('expected a slot after the window');
    await r.release();
    await r.release(); // twice is harmless
  });

  it('unpaid orders are capped: 25 items and the brand’s maximum (taxes in); online payment is offered instead', async () => {
    await setup({ pickupMaxTotal: 50 });
    const many = await placeStorefrontOrder(cart({ lines: [{ ref: 'i-juice', qty: 20 }, { ref: 'i-juice', qty: 6 }] }), 'ip-1', NOW);
    expect(many).toMatchObject({ ok: false, status: 422, reason: 'pickup_limit' });
    if (!many.ok) expect(many.error).toMatch(/25 articles.+Payer en ligne/);
    const big = await placeStorefrontOrder(cart({ lines: [{ ref: 'i-juice', qty: 15 }] }), 'ip-1', NOW); // 45 $ + taxes = 51.74 $
    expect(big).toMatchObject({ ok: false, status: 422, reason: 'pickup_limit' });
    if (!big.ok) expect(big.error).toContain('50,00 $');
    expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
    expect((await placeStorefrontOrder(cart({ pay: 'online', lines: [{ ref: 'i-juice', qty: 15 }] }), 'ip-1', NOW)).ok).toBe(true);
    expect((await placeStorefrontOrder(cart({ lines: [{ ref: 'i-juice', qty: 14 }] }), 'ip-1', NOW)).ok).toBe(true); // 48.29 $
    expect((await getStorefrontSettings()).brands[BRAND].pickupMaxTotal).toBe(50);
  });

  it('last order: refused when the kitchen closes before its prep time is up', async () => {
    await setup();
    const late = await placeStorefrontOrder(cart(), 'ip-1', at(22, 50)); // closes 23:00, prep 15 min
    expect(late).toMatchObject({ ok: false, status: 409, reason: 'closed' });
    if (!late.ok) expect(late.error).toMatch(/Trop tard/);
    expect((await placeStorefrontOrder(cart(), 'ip-1', at(22, 40))).ok).toBe(true);
  });

  it('the route: JSON only (415), same origin only (403), 32 KB cut even without Content-Length (413)', async () => {
    await setup();
    // The route uses the real clock. Hours are 11:00–23:00 America/Toronto, so a CI run overnight would be "closed" (409).
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const url = 'https://hub.test/api/storefront/checkout';
      const post = (headers: Record<string, string>, body: BodyInit = JSON.stringify(cart())) => checkoutRoute(new Request(url, { method: 'POST', headers, body }));
      expect((await post({ 'Content-Type': 'text/plain' })).status).toBe(415);
      expect((await post({})).status).toBe(415);
      expect((await post({ 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1')).status).toBe(415);
      expect((await post({ 'Content-Type': 'application/json', Origin: 'https://evil.example' })).status).toBe(403);
      expect((await post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
      expect(await listDirectOrders({ limit: 10 })).toHaveLength(0);
      const chunks = [new TextEncoder().encode('{"pad":"'), ...Array.from({ length: 40 }, () => new TextEncoder().encode('x'.repeat(1024)))];
      const stream = new ReadableStream<Uint8Array>({ pull(c) { const n = chunks.shift(); if (n) c.enqueue(n); else c.close(); } });
      const chunked = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
      expect(chunked.headers.get('content-length')).toBeNull();
      expect((await checkoutRoute(chunked)).status).toBe(413);
      const good = await post({ 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://hub.test', 'Sec-Fetch-Site': 'same-origin' });
      expect(good.status).toBe(200);
      // ON2GO.ca orders from its own pages: an allowed origin passes (cross-site) and gets CORS headers; the preflight too.
      const on2go = await post({ 'Content-Type': 'application/json', Origin: 'https://on2go.ca', 'Sec-Fetch-Site': 'cross-site' });
      expect(on2go.status).toBe(200);
      expect(on2go.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
      const pre = await checkoutPreflight(new Request(url, { method: 'OPTIONS', headers: { Origin: 'https://on2go.ca', 'Access-Control-Request-Method': 'POST' } }));
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
      expect(pre.headers.get('access-control-allow-headers')).toMatch(/content-type/i);
      const evilPre = await checkoutPreflight(new Request(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }));
      expect(evilPre.headers.get('access-control-allow-origin')).toBeNull();
      const placed = await on2go.json();
      const seen = await trackRoute(new Request('https://hub.test/api/storefront/track/' + placed.track, { headers: { Origin: 'https://on2go.ca' } }), { params: Promise.resolve({ token: placed.track }) });
      expect(seen.status).toBe(200);
      expect(seen.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
      expect((await trackPreflight(new Request('https://hub.test/api/storefront/track/x', { method: 'OPTIONS', headers: { Origin: 'https://on2go.ca' } }))).status).toBe(204);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
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
    expect(await ordersBySource(7, NOW)).toEqual([]); // held, not paid yet: not an order by source
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
  it.each([
    ['review', 'awaiting_payment'], ['paid', 'awaiting_payment'], ['review', 'in_kitchen'], ['late', 'cancelled'],
  ] as const)('never requests a second transfer for %s/%s payment evidence', async (state, status) => {
    await setup();
    const placed = await placeStorefrontOrder(cart(), 'ip-mixed-payment', NOW);
    if (!placed.ok) throw new Error(placed.error);
    const order = (await listDirectOrders({ limit: 1 }))[0];
    const at = new Date().toISOString();
    await saveDirectOrder({ ...order, status, readyAt: at,
      paylink: { token: 'TESTTOKEN0123456789abcdef', merchantId: 'MID-TEST', marker: `Réf. ${order.id}`, lang: 'en', createdAt: at,
        expiresAt: new Date(Date.now() + 600000).toISOString(), reminderMin: 0, sessions: [], expectedCents: 1725,
        ...(state === 'review' ? { flag: 'Paiement à vérifier : interrupted' } : state === 'late' ? { extraPayments: ['LATE-PAYMENT'] } : { paidAt: at, paymentId: 'PAID-TEST' }) },
      interac: { reference: 'TEST-TRANSFER', amount: 17.25, recipient: 'restaurant@example.test', autoDeposit: true, lang: 'en', createdAt: at,
        expiresAt: new Date(Date.now() + 600000).toISOString(), reminderMin: 0 },
    });
    const view = await trackOrder(placed.track);
    expect(view).toMatchObject(state === 'paid' ? { paymentReceived: true } : { paymentReview: true });
    expect(view?.interac).toBeUndefined();
    expect(view?.payUrl).toBeUndefined();
    expect(view?.readyAt).toBeNull();
  });
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
    // Only under the order's own brand page, and only for 7 days.
    expect(await trackOrder(r.track, { slug: SLUG })).toMatchObject({ number: r.number });
    const other = Object.entries((await getStorefrontSettings()).brands).find(([name]) => name !== BRAND)![1].slug;
    expect(await trackOrder(r.track, { slug: other })).toBeNull();
    expect(await trackOrder(r.track, { slug: 'not-a-page' })).toBeNull();
    expect((await trackRoute(new Request(`https://hub.test/api/storefront/track/${r.track}?slug=${other}`), { params: Promise.resolve({ token: r.track }) })).status).toBe(404);
    expect(await trackOrder(r.track, { now: Date.now() + TRACK_TTL_MS - 60_000 })).not.toBeNull();
    expect(await trackOrder(r.track, { now: Date.now() + TRACK_TTL_MS + 60_000 })).toBeNull();
    const o = (await listDirectOrders({ limit: 1 }))[0];
    expect((await getDirectOrder(o.id))?.customer.name).toBe('Client Test'); // kept on the order, never on the tracking page
  });
});
