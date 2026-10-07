// Durable order intake ("never lose an order", MASTER_PLAN Phase 1 item 1): an order is saved in the inbox before the
// platform gets its 2xx, a server stop between the 2xx and the pipeline is recovered by the sync sweep, failures are
// kept and flagged, and the owner's Replay never creates the same order twice.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { INBOX, INBOX_STALE_MS, MAX_RECOVERY_ATTEMPTS, inboxId, listInboxAttention, replayInbox, saveToInbox, sweepOrderInbox, type InboxRecord } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';
import { resetThrottle } from '../lib/foodhub/session';
import type { ChannelKey, NormalizedOrder } from '../lib/foodhub/types';

// next/server after(): 'run' = right after the response (like production), 'hold' = kept for the test to run later,
// 'drop' = never runs (the server stopped between the 2xx and the pipeline).
const ctl = vi.hoisted(() => ({ mode: 'run' as 'run' | 'hold' | 'drop', held: [] as Array<() => unknown> }));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { if (ctl.mode === 'run') void Promise.resolve().then(fn); else if (ctl.mode === 'hold') ctl.held.push(fn); },
}));

const realFetch = globalThis.fetch;
const RELAY = 'http://hub.local/api/foodhub/webhooks/relay?token=relay-secret-token-1234567890';
const settle = () => new Promise((r) => setTimeout(r, 30));
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

function relayOrder(id: number) {
  return {
    customer: { name: 'Ana B.', phone: '5145550000' },
    order: {
      details: { id, channel: 'tgtg', created: Date.now() - 60_000, order_type: 'pickup', order_subtotal: 5.99, order_total: 5.99, total_taxes: 0, brand: { name: 'Po Poulet' } },
      items: [{ id: 1, title: 'Panier surprise', price: 5.99, quantity: 1, total: 5.99 }],
      store: { id: 1712, merchant_ref_id: '182304', name: 'NDG' },
    },
  };
}

async function postRelay(id: number) {
  const { POST } = await import('../app/api/foodhub/webhooks/relay/route');
  return POST(new Request(RELAY, { method: 'POST', body: JSON.stringify(relayOrder(id)) }) as any);
}

/** An order straight from a platform webhook (no relay), placed now. */
function direct(channel: ChannelKey, externalOrderId: string): NormalizedOrder {
  return { channel, marketplace: channel, externalOrderId, channelStoreId: `${channel}-store`, fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 5, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 5,
    lines: [{ name: 'Poutine', quantity: 1, unitPrice: 5, total: 5, modifiers: [] }], raw: {} };
}

const ordersFor = async (externalOrderId: string) => (await getRepo().listOrders({ limit: 500 })).filter((o) => o.externalOrderId === externalOrderId);
const inboxDoc = async (id: string) => (await getRepo().getDoc<InboxRecord>(INBOX, id))?.data ?? null;

/** Ages an inbox record as if it had been saved `ms` ago. */
async function age(id: string, ms: number) {
  const doc = (await getRepo().getDoc<InboxRecord>(INBOX, id))!;
  const at = new Date(Date.now() - ms).toISOString();
  await getRepo().putDocs(INBOX, [{ ...doc, at, data: { ...doc.data, receivedAt: at } }]);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_RELAY_SECRET = 'relay-secret-token-1234567890';
  process.env.FOODHUB_RELAY_CHANNELS = 'tgtg';
  delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
  delete process.env.FOODHUB_RELAY_CALLBACK_URL;
  ctl.mode = 'run'; ctl.held = [];
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch; vi.restoreAllMocks();
  delete process.env.FOODHUB_POS_INJECTION; delete process.env.FOODHUB_RELAY_SECRET; delete process.env.FOODHUB_RELAY_CHANNELS;
});

describe('order intake is saved before the platform is answered', () => {
  it('writes the inbox record before processing, then marks it done with the Food Hub order id', async () => {
    ctl.mode = 'hold';
    const res = await postRelay(5001);
    expect(res.status).toBe(200);
    const id = inboxId('tgtg', 'relay-5001');
    // Answered, saved, not processed yet.
    expect(await inboxDoc(id)).toMatchObject({ status: 'queued', channel: 'tgtg', externalOrderId: 'relay-5001', attempts: 0 });
    expect((await inboxDoc(id))!.order?.lines).toHaveLength(1);
    expect(await ordersFor('relay-5001')).toHaveLength(0);

    await Promise.all(ctl.held.map((fn) => fn()));
    const [order] = await ordersFor('relay-5001');
    expect(order).toBeTruthy();
    expect(await inboxDoc(id)).toMatchObject({ status: 'done', orderId: order.id, duplicate: false });
    expect((await getRepo().getDoc(INBOX, id))?.key).toBe('done');
  });

  it('answers 503 (never a 2xx) when the order cannot be saved, and processes nothing', async () => {
    vi.spyOn(getRepo(), 'putDocs').mockRejectedValueOnce(new Error('Supabase: connection refused'));
    const res = await postRelay(5002);
    expect(res.status).toBe(503);
    await settle();
    expect(await ordersFor('relay-5002')).toHaveLength(0);
  });

  it('a platform re-delivery of the same order is stored once', async () => {
    await postRelay(5003); await settle();
    await postRelay(5003); await settle();
    expect(await ordersFor('relay-5003')).toHaveLength(1);
    expect(await inboxDoc(inboxId('tgtg', 'relay-5003'))).toMatchObject({ status: 'done', duplicate: true });
  });
});

