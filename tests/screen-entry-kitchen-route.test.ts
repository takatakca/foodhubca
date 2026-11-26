import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../app/api/foodhub/screens/[id]/entry/route';
import { hashPassword } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { _resetOrderTypeCache } from '../lib/foodhub/pos/clover-order';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen } from '../lib/foodhub/screens';

const CLOVER = 'https://clover.example.test';
const ORIGINAL_MERCHANT = 'TESTMERCH0001';
const DESTINATION_MERCHANT = 'TESTMERCH0002';
const ORIGINAL_KITCHEN = 'TEST_KITCHEN_A';
const DESTINATION_KITCHEN = 'TEST_KITCHEN_B';
const CHANNEL_STORE_ID = 'synthetic-uber-store';
const PASSWORD = 'test-kitchen-entry-password';
const MANAGER = 'synthetic-kitchen-manager';
const fetchMock = vi.fn<typeof fetch>();

const originalMapping = {
  channel: 'uber_eats', channelStoreId: CHANNEL_STORE_ID, brandName: 'Synthetic original brand', locationCode: ORIGINAL_KITCHEN,
  cloverMerchantId: ORIGINAL_MERCHANT, autoAccept: false, online: true, meta: {},
} as const;

function submit(screenId: string) {
  return POST(new Request(`https://foodhub.example.test/api/foodhub/screens/${screenId}/entry`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${MANAGER}:${PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channelStoreId: CHANNEL_STORE_ID, orderCode: 'A1234', fulfillment: 'delivery', lines: [{ name: 'Synthetic item', unitPrice: 10, quantity: 1 }] }),
  }), { params: Promise.resolve({ id: screenId }) });
}

function expectRecordedAt(merchant: string) {
  const prefix = `/v3/merchants/${merchant}/`;
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([input]) => new URL(String(input)).pathname);
  expect(posts).toEqual(expect.arrayContaining([
    `${prefix}atomic_order/orders`, `${prefix}print_event`, `${prefix}orders/TEST_ORDER/payments`,
  ]));
  expect(posts.every((path) => path.startsWith(prefix))).toBe(true);
}

async function prepareScreen() {
  const repo = getRepo();
  await saveLocation({ code: ORIGINAL_KITCHEN, name: 'Original test kitchen', address: '', province: 'QC', active: true });
  await saveLocation({ code: DESTINATION_KITCHEN, name: 'Destination test kitchen', address: '', province: 'QC', active: true });
  await repo.saveUser({ username: MANAGER, name: 'Test manager', role: 'manager', locations: [ORIGINAL_KITCHEN], active: true, passwordHash: hashPassword(PASSWORD) });
  const store = await repo.upsertStore(originalMapping);
  const screen = await addScreen({ platform: 'ubereats', name: 'Test order screen', locationCode: ORIGINAL_KITCHEN, viewUrl: 'https://relay.example.test/s01/', storeIds: [CHANNEL_STORE_ID] }, { username: 'owner', name: 'Test owner', source: 'dashboard' });
  if ('error' in screen) throw new Error(screen.error);
  return { store, screen };
}

