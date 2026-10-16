// DoorDash API coverage (task 23), part 2: order adjustment / return / events, every webhook type (Dasher Status in its
// documented nested shape, Order Release, Order Adjustment, Store Temporarily Deactivated, Onboarding status, Report Ready),
// Order Cart Validation and the Reporting API. HTTP is mocked; nothing reaches DoorDash.
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDoorDashOrder } from '../lib/foodhub/adapters/doordash';
import { setDoorDashSleep } from '../lib/foodhub/doordash/retry';
import { validateDoorDashCart } from '../lib/foodhub/doordash/ocv';
import {
  adjustDoorDashOrder, adjustmentFromMissing, optionAdjustment, returnDoorDashOrder, sendOrderEvent, substitutionFor,
} from '../lib/foodhub/doordash/orders';
import {
  allowedDoorDashReportUrl, csvFromReportFile, getDoorDashReportLink, listDoorDashReports, readReportLink, refreshDoorDashReport, reportBody, requestDoorDashReport, withoutProtectedRows,
} from '../lib/foodhub/doordash/reports';
import { getRepo } from '../lib/foodhub/repo';
import { adjustedLines, classifyDoorDash, flattenDelivery, handleDoorDashWebhook, isCartValidation } from '../lib/foodhub/webhooks/doordash';
import { runOrderAction } from '../lib/foodhub/pipeline';
import { saveHours } from '../lib/foodhub/hours';
import type { MasterMenu, StoredOrder } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown; raw?: Uint8Array }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* not json */ }
    const c: Call = { url, method: init.method || 'GET', body, headers: { ...(init.headers as Record<string, string> | undefined) } };
    calls.push(c);
    const r = route(c);
    const payload = r.raw ?? (r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return new Response(payload as BodyInit | null, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'DOORDASH_ORDER_ADJUSTMENT', 'DOORDASH_ORDER_RETURNS',
  'DOORDASH_REPORTS_DEVELOPER_ID', 'DOORDASH_REPORTS_KEY_ID', 'DOORDASH_REPORTS_SIGNING_SECRET', 'DOORDASH_REPORT_ALLOWED_HOSTS', 'FOODHUB_MENU_LOCKED_STORES'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV) saved[k] = process.env[k];
  setDoorDashSleep(async () => undefined);
  process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
  process.env.DOORDASH_PROVIDER_TYPE = 'takatak_sandbox'; process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret'; process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  delete process.env.DOORDASH_ORDER_ADJUSTMENT; delete process.env.DOORDASH_ORDER_RETURNS; delete process.env.FOODHUB_MENU_LOCKED_STORES;
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDoorDashSleep();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const PO_POULET = '27982486';
const order = (over: Record<string, unknown> = {}) => ({
  id: 'dd-ord-1', store: { merchant_supplied_id: 'dd-1' }, consumer: { first_name: 'Lea', last_name: 'M' }, subtotal: 3000, tax: 450, fulfillment_type: 'pickup',
  categories: [{ items: [
    { merchant_supplied_id: 'i1', name: 'Poutine', price: 1000, quantity: 2, line_item_id: 'li-1', extras: [{ options: [{ merchant_supplied_id: 'o1', name: 'Bacon', price: 100, quantity: 2, line_option_id: 'lo-1' }] }] },
    { merchant_supplied_id: 'i2', name: 'Pop', price: 1000, quantity: 1, line_item_id: 'li-2' },
  ] }], ...over,
});
async function storedOrder(over: Record<string, unknown> = {}, status = 'accepted'): Promise<StoredOrder> {
  const repo = getRepo();
  await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-1', brandName: 'Po Poulet', locationCode: 'L1', autoAccept: true, online: true, meta: {} });
  const n = parseDoorDashOrder({ order: order(over) })!;
  const { order: o } = await repo.insertOrderIfNew({ ...n, brandName: 'Po Poulet', locationCode: 'L1' });
  return (await repo.updateOrder(o.id, { status: status as never }))!;
}

describe('order adjustment (PATCH /api/v1/orders/{id}/adjustment)', () => {
  it('turns "missing" picks into ITEM_REMOVE / ITEM_UPDATE with DoorDash line ids', async () => {
    const o = await storedOrder();
    expect(adjustmentFromMissing(o, [{ line: 1, quantity: 1 }, { line: 0, quantity: 1 }])).toEqual({ items: [
      { line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }, { line_item_id: 'li-1', adjustment_type: 'ITEM_UPDATE', quantity: 1 },
    ] });
    expect(adjustmentFromMissing(o, [{ line: 0, quantity: 3 }]).error).toMatch(/quantity/);
    expect(adjustmentFromMissing(o, [{ line: 0, quantity: 2 }, { line: 1, quantity: 1 }]).error).toMatch(/cancel the order/i);
    expect(adjustmentFromMissing({ lines: [{ name: 'Old', quantity: 1, unitPrice: 1, total: 1, modifiers: [] }] }, [{ line: 0, quantity: 1 }]).error).toMatch(/no DoorDash line id/);
  });

  it('builds a substitution and an option change', async () => {
    const o = await storedOrder();
    expect(substitutionFor(o, 1, { name: 'Diet Coke', merchantSuppliedId: '179', price: 1.79 }).item).toEqual({ line_item_id: 'li-2', adjustment_type: 'ITEM_SUBSTITUTE', substituted_item: { name: 'Diet Coke', merchant_supplied_id: '179', price: 179, quantity: 1 } });
    expect(substitutionFor(o, 1, { name: '', merchantSuppliedId: '', price: 1 }).error).toBeDefined();
    expect(optionAdjustment(o, 0, 0, 1).item).toEqual({ line_item_id: 'li-1', adjustment_type: 'ITEM_UPDATE', options: [{ line_option_id: 'lo-1', adjustment_type: 'ITEM_UPDATE', quantity: 1 }] });
    expect(optionAdjustment(o, 0, 0, 0).item?.options?.[0]).toEqual({ line_option_id: 'lo-1', adjustment_type: 'ITEM_REMOVE' });
    expect(optionAdjustment(o, 0, 0, 5).error).toBeDefined();
  });

  it('is blocked until DoorDash allowlisted it (DOORDASH_ORDER_ADJUSTMENT), then sends the documented body', async () => {
    const o = await storedOrder();
    mockFetch(() => ({ status: 202, body: {} }));
    const blocked = await adjustDoorDashOrder(o, [{ line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }]);
    expect(blocked).toMatchObject({ ok: false, status: 'blocked' });
    expect(blocked.message).toMatch(/technical account manager/);
    expect(calls).toHaveLength(0);
    process.env.DOORDASH_ORDER_ADJUSTMENT = 'true';
    const sent = await adjustDoorDashOrder(o, [{ line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }]);
    expect(sent.ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'https://openapi.doordash.com/marketplace/api/v1/orders/dd-ord-1/adjustment', body: { items: [{ line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }] } });
  });

  it('a 403 means "not on the allowlist yet", said plainly', async () => {
    process.env.DOORDASH_ORDER_ADJUSTMENT = 'true';
    mockFetch(() => ({ status: 403, body: { message: 'forbidden' } }));
    const r = await adjustDoorDashOrder({ externalOrderId: 'x', channelStoreId: 'dd-1' }, [{ line_item_id: 'a', adjustment_type: 'ITEM_REMOVE' }]);
    expect(r).toMatchObject({ ok: false, status: 'blocked' });
    expect(r.message).toMatch(/allowlist/);
  });

  it('the kitchen "Missing item" action on a DoorDash order goes through it and notes the missing item', async () => {
    process.env.DOORDASH_ORDER_ADJUSTMENT = 'true';
    const o = await storedOrder();
    mockFetch(() => ({ status: 202, body: {} }));
    const out = await runOrderAction(o.id, 'report_missing', { missing: [{ line: 1, quantity: 1 }] });
    expect(out.result.ok).toBe(true);
    expect(calls[0].body).toEqual({ items: [{ line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }] });
    expect((await getRepo().getOrder(o.id))!.timeline?.missingItems?.[0]).toMatchObject({ name: 'Pop', quantity: 1 });
    // without the allowlist the action is not even offered
    delete process.env.DOORDASH_ORDER_ADJUSTMENT;
    const again = await runOrderAction(o.id, 'report_missing', { missing: [{ line: 0, quantity: 1 }] });
    expect(again.result.ok).toBe(false);
  });

  it('order events: only order_ready_for_pickup exists', async () => {
    const o = await storedOrder();
    mockFetch(() => ({ status: 202, body: {} }));
    expect((await sendOrderEvent(o)).ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/\/orders\/dd-ord-1\/events\/order_ready_for_pickup$/), body: { merchant_supplied_id: o.id } });
    expect(await sendOrderEvent(o, 'something_else' as never)).toMatchObject({ ok: false, status: 'blocked' });
  });
});

