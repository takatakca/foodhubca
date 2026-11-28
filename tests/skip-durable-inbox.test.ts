import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as replayInbox } from '../app/api/foodhub/inbox/route';
import { POST as cancelWebhook } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as backupWebhook } from '../app/api/foodhub/webhooks/skip/failed/route';
import { hashPassword } from '../lib/foodhub/auth';
import { readPending } from '../lib/foodhub/courier';
import { INBOX, replayInboxEntry, sweepInbox, type InboxEntry } from '../lib/foodhub/inbox';
import * as mevHooks from '../lib/foodhub/mev/hooks';
import { getRepo } from '../lib/foodhub/repo';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (task: () => Promise<void>) => { deferred.push(task); },
}));

const SECRET = 'synthetic-durable-skip-notice-secret';
const ORDER = 'fixture-durable-skip-order';
const STORE = 'fixture-durable-skip-store';
const KITCHEN = 'FIXTURE_DURABLE_KITCHEN';
const fetchMock = vi.fn<typeof fetch>();

function backup() {
  return {
    validationError: 'unknownReference', unknownReference: 'fixture-item',
    order: {
      orderId: ORDER, totalPrice: 1199, restaurant: { id: STORE },
      items: [{ name: 'Fixture dish', plu: 'fixture-item', price: 1199, quantity: 1 }],
    },
  };
}

function cancellation() {
  return { orderID: ORDER, reason: { code: 'CUSTOMER_REQUEST' }, happenedAt: new Date().toISOString() };
}

function signed(path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const hash = createHmac('sha256', SECRET).update(body).digest('base64');
  return new NextRequest(`http://hub.local/api/foodhub/webhooks/skip/${path}`, {
    method: 'POST', body, headers: { 'x-jet-connect-hash': `t=${Date.now()},signature=${hash}` },
  });
}

async function finishDeferred() {
  for (const work of deferred.splice(0)) await work();
}

async function entries(): Promise<InboxEntry[]> {
  return (await getRepo().listDocs<InboxEntry>(INBOX, { limit: 10 })).map((doc) => doc.data);
}

async function post(path: 'failed' | 'cancel', input: unknown) {
  const response = await (path === 'failed' ? backupWebhook : cancelWebhook)(signed(path, input));
  await finishDeferred();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input);
}

async function retryAt() {
  const entry = (await entries()).find((row) => row.kind === 'skip_backup' && row.reference === ORDER && row.status === 'failed');
  if (!entry?.nextAt) throw new Error('The signed notice did not retain a retry date');
  return Date.parse(entry.nextAt) + 1;
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SKIP_WEBHOOK_HMAC_SECRET', SECRET);
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', fetchMock);
  await getRepo().upsertStore({
    channel: 'skip', channelStoreId: STORE, locationCode: KITCHEN, brandName: 'Fixture brand',
    cloverMerchantId: 'SYNTHETICMID1', autoAccept: true, online: true, meta: {},
  });
});

