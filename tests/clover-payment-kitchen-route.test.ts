import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../app/api/foodhub/orders/[id]/route';
import { POST as saveMapping } from '../app/api/foodhub/stores/route';
import { hashPassword } from '../lib/foodhub/auth';
import { saveBrand, saveLocation } from '../lib/foodhub/catalog';
import { processIncomingOrder } from '../lib/foodhub/pipeline';
import { _resetOrderTypeCache } from '../lib/foodhub/pos/clover-order';
import { getRepo } from '../lib/foodhub/repo';

const CLOVER = 'https://clover.example.test';
const ORIGINAL_MERCHANT = 'TESTMERCH0001';
const DESTINATION_MERCHANT = 'TESTMERCH0002';
const ORIGINAL_KITCHEN = 'TEST_KITCHEN_A';
const DESTINATION_KITCHEN = 'TEST_KITCHEN_B';
const POS_ORDER_ID = 'TEST_CLOVER_ORDER';
const PASSWORD = 'test-clover-payment-kitchen-password';
const MANAGER = 'synthetic-kitchen-manager';
const OWNER_PASSWORD = 'test-clover-payment-owner-password';
const fetchMock = vi.fn<typeof fetch>();

async function prepareOrder(cloverMerchantId: string | null = ORIGINAL_MERCHANT) {
  const repo = getRepo();
  await repo.saveUser({ username: MANAGER, name: 'Test manager', role: 'manager', locations: [ORIGINAL_KITCHEN], active: true, passwordHash: hashPassword(PASSWORD) });
  const store = await repo.upsertStore({
    channel: 'doordash', channelStoreId: 'test-doordash-store', brandName: 'Synthetic brand', locationCode: ORIGINAL_KITCHEN,
    cloverMerchantId, autoAccept: false, online: true, meta: {},
  });
  const { order } = await processIncomingOrder({
    channel: 'doordash', marketplace: 'doordash', externalOrderId: 'synthetic-provider-order', displayId: 'A1234', channelStoreId: store.channelStoreId,
    fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5,
    deliveryFee: 0, tip: 0, discount: 0, total: 11.5,
    lines: [{ name: 'Synthetic item', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: {},
  });
  expect(order).toMatchObject({ locationCode: ORIGINAL_KITCHEN, posOrderId: POS_ORDER_ID });
  await repo.updateOrder(order.id, { status: 'ready' });
  fetchMock.mockClear();
  return { store, order };
}

async function submit(orderId: string, action: 'dispatch' | 'complete' = 'dispatch') {
  const response = await POST(new Request(`https://foodhub.example.test/api/foodhub/orders/${orderId}`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${MANAGER}:${PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }), { params: Promise.resolve({ id: orderId }) });
  expect(response.status).toBe(200);
  return response.json();
}

function paymentPostPaths() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([input]) => new URL(String(input)).pathname);
}