describe('retail order return (POST /api/v1/orders/{id}/return)', () => {
  const ord = { externalOrderId: 'dd-ord-1', channelStoreId: 'dd-1', lines: [{ externalId: 'sku-1', name: 'Milk', quantity: 2, unitPrice: 4, total: 8, modifiers: [] }] };
  it('is allowlisted, validated, and sent once with the documented body', async () => {
    mockFetch(() => ({ status: 202, body: { operation_id: 'op', operation_status: 'QUEUED' } }));
    expect(await returnDoorDashOrder(ord, [{ merchant_supplied_id: 'sku-1', quantity: 1 }], 'dd-1')).toMatchObject({ ok: false, status: 'blocked' });
    process.env.DOORDASH_ORDER_RETURNS = 'true';
    expect((await returnDoorDashOrder(ord, [{ merchant_supplied_id: 'sku-1', quantity: 3 }], 'dd-1')).message).toMatch(/More returned than ordered/);
    expect((await returnDoorDashOrder(ord, [{ merchant_supplied_id: 'sku-1', quantity: 1, reason: 'nope' as never }], 'dd-1')).message).toMatch(/not one DoorDash knows/);
    expect(calls).toHaveLength(0);
    const ok = await returnDoorDashOrder(ord, [{ merchant_supplied_id: 'sku-1', quantity: 1, reason: 'missing_item' }], 'dd-1');
    expect(ok.ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/orders\/dd-ord-1\/return$/), body: { return_items: [{ merchant_supplied_id: 'sku-1', quantity: 1, reason: 'missing_item' }], return_location_id: 'dd-1' } });
  });
  it('409 = already returned', async () => {
    process.env.DOORDASH_ORDER_RETURNS = 'true';
    mockFetch(() => ({ status: 409, body: { message: 'duplicate' } }));
    expect((await returnDoorDashOrder(ord, [{ merchant_supplied_id: 'sku-1', quantity: 1 }], 'dd-1')).message).toMatch(/already has a return/);
  });
});

