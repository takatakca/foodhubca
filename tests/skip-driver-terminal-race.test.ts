import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as receiveCancel } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as receiveDriver } from '../app/api/foodhub/webhooks/skip/driver/route';
import { POST as receiveBackup } from '../app/api/foodhub/webhooks/skip/failed/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { CHANNEL_LABELS } from '../lib/foodhub/config';
import { INBOX, type InboxEntry } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const deferred = vi.hoisted(() => [] as Array<() => Promise<unknown>>);
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (work: () => Promise<unknown>) => { deferred.push(work); },
}));

const SECRET = 'fixture-skip-driver-signature';
const ORDER = 'fixture-order';
const STORE = 'fixture-store';
const MERCHANT = 'fixture-merchant';
const POS = 'fixture-pos-order';
const CLOVER = 'https://clover.fixture.invalid';
const provider = vi.fn<typeof fetch>();

function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}

async function receive(kind: 'driver' | 'cancel' | 'failed', body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const hash = createHmac('sha256', SECRET).update(raw).digest('base64');
  const request = new NextRequest(`http://hub.local/api/foodhub/webhooks/skip/${kind}`, {
    method: 'POST', headers: { 'X-JET-Connect-Hash': `HMAC-SHA256 t=${Date.now()},signature=${hash}` }, body: raw,
  });
  const route = { driver: receiveDriver, cancel: receiveCancel, failed: receiveBackup }[kind];
  const previous = deferred.length;
  const reply = await route(request);
  expect(reply.status).toBe(200);
  expect(await reply.json()).toEqual(body);
  const scheduled = deferred.splice(previous);
  expect(scheduled).toHaveLength(1);
  return scheduled[0];
}

const driver = (code: string) => ({ orderID: ORDER, driverStatus: { code }, happenedAt: new Date().toISOString() });
const cancel = () => ({ orderID: ORDER, reason: { code: 'CUSTOMER_REQUEST' }, happenedAt: new Date().toISOString() });
const backup = () => ({ validationError: 'fixture backup reason', order: {
  orderId: ORDER, totalPrice: 1150, restaurant: { id: STORE }, items: [{ name: 'Fixture meal', plu: 'fixture-dish', price: 1150, quantity: 1 }],
} });

async function seed() {
  const repo = getRepo();
  const normalized = parseSkipOrder({ id: ORDER, posLocationId: STORE, type: 'delivery-by-delivery-partner', created_at: new Date().toISOString(),
    items: [{ name: 'Fixture meal', price: 1000, quantity: 1 }], payment: { items_in_cart: { inc_tax: 1150, tax: 150 }, final: { inc_tax: 1150, tax: 150 } },
  })!;
  const { order } = await repo.insertOrderIfNew({ ...normalized, locationCode: 'FIXTURE_KITCHEN' });
  await repo.patchOrder(order.id, { posMerchantId: MERCHANT, acceptedAt: new Date().toISOString() }, { status: 'accepted', posOrderId: POS });
  return order.id;
}

