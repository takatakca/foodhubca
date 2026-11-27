import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { getRepo } from '../lib/foodhub/repo';
import type { StoredOrder } from '../lib/foodhub/types';

const merchant = 'SYNTHETIC-RECEIPT-REGISTER';
const posId = 'synthetic-pos-receipt';
const closeUrl = `https://clover.fixture.invalid/v3/merchants/${merchant}/orders/${posId}`;
const fetchMock = vi.fn<typeof fetch>();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', fetchMock.mockReset());
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
  vi.stubEnv('CLOVER_MERCHANT_ID', merchant);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'synthetic-clover-token');
  vi.stubEnv('CLOVER_BASE_URL', 'https://clover.fixture.invalid');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function seed(status: 'cancelled' | 'failed' = 'cancelled', priorClaim?: StoredOrder['timeline']) {
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({
    channel: 'skip', marketplace: 'skip', externalOrderId: 'synthetic-order', channelStoreId: 'synthetic-store', locationCode: 'SYNTHETIC-KITCHEN',
    fulfillment: 'pickup', placedAt: new Date().toISOString(), currency: 'CAD', total: 10, subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {},
  });
  return (await repo.patchOrder(order.id, { posMerchantId: merchant, ...priorClaim }, { status, posOrderId: posId }))!;
}

describe('settling a direct terminal Skip receipt', () => {
  it.each(['cancelled', 'failed'] as const)('lets one worker close a %s order while another worker holds a stale snapshot', async (status) => {
    const repo = getRepo();
    const order = await seed(status);
    const started = deferred();
    const allowClose = deferred();
    fetchMock.mockImplementation(async (input, init) => {
      expect(String(input)).toBe(closeUrl);
      expect(init?.method).toBe('DELETE');
      if (fetchMock.mock.calls.length === 1) {
        started.resolve();
        await allowClose.promise;
      }
      return new Response(null, { status: 204 });
    });
    const first = settleInClover(order);
    const reached = await Promise.race([started.promise.then(() => true), first.then(() => false)]);
    expect(reached).toBe(true);
    try {
      await settleInClover(order);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await repo.getOrder(order.id))?.timeline?.posCloseClaim).toMatchObject({ id: expect.any(String), at: expect.any(String) });
    } finally {
      allowClose.resolve();
      await first;
    }
    await settleInClover(order);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = await repo.getOrder(order.id);
    expect(stored?.timeline?.posClosedAt).toBeTruthy();
    expect(stored?.timeline?.posCloseClaim).toBeUndefined();
    expect((await repo.listEvents(order.id)).filter(({ type }) => type === 'pos_cancelled')).toHaveLength(1);
  });

  it('can reclaim an expired reservation and preserves a newer owner when the previous provider result arrives', async () => {
    const repo = getRepo();
    const order = await seed('cancelled', { posCloseClaim: { id: 'expired-worker', at: new Date(Date.now() - 600_000).toISOString() } });
    const successor = { id: 'successor-worker', at: new Date().toISOString() };
    let replaced: unknown;
    fetchMock.mockImplementationOnce(async () => {
      replaced = (await repo.getOrder(order.id))?.timeline?.posCloseClaim;
      await repo.patchOrder(order.id, { posCloseClaim: successor });
      return new Response(null, { status: 204 });
    });
    const settled = await settleInClover(order);
    expect(replaced).toMatchObject({ id: expect.any(String), at: expect.any(String) });
    expect(replaced).not.toEqual(order.timeline?.posCloseClaim);
    expect(settled?.timeline?.posCloseClaim).toEqual(successor);
    expect(settled?.timeline?.posClosedAt).toBeUndefined();
    expect((await repo.listEvents(order.id)).filter(({ type }) => type === 'pos_cancelled')).toHaveLength(0);
  });
});
