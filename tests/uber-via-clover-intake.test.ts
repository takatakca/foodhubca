import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as signedUberWebhook } from '../app/api/foodhub/webhooks/uber-eats/route';
import { forgetUberTokenMemory, parseUberOrder } from '../lib/foodhub/adapters/uber-eats';
import { recoverMissedUberOrders } from '../lib/foodhub/adapters/uber-events';
import { getInboxEntry, INBOX, receiveWebhook, replayInboxEntry, runInboxEntry } from '../lib/foodhub/inbox';
import { importCloverPlatformOrders } from '../lib/foodhub/pos/clover-platform-orders';
import { getRepo } from '../lib/foodhub/repo';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (task: () => Promise<void>) => { deferred.push(task); },
}));

const UBER = 'https://uber.fixture.test';
const CLOVER = 'https://clover.fixture.test';
const STORE = 'uber-fixture-store';
const ORDER = 'uber-fixture-order';
const MERCHANT = 'FIXTUREMERCH1';
const KITCHEN = 'FIXTURE_KITCHEN';
const SIGNING_KEY = 'synthetic-uber-order-signing-key';
const OWNER = { username: 'fixture-owner', name: 'Fixture owner', source: 'dashboard' as const, locations: [KITCHEN] };
const provider = vi.fn<typeof fetch>();

function uberOrder(id = ORDER) {
  return {
    id, current_state: 'CREATED', store: { id: STORE }, placed_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    cart: { items: [{ id: 'fixture-item', title: 'Fixture dish', quantity: 1, price: { unit_price: { amount: 1200 } } }] },
    payment: { charges: { total: { amount: 1200, currency_code: 'CAD' } } },
  };
}

async function mappedStore() {
  return getRepo().upsertStore({
    channel: 'uber_eats', channelStoreId: STORE, brandName: 'Fixture brand', locationCode: KITCHEN,
    cloverMerchantId: MERCHANT, autoAccept: true, online: true,
    meta: { uberPos: { storeId: STORE, orderManager: 'foodhub', integrationEnabled: true, checkedAt: new Date().toISOString() } },
  });
}

function notification(event: string, eventId = 'evt-fixture-notice') {
  return {
    event_type: event, event_id: eventId, meta: { resource_id: ORDER, user_id: STORE },
    resource_href: `${UBER}/v2/eats/order/${ORDER}`,
  };
}

async function post(body: ReturnType<typeof notification>, beforeProcessing?: () => void) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', SIGNING_KEY).update(raw).digest('hex');
  const response = await signedUberWebhook(new NextRequest('http://hub.local/api/foodhub/webhooks/uber-eats', {
    method: 'POST', headers: { 'x-uber-signature': signature }, body: raw,
  }));
  beforeProcessing?.();
  for (const task of deferred.splice(0)) await task();
  return response;
}

const switchToClover = () => { vi.stubEnv('FOODHUB_VIA_CLOVER', 'uber_eats'); };

beforeEach(() => {
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_VIA_CLOVER: undefined, LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
    UBER_CLIENT_ID: 'synthetic-client', UBER_CLIENT_SECRET: 'synthetic-secret', UBER_ACCESS_TOKEN: 'synthetic-uber-token',
    UBER_BASE_URL: UBER, UBER_AUTH_URL: `${UBER}/oauth/v2/token`, UBER_WEBHOOK_SIGNING_KEY: SIGNING_KEY,
    FOODHUB_POS_INJECTION: 'on', FOODHUB_CLOVER_PLATFORM_ORDERS: 'on', CLOVER_BASE_URL: CLOVER,
    CLOVER_MERCHANT_ID: MERCHANT, CLOVER_ACCESS_TOKEN: 'synthetic-clover-token', FOODHUB_MEV: 'off',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  forgetUberTokenMemory();
  provider.mockReset().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === UBER && url.pathname === '/oauth/v2/token') return Response.json({ access_token: 'fixture-poll-token', expires_in: 3600 });
    if (url.origin === UBER && url.pathname.endsWith('/created-orders')) return Response.json({ orders: [uberOrder()] });
    if (url.origin === UBER && url.pathname.endsWith('/canceled-orders')) return Response.json({ orders: [{ id: ORDER }, { id: 'clover-fixture-native-order' }] });
    if (url.origin === UBER && url.pathname === `/v2/eats/order/${ORDER}`) return Response.json(uberOrder());
    if (url.origin === CLOVER && url.pathname.endsWith('/atomic_order/orders')) return Response.json({ id: 'fixture-pos-write', total: 1200 });
    if (url.origin === CLOVER && url.pathname.endsWith('/orders') && (init?.method ?? 'GET') === 'GET') {
      return Response.json({ elements: [{
        id: 'fixture-native-order', title: 'Uber Eats #NATIVE-1', total: 1200, currency: 'CAD', createdTime: Date.now() - 10 * 60_000,
        lineItems: { elements: [{ id: 'fixture-native-line', name: 'Fixture dish', price: 1200 }] },
      }] });
    }
    if (url.origin === CLOVER && (init?.method ?? 'GET') === 'GET') return Response.json({ elements: [] });
    throw new Error(`Unexpected synthetic provider request: ${url.origin}${url.pathname}`);
  });
  vi.stubGlobal('fetch', provider);
});

