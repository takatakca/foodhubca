import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { processIncomingOrder, resendToClover } from '../lib/foodhub/pipeline';
import { _resetOrderTypeCache, cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';

const MERCHANT = 'TESTMERCH0001';
const CLOVER = 'https://clover.example.test';
const FIRST_KITCHEN = 'TEST_KITCHEN_A';
const SECOND_KITCHEN = 'TEST_KITCHEN_B';
const NEW_STORE = 'synthetic-unmapped-uber-store';
const fetchMock = vi.fn<typeof fetch>();
const previousOrders: Array<{ id: string; title: string; total: number }> = [];

function newOrder(externalOrderId: string): NormalizedOrder {
  return {
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId, displayId: 'A1234', channelStoreId: NEW_STORE,
    fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5,
    deliveryFee: 0, tip: 0, discount: 0, total: 11.5,
    lines: [{ name: 'Synthetic item', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: {},
  };
}

async function mapStore(channelStoreId: string, locationCode: string) {
  await getRepo().upsertStore({
    channel: 'uber_eats', channelStoreId, brandName: 'Synthetic brand', locationCode,
    cloverMerchantId: MERCHANT, autoAccept: false, online: true, meta: {},
  });
}

function requested(method: string, suffix: string) {
  return fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(String(url)).pathname.endsWith(suffix));
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_POS_INJECTION', 'on');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
  vi.stubEnv('FOODHUB_CLOVER_RETRY_S', '30,120');
  vi.stubEnv('FOODHUB_RETRY_TIMER', 'off');
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
  vi.stubEnv('CLOVER_BASE_URL', CLOVER);
  vi.stubEnv('CLOVER_MERCHANT_ID', MERCHANT);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'test-clover-token');
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  vi.stubEnv('CLOVER_CLIENT_ID', undefined);
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('__foodhubCloverSending', undefined);
  _resetOrderTypeCache();
  previousOrders.length = 0;
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.origin !== CLOVER) throw new Error('Unexpected provider request');
    if (url.pathname.endsWith('/order_types')) return Response.json({ elements: [{ id: 'TEST_TYPE', label: 'Online Order Delivery' }] });
    if (url.pathname.endsWith('/atomic_order/orders')) return Response.json({ id: 'TEST_CLOVER_ORDER', total: 1150 });
    if (url.pathname.endsWith('/print_event')) return Response.json({ id: 'TEST_PRINT', state: 'CREATED' });
    if (url.pathname.endsWith('/orders')) return Response.json({ elements: previousOrders });
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('holds an unmapped marketplace order with two linked kitchens sharing one Clover merchant until a mapping is saved', async () => {
  const repo = getRepo();
  await mapStore('fixture-shop-a', FIRST_KITCHEN);
  await mapStore('fixture-shop-b', SECOND_KITCHEN);

  const received = await processIncomingOrder(newOrder('unknown-store-order'));
  expect(received.pos).toMatchObject({ ok: false, skipped: false, error: expect.stringMatching(/several mapped kitchens/i) });
  expect(received.order).toMatchObject({ status: 'new', channelStoreId: NEW_STORE });
  expect(received.order.locationCode).toBeUndefined();
  expect(received.order.posOrderId).toBeUndefined();
  expect(received.order.timeline?.posRetry).toBeUndefined();
  expect(received.accept).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
  const events = await repo.listEvents(received.order.id);
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['unmapped_store', 'needs_attention']));

  const manual = await resendToClover(received.order, { manual: true });
  expect(manual.pos).toMatchObject({ ok: false, error: expect.stringMatching(/several mapped kitchens/i) });
  expect(fetchMock).not.toHaveBeenCalled();

  await mapStore(NEW_STORE, SECOND_KITCHEN);
  const routed = await resendToClover(manual.order, { manual: true });
  expect(routed.pos).toMatchObject({ ok: true, posOrderId: 'TEST_CLOVER_ORDER' });
  expect(routed.order).toMatchObject({ id: received.order.id, locationCode: SECOND_KITCHEN, posOrderId: 'TEST_CLOVER_ORDER' });
  expect(requested('POST', `/merchants/${MERCHANT}/atomic_order/orders`)).toHaveLength(1);
  expect(requested('POST', `/merchants/${MERCHANT}/print_event`)).toHaveLength(1);
});

