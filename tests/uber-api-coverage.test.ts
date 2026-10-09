// Uber API full coverage (task 22): every endpoint added from developer.uber.com/docs/eats/references/api/*_suite and
// developer.uber.com/docs/deliveries/api-reference/daas, with mocked HTTP. Table: docs/UBER_API_COVERAGE.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustUberOrderPrice, createUberPromotion, fetchUberHolidayDates, fetchUberMenuSummary, fetchUberStoreInfo, listUberCanceledOrders, listUberOrders,
  listUberPromotions, matchCartItem, pushPrepTimeToUber, reportUberOutOfItems, revokeUberPromotion, setUberIntegrationEnabled, setUberPickupInstructions,
  setUberStorePrepTime, uberAdjustPriceBody, uberFlatOffPromotion,
} from '../lib/foodhub/adapters/uber-api';
import { forgetUberTokenMemory, invalidateUberToken, requestUberReport, uberEatsAdapter, uberReportRangeError } from '../lib/foodhub/adapters/uber-eats';
import { handleUberEvent, recoverMissedUberCancellations } from '../lib/foodhub/adapters/uber-events';
import { listUberDirectDeliveries, resetUberDirectToken, uberDirect, uberDirectProofOfDelivery, uberDirectRefund, updateUberDirectDelivery } from '../lib/foodhub/delivery/uber-direct';
import { allowedActions, runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, StoredOrder } from '../lib/foodhub/types';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; auth: string | null };
const calls: Call[] = [];
type Route = (c: Call) => { status: number; body?: unknown } | null;
function mockFetch(route: Route) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = init.headers as Record<string, string> | undefined;
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, auth: h?.Authorization ?? null };
    calls.push(c);
    const tok = c.url.endsWith('/oauth/v2/token') ? { status: 200, body: { access_token: 'app-token', expires_in: 2592000 } } : null;
    const r = tok ?? route(c) ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const api = () => calls.filter((c) => !c.url.endsWith('/oauth/v2/token'));
const API = 'https://api.uber.com';
const store = (over: Partial<ChannelStore> = {}): Omit<ChannelStore, 'id'> => ({ channel: 'uber_eats', channelStoreId: 'uber-ndg', brandName: 'Pi Pita', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: { uberPos: { orderManager: 'foodhub' } }, ...over });

async function uberOrder(status: StoredOrder['status'] = 'accepted', over: Record<string, unknown> = {}) {
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'o-1', displayId: 'A1B2', channelStoreId: 'uber-ndg', fulfillment: 'delivery', placedAt: new Date().toISOString(),
    currency: 'CAD', subtotal: 20, tax: 3, deliveryFee: 0, tip: 0, discount: 0, total: 23, raw: {},
    lines: [{ externalId: 'item-falafel', name: 'Falafel wrap', quantity: 2, unitPrice: 8, total: 16 }, { externalId: 'item-fries', name: 'Fries', quantity: 1, unitPrice: 4, total: 4 }],
    ...over,
  } as any);
  return (await repo.updateOrder(order.id, { status, locationCode: 'NDG_MAIN' }))!;
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.UBER_CLIENT_ID = 'uber-id';
  process.env.UBER_CLIENT_SECRET = 'secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  for (const k of ['UBER_ACCESS_TOKEN', 'UBER_BASE_URL', 'UBER_AUTH_URL', 'UBER_ENV', 'UBER_OAUTH_SCOPE', 'UBER_MARK_READY', 'UBER_PREP_TIME_SYNC', 'FOODHUB_MENU_LOCKED_STORES']) delete process.env[k];
  forgetUberTokenMemory();
  await invalidateUberToken('orders'); await invalidateUberToken('poll'); await invalidateUberToken('report');
});
afterEach(() => vi.unstubAllGlobals());