describe('Po Poulet NDG (27982486): no order call, return or report goes anywhere near it', () => {
  it('adjustment, ready event and return refuse it without sending', async () => {
    process.env.DOORDASH_ORDER_ADJUSTMENT = 'true'; process.env.DOORDASH_ORDER_RETURNS = 'true';
    mockFetch(() => ({ status: 202, body: {} }));
    const po = { externalOrderId: 'po-1', channelStoreId: PO_POULET, id: 'x', lines: [] };
    expect(await adjustDoorDashOrder(po, [{ line_item_id: 'a', adjustment_type: 'ITEM_REMOVE' }])).toMatchObject({ ok: false, message: expect.stringMatching(/protected/) });
    expect(await sendOrderEvent(po)).toMatchObject({ ok: false, message: expect.stringMatching(/protected/) });
    expect(await returnDoorDashOrder({ ...po, lines: [{ externalId: 'a', name: 'A', quantity: 1, unitPrice: 1, total: 1, modifiers: [] }] }, [{ merchant_supplied_id: 'a', quantity: 1 }], 'dd-1')).toMatchObject({ ok: false, message: expect.stringMatching(/protected/) });
    expect(await returnDoorDashOrder({ ...po, channelStoreId: 'dd-1', lines: [] }, [{ merchant_supplied_id: 'a', quantity: 1 }], PO_POULET)).toMatchObject({ ok: false, message: expect.stringMatching(/protected/) });
    expect(calls).toHaveLength(0);
  });
});