beforeEach(() => {
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_POS_INJECTION: 'on', FOODHUB_CLOVER_AUTOPRINT: 'on', FOODHUB_RETRY_TIMER: 'off',
    LIVE_CONNECTORS_GLOBAL_ENABLED: 'false', FOODHUB_VIA_CLOVER: '', FOODHUB_SCREENS_VIEW_HOSTS: 'relay.example.test',
    DASHBOARD_PASSWORD: 'test-kitchen-entry-owner-password', SESSION_SECRET: 'test-kitchen-entry-session-secret',
    CLOVER_BASE_URL: CLOVER, CLOVER_MERCHANT_ID: ORIGINAL_MERCHANT, CLOVER_ACCESS_TOKEN: 'synthetic-first-token',
    CLOVER_MERCHANT_TOKENS: JSON.stringify({ [DESTINATION_MERCHANT]: 'synthetic-second-token' }),
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.stubEnv('CLOVER_CLIENT_ID', undefined);
  vi.stubGlobal('__foodhubMem', undefined);
  _resetOrderTypeCache();
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.origin !== CLOVER) throw new Error('Unexpected provider request');
    const path = url.pathname;
    if (path.endsWith('/order_types')) return Response.json({ elements: [{ id: 'TEST_TYPE', label: 'Online Order Delivery' }] });
    if (path.endsWith('/atomic_order/orders')) return Response.json({ id: 'TEST_ORDER', total: 1150 });
    if (path.endsWith('/print_event')) return Response.json({ id: 'TEST_PRINT', state: 'CREATED' });
    if (path.endsWith('/tenders')) return Response.json({ elements: [{ id: 'TEST_TENDER', label: 'Uber Eats' }] });
    if (path.endsWith('/payments')) return Response.json({ id: 'TEST_PAYMENT' });
    if (path.endsWith('/orders/TEST_ORDER')) return Response.json({ id: 'TEST_ORDER', total: 1150 });
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const changes = [
  { change: 'moves to a different kitchen', apply: (id: string) => getRepo().updateStore(id, { locationCode: DESTINATION_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT }) },
  { change: 'changes Clover destination in the same kitchen', apply: (id: string) => getRepo().updateStore(id, { cloverMerchantId: DESTINATION_MERCHANT }) },
  { change: 'changes the brand', apply: (id: string) => getRepo().updateStore(id, { brandName: 'Synthetic replacement brand' }) },
  { change: 'is removed', apply: (id: string) => getRepo().deleteStore(id) },
  { change: 'is recreated with a new mapping identity', apply: async (id: string) => {
    const repo = getRepo();
    await repo.deleteStore(id);
    await repo.upsertStore(originalMapping);
  } },
];

it.each(changes)('returns 409 without saving or sending if the selected mapping $change during entry', async ({ apply }) => {
  const { store, screen } = await prepareScreen();
  const repo = getRepo();
  const findOrder = repo.findOrder.bind(repo);
  // Model an owner changing the mapping after the route has selected the originally authorized store.
  vi.spyOn(repo, 'findOrder').mockImplementationOnce(async (...args) => {
    await apply(store.id);
    return findOrder(...args);
  });

  const response = await submit(screen.id);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('Store mapping changed') });
  expect(await repo.listOrders({})).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('saves, pays and prints an authorized entry when its chosen mapping stays current', async () => {
  const { screen } = await prepareScreen();
  const response = await submit(screen.id);
  expect(response.status).toBe(200);
  const status = await response.json();
  expect(status).toMatchObject({ ok: true, inClover: true, paid: true, printed: true });
  expect(await getRepo().getOrder(status.orderId)).toMatchObject({ channelStoreId: CHANNEL_STORE_ID, locationCode: ORIGINAL_KITCHEN, posOrderId: 'TEST_ORDER' });
  expectRecordedAt(ORIGINAL_MERCHANT);
});

it('settles the entry on the original register if the store moves while Clover is creating the order', async () => {
  const { store, screen } = await prepareScreen();
  const respond = fetchMock.getMockImplementation();
  if (!respond) throw new Error('Expected Clover fixture');
  fetchMock.mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/atomic_order/orders')) {
      await getRepo().updateStore(store.id, { locationCode: DESTINATION_KITCHEN, cloverMerchantId: DESTINATION_MERCHANT });
    }
    return respond(input, init);
  });

  const response = await submit(screen.id);
  expect(response.status).toBe(200);
  const status = await response.json();
  expect(status).toMatchObject({ ok: true, inClover: true, paid: true, printed: true });
  expect(await getRepo().getOrder(status.orderId)).toMatchObject({ locationCode: ORIGINAL_KITCHEN, posOrderId: 'TEST_ORDER' });
  expectRecordedAt(ORIGINAL_MERCHANT);
});
