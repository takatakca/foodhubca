// Certification backlog (task 13): docs/PLATFORM_API_RESEARCH.md §6, each field checked on the official docs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOORDASH_ERROR_CODES, doorDashAdapter, doorDashFailure, doorDashUserAgent, rejectReasonOf } from '../lib/foodhub/adapters/doordash';
import type { StoredOrder } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url, method: init.method || 'GET', body, headers: { ...(init.headers as Record<string, string> | undefined) } };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV_KEYS = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'DOORDASH_USER_AGENT', 'LIVE_CONNECTORS_GLOBAL_ENABLED'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function doorDashEnv() {
  process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
  process.env.DOORDASH_PROVIDER_TYPE = 'takatak_sandbox'; process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  delete process.env.DOORDASH_USER_AGENT;
}

describe('DoorDash User-Agent (<ProviderType in CamelCase>/1.0)', () => {
  it('turns the snake_case provider type into the documented CamelCase form', () => {
    expect(doorDashUserAgent('merchant_sandbox', '')).toBe('MerchantSandbox/1.0'); // DoorDash's own example
    expect(doorDashUserAgent('takatak', '')).toBe('Takatak/1.0');
    expect(doorDashUserAgent('', '')).toBeNull();
    expect(doorDashUserAgent('doordash_pizza', 'DoorDashPizza/1.0')).toBe('DoorDashPizza/1.0'); // exact spelling override
  });

  it('is sent on every Marketplace call, with the JWT and auth-version headers', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 200, body: {} }));
    await doorDashAdapter.markReady({ externalOrderId: 'dd-1', id: 'o1' } as StoredOrder);
    expect(calls[0].headers['User-Agent']).toBe('TakatakSandbox/1.0');
    expect(calls[0].headers['auth-version']).toBe('v2');
    expect(calls[0].headers.Authorization).toMatch(/^Bearer /);
  });
});

