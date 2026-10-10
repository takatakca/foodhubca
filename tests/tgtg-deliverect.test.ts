// Too Good To Go: no public API exists; its official order feed to a point of sale is Deliverect. This covers the whole
// Deliverect route (outbound POS / Store / KDS / Retail calls, every webhook) and the feed / bag-count reading,
// against mocked HTTP. Coverage table: docs/TGTG_API_COVERAGE.md.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tgtgAdapter, parseGenericOrder } from '../lib/foodhub/adapters/partner';
import {
  deliverectActions, deliverectRef, deliverectSignature, isDeliverectTgtgOrder, parseDeliverectOrder, verifyDeliverectWebhook,
} from '../lib/foodhub/adapters/deliverect';
import {
  buildDeliverectRequest, DELIVERECT_OPS, DELIVERECT_STATUS, deliverect, deliverectCall, deliverectListAll, deliverectReadiness, deliverectUploadCsv, deliverectWhere, resetDeliverectToken, validateDeliverectBody,
} from '../lib/foodhub/adapters/deliverect-api';
import {
  classifyDeliverectOrder, deliverectProductsFromMenu, deliverectTaxCalculation, handleDeliverectRegister, validateDeliverectCart,
} from '../lib/foodhub/deliverect-ops';
import { processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import { applyTgtgEvent, feedBagCounts, parseTgtgEvent, syncAllFeedBagDays, syncFeedBagDay, tgtgEventKind } from '../lib/foodhub/tgtg-feed';
import { localDate } from '../lib/foodhub/hours';
import type { MasterMenu } from '../lib/foodhub/types';

// Run route background work (next/server after()) right away in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockFetch(routes: Array<[RegExp, (c: Call, n: number) => { status: number; body?: unknown }]> = []) {
  calls = [];
  const seen = new Map<RegExp, number>();
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' && init.body ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* csv */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    for (const [re, fn] of [[/\/oauth\/token$/, () => ({ status: 200, body: { access_token: 'dlv-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'Bearer' } })] as any, ...routes]) {
      if (!re.test(c.url)) continue;
      const n = (seen.get(re) ?? 0) + 1; seen.set(re, n);
      const r = fn(c, n);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }));
}
const statusCalls = () => calls.filter((c) => /\/orderStatus\//.test(c.url));

/** A Surprise Bag order as Deliverect sends it to a POS (amounts in 10^-decimalDigits). */
const dlvOrder = (id = '65aa00000000000000000001', over: Record<string, any> = {}) => ({
  _created: new Date(Date.now() - 60_000).toISOString(), _id: id, account: 'acc-1', channelOrderId: 'TGTG-ABC123XYZ', channelOrderDisplayId: 'ABC123', posId: '', posReceiptId: '', posLocationId: 'NDG_MAIN', location: 'loc-1', channelLink: 'cl-1',
  status: 1, orderType: 1, channel: 777, pos: 0, pickupTime: new Date(Date.now() + 3600_000).toISOString(), customer: { name: 'Ana Bel', phoneNumber: '+15145551234', note: 'Je passe à 20h' },
  orderIsAlreadyPaid: true, payment: { amount: 690, type: 0, due: 0, rebate: 0 }, note: '', decimalDigits: 2, taxes: [{ name: 'TPS', total: 30 }], taxTotal: 30, discountTotal: 0,
  items: [{ _id: 'l1', plu: 'BAG-1', name: 'Surprise Bag', price: 599, quantity: 1, productType: 1, subItems: [] }, { _id: 'l2', plu: 'BAG-2', name: 'Magic Bag', price: 30, quantity: 1, productType: 1, subItems: [{ plu: 'M1', name: 'Sans noix', price: 0, quantity: 1, productType: 2, subItems: [] }] }], ...over,
});

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.DELIVERECT_CLIENT_ID = 'dcid';
  process.env.DELIVERECT_CLIENT_SECRET = 'dsecret';
  process.env.DELIVERECT_BASE_URL = 'https://api.staging.deliverect.test';
  process.env.DELIVERECT_RETAIL_BASE_URL = 'https://api.staging.deliverect.io.test';
  process.env.DELIVERECT_TGTG_CHANNEL_IDS = '777';
  process.env.DELIVERECT_WEBHOOK_SECRET = 'dlv-url-token';
  process.env.DELIVERECT_HMAC_SECRET = 'dlv-hmac';
  process.env.FOODHUB_PUBLIC_URL = 'https://hub.test';
  delete process.env.DELIVERECT_TAX_RATES;
  delete process.env.FOODHUB_VIA_CLOVER;
  delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
  resetDeliverectToken();
});
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; delete process.env.FOODHUB_POS_INJECTION; });

const OPERATION_IDS = [
  'pos.insertProducts', 'pos.orderStatus', 'pos.preparationTime', 'pos.updateBill', 'pos.health', 'pos.validationResponse',
  'store.accounts', 'store.brands', 'store.locations', 'store.channelLinks', 'store.channels', 'store.allergens', 'store.products', 'store.snoozed', 'store.snoozeByPlu', 'store.snoozeByTag', 'store.syncProducts',
  'store.openingHoursSet', 'store.openingHoursAccount', 'store.openingHoursLocation', 'store.holidaysSet', 'store.holidaysLocation', 'store.holidaysChannelSet', 'store.holidaysChannel', 'store.busyMode', 'store.orders',
  'kds.orderStatus', 'retail.itemsUploadUrl', 'retail.inventoryUploadUrl',
];