describe('webhook classification (every DoorDash webhook type)', () => {
  it('Dasher Status in its documented nested shape (everything under `delivery`)', () => {
    const body = { event: { type: 'dasher_status_update', status: 'SUCCESS', reference: 'r' }, created_at: '2026-10-09T01:00:00Z', delivery: { external_order_id: 'dd-ord-1', client_order_id: 'cl-1', location_id: 'dd-1', dasher_status: 'arrived_at_store', dasher: { first_name: 'Jude', last_name: 'D.', phone_number: '(586) 381-6148', vehicle: { color: 'red', make: 'Dodge', model: 'Dakota' } } } };
    expect(flattenDelivery(body).dasher_status).toBe('arrived_at_store');
    expect(classifyDoorDash(body)).toMatchObject({ kind: 'dasher', courierStatus: 'at_store', reference: 'dd-ord-1' });
    // the older flat form still works
    expect(classifyDoorDash({ event: { type: 'dasher_status_update' }, dasher_status: 'dropoff', external_order_id: 'x' })).toMatchObject({ kind: 'dasher', courierStatus: 'delivered' });
  });

  it('Order Release, Order Adjustment, Store Temporarily Deactivated, Onboarding, Report Ready, Cart Validation, Cancel, Order', () => {
    expect(classifyDoorDash({ dasher: { first_name: 'A' }, distance_from_store: 460.2, store: { merchant_supplied_id: 'dd-1' }, external_order_id: 'u', client_order_id: '321' }).kind).toBe('release');
    expect(classifyDoorDash({ event: { type: 'OrderAdjustment' }, order: order(), order_adjustment_metadata: {} }).kind).toBe('adjustment');
    expect(classifyDoorDash({ store: { merchant_supplied_id: 'dd-1' }, event: { type: 'Store Temporarily Deactivated' }, reason_id: 22, reason: 'Incorrect Store Hours' }).kind).toBe('store_deactivated');
    expect(classifyDoorDash({ onboarding_id: 'o', location_id: 'dd-1', status: 'MENU_QUALIFIED' }).kind).toBe('onboarding');
    expect(classifyDoorDash({ report_id: 'r', status: 'SUCCEEDED' }).kind).toBe('report_ready');
    expect(classifyDoorDash({ cart_id: 'c', store: { merchant_supplied_id: 'dd-1' }, categories: [] }).kind).toBe('cart_validation');
    expect(isCartValidation({ cart_id: 'c', categories: [] })).toBe(true);
    expect(isCartValidation({ order: order() })).toBe(false);
    expect(classifyDoorDash({ external_order_id: 'u', client_order_id: 'c', store: {}, is_asap: true }).kind).toBe('cancel');
    expect(classifyDoorDash({ event: { type: 'OrderCreate', status: 'NEW' }, order: order() })).toMatchObject({ kind: 'order', httpStatus: 202 });
    expect(classifyDoorDash({ event: { type: 'MenuCreate', status: 'SUCCESS', reference: 'takatak-dd-1-1' }, menu: { id: 'm' } }).kind).toBe('menu_status');
  });
});

