import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testOrder } from '../lib/foodhub/pos/clover-test-order';
import { getRepo } from '../lib/foodhub/repo';

const MERCHANT = 'TESTMERCH0001';
const OTHER = 'TESTMERCH0002';
const STORE = 'FIXTURE-SKIP-STORE';
const KITCHEN = 'FIXTURE-KITCHEN';

async function fixture() {
  const repo = getRepo();
  const mapping = await repo.upsertStore({ channel: 'skip', channelStoreId: STORE, locationCode: KITCHEN,
    brandName: 'Fixture brand', cloverMerchantId: MERCHANT, autoAccept: true, online: true, meta: {} });
  const { order } = await repo.insertOrderIfNew({ ...testOrder(), channel: 'skip', marketplace: 'skip', channelStoreId: STORE, locationCode: KITCHEN });
  const prepare = { kind: 'prepare_clover' as const, orderId: order.id, externalOrderId: order.externalOrderId, merchantId: MERCHANT };
  return { repo, mapping, order, prepare };
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubGlobal('__foodhubMem', undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  { name: 'register reassignment in the same kitchen', patch: { cloverMerchantId: OTHER } },
  { name: 'kitchen relocation on the same register', patch: { locationCode: 'FIXTURE-MOVED' } },
  { name: 'version change without routing fields changing', patch: { online: false } },
])('leaves the order unreserved after $name', async ({ patch }) => {
  const { repo, mapping, order, prepare } = await fixture();
  vi.setSystemTime(new Date('2026-11-01T12:00:01Z'));
  await repo.updateStore(mapping.id, patch);

  expect(await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping })).toMatchObject({ outcome: 'mapping_changed', order: { id: order.id, status: 'new' } });
  expect((await repo.getOrder(order.id))?.timeline?.posCreateAttempt).toBeUndefined();
});

it('validates the mapped order ID, current kitchen, merchant and version before reserving', async () => {
  const { repo, mapping, order, prepare } = await fixture();
  expect((await repo.applySkipLifecycle(prepare)).outcome).toBe('mapping_changed');
  expect((await repo.applySkipLifecycle({ ...prepare, merchantId: OTHER, storeMapping: mapping })).outcome).toBe('mapping_changed');
  expect((await repo.applySkipLifecycle({ ...prepare, storeMapping: { ...mapping, id: 'different-mapping' } })).outcome).toBe('mapping_changed');
  expect((await repo.getOrder(order.id))?.timeline?.posCreateAttempt).toBeUndefined();

  expect(await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping })).toMatchObject({
    outcome: 'prepared', order: { timeline: { posCreateAttempt: { merchantId: MERCHANT, id: expect.any(String) } } },
  });
});

it('rejects an obsolete assertion of no mapping and allows it only when the store is still absent', async () => {
  const { repo, mapping, order, prepare } = await fixture();
  expect((await repo.applySkipLifecycle({ ...prepare, storeMapping: null })).outcome).toBe('mapping_changed');
  await repo.deleteStore(mapping.id);
  expect((await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping })).outcome).toBe('mapping_changed');
  expect((await repo.getOrder(order.id))?.timeline?.posCreateAttempt).toBeUndefined();
  expect((await repo.applySkipLifecycle({ ...prepare, storeMapping: null })).outcome).toBe('prepared');
});

it('preserves a previously prepared register when its mapping later moves', async () => {
  const { repo, mapping, prepare } = await fixture();
  const first = await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping });
  const attempt = first.order?.timeline?.posCreateAttempt;
  await repo.updateStore(mapping.id, { cloverMerchantId: OTHER, locationCode: 'FIXTURE-MOVED' });

  expect(await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping })).toMatchObject({
    outcome: 'attempt_pending', order: { timeline: { posCreateAttempt: attempt } },
  });
  const received = await repo.applySkipLifecycle({ kind: 'record_receipt', orderId: prepare.orderId, externalOrderId: prepare.externalOrderId,
    merchantId: MERCHANT, posOrderId: 'fixture-pos-receipt', adopted: true });
  expect(received.order).toMatchObject({ locationCode: KITCHEN, posOrderId: 'fixture-pos-receipt', timeline: { posMerchantId: MERCHANT } });
});

it('honors a cancellation even if its original mapping has already changed', async () => {
  const { repo, mapping, order, prepare } = await fixture();
  await repo.applySkipLifecycle({ kind: 'cancel', externalOrderId: order.externalOrderId, detail: { reason: 'fixture cancellation' } });
  await repo.updateStore(mapping.id, { cloverMerchantId: OTHER });

  expect(await repo.applySkipLifecycle({ ...prepare, storeMapping: mapping })).toMatchObject({ outcome: 'cancelled', order: { status: 'cancelled' } });
  expect((await repo.getOrder(order.id))?.timeline?.posCreateAttempt).toBeUndefined();
});