describe('Order Fulfillment suite: ready, ready time, out of stock, price change', () => {
  it('"Ready" tells Uber (POST /v1/delivery/order/{id}/ready); a refusal never blocks the kitchen', async () => {
    const o = await uberOrder();
    mockFetch(() => ({ status: 200, body: {} }));
    const r = await uberEatsAdapter.markReady(o);
    expect(r.ok).toBe(true);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/delivery/order/o-1/ready`, body: {} });
    mockFetch(() => ({ status: 404, body: { message: 'not found' } }));
    const refused = await uberEatsAdapter.markReady(o);
    expect(refused).toMatchObject({ ok: true, status: 'skipped' });
    expect(refused.message).toMatch(/did not take the ready signal/);
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'false';
    mockFetch(() => null);
    expect((await uberEatsAdapter.markReady(o)).status).toBe('skipped');
    expect(api()).toHaveLength(0);
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    process.env.UBER_MARK_READY = 'off';
    await uberEatsAdapter.markReady(o);
    expect(api()).toHaveLength(0);
  });

  it('"+5 min" sends the new ready time to Uber (update-ready-time, RFC 3339); a refusal keeps the kitchen timer', async () => {
    const o = await uberOrder();
    mockFetch(() => ({ status: 200, body: {} }));
    const r = await runOrderAction(o.id, 'delay', { delayMinutes: 5 });
    expect(r.result.ok).toBe(true);
    expect(r.result.message).toMatch(/Uber Eats has the new ready time/);
    const call = api().find((c) => c.url.endsWith('/update-ready-time'))!;
    expect(call.url).toBe(`${API}/v1/delivery/order/o-1/update-ready-time`);
    expect(call.body.ready_for_pickup_time).toBe(r.order!.timeline!.readyTarget);
    mockFetch(() => ({ status: 400, body: { message: 'order already ready' } }));
    const again = await runOrderAction(o.id, 'delay', { delayMinutes: 5 });
    expect(again.result.ok).toBe(true);
    expect(again.order!.timeline!.delayedMinutes).toBe(10);
  });

  it('Uber orders (accepted) offer "Missing item" and "Price change"; relay orders do not', async () => {
    const o = await uberOrder();
    expect(allowedActions(o)).toEqual(expect.arrayContaining(['report_missing', 'adjust_price']));
    expect(allowedActions({ ...o, viaHub: 'relay' } as StoredOrder)).not.toContain('adjust_price');
    expect(allowedActions({ ...o, status: 'new' })).not.toContain('report_missing');
  });

  it('out of stock → Resolve Fulfillment Issues (OUT_OF_ITEM + ASK_CUSTOMER) on the cart_item_id read from GetOrder', async () => {
    const o = await uberOrder();
    mockFetch((c) => c.url.includes('/v1/delivery/order/o-1?expand=carts')
      ? { status: 200, body: { order: { id: 'o-1', carts: [{ items: [{ cart_item_id: 'ci-1', title: 'Falafel wrap', external_data: 'item-falafel', quantity: { amount: 2 } }, { cart_item_id: 'ci-2', title: 'Frites / Fries', quantity: { amount: 1 } }] }] } } }
      : c.url.endsWith('/resolve-fulfillment-issues') ? { status: 200, body: { should_wait_for_customer_response: true } } : null);
    const r = await runOrderAction(o.id, 'report_missing', { missing: [{ line: 0, quantity: 1 }] });
    expect(r.result.ok).toBe(true);
    expect(r.result.message).toMatch(/Uber is asking the customer/);
    const post = api().find((c) => c.url.endsWith('/resolve-fulfillment-issues'))!;
    expect(post.url).toBe(`${API}/v1/delivery/order/o-1/resolve-fulfillment-issues`);
    expect(post.body.fulfillment_issues).toEqual([{ issue_type: 'OUT_OF_ITEM', action_type: 'ASK_CUSTOMER', item: { cart_item_id: 'ci-1' }, store_response: 'The store ran out of this item.' }]);
    expect(r.order!.timeline!.missingItems![0]).toMatchObject({ name: 'Falafel wrap' });
  });

  it('out of stock: a line Uber does not have is said, nothing is sent; blocked without the live switch', async () => {
    const o = await uberOrder();
    mockFetch((c) => c.url.includes('expand=carts') ? { status: 200, body: { order: { carts: [{ items: [{ cart_item_id: 'ci-9', title: 'Something else' }] }] } } } : null);
    const r = await reportUberOutOfItems(o, [{ externalId: 'item-fries', name: 'Fries' }]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no line matching Fries/);
    expect(api().some((c) => c.url.endsWith('/resolve-fulfillment-issues'))).toBe(false);
    expect(matchCartItem({ name: 'Frites / Fries' }, [{ cartItemId: 'x', title: 'frites fries' }])).toBe('x');
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'false';
    mockFetch(() => null);
    expect((await reportUberOutOfItems(o, [{ name: 'Fries' }])).status).toBe('blocked');
    expect(api()).toHaveLength(0);
  });

  it('price change: amount_e5, documented reasons, ≤ 50 $, custom reason with OTHER', async () => {
    expect(uberAdjustPriceBody({ amount: 2.5, reason: 'REQUESTED_ADD_ONS' }).body).toEqual({ amount_e5: 250000, reason: 'REQUESTED_ADD_ONS' });
    expect(uberAdjustPriceBody({ amount: -4, reason: 'ITEM_SOLD_OUT', taxRatePct: 14.975 }).body).toEqual({ amount_e5: -400000, reason: 'ITEM_SOLD_OUT', tax_rate: '14.975' });
    expect(uberAdjustPriceBody({ amount: 60, reason: 'BIGGER_SIZE' }).error).toMatch(/50/);
    expect(uberAdjustPriceBody({ amount: 1, reason: 'OTHER' }).error).toMatch(/reason/);
    expect(uberAdjustPriceBody({ amount: 1, reason: 'OTHER', customReason: 'Extra sauce' }).body).toMatchObject({ custom_reason: 'Extra sauce' });
    const o = await uberOrder();
    mockFetch(() => ({ status: 200, body: { tax_rate_applied: false } }));
    const r = await runOrderAction(o.id, 'adjust_price', { adjust: { amount: 1.5, reason: 'REQUESTED_ADD_ONS' } });
    expect(r.result.ok).toBe(true);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/delivery/order/o-1/adjust-price`, body: { amount_e5: 150000, reason: 'REQUESTED_ADD_ONS' } });
    const bad = await adjustUberOrderPrice(o, { amount: 0, reason: 'OTHER' });
    expect(bad.ok).toBe(false);
  });

  it('List Orders (GET /v1/delivery/store/{id}/orders) with filters; falls back to the eats.order token when eats.store.orders.read is not granted', async () => {
    mockFetch((c) => {
      if (c.url.endsWith('/oauth/v2/token')) return null;
      return c.url.includes('/orders?') ? { status: 200, body: { data: [{ id: 'o-1' }], pagination_data: { next_page_token: 'p2' } } } : null;
    });
    const r = await listUberOrders('uber-ndg', { states: ['ACCEPTED', 'SUCCEEDED'], startTime: '2026-10-01T00:00:00Z', pageSize: 80 });
    expect(r).toMatchObject({ ok: true, nextPageToken: 'p2' });
    const u = new URL(api()[0].url);
    expect(u.pathname).toBe('/v1/delivery/store/uber-ndg/orders');
    expect(Object.fromEntries(u.searchParams)).toEqual({ state: 'ACCEPTED,SUCCEEDED', start_time: '2026-10-01T00:00:00Z', page_size: '50' });
    // Scope refused for the poll token → same read with the orders token.
    forgetUberTokenMemory(); await invalidateUberToken('poll'); await invalidateUberToken('orders');
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: typeof init.body === 'string' ? init.body : null, auth: null });
      if (String(url).endsWith('/oauth/v2/token')) {
        const scope = new URLSearchParams(String(init.body)).get('scope');
        return scope === 'eats.store.orders.read' ? new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 }) : new Response(JSON.stringify({ access_token: 't', expires_in: 100000 }), { status: 200 });
      }
      return new Response(JSON.stringify({ orders: [{ id: 'gone-1' }, { id: 'gone-2' }] }), { status: 200 });
    }));
    expect(await listUberCanceledOrders('uber-ndg')).toEqual({ ok: true, ids: ['gone-1', 'gone-2'] });
    expect(calls.at(-1)!.url).toBe(`${API}/v1/eats/stores/uber-ndg/canceled-orders?limit=50`);
  });
});

