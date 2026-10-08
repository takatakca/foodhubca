// PR #6 fixes ported onto main's webhook inbox, Clover retry, /api/health, Watchtower and Go-live (task 2, branch
// reconcile-pr6): never a late kitchen ticket from an automatic run, a 503 copy never processed, location-limited
// inbox, an order stored before a server stop resumed instead of "duplicate", Clover retry guards, cheap and honest
// /api/health, the unmapped-store incident, the silence alarm in opening minutes, SESSION_SECRET set / long / stable.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveUberWebhook } from '../lib/foodhub/adapters/uber-inbox';
import { cloverUnreachableStores, sessionSecretCheck } from '../lib/foodhub/go-live';
import { buildHealth, cachedHealth, syncMaxAgeMin } from '../lib/foodhub/health';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { getInboxEntry, INBOX, inboxSummary, MAX_RECOVERY_ATTEMPTS, receiveWebhook, refuseInboxEntry, replayInboxEntry, runInboxEntry, sweepInbox, type InboxEntry } from '../lib/foodhub/inbox';
import { cloverRetryOpen, noteLastOrder } from '../lib/foodhub/order-retry';
import { _resetOrderTypeCache, cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { processIncomingOrder, resendToClover } from '../lib/foodhub/pipeline';
import { cloverRetryTooLate, runCloverRetries } from '../lib/foodhub/recovery';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu, NormalizedOrder, StoredOrder } from '../lib/foodhub/types';
import { listIncidents, runWatch } from '../lib/foodhub/watch/engine';
import { saveThenProcess } from '../lib/foodhub/webhook-utils';

// Route background work (next/server after()) runs right away in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

const MID = 'TESTMERCH0001';
const MID2 = 'TESTMERCH0002';
const OWNER = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let cloverOrders: Array<{ id: string; title: string; total: number; createdTime: number }> = [];
/** Runs while Clover is creating an order (a person's send or a platform cancel landing meanwhile). */
let duringAtomic: (() => Promise<void>) | null = null;
let seq = 0;

const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function mockPlatforms() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (url.hostname === 'auth.uber.test') return json({ access_token: 'uber-tok', expires_in: 2592000 });
    if (url.hostname === 'api.uber.test') return p.startsWith('/v2/eats/order/') ? json(uberDetails(p.split('/').pop()!)) : new Response(null, { status: 204 });
    if (url.hostname === 'api.clover.test') {
      if (p.endsWith('/order_types')) return json({ elements: [{ id: 'OT-ONLINE-DELIV', label: 'Online Order Delivery' }, { id: 'OT-ONLINE-PICKUP', label: 'Online Order Pick Up' }] });
      if (p.endsWith('/atomic_order/orders')) {
        const id = `CLV${++seq}`;
        cloverOrders.push({ id, title: body.orderCart.title, total: 1999, createdTime: Date.now() });
        if (duringAtomic) await duringAtomic();
        return json({ id, total: 1999 });
      }
      if (/\/orders$/.test(p) && method === 'GET') return json({ elements: cloverOrders.map((o) => ({ ...o })) });
      if (p.endsWith('/print_event')) return json({ id: `PE-${body?.orderRef?.id}`, state: 'CREATED' });
      if (/\/orders\/[^/]+$/.test(p)) return json({ id: p.split('/').pop() });
    }
    return json({}, 404);
  }) as any;
}

function uberDetails(id: string, placedMinAgo = 0) {
  return {
    id, display_id: id.slice(-5).toUpperCase(), store: { id: 'ue-popoulet-ndg' }, eater: { first_name: 'Marie' }, type: 'DELIVERY_BY_UBER',
    cart: { items: [{ id: 'CLV-6MCX', external_data: 'CLV-6MCX', title: '6 MCX + Frites', quantity: 1, price: { base_unit_price: { amount: 1679 }, unit_price: { amount: 1679 }, total_price: { amount: 1679 } } }] },
    payment: { charges: { sub_total: { amount: 1679 }, tax: { amount: 252 }, total: { amount: 1931 } } },
    placed_at: ago(placedMinAgo),
  };
}