describe('crash recovery: the sync sweep processes orders left queued', () => {
  it('recovers an order the server never processed (stopped between the 2xx and the pipeline)', async () => {
    ctl.mode = 'drop';
    expect((await postRelay(6001)).status).toBe(200);
    const id = inboxId('tgtg', 'relay-6001');
    expect(await inboxDoc(id)).toMatchObject({ status: 'queued' });
    ctl.mode = 'run';

    // Too fresh: it may still be running somewhere — left alone.
    expect(await sweepOrderInbox()).toMatchObject({ recovered: 0, failed: 0 });
    expect(await ordersFor('relay-6001')).toHaveLength(0);
    expect((await listInboxAttention()).map((i) => i.id)).not.toContain(id);

    // After the recovery delay it shows as not processed, and the sweep runs it.
    const later = Date.now() + INBOX_STALE_MS + 60_000;
    expect((await listInboxAttention(20, later)).find((i) => i.id === id)).toMatchObject({ stuck: true, status: 'queued' });
    expect(await sweepOrderInbox({ now: later })).toMatchObject({ recovered: 1, failed: 0 });
    const [order] = await ordersFor('relay-6001');
    expect(order).toBeTruthy();
    expect(await inboxDoc(id)).toMatchObject({ status: 'done', orderId: order.id, attempts: 1 });
    const activity = await getRepo().listActivity({ limit: 50 });
    expect(activity.some((a) => a.action === 'order_recovered' && a.status === 'success' && a.orderId === order.id)).toBe(true);

    // Nothing left: a second sweep does nothing and the order is still there once.
    expect(await sweepOrderInbox({ now: later + INBOX_STALE_MS * 2 })).toMatchObject({ recovered: 0, failed: 0 });
    expect(await ordersFor('relay-6001')).toHaveLength(1);
  });

  it('runs from the platform sync (runSync) and reports it', async () => {
    ctl.mode = 'drop';
    await postRelay(6002);
    ctl.mode = 'run';
    await age(inboxId('tgtg', 'relay-6002'), INBOX_STALE_MS + 60_000);
    const { runSync } = await import('../lib/foodhub/sync');
    const out = await runSync({ trigger: 'test', force: true });
    expect(out.ran).toBe(true);
    expect(out.report?.orderInbox).toMatchObject({ recovered: 1, failed: 0 });
    expect(await ordersFor('relay-6002')).toHaveLength(1);
  });

  it('after the attempt cap the order is handed to a person: error, flagged for the Command Center / Watchtower', async () => {
    const { id } = await saveToInbox({ channel: 'tgtg', externalOrderId: 'tgtg-capped', order: direct('tgtg', 'tgtg-capped') });
    const doc = (await getRepo().getDoc<InboxRecord>(INBOX, id))!;
    await getRepo().putDocs(INBOX, [{ ...doc, data: { ...doc.data, attempts: MAX_RECOVERY_ATTEMPTS } }]);
    expect(await sweepOrderInbox({ now: Date.now() + INBOX_STALE_MS + 1000 })).toMatchObject({ recovered: 0, failed: 1 });
    expect(await inboxDoc(id)).toMatchObject({ status: 'error' });
    expect((await inboxDoc(id))!.error).toMatch(/5 recovery attempts/);
    expect(await ordersFor('tgtg-capped')).toHaveLength(0);
    const flagged = (await getRepo().listJobs(20)).find((j) => j.kind === 'webhook_unparsed' && j.reference === 'tgtg-capped');
    expect(flagged?.request).toMatchObject({ inboxId: id });
    expect((await getRepo().listActivity({ limit: 20 })).some((a) => a.action === 'order_intake_failed' && a.status === 'failed')).toBe(true);
    expect((await listInboxAttention()).find((i) => i.id === id)).toMatchObject({ status: 'error', stuck: false });
  });

  it('recovers within the platform answer window; past it, a person checks the platform first (no late Clover ticket)', async () => {
    const skip = await saveToInbox({ channel: 'skip', externalOrderId: 'skip-crash-1', order: direct('skip', 'skip-crash-1') });
    const dd = await saveToInbox({ channel: 'doordash', externalOrderId: 'dd-crash-1', order: direct('doordash', 'dd-crash-1') });
    // 3 minutes later: Skip still waits for an answer (5 min), DoorDash has given up on it (3 min).
    expect(await sweepOrderInbox({ now: Date.now() + 3 * 60_000 + 5_000 })).toMatchObject({ recovered: 1, failed: 1 });
    expect(await ordersFor('skip-crash-1')).toHaveLength(1);
    expect(await inboxDoc(skip.id)).toMatchObject({ status: 'done' });
    expect(await ordersFor('dd-crash-1')).toHaveLength(0);
    expect(await inboxDoc(dd.id)).toMatchObject({ status: 'error', attempts: 0 });
    expect((await inboxDoc(dd.id))!.error).toMatch(/3-minute answer window/);
    expect((await getRepo().listJobs(20)).some((j) => j.kind === 'webhook_unparsed' && j.reference === 'dd-crash-1')).toBe(true);
    expect((await listInboxAttention()).find((i) => i.id === dd.id)).toMatchObject({ deadline: expect.any(String), pastDeadline: false });
    expect((await listInboxAttention(20, Date.now() + 10 * 60_000)).find((i) => i.id === dd.id)).toMatchObject({ pastDeadline: true });
    // The manager saw it still waiting on DoorDash: the owner replays it.
    expect(await replayInbox(dd.id, 'Owner')).toMatchObject({ ok: true, status: 'done', duplicate: false });
    expect(await ordersFor('dd-crash-1')).toHaveLength(1);
  });

  it('clears processed records after a week, never failed ones', async () => {
    await postRelay(6003); await settle();
    const failed = await saveToInbox({ channel: 'tgtg', externalOrderId: 'tgtg-old-failed' });
    await getRepo().putDocs(INBOX, [{ id: failed.id, key: 'error', at: failed.record.receivedAt, data: { ...failed.record, status: 'error', error: 'x' } }]);
    const out = await sweepOrderInbox({ now: Date.now() + 8 * 86400_000 });
    expect(out.pruned).toBe(1);
    expect(await inboxDoc(inboxId('tgtg', 'relay-6003'))).toBeNull();
    expect(await inboxDoc(failed.id)).toMatchObject({ status: 'error' });
    expect(await ordersFor('relay-6003')).toHaveLength(1);
  });
});