describe('Store suite: prep time, details, pickup instructions, holiday hours, menu, integration switch', () => {
  it('Update Prep Time in seconds (max 10,800), only to stores where Food Hub takes the orders, only when live', async () => {
    mockFetch(() => ({ status: 200, body: { prep_times: { default_value: 1200 } } }));
    await setUberStorePrepTime('uber-ndg', 20);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/delivery/store/uber-ndg/update-store-prep-time`, body: { default_prep_time: 1200 } });
    await setUberStorePrepTime('uber-ndg', 500);
    expect(api()[1].body.default_prep_time).toBe(10800);
    const repo = getRepo();
    await repo.upsertStore(store());
    await repo.upsertStore(store({ channelStoreId: 'uber-up', brandName: 'OOeuf', meta: { uberPos: { orderManager: 'other' } } }));
    await repo.upsertStore(store({ channelStoreId: 'uber-jt', locationCode: 'SAINT_LEONARD' }));
    mockFetch(() => ({ status: 200, body: {} }));
    const out = await pushPrepTimeToUber('NDG_MAIN', 25);
    expect(out).toHaveLength(1);
    expect(api().map((c) => c.url)).toEqual([`${API}/v1/delivery/store/uber-ndg/update-store-prep-time`]);
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'false';
    mockFetch(() => null);
    expect(await pushPrepTimeToUber('NDG_MAIN', 25)).toEqual([]);
    expect(api()).toHaveLength(0);
  });

  it('Get Store Details is read and summed up (prep minutes, orderability, price-adjust limits)', async () => {
    mockFetch(() => ({ status: 200, body: { name: 'Pi Pita', timezone: 'America/Toronto', pickup_instructions: 'Side door', prep_times: { default_value: 540 }, orderability: { status: 'ONLINE', is_orderable: true, next_close_time: '22:00' }, fulfillment_type_availability: { DELIVERY_BY_UBER: true, PICKUP: true }, adjustment_config: { is_price_adjustment_enabled: true, maximum_price_adjustment: 5, requires_tax_rate_for_adjustment: true }, ooi_config: { is_remove_item_enabled: true, is_cancel_order_enabled: false } } }));
    const r = await fetchUberStoreInfo('uber-ndg');
    expect(api()[0].url).toBe(`${API}/v1/delivery/store/uber-ndg?expand=holiday_hours`);
    expect(r.info).toMatchObject({ prepTimeMinutes: 9, status: 'ONLINE', isOrderable: true, pickupInstructions: 'Side door', priceAdjustment: { enabled: true, maxDollars: 5, requiresTaxRate: true }, outOfItem: { removeItem: true, cancelOrder: false } });
  });

  it('pickup instructions (Update Store Information), holiday dates, menu summary, integration on/off', async () => {
    mockFetch((c) => c.url.endsWith('/holiday-hours') ? { status: 200, body: { holiday_hours: { '2026-12-25': { open_time_periods: [] }, '2026-12-24': {} } } }
      : c.url.endsWith('/menus') ? { status: 200, body: { menus: [{}], categories: [{}, {}], items: [{ id: 'a' }, { id: 'b', suspension_info: { suspension: { suspend_until: Math.floor(Date.now() / 1000) + 3600 } } }] } } : { status: 200, body: {} });
    expect((await setUberPickupInstructions('uber-ndg', '  Back door,\n ring twice ')).ok).toBe(true);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/delivery/store/uber-ndg`, body: { pickup_instructions: 'Back door, ring twice' } });
    expect((await setUberPickupInstructions('uber-ndg', ' ')).ok).toBe(false);
    expect(await fetchUberHolidayDates('uber-ndg')).toEqual({ ok: true, dates: ['2026-12-24', '2026-12-25'] });
    expect(await fetchUberMenuSummary('uber-ndg')).toEqual({ ok: true, menus: 1, categories: 2, items: 2, soldOut: ['b'] });
    await setUberIntegrationEnabled('uber-ndg', false);
    expect(api().at(-1)).toMatchObject({ method: 'PATCH', url: `${API}/v1/eats/stores/uber-ndg/pos_data`, body: { integration_enabled: false } });
  });
});