async function uberOrder(id: string, placedMinAgo = 0): Promise<NormalizedOrder> {
  const { parseUberOrder } = await import('../lib/foodhub/adapters/uber-eats');
  return parseUberOrder(uberDetails(id, placedMinAgo))!;
}

const menu: MasterMenu = {
  brandName: 'Po Poulet', posMerchantId: MID,
  categories: [{ ref: 'CAT', name: 'Poulet', sortOrder: 0 }],
  items: [{ ref: 'CLV-6MCX', posItemRef: 'CLV-6MCX', name: '6 MCX + Frites', price: 16.79, categoryRef: 'CAT', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
  updatedAt: new Date().toISOString(),
};

const ENV: Record<string, string> = {
  FOODHUB_FORCE_MEMORY: 'true', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true', FOODHUB_RETRY_TIMER: 'off',
  CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clover-token',
  UBER_BASE_URL: 'https://api.uber.test', UBER_AUTH_URL: 'https://auth.uber.test/oauth/v2/token', UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-secret',
  FOODHUB_RELAY_SECRET: 'relay-secret-token-1234567890', FOODHUB_RELAY_CHANNELS: 'skip,tgtg',
};
const CLEARED = ['CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'FOODHUB_CLOVER_RETRY_S', 'FOODHUB_INBOX_MAX_AGE_MIN', 'FOODHUB_VIA_CLOVER', 'CLOVER_CLIENT_ID',
  'FOODHUB_HEALTH_SYNC_MAX_MIN', 'FOODHUB_INTERNAL_SYNC_MIN', 'VERCEL', 'SESSION_SECRET', 'DASHBOARD_PASSWORD', 'FOODHUB_RELAY_CALLBACK_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of CLEARED) { saved[k] = process.env[k]; delete process.env[k]; }
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__foodhubCloverSending = undefined;
  calls = []; cloverOrders = []; duringAtomic = null; seq = 0;
  _resetOrderTypeCache();
  mockPlatforms();
  await getRepo().saveMenu(menu);
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function putEntry(e: InboxEntry) {
  await getRepo().putDocs<InboxEntry>(INBOX, [{ id: e.id, key: e.status, at: e.receivedAt, data: e }]);
}

describe('webhook inbox: never a late ticket, never a 503 copy, a person after repeated stops', () => {
  it('an order past its platform answer window is not processed automatically — a person can still replay it', async () => {
    const n = await uberOrder('uber-late-1', 20); // Uber gives 11.5 min from when it was placed
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'order', body: n, reference: n.externalOrderId });
    const auto = await runInboxEntry(e.id);
    expect(auto).toMatchObject({ status: 'failed', nextAt: null });
    expect(auto?.lastError).toMatch(/answer window.*check there before replaying/);
    expect(await getRepo().findOrder('uber_eats', n.externalOrderId)).toBeNull();
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
    // Still waits for a person: a later sweep does not touch it.
    await sweepInbox({ now: Date.now() + 10 * 60_000 });
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
    const replayed = await replayInboxEntry(e.id, OWNER);
    expect(replayed?.status).toBe('done');
    expect(await getRepo().findOrder('uber_eats', n.externalOrderId)).not.toBeNull();
  });

  it('an order with no platform window (relay / Too Good To Go) stops after FOODHUB_INBOX_MAX_AGE_MIN (30 by default)', async () => {
    const n = { ...(await uberOrder('tgtg-old-1')), channel: 'tgtg' as const, marketplace: 'tgtg', channelStoreId: 'tgtg-1' };
    const e = await receiveWebhook({ channel: 'tgtg', kind: 'order', body: n, reference: n.externalOrderId, receivedAt: ago(31) });
    expect((await runInboxEntry(e.id))?.lastError).toMatch(/not processed within 30 minutes/);
    process.env.FOODHUB_INBOX_MAX_AGE_MIN = '60';
    const e2 = await receiveWebhook({ channel: 'tgtg', kind: 'order', body: { ...n, externalOrderId: 'tgtg-old-2' }, reference: 'tgtg-old-2', receivedAt: ago(31) });
    expect((await runInboxEntry(e2.id))?.status).toBe('done');
  });

  it(`an entry interrupted ${MAX_RECOVERY_ATTEMPTS} times is handed to a person instead of being run again`, async () => {
    const e = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body: { external_order_id: 'dd-1', dasher_status: 'dasher_confirmed' }, reference: 'dd-1' });
    await putEntry({ ...e, status: 'processing', attempts: MAX_RECOVERY_ATTEMPTS, updatedAt: ago(3) });
    const out = await sweepInbox();
    expect(out).toMatchObject({ processed: 0, failed: 1 });
    expect(await getInboxEntry(e.id)).toMatchObject({ status: 'failed', nextAt: null, attempts: MAX_RECOVERY_ATTEMPTS });
    expect((await getInboxEntry(e.id))?.lastError).toMatch(/interrupted/);
  });

  it('a copy saved although Food Hub answered 503 is "refused": never swept, and Uber’s re-delivery saves it again', async () => {
    const body = { event_type: 'orders.notification', event_id: 'evt-refused-1', meta: { resource_id: 'uber-ref-1', user_id: 'ue-popoulet-ndg' }, resource_href: 'https://api.uber.test/v2/eats/order/uber-ref-1' };
    const receivedAt = ago(0);
    await receiveWebhook({ id: 'evt-refused-1', receivedAt, channel: 'uber_eats', kind: 'uber', body });
    await refuseInboxEntry('evt-refused-1', ago(5), 'timeout'); // another delivery's copy: left alone
    expect((await getInboxEntry('evt-refused-1'))?.status).toBe('received');
    await refuseInboxEntry('evt-refused-1', receivedAt, 'timeout');
    expect((await getInboxEntry('evt-refused-1'))?.status).toBe('refused');
    await sweepInbox({ now: Date.now() + 5 * 60_000 });
    expect((await runInboxEntry('evt-refused-1'))?.status).toBe('refused');
    expect(sent('GET', /\/v2\/eats\/order\//)).toHaveLength(0);
    const again = await saveUberWebhook(body, JSON.stringify(body));
    expect(again).toEqual({ id: 'evt-refused-1', duplicate: false });
    expect((await getInboxEntry('evt-refused-1'))?.status).toBe('received');
  });

  it('a write that landed but answered with an error: the route answers 503 and that copy is marked refused', async () => {
    const repo = getRepo();
    const put = repo.putDocs.bind(repo);
    vi.spyOn(repo, 'putDocs').mockImplementationOnce(async (...args: Parameters<typeof repo.putDocs>) => { await put(...args); throw new Error('statement timeout'); });
    expect(await saveThenProcess({ channel: 'skip', kind: 'order', body: { externalOrderId: 'skip-1' }, reference: 'skip-1' })).toBe(false);
    const all = (await repo.listDocs<InboxEntry>(INBOX, { limit: 10 })).map((d) => d.data);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'refused', reference: 'skip-1' });
    expect((await inboxSummary()).entries).toHaveLength(0);
  });

  it('a manager limited to some locations sees and replays only their locations’ entries; unmapped ones only the owner', async () => {
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-verdun', brandName: 'Po Poulet', locationCode: 'VERDUN', autoAccept: true, online: true, meta: {} });
    const ndg = await receiveWebhook({ channel: 'uber_eats', kind: 'order', body: { ...(await uberOrder('uber-scope-1')) }, reference: 'uber-scope-1' });
    const verdun = await receiveWebhook({ channel: 'doordash', kind: 'doordash', body: { order: { store: { merchant_supplied_id: 'dd-verdun' } } }, reference: 'dd-scope' });
    const unmapped = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: { event_type: 'store.provisioned', meta: { user_id: 'nobody-mapped-this' } }, reference: 'x' });
    expect((await inboxSummary()).entries.map((e) => e.id).sort()).toEqual([ndg.id, verdun.id, unmapped.id].sort());
    expect((await inboxSummary({ locations: ['NDG_6284'] })).entries.map((e) => e.id)).toEqual([ndg.id]);
    expect((await inboxSummary({ locations: ['VERDUN'] })).entries.map((e) => e.id)).toEqual([verdun.id]);
    expect(await replayInboxEntry(verdun.id, { ...OWNER, locations: ['NDG_6284'] })).toBeNull();
    expect(await replayInboxEntry(unmapped.id, { ...OWNER, locations: ['NDG_6284'] })).toBeNull();
  });
});

