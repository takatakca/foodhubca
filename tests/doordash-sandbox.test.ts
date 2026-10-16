// DoorDash sandbox-safe mode (lib/foodhub/doordash/sandbox.ts): sandbox webhooks reach production Food Hub without any
// effect on real operations. HTTP is mocked: nothing reaches DoorDash or Clover.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDashAdapter, fetchDoorDashStoreStatus } from '../lib/foodhub/adapters/doordash';
import { doorDashStoreRefusal } from '../lib/foodhub/doordash/guard';
import { setDoorDashSleep } from '../lib/foodhub/doordash/retry';
import {
  SANDBOX_STATE_KEY, doorDashIntegrationIsSandbox, doorDashSandboxActive, doorDashSandboxReason, doorDashSandboxReasonSync, doorDashSandboxStatus,
  doorDashSandboxStoreIds, readSandboxState, writeSandboxConfig,
} from '../lib/foodhub/doordash/sandbox';
import { pushSandboxMenu, runSandboxOrderAction, setSandboxItem, setSandboxStoreOnline } from '../lib/foodhub/doordash/sandbox-ops';
import { getRepo } from '../lib/foodhub/repo';
import { handleDoorDashWebhook } from '../lib/foodhub/webhooks/doordash';
import { listIncidents, runWatch } from '../lib/foodhub/watch/engine';
import type { ChannelStore, MasterMenu } from '../lib/foodhub/types';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { host: string; method: string; path: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    let body: any = null;
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = init.body; }
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ host: url.hostname, method, path: url.pathname, body, headers: { ...(init.headers as Record<string, string> | undefined) } });
    if (url.hostname === 'api.clover.test') {
      if (url.pathname.endsWith('/order_types')) return json({ elements: [] });
      if (url.pathname.endsWith('/atomic_order/orders')) return json({ id: 'CLV1', total: 3450 });
      if (url.pathname.endsWith('/print_event')) return json({ id: 'PE1', state: 'CREATED' });
      return json({ elements: [] });
    }
    if (url.pathname.includes('/store_details')) return json({ is_active: true });
    return json({});
  }));
}
const doordashCalls = () => calls.filter((c) => c.host === 'openapi.doordash.com');
const cloverCalls = () => calls.filter((c) => c.host === 'api.clover.test');

const ENV = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'DOORDASH_ENV', 'DOORDASH_SANDBOX_STORE_IDS',
  'DOORDASH_MERCHANT_CANCEL', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'FOODHUB_FORCE_MEMORY', 'FOODHUB_RETRY_TIMER', 'CLOVER_BASE_URL', 'CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN',
  'FOODHUB_MENU_LOCKED_STORES', 'FOODHUB_VIA_CLOVER', 'CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'CLOVER_CLIENT_ID'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_RETRY_TIMER: 'off', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
    DOORDASH_DEVELOPER_ID: 'dev', DOORDASH_KEY_ID: 'kid', DOORDASH_SIGNING_SECRET: 'c2VjcmV0', DOORDASH_PROVIDER_TYPE: 'takatak_test', DOORDASH_WEBHOOK_SECRET: 'dd-secret',
    CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: 'TESTMERCH0001', CLOVER_ACCESS_TOKEN: 'clover-token',
  });
  (globalThis as any).__foodhubMem = undefined;
  setDoorDashSleep(async () => undefined);
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDoorDashSleep();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const sandboxOn = (extra: Record<string, string> = {}) => Object.assign(process.env, { DOORDASH_ENV: 'sandbox', DOORDASH_PROVIDER_TYPE: 'p0000000000_sandbox', DOORDASH_SANDBOX_STORE_IDS: 'sbx-1', ...extra });

