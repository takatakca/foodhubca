import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { injectOrder } from '../lib/foodhub/pos/clover';
import { cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { testOrder } from '../lib/foodhub/pos/clover-test-order';
import { getRepo } from '../lib/foodhub/repo';
import type { StoredOrder } from '../lib/foodhub/types';

const CLOVER = 'http://127.0.0.1:1';
const ACTUAL_REGISTER = 'TESTORIGINAL1';
const NEW_MAPPING = 'TESTMAPPED001';
const POS_ID = 'fixture-clover-order-id';
const mockFetch = vi.fn<typeof fetch>();

const path = (merchant: string, order = POS_ID) => `/v3/merchants/${merchant}/orders/${order}`;
const requests = () => mockFetch.mock.calls.map(([url, init]) => ({ path: new URL(String(url)).pathname, method: init?.method ?? 'GET' }));

async function mappedOrder(patch: Partial<StoredOrder> = {}) {
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({ ...testOrder(), locationCode: 'ORIGINAL_FIXTURE' });
  await repo.upsertStore({ channel: order.channel, channelStoreId: order.channelStoreId, brandName: 'New kitchen fixture', locationCode: 'MOVED_FIXTURE', cloverMerchantId: NEW_MAPPING, autoAccept: false, online: true, meta: {} });
  if (!Object.keys(patch).length) return order;
  const updated = await repo.updateOrder(order.id, patch);
  if (!updated) throw new Error('Fixture order was not stored');
  return updated;
}

beforeEach(() => {
  vi.stubGlobal('__foodhubMem', undefined);
  for (const [key, value] of Object.entries({
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_MEV: 'off', FOODHUB_POS_INJECTION: 'on', FOODHUB_CLOVER_DELETE_CANCELLED: 'on',
    CLOVER_BASE_URL: CLOVER, CLOVER_MERCHANT_ID: NEW_MAPPING, CLOVER_ACCESS_TOKEN: 'synthetic-default-token',
    CLOVER_MERCHANT_TOKENS: JSON.stringify({ [ACTUAL_REGISTER]: 'synthetic-actual-token', [NEW_MAPPING]: 'synthetic-mapped-token' }),
  })) vi.stubEnv(key, value);
  mockFetch.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(CLOVER);
    if (init?.method === 'POST' && url.pathname.endsWith('/atomic_order/orders')) return Response.json({ id: POS_ID });
    if (init?.method === 'DELETE' && url.pathname.endsWith(`/orders/${POS_ID}`)) return new Response(null, { status: 204 });
    throw new Error('Unexpected provider request');
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('returns the actual POST merchant and closes that original receipt after the store mapping changes', async () => {
  const order = await mappedOrder();
  const respond = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (url, init) => {
    if (new URL(String(url)).pathname === path(ACTUAL_REGISTER) && (!init?.method || init.method === 'GET')) {
      return Response.json({ id: POS_ID, title: cloverOrderTitle(order) });
    }
    return respond(url, init);
  });
  const created = await injectOrder(order, ACTUAL_REGISTER);
  expect(created).toMatchObject({ ok: true, posOrderId: POS_ID, merchantId: ACTUAL_REGISTER });
  if (!created.ok) throw new Error('Expected simulated Clover creation');
  const cancelled = await getRepo().patchOrder(order.id, { posMerchantId: created.merchantId }, { posOrderId: created.posOrderId, status: 'cancelled' });
  const settled = await settleInClover(cancelled);
  expect(settled?.timeline).toMatchObject({ posMerchantId: ACTUAL_REGISTER, posClosedAt: expect.any(String) });
  expect(requests()).toEqual([
    { path: `/v3/merchants/${ACTUAL_REGISTER}/atomic_order/orders`, method: 'POST' },
    { path: path(ACTUAL_REGISTER), method: 'GET' },
    { path: path(ACTUAL_REGISTER), method: 'DELETE' },
  ]);
});

it('does not fall back to a different registered store if the proven merchant is no longer authorized', async () => {
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  const order = await mappedOrder({ posOrderId: POS_ID, status: 'failed', timeline: { posMerchantId: ACTUAL_REGISTER } });
  const settled = await settleInClover(order);
  expect(settled?.timeline?.posClosedAt).toBeUndefined();
  expect((await getRepo().listEvents(order.id)).map(({ type }) => type)).toContain('pos_cancel_failed');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('keeps cleanup blocked for imported, already-paid, and deliberately disabled cancellations even with provenance', async () => {
  const base = { posOrderId: POS_ID, status: 'cancelled' as const, timeline: { posMerchantId: ACTUAL_REGISTER } };
  const order = await mappedOrder(base);
  expect(await settleInClover({ ...order, viaPos: 'clover' })).toMatchObject({ viaPos: 'clover' });
  vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'off');
  await settleInClover(order);
  vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
  await settleInClover({ ...order, timeline: { ...order.timeline, posPaymentId: 'fixture-already-paid' } });
  expect((await getRepo().listEvents(order.id)).map(({ type }) => type)).toContain('pos_paid_then_cancelled');
  expect(mockFetch).not.toHaveBeenCalled();
});