describe('DoorDash reject: documented failure_reason strings + item-level errors[]', () => {
  const line = (externalId: string, name: string, mods: Array<[string, string]> = []) => ({ externalId, name, quantity: 1, unitPrice: 5, total: 5, modifiers: mods.map(([id, n]) => ({ externalId: id, name: n, quantity: 1, unitPrice: 0 })) });
  const order = { brandName: 'Pi Pita', placedAt: '2026-10-07T18:30:00Z', lines: [line('i1', 'Poutine'), line('i2', 'Shawarma', [['m1', 'Extra garlic']])] };

  it('reads the reject pop-up text (label — details) and free text', () => {
    expect(rejectReasonOf('Item out of stock — Poutine')).toEqual({ reason: 'out_of_stock', details: 'Poutine' });
    expect(rejectReasonOf('Kitchen too busy')).toEqual({ reason: 'too_busy', details: '' });
    expect(rejectReasonOf('Clover did not receive the order').reason).toBe('pos_issue');
    expect(rejectReasonOf('Rejected by restaurant').reason).toBe('other');
  });

  it('out of stock: names the item (and option) and sends one ITEM_OUT_OF_STOCK error per id', () => {
    const f = doorDashFailure(order, 'Item out of stock — no more poutine, extra garlic');
    expect(f.failure_reason).toBe('Item Unavailable - Poutine - i1 - Out of stock; Item Unavailable - Extra garlic - m1 - Out of stock');
    expect(f.errors).toEqual([
      { code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i1', message: 'Item Unavailable - Poutine - Out of stock' },
      { code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'm1', message: 'Item Unavailable - Extra garlic - Out of stock' },
    ]);
    for (const e of f.errors!) expect(DOORDASH_ERROR_CODES).toContain(e.code);
    // 86'd at the location → found without being named
    expect(doorDashFailure(order, 'Item out of stock', new Set(['i2'])).errors?.map((e) => e.merchant_supplied_id)).toEqual(['i2']);
    // one-line order → that line
    expect(doorDashFailure({ ...order, lines: [line('i9', 'Falafel')] }, 'Item out of stock').errors?.[0].merchant_supplied_id).toBe('i9');
    // nothing identifiable → still the documented category, never empty
    expect(doorDashFailure(order, 'Item out of stock')).toEqual({ failure_reason: 'Item Unavailable - Out of stock' });
  });

  it('store-level reasons use DoorDash’s documented strings (no errors[])', () => {
    expect(doorDashFailure(order, 'Store / kitchen closed')).toEqual({ failure_reason: 'Store is either currently closed or your order cannot be prepared prior to close.' });
    expect(doorDashFailure(order, 'Kitchen too busy').failure_reason).toMatch(/^Pi Pita is experiencing high order volume and cannot prepare your order for \d\d:\d\d$/);
    expect(doorDashFailure(order, 'POS / Clover problem')).toEqual({ failure_reason: 'POS Exception - Store is offline' });
    expect(doorDashFailure(order, 'Other — allergy we cannot handle').failure_reason).toBe('Rejected by the restaurant: allergy we cannot handle');
    expect(doorDashFailure(order, 'Other').failure_reason).toBe('Rejected by the restaurant (reason not given)');
  });

  it('denyOrder PATCHes order_status fail with the failure body, using the location’s 86 list', async () => {
    doorDashEnv();
    const { getRepo } = await import('../lib/foodhub/repo');
    await getRepo().saveMenu({ brandName: 'Pi Pita', categories: [], items: [], modifierGroups: [], unavailableByLocation: { NDG: ['i2'] }, updatedAt: 'x' });
    mockFetch(() => ({ status: 200, body: {} }));
    const res = await doorDashAdapter.denyOrder({ ...order, id: 'o1', externalOrderId: 'dd-9', locationCode: 'NDG' } as unknown as StoredOrder, 'Item out of stock');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toMatch(/\/api\/v1\/orders\/dd-9$/);
    expect(calls[0].body).toEqual({ merchant_supplied_id: 'o1', order_status: 'fail', failure_reason: 'Item Unavailable - Shawarma - i2 - Out of stock', errors: [{ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i2', message: 'Item Unavailable - Shawarma - Out of stock' }] });
  });
});

describe('DoorDash order source (experience: DoorDash / Caviar / Storefront)', () => {
  const ddOrder = (extra: Record<string, unknown> = {}) => ({ id: 'dd-src', store: { merchant_supplied_id: 'dd-pita' }, subtotal: 1000, tax: 150, categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'Poutine', price: 1000, quantity: 1 }] }], ...extra });

  it('is parsed from the order and labelled for the staff', async () => {
    const { parseDoorDashOrder } = await import('../lib/foodhub/adapters/doordash');
    expect(parseDoorDashOrder(ddOrder({ experience: 'CAVIAR' }))?.orderSource).toBe('CAVIAR');
    expect(parseDoorDashOrder(ddOrder({ experience: 'storefront' }))?.orderSource).toBe('STOREFRONT');
    expect(parseDoorDashOrder(ddOrder())?.orderSource).toBeUndefined();
    const { orderSourceLabel } = await import('../lib/foodhub/types');
    expect(orderSourceLabel('DOORDASH')).toBe('DoorDash');
    expect(orderSourceLabel('CAVIAR')).toBe('Caviar');
    expect(orderSourceLabel('STOREFRONT')).toBe('Storefront');
    expect(orderSourceLabel('NEW_THING')).toBe('New Thing');
    expect(orderSourceLabel(undefined)).toBeNull();
  });

  it('is printed on the Clover kitchen note', async () => {
    const { parseDoorDashOrder } = await import('../lib/foodhub/adapters/doordash');
    const { cloverOrderNote } = await import('../lib/foodhub/pos/clover-order');
    const o = { ...parseDoorDashOrder(ddOrder({ experience: 'CAVIAR' }))!, id: 'o1', status: 'new', createdAt: '', updatedAt: '' } as StoredOrder;
    expect(cloverOrderNote(o)).toContain('Source: Caviar');
    expect(cloverOrderNote({ ...o, orderSource: undefined })).not.toContain('Source:');
  });
});

describe('DoorDash merchant_tip_amount', () => {
  it('counts the staff tip (cents) on pickup orders, plus the self-delivery tip', async () => {
    const { doorDashTip, parseDoorDashOrder } = await import('../lib/foodhub/adapters/doordash');
    expect(doorDashTip({ merchant_tip_amount: 250 })).toBe(2.5);
    expect(doorDashTip({ merchant_tip_amount: 250, tip_amount: 300 })).toBe(5.5);
    expect(doorDashTip({ tip_amount: 300 })).toBe(3);
    expect(doorDashTip({ tip: 100 })).toBe(1); // legacy fallback only
    expect(doorDashTip({ merchant_tip_amount: 0, tip: 100 })).toBe(0);
    expect(doorDashTip({})).toBe(0);
    const o = parseDoorDashOrder({ id: 'dd-tip', is_pickup: true, fulfillment_type: 'pickup', merchant_tip_amount: 175, subtotal: 1000, tax: 150, store: { merchant_supplied_id: 's' }, categories: [] });
    expect(o?.tip).toBe(1.75);
    expect(o?.total).toBe(11.5); // tip is not added to the order total
  });
});

describe('DoorDash fulfillment_type', () => {
  it('reads fulfillment_type first, is_pickup as fallback', async () => {
    const { parseDoorDashOrder } = await import('../lib/foodhub/adapters/doordash');
    const p = (extra: Record<string, unknown>) => parseDoorDashOrder({ id: 'dd-f', store: { merchant_supplied_id: 's' }, categories: [], ...extra })?.fulfillment;
    expect(p({ fulfillment_type: 'pickup' })).toBe('pickup');
    expect(p({ fulfillment_type: 'dx_delivery', is_pickup: true })).toBe('delivery');
    expect(p({ fulfillment_type: 'mx_fleet_delivery' })).toBe('delivery');
    expect(p({ is_pickup: true })).toBe('pickup');
    expect(p({})).toBe('delivery');
  });
});

describe('DoorDash dual pricing (price = delivery, base_price = pickup)', () => {
  const menu = (extra: Record<string, unknown> = {}) => ({
    brandName: 'Pi Pita', updatedAt: 'x',
    categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }],
    items: [{ ref: 'i1', name: 'Poutine', price: 10, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] }],
    modifierGroups: [{ ref: 'g1', name: 'Extras', min: 0, max: 1, modifiers: [{ ref: 'm1', name: 'Cheese', price: 2, available: true }] }],
    channelMarkupPct: { doordash: 20 },
    ...extra,
  });

  it('sends base_price on items and options when a DoorDash pickup price is set (0 = in-store price)', async () => {
    const { toDoorDashMenu, pickupPriceFor } = await import('../lib/foodhub/menu/translate');
    const body = toDoorDashMenu(menu({ pickupMarkupPct: { doordash: 0 } }) as any, 'dd-pita', 'takatak', 'ref-1');
    const item = body.menu.categories[0].items[0] as any;
    expect(item.price).toBe(1200); // delivery: +20%
    expect(item.base_price).toBe(1000); // pickup: in-store
    expect(item.extras[0].options[0]).toMatchObject({ price: 240, base_price: 200 });
    expect(pickupPriceFor({ price: 10 }, 'doordash', { pickupMarkupPct: { doordash: 5 } })).toBe(10.5);
    expect(pickupPriceFor({ price: 10 }, 'doordash', {})).toBeNull();
  });

  it('sends no base_price when the menu has no pickup price (delivery price applies to pickup, as before)', async () => {
    const { toDoorDashMenu } = await import('../lib/foodhub/menu/translate');
    const item = toDoorDashMenu(menu() as any, 'dd-pita', 'takatak', 'ref-1').menu.categories[0].items[0] as any;
    expect(item.price).toBe(1200);
    expect('base_price' in item).toBe(false);
    expect('base_price' in item.extras[0].options[0]).toBe(false);
  });
});

