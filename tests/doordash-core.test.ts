// DoorDash API coverage (task 23), part 1: the protected-store guard, DoorDash's retry rules, the "read what DoorDash
// has" endpoints (store_details, menu_details, store_menu, item availability) and the extended order parsing.
// Every HTTP call is mocked: nothing here reaches DoorDash.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDashAdapter, parseDoorDashOrder } from '../lib/foodhub/adapters/doordash';
import {
  availabilityPath, flattenStoreMenu, getDoorDashAvailability, getDoorDashMenuDetails, getDoorDashStoreDetails, getDoorDashStoreMenu, normalizeMenuDetails, normalizeStoreDetails,
} from '../lib/foodhub/doordash/api';
import { doorDashStoreRefusal, guardDoorDashStore, isProtectedDoorDashId, withoutProtectedIds } from '../lib/foodhub/doordash/guard';
import { retryClass, setDoorDashSleep, withDoorDashRetry } from '../lib/foodhub/doordash/retry';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelResult, StoredOrder } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* not json */ }
    const c: Call = { url, method: init.method || 'GET', body, headers: { ...(init.headers as Record<string, string> | undefined) } };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV_KEYS = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'DOORDASH_USER_AGENT', 'DOORDASH_AVAILABILITY_STYLE', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'FOODHUB_MENU_LOCKED_STORES'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  setDoorDashSleep(async () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDoorDashSleep();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function doorDashEnv(live = true) {
  process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
  process.env.DOORDASH_PROVIDER_TYPE = 'takatak_sandbox'; process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret';
  if (live) process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true'; else delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
  delete process.env.DOORDASH_USER_AGENT; delete process.env.DOORDASH_AVAILABILITY_STYLE;
}

const PO_POULET = '27982486';

describe('protected stores (Po Poulet NDG, DoorDash 27982486)', () => {
  it('is protected by its DoorDash number, its mapping id or a mapping carrying that number', async () => {
    expect(isProtectedDoorDashId(PO_POULET)).toBe(true);
    expect(isProtectedDoorDashId(27982486)).toBe(true);
    expect(isProtectedDoorDashId('27982487')).toBe(false);
    expect(doorDashStoreRefusal({ channelStoreId: 'NDG_6284-POPOULET', meta: { platformStoreId: PO_POULET } }, 'read')).toMatch(/protected/);
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: { platformStoreId: PO_POULET } });
    expect(await guardDoorDashStore('NDG_6284-POPOULET', 'read')).toMatch(/protected/);
    expect(await guardDoorDashStore(PO_POULET, 'write')).toMatch(/protected/);
    expect(await guardDoorDashStore('another-store', 'write')).toBeNull();
  });

  it('a manager lock and the hosting list protect too; "do not touch" only blocks menu changes', async () => {
    process.env.FOODHUB_MENU_LOCKED_STORES = 'doordash:dd-locked';
    expect(await guardDoorDashStore('dd-locked', 'read')).toMatch(/protected/);
    expect(doorDashStoreRefusal({ channelStoreId: 'x', meta: { menuLocked: true } }, 'read')).toMatch(/protected/);
    const dnt = { channelStoreId: 'x', meta: { doNotTouch: true } };
    expect(doorDashStoreRefusal(dnt, 'read')).toBeNull();
    expect(doorDashStoreRefusal(dnt, 'write')).toBeNull();
    expect(doorDashStoreRefusal(dnt, 'menu')).toMatch(/Do not touch/);
  });

  it('withoutProtectedIds drops the protected store from a list', () => {
    expect(withoutProtectedIds([111, 27982486, 222])).toEqual({ kept: [111, 222], dropped: [27982486] });
  });

  it('every live-read call refuses it before any request is made', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 200, body: {} }));
    const refused = await Promise.all([
      getDoorDashStoreDetails(PO_POULET), getDoorDashMenuDetails(PO_POULET), getDoorDashStoreMenu(PO_POULET),
      getDoorDashAvailability(PO_POULET, 'item-1', 'item'), getDoorDashAvailability(PO_POULET, 'opt-1', 'item_option'),
    ]);
    for (const r of refused) expect(r).toMatchObject({ ok: false, status: 'blocked', message: expect.stringMatching(/protected/) });
    expect(calls).toHaveLength(0);
  });
});

