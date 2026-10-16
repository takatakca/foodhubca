// DoorDash sandbox-safe mode (lib/foodhub/doordash/sandbox.ts): sandbox webhooks reach production Food Hub without any
// effect on real operations. HTTP is mocked: nothing reaches DoorDash or Clover.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDashAdapter, fetchDoorDashStoreStatus } from '../lib/foodhub/adapters/doordash';
import { doorDashStoreRefusal } from '../lib/foodhub/doordash/guard';
import { refreshDoorDashReport, requestDoorDashReport, REPORT_REQUESTS } from '../lib/foodhub/doordash/reports';
import { setRetailFulfillmentCapacity } from '../lib/foodhub/doordash/retail';
import { setDoorDashStoreStatus } from '../lib/foodhub/doordash/stores';
import { validateDoorDashCart } from '../lib/foodhub/doordash/ocv';
import { INBOX, getInboxEntry, receiveWebhook, runInboxEntry, type InboxEntry } from '../lib/foodhub/inbox';
import { setDoorDashSleep } from '../lib/foodhub/doordash/retry';
import {
  SANDBOX_STATE_KEY, doorDashIntegrationIsSandbox, doorDashSandboxActive, doorDashSandboxReason, doorDashSandboxReasonSync, doorDashSandboxStatus,
  doorDashSandboxStoreIds, isDoorDashTestStore, readSandboxState, writeSandboxConfig,
} from '../lib/foodhub/doordash/sandbox';
import { clearSandboxTests, pushSandboxMenu, runSandboxOrderAction, setSandboxItem, setSandboxStoreOnline } from '../lib/foodhub/doordash/sandbox-ops';
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
  'FOODHUB_MENU_LOCKED_STORES', 'FOODHUB_VIA_CLOVER', 'CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'CLOVER_CLIENT_ID', 'DOORDASH_SANDBOX_WEBHOOK_SECRET', 'DASHBOARD_PASSWORD',
  'DOORDASH_REPORTS_DEVELOPER_ID', 'DOORDASH_REPORTS_KEY_ID', 'DOORDASH_REPORTS_SIGNING_SECRET'];
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

/** Watchtower incident keys that appear because of `act` (a baseline run first, both at the same clock). */
async function newIncidentKeys(act: () => Promise<unknown>): Promise<string[]> {
  const at = Date.now() + 30 * 60_000;
  await runWatch({ force: true, now: at });
  const before = new Set((await listIncidents()).map((i) => i.key));
  await act();
  await runWatch({ force: true, now: at });
  return (await listIncidents()).map((i) => i.key).filter((k) => !before.has(k));
}

const realStore = async (): Promise<ChannelStore> => getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-real', brandName: 'Pi Pita', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: {} });