describe('PUT /api/foodhub/menu keeps the DoorDash pickup price setting', () => {
  it('stores pickupMarkupPct (0 is a value) and refuses other platforms', async () => {
    const prev = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    try {
      const { PUT } = await import('../app/api/foodhub/menu/route');
      const { getRepo } = await import('../lib/foodhub/repo');
      const put = (menu: unknown) => PUT(new Request('http://hub.local/api/foodhub/menu', { method: 'PUT', headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ menu }) }) as any, {} as never);
      const base = { brandName: 'Po Poulet', categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }], items: [{ ref: 'i1', name: 'Poutine', price: 9.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }], modifierGroups: [] };
      expect((await put({ ...base, pickupMarkupPct: { uber_eats: 0 } })).status).toBe(400);
      expect((await put({ ...base, channelMarkupPct: { doordash: 20 }, pickupMarkupPct: { doordash: 0 } })).status).toBe(200);
      expect((await getRepo().getMenu('Po Poulet'))?.pickupMarkupPct).toEqual({ doordash: 0 });
    } finally {
      if (prev === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = prev;
    }
  });
});

describe('DoorDash Automatic Item Availability Polling (GET …/item-polling/{location_id})', () => {
  const brandMenu = () => ({
    brandName: 'Pi Pita', updatedAt: 'x',
    categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }],
    items: [
      { ref: 'i1', name: 'Poutine', price: 10, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] },
      { ref: 'i2', name: 'Shawarma', price: 12, categoryRef: 'c1', available: false, modifierGroupRefs: [] },
      { ref: 'i3', name: 'Orphan', price: 1, categoryRef: 'gone', available: false, modifierGroupRefs: [] },
    ],
    modifierGroups: [
      { ref: 'g1', name: 'Extras', min: 0, max: 2, modifiers: [{ ref: 'm1', name: 'Cheese', price: 2, available: true }, { ref: 'm2', name: 'Bacon', price: 2, available: true }] },
      { ref: 'g9', name: 'Unused', min: 0, max: 1, modifiers: [{ ref: 'm9', name: 'Nope', price: 0, available: false }] },
    ],
    unavailableByLocation: { NDG: ['m2'] },
  });

  it('lists only the 86’d items and options of the menu, typed item / item_option', async () => {
    const { toDoorDashItemPolling } = await import('../lib/foodhub/menu/translate');
    const { menuForLocation } = await import('../lib/foodhub/ops');
    expect(toDoorDashItemPolling(menuForLocation(brandMenu() as any, 'NDG'))).toEqual([
      { merchant_supplied_id: 'i2', is_active: false, type: 'item' },
      { merchant_supplied_id: 'm2', is_active: false, type: 'item_option' },
    ]);
    expect(toDoorDashItemPolling(menuForLocation(brandMenu() as any, 'LAVAL'))).toEqual([{ merchant_supplied_id: 'i2', is_active: false, type: 'item' }]);
  });

  it('answers DoorDash with the location’s 86 list; [] when all in stock; 401 / 404 / 409 (locked store)', async () => {
    doorDashEnv();
    const { getRepo } = await import('../lib/foodhub/repo');
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/item-polling/[locationId]/route');
    await getRepo().saveMenu(brandMenu() as any);
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-pita', brandName: 'Pi Pita', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: '27982486', brandName: 'Pi Pita', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    const get = (id: string, auth = 'dd-secret') => GET(new Request(`http://hub.local/api/foodhub/webhooks/doordash/item-polling/${id}`, { headers: { authorization: auth } }) as any, { params: Promise.resolve({ locationId: id }) });
    expect((await get('dd-pita', 'wrong')).status).toBe(401);
    expect((await get('nope')).status).toBe(404);
    expect((await get('27982486')).status).toBe(409); // locked store: never answered
    const res = await get('dd-pita');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ merchant_supplied_id: 'i2', is_active: false, type: 'item' }, { merchant_supplied_id: 'm2', is_active: false, type: 'item_option' }]);
    await getRepo().saveMenu({ ...brandMenu(), items: brandMenu().items.map((i) => ({ ...i, available: true })), unavailableByLocation: {} } as any);
    expect(await (await get('dd-pita')).json()).toEqual([]);
  });
});

