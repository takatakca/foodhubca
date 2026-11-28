import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as relayWebhook } from '../app/api/foodhub/webhooks/relay/route';
import { parseRelayOrder } from '../lib/foodhub/adapters/relay';
import { getInboxEntry, runInboxEntry, sweepInbox } from '../lib/foodhub/inbox';
import { runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelKey, OrderStatus } from '../lib/foodhub/types';

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (work: () => Promise<void>) => { afterTasks.push(work); },
}));

const RELAY_URL = 'http://hub.local/api/foodhub/webhooks/relay';
const SECRET = 'synthetic-relay-webhook-token';
const HUB_ID = 4001;
const CLOVER_MERCHANT = 'SYNTHETICMID1';
const fetchMock = vi.fn();

function orderPayload(channel: ChannelKey, id = HUB_ID) {
  return { order: {
    details: {
      id, channel, created: new Date().toISOString(), order_type: 'pickup',
      order_subtotal: 10, order_total: 10, ext_platforms: [{ id: `ORDER-${id}`, name: channel }],
    },
    items: [{ id: 1, title: 'Fixture dish', price: 10, quantity: 1, total: 10 }],
    store: { merchant_ref_id: 'fixture-store-ref' },
  } };
}

async function receive(body: unknown, token: string | null = SECRET) {
  const authorization = token ? { authorization: `Bearer ${token}` } : undefined;
  return relayWebhook(new NextRequest(RELAY_URL, { method: 'POST', headers: authorization, body: JSON.stringify(body) }));
}

async function post(body: unknown, token: string | null = SECRET) {
  const res = await receive(body, token);
  for (const work of afterTasks.splice(0)) await work();
  return res;
}

function rejection(channel: string, id = HUB_ID) {
  return {
    order_id: id, new_state: 'Rejected', message: 'Partner rejected the order',
    additional_info: { external_channel: { name: channel } },
  };
}