afterEach(() => {
  expect(deferred).toHaveLength(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Uber order intake in Clover mode', () => {
  it.each(['orders.notification', 'orders.scheduled.notification'])('preserves signed %s when Clover mode is active before processing', async (event) => {
    await mappedStore();
    const body = notification(event);
    const response = await post(body, switchToClover);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(provider.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([]);
    expect(await getInboxEntry(body.event_id)).toMatchObject({
      body, status: 'failed', nextAt: null,
      lastError: 'Uber Eats is linked through Clover. Check the order in Clover before replaying this notification.',
    });
    expect(await getRepo().findOrder('uber_eats', ORDER)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([undefined, 'relay'] as const)('retains already normalized queued Uber intake (%s) and blocks Replay', async (viaHub) => {
    await mappedStore();
    const order = parseUberOrder(uberOrder());
    if (!order) throw new Error('Synthetic order did not parse');
    const body = JSON.parse(JSON.stringify({ ...order, ...(viaHub ? { viaHub } : {}) }));
    const entry = await receiveWebhook({ channel: 'uber_eats', kind: 'order', body, reference: ORDER });
    switchToClover();

    const held = await runInboxEntry(entry.id);
    expect(provider.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([]);
    expect(held).toMatchObject({ body, status: 'failed', nextAt: null });
    const repo = getRepo();
    const save = vi.spyOn(repo, 'putDocs');
    const audit = vi.spyOn(repo, 'addActivity');
    expect(await replayInboxEntry(entry.id, OWNER)).toEqual(held);
    expect(save).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(await getRepo().findOrder('uber_eats', ORDER)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['done', 'refused'] as const)('preserves a historical %s entry that staff attempt to replay', async (status) => {
    await mappedStore();
    const body = notification('orders.notification');
    const entry = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body, reference: ORDER });
    const terminal = { ...entry, status, result: 'Historical intake outcome', nextAt: null };
    const repo = getRepo();
    await repo.putDocs(INBOX, [{ id: entry.id, key: status, at: entry.receivedAt, data: terminal }]);
    switchToClover();
    const save = vi.spyOn(repo, 'putDocs');
    const audit = vi.spyOn(repo, 'addActivity');

    expect(await replayInboxEntry(entry.id, OWNER)).toEqual(terminal);
    expect(await getInboxEntry(entry.id)).toEqual(terminal);
    expect(save).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('skips Uber missed-order polling even with previously confirmed direct mapping evidence', async () => {
    await mappedStore();
    switchToClover();
    const recovery = await recoverMissedUberOrders();
    expect(provider.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([]);
    expect(recovery).toEqual({ recovered: 0 });
    expect(await getRepo().findOrder('uber_eats', ORDER)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('reconciles a missed cancellation only for a pre-switch direct order while native intake remains read-only', async () => {
    await mappedStore();
    const input = parseUberOrder(uberOrder());
    if (!input) throw new Error('Synthetic order did not parse');
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...input, locationCode: KITCHEN });
    await repo.updateOrder(order.id, { status: 'ready' });
    switchToClover();
    expect(await importCloverPlatformOrders(MERCHANT)).toMatchObject({ imported: 1 });
    provider.mockClear();

    expect(await recoverMissedUberOrders()).toEqual({ recovered: 0, cancelled: 1 });
    expect(await repo.getOrder(order.id)).toMatchObject({ status: 'cancelled' });
    expect(await repo.findOrder('uber_eats', 'clover-fixture-native-order')).toMatchObject({ viaPos: 'clover', status: 'accepted' });
    const paths = provider.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.filter((path) => path !== '/oauth/v2/token')).toEqual([`/v1/eats/stores/${STORE}/canceled-orders`]);
  });

  it('still applies signed status and cancellation updates to pre-switch direct records', async () => {
    const store = await mappedStore();
    const input = parseUberOrder(uberOrder());
    if (!input) throw new Error('Synthetic order did not parse');
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...input, locationCode: KITCHEN });
    await repo.updateOrder(order.id, { status: 'ready' });
    switchToClover();

    const status = { ...notification('store.status.changed', 'evt-fixture-status'), meta: { resource_id: STORE, user_id: STORE, status: 'PAUSED' } };
    expect((await post(status)).status).toBe(200);
    expect(await repo.getStore(store.id)).toMatchObject({ online: false });
    expect((await post(notification('orders.cancel', 'evt-fixture-cancel'))).status).toBe(200);
    expect(await repo.getOrder(order.id)).toMatchObject({ status: 'cancelled', timeline: { cancelledBy: 'platform' } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('still reads a native Clover order for the mapped kitchen without provider writes', async () => {
    await mappedStore();
    switchToClover();
    expect(await importCloverPlatformOrders(MERCHANT)).toMatchObject({ imported: 1, posOrderIds: ['fixture-native-order'] });
    expect(await getRepo().findOrder('uber_eats', 'clover-fixture-native-order')).toMatchObject({
      viaPos: 'clover', posOrderId: 'fixture-native-order', locationCode: KITCHEN,
    });
    expect(provider.mock.calls.every(([url, init]) => new URL(String(url)).origin === CLOVER && (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});