describe('an order stored before a server stop is finished, not answered "duplicate"', () => {
  async function storedOnly(id: string, minAgo: number) {
    const n = await uberOrder(id);
    await getRepo().insertOrderIfNew({ ...n, brandName: 'Po Poulet', locationCode: 'NDG_6284', createdAt: ago(minAgo) });
    return n;
  }

  it('the next delivery looks in Clover, sends it, prints it and accepts it — once', async () => {
    await storedOnly('uber-resume-1', 2);
    const out = await processIncomingOrder(await uberOrder('uber-resume-1'));
    expect(out).toMatchObject({ duplicate: false, resumed: true });
    expect(out.order.posOrderId).toBeTruthy();
    expect(out.order.status).toBe('accepted');
    const lookup = calls.findIndex((c) => c.method === 'GET' && /\/orders$/.test(c.path));
    const create = calls.findIndex((c) => /atomic_order/.test(c.path));
    expect(lookup).toBeGreaterThanOrEqual(0);
    expect(lookup).toBeLessThan(create);
    expect(sent('POST', /print_event/)).toHaveLength(1);
    expect((await getRepo().listEvents(out.order.id)).map((e) => e.type)).toContain('resumed');
    expect((await processIncomingOrder(await uberOrder('uber-resume-1'))).duplicate).toBe(true);
    expect(sent('POST', /atomic_order/)).toHaveLength(1);
  });

  it('when the stop came after Clover created it, the Clover order is linked — no second ticket', async () => {
    const n = await storedOnly('uber-resume-2', 2);
    cloverOrders.push({ id: 'CLV-EARLIER', title: cloverOrderTitle(n), total: 1931, createdTime: Date.now() - 60_000 });
    const out = await processIncomingOrder(await uberOrder('uber-resume-2'));
    expect(out.order.posOrderId).toBe('CLV-EARLIER');
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
  });

  it('a first processing still under way (under 90 s) is left alone', async () => {
    await storedOnly('uber-resume-3', 0.5);
    expect((await processIncomingOrder(await uberOrder('uber-resume-3'))).duplicate).toBe(true);
    expect(calls.filter((c) => /clover/.test(c.path) || /atomic/.test(c.path))).toHaveLength(0);
  });
});