describe('DoorDash retry rules (400 never, 429 after 1 minute, 5xx backoff, POST never repeated)', () => {
  const res = (httpStatus: number | undefined, ok = false): ChannelResult => ({ channel: 'doordash', ok, status: ok ? 'done' : 'error', message: `HTTP ${httpStatus}`, httpStatus });

  it('classifies statuses', () => {
    expect(retryClass(400, 'PATCH')).toBe('never');
    expect(retryClass(404, 'GET')).toBe('never');
    expect(retryClass(429, 'POST')).toBe('rate_limit');
    expect(retryClass(500, 'PUT')).toBe('backoff');
    expect(retryClass(503, 'GET')).toBe('backoff');
    expect(retryClass(500, 'POST')).toBe('never');
    expect(retryClass(undefined, 'GET')).toBe('backoff');
  });

  it('retries a 500 twice with growing waits, then gives up', async () => {
    const waits: number[] = [];
    let n = 0;
    const out = await withDoorDashRetry(async () => { n++; return res(500); }, { method: 'PUT', sleep: async (ms) => { waits.push(ms); } });
    expect(n).toBe(3);
    expect(waits).toEqual([400, 1200]);
    expect(out.ok).toBe(false);
  });

  it('a 500 then success returns the success; a 400 is never retried', async () => {
    let n = 0;
    const ok = await withDoorDashRetry(async () => (++n < 2 ? res(502) : res(200, true)), { method: 'GET', sleep: async () => undefined });
    expect(ok.ok).toBe(true); expect(n).toBe(2);
    n = 0;
    await withDoorDashRetry(async () => { n++; return res(400); }, { method: 'PATCH', sleep: async () => undefined });
    expect(n).toBe(1);
  });

  it('a POST is not repeated after a 500 (a second menu POST would be a duplicate menu)', async () => {
    let n = 0;
    await withDoorDashRetry(async () => { n++; return res(500); }, { method: 'POST', sleep: async () => undefined });
    expect(n).toBe(1);
  });

  it('429: reported with "try again in 1 minute" for a person; waited out (once) by a background job', async () => {
    let n = 0;
    const person = await withDoorDashRetry(async () => { n++; return res(429); }, { method: 'GET' });
    expect(n).toBe(1);
    expect(person.retryAfterMs).toBe(60_000);
    expect(person.message).toMatch(/1 minute/);
    const waits: number[] = [];
    n = 0;
    const job = await withDoorDashRetry(async () => (++n < 2 ? res(429) : res(200, true)), { method: 'GET', waitOn429: true, sleep: async (ms) => { waits.push(ms); } });
    expect(job.ok).toBe(true); expect(waits).toEqual([60_000]);
  });

  it('the adapter uses it: a 500 on item 86 is retried', async () => {
    doorDashEnv();
    let n = 0;
    mockFetch(() => (++n === 1 ? { status: 500, body: { message: 'boom' } } : { status: 200, body: {} }));
    const store = { id: 's', channel: 'doordash', channelStoreId: 'dd-1', brandName: 'B', locationCode: 'L1', autoAccept: true, online: true, meta: {} } as const;
    const r = await doorDashAdapter.setItemAvailability(store as never, ['i1'], false);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'PUT']);
  });
});