async function stored(channel: ChannelKey, status: OrderStatus = 'ready') {
  const parsed = parseRelayOrder(orderPayload(channel));
  if ('ignored' in parsed) throw new Error(parsed.ignored);
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({ ...parsed.order, brandName: 'Fixture brand', locationCode: 'FIXTURE_KITCHEN' });
  await repo.updateOrder(order.id, { status });
  return order;
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_POS_INJECTION', 'on');
  vi.stubEnv('FOODHUB_CLOVER_ORDER_TYPES', 'off');
  vi.stubEnv('FOODHUB_VIA_CLOVER', undefined);
  vi.stubEnv('FOODHUB_RELAY_CHANNELS', 'skip,doordash,uber_eats');
  vi.stubEnv('FOODHUB_RELAY_SECRET', SECRET);
  vi.stubEnv('CLOVER_MERCHANT_ID', CLOVER_MERCHANT);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'synthetic-clover-token');
  vi.stubEnv('CLOVER_BASE_URL', 'https://clover.example.test');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  expect(afterTasks).toHaveLength(0);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('relay partner rejection', () => {
  it.each(['doordash', 'skip', 'uber_eats'] as const)('cancels an already stored %s relay order and records the original partner notice', async (channel) => {
    const order = await stored(channel);
    const response = await post(rejection(channel));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await getRepo().getOrder(order.id)).toMatchObject({
      status: 'cancelled', locationCode: 'FIXTURE_KITCHEN',
      timeline: { cancelledAt: expect.any(String), cancelledBy: 'platform', cancelReason: 'Partner rejected the order' },
    });
    expect(await getRepo().listEvents(order.id)).toContainEqual(expect.objectContaining({
      type: 'platform_status', detail: expect.objectContaining({ source: 'relay', partnerState: 'Rejected' }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors an acknowledged signed rejection even when its after-response worker never ran', async () => {
    const repo = getRepo();
    await repo.upsertStore({
      channel: 'skip', channelStoreId: 'relay:fixture-store-ref', brandName: 'Fixture brand', locationCode: 'FIXTURE_KITCHEN',
      cloverMerchantId: CLOVER_MERCHANT, autoAccept: true, online: true, meta: {},
    });
    expect((await receive(rejection('skip'))).status).toBe(200);
    // Simulate a worker stop between the response and the first pipeline instruction.
    afterTasks.splice(0);
    const [entry] = await repo.listDocs('webhook_inbox');
    expect(entry?.data).toMatchObject({ kind: 'relay_cancel', status: 'received', reference: `relay-${HUB_ID}` });
    expect((await post(orderPayload('skip'))).status).toBe(200);
    expect(await repo.findOrder('skip', `relay-${HUB_ID}`)).toMatchObject({
      status: 'cancelled', locationCode: 'FIXTURE_KITCHEN', timeline: { cancelReason: 'Partner rejected the order' },
    });
    await sweepInbox({ now: Date.now() + 3 * 60_000 });
    expect(await getInboxEntry(entry.id)).toMatchObject({ status: 'done', attempts: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the sender to retry if the signed terminal notice cannot be persisted, without queuing work', async () => {
    const repo = getRepo();
    const set = vi.spyOn(repo, 'insertDocIfAbsent').mockRejectedValueOnce(new Error('Fixture storage outage'));
    try {
      const ack = await receive(rejection('skip'));
      expect(ack.status).toBe(503);
      expect(ack.headers.get('Retry-After')).toBe('30');
      expect(afterTasks).toHaveLength(0);
      expect(await repo.listDocs('webhook_inbox')).toHaveLength(0);
    } finally {
      set.mockRestore();
      afterTasks.splice(0);
    }
  });

  it('does not enqueue a duplicate acknowledgement or replace the first partner reason', async () => {
    const repo = getRepo();
    expect((await receive(rejection('skip'))).status).toBe(200);
    expect((await receive({ ...rejection('skip'), message: 'Duplicate changed reason' })).status).toBe(200);
    try {
      expect((await repo.listDocs('webhook_inbox')).map(({ data }) => data)).toEqual([
        expect.objectContaining({ kind: 'relay_cancel', body: rejection('skip'), attempts: 0 }),
      ]);
      expect(afterTasks).toHaveLength(1);
    } finally { afterTasks.splice(0); }
  });

  it('settles an existing unpaid Clover copy once when the signed notice is replayed', async () => {
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const order = await stored('skip');
    await repo.updateOrder(order.id, { posOrderId: 'SYNTHETICPOS1', timeline: { posMerchantId: CLOVER_MERCHANT } });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://clover.example.test');
      expect(url.pathname).toBe(`/v3/merchants/${CLOVER_MERCHANT}/orders/SYNTHETICPOS1`);
      expect(init?.method).toBe('DELETE');
      return Response.json({});
    });
    expect((await receive(rejection('skip'))).status).toBe(200);
    afterTasks.splice(0);
    await sweepInbox({ now: Date.now() + 3 * 60_000 });
    expect(await repo.getOrder(order.id)).toMatchObject({ status: 'cancelled', timeline: { posClosedAt: expect.any(String) } });
    expect((await post(rejection('skip'))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not use a relay receipt against a direct order with the same reference', async () => {
    const parsed = parseRelayOrder(orderPayload('skip'));
    if ('ignored' in parsed) throw new Error(parsed.ignored);
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...parsed.order, viaHub: undefined });
    await repo.updateOrder(order.id, { status: 'ready' });
    expect((await post(rejection('skip'))).status).toBe(200);
    expect(await repo.getOrder(order.id)).toMatchObject({ status: 'ready' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors a receipt written between intake and the Clover creation boundary', async () => {
    const repo = getRepo();
    await repo.upsertStore({
      channel: 'skip', channelStoreId: 'relay:fixture-store-ref', brandName: 'Fixture brand', locationCode: 'FIXTURE_KITCHEN',
      cloverMerchantId: CLOVER_MERCHANT, autoAccept: true, online: true, meta: {},
    });
    let receiptsRead = 0;
    const original = repo.getDoc;
    const getDoc = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, id) => {
      if (collection === 'webhook_inbox' && id.startsWith('relay-cancel:') && ++receiptsRead === 2) {
        expect((await receive(rejection('skip'))).status).toBe(200);
      }
      return original(collection, id);
    });
    try {
      expect((await post(orderPayload('skip'))).status).toBe(200);
      expect(await repo.findOrder('skip', `relay-${HUB_ID}`)).toMatchObject({ status: 'cancelled' });
      expect(receiptsRead).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      getDoc.mockRestore();
      afterTasks.splice(0);
    }
  });

  it('retains a relay order for retry when its cancellation receipt cannot be checked at Clover', async () => {
    const repo = getRepo();
    let receiptsRead = 0;
    const original = repo.getDoc;
    const getDoc = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, id) => {
      if (collection === 'webhook_inbox' && id.startsWith('relay-cancel:') && ++receiptsRead === 2) {
        throw new Error('Fixture checkout read outage');
      }
      return original(collection, id);
    });
    await repo.upsertStore({
      channel: 'skip', channelStoreId: 'relay:fixture-store-ref', brandName: 'Fixture brand', locationCode: 'FIXTURE_KITCHEN',
      cloverMerchantId: CLOVER_MERCHANT, autoAccept: true, online: true, meta: {},
    });
    try {
      expect((await post(orderPayload('skip'))).status).toBe(200);
      const [storedEntry] = await repo.listDocs('webhook_inbox');
      const first = await getInboxEntry(storedEntry.id);
      expect(first).toMatchObject({ status: 'failed', lastError: 'Fixture checkout read outage', attempts: 1 });
      const second = await runInboxEntry(storedEntry.id);
      expect(second).toMatchObject({ status: 'failed', attempts: 2 });
      expect(second?.lastError).toMatch(/previous Clover processing window/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await receive(rejection('skip'))).status).toBe(200);
      afterTasks.splice(0);
      const resumed = await runInboxEntry(storedEntry.id);
      expect(resumed).toMatchObject({ status: 'done', attempts: 3, result: 'order cancelled' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { getDoc.mockRestore(); }
  });

  it('holds an early rejection until the mapped order arrives and never sends the order to Clover', async () => {
    await getRepo().upsertStore({
      channel: 'skip', channelStoreId: 'relay:fixture-store-ref', brandName: 'Fixture brand', locationCode: 'FIXTURE_KITCHEN',
      cloverMerchantId: CLOVER_MERCHANT, autoAccept: true, online: true, meta: {},
    });

    expect((await post(rejection('skip'))).status).toBe(200);
    expect(await getRepo().findOrder('skip', `relay-${HUB_ID}`)).toBeNull();
    expect((await post(orderPayload('skip'))).status).toBe(200);
    const order = await getRepo().findOrder('skip', `relay-${HUB_ID}`);
    if (!order) throw new Error('The relay did not store the arriving order');
    expect(order).toMatchObject({ status: 'cancelled', locationCode: 'FIXTURE_KITCHEN', timeline: { cancelReason: 'Partner rejected the order' } });
    expect(await getRepo().listEvents(order.id)).toContainEqual(expect.objectContaining({
      type: 'platform_status', detail: expect.objectContaining({ partnerState: 'Rejected' }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the relay token and limits a signed status to the order at the stated provider', async () => {
    const skip = await stored('skip');
    const doorDash = await stored('doordash');

    expect((await post(rejection('skip'), null)).status).toBe(401);
    expect(await getRepo().getOrder(skip.id)).toMatchObject({ status: 'ready' });
    expect((await post(rejection('uber_eats'))).status).toBe(200);
    expect(await getRepo().getOrder(skip.id)).toMatchObject({ status: 'ready' });
    expect(await getRepo().getOrder(doorDash.id)).toMatchObject({ status: 'ready' });

    expect((await post(rejection('skip'))).status).toBe(200);
    expect(await getRepo().getOrder(skip.id)).toMatchObject({ status: 'cancelled' });
    expect(await getRepo().getOrder(doorDash.id)).toMatchObject({ status: 'ready' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'completed', 'failed'] as const)('leaves a terminal %s order closed', async (status) => {
    const order = await stored('skip', status);
    expect((await post(rejection('skip'))).status).toBe(200);
    expect((await post({ ...rejection('skip'), new_state: 'Food Ready' })).status).toBe(200);
    expect(await getRepo().getOrder(order.id)).toMatchObject({ status });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['route read', 'timeline write'] as const)('keeps the operator completion when rejection overlaps the %s', async (boundary) => {
    const repo = getRepo();
    const order = await stored('skip');
    vi.stubEnv('FOODHUB_CLOVER_RECORD_PAYMENT', 'off');
    await repo.updateOrder(order.id, { posOrderId: 'SYNTHETICPOS1' });
    const complete = async () => {
      expect(await runOrderAction(order.id, 'complete')).toMatchObject({ order: { status: 'completed' }, result: { ok: true } });
    };
    const findOrder = repo.findOrder;
    const patchOrder = repo.patchOrder;
    const race = boundary === 'route read'
      ? vi.spyOn(repo, 'findOrder').mockImplementationOnce(async (...args) => {
        const snapshot = await findOrder(...args);
        await complete();
        return snapshot;
      })
      : vi.spyOn(repo, 'patchOrder').mockImplementationOnce(async (...args) => {
        await complete();
        return patchOrder(...args);
      });

    try {
      expect((await post(rejection('skip'))).status).toBe(200);
      const current = await repo.getOrder(order.id);
      expect(current).toMatchObject({ status: 'completed', timeline: { completedAt: expect.any(String) } });
      expect(current?.timeline?.cancelledAt).toBeUndefined();
      const events = await repo.listEvents(order.id);
      expect(events.filter((event) => event.type === 'platform_status')).toHaveLength(0);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'platform_status_ignored', detail: expect.objectContaining({ state: 'Rejected', source: 'relay' }),
      }));
      expect((await repo.listActivity()).filter((entry) => entry.action === 'platform_cancel')).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      race.mockRestore();
    }
  });

  it('filters the PostgREST status so a same-timestamp completion wins at the write boundary', async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
    const parsed = parseRelayOrder(orderPayload('skip'));
    if ('ignored' in parsed) throw new Error(parsed.ignored);
    const timestamp = '2026-11-26T14:00:00.000Z';
    let row = {
      id: 'synthetic-order-id', status: 'ready', data: parsed.order, location_code: 'FIXTURE_KITCHEN',
      created_at: timestamp, updated_at: timestamp, timeline: {},
    };
    const cancelledWrites: URLSearchParams[] = [];
    const events: Array<{ type: string; detail: unknown }> = [];
    const actions: string[] = [];
    let inbox: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://db.example.test') throw new Error('Unexpected provider request');
      if (url.pathname === '/rest/v1/fh_docs') {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          inbox = Array.isArray(body) ? body[0] : body;
          return new Response(null, { status: 201 });
        }
        if (init?.method === 'GET') return Response.json(inbox);
      }
      if (url.pathname === '/rest/v1/fh_orders') {
        if (init?.method === 'GET') return Response.json([row]);
        if (init?.method === 'PATCH') {
          const patch = JSON.parse(String(init.body)) as Partial<typeof row>;
          if (patch.status === 'cancelled') {
            cancelledWrites.push(url.searchParams);
            if (row.status === 'ready') {
              const complete = await runOrderAction(row.id, 'complete');
              expect(complete.result.ok).toBe(true);
            }
          }
          const expectedStatus = url.searchParams.get('status');
          if (expectedStatus && expectedStatus !== `eq.${row.status}`) return Response.json([]);
          // The operator and relay writes can share the timestamp at millisecond resolution.
          row = { ...row, ...patch, updated_at: timestamp };
          return Response.json([row]);
        }
      }
      if (init?.method === 'POST' && url.pathname === '/rest/v1/fh_order_events') {
        events.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 201 });
      }
      if (init?.method === 'POST' && url.pathname === '/rest/v1/fh_activity') {
        actions.push(JSON.parse(String(init.body)).action);
        return new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected database fixture request: ${init?.method} ${url.pathname}`);
    });

    expect((await post(rejection('skip'))).status).toBe(200);
    expect(row).toMatchObject({ status: 'completed', timeline: { completedAt: expect.any(String) } });
    expect(row.timeline).not.toHaveProperty('cancelledAt');
    expect(cancelledWrites.map((params) => Object.fromEntries(params))).toEqual([
      expect.objectContaining({ id: `eq.${row.id}`, status: 'eq.ready', updated_at: `eq.${timestamp}` }),
    ]);
    expect(actions).toEqual(['complete']);
    expect(events.map((event) => event.type)).toEqual(['complete', 'platform_status_ignored']);
  });
});