describe('webhook handlers', () => {
  it('Dasher Status nested payload reaches the order: courier, picked up…', async () => {
    const o = await storedOrder();
    await handleDoorDashWebhook({ event: { type: 'dasher_status_update' }, delivery: { external_order_id: 'dd-ord-1', location_id: 'dd-1', dasher_status: 'arrived_at_store', dasher: { first_name: 'Jude', last_name: 'D.', phone_number: '555', vehicle: { color: 'red', make: 'Dodge', model: 'Dakota' } } } });
    const after = (await getRepo().getOrder(o.id))!;
    expect(after.timeline?.courier).toMatchObject({ status: 'at_store', name: 'Jude D.', vehicle: 'red Dodge Dakota' });
  });

  it('Order Release marks the order released, shows the Dasher and tells the kitchen to start', async () => {
    const o = await storedOrder();
    const out = await handleDoorDashWebhook({ dasher: { first_name: 'Sam', latitude: 45.5, longitude: -73.6, phone_number: '555', vehicle: { color: 'blue', make: 'Honda', model: 'Fit' } }, distance_from_store: 460.2, store: { merchant_supplied_id: 'dd-1', provider_type: 'p' }, external_order_id: 'dd-ord-1', client_order_id: o.id });
    expect(out.result).toBe('order released');
    const after = (await getRepo().getOrder(o.id))!;
    expect(after.timeline?.releasedAt).toBeDefined();
    expect(after.timeline?.courier).toMatchObject({ status: 'arriving', name: 'Sam', vehicle: 'blue Honda Fit' });
    const ev = (await getRepo().listEvents(o.id)).find((e) => e.type === 'released');
    expect(String(ev?.detail.message)).toMatch(/start preparing now/);
  });

  it('Order Release for an unknown order is kept, not lost', async () => {
    const out = await handleDoorDashWebhook({ dasher: {}, distance_from_store: 10, external_order_id: 'nope', store: {} });
    expect(out.result).toBe('kept: unknown order');
  });

  it('Order Adjustment updates the lines, quantities and totals, and records what changed', async () => {
    const o = await storedOrder();
    const updated = order({ subtotal: 1000, tax: 150, categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'Poutine', price: 1000, quantity: 1, line_item_id: 'li-1', extras: [{ options: [{ merchant_supplied_id: 'o1', name: 'Bacon', price: 100, quantity: 1, line_option_id: 'lo-1' }] }] }] }] });
    const out = await handleDoorDashWebhook({ event: { type: 'OrderAdjustment', event_timestamp: '2026-10-09T01:00:00Z' }, order: updated, order_adjustment_metadata: { adjustment_source: 'MERCHANT', adjustment_timestamp: '2026-10-09T01:00:00Z', adjusted_order_items: [{ line_item_id: 'li-2', adjustment_type: 'ITEM_REMOVE' }, { line_item_id: 'li-1', adjustment_type: 'ITEM_UPDATE', quantity: 1 }] } });
    expect(out.result).toBe('order adjusted');
    const after = (await getRepo().getOrder(o.id))!;
    expect(after.lines.map((l) => [l.name, l.quantity])).toEqual([['Poutine', 1]]);
    expect(after.lines[0].modifiers[0].quantity).toBe(1);
    expect(after.subtotal).toBe(10);
    expect(after.tax).toBe(1.5);
    expect(after.total).toBe(11.5);
    expect(after.timeline?.adjustments?.[0]).toMatchObject({ source: 'MERCHANT' });
  });

  it('adjustedLines keeps Clover mapping, drops removed lines and appends a substitute', () => {
    const stored = [
      { name: 'A', quantity: 2, unitPrice: 5, total: 10, lineItemId: 'a', posItemRef: 'clover-a', modifiers: [] },
      { name: 'B', quantity: 1, unitPrice: 3, total: 3, lineItemId: 'b', modifiers: [] },
    ];
    const updated = [
      { name: 'A', quantity: 1, unitPrice: 5, total: 5, lineItemId: 'a', modifiers: [] },
      { name: 'Diet Coke', quantity: 1, unitPrice: 1.79, total: 1.79, lineItemId: 'c', modifiers: [] },
    ];
    const out = adjustedLines(stored, updated);
    expect(out.map((l) => [l.name, l.quantity])).toEqual([['A', 1], ['Diet Coke', 1]]);
    expect(out[0].posItemRef).toBe('clover-a');
  });

  it('Store Temporarily Deactivated shows on the store row, with the reason and the end time', async () => {
    await storedOrder();
    const store = (await getRepo().findStore('doordash', 'dd-1'))!;
    const out = await handleDoorDashWebhook({ store: { doordash_store_id: 1, merchant_supplied_id: 'dd-1' }, event: { type: 'Store Temporarily Deactivated' }, reason_id: 22, reason: 'Incorrect Store Hours', notes: 'Notes here', start_time: '2026-10-09T22:30:19Z', end_time: '2026-10-10T03:30:19Z' });
    expect(out.result).toBe('store paused');
    const after = (await getRepo().getStore(store.id))!;
    expect(after.online).toBe(false);
    expect(after.pausedUntil).toBe('2026-10-10T03:30:19Z');
    expect((after.meta.platformStatus as any).detail).toMatch(/Incorrect Store Hours/);
  });

  it('a Store Temporarily Deactivated notice for the protected store is ignored, never written', async () => {
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: PO_POULET, brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    const out = await handleDoorDashWebhook({ store: { merchant_supplied_id: PO_POULET }, event: { type: 'Store Temporarily Deactivated' }, reason: 'x' });
    expect(out.result).toMatch(/protected/);
    expect((await getRepo().findStore('doordash', PO_POULET))!.online).toBe(true);
  });

  it('Onboarding status is kept on the store, with the exclusion code', async () => {
    await storedOrder();
    const out = await handleDoorDashWebhook({ onboarding_id: 'ob-1', location_id: 'dd-1', doordash_store_uuid: 'uuid', status: 'ABANDONED', exclusion_code: 'VIRTUAL_BRAND_DETECTED', details: 'Virtual brand', menus: [{ menu_uuid: 'm', menu_preview_link: 'https://x', menu_error: null }] });
    expect(out.result).toBe('onboarding ABANDONED');
    expect((await getRepo().findStore('doordash', 'dd-1'))!.meta.doordashOnboarding).toMatchObject({ status: 'ABANDONED', exclusionCode: 'VIRTUAL_BRAND_DETECTED', onboardingId: 'ob-1' });
  });
});