describe('Uber Eats "Disconnect from Uber" (DELETE pos_data with the merchant token)', () => {
  const UBER_KEYS = ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET', 'UBER_ENV', 'UBER_ACCESS_TOKEN', 'DASHBOARD_PASSWORD'];
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of UBER_KEYS) prev[k] = process.env[k];
    process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret'; delete process.env.UBER_ENV; delete process.env.UBER_ACCESS_TOKEN;
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true'; process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  });
  afterEach(() => { for (const k of UBER_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
  const sessionId = 'b'.repeat(36);

  it('sends DELETE /v1/eats/stores/{id}/pos_data with the merchant token; refuses a store not on that account', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { disconnectUberStore } = await import('../lib/foodhub/adapters/uber-provision');
    await getRepo().setKv(`uber-connect:${sessionId}`, { createdAt: Date.now(), token: 'merchant-token', stores: [{ id: 'uber-stl', name: 'Pi Pita' }] });
    mockFetch(() => ({ status: 204 }));
    const res = await disconnectUberStore(sessionId, 'uber-stl');
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.uber.com/v1/eats/stores/uber-stl/pos_data' });
    expect(calls[0].headers.Authorization).toBe('Bearer merchant-token');
    await expect(disconnectUberStore(sessionId, 'someone-else')).rejects.toThrow(/not on the Uber Eats account/);
    await expect(disconnectUberStore('c'.repeat(36), 'uber-stl')).rejects.toThrow(/expired/);
  });

  it('route: marks the Food Hub mapping disconnected and logs it', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { POST } = await import('../app/api/foodhub/uber-connect/disconnect/route');
    await getRepo().setKv(`uber-connect:${sessionId}`, { createdAt: Date.now(), token: 'merchant-token', stores: [{ id: 'uber-stl', name: 'Pi Pita' }] });
    const store = await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-stl', brandName: 'Pi Pita', locationCode: 'SAINT_LEONARD', autoAccept: true, online: true, meta: { provisioned: true, uberPos: { orderManager: 'foodhub' } } });
    mockFetch(() => ({ status: 204 }));
    const post = (body: unknown) => POST(new Request('http://hub.local/api/foodhub/uber-connect/disconnect', { method: 'POST', headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, {} as never);
    expect((await post({ id: sessionId })).status).toBe(400);
    const res = await post({ id: sessionId, storeId: 'uber-stl' });
    expect(res.status).toBe(200);
    const meta = (await getRepo().getStore(store.id))!.meta;
    expect(meta.provisioned).toBe(false);
    expect(typeof meta.uberDisconnectedAt).toBe('string');
    expect(meta.uberPos).toBeUndefined();
    mockFetch(() => ({ status: 403, body: { message: 'forbidden' } }));
    expect((await post({ id: sessionId, storeId: 'uber-stl' })).status).toBe(409);
  });
});