describe('Clover retry guards', () => {
  async function waiting(id: string, extra: Partial<StoredOrder> = {}, channelStoreId = 'ue-popoulet-ndg'): Promise<StoredOrder> {
    const n = { ...(await uberOrder(id)), channelStoreId };
    const { order } = await getRepo().insertOrderIfNew({ ...n, brandName: 'Po Poulet', locationCode: channelStoreId === 'ue-popoulet-ndg' ? 'NDG_6284' : undefined });
    return (await getRepo().updateOrder(order.id, { posError: 'Clover returned HTTP 503', ...extra }))!;
  }

  it('a store nobody mapped never goes into a guessed register when there are several', async () => {
    process.env.CLOVER_MERCHANT_TOKENS = JSON.stringify({ [MID]: 'clover-token', [MID2]: 'clover-token-2' });
    const o = await waiting('uber-guard-1', {}, 'ue-not-mapped');
    const r = await resendToClover(o);
    expect(r.pos.ok).toBe(false);
    expect(!r.pos.ok && r.pos.error).toMatch(/several Clover registers/);
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
  });

  it('read again after the send: a copy someone else made meanwhile wins and ours is removed', async () => {
    const o = await waiting('uber-guard-2');
    duringAtomic = async () => { await getRepo().updateOrder(o.id, { posOrderId: 'CLV-BY-A-PERSON' }); };
    const r = await resendToClover(o);
    expect(r.pos).toMatchObject({ ok: true, posOrderId: 'CLV-BY-A-PERSON' });
    expect((await getRepo().getOrder(o.id))?.posOrderId).toBe('CLV-BY-A-PERSON');
    expect(sent('DELETE', /\/orders\/CLV1$/)).toHaveLength(1);
    expect(sent('POST', /print_event/)).toHaveLength(0);
    expect((await getRepo().listEvents(o.id)).map((e) => e.type)).toContain('pos_duplicate');
  });

  it('cancelled by the platform while Clover was called: no kitchen ticket, removed from Clover', async () => {
    const o = await waiting('uber-guard-3');
    duringAtomic = async () => { await getRepo().updateOrder(o.id, { status: 'cancelled' }); };
    await resendToClover(o);
    expect(sent('POST', /print_event/)).toHaveLength(0);
    expect(sent('DELETE', /\/orders\/CLV1$/)).toHaveLength(1);
  });

  it('one send per order at a time on a server', async () => {
    const o = await waiting('uber-guard-4');
    const [a, b] = await Promise.all([resendToClover(o), resendToClover(o)]);
    expect(a.pos.ok).toBe(true);
    expect(b.pos).toMatchObject({ ok: false, skipped: true });
    expect(sent('POST', /atomic_order/)).toHaveLength(1);
  });

  it('the runner stops at the platform deadline (new orders) and after 30 minutes, and wakes a manager', async () => {
    const o = await waiting('uber-guard-5', { placedAt: ago(15), timeline: { posRetry: { attempts: 1, nextAt: ago(0.1), lastError: 'HTTP 503' } } });
    const r = await runCloverRetries();
    expect(r).toMatchObject({ due: 0, gaveUp: 1 });
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
    expect((await getRepo().getOrder(o.id))?.timeline?.posRetry).toMatchObject({ nextAt: null });
    expect((await getRepo().getOrder(o.id))?.timeline?.posRetry?.gaveUpAt).toBeTruthy();
    const now = Date.now();
    const accepted = { channel: 'uber_eats', status: 'accepted', placedAt: ago(40), createdAt: ago(10), timeline: {} } as unknown as StoredOrder;
    expect(cloverRetryTooLate(accepted, now)).toBeNull(); // accepted on Uber's side: its answer window no longer matters
    expect(cloverRetryTooLate({ ...accepted, createdAt: ago(31) }, now)).toMatch(/no more automatic tries/);
  });

  it('retries also for an order the platform accepted, never one a person accepted here', () => {
    expect(cloverRetryOpen({ status: 'new', timeline: {} })).toBe(true);
    expect(cloverRetryOpen({ status: 'accepted', timeline: {} })).toBe(true);
    expect(cloverRetryOpen({ status: 'accepted', timeline: { acceptedBy: 'owner' } })).toBe(false);
    expect(cloverRetryOpen({ status: 'new', viaPos: 'clover', timeline: {} })).toBe(false);
    expect(cloverRetryOpen({ status: 'cancelled', timeline: {} })).toBe(false);
  });
});