describe('detection', () => {
  it('is off without the new settings, and a real payload is never sandbox', async () => {
    expect(doorDashIntegrationIsSandbox()).toBe(false);
    expect(doorDashSandboxActive()).toBe(false);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'dd-real'))).toBeNull();
    expect(await doorDashSandboxReason(ddOrder({}, 'dd-real'))).toBeNull();
  });

  it('only DOORDASH_ENV=sandbox makes the whole integration sandbox; a _sandbox provider type alone only warns', () => {
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: 'sandbox' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: ' Sandbox ' })).toBe(true);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBe(false);
    expect(doorDashIntegrationIsSandbox({ DOORDASH_ENV: 'production', DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBe(false);
    expect(doorDashSandboxActive({ DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBe(false);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'anything'), { DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' })).toBeNull();
    expect(doorDashSandboxStatus({ DOORDASH_PROVIDER_TYPE: 'p1234_sandbox' }).warnings.join(' ')).toMatch(/treated as REAL orders/);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'anything'), { DOORDASH_ENV: 'sandbox' })).toMatch(/DOORDASH_ENV/);
  });

  it('env absent + a _sandbox DOORDASH_PROVIDER_TYPE: a real DoorDash order still goes to the kitchen and Clover', async () => {
    process.env.DOORDASH_PROVIDER_TYPE = 'p1234_sandbox';
    await realStore();
    const out = await handleDoorDashWebhook(ddOrder({ id: 'dd-real-1' }, 'dd-real'));
    expect(out.result).not.toMatch(/sandbox/);
    expect((await getRepo().listOrders({ since: new Date(Date.now() - 86400_000).toISOString(), limit: 5 })).map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
    expect(cloverCalls().some((c) => c.path.endsWith('/atomic_order/orders'))).toBe(true);
    expect(await getRepo().getKv(SANDBOX_STATE_KEY)).toBeNull();
  });

  it('a listed test store (location id or DoorDash store id) is sandbox; other stores stay real', () => {
    const env = { DOORDASH_SANDBOX_STORE_IDS: 'sbx-1, 998877' };
    expect(doorDashSandboxReasonSync(ddOrder({}, 'sbx-1'), env)).toMatch(/test store sbx-1/);
    expect(doorDashSandboxReasonSync({ order: { ...ddOrder({}, 'x').order, store: { merchant_supplied_id: 'x', id: 998877 } } }, env)).toMatch(/998877/);
    expect(doorDashSandboxReasonSync({ external_order_id: 'o', store: { merchant_supplied_id: 'sbx-1' } }, env)).toMatch(/sbx-1/);
    expect(doorDashSandboxReasonSync({ event: { type: 'MenuCreate', reference: 'takatak-sbx-1-1700000000000' }, menu: { id: 'm' } }, env)).toMatch(/sbx-1/);
    expect(doorDashSandboxReasonSync(ddOrder({}, 'dd-real'), env)).toBeNull();
  });

  it('a payload marked with a _sandbox provider_type is sandbox only while the mode is set up; our test client_order_id always', () => {
    const marked = { external_order_id: 'o', store: { merchant_supplied_id: 'x', provider_type: 'p1_sandbox' } };
    expect(doorDashSandboxReasonSync(marked, {})).toBeNull();
    expect(doorDashSandboxReasonSync(marked, { DOORDASH_SANDBOX_STORE_IDS: 'sbx-1' })).toMatch(/provider_type/);
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
    // Watchtower, run later, raises nothing about it: no incident at all beyond what an empty Food Hub already has.
    expect(await newIncidentKeys(() => Promise.resolve())).toEqual([]);
  });

  it('control: the same order from an unknown real store does raise a Watchtower incident (the check above is not empty)', async () => {
    expect((await newIncidentKeys(() => handleDoorDashWebhook(ddOrder({}, 'dd-unmapped')))).length).toBeGreaterThan(0);
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
    expect(JSON.stringify(await real.json())).toMatch(/sandbox request/);
  });
});

// ------------------------------------------------------------------------------------------- review fixes

