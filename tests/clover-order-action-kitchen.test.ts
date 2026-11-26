import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/foodhub/orders/[id]/route';
import { hashPassword } from '../lib/foodhub/auth';
import { testOrder } from '../lib/foodhub/pos/clover-test-order';
import { getRepo } from '../lib/foodhub/repo';
import { fireDueScheduled } from '../lib/foodhub/scheduling';

const CLOVER = 'https://clover.example.test';
const SAVED_KITCHEN = 'TEST_ORIGINAL';
const MOVED_KITCHEN = 'TEST_OTHER';
const PASSWORD = 'test-kitchen-manager-fixture';
const PRINTED_AT = '2026-11-26T10:00:00.000Z';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('CLOVER_BASE_URL', CLOVER);
  vi.stubEnv('CLOVER_MERCHANT_ID', 'TESTMERCH0002');
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'test-clover-fixture');
  vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
  vi.stubEnv('FOODHUB_CLOVER_ORDER_TYPES', 'off');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'off');
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockImplementation(async (input) => {
    if (new URL(String(input)).origin !== CLOVER) throw new Error('Unexpected provider request');
    return Response.json({ id: 'clover-test-response', state: 'QUEUED' });
  });
  vi.stubGlobal('fetch', fetchMock);

  const passwordHash = hashPassword(PASSWORD);
  const repo = getRepo();
  await repo.saveUser({ username: 'original-manager', name: 'Test manager', role: 'manager', locations: [SAVED_KITCHEN], active: true, passwordHash });
  await repo.saveUser({ username: 'other-manager', name: 'Test manager', role: 'manager', locations: [MOVED_KITCHEN], active: true, passwordHash });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function request(id: string, action: string, username: string) {
  return POST(new Request(`https://hub.example.test/api/foodhub/orders/${id}`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action }),
  }), { params: Promise.resolve({ id }) });
}

async function orderWithMovedStore() {
  const repo = getRepo();
  const incoming = { ...testOrder(), channelStoreId: 'synthetic-kitchen-route', locationCode: SAVED_KITCHEN, brandName: 'Original test brand' };
  const { order } = await repo.insertOrderIfNew(incoming);
  await repo.upsertStore({
    channel: incoming.channel, channelStoreId: incoming.channelStoreId, brandName: 'Moved test brand', locationCode: MOVED_KITCHEN,
    cloverMerchantId: 'TESTMERCH0002', autoAccept: false, online: true, meta: {},
  });
  return order;
}

describe('Clover order actions after a store changes kitchens', () => {
  it.each(['retry_pos', 'print'] as const)('holds %s at the saved kitchen through the authenticated API', async (action) => {
    const repo = getRepo();
    const order = await orderWithMovedStore();
    await repo.updateOrder(order.id, { status: 'accepted', ...(action === 'print' ? { posOrderId: 'original-pos-ref', timeline: { printedAt: PRINTED_AT } } : {}) });

    expect((await request(order.id, action, 'other-manager')).status).toBe(404);
    const response = await request(order.id, action, 'original-manager');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: { locationCode: SAVED_KITCHEN, brandName: 'Original test brand' },
      result: { ok: false, message: expect.stringMatching(/different kitchen/i) },
    });
    const current = await repo.getOrder(order.id);
    if (action === 'print') {
      expect(current?.posOrderId).toBe('original-pos-ref');
      expect(current?.timeline?.printedAt).toBe(PRINTED_AT);
      expect(current?.timeline?.printError).toMatch(/different kitchen/i);
    } else {
      expect(current?.posOrderId).toBeUndefined();
      expect(current?.posError).toMatch(/different kitchen/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releases a scheduled order in its saved kitchen with a print error and no provider request', async () => {
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    const repo = getRepo();
    const order = await orderWithMovedStore();
    const fireAt = '2026-11-26T12:00:00.000Z';
    await repo.updateOrder(order.id, { status: 'accepted', posOrderId: 'original-pos-ref', timeline: { fireAt } });

    expect(await fireDueScheduled(Date.parse('2026-11-26T12:01:00.000Z'))).toBe(1);
    expect(await fireDueScheduled(Date.parse('2026-11-26T12:02:00.000Z'))).toBe(0);
    expect(await repo.getOrder(order.id)).toMatchObject({
      status: 'accepted', locationCode: SAVED_KITCHEN, posOrderId: 'original-pos-ref',
      timeline: { firedAt: expect.any(String), printError: expect.stringMatching(/different kitchen/i) },
    });
    expect(await repo.listEvents(order.id)).toContainEqual(expect.objectContaining({ type: 'print_failed' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
