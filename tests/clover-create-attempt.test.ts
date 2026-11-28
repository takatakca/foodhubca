import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { injectOrder } from '../lib/foodhub/pos/clover';
import { testOrder } from '../lib/foodhub/pos/clover-test-order';

const BASE = 'http://127.0.0.1:1';
const MERCHANT = 'TESTMERCH0001';
const OTHER = 'TESTMERCH0002';
const POST = `${BASE}/v3/merchants/${MERCHANT}/atomic_order/orders`;
const fetchMock = vi.fn<typeof fetch>();
const beforeCreate = vi.fn(async (mid: string) => { expect(mid).toBe(MERCHANT); });

beforeEach(() => {
  for (const [key, value] of Object.entries({
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_POS_INJECTION: 'on', FOODHUB_CLOVER_RETRY_MS: '0',
    CLOVER_BASE_URL: BASE, CLOVER_MERCHANT_ID: MERCHANT, CLOVER_ACCESS_TOKEN: 'synthetic-token',
  })) vi.stubEnv(key, value);
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  vi.stubGlobal('__foodhubMem', undefined);
  beforeCreate.mockClear();
  fetchMock.mockReset().mockImplementation(async () => Response.json({ id: 'fixture-pos-order' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('waits for durable authorization and sends the prepared request only to its exact register', async () => {
  const authorize = vi.fn(async (mid: string) => {
    expect(mid).toBe(MERCHANT);
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.resolve();
    // The default could move while authorization waits for the database.
    vi.stubEnv('CLOVER_MERCHANT_ID', OTHER);
  });
  expect(await injectOrder(testOrder(), MERCHANT, { beforeCreate: authorize })).toMatchObject({ ok: true, merchantId: MERCHANT });
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(POST, expect.objectContaining({ method: 'POST', body: expect.any(String) }));
});

it('returns a caller hold without a send and propagates a storage failure as the original error', async () => {
  const hold = { ok: false as const, skipped: true, error: 'Signed cancellation already recorded' };
  expect(await injectOrder(testOrder(), MERCHANT, { beforeCreate: async () => hold })).toBe(hold);
  const unavailable = new Error('Simulated attempt storage unavailable');
  const authorize = vi.fn().mockRejectedValue(unavailable);
  await expect(injectOrder(testOrder(), MERCHANT, { beforeCreate: authorize })).rejects.toBe(unavailable);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not reserve an attempt if an explicit target is absent or the order has no lines', async () => {
  expect(await injectOrder(testOrder(), null, { beforeCreate })).toMatchObject({ ok: false });
  expect(await injectOrder({ ...testOrder(), lines: [] }, MERCHANT, { beforeCreate })).toMatchObject({ ok: false });
  expect(beforeCreate).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not reserve an attempt before a usable token is available', async () => {
  expect(await injectOrder(testOrder(), OTHER, { beforeCreate })).toMatchObject({ ok: false, error: expect.stringContaining('No Clover API token') });
  expect(beforeCreate).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps a guarded 429 to one POST while ordinary creates still retry rate limiting', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
  expect(await injectOrder(testOrder(), MERCHANT, { beforeCreate })).toMatchObject({ ok: false, httpStatus: 429, uncertain: false });
  expect(beforeCreate).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockClear().mockResolvedValueOnce(new Response(null, { status: 429 }));
  expect(await injectOrder(testOrder())).toMatchObject({ ok: true, merchantId: MERCHANT });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('reports an ambiguous provider error only after authorization and one send', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Simulated lost Clover response'));
  expect(await injectOrder(testOrder(), MERCHANT, { beforeCreate })).toMatchObject({ ok: false, uncertain: true });
  expect(beforeCreate).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