describe('Order Cart Validation', () => {
  const menu: MasterMenu = {
    brandName: 'Po Poulet', categories: [{ ref: 'c1', name: 'Poulet', sortOrder: 0 }],
    items: [{ ref: 'i1', name: 'Poutine', price: 10, categoryRef: 'c1', available: true, modifierGroupRefs: [] }, { ref: 'i2', name: 'Pop', price: 2, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
    modifierGroups: [], updatedAt: new Date().toISOString(), unavailableByLocation: { L1: ['i2'] },
  };
  const cart = (msid = 'dd-1') => ({ cart_id: 'cart-1', store: { merchant_supplied_id: msid, provider_type: 'p' }, fulfillment: { type: 'pickup', asap: true }, subtotal: 12, tax: 1.8, categories: [{ name: 'c', merchant_supplied_id: 'c1', items: [{ name: 'Poutine', merchant_supplied_id: 'i1', quantity: 1, line_item_id: 'a' }, { name: 'Pop', merchant_supplied_id: 'i2', quantity: 1, line_item_id: 'b' }] }], experience: 'DOORDASH' });

  it('a valid cart: valid true, the same cart_id, an expiry and the earliest pickup time', async () => {
    await getRepo().saveMenu({ ...menu, unavailableByLocation: {} });
    await storedOrder();
    const out = await validateDoorDashCart(cart());
    expect('answer' in out && out.answer).toMatchObject({ valid: true, cart_id: 'cart-1' });
    expect('answer' in out && out.answer.earliest_pickup_time).toBeDefined();
    expect('answer' in out && out.answer.errors).toBeUndefined();
  });

  it('an 86\'d item is an item-level ITEM_OUT_OF_STOCK error naming the item', async () => {
    await getRepo().saveMenu(menu);
    await storedOrder();
    const out = await validateDoorDashCart(cart());
    expect('answer' in out && out.answer).toMatchObject({ valid: false, cart_id: 'cart-1', errors: [{ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i2' }] });
  });

  it('a paused store, and a time outside the store hours, are reported with DoorDash codes', async () => {
    await getRepo().saveMenu({ ...menu, unavailableByLocation: {} });
    await storedOrder();
    const store = (await getRepo().findStore('doordash', 'dd-1'))!;
    await getRepo().updateStore(store.id, { online: false, pausedUntil: new Date(Date.now() + 3600_000).toISOString() });
    const paused = await validateDoorDashCart(cart());
    expect('answer' in paused && paused.answer.errors?.[0].code).toBe('STORE_TEMP_CLOSED');
    await getRepo().updateStore(store.id, { online: true, pausedUntil: null });
    await saveHours({ locations: { L1: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [{ open: '10:00', close: '11:00' }] } as never }, brands: {}, holidays: [] });
    const now = Date.parse('2026-10-07T15:00:00Z'); // a Wednesday: closed all day
    const closed = await validateDoorDashCart(cart(), now);
    expect('answer' in closed && closed.answer.errors?.[0].code).toBe('STORE_HOURS_ISSUE');
  });

  it('unknown store → 404 (DoorDash skips the check); the protected store → 409, never answered', async () => {
    expect(await validateDoorDashCart(cart('nobody'))).toEqual({ refused: expect.stringMatching(/Unknown location_id/), status: 404 });
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: PO_POULET, brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    expect(await validateDoorDashCart(cart(PO_POULET))).toEqual({ refused: expect.stringMatching(/protected/), status: 409 });
  });
});

describe('Reporting API', () => {
  it('reportBody validates the type, the dates and the protected stores', () => {
    expect(reportBody({ reportType: 'ORDER_DETAIL', from: '2026-10-01', to: '2026-10-07', storeIds: [111] }).body).toEqual({ report_type: 'ORDER_DETAIL', start_date: '2026-10-01', end_date: '2026-10-07', report_version: 1, store_ids: [111] });
    expect(reportBody({ reportType: 'NOPE', from: '2026-10-01', to: '2026-10-07' }).error).toMatch(/Unknown report type/);
    expect(reportBody({ reportType: 'ORDER_DETAIL', from: '2026-10-08', to: '2026-10-07' }).error).toMatch(/date range/);
    expect(reportBody({ reportType: 'ORDER_DETAIL', from: '2026-10-01', to: '2026-10-07', storeIds: [111, 27982486] }).error).toMatch(/protected/);
    expect(reportBody({ reportType: 'ORDER_DETAIL', from: '2026-10-01', to: '2026-10-07', webhookUrl: 'http://x' }).error).toMatch(/https/);
  });

  it('requests a report for the mapped, unprotected stores only, and keeps the request', async () => {
    const repo = getRepo();
    await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-a', brandName: 'A', locationCode: 'L1', autoAccept: true, online: true, meta: { platformStoreId: '111' } });
    await repo.upsertStore({ channel: 'doordash', channelStoreId: 'NDG-PO', brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: { platformStoreId: PO_POULET } });
    mockFetch(() => ({ status: 202, body: { report_id: 'f2a99881-5505-448a-a341-5bfc53b7c754' } }));
    const r = await requestDoorDashReport({ reportType: 'TRANSACTION_DETAIL', from: '2026-10-01', to: '2026-10-07' }, { username: 'o', name: 'Owner', source: 'dashboard' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://openapi.doordash.com/dataexchange/v1/reports', body: { report_type: 'TRANSACTION_DETAIL', store_ids: [111], report_version: 1 } });
    expect(calls[0].body.store_ids).not.toContain(27982486);
    expect(r).toMatchObject({ id: 'f2a99881-5505-448a-a341-5bfc53b7c754', status: 'requested' });
    expect((await listDoorDashReports())[0].id).toBe('f2a99881-5505-448a-a341-5bfc53b7c754');
  });

  it('refuses a request without credentials, and one for the protected store', async () => {
    for (const k of ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET']) delete process.env[k];
    mockFetch(() => ({ status: 202, body: {} }));
    expect(await requestDoorDashReport({ reportType: 'ORDER_DETAIL', from: '2026-10-01', to: '2026-10-07', storeIds: [1] }, { username: 'o', name: 'O', source: 'dashboard' })).toMatchObject({ ok: false, status: 'blocked' });
    process.env.DOORDASH_REPORTS_DEVELOPER_ID = 'd'; process.env.DOORDASH_REPORTS_KEY_ID = 'k'; process.env.DOORDASH_REPORTS_SIGNING_SECRET = 'c2VjcmV0';
    expect(await requestDoorDashReport({ reportType: 'ORDER_DETAIL', from: '2026-10-01', to: '2026-10-07', storeIds: [27982486] }, { username: 'o', name: 'O', source: 'dashboard' })).toMatchObject({ ok: false, message: expect.stringMatching(/protected/) });
    expect(calls).toHaveLength(0);
  });

  it('reads the report link whatever the field names, and only follows DoorDash / AWS https links', () => {
    expect(readReportLink({ status: 'PENDING' })).toEqual({ status: 'PENDING' });
    expect(readReportLink({ report_status: 'SUCCEEDED', report_link: 'https://x.doordash.com/f.zip' })).toEqual({ status: 'SUCCEEDED', link: 'https://x.doordash.com/f.zip' });
    expect(readReportLink({ status: 'FAILED' }).status).toBe('FAILED');
    expect(allowedDoorDashReportUrl('https://reports.doordash.com/a.zip')).toBe(true);
    expect(allowedDoorDashReportUrl('https://bucket.s3.amazonaws.com/a.zip')).toBe(true);
    expect(allowedDoorDashReportUrl('http://reports.doordash.com/a.zip')).toBe(false);
    expect(allowedDoorDashReportUrl('https://evil.example.com/a.zip')).toBe(false);
  });

  it('drops the protected store’s rows from a report file', () => {
    const csv = 'Store ID,Order ID,Net total\n111,a,10\n27982486,b,99\n222,c,5\n';
    const out = withoutProtectedRows(csv);
    expect(out).toMatchObject({ rows: 2, dropped: 1 });
    expect(out.text).not.toContain('27982486');
    expect(withoutProtectedRows('Order ID,Net\na,1\n')).toMatchObject({ rows: 1, dropped: 0 });
  });

  it('finds the CSV inside the ZIP DoorDash serves', () => {
    const zip = zipSync({ 'report.csv': strToU8('a,b\n1,2\n') });
    expect(csvFromReportFile(zip)).toEqual({ name: 'report.csv', text: 'a,b\n1,2\n' });
    expect(csvFromReportFile(strToU8('a,b\n1,2\n'))?.text).toContain('1,2');
    expect(csvFromReportFile(zipSync({ 'readme.txt': strToU8('x') }))).toBeNull();
  });

  it('refresh: pending stays pending; ready → downloaded, protected rows removed, kept, payout statements imported', async () => {
    process.env.DOORDASH_REPORT_ALLOWED_HOSTS = 'files.test';
    const repo = getRepo();
    await repo.putDocs('doordash_report_requests', [{ id: 'rep-1', at: new Date().toISOString(), data: { id: 'rep-1', reportType: 'CANCELLED_ORDERS', from: '2026-10-01', to: '2026-10-07', storeIds: [], status: 'requested', message: '', requestedBy: 'o', at: new Date().toISOString() } }]);
    let ready = false;
    const zip = zipSync({ 'cancelled.csv': strToU8('Store ID,Order ID\n111,a\n27982486,b\n') });
    mockFetch((c) => {
      if (c.url.includes('/reportlink')) return ready ? { status: 200, body: { status: 'SUCCEEDED', link: 'https://files.test/r.zip' } } : { status: 200, body: { status: 'PENDING' } };
      return { status: 200, raw: zip };
    });
    const actor = { username: 'o', name: 'Owner', source: 'dashboard' as const };
    expect((await refreshDoorDashReport('rep-1', actor))!.status).toBe('requested');
    ready = true;
    const done = (await refreshDoorDashReport('rep-1', actor))!;
    expect(done).toMatchObject({ status: 'ready', rows: 1, droppedRows: 1 });
    const file = await repo.getDoc<{ csv: string }>('doordash_report_files', 'rep-1');
    expect(file!.data.csv).toContain('111');
    expect(file!.data.csv).not.toContain('27982486');
    expect((await getDoorDashReportLink('rep-1')).link?.status).toBe('SUCCEEDED');
  });
});
