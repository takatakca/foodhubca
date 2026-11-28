import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processIncomingOrder } from '../lib/foodhub/pipeline';
import { cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { importCloverPlatformOrders } from '../lib/foodhub/pos/clover-platform-orders';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';

const A = 'TESTMERCH0002';
const B = 'TESTMERCH0003';
const BASE = 'https://clover.example.test';
const CLOCK = new Date('2026-11-27T23:00:00Z');
const minute = 60_000;
const directPosId = 'DIRECT-A';
const nativePosId = 'NATIVE-B';

function directOrder(): NormalizedOrder {
  return {
    channel: 'doordash', marketplace: 'doordash', externalOrderId: 'provider-order-a',
    displayId: 'A1B2C3', channelStoreId: 'direct-store-a', fulfillment: 'delivery',
    placedAt: CLOCK.toISOString(), currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10,
    lines: [{ name: 'Fixture meal', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: {},
  };
}

function mapStore(channelStoreId: string, locationCode: string, cloverMerchantId: string | null, meta = {}) {
  return getRepo().upsertStore({ channel: 'doordash', channelStoreId, brandName: locationCode, locationCode, cloverMerchantId, autoAccept: false, online: true, meta });
}

function mockNativeFeed(title: string, posOrderId = nativePosId) {
  const creates: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    expect(url.origin).toBe(BASE);
    if (url.pathname === `/v3/merchants/${A}/atomic_order/orders` && method === 'POST') {
      creates.push(url.pathname);
      return Response.json({ id: directPosId, total: 1000 });
    }
    expect(method).toBe('GET');
    if (url.pathname.endsWith('/order_types')) return Response.json({ elements: [{ id: 'DD', label: 'DoorDash' }] });
    if (url.pathname.endsWith('/tenders')) return Response.json({ elements: [] });
    if (url.pathname.endsWith('/orders')) return Response.json({ elements: [{
      id: posOrderId, title, createdTime: Date.now() - 3 * minute, currency: 'CAD', total: 1000, orderType: { id: 'DD' },
    }] });
    throw new Error(`Unexpected local Clover request ${method} ${url.pathname}`);
  }));
  return creates;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(CLOCK);
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('FOODHUB_POS_INJECTION', 'on');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'off');
  vi.stubEnv('CLOVER_BASE_URL', BASE);
  vi.stubEnv('CLOVER_MERCHANT_ID', A);
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [A]: 'fixture-token-a', [B]: 'fixture-token-b' }));
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('native Clover title matches and confirmed order receipts', () => {
  it('keeps a distinct foreign native order after the direct-order receipt and an ordinary status update', async () => {
    const source = await mapStore('direct-store-a', 'KITCHEN_A', A);
    const receiving = await mapStore('native-store-b', 'KITCHEN_B', B);
    const creates = mockNativeFeed('DoorDash #A1B2C3');
    const repo = getRepo();
    const { order: direct } = await processIncomingOrder(directOrder());
    expect(direct).toMatchObject({ locationCode: 'KITCHEN_A', posOrderId: directPosId, timeline: { posMerchantId: A } });

    vi.setSystemTime(new Date(CLOCK.getTime() + 10 * minute));
    const refreshed = await repo.updateStore(source.id, { meta: { platformStatus: { state: 'online', source: 'sync' } } });
    expect(Date.parse(refreshed!.updatedAt!)).toBeGreaterThan(Date.parse(direct.createdAt));
    const result = await importCloverPlatformOrders(B);

    expect(result).toMatchObject({ imported: 1, posOrderIds: [nativePosId] });
    expect(await repo.findOrder('doordash', `clover-${nativePosId}`)).toMatchObject({
      channelStoreId: receiving.channelStoreId, locationCode: 'KITCHEN_B', viaPos: 'clover', posOrderId: nativePosId,
    });
    expect(await repo.getOrder(direct.id)).toEqual(direct);
    expect(creates).toEqual([`/v3/merchants/${A}/atomic_order/orders`]);
  });

  it.each([
    { scenario: 'receipt on the same register', merchant: B, posOrderId: directPosId },
    { scenario: 'old receipt without its register', merchant: undefined, posOrderId: directPosId },
    { scenario: 'old receipt after a mapping was moved', merchant: undefined, posOrderId: directPosId, moved: true },
    { scenario: 'register without a confirmed receipt', merchant: A, posOrderId: undefined },
    { scenario: 'ambiguous receiving stores', merchant: A, posOrderId: directPosId, ambiguous: true },
    { scenario: 'receiving store with no pinned register', merchant: A, posOrderId: directPosId, useDefault: true },
    { scenario: 'protected receiving store', merchant: A, posOrderId: directPosId, locked: true },
  ])('keeps the conservative title guard for $scenario', async ({ merchant, posOrderId, ambiguous, useDefault, locked, moved }) => {
    if (useDefault) vi.stubEnv('CLOVER_MERCHANT_ID', B);
    await mapStore('native-store-b', 'KITCHEN_B', useDefault ? null : B, locked ? { menuLocked: true } : {});
    if (ambiguous) await mapStore('other-native-store', 'KITCHEN_C', B);
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...directOrder(), locationCode: 'KITCHEN_A' });
    await repo.patchOrder(order.id, { posMerchantId: merchant }, { posOrderId });
    if (moved) {
      vi.setSystemTime(new Date(CLOCK.getTime() + minute));
      await mapStore(order.channelStoreId, 'KITCHEN_C', A);
    }
    const creates = mockNativeFeed('DoorDash #A1B2C3');

    expect(await importCloverPlatformOrders(B)).toMatchObject({ imported: 0, posOrderIds: [] });
    expect(await repo.findOrder('doordash', `clover-${nativePosId}`)).toBeNull();
    expect(creates).toEqual([]);
  });

  it('keeps exact POS and full scoped screen-title exclusions even for a receipt from another register', async () => {
    await mapStore('native-store-b', 'KITCHEN_B', B);
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({
      ...directOrder(), externalOrderId: `screen-${'a'.repeat(24)}:A1B2C3`, viaHub: 'screen', locationCode: 'KITCHEN_A',
    });
    await repo.patchOrder(order.id, { posMerchantId: A }, { posOrderId: directPosId });
    mockNativeFeed(cloverOrderTitle(order));
    expect(await importCloverPlatformOrders(B)).toMatchObject({ imported: 0 });

    vi.setSystemTime(new Date(CLOCK.getTime() + 10 * minute));
    mockNativeFeed('DoorDash #DifferentCode', directPosId);
    expect(await importCloverPlatformOrders(B)).toMatchObject({ imported: 0 });
  });
});