const ddOrder = (over: Record<string, unknown> = {}, store = 'sbx-1') => ({
  order: {
    id: 'dd-test-1', delivery_short_code: 'T1', store: { merchant_supplied_id: store }, consumer: { first_name: 'Test', last_name: 'Customer' }, subtotal: 3000, tax: 450, fulfillment_type: 'pickup',
    categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'Poutine', price: 1500, quantity: 2, line_item_id: 'li-1' }] }], ...over,
  },
});

const menu: MasterMenu = {
  brandName: 'Pi Pita', categories: [{ ref: 'CAT', name: 'Pitas', sortOrder: 0 }],
  items: [{ ref: 'i1', name: 'Pita poulet', price: 12.5, categoryRef: 'CAT', available: true, modifierGroupRefs: [] }],
  modifierGroups: [], updatedAt: new Date().toISOString(),
} as unknown as MasterMenu;

const realStore = async (): Promise<ChannelStore> => getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-real', brandName: 'Pi Pita', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: {} });

describe('detection', () => {
  it('is off without the new settings, and a real payload is never sandbox', async () => {
    expect(doorDashIntegrationIsSandbox()).toBe(false);
    expect(doorDashSandboxActive()).toBe(false);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'dd-real'))).toBeNull();
    expect(await doorDashSandboxReason(ddOrder({}, 'dd-real'))).toBeNull();
  });

  it('DOORDASH_ENV=sandbox, or a provider type ending with _sandbox, makes the whole integration sandbox', () => {
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: 'sandbox' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: ' Sandbox ' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: 'production', DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: 'production', DOORDASH_PROVIDER_TYPE: 'p1234' })).toBe(false);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'anything'), { DOORDASH_ENV: 'sandbox' })).toMatch(/DOORDASH_ENV/);
  });

  it('a listed test store (location id or DoorDash store id) is sandbox; other stores stay real', () => {
    const env = { DOORDASH_SANDBOX_STORE_IDS: 'sbx-1, 998877' };
    expect(doorDashSandboxReasonSync(ddOrder({}, 'sbx-1'), env)).toMatch(/test store sbx-1/);
    expect(doorDashSandboxReasonSync({ order: { ...ddOrder({}, 'x').order, store: { merchant_supplied_id: 'x', id: 998877 } } }, env)).toMatch(/998877/);
    expect(doorDashSandboxReasonSync({ external_order_id: 'o', store: { merchant_supplied_id: 'sbx-1' } }, env)).toMatch(/sbx-1/);
    expect(doorDashSandboxReasonSync({ event: { type: 'MenuCreate', reference: 'takatak-sbx-1-1700000000000' }, menu: { id: 'm' } }, env)).toMatch(/sbx-1/);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'dd-real'), env)).toBeNull();
  });

  it('a payload marked with a _sandbox provider_type, or our test client_order_id, is sandbox even without settings', () => {
    expect(doorDashSandboxReasonSync({ external_order_id: 'o', store: { merchant_supplied_id: 'x', provider_type: 'p1_sandbox' } }, {})).toMatch(/provider_type/);
    expect(doorDashSandboxReasonSync({ external_order_id: 'o', client_order_id: 'takatak-test-abc' }, {})).toMatch(/client_order_id/);
  });

  it('Po Poulet NDG (27982486) can never be a test store', () => {
    expect(doorDashSandboxStoreIds({ DOORDASH_SANDBOX_STORE_IDS: '27982486,sbx-1' })).toEqual(['sbx-1']);
    expect(doorDashSandboxStatus({ DOORDASH_SANDBOX_STORE_IDS: '27982486' }).warnings.join(' ')).toMatch(/protected/);
  });
});