describe('failures are kept, flagged and replayable', () => {
  it('records a processing failure on the inbox record and flags it', async () => {
    vi.spyOn(getRepo(), 'insertOrderIfNew').mockRejectedValueOnce(new Error('Supabase: database unavailable'));
    expect((await postRelay(7001)).status).toBe(200);
    await settle();
    const id = inboxId('tgtg', 'relay-7001');
    expect(await inboxDoc(id)).toMatchObject({ status: 'error', error: 'Supabase: database unavailable' });
    expect(await ordersFor('relay-7001')).toHaveLength(0);
    const flagged = (await getRepo().listJobs(20)).find((j) => j.kind === 'webhook_unparsed' && j.reference === 'relay-7001');
    expect(flagged?.status).toBe('error');
    expect(flagged?.request).toMatchObject({ inboxId: id });
    expect(String((flagged?.result as any)?.reason)).toMatch(/database unavailable/);
    expect((await getRepo().listActivity({ limit: 20 })).some((a) => a.action === 'order_intake_failed' && a.channel === 'tgtg')).toBe(true);
    // Not retried by the sweep (it needs a person), but listed for Replay.
    expect(await sweepOrderInbox({ now: Date.now() + INBOX_STALE_MS * 2 })).toMatchObject({ recovered: 0 });
    expect((await listInboxAttention()).find((i) => i.id === id)).toMatchObject({ status: 'error', displayId: expect.any(String), brandName: 'Po Poulet' });
  });

  it('Replay processes it; replaying again, or twice at once, never duplicates the order', async () => {
    vi.spyOn(getRepo(), 'insertOrderIfNew').mockRejectedValueOnce(new Error('Supabase: database unavailable'));
    await postRelay(7002); await settle();
    const id = inboxId('tgtg', 'relay-7002');
    expect(await inboxDoc(id)).toMatchObject({ status: 'error' });

    const [a, b] = await Promise.all([replayInbox(id, 'Owner'), replayInbox(id, 'Owner')]);
    expect(a?.ok && b?.ok).toBe(true);
    expect([a?.duplicate, b?.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await ordersFor('relay-7002')).toHaveLength(1);
    expect(await replayInbox(id, 'Owner')).toMatchObject({ ok: true, already: true });
    expect(await ordersFor('relay-7002')).toHaveLength(1);
    expect(await inboxDoc(id)).toMatchObject({ status: 'done', lastReplay: { by: 'Owner' } });
    const replays = (await getRepo().listActivity({ limit: 50 })).filter((x) => x.action === 'order_replayed');
    expect(replays.length).toBeGreaterThanOrEqual(2);
    expect(replays.every((x) => x.actor === 'Owner' && x.source === 'dashboard')).toBe(true);
    expect(await replayInbox('tgtg:nope', 'Owner')).toBeNull();
  });

  it('Replay is the owner’s: managers get 403, the owner replays through the API', async () => {
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    resetThrottle();
    await getRepo().saveUser({ username: 'marc', name: 'Marc', role: 'manager', locations: [], passwordHash: hashPassword('manager-pass-1'), active: true });
    vi.spyOn(getRepo(), 'insertOrderIfNew').mockRejectedValueOnce(new Error('Supabase: database unavailable'));
    await postRelay(7003); await settle();
    const id = inboxId('tgtg', 'relay-7003');
    const { GET, POST } = await import('../app/api/foodhub/channels/inbox/route');
    const call = (auth: string) => POST(new Request('http://hub.local/api/foodhub/channels/inbox', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }), {});
    expect((await call(basic('marc', 'manager-pass-1'))).status).toBe(403);
    const list = await (await GET(new Request('http://hub.local/api/foodhub/channels/inbox', { headers: { authorization: basic('marc', 'manager-pass-1') } }), {})).json();
    expect(list.inbox.map((i: { id: string }) => i.id)).toContain(id);
    const res = await call(basic('owner', 'Owner-pass-123'));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toMatchObject({ ok: true, status: 'done', duplicate: false });
    expect(await ordersFor('relay-7003')).toHaveLength(1);
    delete process.env.DASHBOARD_PASSWORD;
  });
});

