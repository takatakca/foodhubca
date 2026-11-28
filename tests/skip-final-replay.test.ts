import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as replayInbox } from '../app/api/foodhub/inbox/route';
import { POST as finalWebhook } from '../app/api/foodhub/webhooks/skip/final/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { hashPassword } from '../lib/foodhub/auth';
import { INBOX } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (task: () => Promise<void>) => { deferred.push(task); },
}));

const AUTH = 'synthetic-jet-signing-key';
const PASSWORD = 'synthetic-replay-owner-password';
const STORE = 'fixture-skip-store';
const KITCHEN = 'FIXTURE_KITCHEN';
const fetchMock = vi.fn<typeof fetch>();

function payload(id = 'fixture-picked', total = 700) {
  return {
    id, posLocationId: STORE, created_at: new Date().toISOString(), type: 'collection',
    payment: { items_in_cart: { inc_tax: total, tax: 0 }, final: { inc_tax: total, tax: 0 } },
    items: [{ name: 'Fixture dish', plu: 'fixture-plu', quantity: 1, price: total }],
  };
}

async function sendFinal(body: ReturnType<typeof payload>) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', AUTH).update(raw).digest('base64');
  const response = await finalWebhook(new NextRequest('http://hub.local/api/foodhub/webhooks/skip/final', {
    method: 'POST', body: raw, headers: { 'x-jet-connect-hash': `t=${Date.now()},signature=${signature}` },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ OrderId: body.id });
  for (const task of deferred.splice(0)) await task();
}

const replay = (jobId: string, login = 'owner') => replayInbox(new Request('http://hub.local/api/foodhub/inbox', {
  method: 'POST', body: JSON.stringify({ jobId }),
  headers: { authorization: `Basic ${Buffer.from(`${login}:${PASSWORD}`).toString('base64')}` },
}), undefined);

async function latestJob() {
  const job = (await getRepo().listJobs(10)).find((row) => row.kind === 'webhook_unparsed');
  if (!job) throw new Error('The fixture notice was not retained');
  return job;
}

async function expectHeld(job: Awaited<ReturnType<typeof latestJob>>, orderId: string) {
  const result = await replay(job.id);
  expect(await getRepo().findOrder('skip', orderId)).toBeNull();
  expect(result.status).toBe(422);
  expect(await result.json()).toMatchObject({
    error: 'This Skip final-picked notice is kept for reconciliation and cannot be replayed as a new order.',
  });
  expect(await latestJob()).toEqual(job);
  expect(await getRepo().listDocs(INBOX, { limit: 10 })).toEqual([]);
}

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SKIP_WEBHOOK_HMAC_SECRET', AUTH);
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('FOODHUB_POS_INJECTION', 'off');
  vi.stubEnv('CLOVER_MERCHANT_ID', undefined);
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', fetchMock);
  await getRepo().upsertStore({
    channel: 'skip', channelStoreId: STORE, brandName: 'Fixture brand', locationCode: KITCHEN,
    autoAccept: false, online: true, meta: {},
  });
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(deferred).toHaveLength(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Skip final-picked notification replay', () => {
  it('acknowledges the signed early financial notice and preserves it without creating an order on Replay', async () => {
    const body = payload();
    await sendFinal(body);
    const job = await latestJob();
    expect(job.request).toMatchObject({ body, notice: 'skip_final_picked' });
    await expectHeld(job, body.id);
  });

  it.each([
    { request: {}, reason: 'Skip final picked order for an order Food Hub does not have (yet)' },
    { request: { label: 'skip final order fixture-picked' }, reason: 'Synthetic original processing fault' },
  ])('protects a legacy retained final notice with recognizable evidence', async ({ request, reason }) => {
    const body = payload();
    const job = await getRepo().addJob({
      kind: 'webhook_unparsed', channel: 'skip', status: 'error', reference: body.id,
      request: { body, ...request }, result: { reason },
    });
    await expectHeld(job, body.id);
  });

  it('keeps explicit provenance on a deferred handling failure of a signed final notice', async () => {
    const repo = getRepo();
    vi.spyOn(repo, 'findOrder').mockRejectedValueOnce(new Error('Synthetic final-order lookup outage'));
    const body = payload();
    await sendFinal(body);
    const job = await latestJob();
    expect(job.request).toMatchObject({ body, notice: 'skip_final_picked', label: `skip final order ${body.id}` });
    await expectHeld(job, body.id);
  });

  it('keeps the existing replay permission for a location-scoped account', async () => {
    await sendFinal(payload());
    const job = await latestJob();
    await getRepo().saveUser({
      username: 'other-manager', name: 'Fixture manager', role: 'manager', locations: ['FIXTURE_OTHER'],
      active: true, passwordHash: hashPassword(PASSWORD),
    });
    expect((await replay(job.id, 'other-manager')).status).toBe(404);
    expect(await latestJob()).toEqual(job);
  });

  it('still replays retained initial-order input from its legitimate source', async () => {
    const body = payload('fixture-direct');
    const job = await getRepo().addJob({
      kind: 'webhook_unparsed', channel: 'skip', status: 'error', reference: body.id,
      request: { body }, result: { reason: 'JET Connect order could not be read earlier' },
    });
    expect((await replay(job.id)).status).toBe(200);
    expect(await getRepo().findOrder('skip', body.id)).toMatchObject({ locationCode: KITCHEN, status: 'new', total: 7 });
    expect(await latestJob()).toMatchObject({ id: job.id, status: 'done' });
  });

  it('still reconciles a signed final notice for an existing order', async () => {
    const initial = parseSkipOrder(payload('fixture-existing', 900));
    if (!initial) throw new Error('The fixture order did not parse');
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...initial, locationCode: KITCHEN });
    await repo.patchOrder(order.id, {}, { status: 'completed' });
    await sendFinal(payload(initial.externalOrderId, 700));

    expect(await repo.getOrder(order.id)).toMatchObject({ total: 7, status: 'completed' });
    expect(await repo.listEvents(order.id)).toContainEqual(expect.objectContaining({ type: 'skip_final_picked' }));
  });
});