describe('Promotions suite', () => {
  it('FLATOFF body as in Uber’s example (cents), create / list / revoke paths', async () => {
    const body = uberFlatOffPromotion({ startTime: '2026-11-01T00:00:00-04:00', endTime: '2026-11-08T00:00:00-05:00', discount: 4, minSpend: 10, externalId: 'takatak-1' });
    expect(body).toEqual({ start_time: '2026-11-01T00:00:00-04:00', end_time: '2026-11-08T00:00:00-05:00', external_promotion_id: 'takatak-1', user_group: 'ALL_CUSTOMERS', allow_unlimited_apply: true, currency_code: 'CAD', budget: { unlimited_budget: true }, promo_type: 'FLATOFF', promotion_discount: { flat_off_discount: { min_basket_constraint: { min_spend: { amount: 1000 } }, discount_value: { amount: 400 } } } });
    const s = await getRepo().upsertStore(store());
    mockFetch((c) => c.url.endsWith('/promotion') ? { status: 200, body: { promotion_id: 'promo-1' } } : c.url.includes('/promotions') ? { status: 200, body: { promotions: [{ promotion_id: 'promo-1', state: 'ACTIVE' }] } } : { status: 200, body: {} });
    const r = await createUberPromotion(s, body);
    expect(r).toMatchObject({ ok: true, promotionId: 'promo-1' });
    expect(api()[0].url).toBe(`${API}/v1/delivery/stores/uber-ndg/promotion`);
    expect((await listUberPromotions('uber-ndg', 'active')).promotions).toHaveLength(1);
    expect(api()[1].url).toBe(`${API}/v1/delivery/stores/uber-ndg/promotions?state=active`);
    await revokeUberPromotion('promo-1');
    expect(api()[2]).toMatchObject({ method: 'POST', url: `${API}/v1/delivery/promotions/promo-1/revoke` });
  });

  it('never on a "Do not touch" / menu-locked store, never with the end before the start', async () => {
    mockFetch(() => null);
    const body = uberFlatOffPromotion({ startTime: '2026-11-01T00:00:00Z', endTime: '2026-11-02T00:00:00Z', discount: 3 });
    const dnt = await getRepo().upsertStore(store({ meta: { doNotTouch: true } }));
    expect((await createUberPromotion(dnt, body)).status).toBe('skipped');
    const locked = await getRepo().upsertStore(store({ channelStoreId: 'uber-locked', meta: { menuLocked: true } }));
    expect((await createUberPromotion(locked, body)).status).toBe('skipped');
    const fine = await getRepo().upsertStore(store({ channelStoreId: 'uber-ok' }));
    expect((await createUberPromotion(fine, { ...body, end_time: '2026-10-01T00:00:00Z' })).ok).toBe(false);
    expect(api()).toHaveLength(0);
  });
});

