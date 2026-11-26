import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { processIncomingOrder } from '../lib/foodhub/pipeline';
import { closeCancelledCloverOrder } from '../lib/foodhub/pos/clover-books';
import { cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { testOrder } from '../lib/foodhub/pos/clover-test-order';
import { getRepo } from '../lib/foodhub/repo';

const BASE = 'https://clover.example.test';
const OAUTH = 'TESTMERCH0001';
const ENV = 'TESTMERCH0002';
const EXPLICIT = 'TESTMERCH0003';
const PENDING = 'TESTMERCH0004';
const POS_ID = 'test-pos-order';
const fetchMock = vi.fn<typeof fetch>();

function rememberMerchant(merchantId: string, status: 'active' | 'pending') {
  return { merchantId, status, accessToken: 'test-oauth-token', connectedAt: new Date().toISOString(), accessTokenExpiration: Math.floor(Date.now() / 1000) + 3600 };
}

function orderPath(merchantId: string) {
  return `/v3/merchants/${merchantId}/orders/${POS_ID}`;
}

function requests() {
  return fetchMock.mock.calls.map(([url, init]) => ({ path: new URL(String(url)).pathname, method: init?.method ?? 'GET' }));
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('CLOVER_BASE_URL', BASE);
  vi.stubEnv('CLOVER_MERCHANT_ID', undefined);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', undefined);
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
  vi.stubEnv('FOODHUB_CLOVER_ORDER_TYPES', 'off');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'off');
  vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', undefined);
  vi.stubEnv('FOODHUB_MEV', 'off');
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  await getRepo().setKv('clover_oauth_merchants', { [OAUTH]: rememberMerchant(OAUTH, 'active'), [PENDING]: rememberMerchant(PENDING, 'pending') });
  let title = cloverOrderTitle(testOrder());
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== BASE) throw new Error('Unexpected provider request');
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.pathname.endsWith('/atomic_order/orders')) {
      title = JSON.parse(String(init?.body)).orderCart.title;
      return Response.json({ id: POS_ID });
    }
    if (method === 'DELETE' && url.pathname.endsWith(`/orders/${POS_ID}`)) return new Response(null, { status: 204 });
    if (['GET', 'POST'].includes(method) && url.pathname.endsWith(`/orders/${POS_ID}`)) return Response.json({ id: POS_ID, title, note: 'Synthetic pickup note' });
    throw new Error('Unexpected Clover request');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Clover cancellation uses the order’s selected register', () => {
  it.each([
    { name: 'the sole approved OAuth register', withEnv: false, explicit: null, selected: OAUTH },
    { name: 'the environment register ahead of OAuth', withEnv: true, explicit: null, selected: ENV },
    { name: 'an explicit mapping ahead of both defaults', withEnv: true, explicit: EXPLICIT, selected: EXPLICIT },
  ])('creates and removes the cancelled order on $name', async ({ withEnv, explicit, selected }) => {
    if (withEnv) {
      vi.stubEnv('CLOVER_MERCHANT_ID', ENV);
      vi.stubEnv('CLOVER_ACCESS_TOKEN', 'test-env-token');
    }
    if (explicit) vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [explicit]: 'test-explicit-token' }));

    const repo = getRepo();
    const incoming = testOrder();
    await repo.upsertStore({ channel: incoming.channel, channelStoreId: incoming.channelStoreId, brandName: 'Test brand', locationCode: 'TEST', cloverMerchantId: explicit, autoAccept: false, online: true, meta: {} });
    const outcome = await processIncomingOrder(incoming);
    expect(outcome.order.posOrderId).toBe(POS_ID);

    const cancelled = await repo.updateOrder(outcome.order.id, { status: 'cancelled' });
    const settled = await settleInClover(cancelled);
    expect(settled?.timeline?.posClosedAt).toBeTruthy();
    expect((await repo.listEvents(outcome.order.id)).map((event) => event.type)).toContain('pos_cancelled');
    await settleInClover(settled);
    expect(requests()).toEqual([
      { path: `/v3/merchants/${selected}/atomic_order/orders`, method: 'POST' },
      ...(selected === OAUTH ? [{ path: orderPath(selected), method: 'GET' }] : []),
      { path: orderPath(selected), method: 'DELETE' },
    ]);
  });

  it('retains the flag-only path and never deletes the order', async () => {
    const order = { ...testOrder(), posOrderId: POS_ID, channel: 'tgtg' as const, marketplace: 'tgtg' as const };
    fetchMock.mockResolvedValueOnce(Response.json({ id: POS_ID, title: cloverOrderTitle(order), note: 'Synthetic pickup note' }));
    expect(await closeCancelledCloverOrder(order, null, { flagOnly: true })).toMatchObject({ ok: true });
    expect(requests()).toEqual([{ path: orderPath(OAUTH), method: 'GET' }, { path: orderPath(OAUTH), method: 'POST' }]);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ title: expect.stringMatching(/^CANCELLED/), note: expect.stringContaining('Synthetic pickup note') });
  });

  it('leaves an order alone when an inferred OAuth register cannot confirm its identity', async () => {
    const order = { ...testOrder(), posOrderId: POS_ID };
    fetchMock.mockResolvedValueOnce(Response.json({ id: POS_ID, title: 'Unrelated order' }));
    expect(await closeCancelledCloverOrder(order, null)).toMatchObject({
      ok: false, message: expect.stringContaining('Could not confirm this order'),
    });
    expect(requests()).toEqual([{ path: orderPath(OAUTH), method: 'GET' }]);
  });

  it('recognizes previously flagged cancellations after a lost response', async () => {
    const order = { ...testOrder(), posOrderId: POS_ID };
    fetchMock.mockResolvedValueOnce(Response.json({ id: POS_ID, title: `CANCELLED — ${cloverOrderTitle(order)}` }));
    expect(await closeCancelledCloverOrder(order, null)).toMatchObject({ ok: true });
    expect(requests()).toEqual([{ path: orderPath(OAUTH), method: 'GET' }]);
  });

  it('does not touch Clover while cancellation is off, even with an approved fallback', async () => {
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'off');
    const order = { ...testOrder(), posOrderId: POS_ID };
    expect(await closeCancelledCloverOrder(order, null)).toMatchObject({ ok: false, skipped: true });
    expect(await closeCancelledCloverOrder(order, null, { flagOnly: true })).toMatchObject({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not guess an OAuth register or contact Clover for an order with no POS ID', async () => {
    await getRepo().setKv('clover_oauth_merchants', { [OAUTH]: rememberMerchant(OAUTH, 'active'), [EXPLICIT]: rememberMerchant(EXPLICIT, 'active') });
    expect(await closeCancelledCloverOrder({ ...testOrder(), posOrderId: POS_ID }, null)).toMatchObject({ ok: false, skipped: true });
    expect(await closeCancelledCloverOrder(testOrder(), EXPLICIT)).toMatchObject({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
