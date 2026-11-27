import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as cancelWebhook } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as failedWebhook } from '../app/api/foodhub/webhooks/skip/failed/route';
import { parseSkipFailedOrder } from '../lib/foodhub/adapters/skip';
import { readPending } from '../lib/foodhub/courier';
import { getRepo } from '../lib/foodhub/repo';
import type { OrderStatus } from '../lib/foodhub/types';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (task: () => Promise<void>) => { deferred.push(task); },
}));

const AUTH = 'synthetic-skip-jet-hmac-secret';
const ORDER = 'fixture-skip-order';
const STORE = 'fixture-skip-store';
const KITCHEN = 'FIXTURE_KITCHEN';
const provider = vi.fn<typeof fetch>();

function backup() {
  return {
    validationError: 'unknownReference', unknownReference: 'fixture-plu',
    order: {
      orderId: ORDER, totalPrice: 1199, restaurant: { id: STORE },
      items: [{ name: 'Fixture dish', plu: 'fixture-plu', price: 1199, quantity: 1 }],
    },
  };
}

const cancel = () => ({ orderID: ORDER, reason: { code: 'CUSTOMER_REQUEST' }, happenedAt: new Date().toISOString() });

async function post(kind: 'cancel' | 'failed', payload: ReturnType<typeof backup> | ReturnType<typeof cancel>) {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', AUTH).update(raw).digest('base64');
  const request = new NextRequest(`http://hub.local/api/foodhub/webhooks/skip/${kind}`, {
    method: 'POST', headers: { 'x-jet-connect-hash': `t=${Date.now()},signature=${signature}` }, body: raw,
  });
  const response = await (kind === 'cancel' ? cancelWebhook(request) : failedWebhook(request));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
  for (const task of deferred.splice(0)) await task();
}

async function storeOrder(status: OrderStatus) {
  const parsed = parseSkipFailedOrder(backup());
  if (!parsed) throw new Error('The synthetic backup did not parse');
  const repo = getRepo();
  const { order } = await repo.insertOrderIfNew({ ...parsed, locationCode: KITCHEN });
  const now = new Date().toISOString();
  await repo.patchOrder(order.id, status === 'completed' ? { completedAt: now } : {}, { status });
  const stored = await repo.getOrder(order.id);
  if (!stored) throw new Error('The synthetic order did not persist');
  return stored;
}

async function storedOrder() {
  const order = await getRepo().findOrder('skip', ORDER);
  if (!order) throw new Error('The synthetic order did not persist');
  return order;
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SKIP_WEBHOOK_HMAC_SECRET', AUTH);
  vi.stubEnv('SKIP_WEBHOOK_API_KEY', undefined);
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubGlobal('__foodhubMem', undefined);
  provider.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', provider);
  await getRepo().upsertStore({
    channel: 'skip', channelStoreId: STORE, brandName: 'Fixture brand', locationCode: KITCHEN,
    cloverMerchantId: 'SYNTHETICMID1', autoAccept: true, online: true, meta: {},
  });
});