describe('relay: a cancel that beats its order', () => {
  it('waits for the order: it arrives cancelled, nothing goes to Clover', async () => {
    const { POST } = await import('../app/api/foodhub/webhooks/relay/route');
    const status = { order_id: 5551, new_state: 'customer_cancelled', additional_info: { external_channel: { name: 'SkipTheDishes', order_id: 'SKIP-5551' } }, message: 'Changed my mind' };
    const res = await POST(new Request(`http://hub.local/api/foodhub/webhooks/relay?token=${ENV.FOODHUB_RELAY_SECRET}`, { method: 'POST', body: JSON.stringify(status) }) as any);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect((await getRepo().listJobs(20)).filter((j) => j.kind === 'webhook_unparsed')).toHaveLength(0);
    const { parseRelayOrder } = await import('../lib/foodhub/adapters/relay');
    const parsed = parseRelayOrder({
      order: {
        details: { id: 5551, channel: 'skipthedishes', created: Date.now() - 60_000, order_type: 'delivery', order_subtotal: 12, order_total: 13.8, total_taxes: 1.8, ext_platforms: [{ id: 'SKIP-5551', kind: 'food_aggregator', name: 'skipthedishes' }] },
        items: [{ id: 1, title: 'Poulet', price: 12, quantity: 1, total: 12 }], store: { id: 1712, merchant_ref_id: '182304', name: 'NDG' }, payment: [{ amount: 13.8, option: 'online' }],
      },
    });
    if ('ignored' in parsed) throw new Error(parsed.ignored);
    const out = await processIncomingOrder(parsed.order);
    expect(out.order.status).toBe('cancelled');
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
  });
});