describe('Reporting suite: 9 report types and Uber’s range rules', () => {
  it('range and lookback rules are checked before anything is sent', async () => {
    expect(uberReportRangeError('PAYMENT_DETAILS_REPORT', '2026-09-01', '2026-09-30', '2026-10-09')).toBeNull();
    expect(uberReportRangeError('PAYMENT_DETAILS_REPORT', '2026-08-01', '2026-09-30', '2026-10-09')).toMatch(/30 days/);
    expect(uberReportRangeError('ORDERS_AND_ITEMS_REPORT', '2026-09-01', '2026-09-20', '2026-10-09')).toMatch(/15 days/);
    expect(uberReportRangeError('ORDER_HISTORY_REPORT', '2026-10-01', '2026-10-08', '2026-10-09')).toMatch(/188 and 2 days ago/);
    expect(uberReportRangeError('MENU_ITEM_FEEDBACK_REPORT', '2026-09-01', '2026-10-01', '2026-10-09')).toBeNull();
    expect(uberReportRangeError('DOWNTIME_REPORT', '2026-10-05', '2026-10-01', '2026-10-09')).toMatch(/after the end/);
    mockFetch(() => ({ status: 200, body: { workflow_id: 'wf-1' } }));
    const bad = await requestUberReport(['uber-ndg'], '2026-01-01', '2026-03-01');
    expect(bad.ok).toBe(false);
    expect(api()).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    const fb = await requestUberReport(['uber-ndg'], new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10), new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10), 'CUSTOMER_AND_DELIVERY_FEEDBACK_REPORT');
    expect(fb).toMatchObject({ ok: true, workflowId: 'wf-1' });
    expect(api()[0].body.report_type).toBe('CUSTOMER_AND_DELIVERY_FEEDBACK_REPORT');
    expect(today).toMatch(/^\d{4}/);
  });
});

