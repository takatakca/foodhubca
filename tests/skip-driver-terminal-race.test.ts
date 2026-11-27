import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { POST as receiveCancel } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as receiveDriver } from '../app/api/foodhub/webhooks/skip/driver/route';
import { POST as receiveBackup } from '../app/api/foodhub/webhooks/skip/failed/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { CHANNEL_LABELS } from '../lib/foodhub/config';
import { INBOX, type InboxEntry } from '../lib/foodhub/inbox';
import { externalPaymentId } from '../lib/foodhub/pos/clover-books';
import { getRepo } from '../lib/foodhub/repo';
import { recoverSkipCloverPayments } from '../lib/foodhub/skip-payment-recovery';

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

  it('does not send the same Clover receipt twice while the first payment response is pending', async () => {
    const id = await seed();
    const sendingPayment = gate();
    const paymentReply = gate();
    const mock = provider.getMockImplementation()!;
    let posts = 0;
    provider.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/payments') && init?.method === 'POST') {
        posts += 1;
        if (posts === 1) {
          sendingPayment.release();
          await paymentReply.waiting;
        }
      }
      return mock(input, init);
    });
    const pickup = (await receive('driver', driver('onItsWay')))();
    const started = await Promise.race([sendingPayment.waiting.then(() => true), pickup.then(() => false)]);
    expect(started).toBe(true);
    try {
      await (await receive('driver', driver('delivered')))();
      expect(await getRepo().getOrder(id)).toMatchObject({ status: 'completed' });
    } finally {
      paymentReply.release();
      await pickup;
    }
    expect(await getRepo().getOrder(id)).toMatchObject({ status: 'completed', timeline: { posPaymentId: 'fixture-payment' } });
    expect(posts).toBe(1);
  });

  it('keeps an already-started payment open through signed cancellation until the exact response is recorded', async () => {
    const repo = getRepo();
    const id = await seed();
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const sending = gate();
    const received = gate();
    const mock = provider.getMockImplementation()!;
    provider.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/payments') && init?.method === 'POST') {
        sending.release();
        await received.waiting;
      }
      return mock(input, init);
    });

    const driverRun = (await receive('driver', driver('onItsWay')))();
    expect(await Promise.race([sending.waiting.then(() => true), driverRun.then(() => false)])).toBe(true);
    try {
      await (await receive('cancel', cancel()))();
      const cancelled = await repo.getOrder(id);
      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(cancelled?.timeline?.posClosedAt).toBeUndefined();
      expect(provider.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    } finally {
      received.release();
      await driverRun;
    }
    expect(await repo.getOrder(id)).toMatchObject({ status: 'cancelled', timeline: { posPaymentId: 'fixture-payment', posClosedAt: expect.any(String) } });
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'pos_paid')).toHaveLength(1);
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'pos_paid_then_cancelled')).toHaveLength(1);
    expect(provider.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });

  it.each([409, 502, 200, 'timeout', 'wrong reference'] as const)('holds the same physical receipt when the payment outcome is %s', async (status) => {
    const repo = getRepo();
    const id = await seed();
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const mock = provider.getMockImplementation()!;
    let posts = 0;
    provider.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/payments')) {
        if (init?.method !== 'POST') return Response.json({ elements: [] });
        posts += 1;
        if (status === 'timeout') throw new Error('fixture timeout');
        if (status === 'wrong reference') return Response.json({ id: 'fixture-other-payment', externalPaymentId: 'fixture-other-reference' });
        return Response.json({}, { status });
      }
      return mock(input, init);
    });
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('driver', driver('delivered')))();
    await (await receive('cancel', cancel()))();
    const order = (await repo.getOrder(id))!;
    expect(order.status).toBe('cancelled');
    expect(order.timeline?.posPaymentError).toContain('payment needs review');
    expect(order.timeline?.posPaymentId).toBeUndefined();
    expect(order.timeline?.posClosedAt).toBeUndefined();
    expect(provider.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    expect(posts).toBe(1);
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'needs_attention')).toHaveLength(1);
  });

  it('reconciles one exact successful Clover payment on a replay without another POST', async () => {
    const repo = getRepo();
    const id = await seed();
    const reference = externalPaymentId((await repo.getOrder(id))!);
    const mock = provider.getMockImplementation()!;
    let proof = false;
    let posts = 0;
    provider.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/payments')) {
        expect(new URL(String(input)).pathname).toBe(`/v3/merchants/${MERCHANT}/orders/${POS}/payments`);
        if (init?.method === 'POST') {
          posts += 1;
          throw new Error('fixture lost response');
        }
        return Response.json({ elements: [
          { id: 'fixture-wrong-order', externalPaymentId: reference, result: 'SUCCESS', order: { id: 'different-order' } },
          ...(proof ? [{ id: 'fixture-recovered', externalPaymentId: reference, result: 'SUCCESS', order: { id: POS } }] : []),
        ] });
      }
      return mock(input, init);
    });
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('driver', driver('onItsWay')))();
    expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBeUndefined();
    proof = true;
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('driver', driver('delivered')))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'completed', timeline: { posPaymentId: 'fixture-recovered' } });
    expect((await repo.getOrder(id))?.timeline?.posPaymentError).toBeUndefined();
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'pos_paid')).toHaveLength(1);
    expect(posts).toBe(1);
  });

  it.each([
    { state: 'dispatched', exactProof: true },
    { state: 'cancelled', exactProof: true },
    { state: 'cancelled', exactProof: false },
  ] as const)('sweeps dormant $state payment claims with exact Clover proof=$exactProof', async ({ state, exactProof }) => {
    const repo = getRepo();
    const start = Date.parse('2026-11-27T05:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    try {
      const id = await seed();
      const reference = externalPaymentId((await repo.getOrder(id))!);
      const path = `/v3/merchants/${MERCHANT}/orders/${POS}/payments`;
      const store = (await repo.findStore('skip', STORE))!;
      const schedulerKey = 'fixture-skip-recovery-cron';
      vi.stubEnv('CRON_SECRET', schedulerKey);
      vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
      vi.stubEnv('FOODHUB_CLOVER_WEBSITE_ORDERS', 'off');
      vi.stubEnv('FOODHUB_MEV_CLOVER_REGISTER', 'off');
      vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
      vi.stubEnv('TGTG_IMAP_HOST', '');
      const defaultFetch = provider.getMockImplementation()!;
      let showExactPayment = false;
      provider.mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/payments')) return defaultFetch(input, init);
        expect(url.origin).toBe(CLOVER);
        expect(url.pathname).toBe(path);
        if (init?.method === 'POST') throw new Error('Fixture Clover accepted payment but the response was lost');
        expect(init?.method ?? 'GET').toBe('GET');
        return Response.json({ elements: [
          { id: 'fixture-wrong-order', externalPaymentId: reference, result: 'SUCCESS', order: { id: 'different-order' } },
          { id: 'fixture-wrong-reference', externalPaymentId: 'another-reference', result: 'SUCCESS', order: { id: POS } },
          ...(showExactPayment ? [{ id: 'fixture-recovered', externalPaymentId: reference, result: 'SUCCESS', order: { id: POS } }] : []),
        ] });
      });

      await (await receive('driver', driver('onItsWay')))();
      if (state === 'cancelled') await (await receive('cancel', cancel()))();
      const held = (await repo.getOrder(id))!;
      expect(held).toMatchObject({ status: state, timeline: { posPaymentError: expect.stringContaining('payment needs review') } });
      expect(held.timeline?.posPaymentId).toBeUndefined();
      expect(held.timeline?.posClosedAt).toBeUndefined();
      expect(provider.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      const completedInbox = await repo.listDocs<InboxEntry>(INBOX);
      expect(completedInbox.map(({ data }) => [data.kind, data.status])).toEqual(state === 'cancelled' ? [['skip_cancel', 'done']] : []);

      // The register mapping changed after the payment; proof must still come from the attested receipt.
      await repo.updateStore(store.id, { cloverMerchantId: 'fixture-replacement-merchant' });
      showExactPayment = exactProof;
      provider.mockClear();
      vi.setSystemTime(start + 5 * 60_000);
      const response = await cronWatch(new NextRequest('http://hub.local/api/foodhub/cron/watch', {
        headers: { authorization: `Bearer ${schedulerKey}` },
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ recovery: { ran: true, inbox: { processed: 0, failed: 0 } } });
      expect(await repo.listDocs<InboxEntry>(INBOX)).toEqual(completedInbox);
      const latest = (await repo.getOrder(id))!;
      const events = (await repo.listEvents(id)).map(({ type }) => type);
      expect({
        state: latest.status,
        paid: latest.timeline?.posPaymentId,
        closed: Boolean(latest.timeline?.posClosedAt),
        review: Boolean(latest.timeline?.posPaymentError),
        payments: events.filter((type) => type === 'pos_paid').length,
        closures: events.filter((type) => type === 'pos_paid_then_cancelled').length,
        requests: provider.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method ?? 'GET']),
      }).toEqual({
        state,
        paid: exactProof ? 'fixture-recovered' : undefined,
        closed: exactProof && state === 'cancelled',
        review: !exactProof,
        payments: exactProof ? 1 : 0,
        closures: exactProof && state === 'cancelled' ? 1 : 0,
        requests: [[path, 'GET']],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('claims one provider read across workers and waits before looking up held proof again', async () => {
    const repo = getRepo();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      const id = await seed();
      provider.mockImplementation(async (input, init) => {
        expect(new URL(String(input)).origin).toBe(CLOVER);
        if (new URL(String(input)).pathname.endsWith('/tenders')) return Response.json({ elements: [{ id: 'fixture-tender', label: CHANNEL_LABELS.skip }] });
        if (init?.method === 'POST') throw new Error('fixture ambiguous Clover payment');
        return Response.json({ elements: [] });
      });
      await (await receive('driver', driver('onItsWay')))();
      provider.mockClear();
      vi.setSystemTime(now + 2 * 60_000);
      const results = await Promise.all([recoverSkipCloverPayments(Date.now()), recoverSkipCloverPayments(Date.now())]);
      expect(results.map(({ claimed }) => claimed).sort()).toEqual([0, 1]);
      expect(results.map(({ held }) => held).sort()).toEqual([0, 1]);
      expect(provider).toHaveBeenCalledTimes(1);
      expect((await recoverSkipCloverPayments(Date.now() + 60_000)).claimed).toBe(0);
      expect(provider).toHaveBeenCalledTimes(1);
      vi.setSystemTime(now + 7 * 60_000);
      expect((await recoverSkipCloverPayments(Date.now())).held).toBe(1);
      expect(provider).toHaveBeenCalledTimes(2);
      expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes the existing terminal paid marker once without calling Clover', async () => {
    const repo = getRepo();
    const id = await seed();
    await (await receive('driver', driver('onItsWay')))();
    // A dormant row left by an interrupted cancellation has a paid ledger and no local terminal marker.
    await repo.patchOrder(id, { cancelledAt: new Date().toISOString() }, { status: 'cancelled' });
    provider.mockClear();
    expect(await recoverSkipCloverPayments(Date.now())).toMatchObject({ claimed: 1, recovered: 0, terminalClosed: 1, failed: 0 });
    expect(await recoverSkipCloverPayments(Date.now())).toMatchObject({ claimed: 0, terminalClosed: 0 });
    expect(await repo.getOrder(id)).toMatchObject({ status: 'cancelled', timeline: { posPaymentId: 'fixture-payment', posClosedAt: expect.any(String) } });
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'pos_paid_then_cancelled')).toHaveLength(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'active', expiryOffsetSeconds: 10, canRead: true },
    { status: 'active', expiryOffsetSeconds: -10, canRead: false },
    { status: 'pending', expiryOffsetSeconds: 600, canRead: false },
  ] as const)('keeps scheduler GET-only with $status OAuth expiring in $expiryOffsetSeconds seconds', async ({ status, expiryOffsetSeconds, canRead }) => {
    const repo = getRepo();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      const id = await seed();
      const reference = externalPaymentId((await repo.getOrder(id))!);
      const original = provider.getMockImplementation()!;
      provider.mockImplementation(async (input, init) => {
        if (String(input).endsWith('/payments') && init?.method === 'POST') throw new Error('fixture ambiguous result');
        return original(input, init);
      });
      await (await receive('driver', driver('onItsWay')))();
      vi.stubEnv('CLOVER_ACCESS_TOKEN', undefined);
      vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
      vi.stubEnv('CLOVER_CLIENT_ID', 'fixture-configured-oauth-client');
      vi.stubEnv('CLOVER_CLIENT_SECRET', 'fixture-configured-oauth-secret');
      vi.setSystemTime(now + 3 * 60_000);
      await repo.setKv('clover_oauth_merchants', { [MERCHANT]: {
        merchantId: MERCHANT, status, accessToken: 'fixture-saved-oauth-token', refreshToken: 'fixture-never-refreshed',
        accessTokenExpiration: Math.floor(Date.now() / 1000) + expiryOffsetSeconds, connectedAt: new Date(now).toISOString(),
      } });
      provider.mockReset().mockImplementation(async (input, init) => {
        expect(String(input)).toBe(`${CLOVER}/v3/merchants/${MERCHANT}/orders/${POS}/payments?limit=100`);
        expect(init?.method ?? 'GET').toBe('GET');
        expect(init?.redirect).toBe('error');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-saved-oauth-token');
        return Response.json({ elements: [{ order: { id: POS }, id: 'fixture-oauth-proof', externalPaymentId: reference, result: 'SUCCESS' }] });
      });
      const report = await recoverSkipCloverPayments(Date.now());
      expect(report).toMatchObject({ claimed: 1, recovered: canRead ? 1 : 0, held: canRead ? 0 : 1 });
      expect(provider).toHaveBeenCalledTimes(canRead ? 1 : 0);
      expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBe(canRead ? 'fixture-oauth-proof' : undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot finalize a newer attempt after an aging read was started on its predecessor', async () => {
    const repo = getRepo();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      const id = await seed();
      const original = (await repo.patchOrder(id, {}, { status: 'dispatched' }))!;
      const identity = { orderId: id, externalOrderId: ORDER, merchantId: MERCHANT, posOrderId: POS, paymentReference: externalPaymentId(original) };
      const older = await repo.applySkipLifecycle({ kind: 'prepare_payment', ...identity });
      const olderId = older.paymentAttempt!.id;
      const readStarted = gate();
      const readResponse = gate();
      provider.mockImplementation(async (_input, init) => {
        expect(init?.method ?? 'GET').toBe('GET');
        readStarted.release();
        await readResponse.waiting;
        return Response.json({ elements: [{ order: { id: POS }, id: 'fixture-earlier-proof', externalPaymentId: identity.paymentReference, result: 'SUCCESS' }] });
      });
      vi.setSystemTime(now + 3 * 60_000);
      const recovering = recoverSkipCloverPayments(Date.now());
      expect(await Promise.race([readStarted.waiting.then(() => true), recovering.then(() => false)])).toBe(true);
      try {
        await repo.applySkipLifecycle({ kind: 'finish_payment', ...identity, attemptId: olderId, result: 'refused' });
        const newer = await repo.applySkipLifecycle({ kind: 'prepare_payment', ...identity });
        expect(newer.paymentAttempt?.id).toBeTruthy();
        expect(newer.paymentAttempt?.id).not.toBe(olderId);
      } finally {
        readResponse.release();
      }
      expect(await recovering).toMatchObject({ claimed: 1, recovered: 0, held: 1 });
      expect((await repo.getOrder(id))?.timeline?.posPaymentId).toBeUndefined();
      expect((await repo.listEvents(id)).filter(({ type }) => type === 'pos_paid')).toHaveLength(0);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases a definite payment rejection only for a subsequent eligible attempt', async () => {
    const repo = getRepo();
    const id = await seed();
    const mock = provider.getMockImplementation()!;
    let posts = 0;
    provider.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/payments') && init?.method === 'POST' && ++posts === 1) {
        return Response.json({ message: 'Payment was rejected' }, { status: 422 });
      }
      return mock(input, init);
    });
    await (await receive('driver', driver('onItsWay')))();
    expect((await repo.getOrder(id))?.timeline?.posPaymentError).toContain('HTTP 422');
    await (await receive('driver', driver('delivered')))();
    expect(await repo.getOrder(id)).toMatchObject({ status: 'completed', timeline: { posPaymentId: 'fixture-payment' } });
    expect(posts).toBe(2);
  });

  it.each([
    { posPaymentId: 'fixture-legacy-paid' },
    { posPaymentError: 'Clover payment error: fixture historical timeout' },
  ])('holds other local orders with positively known or uncertain proof for the same physical receipt', async (history) => {
    const repo = getRepo();
    const id = await seed();
    const local = (await repo.getOrder(id))!;
    const { order: earlier } = await repo.insertOrderIfNew({ ...local, externalOrderId: 'older-fixture-order' });
    await repo.patchOrder(earlier.id, { posMerchantId: MERCHANT, ...history }, { status: 'completed', posOrderId: POS });
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('cancel', cancel()))();
    const cancelled = (await repo.getOrder(id))!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.timeline?.posPaymentId).toBeUndefined();
    expect(cancelled.timeline?.posClosedAt).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps an exact legacy receipt open on cancellation when the previous payment is uncertain', async () => {
    const repo = getRepo();
    const id = await seed();
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    await repo.patchOrder(id, { posPaymentError: 'Clover payment HTTP 502: legacy interrupted response' });
    provider.mockImplementation(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(`/v3/merchants/${MERCHANT}/orders/${POS}/payments`);
      expect(init?.method ?? 'GET').toBe('GET');
      return Response.json({ elements: [] });
    });
    await (await receive('cancel', cancel()))();
    const cancelled = (await repo.getOrder(id))!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.timeline?.posPaymentError).toContain('payment needs review');
    expect(cancelled.timeline?.posPaymentId).toBeUndefined();
    expect(cancelled.timeline?.posClosedAt).toBeUndefined();
    expect(provider.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method ?? 'GET']))
      .toEqual([[`/v3/merchants/${MERCHANT}/orders/${POS}/payments`, 'GET']]);
  });

  it('holds a legacy Skip receipt without a proven merchant even after a signed cancellation', async () => {
    const repo = getRepo();
    const id = await seed();
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    await repo.patchOrder(id, { posMerchantId: undefined });
    await (await receive('driver', driver('onItsWay')))();
    await (await receive('cancel', cancel()))();
    const order = (await repo.getOrder(id))!;
    expect(order.status).toBe('cancelled');
    expect(order.timeline?.posPaymentError).toContain('Confirm the original register');
    expect(order.timeline?.posClosedAt).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
    expect((await settleInClover(order))?.status).toBe('cancelled');
    expect((await repo.listEvents(id)).filter(({ type }) => type === 'needs_attention')).toHaveLength(1);
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