describe('/api/health: cheap, time-bounded, honest in production', () => {
  it('memory mode on a production server is "down" (orders would vanish at the next restart)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const h = await buildHealth({ uptimeSec: 0 });
    expect(h.checks.database.status).toBe('down');
    expect(h.status).toBe('down');
    vi.stubEnv('NODE_ENV', 'test');
    expect((await buildHealth()).checks.database.status).toBe('warn');
  });

  it('a locked console is "down": live without DASHBOARD_PASSWORD, or no session secret at all', async () => {
    expect((await buildHealth()).checks.console.status).toBe('down'); // live on, no DASHBOARD_PASSWORD
    process.env.DASHBOARD_PASSWORD = 'x'.repeat(16);
    expect((await buildHealth()).checks.console.status).toBe('ok');
    delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
    delete process.env.DASHBOARD_PASSWORD;
    vi.stubEnv('NODE_ENV', 'production');
    expect((await buildHealth({ uptimeSec: 0 })).checks.console.status).toBe('down'); // no SESSION_SECRET, no password
  });

  it('sync age: down only when a regular sync was promised and stopped; a new server gets time for its first sync', async () => {
    expect(syncMaxAgeMin()).toBe(0); // dev / test: nothing promised
    vi.stubEnv('NODE_ENV', 'production');
    expect(syncMaxAgeMin()).toBe(20);
    process.env.FOODHUB_INTERNAL_SYNC_MIN = '15';
    expect(syncMaxAgeMin()).toBe(30);
    process.env.VERCEL = '1';
    expect(syncMaxAgeMin()).toBe(0);
    process.env.FOODHUB_HEALTH_SYNC_MAX_MIN = '20';
    expect(syncMaxAgeMin()).toBe(20);
    expect((await buildHealth({ uptimeSec: 60 })).checks.sync.status).toBe('warn');
    expect((await buildHealth({ uptimeSec: 3600 })).checks.sync.status).toBe('down');
    const at = async (min: number) => { await getRepo().setKv('sync:at', { at: ago(min), cloverDown: 0 }); return (await buildHealth()).checks.sync.status; };
    expect(await at(5)).toBe('ok');
    expect(await at(15)).toBe('warn');
    expect(await at(25)).toBe('down');
  });

  it('callers in flight share one computation; memory mode is never reused once done', async () => {
    const a = cachedHealth();
    expect(cachedHealth()).toBe(a);
    await a;
    expect(cachedHealth()).not.toBe(a);
  });

  it('a database that does not answer makes the check "down" within 4 s instead of hanging the monitor', async () => {
    vi.spyOn(getRepo(), 'setKv').mockImplementation(() => new Promise(() => undefined));
    const t0 = Date.now();
    const h = await buildHealth();
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(h.checks.database.status).toBe('down');
    expect(h.checks.database.detail).not.toMatch(/no answer after/); // the reason stays in the server log
  }, 10_000);

  it('public on its exact path only', async () => {
    const { proxy } = await import('../proxy');
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.DASHBOARD_PASSWORD = 'p'.repeat(16);
    expect((await proxy(new NextRequest('http://hub.local/api/health'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(new NextRequest('http://hub.local/api/healthz'))).status).toBe(401);
    expect((await proxy(new NextRequest('http://hub.local/api/health/x'))).status).toBe(401);
  });
});

describe('Watchtower', () => {
  it('an order from a platform store nobody mapped opens one "unmapped store" incident (not "order waiting")', async () => {
    const n = { ...(await uberOrder('uber-unmapped-1')), channelStoreId: 'ue-nobody-mapped' };
    const { order } = await getRepo().insertOrderIfNew({ ...n, createdAt: ago(2) });
    await runWatch({ force: true });
    const open = await listIncidents({ status: ['open'] });
    const inc = open.find((i) => i.kind === 'store_unmapped');
    expect(inc).toMatchObject({ key: 'store_unmapped:uber_eats:ue-nobody-mapped', severity: 'critical', orderId: order.id });
    expect(inc?.titleEn).toMatch(/unmapped Uber Eats store: ue-nobody-mapped/);
    expect(open.some((i) => i.kind === 'order_unaccepted' && i.orderId === order.id)).toBe(false);
  });

  it('"action refused by a platform" never counts actions Food Hub did not send (blocked)', async () => {
    await getRepo().addJob({ kind: 'menu_publish', channel: 'doordash', reference: null, status: 'error', request: {}, result: { status: 'blocked' } });
    await runWatch({ force: true });
    expect((await listIncidents({ status: ['open'] })).some((i) => i.kind === 'menu_failed')).toBe(false);
    await getRepo().addJob({ kind: 'menu_publish', channel: 'doordash', reference: null, status: 'error', request: {}, result: { status: 'failed' } });
    await runWatch({ force: true });
    expect((await listIncidents({ status: ['open'] })).some((i) => i.kind === 'menu_failed')).toBe(true);
  });

  it('silence alarm: counted in opening time; Too Good To Go and unprovisioned stores never count', async () => {
    await saveHours({ locations: { NDG_6284: allDayWeek() }, brands: {}, holidays: [] });
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: { provisioned: false } });
    await getRepo().upsertStore({ channel: 'tgtg', channelStoreId: 'tgtg-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', autoAccept: true, online: true, meta: {} });
    await noteLastOrder('uber_eats', ago(300));
    await noteLastOrder('tgtg', ago(300));
    await runWatch({ force: true });
    expect((await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'platform_silent')).toHaveLength(0);
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
    await runWatch({ force: true });
    const silent = (await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'platform_silent');
    expect(silent.map((i) => i.channel)).toEqual(['uber_eats']);
    expect(silent[0].detailEn).toMatch(/of opening hours without an order/);
  });
});