const OWNER = `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`;
const since = () => new Date(Date.now() - 86400_000).toISOString();
const inboxEntries = async () => (await getRepo().listDocs<InboxEntry>(INBOX, { limit: 50 })).map((d) => d.data);
const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10)); };
const postWebhook = async (body: unknown, auth = 'dd-secret') => {
  const { POST } = await import('../app/api/foodhub/webhooks/doordash/route');
  return POST(new Request('http://hub.local/api/foodhub/webhooks/doordash', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);
};
const settle = async () => {
  await waitFor(async () => (await inboxEntries()).every((e) => e.status === 'done' || e.status === 'failed'));
};

describe('the sandbox decision is taken when the webhook arrives (inbox tag)', () => {
  it('a Replay after DOORDASH_ENV was removed stays a test: no orders row, no Clover call', async () => {
    sandboxOn();
    expect((await postWebhook(ddOrder())).status).toBe(202);
    await settle();
    const [entry] = await inboxEntries();
    expect(entry.sandbox).toMatch(/DOORDASH_ENV/);
    expect(entry.status).toBe('done');
    // Back to production settings (docs step 6), then a person replays the old entry.
    delete process.env.DOORDASH_ENV; delete process.env.DOORDASH_SANDBOX_STORE_IDS; process.env.DOORDASH_PROVIDER_TYPE = 'takatak_test';
    calls.length = 0;
    const replayed = await runInboxEntry(entry.id, { replayBy: 'Owner' });
    expect(replayed?.status).toBe('done');
    expect(replayed?.result).toMatch(/sandbox/);
    expect(await getRepo().listOrders({ since: since(), limit: 50 })).toEqual([]);
    expect(cloverCalls()).toEqual([]);
  });

  it('an entry tagged at arrival but first processed after the env changed (recovery runner) is still a test', async () => {
    await realStore();
    // Saved while sandbox (tag), interrupted before processing; the env is production by the time it runs.
    const e = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body: ddOrder({ id: 'dd-sbx-7' }, 'dd-real'), reference: 'dd-sbx-7', sandbox: 'DOORDASH_ENV=sandbox' });
    const out = await runInboxEntry(e.id);
    expect(out?.status).toBe('done');
    expect(out?.result).toMatch(/sandbox test order/);
    expect((await readSandboxState()).orders.map((o) => o.id)).toEqual(['dd-sbx-7']);
    expect(await getRepo().listOrders({ since: since(), limit: 50 })).toEqual([]);
    expect(cloverCalls()).toEqual([]);
  });

  it('a later DoorDash event about a test order stays a test after the env changed and the test list was emptied', async () => {
    sandboxOn();
    await handleDoorDashWebhook(ddOrder());
    await clearSandboxTests();
    delete process.env.DOORDASH_ENV; delete process.env.DOORDASH_SANDBOX_STORE_IDS;
    expect(await doorDashSandboxReason({ event: { type: 'dasher_status_update' }, delivery: { external_order_id: 'dd-test-1', dasher_status: 'dasher_confirmed' } })).toMatch(/dd-test-1/);
    const out = await handleDoorDashWebhook({ external_order_id: 'dd-test-1', client_order_id: '', store: { merchant_supplied_id: 'sbx-1' }, is_asap: true });
    expect(out.result).toMatch(/sandbox/);
    expect((await getRepo().listJobs()).filter((j) => j.kind === 'webhook_unparsed')).toEqual([]);
  });

  it('the answer-window cutoff never hands a sandbox order to a person (no failure, no activity, no Watchtower incident)', async () => {
    sandboxOn();
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    const body = ddOrder({ created_at: old });
    const keys = await newIncidentKeys(async () => {
      // Tagged at arrival (as the route does), arriving 5 minutes after DoorDash created it (a resend).
      const tagged = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body, reference: 'dd-test-1', sandbox: 'DOORDASH_ENV=sandbox', receivedAt: old });
      expect((await runInboxEntry(tagged.id))?.status).toBe('done');
      // Untagged (saved before this version, or tag lost): detected at processing time, still never cut off.
      await clearSandboxTests();
      const untagged = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body: ddOrder({ id: 'dd-test-2', created_at: old }), reference: 'dd-test-2', receivedAt: old });
      expect((await runInboxEntry(untagged.id))?.status).toBe('done');
    });
    expect((await readSandboxState()).orders.map((o) => o.id)).toContain('dd-test-2');
    expect(await getRepo().listActivity({})).toEqual([]);
    expect(keys).toEqual([]);
    expect(await getRepo().listOrders({ since: since(), limit: 50 })).toEqual([]);
  });

  it('control: a REAL DoorDash order past the answer window is still handed to a person', async () => {
    await realStore();
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    const e = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body: ddOrder({ id: 'dd-real-1', created_at: old }, 'dd-real'), reference: 'dd-real-1', receivedAt: old });
    expect((await runInboxEntry(e.id))?.status).toBe('failed');
    expect((await getInboxEntry(e.id))?.lastError).toMatch(/answer window/);
  });
});