afterEach(() => {
  expect(deferred).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Skip signed backup order lifecycle', () => {
  it('honors a cancellation received before any order, with no kitchen backup instruction', async () => {
    await post('cancel', cancel());
    expect(await readPending('skip', ORDER)).toMatchObject({ status: { platformState: 'cancelled' } });
    await post('failed', backup());

    const order = await storedOrder();
    expect(order).toMatchObject({ status: 'cancelled', locationCode: KITCHEN, timeline: { cancelReason: 'CUSTOMER_REQUEST', cancelledBy: 'customer' } });
    expect(order.channelError).toBeUndefined();
    expect(await readPending('skip', ORDER)).toBeNull();
    const events = await getRepo().listEvents(order.id);
    expect(events.some((event) => event.type === 'routed_to_skip_tablet')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'skip_backup_ignored', detail: expect.objectContaining({ status: 'cancelled' }) }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'platform_status', detail: expect.objectContaining({ state: 'cancelled', reason: 'CUSTOMER_REQUEST' }),
    }));
  });

  it('honors a cancellation parked between the initial ledger read and insertion', async () => {
    const repo = getRepo();
    const insert = repo.insertOrderIfNew.bind(repo);
    vi.spyOn(repo, 'insertOrderIfNew').mockImplementationOnce(async (input) => {
      await post('cancel', cancel());
      return insert(input);
    });
    await post('failed', backup());
    expect(await storedOrder()).toMatchObject({ status: 'cancelled', timeline: { cancelReason: 'CUSTOMER_REQUEST' } });
  });

  it('keeps the signed notice without opening a kitchen order when the initial ledger read fails', async () => {
    const repo = getRepo();
    vi.spyOn(repo, 'getKv').mockRejectedValueOnce(new Error('Synthetic ledger read failure'));
    const body = backup();
    await post('failed', body);
    expect(await repo.findOrder('skip', ORDER)).toBeNull();
    expect(await repo.listJobs(10)).toContainEqual(expect.objectContaining({
      kind: 'webhook_unparsed', reference: ORDER, request: expect.objectContaining({ body }),
    }));
  });

  it('retains a notice naming another known mapped store without changing the existing kitchen order', async () => {
    const order = await storeOrder('ready');
    const repo = getRepo();
    const otherStore = 'fixture-other-skip-store';
    await repo.upsertStore({
      channel: 'skip', channelStoreId: otherStore, brandName: 'Another fixture',
      locationCode: 'FIXTURE_OTHER_KITCHEN', autoAccept: true, online: true, meta: {},
    });
    const body = backup();
    body.order.restaurant.id = otherStore;
    await post('failed', body);
    expect(await storedOrder()).toEqual(order);
    expect(await repo.listJobs(10)).toContainEqual(expect.objectContaining({
      kind: 'webhook_unparsed', reference: ORDER, request: expect.objectContaining({ body }),
    }));
  });

  it.each(['cancelled', 'completed'] as const)('keeps an already %s order terminal when backup arrives late', async (status) => {
    await storeOrder(status === 'cancelled' ? 'new' : status);
    if (status === 'cancelled') await post('cancel', cancel());
    const before = await storedOrder();
    await post('failed', backup());

    expect(await storedOrder()).toEqual(before);
    const events = await getRepo().listEvents(before.id);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'routed_to_skip_tablet' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'skip_backup_ignored', detail: expect.objectContaining({ status }) }));
  });

  it('lets a signed cancellation win between backup lookup and the status update', async () => {
    const order = await storeOrder('new');
    const repo = getRepo();
    const update = repo.updateOrder.bind(repo);
    const patch = repo.patchOrder.bind(repo);
    let cancelled = false;
    const beforeWrite = async () => {
      if (cancelled) return;
      cancelled = true;
      await post('cancel', cancel());
    };
    vi.spyOn(repo, 'updateOrder').mockImplementation(async (id, extra) => {
      if (id === order.id && extra.status === 'failed') await beforeWrite();
      return update(id, extra);
    });
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (id, timeline, extra, guard) => {
      if (id === order.id && extra?.status === 'failed') await beforeWrite();
      return patch(id, timeline, extra, guard);
    });
    await post('failed', backup());

    expect(cancelled).toBe(true);
    expect(await storedOrder()).toMatchObject({ status: 'cancelled', timeline: { cancelReason: 'CUSTOMER_REQUEST' } });
    const events = await repo.listEvents(order.id);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'routed_to_skip_tablet' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'skip_backup_ignored', detail: expect.objectContaining({ status: 'cancelled' }) }));
  });

  it('records a genuine first backup as a mapped tablet order and echoes the exact partner notice', async () => {
    await post('failed', backup());
    const order = await storedOrder();
    expect(order).toMatchObject({ status: 'failed', locationCode: KITCHEN, total: 11.99, channelError: expect.stringContaining('Make it from the Skip tablet') });
    expect(await getRepo().listEvents(order.id)).toContainEqual(expect.objectContaining({ type: 'routed_to_skip_tablet' }));
  });
});