describe('webhooks and checks', () => {
  it('orders.fulfillment_issues.resolved: the customer’s answer is flagged for the kitchen; a cancel is applied', async () => {
    const o = await uberOrder();
    mockFetch(() => ({ status: 200, body: { id: 'o-1', current_state: 'ACCEPTED', store: { id: 'uber-ndg' }, cart: { items: [{ id: 'item-fries', title: 'Fries', quantity: 1, price: { unit_price: { amount: 400 } } }] }, payment: { charges: { total: { amount: 400 } } } } }));
    const r = await handleUberEvent({ event_type: 'orders.fulfillment_issues.resolved', meta: { resource_id: 'o-1' }, resource_href: `${API}/v2/eats/order/o-1` });
    expect(r.result).toMatch(/flagged/);
    const after = await getRepo().getOrder(o.id);
    expect(after!.channelError).toMatch(/answered the out-of-stock question/);
    expect((await getRepo().listEvents(o.id)).some((e: any) => e.type === 'fulfillment_issue_resolved')).toBe(true);
    mockFetch(() => ({ status: 200, body: { id: 'o-1', current_state: 'CANCELED', store: { id: 'uber-ndg' }, cart: { items: [] }, payment: { charges: {} } } }));
    await handleUberEvent({ event_type: 'order.fulfillment_issues.resolved', meta: { resource_id: 'o-1' } });
    expect((await getRepo().getOrder(o.id))!.status).toBe('cancelled');
  });

  it('a cancellation whose webhook never came is found with canceled-orders (open orders only, managed stores only)', async () => {
    await getRepo().upsertStore(store());
    const o = await uberOrder('accepted');
    mockFetch((c) => c.url.includes('/canceled-orders') ? { status: 200, body: { orders: [{ id: 'o-1' }, { id: 'other' }] } } : null);
    expect(await recoverMissedUberCancellations()).toBe(1);
    expect((await getRepo().getOrder(o.id))!.status).toBe('cancelled');
    mockFetch(() => null);
    expect(await recoverMissedUberCancellations()).toBe(0);
    expect(api()).toHaveLength(0); // nothing open any more: no call
  });
});

describe('Uber Direct: update, list, proof of delivery, refund webhook', () => {
  beforeEach(() => {
    Object.assign(process.env, { UBER_DIRECT_CUSTOMER_ID: 'cus_1', UBER_DIRECT_CLIENT_ID: 'd-id', UBER_DIRECT_CLIENT_SECRET: 'd-secret' });
    delete process.env.UBER_DIRECT_ENV;
    resetUberDirectToken();
  });

  it('Update Delivery body, List Deliveries query, Proof of Delivery document', async () => {
    mockFetch((c) => c.url.endsWith('/proof-of-delivery') ? { status: 200, body: { document: 'iVBORw0KGgo=' } }
      : c.url.includes('/deliveries?') ? { status: 200, body: { data: [{ id: 'del_1', status: 'dropoff', fee: 899, external_id: 'dlv-1' }] } } : { status: 200, body: { id: 'del_1', status: 'pickup' } });
    const u = await updateUberDirectDelivery('del_1', { dropoffNotes: 'Buzz 3', tipByCustomer: 3.5 });
    expect(u.ok).toBe(true);
    expect(api()[0]).toMatchObject({ method: 'POST', url: `${API}/v1/customers/cus_1/deliveries/del_1`, body: { dropoff_notes: 'Buzz 3', tip_by_customer: 350 } });
    expect((await updateUberDirectDelivery('del_1', {})).ok).toBe(false);
    const l = await listUberDirectDeliveries({ filter: 'ongoing', externalStoreId: 'NDG' });
    expect(l.deliveries[0]).toEqual({ id: 'del_1', status: 'picked_up', fee: 8.99, externalId: 'dlv-1', created: undefined, trackingUrl: undefined });
    expect(api()[1].url).toBe(`${API}/v1/customers/cus_1/deliveries?filter=ongoing&external_store_id=NDG&limit=50`);
    expect(await uberDirectProofOfDelivery('del_1')).toEqual({ ok: true, document: 'iVBORw0KGgo=' });
    expect(api()[2].body).toEqual({ waypoint: 'dropoff', type: 'picture' });
  });

  it('event.refund_request: money split read, never taken for a courier status', () => {
    const body = { kind: 'event.refund_request', delivery_id: 'del_1', external_id: 'dlv-1', created: '2026-10-09T01:00:00Z', data: { id: 'rf-1', currency_code: 'cad', total_partner_refund: '680', total_uber_refund: 1200, refund_order_items: [{ reason: 'ITEM_MISSING', party_at_fault: 'UBER' }] } };
    expect(uberDirectRefund(body)).toEqual({ fleetDeliveryId: 'del_1', ref: 'dlv-1', refundId: 'rf-1', currency: 'CAD', partnerRefund: 6.8, uberRefund: 12, reasons: ['ITEM_MISSING (UBER)'], at: '2026-10-09T01:00:00Z' });
    expect(uberDirect.parseWebhook(body)).toBeNull();
    expect(uberDirectRefund({ kind: 'event.delivery_status', delivery_id: 'del_1' })).toBeNull();
  });
});