it.each([0, 1])('preserves the default Clover path with %i linked kitchens', async (kitchenCount) => {
  if (kitchenCount) {
    await mapStore('fixture-shop-a', FIRST_KITCHEN);
    await mapStore('fixture-shop-b', FIRST_KITCHEN);
  }
  const { order, pos, accept } = await processIncomingOrder(newOrder(`default-store-order-${kitchenCount}`));
  expect(pos).toMatchObject({ ok: true, posOrderId: 'TEST_CLOVER_ORDER' });
  expect(order.status).toBe('new');
  expect(accept).toBeUndefined();
  expect(requested('POST', `/merchants/${MERCHANT}/atomic_order/orders`)).toHaveLength(1);
  expect(requested('POST', `/merchants/${MERCHANT}/print_event`)).toHaveLength(1);
});

it('preserves an explicit hold before checking the default Clover route', async () => {
  await mapStore('fixture-shop-a', FIRST_KITCHEN);
  await mapStore('fixture-shop-b', SECOND_KITCHEN);
  const reason = 'Wait for confirmed intake';
  const received = await processIncomingOrder(newOrder('staged-order'), { holdClover: reason });
  expect(received.pos).toMatchObject({ ok: false, skipped: true, error: reason });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses a saved kitchen for a resend when the store itself is no longer mapped', async () => {
  await mapStore('fixture-shop-a', FIRST_KITCHEN);
  await mapStore('fixture-shop-b', SECOND_KITCHEN);
  const { order } = await getRepo().insertOrderIfNew({ ...newOrder('saved-kitchen-order'), locationCode: FIRST_KITCHEN });
  const routed = await resendToClover(order, { manual: true });
  expect(routed.pos).toMatchObject({ ok: true, posOrderId: 'TEST_CLOVER_ORDER' });
  expect(routed.order.locationCode).toBe(FIRST_KITCHEN);
  expect(requested('POST', `/merchants/${MERCHANT}/atomic_order/orders`)).toHaveLength(1);
});

it('preserves a lost Clover response across a routing hold, then recovers the existing order after mapping', async () => {
  const repo = getRepo();
  await mapStore('fixture-shop-a', FIRST_KITCHEN);
  await mapStore('fixture-shop-b', SECOND_KITCHEN);
  const { order } = await repo.insertOrderIfNew(newOrder('legacy-uncertain-store-order'));
  const uncertain = await repo.updateOrder(order.id, { posError: 'Clover timed out before confirming the order' });
  if (!uncertain) throw new Error('Expected the saved order');
  previousOrders.push({ id: 'EXISTING_CLOVER_ORDER', title: cloverOrderTitle(uncertain), total: 1150 });

  const held = await resendToClover(uncertain, { manual: true });
  expect(held.pos).toMatchObject({ ok: false, uncertain: true });
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await repo.getOrder(order.id))?.timeline?.posRetry?.uncertain).toBe(true);

  await mapStore(NEW_STORE, SECOND_KITCHEN);
  const recovered = await resendToClover(held.order, { manual: true });
  expect(recovered.pos).toMatchObject({ ok: true, posOrderId: 'EXISTING_CLOVER_ORDER', adopted: true });
  expect(recovered.order).toMatchObject({ locationCode: SECOND_KITCHEN, posOrderId: 'EXISTING_CLOVER_ORDER' });
  expect(requested('GET', `/merchants/${MERCHANT}/orders`)).toHaveLength(1);
  expect(requested('POST', `/merchants/${MERCHANT}/atomic_order/orders`)).toHaveLength(0);
});