describe('a sandbox order: saved as TEST, DoorDash flow as for real, nothing else', () => {
  it('never reaches Clover, the orders table, the activity feed or Watchtower; it is confirmed on DoorDash', async () => {
    sandboxOn();
    await getRepo().saveMenu(menu);
    const out = await handleDoorDashWebhook(ddOrder());
    expect(out.result).toMatch(/sandbox test order received — not sent to Clover/);
    // No order row: no kitchen screen, no ring, no print, no report, no money.
    expect(await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 50 })).toEqual([]);
    expect(cloverCalls()).toEqual([]);
    expect(await getRepo().listActivity({})).toEqual([]);
    // Confirmed on DoorDash exactly like a real order: PATCH /api/v1/orders/{id}, success, prep_time, our merchant_supplied_id.
    const confirm = doordashCalls().find((c) => c.method === 'PATCH' && c.path === '/marketplace/api/v1/orders/dd-test-1');
    expect(confirm?.body).toMatchObject({ order_status: 'success' });
    expect(String(confirm?.body.merchant_supplied_id)).toMatch(/^takatak-test-/);
    expect(Date.parse(confirm?.body.prep_time)).toBeGreaterThan(Date.now());
    const state = await readSandboxState();
    expect(state.orders[0]).toMatchObject({ id: 'dd-test-1', status: 'confirmed', storeId: 'sbx-1' });
    // Watchtower, run later, raises nothing about it.
    await runWatch({ force: true, now: Date.now() + 30 * 60_000 });
    expect((await listIncidents()).filter((i) => i.orderId || i.channel === 'doordash')).toEqual([]);
  });

  it('control: the same order from an unknown real store does raise a Watchtower incident (the check above is not empty)', async () => {
    await handleDoorDashWebhook(ddOrder({}, 'dd-unmapped'));
    await runWatch({ force: true, now: Date.now() + 30 * 60_000 });
    expect((await listIncidents()).filter((i) => i.orderId || i.channel === 'doordash').length).toBeGreaterThan(0);
  });

  it('a second delivery is a duplicate; with auto-confirm off the order waits for Confirm / Reject', async () => {
    sandboxOn();
    await writeSandboxConfig({ autoConfirm: false });
    await handleDoorDashWebhook(ddOrder());
    expect(doordashCalls()).toEqual([]);
    expect((await handleDoorDashWebhook(ddOrder())).result).toMatch(/duplicate/);
    const rej = await runSandboxOrderAction('dd-test-1', 'reject', { reasonCode: 'out_of_stock', details: 'Poutine' });
    expect(rej.ok).toBe(true);
    expect(doordashCalls()[0].body).toMatchObject({ order_status: 'fail', errors: [{ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i1' }] });
    expect((await readSandboxState()).orders[0].status).toBe('failed');
  });

  it('ready and merchant cancel use the real DoorDash endpoints; DoorDash cancellations and Dasher updates follow the test order', async () => {
    sandboxOn({ DOORDASH_MERCHANT_CANCEL: 'true' });
    await handleDoorDashWebhook(ddOrder());
    const ready = await runSandboxOrderAction('dd-test-1', 'ready');
    expect(ready.ok).toBe(true);
    expect(doordashCalls().some((c) => c.path === '/marketplace/api/v1/orders/dd-test-1/events/order_ready_for_pickup')).toBe(true);
    await handleDoorDashWebhook({ event: { type: 'dasher_status_update' }, delivery: { external_order_id: 'dd-test-1', dasher_status: 'dasher_confirmed', dasher: { first_name: 'Sam' } } });
    expect((await readSandboxState()).orders[0].courier).toBe('assigned');
    const cancel = await runSandboxOrderAction('dd-test-1', 'cancel', { reasonCode: 'too_busy' });
    expect(cancel.ok).toBe(true);
    expect(doordashCalls().find((c) => c.path.endsWith('/cancellation'))?.body).toMatchObject({ cancel_reason: 'KITCHEN_BUSY' });
    expect(await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 50 })).toEqual([]);
  });

  it('a DoorDash cancellation that arrives before the order: the order is never confirmed', async () => {
    sandboxOn();
    await handleDoorDashWebhook({ external_order_id: 'dd-test-1', client_order_id: '', store: { merchant_supplied_id: 'sbx-1' }, is_asap: true });
    const out = await handleDoorDashWebhook(ddOrder());
    expect(out.result).toMatch(/cancelled before it arrived/);
    expect(doordashCalls()).toEqual([]);
    expect((await readSandboxState()).orders.filter((o) => o.id === 'dd-test-1').map((o) => o.status)).toEqual(['cancelled']);
  });

  it('a webhook naming Po Poulet NDG is ignored even in sandbox mode: nothing sent', async () => {
    sandboxOn();
    const out = await handleDoorDashWebhook(ddOrder({}, '27982486'));
    expect(out.result).toMatch(/protected store/);
    expect(doordashCalls()).toEqual([]);
    expect((await readSandboxState()).orders).toEqual([]);
  });

  it('test stores listed but a production integration: only the test store is sandbox, a real store order goes the usual way', async () => {
    process.env.DOORDASH_SANDBOX_STORE_IDS = 'sbx-1';
    await realStore();
    await handleDoorDashWebhook(ddOrder());
    expect(await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 50 })).toEqual([]);
    await handleDoorDashWebhook(ddOrder({ id: 'dd-real-1' }, 'dd-real'));
    const real = await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 50 });
    expect(real.map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
    expect(cloverCalls().some((c) => c.path.endsWith('/atomic_order/orders'))).toBe(true);
    // A DoorDash cancel naming the test order (by our client_order_id) is still recognised as a test.
    const sbx = (await readSandboxState()).orders[0];
    expect(await doorDashSandboxReason({ external_order_id: '', client_order_id: sbx.clientOrderId })).toBeTruthy();
  });
});