beforeEach(() => {
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_POS_INJECTION: 'on', FOODHUB_CLOVER_AUTOPRINT: 'on', FOODHUB_RETRY_TIMER: 'off',
    LIVE_CONNECTORS_GLOBAL_ENABLED: 'false', FOODHUB_VIA_CLOVER: '', FOODHUB_CLOVER_RECORD_PAYMENT: 'on',
    DASHBOARD_PASSWORD: OWNER_PASSWORD, SESSION_SECRET: 'test-clover-payment-session-secret',
    CLOVER_BASE_URL: CLOVER, CLOVER_MERCHANT_ID: ORIGINAL_MERCHANT, CLOVER_ACCESS_TOKEN: 'synthetic-first-token',
    CLOVER_MERCHANT_TOKENS: JSON.stringify({ [DESTINATION_MERCHANT]: 'synthetic-second-token' }),
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.stubEnv('CLOVER_CLIENT_ID', undefined);
  vi.stubGlobal('__foodhubMem', undefined);
  _resetOrderTypeCache();
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== CLOVER) throw new Error('Unexpected provider request');
    const path = url.pathname;
    if (path.endsWith('/order_types')) return Response.json({ elements: [{ id: 'TEST_TYPE', label: 'Online Order Delivery' }] });
    if (path.endsWith('/atomic_order/orders')) return Response.json({ id: POS_ORDER_ID, total: 1150 });
    if (path.endsWith('/print_event')) return Response.json({ id: 'TEST_PRINT', state: 'CREATED' });
    if (path.endsWith('/tenders')) return Response.json(init?.method === 'POST' ? { id: 'TEST_TENDER' } : { elements: [] });
    if (path.endsWith('/payments') && path.startsWith(`/v3/merchants/${ORIGINAL_MERCHANT}/`)) return Response.json({ id: 'TEST_PAYMENT' });
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('keeps dispatch and completion in the saved kitchen but holds Clover payment after the store moves', async () => {
  const { store, order } = await prepareOrder();
  const repo = getRepo();
  await repo.updateStore(store.id, { locationCode: DESTINATION_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT });

  expect(await submit(order.id)).toMatchObject({
    result: { ok: true }, order: { status: 'dispatched', locationCode: ORIGINAL_KITCHEN, timeline: { posPaymentError: expect.stringMatching(/different kitchen/i) } },
  });
  expect(await submit(order.id, 'complete')).toMatchObject({ result: { ok: true }, order: { status: 'completed' } });
  expect((await repo.getOrder(order.id))?.timeline?.posPaymentId).toBeUndefined();
  expect((await repo.listEvents(order.id)).filter((event) => event.type === 'pos_payment_failed')).toMatchObject([
    { detail: { error: expect.stringMatching(/different kitchen/i) } },
  ]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([false, true])('keeps the legacy register fallback when the original merchant is unknown (mapping removed: %s)', async (removed) => {
  const { store, order } = await prepareOrder();
  const { posMerchantId: _originalMerchant, ...legacyTimeline } = order.timeline ?? {};
  await getRepo().updateOrder(order.id, { timeline: legacyTimeline });
  if (removed) await getRepo().deleteStore(store.id);

  expect(await submit(order.id)).toMatchObject({ result: { ok: true }, order: { status: 'dispatched', timeline: { posPaymentId: 'TEST_PAYMENT' } } });
  expect(paymentPostPaths()).toEqual([`/v3/merchants/${ORIGINAL_MERCHANT}/tenders`, `/v3/merchants/${ORIGINAL_MERCHANT}/orders/${POS_ORDER_ID}/payments`]);
});

it('uses the original Clover merchant after the authenticated mapping changes registers in the same kitchen', async () => {
  const { store, order } = await prepareOrder();
  await saveBrand({ name: store.brandName, active: true });
  await saveLocation({ code: ORIGINAL_KITCHEN, name: 'Synthetic kitchen', address: '', active: true });
  const response = await saveMapping(new Request('https://foodhub.example.test/api/foodhub/stores', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`owner:${OWNER_PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...store, cloverMerchantId: DESTINATION_MERCHANT }),
  }), {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ store: { locationCode: ORIGINAL_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT } });

  const result = await submit(order.id);
  expect(paymentPostPaths()).toEqual([`/v3/merchants/${ORIGINAL_MERCHANT}/tenders`, `/v3/merchants/${ORIGINAL_MERCHANT}/orders/${POS_ORDER_ID}/payments`]);
  expect(fetchMock.mock.calls.every(([input]) => new URL(String(input)).pathname.startsWith(`/v3/merchants/${ORIGINAL_MERCHANT}/`))).toBe(true);
  expect(result).toMatchObject({ result: { ok: true }, order: { status: 'dispatched', timeline: { posPaymentId: 'TEST_PAYMENT', posMerchantId: ORIGINAL_MERCHANT } } });
});

it('records payment on the sole approved Clover OAuth merchant selected during intake', async () => {
  vi.stubEnv('CLOVER_MERCHANT_ID', undefined);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', undefined);
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  await getRepo().setKv('clover_oauth_merchants', {
    [ORIGINAL_MERCHANT]: { merchantId: ORIGINAL_MERCHANT, status: 'active', accessToken: 'synthetic-oauth-token' },
  });
  const { order } = await prepareOrder(null);

  const result = await submit(order.id);
  expect(paymentPostPaths()).toEqual([`/v3/merchants/${ORIGINAL_MERCHANT}/tenders`, `/v3/merchants/${ORIGINAL_MERCHANT}/orders/${POS_ORDER_ID}/payments`]);
  expect(result).toMatchObject({ order: { status: 'dispatched', timeline: { posPaymentId: 'TEST_PAYMENT', posMerchantId: ORIGINAL_MERCHANT } } });
});

it('records payment in the original register when the mapping matches again at completion', async () => {
  const { store, order } = await prepareOrder();
  const repo = getRepo();
  await repo.updateStore(store.id, { locationCode: DESTINATION_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT });
  expect(await submit(order.id)).toMatchObject({ result: { ok: true }, order: { status: 'dispatched', timeline: { posPaymentError: expect.stringMatching(/different kitchen/i) } } });
  expect(fetchMock).not.toHaveBeenCalled();

  await repo.updateStore(store.id, { locationCode: ORIGINAL_KITCHEN, cloverMerchantId: ORIGINAL_MERCHANT });
  const status = await submit(order.id, 'complete');
  expect(status).toMatchObject({ result: { ok: true }, order: { status: 'completed', timeline: { posPaymentId: 'TEST_PAYMENT' } } });
  expect(status.order.timeline.posPaymentError).toBeUndefined();
  expect(paymentPostPaths()).toEqual([`/v3/merchants/${ORIGINAL_MERCHANT}/tenders`, `/v3/merchants/${ORIGINAL_MERCHANT}/orders/${POS_ORDER_ID}/payments`]);
});

it('leaves payment off when configured off even if the store moved', async () => {
  const { store, order } = await prepareOrder();
  vi.stubEnv('FOODHUB_CLOVER_RECORD_PAYMENT', 'off');
  await getRepo().updateStore(store.id, { locationCode: DESTINATION_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT });

  const status = await submit(order.id);
  expect(status).toMatchObject({ result: { ok: true }, order: { status: 'dispatched' } });
  expect(status.order.timeline.posPaymentError).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});
