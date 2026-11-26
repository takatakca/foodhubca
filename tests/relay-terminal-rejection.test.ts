import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as relayWebhook } from '../app/api/foodhub/webhooks/relay/route';
import { parseRelayOrder } from '../lib/foodhub/adapters/relay';
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

async function post(body: unknown, token: string | null = SECRET) {
  const authorization = token ? { authorization: `Bearer ${token}` } : undefined;
  const res = await relayWebhook(new NextRequest(RELAY_URL, { method: 'POST', headers: authorization, body: JSON.stringify(body) }));
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
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://db.example.test') throw new Error('Unexpected provider request');
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