describe('Deliverect outbound API (POS, Store, KDS, Retail)', () => {
  it('lists the 29 documented operations once each', () => {
    expect(DELIVERECT_OPS.map((o) => o.id).sort()).toEqual([...OPERATION_IDS].sort());
    expect(new Set(DELIVERECT_OPS.map((o) => `${o.method} ${o.path}`)).size).toBe(29);
  });

  it('is ready only with the keys, the base URL and (for production) the live switch', () => {
    expect(deliverectReadiness()).toMatchObject({ configured: true, environment: 'staging', canSend: true });
    process.env.DELIVERECT_BASE_URL = 'https://api.deliverect.example';
    expect(deliverectReadiness()).toMatchObject({ environment: 'production', canSend: false });
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    expect(deliverectReadiness().canSend).toBe(true);
    delete process.env.DELIVERECT_BASE_URL;
    expect(deliverectReadiness()).toMatchObject({ configured: false, missing: ['DELIVERECT_BASE_URL'] });
  });

  it('gets one token, reuses it, and posts the order status with the original _id', async () => {
    mockFetch([[/\/orderStatus\//, () => ({ status: 200, body: { result: 'OK' } })]]);
    const r1 = await deliverect.orderStatus('65aa', 'R-1', DELIVERECT_STATUS.ACCEPTED);
    await deliverect.orderStatus('65aa', 'R-1', DELIVERECT_STATUS.PICKUP_READY);
    expect(r1.ok).toBe(true);
    expect(calls.filter((c) => /oauth\/token/.test(c.url))).toHaveLength(1);
    expect(calls[0].body).toEqual({ client_id: 'dcid', client_secret: 'dsecret', audience: 'https://api.staging.deliverect.test', grant_type: 'client_credentials' });
    const s = statusCalls();
    expect(s[0].url).toBe('https://api.staging.deliverect.test/orderStatus/65aa');
    expect(s[0].headers.Authorization).toBe('Bearer dlv-token');
    expect(s[0].body).toMatchObject({ orderId: '65aa', receiptId: 'R-1', status: 20 });
    expect(s[1].body.status).toBe(70);
  });

  it('refuses invalid calls before sending, and says why a refusal happened', async () => {
    mockFetch([[/orderStatus/, () => ({ status: 400, body: { error: 'bad' } })]]);
    expect(validateDeliverectBody('pos.orderStatus', { orderId: 'a', receiptId: 'r', status: 42 })).toContain('status');
    expect(validateDeliverectBody('pos.preparationTime', { order: 'a', minutes: 'x' })).toContain('minutes');
    expect(validateDeliverectBody('pos.health', { status: 'sleeping' })).toContain('online');
    expect(validateDeliverectBody('store.snoozeByPlu', { account: 'a', location: 'l', plus: [] })).toContain('plus');
    expect(validateDeliverectBody('store.snoozeByPlu', { account: 'a', location: 'l', plus: ['P'], snoozeEnd: '2026-10-10T00:00:00Z' })).toBeNull();
    expect(validateDeliverectBody('store.snoozeByTag', { account: 'a', location: 'l', tag: [1] })).toContain('snoozeStart');
    expect(validateDeliverectBody('store.busyMode', { isActive: 'yes' })).toContain('isActive');
    expect(validateDeliverectBody('store.openingHoursSet', { locations: [{ id: 'L', openingHours: [{ dayOfWeek: 8, startTime: '09:00', endTime: '17:00' }] }] })).toContain('dayOfWeek');
    expect(validateDeliverectBody('store.openingHoursSet', { locations: [{ id: 'L', openingHours: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }], channels: [{ id: 'C', openingHours: [{ dayOfWeek: 7, startTime: '10:00', endTime: '14:00' }] }] }] })).toBeNull();
    expect(validateDeliverectBody('store.holidaysSet', { locations: [{ id: 'L', holidays: [{ startTime: 'x', endTime: 'y' }] }] })).toContain('holidays');
    expect(validateDeliverectBody('store.holidaysSet', { locations: [{ id: 'L', holidays: [] }] })).toBeNull();
    expect(validateDeliverectBody('store.holidaysChannelSet', { locations: [{ id: 'L', channels: [{ id: 'C', holidays: [{ startTime: '2026-12-25T00:00:00Z', endTime: '2026-12-26T00:00:00Z' }] }] }] })).toBeNull();
    expect(validateDeliverectBody('pos.insertProducts', { accountId: 'a', locationId: 'l', products: [{ name: 'x', plu: 'p', price: 1.5, productType: 1 }], categories: [] })).toContain('whole cents');
    expect(validateDeliverectBody('pos.insertProducts', { accountId: 'a', locationId: 'l', products: [{ name: 'x', plu: 'p', price: 150, productType: 1 }] })).toContain('categories');
    expect(validateDeliverectBody('retail.itemsUploadUrl', { callbackUrl: 'http://x' })).toContain('https');
    expect(buildDeliverectRequest('pos.orderStatus', { body: { orderId: 'a', receiptId: 'r', status: 20 } })).toEqual({ error: 'orderId is required.' });
    const bad = await deliverect.orderStatus('a', 'r', 20);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('HTTP 400');
    delete process.env.DELIVERECT_CLIENT_SECRET;
    expect((await deliverect.health('loc')).status).toBe('blocked');
  });

  it('POS API: preparation time, bill, health check, async validation result, products', async () => {
    mockFetch([[/./, (c) => (c.url.includes('/oauth/') ? { status: 200 } : { status: 200, body: { ok: true } })]]);
    await deliverect.preparationTime('o1', 15);
    await deliverect.updateBill('loc-1', { id: 'bill-1', total: 1200, payments: [] });
    await deliverect.health('loc-1', 'online');
    await deliverect.validationResponse('v-1', { isValid: false, errors: [{ code: 'product_snoozed', plu: 'P' }] });
    await deliverect.insertProducts({ accountId: 'a', locationId: 'l', products: [{ name: 'Bag', plu: 'B', price: 599, productType: 1, deliveryTax: 0 }], categories: [] }, { previewSync: true, forceUpdate: false });
    const sent = calls.filter((c) => !/oauth/.test(c.url));
    expect(sent.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'POST /updatePreparationTime', 'POST /updateBill/loc-1', 'PUT /locations/loc-1/readiness/pos', 'POST /orderValidation/v-1', 'POST /productAndCategories?previewSync=true&forceUpdate=false',
    ]);
    expect(sent[0].body).toEqual({ order: 'o1', minutes: 15 });
    expect(sent[2].body).toEqual({ status: 'online' });
  });

  it('Store API reads: where filters and every page', async () => {
    mockFetch([[/\/locations\?/, (c) => {
      const page = Number(new URL(c.url).searchParams.get('page'));
      return { status: 200, body: { _items: page === 1 ? [{ _id: 'l1' }, { _id: 'l2' }] : [{ _id: 'l3' }], _meta: { page, max_results: 100, total: 3 } } };
    }], [/\/allChannels/, () => ({ status: 200, body: { _items: [{ channelId: 777, name: 'Too Good To Go' }], _meta: { total: 1 } } })]]);
    expect(deliverectWhere({ account: 'a1' })).toBe('{"account":"a1"}');
    const locs = await deliverect.locations('a1');
    expect(locs.items.map((l) => l._id)).toEqual(['l1', 'l2', 'l3']);
    expect(new URL(calls.find((c) => /locations\?/.test(c.url))!.url).searchParams.get('where')).toBe('{"account":"a1"}');
    expect((await deliverect.channels()).items[0]).toMatchObject({ channelId: 777 });
    mockFetch([[/\/accounts\/acc-1\/brands/, () => ({ status: 200, body: [{ id: 'b' }] })]]);
    expect((await deliverect.brands('acc-1')).items).toEqual([{ id: 'b' }]);
    mockFetch([[/./, () => ({ status: 500 })]]);
    expect((await deliverectListAll('store.accounts')).ok).toBe(false);
  });

  it('Store API writes: snooze by PLU and tag, sync request, opening hours, holidays, busy mode', async () => {
    mockFetch([[/./, (c) => (c.url.includes('/oauth/') ? { status: 200 } : { status: 200, body: 'OK' })]]);
    await deliverect.snoozeByPlu('a', 'l', ['P1', 'P2'], '2026-10-10T00:00:00Z');
    await deliverect.snoozeByTag('a', 'l', [104], '2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z');
    await deliverect.requestSync('loc-1', true);
    await deliverect.setOpeningHours({ locations: [{ id: 'loc-1', triggerUpdate: true, openingHours: [{ dayOfWeek: 1, startTime: '11:00', endTime: '20:00' }] }] });
    await deliverect.setHolidays({ locations: [{ id: 'loc-1', holidays: [{ startTime: '2026-12-25T00:00:00', endTime: '2026-12-25T23:59:00' }] }] });
    await deliverect.setChannelHolidays({ locations: [{ id: 'loc-1', channels: [{ id: 'cl-1', holidays: [] }] }] });
    await deliverect.busyMode('loc-1', true, { channelLinks: ['cl-1'], disableAt: '2026-10-09T03:00:00Z' });
    await deliverect.locationHolidays('loc-1'); await deliverect.channelHolidays('loc-1'); await deliverect.allergens(); await deliverect.kdsOrderStatus('o1', 60);
    const sent = calls.filter((c) => !/oauth/.test(c.url)).map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`);
    expect(sent).toEqual([
      'POST /products/snoozeByPlus', 'POST /products/snoozeByTags', 'POST /v2/locations/loc-1/syncProducts?forceUpdate=true', 'POST /locations/openingHours', 'POST /locations/holidays',
      'POST /locations/channels/holidays', 'POST /updateStoreStatus/loc-1', 'GET /location/loc-1/holidays', 'GET /locations/channels/loc-1/holidays', 'GET /allAllergens', 'POST /kds/orderStatus/o1',
    ]);
    expect(calls.find((c) => /snoozeByPlus/.test(c.url))!.body).toEqual({ account: 'a', location: 'l', plus: ['P1', 'P2'], snoozeEnd: '2026-10-10T00:00:00Z' });
    expect(calls.find((c) => /updateStoreStatus/.test(c.url))!.body).toEqual({ isActive: true, channelLinks: ['cl-1'], disableAt: '2026-10-09T03:00:00Z' });
  });

  it('Retail API: signed upload URLs (retail host + version header) and the CSV PUT to Google storage only', async () => {
    mockFetch([[/itemsUploadUrl/, () => ({ status: 200, body: { fileId: 'f1', signedUrl: 'https://storage.googleapis.com/b/items.csv?sig=1', headers: { 'content-type': 'text/csv', host: 'storage.googleapis.com' } } })], [/storage\.googleapis\.com/, () => ({ status: 200 })], [/inventoryUploadUrl/, () => ({ status: 200, body: { fileId: 'f2' } })]]);
    const up = await deliverect.retailItemsUploadUrl('acc-1', 'https://hub.test/cb', { syncMode: 'REPLACE_ALL_SOFT', preview: true });
    expect(up.ok).toBe(true);
    const c = calls.find((x) => /itemsUploadUrl/.test(x.url))!;
    expect(c.url).toBe('https://api.staging.deliverect.io.test/catalog/accounts/acc-1/itemsUploadUrl');
    expect(c.headers['X-Deliverect-Version']).toBe('2.0');
    expect(c.body).toEqual({ callbackUrl: 'https://hub.test/cb', syncMode: 'REPLACE_ALL_SOFT', preview: true });
    expect((await deliverect.retailInventoryUploadUrl('acc-1')).ok).toBe(true);
    const signed = (up.response as any);
    expect((await deliverectUploadCsv(signed, 'plu,name\nA,B')).status).toBe('queued');
    const put = calls.find((x) => x.method === 'PUT')!;
    expect(put.headers.Host).toBeUndefined();
    expect(put.headers['Content-Type'] ?? put.headers['content-type']).toBe('text/csv');
    expect((await deliverectUploadCsv({ signedUrl: 'https://evil.example/x' }, 'a,b')).ok).toBe(false);
    expect((await deliverectUploadCsv({ signedUrl: 'http://storage.googleapis.com/x' }, 'a,b')).ok).toBe(false);
    expect((await deliverectUploadCsv(signed, '  ')).ok).toBe(false);
    delete process.env.DELIVERECT_RETAIL_BASE_URL;
    expect((await deliverectCall('retail.itemsUploadUrl', { path: { accountId: 'a' }, body: {} })).status).toBe('blocked');
  });
});

describe('Deliverect order notification → a Too Good To Go order', () => {
  it('reads amounts by decimalDigits, restaurant-funded discount, taxes, modifiers and the store id', () => {
    const r = parseDeliverectOrder(dlvOrder());
    if ('ignored' in r) throw new Error(r.ignored);
    expect(r.deliverectOrderId).toBe('65aa00000000000000000001');
    expect(r.order).toMatchObject({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: 'dlv-65aa00000000000000000001', displayId: 'ABC123', channelStoreId: 'dlv:NDG_MAIN', fulfillment: 'pickup', customerName: 'Ana', subtotal: 6.29, tax: 0.3, total: 6.9, currency: 'CAD', notes: 'Je passe à 20h' });
    expect(r.order.lines[0]).toMatchObject({ externalId: 'BAG-1', name: 'Surprise Bag', unitPrice: 5.99, total: 5.99 });
    expect(r.order.lines[1].modifiers).toEqual([{ externalId: 'M1', name: 'Sans noix', quantity: 1, unitPrice: 0 }]);
    const withDiscount = parseDeliverectOrder(dlvOrder('x1', { discountTotal: -150, deliveryCost: 200, tip: 100, payment: { amount: 1000 } }));
    expect('order' in withDiscount && withDiscount.order).toMatchObject({ discount: 1.5, deliveryFee: 2, tip: 1, total: 10 });
    const three = parseDeliverectOrder(dlvOrder('x2', { decimalDigits: 3, payment: { amount: 6900 }, taxTotal: 300, items: [{ plu: 'B', name: 'Surprise Bag', price: 5990, quantity: 2, productType: 1 }] }));
    expect('order' in three && three.order).toMatchObject({ total: 6.9, tax: 0.3, subtotal: 11.98 });
    expect(parseDeliverectOrder(dlvOrder('x3', { orderType: 2 })) as any).toMatchObject({ order: { fulfillment: 'delivery' } });
  });

  it('takes only Too Good To Go: by channel id / channel link, or by Surprise Bag items when nothing is set', () => {
    expect(isDeliverectTgtgOrder(dlvOrder())).toBe(true);
    expect(isDeliverectTgtgOrder(dlvOrder('a', { channel: 5 }))).toBe(false);
    expect(parseDeliverectOrder(dlvOrder('a', { channel: 5 }))).toMatchObject({ ignored: expect.stringContaining('not Too Good To Go') });
    delete process.env.DELIVERECT_TGTG_CHANNEL_IDS;
    expect(isDeliverectTgtgOrder(dlvOrder('a', { channel: 5 }))).toBe(true); // both items are bags
    expect(isDeliverectTgtgOrder(dlvOrder('a', { items: [{ plu: 'B', name: 'Burger', price: 1, quantity: 1 }] }))).toBe(false);
    process.env.DELIVERECT_TGTG_CHANNEL_LINKS = 'cl-1';
    expect(isDeliverectTgtgOrder(dlvOrder('a', { items: [{ plu: 'B', name: 'Burger', price: 1, quantity: 1 }] }))).toBe(true);
    delete process.env.DELIVERECT_TGTG_CHANNEL_LINKS;
    expect(parseDeliverectOrder({ nope: 1 })).toMatchObject({ ignored: expect.any(String) });
    expect(parseDeliverectOrder(dlvOrder('a', { items: [] }))).toMatchObject({ ignored: expect.any(String) });
    process.env.FOODHUB_VIA_CLOVER = 'tgtg';
    process.env.DELIVERECT_TGTG_CHANNEL_IDS = '777';
    expect(parseDeliverectOrder(dlvOrder())).toMatchObject({ ignored: expect.stringContaining('linked through Clover') });
  });

  it('splits the notification: a new order, a channel cancel (status 100), or something not ours', () => {
    expect(classifyDeliverectOrder(dlvOrder())).toMatchObject({ kind: 'order' });
    expect(classifyDeliverectOrder(dlvOrder('65bb', { status: 100 }))).toEqual({ kind: 'cancel', deliverectOrderId: '65bb', externalOrderId: 'dlv-65bb' });
    expect(classifyDeliverectOrder(dlvOrder('65bb', { channel: 3 }))).toMatchObject({ kind: 'ignored' });
  });
});

describe('Deliverect webhook signature', () => {
  const url = (q = '') => new URL(`https://hub.test/api/foodhub/webhooks/deliverect/orders${q}`);
  it('hex HMAC-SHA256 of the raw body with the shared secret; GET signs the empty string', () => {
    const raw = JSON.stringify(dlvOrder());
    const sig = crypto.createHmac('sha256', 'dlv-hmac').update(raw).digest('hex');
    expect(deliverectSignature(raw, 'dlv-hmac')).toBe(sig);
    expect(verifyDeliverectWebhook(new Headers({ 'x-server-authorization-hmac-sha256': sig }), raw, url())).toBe(true);
    expect(verifyDeliverectWebhook(new Headers({ 'x-server-authorization-hmac-sha256': sig }), raw + ' ', url())).toBe(false);
    expect(verifyDeliverectWebhook(new Headers({ 'x-server-authorization-hmac-sha256': deliverectSignature('', 'dlv-hmac') }), '', url())).toBe(true);
  });
  it('before certification (staging) the channelLink / location is the secret; never in production', () => {
    const body = dlvOrder();
    const raw = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', 'cl-1').update(raw).digest('hex');
    expect(verifyDeliverectWebhook(new Headers({ 'x-server-authorization-hmac-sha256': sig }), raw, url(), body)).toBe(true);
    process.env.DELIVERECT_BASE_URL = 'https://api.deliverect.example';
    expect(verifyDeliverectWebhook(new Headers({ 'x-server-authorization-hmac-sha256': sig }), raw, url(), body)).toBe(false);
  });
  it('the URL token Food Hub gave at registration also works; anything else is refused', () => {
    expect(verifyDeliverectWebhook(new Headers(), '{}', url('?token=dlv-url-token'))).toBe(true);
    expect(verifyDeliverectWebhook(new Headers({ authorization: 'Bearer dlv-url-token' }), '{}', url())).toBe(true);
    expect(verifyDeliverectWebhook(new Headers(), '{}', url('?token=nope'))).toBe(false);
    expect(verifyDeliverectWebhook(new Headers(), '{}', url())).toBe(false);
    delete process.env.DELIVERECT_WEBHOOK_SECRET;
    expect(verifyDeliverectWebhook(new Headers(), '{}', url('?token=dlv-url-token'))).toBe(false);
  });
});

describe('the kitchen’s actions go back to Deliverect', () => {
  const mapStore = async () => { await getRepo().upsertStore({ channel: 'tgtg', channelStoreId: 'dlv:NDG_MAIN', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} }); };

  it('accept = ACCEPTED 20, ready = PICKUP_READY 70, picked up = FINALIZED 90, with the receipt id; cancel/reject say it is done in MyStore', async () => {
    await mapStore();
    mockFetch([[/\/orderStatus\//, () => ({ status: 200, body: { result: 'OK' } })]]);
    const parsed = parseDeliverectOrder(dlvOrder()) as any;
    const out = await processIncomingOrder(parsed.order);
    expect(out.order.status).toBe('accepted');
    expect(statusCalls()[0].body).toMatchObject({ orderId: '65aa00000000000000000001', status: 20 });
    expect(deliverectRef(out.order)).toMatchObject({ deliverectOrderId: '65aa00000000000000000001' });
    const ready = await runOrderAction(out.order.id, 'ready');
    expect(ready.result.ok).toBe(true);
    const done = await runOrderAction(out.order.id, 'complete');
    expect(done.order?.status).toBe('completed');
    expect(done.result.message).toContain('FINALIZED 90');
    expect(statusCalls().map((c) => c.body.status)).toEqual([20, 70, 90]);
    expect((await tgtgAdapter.denyOrder(out.order, 'x')).status).toBe('blocked');
    expect((await tgtgAdapter.cancelOrder(out.order, 'other')).message).toContain('MyStore');
  });

  it('without Deliverect keys nothing is sent and the kitchen is never blocked ("skipped")', async () => {
    await mapStore();
    delete process.env.DELIVERECT_CLIENT_SECRET;
    mockFetch();
    const out = await processIncomingOrder((parseDeliverectOrder(dlvOrder('65cc')) as any).order);
    expect(out.accept?.status).toBe('skipped');
    await runOrderAction(out.order.id, 'ready');
    const done = await runOrderAction(out.order.id, 'complete');
    expect(done.order?.status).toBe('completed');
    expect(calls).toHaveLength(0);
  });

  it('a refused FINALIZED never stops the pickup from being recorded', async () => {
    await mapStore();
    mockFetch([[/\/orderStatus\//, (_c, n) => (n <= 2 ? { status: 200, body: { result: 'OK' } } : { status: 400, body: { error: 'no' } })]]);
    const out = await processIncomingOrder((parseDeliverectOrder(dlvOrder('65dd')) as any).order);
    await runOrderAction(out.order.id, 'ready');
    const done = await runOrderAction(out.order.id, 'complete');
    expect(done.order?.status).toBe('completed');
    expect(done.result.message).toContain('not reported to the platform');
  });

  it('the feed-only orders (no Deliverect) behave as before', async () => {
    mockFetch();
    const feed = parseGenericOrder('tgtg', 'tgtg', { id: 'tgtg-9', storeId: 'x', items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99 })!;
    const fake = { ...feed, id: 'o', status: 'new', createdAt: '', updatedAt: '' } as any;
    expect((await tgtgAdapter.acceptOrder(fake)).status).toBe('skipped');
    expect((await tgtgAdapter.completeOrder!(fake)).status).toBe('skipped');
    expect((await tgtgAdapter.denyOrder(fake, 'x')).status).toBe('blocked');
    expect(calls).toHaveLength(0);
    expect(deliverectActions).toBeTruthy();
  });

  it('shows the channel as ready when Deliverect is set, with the Deliverect addresses', () => {
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    const r = tgtgAdapter.readiness();
    expect(r.configured).toBe(true);
    expect(r.note).toContain('Deliverect');
    expect(r.extraWebhooks?.map((w) => w.path)).toEqual(['/api/foodhub/webhooks/deliverect/register', '/api/foodhub/webhooks/deliverect/orders']);
  });
});

describe('Deliverect webhooks (one catch-all route)', () => {
  const post = async (kind: string, body: unknown, q = '?token=dlv-url-token') => {
    const { POST } = await import('../app/api/foodhub/webhooks/deliverect/[...kind]/route');
    return POST(new Request(`https://hub.test/api/foodhub/webhooks/deliverect/${kind}${q}`, { method: 'POST', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ kind: kind.split('/') }) });
  };
  const get = async (kind: string, q = '?token=dlv-url-token') => {
    const { GET } = await import('../app/api/foodhub/webhooks/deliverect/[...kind]/route');
    return GET(new Request(`https://hub.test/api/foodhub/webhooks/deliverect/${kind}${q}`) as any, { params: Promise.resolve({ kind: kind.split('/') }) });
  };

  it('refuses unsigned calls', async () => {
    expect((await post('orders', dlvOrder(), '')).status).toBe(401);
    expect((await get('sync-floors', '')).status).toBe(401);
  });

  it('register: remembers the location and returns every URL with the token', async () => {
    const res = await post('register', { accountId: 'acc-1', locationId: 'loc-1', externalLocationId: 'NDG_MAIN', locationName: 'Po Poulet NDG' });
    const urls = await res.json();
    expect(res.status).toBe(200);
    expect(urls).toMatchObject({
      ordersWebhookURL: 'https://hub.test/api/foodhub/webhooks/deliverect/orders?token=dlv-url-token',
      syncProductsURL: 'https://hub.test/api/foodhub/webhooks/deliverect/sync-products?token=dlv-url-token&locationID=loc-1',
      storeStatusWebhookURL: 'https://hub.test/api/foodhub/webhooks/deliverect/store-status?token=dlv-url-token', operationsWebhookURL: '', taxCalculationWebhookURL: '',
    });
    expect((await getRepo().getDoc('deliverect_locations', 'loc-1'))?.data).toMatchObject({ externalLocationId: 'NDG_MAIN' });
    process.env.DELIVERECT_TAX_RATES = '[{"name":"TPS","rate":5},{"name":"TVQ","rate":9.975}]';
    expect((await handleDeliverectRegister({ locationId: 'loc-2' }))?.taxCalculationWebhookURL).toContain('/tax-calculation');
    expect((await post('register', {})).status).toBe(400);
    expect((await (await post('kds/register', { accountId: 'a', locationId: 'l', externalReference: 'e' })).json())).toMatchObject({ orderWebhookUrl: expect.stringContaining('/kds/orders'), productSyncUrl: expect.any(String), orderStatusUpdateUrl: expect.any(String) });
  });

  it('orders: a bag order is saved and processed; another channel’s order is kept, not taken', async () => {
    await getRepo().upsertStore({ channel: 'tgtg', channelStoreId: 'dlv:NDG_MAIN', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    mockFetch([[/\/orderStatus\//, () => ({ status: 200, body: { result: 'OK' } })]]);
    const res = await post('orders', dlvOrder('65ee'));
    expect(res.status).toBe(200);
    for (let i = 0; i < 30 && !(await getRepo().findOrder('tgtg', 'dlv-65ee'))?.timeline?.acceptedAt; i++) await sleep(20);
    expect((await getRepo().findOrder('tgtg', 'dlv-65ee'))?.status).toBe('accepted');
    const other = await post('orders', dlvOrder('65ff', { channel: 5 }));
    expect(await other.json()).toMatchObject({ ignored: expect.stringContaining('not Too Good To Go') });
    await sleep(30);
    expect((await getRepo().listJobs(20)).some((j) => j.kind === 'webhook_unparsed' && j.channel === 'tgtg')).toBe(true);
  });

  it('orders: a channel CANCEL (status 100) cancels the order and confirms CANCELED 110 on the original _id', async () => {
    await getRepo().upsertStore({ channel: 'tgtg', channelStoreId: 'dlv:NDG_MAIN', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    mockFetch([[/\/orderStatus\//, () => ({ status: 200, body: { result: 'OK' } })]]);
    await post('orders', dlvOrder('65ab'));
    for (let i = 0; i < 30 && !(await getRepo().findOrder('tgtg', 'dlv-65ab'))?.timeline?.acceptedAt; i++) await sleep(20);
    const res = await post('orders', dlvOrder('65ab', { status: 100 }));
    expect(res.status).toBe(200);
    for (let i = 0; i < 40 && (await getRepo().findOrder('tgtg', 'dlv-65ab'))?.status !== 'cancelled'; i++) await sleep(20);
    expect((await getRepo().findOrder('tgtg', 'dlv-65ab'))?.status).toBe('cancelled');
    for (let i = 0; i < 30 && !statusCalls().some((c) => c.body.status === 110); i++) await sleep(20);
    expect(statusCalls().find((c) => c.body.status === 110)?.body).toMatchObject({ orderId: '65ab', status: 110, reason: 'cancellation' });
  });

  it('sync-products answers 204 and pushes the brand’s menu; floors, tables, tax, validation, store status, reporting, retail', async () => {
    const repo = getRepo();
    await repo.upsertStore({ channel: 'tgtg', channelStoreId: 'dlv:NDG_MAIN', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    const menu: MasterMenu = {
      brandName: 'Po Poulet', categories: [{ ref: 'c1', name: 'Plats', sortOrder: 1 }], modifierGroups: [{ ref: 'g1', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm1', name: 'Piri', price: 1, available: true }] }],
      items: [{ ref: 'i1', name: 'Poulet', price: 15.5, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] }, { ref: 'i2', name: 'Frites', price: 4.99, categoryRef: 'c1', available: false, modifierGroupRefs: [] }], updatedAt: new Date().toISOString(),
    };
    await repo.saveMenu(menu);
    await post('register', { accountId: 'acc-1', locationId: 'loc-1', externalLocationId: 'NDG_MAIN', locationName: 'NDG' });
    mockFetch([[/\/productAndCategories/, () => ({ status: 200, body: { products: { inserted: 2 } } })]]);
    process.env.DELIVERECT_TAX_RATES = '[{"name":"TPS","rate":5},{"name":"TVQ","rate":9.975}]';
    const sync = await get('sync-products', '?token=dlv-url-token&locationID=loc-1');
    expect(sync.status).toBe(204);
    for (let i = 0; i < 40 && !calls.some((c) => /productAndCategories/.test(c.url)); i++) await sleep(20);
    const pushed = calls.find((c) => /productAndCategories/.test(c.url))!;
    expect(pushed.body).toMatchObject({ accountId: 'acc-1', locationId: 'loc-1', categories: [{ name: 'Plats', posCategoryId: 'c1' }] });
    expect(pushed.body.products.map((p: any) => [p.plu, p.productType, p.price, p.deliveryTax])).toEqual([['GRP-g1', 3, 0, 14975], ['m1', 2, 100, 14975], ['i1', 1, 1550, 14975], ['i2', 1, 499, 14975]]);
    expect(pushed.body.products.find((p: any) => p.plu === 'i1').subProducts).toEqual(['GRP-g1']);
    expect(pushed.body.products.find((p: any) => p.plu === 'i2').visible).toBe(false);

    expect(await (await get('sync-floors')).json()).toEqual({ floors: [] });
    expect(await (await get('sync-tables')).json()).toEqual({ tables: [{ id: 'DLVY', name: 'delivery' }] });
    expect(await (await post('tax-calculation', dlvOrder('t', { items: [{ plu: 'B', name: 'Bag', price: 1000, quantity: 2, productType: 1 }], discountTotal: -200 }))).json()).toEqual({ taxes: [{ name: 'TPS', taxClassId: 0, total: 90 }, { name: 'TVQ', taxClassId: 1, total: 180 }] });
    delete process.env.DELIVERECT_TAX_RATES;
    expect(deliverectTaxCalculation({ taxes: [{ name: 'GST', total: 45 }] })).toEqual({ taxes: [{ name: 'GST', taxClassId: 0, total: 45 }] });

    const valid = await (await post('validate-order', { posLocationId: 'NDG_MAIN', location: 'loc-1', items: [{ _id: 'a', plu: 'i1', quantity: 1 }, { _id: 'b', plu: 'i2', quantity: 2 }] })).json();
    expect(valid).toMatchObject({ isValid: false, errors: [{ code: 'product_snoozed', plu: 'i2', itemId: 'b' }] });
    expect(await validateDeliverectCart({ posLocationId: 'ELSEWHERE', items: [{ plu: 'zz' }] })).toMatchObject({ isValid: true });

    expect((await post('store-status', { storeStatusSyncUpdates: [{ event: 'storeClosed', source: 'external', reason: 'noDriversAvailable', posLocationId: 'NDG_MAIN', channel: 777, channelLinkId: 'cl-1', eventTime: '2026-10-09T01:00:00Z' }] })).status).toBe(200);
    const store = await repo.findStore('tgtg', 'dlv:NDG_MAIN');
    expect(store).toMatchObject({ online: false, meta: { deliverectStoreStatus: { event: 'storeClosed', reason: 'noDriversAvailable' } } });
    await post('store-status', { storeStatusSyncUpdates: [{ event: 'storeOpened', posLocationId: 'NDG_MAIN' }] });
    expect((await repo.findStore('tgtg', 'dlv:NDG_MAIN'))?.online).toBe(true);

    expect((await post('reporting', { orderId: 'zz', status: 20, timeStamp: new Date().toISOString() })).status).toBe(200);
    expect((await post('product-sync-callback', { products: { inserted: 1 }, errors: 0, warnings: 0 })).status).toBe(200);
    expect((await post('kds/order-status', { orderId: 'o', status: 60 })).status).toBe(200);
    expect((await post('kds/product-update', [{ plu: 'a', name: 'b', productType: 1 }])).status).toBe(200);
    expect((await post('retail/events', { eventId: 'e', eventType: 'PICKING_STATUS_UPDATE', eventData: { channelOrderId: 'C1', status: 'PICKING_REJECTED', rejectReason: 'Items not available' } })).status).toBe(200);
    expect((await post('retail/amendments', { channelOrderId: 'C1', itemAmendments: [] })).status).toBe(200);
    expect(await (await get('retail/substitutes/C1/COLA1')).json()).toEqual({ substituteItems: [] });
    expect((await post('nope', {})).status).toBe(404);
    await sleep(40);
    expect((await repo.listActivity({})).some((a) => a.action === 'retail_picking_rejected')).toBe(true);
    expect(deliverectProductsFromMenu(menu, { accountId: 'a', locationId: 'l' }).products).toHaveLength(4);
  });

  it('reporting events land on the order they are about', async () => {
    const { handleDeliverectReporting } = await import('../lib/foodhub/deliverect-ops');
    const repo = getRepo();
    const parsed = parseDeliverectOrder(dlvOrder('65r1')) as any;
    const { order } = await repo.insertOrderIfNew({ ...parsed.order });
    expect(await handleDeliverectReporting({ orderId: '65r1', status: 90, timeStamp: '2026-10-09T01:00:00Z', reason: '' })).toBe('status');
    expect(await handleDeliverectReporting({ orderId: '65r1', courier: { status: 83, firstName: 'X' }, received: '2026-10-09T01:00:00Z' })).toBe('courier');
    expect(await handleDeliverectReporting({ _id: 'n', items: [{}] })).toBe('order');
    expect(await handleDeliverectReporting({ hello: 1 })).toBe('unknown');
    expect((await repo.listEvents(order.id)).map((e) => e.type)).toEqual(expect.arrayContaining(['deliverect_status', 'deliverect_courier']));
  });
});

describe('Too Good To Go feed notifications (any partner, relay or automation)', () => {
  it('reads the meaning of an event from its words, English or French', () => {
    expect(['reservation created', 'new_order', 'order_placed'].map(tgtgEventKind)).toEqual(['reserved', 'reserved', 'reserved']);
    expect(['customer_cancelled', 'reservation annulée', 'refunded'].map(tgtgEventKind)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(['collected', 'picked_up', 'pickup confirmed', 'récupéré', 'bag handed over'].map(tgtgEventKind)).toEqual(['collected', 'collected', 'collected', 'collected', 'collected']);
    expect(['no_show', 'not collected', 'expired'].map(tgtgEventKind)).toEqual(['no_show', 'no_show', 'no_show']);
    expect(['daily summary', 'bag count'].map(tgtgEventKind)).toEqual(['bag_count', 'bag_count']);
    expect(tgtgEventKind('hello')).toBe('unknown');
    expect(parseTgtgEvent({ event: 'order.cancelled', order_id: 'T-1', cancelled_by: 'store', reason: 'Out of bags' })).toMatchObject({ kind: 'cancelled', orderId: 'T-1', by: 'store', reason: 'Out of bags' });
    expect(parseTgtgEvent({ data: { id: 'T-2', status: 'COLLECTED' } })).toMatchObject({ kind: 'collected', orderId: 'T-2' });
    expect(parseTgtgEvent({ type: 'summary', store_id: 'tgtg-ndg', date: '2026-10-08', bags_offered: 12, bags_sold: 10, bags_collected: 9, price: 5.99 }))
      .toEqual({ kind: 'bag_count', word: 'summary', storeId: 'tgtg-ndg', date: '2026-10-08', offered: 12, sold: 10, collected: 9, price: 5.99 });
    expect(parseTgtgEvent('nonsense')).toMatchObject({ kind: 'unknown' });
  });

  const mapTgtg = () => getRepo().upsertStore({ channel: 'tgtg', channelStoreId: 'tgtg-ndg', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
  const bag = (id: string, price = 5.99) => parseGenericOrder('tgtg', 'tgtg', { id, storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price }], total: price })!;

  it('collected completes the order (pickup confirmed), no-show completes and flags it, cancelled cancels, a closed order is never reopened', async () => {
    await mapTgtg();
    mockFetch();
    const a = (await processIncomingOrder(bag('T-A'))).order;
    const b = (await processIncomingOrder(bag('T-B'))).order;
    const c = (await processIncomingOrder(bag('T-C'))).order;
    const repo = getRepo();
    expect(await applyTgtgEvent({ kind: 'collected', orderId: 'T-A' })).toMatchObject({ applied: true });
    expect((await repo.getOrder(a.id))?.status).toBe('completed');
    expect(await applyTgtgEvent({ kind: 'no_show', orderId: 'T-B' })).toMatchObject({ applied: true });
    expect((await repo.getOrder(b.id))?.status).toBe('completed');
    expect((await repo.listEvents(b.id)).some((e) => e.type === 'tgtg_no_show')).toBe(true);
    await applyTgtgEvent({ kind: 'cancelled', orderId: 'T-C', by: 'customer', reason: 'Changed my mind' });
    expect((await repo.getOrder(c.id))?.status).toBe('cancelled');
    expect(await applyTgtgEvent({ kind: 'collected', orderId: 'T-C' })).toMatchObject({ applied: false, message: expect.stringContaining('not reopened') });
    expect((await repo.getOrder(c.id))?.status).toBe('cancelled');
    expect(await applyTgtgEvent({ kind: 'collected' })).toMatchObject({ applied: false });
    expect(await applyTgtgEvent({ kind: 'reserved', orderId: 'T-A' })).toMatchObject({ applied: false });
  });

  it('end of day: the feed orders are counted and written into the bag log (collected + no-show are sold, cancelled are not)', async () => {
    await mapTgtg();
    mockFetch();
    for (const id of ['E-1', 'E-2', 'E-3', 'E-4']) await processIncomingOrder(bag(id));
    await applyTgtgEvent({ kind: 'collected', orderId: 'E-1' });
    await applyTgtgEvent({ kind: 'collected', orderId: 'E-2' });
    await applyTgtgEvent({ kind: 'no_show', orderId: 'E-3' });
    await applyTgtgEvent({ kind: 'cancelled', orderId: 'E-4' });
    const today = localDate(Date.now());
    expect(await feedBagCounts(today, 'NDG_MAIN')).toEqual({ date: today, locationCode: 'NDG_MAIN', reserved: 3, collected: 2, noShow: 1, cancelled: 1, revenue: 17.97, pricePerBag: 5.99 });
    const day = await syncFeedBagDay(today, 'NDG_MAIN', { offered: 10 });
    expect(day).toMatchObject({ date: today, locationCode: 'NDG_MAIN', bagsOffered: 10, bagsSold: 3, pricePerBag: 5.99, feedOrders: 4 });
    expect(await syncFeedBagDay(today, 'HOCHELAGA')).toBeNull();
    const all = await syncAllFeedBagDays();
    expect(all.find((r) => r.locationCode === 'NDG_MAIN' && r.date === today)).toMatchObject({ synced: true, sold: 3 });
  });

  it('the feed route reads a list of notifications: order, pickup, no-show, cancel and a day summary', async () => {
    await mapTgtg();
    mockFetch();
    process.env.TGTG_WEBHOOK_SECRET = 'tgtg-hook';
    const { POST } = await import('../app/api/foodhub/webhooks/tgtg/route');
    const send = (body: unknown, auth = 'tgtg-hook') => POST(new Request('https://hub.test/api/foodhub/webhooks/tgtg', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) }));
    expect((await send([], 'nope')).status).toBe(401);
    const res = await send([
      { id: 'F-1', storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99 },
      { id: 'F-2', storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99 },
      { id: 'F-3', storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99 },
      { weird: true },
    ]);
    expect((await res.json()).events.map((e: any) => e.kind)).toEqual(['reserved', 'reserved', 'reserved', 'unknown']);
    const repo = getRepo();
    for (let i = 0; i < 40 && !(await repo.findOrder('tgtg', 'F-3')); i++) await sleep(20);
    expect(await (await send({ event: 'order.collected', order_id: 'F-1' })).json()).toMatchObject({ events: [{ kind: 'collected' }] });
    await send({ event: 'order.no_show', order_id: 'F-2' });
    await send({ event: 'order.cancelled', order_id: 'F-3', reason: 'Out of stock' });
    for (let i = 0; i < 40 && (await repo.findOrder('tgtg', 'F-3'))?.status !== 'cancelled'; i++) await sleep(20);
    expect([(await repo.findOrder('tgtg', 'F-1'))?.status, (await repo.findOrder('tgtg', 'F-2'))?.status, (await repo.findOrder('tgtg', 'F-3'))?.status]).toEqual(['completed', 'completed', 'cancelled']);
    const today = localDate(Date.now());
    await send({ event: 'daily_summary', store_id: 'tgtg-ndg', date: today, bags_offered: 8, price: 5.99 });
    for (let i = 0; i < 40; i++) { const d = (await (await import('../lib/foodhub/tgtg')).listBagDays(today, today)).find((x) => x.locationCode === 'NDG_MAIN'); if (d) { expect(d).toMatchObject({ bagsOffered: 8, bagsSold: 2 }); break; } await sleep(20); }
    expect((await repo.listJobs(30)).some((j) => j.kind === 'webhook_unparsed' && JSON.stringify(j.request).includes('weird'))).toBe(true);
  });
});