afterEach(() => {
  expect(deferred).toHaveLength(0);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['failed', 'cancel'] as const)('durably saves a signed %s notice before its successful echo', async (path) => {
  const input = path === 'failed' ? backup() : cancellation();
  const response = await (path === 'failed' ? backupWebhook : cancelWebhook)(signed(path, input));
  const beforeWork = await entries();
  const orderBeforeWork = await getRepo().findOrder('skip', ORDER);
  await finishDeferred();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(input);
  expect(orderBeforeWork).toBeNull();
  expect(beforeWork).toContainEqual(expect.objectContaining({
    kind: path === 'failed' ? 'skip_backup' : 'skip_cancel',
    channel: 'skip', reference: ORDER, body: input, status: 'received',
  }));
});

it.each(['failed', 'cancel'] as const)('asks JET to retry a signed %s notice that could not be durably saved', async (path) => {
  const repo = getRepo();
  const save = repo.putDocs.bind(repo);
  vi.spyOn(repo, 'putDocs').mockImplementation(async (collection, records) => {
    if (collection === INBOX) throw new Error('Synthetic durable inbox write outage');
    return save(collection, records);
  });
  const input = path === 'failed' ? backup() : cancellation();
  const response = await (path === 'failed' ? backupWebhook : cancelWebhook)(signed(path, input));
  await finishDeferred();

  expect(response.status).toBe(503);
  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  expect(await entries()).toEqual([]);
});

it.each(['failed', 'cancel'] as const)('sweeps a signed %s lifecycle notice after a transient transaction error', async (path) => {
  const repo = getRepo();
  const apply = vi.spyOn(repo, 'applySkipLifecycle').mockRejectedValueOnce(new Error('Synthetic lifecycle transaction outage'));
  const input = path === 'failed' ? backup() : cancellation();
  await post(path, input);

  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  expect(await repo.listJobs(10)).not.toContainEqual(expect.objectContaining({ kind: 'webhook_unparsed', reference: ORDER }));
  const [retry] = await entries();
  expect(retry).toMatchObject({
    kind: path === 'failed' ? 'skip_backup' : 'skip_cancel', status: 'failed',
    body: input, attempts: 1, nextAt: expect.any(String),
  });
  if (!retry?.nextAt) throw new Error('The signed notice did not retain a retry date');
  expect(await sweepInbox({ now: Date.parse(retry.nextAt) + 1 })).toEqual({ processed: 1, failed: 0 });
  expect(apply).toHaveBeenCalledTimes(2);
  expect(await entries()).toMatchObject([{ body: input, status: 'done', nextAt: null, attempts: 2 }]);
  if (path === 'failed') {
    expect(await repo.findOrder('skip', ORDER)).toMatchObject({ status: 'failed', locationCode: KITCHEN, total: 11.99 });
  } else {
    expect(await repo.findOrder('skip', ORDER)).toBeNull();
    expect(await readPending('skip', ORDER)).toMatchObject({ status: { platformState: 'cancelled', detail: { reason: 'CUSTOMER_REQUEST' } } });
  }
});

it('holds an order out of the kitchen after a transaction failure and honors a cancellation before the backup retry', async () => {
  const repo = getRepo();
  vi.spyOn(repo, 'applySkipLifecycle').mockRejectedValueOnce(new Error('Synthetic lifecycle transaction outage'));
  await post('failed', backup());
  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  const due = await retryAt();

  await post('cancel', cancellation());
  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  expect(await sweepInbox({ now: due })).toEqual({ processed: 1, failed: 0 });
  const order = await repo.findOrder('skip', ORDER);
  expect(order).toMatchObject({ status: 'cancelled', locationCode: KITCHEN, timeline: { cancelReason: 'CUSTOMER_REQUEST' } });
  if (!order) throw new Error('The cancelled fixture order was not saved');
  expect(await repo.listEvents(order.id)).not.toContainEqual(expect.objectContaining({ type: 'routed_to_skip_tablet' }));
  expect(await readPending('skip', ORDER)).toBeNull();
});

it('honors a signed cancellation already acknowledged and stored even if its own worker has not run', async () => {
  const repo = getRepo();
  const invoice = vi.spyOn(mevHooks, 'mevOnOrderChange');
  const cancelBody = cancellation();
  const cancelResponse = await cancelWebhook(signed('cancel', cancelBody));
  expect(cancelResponse.status).toBe(200);
  expect(await cancelResponse.json()).toEqual(cancelBody);
  expect(await entries()).toMatchObject([{ kind: 'skip_cancel', status: 'received', body: cancelBody }]);
  const [delayedCancel] = deferred.splice(0);
  if (!delayedCancel) throw new Error('The signed cancellation did not schedule its worker');
  expect(await readPending('skip', ORDER)).toBeNull();

  await post('failed', backup());
  const order = await repo.findOrder('skip', ORDER);
  if (!order) throw new Error('The cancelled fixture order was not saved');
  expect(order).toMatchObject({ status: 'cancelled', locationCode: KITCHEN, timeline: { cancelReason: 'CUSTOMER_REQUEST' } });
  expect(order.posOrderId).toBeUndefined();
  expect(order.channelError).toBeUndefined();
  expect(await repo.listEvents(order.id)).not.toContainEqual(expect.objectContaining({ type: 'routed_to_skip_tablet' }));
  expect(invoice).not.toHaveBeenCalled();
  expect((await entries()).find((row) => row.kind === 'skip_cancel')).toMatchObject({ status: 'received' });

  await delayedCancel();
  expect((await entries()).find((row) => row.kind === 'skip_cancel')).toMatchObject({ status: 'done', orderId: order.id });
  expect(await repo.getOrder(order.id)).toMatchObject({ status: 'cancelled' });
  expect((await repo.listEvents(order.id)).filter((event) => event.type === 'platform_status')).toHaveLength(1);
});

it('records only one kitchen handoff when the valid signed backup notice is delivered twice', async () => {
  const body = backup();
  await post('failed', body);
  await post('failed', body);
  const repo = getRepo();
  const order = await repo.findOrder('skip', ORDER);
  if (!order) throw new Error('The tablet fixture order did not persist');
  expect(order).toMatchObject({ status: 'failed', locationCode: KITCHEN });
  expect(await repo.listOrders()).toHaveLength(1);
  expect((await repo.listEvents(order.id)).filter((event) => event.type === 'routed_to_skip_tablet')).toHaveLength(1);
  expect(await entries()).toHaveLength(2);
  expect((await entries()).every((row) => row.kind === 'skip_backup' && row.status === 'done')).toBe(true);
});

it('recovers a retained backup outside the new-order cutoff because it only records existing tablet handoff evidence', async () => {
  const input = backup();
  const response = await backupWebhook(signed('failed', input));
  expect(response.status).toBe(200);
  const [entry] = await entries();
  expect(entry).toMatchObject({ status: 'received', kind: 'skip_backup' });
  // Simulate a process loss after the durable webhook acknowledgment and before its deferred function ran.
  expect(deferred.splice(0)).toHaveLength(1);
  expect(await getRepo().findOrder('skip', ORDER)).toBeNull();

  expect(await sweepInbox({ now: Date.parse(entry.receivedAt) + 2 * 3600_000 })).toEqual({ processed: 1, failed: 0 });
  expect(await getRepo().findOrder('skip', ORDER)).toMatchObject({ status: 'failed', locationCode: KITCHEN });
});

it('allows only a manager in the mapped kitchen to replay a retained backup', async () => {
  const repo = getRepo();
  const apply = vi.spyOn(repo, 'applySkipLifecycle').mockRejectedValueOnce(new Error('Synthetic lifecycle transaction outage'));
  await post('failed', backup());
  const [entry] = await entries();
  const staff = { username: 'fixture-manager', name: 'Fixture manager', source: 'dashboard' as const };

  expect(await replayInboxEntry(entry.id, { ...staff, locations: ['FIXTURE_OTHER'] })).toBeNull();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  expect(await replayInboxEntry(entry.id, { ...staff, locations: [KITCHEN] })).toMatchObject({ status: 'done' });
  expect(await repo.findOrder('skip', ORDER)).toMatchObject({ status: 'failed', locationCode: KITCHEN });
});

it('replays a legacy retained backup only in its mapped kitchen and never as new order intake', async () => {
  const repo = getRepo();
  const password = 'synthetic-skip-durable-manager';
  const passwordHash = hashPassword(password);
  for (const [username, location] of [['local-manager', KITCHEN], ['other-manager', 'FIXTURE_OTHER']]) {
    await repo.saveUser({ username, name: username, role: 'manager', locations: [location], active: true, passwordHash });
  }
  const input = backup();
  const job = await repo.addJob({
    kind: 'webhook_unparsed', channel: 'skip', status: 'error', reference: ORDER,
    request: { body: input, label: `skip failed order ${ORDER}` }, result: { reason: 'Synthetic previous notice fault' },
  });
  const replay = (username: string) => replayInbox(new Request('http://hub.local/api/foodhub/inbox', {
    method: 'POST', body: JSON.stringify({ jobId: job.id }),
    headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  }), undefined);

  expect((await replay('other-manager')).status).toBe(404);
  expect(await entries()).toEqual([]);
  expect(await repo.findOrder('skip', ORDER)).toBeNull();
  expect((await replay('local-manager')).status).toBe(200);

  const order = await repo.findOrder('skip', ORDER);
  expect(order).toMatchObject({ status: 'failed', locationCode: KITCHEN });
  expect(await entries()).toEqual([expect.objectContaining({ kind: 'skip_backup', status: 'done', body: input, orderId: order?.id })]);
  expect(await repo.listJobs(10)).toContainEqual(expect.objectContaining({ id: job.id, status: 'done' }));
});