describe('Uber Eats notifications', () => {
  const UBER_SECRET = 'uber-client-secret-e2e';
  const details = { id: 'uber-ord-1', display_id: 'A1B2', store: { id: 'uber-store-1' }, cart: { items: [{ id: 'i1', title: 'Poutine', quantity: 1, price: { unit_price: { amount: 1000 }, total_price: { amount: 1000 } } }] }, payment: { charges: { sub_total: { amount: 1000 }, tax: { amount: 150 }, total: { amount: 1150 } } } };
  let uberUp = false;
  beforeEach(() => {
    process.env.UBER_CLIENT_SECRET = UBER_SECRET;
    process.env.UBER_ACCESS_TOKEN = 'static-token';
    process.env.UBER_BASE_URL = 'https://uber.test';
    uberUp = false;
    globalThis.fetch = vi.fn(async (url: any) => String(url).includes('/v2/eats/order/')
      ? (uberUp ? new Response(JSON.stringify(details), { status: 200 }) : new Response('down', { status: 503 }))
      : new Response('{}', { status: 200 })) as any;
  });
  afterEach(() => { delete process.env.UBER_CLIENT_SECRET; delete process.env.UBER_ACCESS_TOKEN; delete process.env.UBER_BASE_URL; });

  it('keeps the notification before the 200; a failed fetch is flagged and Replay fetches the order again', async () => {
    const raw = JSON.stringify({ event_type: 'orders.notification', meta: { resource_id: 'uber-ord-1', user_id: 'uber-store-1' }, resource_href: 'https://uber.test/v2/eats/order/uber-ord-1' });
    const { POST } = await import('../app/api/foodhub/webhooks/uber-eats/route');
    const res = await POST(new Request('http://hub.local/api/foodhub/webhooks/uber-eats', { method: 'POST', body: raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', UBER_SECRET).update(raw).digest('hex') } }) as any);
    expect(res.status).toBe(200);
    await settle();
    const id = inboxId('uber_eats', 'uber-ord-1');
    expect(await inboxDoc(id)).toMatchObject({ status: 'error', uber: { href: 'https://uber.test/v2/eats/order/uber-ord-1', storeId: 'uber-store-1' } });
    expect((await inboxDoc(id))!.error).toMatch(/HTTP 503/);
    expect(await ordersFor('uber-ord-1')).toHaveLength(0);

    uberUp = true;
    expect(await replayInbox(id, 'Owner')).toMatchObject({ ok: true, status: 'done', duplicate: false });
    const [order] = await ordersFor('uber-ord-1');
    expect(order).toMatchObject({ channel: 'uber_eats', channelStoreId: 'uber-store-1' });
  });
});
