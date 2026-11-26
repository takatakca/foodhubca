import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as relayWebhook } from '../app/api/foodhub/webhooks/relay/route';
import { parseRelayOrder } from '../lib/foodhub/adapters/relay';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelKey, OrderStatus } from '../lib/foodhub/types';

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (work: () => Promise<void>) => { afterTasks.push(work); },
}));

const URL = 'http://hub.local/api/foodhub/webhooks/relay';
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
  const res = await relayWebhook(new NextRequest(URL, { method: 'POST', headers: authorization, body: JSON.stringify(body) }));
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
});