describe('Go-live facts', () => {
  it('SESSION_SECRET: set, at least 32 characters, and the same as before (a change is dated)', async () => {
    expect(await sessionSecretCheck()).toMatchObject({ set: false, strong: false, since: null });
    process.env.SESSION_SECRET = 'short';
    expect(await sessionSecretCheck()).toMatchObject({ set: true, strong: false, since: null });
    process.env.SESSION_SECRET = 'a'.repeat(64);
    const first = await sessionSecretCheck(new Date('2026-10-01T12:00:00Z'));
    expect(first).toMatchObject({ source: 'env', set: true, strong: true, since: '2026-10-01T12:00:00.000Z', changedAt: null });
    expect(await sessionSecretCheck(new Date('2026-10-05T12:00:00Z'))).toMatchObject({ since: '2026-10-01T12:00:00.000Z', changedAt: null });
    process.env.SESSION_SECRET = 'b'.repeat(64);
    expect(await sessionSecretCheck(new Date('2026-10-06T12:00:00Z'))).toMatchObject({ since: '2026-10-06T12:00:00.000Z', changedAt: '2026-10-06T12:00:00.000Z' });
    // Only a one-way fingerprint is kept, never the key.
    expect(JSON.stringify(await getRepo().getKv('golive:session-secret'))).not.toContain('b'.repeat(16));
  });

  it('a mapped store whose register has no token keeps the Clover row to-do', async () => {
    expect(await cloverUnreachableStores()).toEqual([]);
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-verdun', brandName: 'Po Poulet', locationCode: 'VERDUN', cloverMerchantId: MID2, autoAccept: true, online: true, meta: {} });
    expect(await cloverUnreachableStores()).toEqual([{ channel: 'doordash', brandName: 'Po Poulet', locationCode: 'VERDUN', merchantId: MID2, reason: 'no_token' }]);
    process.env.FOODHUB_VIA_CLOVER = 'doordash'; // Clover's own DoorDash integration has those orders
    expect(await cloverUnreachableStores()).toEqual([]);
  });
});