describe('the test store: menu, items, open / closed — and never a real store', () => {
  it('menu push, 86 and pause go to the test store with the real payloads', async () => {
    sandboxOn();
    await getRepo().saveMenu(menu);
    await writeSandboxConfig({ brandName: 'Pi Pita', locationCode: 'NDG_6284' });
    const pushed = await pushSandboxMenu('sbx-1');
    expect(pushed.ok).toBe(true);
    const post = doordashCalls().find((c) => c.method === 'POST' && c.path === '/marketplace/api/v1/menus');
    expect(post?.body.store).toMatchObject({ merchant_supplied_id: 'sbx-1', provider_type: 'p0000000000_sandbox' });
    expect(JSON.stringify(post?.body)).toMatch(/Pita poulet/);
    expect((await setSandboxItem('sbx-1', 'i1', false)).ok).toBe(true);
    expect(doordashCalls().some((c) => c.method === 'PUT' && c.path === '/marketplace/api/v1/stores/sbx-1/items/status')).toBe(true);
    expect((await setSandboxStoreOnline('sbx-1', false)).ok).toBe(true);
    expect((await readSandboxState()).paused['sbx-1']).toBe(true);
    // The Menu Status webhook keeps DoorDash's menu id for the test store (the next push is a PATCH).
    await handleDoorDashWebhook({ event: { type: 'MenuCreate', status: 'SUCCESS', reference: post?.body.reference }, menu: { id: 'menu-sbx' } });
    expect((await readSandboxState()).menuIds['sbx-1']).toBe('menu-sbx');
    await pushSandboxMenu('sbx-1');
    expect(doordashCalls().some((c) => c.method === 'PATCH' && c.path === '/marketplace/api/v1/menus/menu-sbx')).toBe(true);
    // Nothing went to the stores table.
    expect(await getRepo().listStores('doordash')).toEqual([]);
  });

  it('with a sandbox integration, a real store gets no menu, no 86, no pause, no status read', async () => {
    sandboxOn();
    const store = await realStore();
    const results = [await doorDashAdapter.publishMenu(store, menu), await doorDashAdapter.setItemAvailability(store, ['i1'], false), await doorDashAdapter.setStoreOnline(store, false)];
    expect(results.map((r) => r.status)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(results[0].message).toMatch(/sandbox mode/);
    expect(await fetchDoorDashStoreStatus('dd-real')).toMatchObject({ ok: false, state: 'unknown' });
    expect(doorDashStoreRefusal(store, 'read')).toMatch(/sandbox mode/);
    expect(doorDashStoreRefusal({ channelStoreId: 'sbx-1', meta: {} }, 'menu')).toBeNull();
    expect(doordashCalls()).toEqual([]);
  });

  it('without the new settings, a real store is changed exactly as before', async () => {
    const store = await realStore();
    expect((await doorDashAdapter.setStoreOnline(store, false)).ok).toBe(true);
    expect(await fetchDoorDashStoreStatus('dd-real')).toMatchObject({ ok: true, state: 'online' });
    expect(doorDashStoreRefusal(store, 'write')).toBeNull();
    expect(doordashCalls().map((c) => c.path)).toEqual(['/marketplace/api/v1/stores/dd-real/status', '/marketplace/api/v1/stores/dd-real/store_details']);
  });
});

describe('webhook routes: authentication unchanged, answers unchanged', () => {
  const post = async (body: unknown, auth = 'dd-secret') => {
    const { POST } = await import('../app/api/foodhub/webhooks/doordash/route');
    return POST(new Request('http://hub.local/api/foodhub/webhooks/doordash', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);
  };
  const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 100 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10)); };

  it('sandbox mode never weakens the Authorization check', async () => {
    sandboxOn();
    expect((await post(ddOrder(), 'wrong')).status).toBe(401);
    expect((await post(ddOrder(), '')).status).toBe(401);
    delete process.env.DOORDASH_WEBHOOK_SECRET;
    expect((await post(ddOrder(), 'dd-secret')).status).toBe(401);
    expect(await getRepo().getKv(SANDBOX_STATE_KEY)).toBeNull();
  });

  it('a sandbox Order Create is answered 202 (confirmed later) and lands in the test list only', async () => {
    sandboxOn();
    expect((await post(ddOrder())).status).toBe(202);
    await waitFor(async () => (await readSandboxState()).orders.some((o) => o.status === 'confirmed'));
    expect((await readSandboxState()).orders[0]).toMatchObject({ id: 'dd-test-1', status: 'confirmed' });
    expect(await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 50 })).toEqual([]);
    expect(cloverCalls()).toEqual([]);
  });

  it('without the new settings an order goes to the kitchen as today, and nothing is written to the test list', async () => {
    await realStore();
    expect((await post(ddOrder({ id: 'dd-real-1' }, 'dd-real'))).status).toBe(202);
    await waitFor(async () => (await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 5 })).length > 0);
    const orders = await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 5 });
    expect(orders.map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
    expect(await getRepo().getKv(SANDBOX_STATE_KEY)).toBeNull();
  });

  it('menu pull: the test store is answered from the chosen brand; auth still required', async () => {
    sandboxOn();
    await getRepo().saveMenu(menu);
    await writeSandboxConfig({ brandName: 'Pi Pita', locationCode: 'NDG_6284' });
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/[locationId]/route');
    const get = (id: string, auth = 'dd-secret') => GET(new Request(`http://hub.local/api/foodhub/webhooks/doordash/${id}`, { headers: { authorization: auth } }) as never, { params: Promise.resolve({ locationId: id }) });
    expect((await get('sbx-1', 'nope')).status).toBe(401);
    const res = await get('sbx-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toMatchObject({ merchant_supplied_id: 'sbx-1' });
    expect(JSON.stringify(body.menus)).toMatch(/Pita poulet/);
    expect((await readSandboxState()).log.some((l) => l.kind === 'menu_pull' && l.ok)).toBe(true);
    // Sandbox credentials: a real store, and the protected store, are refused (409), never answered from the sandbox brand.
    expect((await get('27982486')).status).toBe(409);
    await realStore();
    const real = await get('dd-real');
    expect(real.status).toBe(409);
    expect(JSON.stringify(await real.json())).toMatch(/sandbox mode/);
  });
});