describe('GET store_details, menu_details, store_menu and item availability', () => {
  it('store_details: protocol, auto order release, deactivations, state', async () => {
    doorDashEnv(false); // reads need only the credentials, not the live switch
    mockFetch(() => ({ status: 200, body: {
      provider_name: 'Takatak', merchant_supplied_id: 'dd-1', is_active: false, is_order_protocol_pos: true, auto_release_enabled: true, auto_release_distance: 400,
      auto_release_from_store_enabled: false, special_instructions_max_length: 128,
      current_deactivations: [{ reason: 'operational_issues', notes: 'Paused from TAKATAK Food Hub', created_at: '2026-10-09T01:00:00Z', end_time: '2026-10-09T03:00:00Z' }],
    } }));
    const r = await getDoorDashStoreDetails('dd-1');
    expect(calls[0].url).toBe('https://openapi.doordash.com/marketplace/api/v1/stores/dd-1/store_details');
    expect(calls[0].headers.Authorization).toMatch(/^Bearer /);
    expect(r.data).toMatchObject({
      isActive: false, orderProtocolPos: true, autoRelease: { enabled: true, distance: 400, fromStoreEnabled: false }, specialInstructionsMaxLength: 128, state: 'paused',
      deactivations: [{ reason: 'operational_issues', endTime: '2026-10-09T03:00:00Z' }],
    });
    expect(normalizeStoreDetails('x', {}).state).toBe('online');
  });

  it('reads are blocked without credentials, with a clear message', async () => {
    for (const k of ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET']) delete process.env[k];
    mockFetch(() => ({ status: 200, body: {} }));
    const r = await getDoorDashStoreDetails('dd-1');
    expect(r).toMatchObject({ ok: false, status: 'blocked' });
    expect(r.message).toMatch(/credentials missing/i);
    expect(calls).toHaveLength(0);
  });

  it('menu_details: menus with ids, active, last update, regular and special hours', async () => {
    doorDashEnv();
    const body = { provider_name: 'P', merchant_supplied_id: 'dd-1', menus: [
      { menu_id: 'm-1', name: 'Dinner', subtitle: 'Dinner', is_active: true, is_pos_menu: true, url: 'https://www.doordash.com/store/1', latest_menu_update: { created_at: '2026-10-09T01:00:00Z', status: 'FAILED' }, last_successful_menu_update_at: '2026-10-08T01:00:00Z',
        open_hours: [{ start_time: '08:00:00', end_time: '15:00:00', day_index: 'mon' }], special_hours: [{ date: '2026-12-25', start_time: '00:00', end_time: '23:59', closed: true }] },
    ] };
    mockFetch(() => ({ status: 200, body }));
    const r = await getDoorDashMenuDetails('dd-1');
    expect(calls[0].url).toMatch(/\/stores\/dd-1\/menu_details$/);
    expect(r.data).toEqual(normalizeMenuDetails(body));
    expect(r.data![0]).toMatchObject({ id: 'm-1', active: true, isPosMenu: true, lastUpdateStatus: 'FAILED', openHours: [{ day: 'MON', start: '08:00', end: '15:00' }], specialHours: [{ date: '2026-12-25', closed: true }] });
  });

  it('store_menu: items and options flattened, with active / suspended and both prices', () => {
    const live = flattenStoreMenu({ menus: [{ id: 'm-1', reference: 'r-1', store: { merchant_supplied_id: 'dd-1' }, menu: { name: 'Main', active: true, categories: [
      { merchant_supplied_id: 'c1', items: [
        { merchant_supplied_id: 'i1', name: 'Poutine', active: true, price: 1299, base_price: 1199, extras: [{ options: [{ merchant_supplied_id: 'o1', name: 'Bacon', active: false, price: 200, extras: [{ options: [{ merchant_supplied_id: 'o2', name: 'Extra', active: true, price: 50 }] }] }] }] },
        { merchant_supplied_id: 'i2', name: 'Salade', active: true, is_suspended: true, price: 900 },
      ] },
    ] } }] });
    expect(live.menus).toEqual([{ id: 'm-1', reference: 'r-1', name: 'Main', active: true }]);
    expect(live.entries.map((e) => [e.id, e.type, e.active, e.suspended, e.price, e.basePrice])).toEqual([
      ['i1', 'item', true, false, 1299, 1199], ['o1', 'item_option', false, false, 200, null], ['o2', 'item_option', true, false, 50, null], ['i2', 'item', true, true, 900, null],
    ]);
    // a single menu object (no menus[]) is read too
    expect(flattenStoreMenu({ store: {}, menu: { name: 'M', categories: [{ items: [{ merchant_supplied_id: 'x', name: 'X', price: 1 }] }] } }).entries).toHaveLength(1);
  });

  it('GET store_menu is sent for the store and returns the flattened list', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 200, body: { menus: [{ id: 'm', menu: { name: 'M', categories: [{ items: [{ merchant_supplied_id: 'a', name: 'A', price: 100 }] }] } }] } }));
    const r = await getDoorDashStoreMenu('dd-1');
    expect(calls[0].url).toMatch(/\/stores\/dd-1\/store_menu$/);
    expect(r.data!.entries[0]).toMatchObject({ id: 'a', active: true });
  });

  it('item availability: the reference puts the item id in the path; DOORDASH_AVAILABILITY_STYLE=store puts the store there', async () => {
    doorDashEnv();
    expect(availabilityPath('dd-1', 'item-9', 'item')).toBe('/api/v1/stores/item-9/item/availability');
    expect(availabilityPath('dd-1', 'opt-9', 'item_option')).toBe('/api/v1/stores/opt-9/item_option/availability');
    process.env.DOORDASH_AVAILABILITY_STYLE = 'store';
    expect(availabilityPath('dd-1', 'item-9', 'item')).toBe('/api/v1/stores/dd-1/item/availability?merchant_supplied_id=item-9');
    delete process.env.DOORDASH_AVAILABILITY_STYLE;
    mockFetch(() => ({ status: 200, body: { merchant_supplied_id: 'item-9', is_active: false, start_time: '2026-10-09 10:00:00', end_time: '2026-10-09 22:00:00' } }));
    const r = await getDoorDashAvailability('dd-1', 'item-9', 'item');
    expect(r.data).toEqual({ id: 'item-9', active: false, start: '2026-10-09 10:00:00', end: '2026-10-09 22:00:00' });
  });

  it('a 404 from DoorDash is reported as an error and not retried', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 404, body: { message: 'Store not found' } }));
    const r = await getDoorDashStoreDetails('dd-404');
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe('DoorDash order parsing: line ids, promotions (new funding fields), tax, scheduled, plasticware', () => {
  const base = { id: 'ord-1', store: { merchant_supplied_id: 'dd-1' }, consumer: { first_name: 'Lea', last_name: 'Martin', phone: '+15145550000' }, subtotal: 2000, tax: 300, estimated_pickup_time: '2026-10-09T18:30:00Z' };

  it('keeps line_item_id / line_option_id so the order can be adjusted later', () => {
    const o = parseDoorDashOrder({ order: { ...base, categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'Poutine', price: 1000, quantity: 2, line_item_id: 'li-1', extras: [{ options: [{ merchant_supplied_id: 'o1', name: 'Bacon', price: 100, quantity: 1, line_option_id: 'lo-1' }] }] }] }] } })!;
    expect(o.lines[0].lineItemId).toBe('li-1');
    expect(o.lines[0].modifiers[0].lineOptionId).toBe('lo-1');
  });

  it('merchant-funded discount comes from total_merchant_funded_discount_amount; stacked and co-funded promos are listed', () => {
    const o = parseDoorDashOrder({ order: { ...base, total_merchant_funded_discount_amount: 600, applied_discounts_details: [
      { total_discount_amount: 500, promo_id: 'p1', promo_code: '$5 off', external_campaign_id: 'PLU-1', doordash_funded_discount_amount: 300, merchant_funded_discount_amount: 200 },
      { total_discount_amount: 400, promo_id: 'p2', doordash_funded_discount_amount: 0, merchant_funded_discount_amount: 400 },
    ], categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'A', price: 100, quantity: 1, applied_item_discount_details: [{ total_discount_amount: 100, external_campaign_id: 'PLU-9', merchant_funded_discount_amount: 100, doordash_funded_discount_amount: 0 }] }] }] } })!;
    expect(o.discount).toBe(6);
    expect(o.doorDash?.promotions).toHaveLength(3);
    expect(o.doorDash?.promotions?.[0]).toEqual({ id: 'p1', code: '$5 off', campaignId: 'PLU-1', total: 5, merchantFunded: 2, doordashFunded: 3 });
    expect(o.doorDash?.promotions?.[2]).toMatchObject({ itemId: 'i1', merchantFunded: 1 });
    expect(o.doorDash?.doordashFundedDiscount).toBe(3);
  });

  it('without total_merchant_funded_discount_amount the entries are summed; deprecated fields still work', () => {
    expect(parseDoorDashOrder({ order: { ...base, applied_discounts_details: [{ total_discount_amount: 300, merchant_funded_discount_amount: 300 }] } })!.discount).toBe(3);
    expect(parseDoorDashOrder({ ...base, merchant_funded_discount: 500 })!.discount).toBe(5);
    expect(parseDoorDashOrder({ order: base })!.discount).toBe(0);
  });

  it('tax remitted by DoorDash, commission, scheduled / catering, plasticware, masked phone, self-delivery address', () => {
    const o = parseDoorDashOrder({ order: { ...base, is_tax_remitted_by_doordash: true, tax_amount_remitted_by_doordash: 300, commission_type: 'DASHPASS', is_scheduled: true, experience: 'MARKETPLACE_CATERING',
      is_plastic_ware_option_selected: false, fulfillment_type: 'mx_fleet_delivery', delivery_fee: 499, delivery_address: { street: '1 Rue X', city: 'Montréal', state: 'QC', zip_code: 'H1H 1H1' }, address_instructions: 'Code 1234' } })!;
    expect(o.doorDash).toMatchObject({ taxRemittedByDoorDash: true, taxRemittedAmount: 3, commissionType: 'dashpass', scheduled: true, catering: true, plasticware: false, customerPhone: '+15145550000', deliveryAddress: '1 Rue X, Montréal, QC, H1H 1H1', addressInstructions: 'Code 1234' });
    expect(o.deliveryFee).toBe(4.99);
    expect(o.orderSource).toBe('MARKETPLACE_CATERING');
  });

  it('an order with none of these has no doorDash details (nothing invented)', () => {
    const o = parseDoorDashOrder({ order: { id: 'x', store: { merchant_supplied_id: 'a' }, subtotal: 100, tax: 0 } })!;
    expect(o.doorDash).toBeUndefined();
    expect(o.deliveryFee).toBe(0);
  });
});

describe('adapter order calls keep working (smoke)', () => {
  it('markReady still PATCHes order_ready_for_pickup', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 202, body: {} }));
    await doorDashAdapter.markReady({ externalOrderId: 'dd-1', id: 'o1' } as StoredOrder);
    expect(calls[0].url).toMatch(/\/api\/v1\/orders\/dd-1\/events\/order_ready_for_pickup$/);
  });
});