describe('the Sandbox subscription has its own Authorization value (DOORDASH_SANDBOX_WEBHOOK_SECRET)', () => {
  it('a request carrying it is always a test, even with DOORDASH_ENV=production and no test store listed', async () => {
    Object.assign(process.env, { DOORDASH_SANDBOX_WEBHOOK_SECRET: 'dd-sandbox-secret', DOORDASH_ENV: 'production' });
    await realStore();
    // Even naming a real store: never the kitchen.
    expect((await postWebhook(ddOrder({ id: 'dd-sbx-9' }, 'dd-real'), 'dd-sandbox-secret')).status).toBe(202);
    await settle();
    expect((await inboxEntries())[0].sandbox).toMatch(/sandbox webhook secret/);
    expect((await readSandboxState()).orders.map((o) => o.id)).toEqual(['dd-sbx-9']);
    expect(await getRepo().listOrders({ since: since(), limit: 50 })).toEqual([]);
    expect(cloverCalls()).toEqual([]);
    // The production value still works as before, and anything else is 401.
    expect((await postWebhook(ddOrder({ id: 'dd-real-1' }, 'dd-real'))).status).toBe(202);
    await waitFor(async () => (await getRepo().listOrders({ since: since(), limit: 5 })).length > 0);
    expect((await getRepo().listOrders({ since: since(), limit: 5 })).map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
    expect((await postWebhook(ddOrder(), 'nope')).status).toBe(401);
  });

  it('a sandbox value equal to the production one is ignored (and the status warns)', async () => {
    Object.assign(process.env, { DOORDASH_SANDBOX_WEBHOOK_SECRET: 'dd-secret' });
    expect(doorDashSandboxActive()).toBe(false);
    expect(doorDashSandboxStatus().warnings.join(' ')).toMatch(/equals DOORDASH_WEBHOOK_SECRET/);
    await realStore();
    expect((await postWebhook(ddOrder({ id: 'dd-real-1' }, 'dd-real'), 'dd-secret')).status).toBe(202);
    await waitFor(async () => (await getRepo().listOrders({ since: since(), limit: 5 })).length > 0);
    expect((await getRepo().listOrders({ since: since(), limit: 5 })).map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
  });
});

describe('item polling and cart validation are sandbox-aware', () => {
  const poll = async (id: string, auth = 'dd-secret') => {
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/item-polling/[locationId]/route');
    return GET(new Request(`http://hub.local/api/foodhub/webhooks/doordash/item-polling/${id}`, { headers: { authorization: auth } }) as never, { params: Promise.resolve({ locationId: id }) });
  };
  const cart = async (id: string, auth = 'dd-secret') => {
    const { POST } = await import('../app/api/foodhub/webhooks/doordash/orderCartValidation/route');
    const body = { cart_id: 'c1', store: { merchant_supplied_id: id }, categories: [{ items: [{ merchant_supplied_id: 'i1', quantity: 1 }] }] };
    return POST(new Request('http://hub.local/api/foodhub/webhooks/doordash/orderCartValidation', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);
  };

  it('the test store is answered (200) from the chosen brand and logged in the test log only', async () => {
    sandboxOn();
    await getRepo().saveMenu({ ...menu, items: [...menu.items, { ...menu.items[0], ref: 'i2', name: 'Off', available: false }] } as MasterMenu);
    await writeSandboxConfig({ brandName: 'Pi Pita', locationCode: 'NDG_6284' });
    expect((await poll('sbx-1', 'nope')).status).toBe(401);
    const res = await poll('sbx-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ merchant_supplied_id: 'i2', is_active: false, type: 'item' }]);
    expect((await readSandboxState()).log.some((l) => l.kind === 'item_polling' && l.ok)).toBe(true);
    const c = await cart('sbx-1');
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ cart_id: 'c1', valid: true });
    expect(await getRepo().listActivity({})).toEqual([]);
  });

  it('under sandbox, a real store is refused (409) with no activity line; the protected store too', async () => {
    sandboxOn();
    await getRepo().saveMenu(menu);
    await realStore();
    expect((await poll('dd-real')).status).toBe(409);
    expect((await cart('dd-real')).status).toBe(409);
    expect((await poll('27982486')).status).toBe(409);
    expect(await getRepo().listActivity({})).toEqual([]);
  });

  it('a request with the sandbox secret about a real store is refused even with DOORDASH_ENV=production', async () => {
    Object.assign(process.env, { DOORDASH_SANDBOX_WEBHOOK_SECRET: 'dd-sandbox-secret' });
    await getRepo().saveMenu(menu);
    await realStore();
    expect((await poll('dd-real', 'dd-sandbox-secret')).status).toBe(409);
    expect((await cart('dd-real', 'dd-sandbox-secret')).status).toBe(409);
    expect(await validateDoorDashCart({ cart_id: 'c', store: { merchant_supplied_id: 'dd-real' }, categories: [] }, Date.now(), { sandboxAuth: true })).toMatchObject({ status: 409 });
    // The production value: answered as before.
    expect((await poll('dd-real')).status).toBe(200);
    expect(await getRepo().listActivity({})).toHaveLength(1);
  });
});

describe('a real store is never a test store, even when its id is listed', () => {
  it('its orders still reach Clover; the test screen refuses its menu; the status warns', async () => {
    process.env.DOORDASH_SANDBOX_STORE_IDS = 'dd-real';
    const store = await realStore();
    expect(await isDoorDashTestStore('dd-real')).toBe(false);
    await handleDoorDashWebhook(ddOrder({ id: 'dd-real-1' }, 'dd-real'));
    expect((await getRepo().listOrders({ since: since(), limit: 5 })).map((o) => o.externalOrderId)).toEqual(['dd-real-1']);
    expect(cloverCalls().some((c) => c.path.endsWith('/atomic_order/orders'))).toBe(true);
    expect((await readSandboxState()).orders).toEqual([]);
    calls.length = 0;
    await getRepo().saveMenu(menu);
    await writeSandboxConfig({ brandName: 'Pi Pita', locationCode: 'NDG_6284' });
    expect((await pushSandboxMenu('dd-real')).ok).toBe(false);
    expect((await setSandboxItem('dd-real', 'i1', false)).ok).toBe(false);
    expect((await setSandboxStoreOnline('dd-real', false)).ok).toBe(false);
    expect(doordashCalls()).toEqual([]);
    expect(doorDashSandboxStatus(process.env, [store]).warnings.join(' ')).toMatch(/real store mapped in Food Hub/);
  });

  it('with sandbox credentials, the real store row is refused by the adapter and the guard even when listed', async () => {
    sandboxOn({ DOORDASH_SANDBOX_STORE_IDS: 'dd-real,sbx-1' });
    const store = await realStore();
    expect((await doorDashAdapter.setStoreOnline(store, false)).status).toBe('blocked');
    expect(doorDashStoreRefusal(store, 'write')).toMatch(/sandbox mode/);
    expect((await setDoorDashStoreStatus('dd-real', { active: true })).status).toBe('blocked');
    expect(doordashCalls()).toEqual([]);
  });
});

describe('other DoorDash calls under sandbox credentials', () => {
  it('store status and retail calls (ddRequest) are refused for a real store, allowed for the test store', async () => {
    sandboxOn();
    await realStore();
    expect((await setDoorDashStoreStatus('dd-real', { active: true })).status).toBe('blocked');
    expect((await setRetailFulfillmentCapacity('dd-real', 'OVER_CAPACITY')).status).toBe('blocked');
    expect(doordashCalls()).toEqual([]);
    expect((await setDoorDashStoreStatus('sbx-1', { active: true })).ok).toBe(true);
    expect(doordashCalls().map((c) => c.path)).toEqual(['/marketplace/api/v1/stores/sbx-1/status']);
  });

  it('reports are not fetched with the sandbox key (nothing imported into money); a Reports key of their own still works', async () => {
    sandboxOn();
    const actor = { username: 'owner', name: 'Owner', source: 'dashboard' } as never;
    const req = await requestDoorDashReport({ reportType: 'TRANSACTION_DETAIL', from: '2026-10-01', to: '2026-10-02', storeIds: [123] }, actor);
    expect((req as { status: string }).status).toBe('blocked');
    await getRepo().putDocs(REPORT_REQUESTS, [{ id: 'r1', at: new Date().toISOString(), data: { id: 'r1', reportType: 'TRANSACTION_DETAIL', from: '2026-10-01', to: '2026-10-02', storeIds: [], status: 'requested', message: '', requestedBy: 'x', at: new Date().toISOString() } }]);
    const refreshed = await refreshDoorDashReport('r1', actor);
    expect(refreshed).toMatchObject({ status: 'requested' });
    expect(refreshed?.message).toMatch(/sandbox/);
    expect(calls).toEqual([]);
    Object.assign(process.env, { DOORDASH_REPORTS_DEVELOPER_ID: 'r', DOORDASH_REPORTS_KEY_ID: 'rk', DOORDASH_REPORTS_SIGNING_SECRET: 'c2VjcmV0' });
    await requestDoorDashReport({ reportType: 'TRANSACTION_DETAIL', from: '2026-10-01', to: '2026-10-02', storeIds: [123] }, actor);
    expect(calls.some((c) => c.path === '/dataexchange/v1/reports')).toBe(true);
  });
});

describe('Settings → DoorDash sandbox tests route', () => {
  const route = async () => import('../app/api/foodhub/doordash/sandbox/route');
  const req = (method: string, body?: unknown, auth = OWNER) => new Request('http://hub.local/api/foodhub/doordash/sandbox', { method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

  it('needs a signed-in user with the platform-settings permission', async () => {
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    const { GET, POST } = await route();
    expect((await GET(req('GET', undefined, ''), {} as never)).status).toBe(401);
    expect((await POST(req('POST', { action: 'clear' }, ''), {} as never)).status).toBe(401);
    expect((await GET(req('GET'), {} as never)).status).toBe(200);
  });

  it('refuses a store that is not a test store (unlisted, or a real mapped store); saves the config', async () => {
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    sandboxOn({ DOORDASH_SANDBOX_STORE_IDS: 'sbx-1,dd-real' });
    await realStore();
    const { GET, POST } = await route();
    expect((await POST(req('POST', { action: 'store', storeId: 'other', online: false }), {} as never)).status).toBe(400);
    expect((await POST(req('POST', { action: 'store', storeId: 'dd-real', online: false }), {} as never)).status).toBe(400);
    expect((await POST(req('POST', { action: 'store', storeId: '27982486', online: false }), {} as never)).status).toBe(400);
    expect(doordashCalls()).toEqual([]);
    expect((await POST(req('POST', { action: 'config', brandName: 'Pi Pita', autoConfirm: false }), {} as never)).status).toBe(200);
    const got = await (await GET(req('GET'), {} as never)).json();
    expect(got.config).toMatchObject({ brandName: 'Pi Pita', autoConfirm: false });
    expect(got.status.storeIds).toEqual(['sbx-1']);
    expect(got.status.warnings.join(' ')).toMatch(/real store mapped/);
  });
});