beforeEach(async () => {
  vi.stubGlobal('__foodhubMem', undefined);
  deferred.length = 0;
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('SKIP_WEBHOOK_HMAC_SECRET', SECRET);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'fixture-clover-token');
  vi.stubEnv('CLOVER_MERCHANT_ID', MERCHANT);
  vi.stubEnv('CLOVER_BASE_URL', CLOVER);
  vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'off');
  vi.stubEnv('FOODHUB_CLOVER_RECORD_PAYMENT', 'on');
  provider.mockReset().mockImplementation(async (input, init) => {
    const { origin, pathname } = new URL(String(input));
    expect(origin).toBe(CLOVER);
    if (pathname.endsWith('/tenders')) return Response.json({ elements: [{ id: 'fixture-tender', label: CHANNEL_LABELS.skip }] });
    if (pathname.endsWith(`/orders/${POS}/payments`) && init?.method === 'POST') return Response.json({ id: 'fixture-payment' });
    throw new Error('Unexpected fixture provider call');
  });
  vi.stubGlobal('fetch', provider);
  await getRepo().upsertStore({ channel: 'skip', channelStoreId: STORE, brandName: 'Fixture', locationCode: 'FIXTURE_KITCHEN',
    cloverMerchantId: MERCHANT, autoAccept: false, online: true, meta: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Skip driver observations cannot reopen a terminal order', () => {
  it.each([
    { notice: 'cancel', terminal: 'cancelled', signal: 'onItsWay', courier: 'picked_up' },
    { notice: 'failed', terminal: 'failed', signal: 'driverAtRestaurant', courier: 'at_store' },
  ] as const)('preserves $terminal when signed $signal was already applying', async ({ notice, terminal, signal, courier }) => {
    const repo = getRepo();
    const id = await seed();
    const reached = gate();
    const allowed = gate();
    let heldFirstCourier = false;
    const pauseCourier = async () => {
      if (heldFirstCourier) return;
      heldFirstCourier = true;
      reached.release();
      await allowed.waiting;
    };
    const patch = repo.patchOrder.bind(repo);
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (key, timeline, fields, guard) => {
      if (key === id && timeline.courier?.source === 'skip:driver_status') await pauseCourier();
      return patch(key, timeline, fields, guard);
    });
    const apply = repo.applySkipLifecycle.bind(repo);
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (input.kind === 'apply_driver' && input.orderId === id) await pauseCourier();
      return apply(input);
    });
    const worker = await receive('driver', driver(signal));
    const applying = worker();
    const paused = await Promise.race([reached.waiting.then(() => true), applying.then(() => false)]);
    expect(paused).toBe(true);
    try {
      expect(await repo.getOrder(id)).toMatchObject({ status: 'accepted' });
      const finish = await receive(notice, notice === 'cancel' ? cancel() : backup());
      await finish();
      const committed = await repo.getOrder(id);
      expect(committed?.status).toBe(terminal);
      expect(provider).not.toHaveBeenCalled();
    } finally {
      allowed.release();
      await applying;
    }
    const latest = await repo.getOrder(id);
    expect({ status: latest?.status, courier: latest?.timeline?.courier?.status, cloverRequests: provider.mock.calls.map(([url]) => String(url)) })
      .toEqual({ status: terminal, courier, cloverRequests: [] });
    expect(latest?.timeline?.posPaymentId).toBeUndefined();
    expect((await repo.listEvents(id)).filter((event) => event.type === 'courier')).toHaveLength(1);
  });

  it('retains tablet handoff when a later signed delivered notice arrives', async () => {
    const repo = getRepo();
    const id = await seed();
    await (await receive('failed', backup()))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'failed' });
    await (await receive('driver', driver('delivered')))();
    const latest = await repo.getOrder(id);
    expect({ status: latest?.status, courier: latest?.timeline?.courier?.status, cloverRequests: provider.mock.calls.map(([url]) => String(url)) })
      .toEqual({ status: 'failed', courier: 'delivered', cloverRequests: [] });
    expect(latest?.timeline?.posPaymentId).toBeUndefined();
  });

  it.each([
    { route: 'cancel', kind: 'skip_cancel', terminal: 'cancelled', type: 'platform_status' },
    { route: 'failed', kind: 'skip_backup', terminal: 'failed', type: 'routed_to_skip_tablet' },
  ] as const)('honors a saved signed $kind even while its worker has not run', async ({ route, kind, terminal, type }) => {
    const repo = getRepo();
    const id = await seed();
    const notice = route === 'cancel' ? cancel() : backup();
    const applyNotice = await receive(route, notice);
    expect((await repo.listDocs<InboxEntry>(INBOX)).map(({ data }) => data)).toContainEqual(expect.objectContaining({
      kind, status: 'received', body: notice,
    }));
    expect(await repo.getOrder(id)).toMatchObject({ status: 'accepted', posOrderId: POS, timeline: { posMerchantId: MERCHANT } });

    try {
      await (await receive('driver', driver('onItsWay')))();
      const latest = await repo.getOrder(id);
      expect({ status: latest?.status, courier: latest?.timeline?.courier?.status, cloverRequests: provider.mock.calls.map(([url]) => String(url)) })
        .toEqual({ status: terminal, courier: 'picked_up', cloverRequests: [] });
      expect(latest?.timeline?.posPaymentId).toBeUndefined();
    } finally {
      await applyNotice();
    }
    expect((await repo.listEvents(id)).filter((event) => event.type === type)).toHaveLength(1);
  });

  it('rechecks signed cancellation right before settling an already committed driver advance', async () => {
    const repo = getRepo();
    const id = await seed();
    const apply = repo.applySkipLifecycle.bind(repo);
    const pending: Array<() => Promise<unknown>> = [];
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      const result = await apply(input);
      if (input.kind === 'apply_driver' && result.driverAdvanced) {
        expect(result.order?.status).toBe('dispatched');
        pending.push(await receive('cancel', cancel()));
      }
      return result;
    });
    try {
      await (await receive('driver', driver('onItsWay')))();
      const latest = await repo.getOrder(id);
      expect(pending).toHaveLength(1);
      expect(latest).toMatchObject({ status: 'cancelled', timeline: { courier: { status: 'picked_up' } } });
      expect(provider).not.toHaveBeenCalled();
    } finally {
      for (const finish of pending) await finish();
    }
  });

  it.each([true, false])('stops Clover writes when a signed cancellation is saved during tender lookup (existing tender: %s)', async (hasTender) => {
    const repo = getRepo();
    const id = await seed();
    const fetchingTender = gate();
    const tenderArrived = gate();
    const mock = provider.getMockImplementation()!;
    provider.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/tenders')) {
        fetchingTender.release();
        await tenderArrived.waiting;
        if (!hasTender) return Response.json({ elements: [] });
      }
      return mock(input, init);
    });

    const run = (await receive('driver', driver('onItsWay')))();
    const fetching = await Promise.race([fetchingTender.waiting.then(() => true), run.then(() => false)]);
    expect(fetching).toBe(true);
    let finishCancel: (() => Promise<unknown>) | undefined;
    try {
      expect(await repo.getOrder(id)).toMatchObject({ status: 'dispatched' });
      finishCancel = await receive('cancel', cancel());
    } finally {
      tenderArrived.release();
      await run;
    }
    try {
      expect(provider.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
      expect(await repo.getOrder(id)).toMatchObject({ status: 'cancelled', timeline: { courier: { status: 'picked_up' } } });
      expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBeUndefined();
    } finally {
      await finishCancel?.();
    }
  });

  it('stops a retry after Clover refuses an attempt with HTTP 429 and Skip cancels', async () => {
    const repo = getRepo();
    const id = await seed();
    const mock = provider.getMockImplementation()!;
    let finishCancel: (() => Promise<unknown>) | undefined;
    provider.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/payments') && init?.method === 'POST' && !finishCancel) {
        finishCancel = await receive('cancel', cancel());
        return Response.json({ message: 'Fixture rate limit' }, { status: 429, headers: { 'Retry-After': '0' } });
      }
      return mock(input, init);
    });
    try {
      await (await receive('driver', driver('onItsWay')))();
      expect(finishCancel).toBeDefined();
      expect(await repo.getOrder(id)).toMatchObject({ status: 'cancelled', timeline: { courier: { status: 'picked_up' } } });
      expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBeUndefined();
      expect(provider.mock.calls.filter(([url, init]) => String(url).endsWith('/payments') && init?.method === 'POST')).toHaveLength(1);
    } finally {
      await finishCancel?.();
    }
  });

  it('uses the confirmed receipt merchant even when a store changes its configured register', async () => {
    const repo = getRepo();
    const id = await seed();
    const store = (await repo.findStore('skip', STORE))!;
    await repo.updateStore(store.id, { cloverMerchantId: 'fixture-replacement-merchant' });
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ 'fixture-replacement-merchant': 'fixture-replacement-token' }));
    await (await receive('driver', driver('onItsWay')))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'dispatched', timeline: { posMerchantId: MERCHANT, posPaymentId: 'fixture-payment' } });
    expect(provider.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => new URL(String(url)).pathname))
      .toEqual([`/v3/merchants/${MERCHANT}/orders/${POS}/payments`]);
  });

  it('keeps existing driver details and records a real progress update once in the simulated Clover ledger', async () => {
    const repo = getRepo();
    const id = await seed();
    const etaAt = new Date().toISOString();
    await repo.patchOrder(id, { courier: { status: 'assigned', name: 'Fixture courier', etaAt, source: 'fixture', updatedAt: etaAt } });
    await (await receive('driver', driver('onItsWay')))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'dispatched', timeline: {
      courier: { status: 'picked_up', name: 'Fixture courier', etaAt, source: 'skip:driver_status' }, posPaymentId: 'fixture-payment',
    } });
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('driver', driver('delivered')))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'completed', timeline: {
      courier: { status: 'delivered', name: 'Fixture courier', etaAt }, posPaymentId: 'fixture-payment',
    } });
    expect(provider.mock.calls.filter(([url, init]) => String(url).endsWith('/payments') && init?.method === 'POST')).toHaveLength(1);
  });
});
