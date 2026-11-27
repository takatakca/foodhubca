import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as receiveSkipCancellation } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as receiveSkipOrder } from '../app/api/foodhub/webhooks/skip/orders/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { readPending } from '../lib/foodhub/courier';
import { INBOX, sweepInbox, type InboxEntry } from '../lib/foodhub/inbox';
import { autoAcceptAfterClover, processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { getRepo } from '../lib/foodhub/repo';

const afterCallbacks = vi.hoisted(() => [] as Array<() => Promise<unknown>>);
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (work: () => Promise<unknown>) => { afterCallbacks.push(work); },
}));

const JET = 'https://jet.example.test';
const CLOVER = 'https://clover.example.test';
const SECRET = 'test-jet-shared-secret';
const STORE = 'TEST-SKIP-STORE';
const MERCHANT = 'TESTMERCH0001';
const POS = 'test-clover-order';
const fetchMock = vi.fn<typeof fetch>();
let fallbackStatus: number;
let cloverReceipt: boolean;

const event = (id = 'skip-test-order') => ({
  id, posLocationId: STORE, type: 'delivery-by-delivery-partner', transmission_id: 'synthetic-transmission', created_at: new Date().toISOString(),
  items: [{ name: 'Test meal', price: 1000, quantity: 1 }], payment: { items_in_cart: { inc_tax: 1150, tax: 150 }, final: { inc_tax: 1150, tax: 150 } },
});

function outbound() {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

const jetRequest = (id: string, result: 'success' | 'failed') => `${JET}/order/${id}/sent-to-pos-${result}`;

async function handleSignedOrder(body = event(), secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const response = await receiveSkipOrder(new NextRequest('http://hub.local/api/foodhub/webhooks/skip/orders', {
    method: 'POST', headers: { 'X-JET-Connect-Hash': `HMAC-SHA256 t=${Date.now()},signature=${sig}` }, body: raw,
  }));
  return response;
}

async function saveCancellationWithWorkerWithheld(orderId: string) {
  const body = { orderID: orderId, reason: { code: 'CUSTOMER_REQUEST' }, happenedAt: new Date().toISOString() };
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const queued = afterCallbacks.length;
  const response = await receiveSkipCancellation(new NextRequest('http://hub.local/api/foodhub/webhooks/skip/cancel', {
    method: 'POST', headers: { 'X-JET-Connect-Hash': `HMAC-SHA256 t=${Date.now()},signature=${signature}` }, body: raw,
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(body);
  expect((await getRepo().listDocs<InboxEntry>(INBOX)).map(({ data }) => data)).toContainEqual(expect.objectContaining({ kind: 'skip_cancel', status: 'received', body }));
  const delayed = afterCallbacks.splice(queued);
  expect(delayed).toHaveLength(1);
  expect(await readPending('skip', orderId)).toBeNull();
  return delayed[0];
}

async function processQueuedOrder(order = event()) {
  const response = await handleSignedOrder(order);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ OrderId: order.id });
  expect(await getRepo().listDocs(INBOX)).toHaveLength(1);
  expect(fetchMock).not.toHaveBeenCalled();
  const work = afterCallbacks.shift();
  expect(work).toBeDefined();
  await work?.();
  const stored = await getRepo().findOrder('skip', order.id);
  expect(stored).toBeTruthy();
  return stored!;
}

beforeEach(async () => {
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  afterCallbacks.length = 0;
  fallbackStatus = 204;
  cloverReceipt = true;
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_RETRY_TIMER', 'off');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('FOODHUB_VIA_CLOVER', undefined);
  vi.stubEnv('FOODHUB_RELAY_CALLBACK_URL', undefined);
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'true');
  vi.stubEnv('SKIP_JET_API_KEY', 'test-jet-api-key');
  vi.stubEnv('SKIP_JET_BASE_URL', JET);
  vi.stubEnv('SKIP_WEBHOOK_HMAC_SECRET', SECRET);
  vi.stubEnv('CLOVER_BASE_URL', CLOVER);
  vi.stubEnv('CLOVER_MERCHANT_ID', MERCHANT);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'test-clover-token');
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', undefined);
  vi.stubEnv('CLOVER_CLIENT_ID', undefined);
  vi.stubEnv('CLOVER_CLIENT_SECRET', undefined);
  vi.stubEnv('FOODHUB_POS_INJECTION', 'off');
  vi.stubEnv('FOODHUB_CLOVER_ORDER_TYPES', 'off');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'off');
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    const { origin, pathname } = new URL(String(url));
    if (origin === JET && init?.method === 'POST') {
      if (pathname.endsWith('/sent-to-pos-success')) return new Response(null, { status: 204 });
      if (pathname.endsWith('/sent-to-pos-failed')) return new Response(null, { status: fallbackStatus });
    }
    if (origin === CLOVER) {
      if (pathname.endsWith('/atomic_order/orders') && init?.method === 'POST') return Response.json(cloverReceipt ? { id: POS } : {});
      if (pathname.endsWith('/orders') && (!init?.method || init.method === 'GET')) return Response.json({ elements: [] });
    }
    throw new Error('Unexpected provider request');
  });
  vi.stubGlobal('fetch', fetchMock);
  await getRepo().upsertStore({ channel: 'skip', channelStoreId: STORE, brandName: 'Test brand', locationCode: 'TEST', autoAccept: true, online: true, meta: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('automatic receipt of direct Skip orders', () => {
  it.each(['first order', 'interrupted order'] as const)('applies a saved Skip cancellation before Clover work on a %s', async (scenario) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    if (scenario === 'interrupted order') {
      await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString() });
    }
    await saveCancellationWithWorkerWithheld(incoming.id);

    const queued = await handleSignedOrder(incoming);
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ OrderId: incoming.id });
    const processing = afterCallbacks.shift();
    expect(processing).toBeDefined();
    await processing?.();

    const order = await repo.findOrder('skip', incoming.id);
    expect({ status: order?.status, providerRequests: outbound() }).toEqual({ status: 'cancelled', providerRequests: [] });
    expect(order).toMatchObject({ locationCode: 'TEST', timeline: { cancelReason: 'CUSTOMER_REQUEST' } });
    expect((await repo.listDocs<InboxEntry>(INBOX)).map(({ data }) => data)).toContainEqual(expect.objectContaining({ kind: 'order', status: 'done', orderId: order?.id }));
  });

  it('checks for a saved Skip cancellation again after storing a fresh order', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    let cancelSaved = false;
    const applySkipLifecycle = repo.applySkipLifecycle.bind(repo);
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      const result = await applySkipLifecycle(input);
      if (!cancelSaved && String(input.kind) === 'intake' && result.isNew) {
        expect(result.order?.status).toBe('new');
        await saveCancellationWithWorkerWithheld(incoming.id);
        cancelSaved = true;
      }
      return result;
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const processing = afterCallbacks.shift();
    expect(processing).toBeDefined();
    await processing?.();

    const order = await repo.findOrder('skip', incoming.id);
    expect({ cancelSaved, status: order?.status, providerRequests: outbound() })
      .toEqual({ cancelSaved: true, status: 'cancelled', providerRequests: [] });
    expect(order?.timeline?.cancelReason).toBe('CUSTOMER_REQUEST');
  });

  it.each(['initial intake', 'interrupted recovery'] as const)('retries a durable Skip order after a transient outage during %s', async (scenario) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const applySkipLifecycle = repo.applySkipLifecycle.bind(repo);
    let failedLifecycle = false;
    const alreadyStored = scenario === 'interrupted recovery' ? await repo.insertOrderIfNew({
      ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString(),
    }) : null;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      const kind: string = input.kind;
      if (!failedLifecycle && kind === (alreadyStored ? 'check_intake' : 'intake')) {
        failedLifecycle = true;
        throw new Error('Synthetic Skip intake outage');
      }
      return applySkipLifecycle(input);
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const processing = afterCallbacks.shift();
    expect(processing).toBeDefined();
    await processing?.();

    expect({ failedLifecycle, providerRequests: outbound() }).toEqual({ failedLifecycle: true, providerRequests: [] });
    const beforeRetry = await repo.findOrder('skip', incoming.id);
    if (alreadyStored) {
      expect(beforeRetry).toMatchObject({ id: alreadyStored.order.id, status: 'new' });
      expect(beforeRetry?.timeline?.posRetry?.claim).toBeUndefined();
    } else expect(beforeRetry).toBeNull();
    const [failed] = await repo.listDocs<InboxEntry>(INBOX);
    expect(failed?.data).toMatchObject({ kind: 'order', reference: incoming.id, status: 'failed', nextAt: expect.any(String) });
    if (!failed?.data.nextAt) throw new Error('The retained Skip order has no retry date');

    expect(await sweepInbox({ now: Date.parse(failed.data.nextAt) + 1 })).toEqual({ processed: 1, failed: 0 });
    const order = await repo.findOrder('skip', incoming.id);
    expect(order).toMatchObject({ status: 'accepted', posOrderId: POS });
    expect(outbound()).toEqual([
      ...(alreadyStored ? [expect.stringContaining(`${CLOVER}/v3/merchants/${MERCHANT}/orders?filter=`)] : []),
      `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`, jetRequest(incoming.id, 'success'),
    ]);
    expect((await repo.getDoc<InboxEntry>(INBOX, failed.id))?.data).toMatchObject({ status: 'done', attempts: 2, orderId: order?.id });
  });

  it('checks for a saved Skip cancellation again after claiming an interrupted order', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const { order: previous } = await repo.insertOrderIfNew({
      ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString(),
    });
    let cancelSaved = false;
    const patchOrder = repo.patchOrder.bind(repo);
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (...args) => {
      const saved = await patchOrder(...args);
      if (!cancelSaved && saved?.id === previous.id && args[1].posRetry?.claim) {
        await saveCancellationWithWorkerWithheld(incoming.id);
        cancelSaved = true;
      }
      return saved;
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const processing = afterCallbacks.shift();
    expect(processing).toBeDefined();
    await processing?.();

    expect(cancelSaved).toBe(true);
    expect({ status: (await repo.getOrder(previous.id))?.status, providerRequests: outbound() })
      .toEqual({ status: 'cancelled', providerRequests: [] });
  });

  it('retains an interrupted Skip order through a live claim, then retries after expiry when cleanup had failed', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_INBOX_RETRY_S', '30,120');
    vi.useFakeTimers({ toFake: ['Date'] });
    const repo = getRepo();
    const incoming = event();
    const { order: previous } = await repo.insertOrderIfNew({
      ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString(),
    });

    let checkFailed = false;
    const applySkipLifecycle = repo.applySkipLifecycle.bind(repo);
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (!checkFailed && String(input.kind) === 'check_intake') {
        checkFailed = true;
        throw new Error('Synthetic Skip pre-send outage');
      }
      return applySkipLifecycle(input);
    });
    let cleanupFailed = false;
    const patchOrder = repo.patchOrder.bind(repo);
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (...args) => {
      const [, timeline, , guard] = args;
      if (!cleanupFailed && checkFailed && guard && 'posRetry' in timeline && timeline.posRetry === undefined) {
        cleanupFailed = true;
        throw new Error('Synthetic resume claim cleanup outage');
      }
      return patchOrder(...args);
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const processing = afterCallbacks.shift();
    expect(processing).toBeDefined();
    await processing?.();

    expect({ checkFailed, cleanupFailed, providerRequests: outbound() }).toEqual({ checkFailed: true, cleanupFailed: true, providerRequests: [] });
    const claim = (await repo.getOrder(previous.id))?.timeline?.posRetry?.claim;
    expect(claim).toEqual(expect.any(String));
    const [entry] = await repo.listDocs<InboxEntry>(INBOX);
    expect(entry?.data).toMatchObject({ kind: 'order', status: 'failed', attempts: 1, nextAt: expect.any(String) });
    vi.setSystemTime(Date.parse(entry?.data.nextAt ?? '') + 1);

    expect(await sweepInbox()).toEqual({ processed: 0, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await repo.getOrder(previous.id))?.timeline?.posRetry?.claim).toBe(claim);
    const waiting = (await repo.getDoc<InboxEntry>(INBOX, entry.id))?.data;
    expect(waiting).toMatchObject({ status: 'failed', attempts: 2, nextAt: expect.any(String) });
    vi.setSystemTime(Date.parse(waiting?.nextAt ?? '') + 1);

    expect(await sweepInbox()).toEqual({ processed: 1, failed: 0 });
    expect(await repo.getOrder(previous.id)).toMatchObject({ status: 'accepted', posOrderId: POS });
    expect(outbound()).toEqual([
      expect.stringContaining(`${CLOVER}/v3/merchants/${MERCHANT}/orders?filter=`),
      `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`, jetRequest(incoming.id, 'success'),
    ]);
    expect((await repo.getDoc<InboxEntry>(INBOX, entry.id))?.data).toMatchObject({ status: 'done', attempts: 3, orderId: previous.id });
  });

  it.each(['Clover off', 'no merchant'] as const)('uses the tablet backup when injection is skipped for %s', async (setup) => {
    if (setup === 'no merchant') {
      vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
      vi.stubEnv('CLOVER_MERCHANT_ID', undefined);
      vi.stubEnv('CLOVER_ACCESS_TOKEN', undefined);
    }
    const incoming = event();
    const stored = await processQueuedOrder(incoming);
    expect(stored).toMatchObject({ status: 'failed', channelError: expect.stringContaining('Skip acknowledged the tablet fallback request') });
    expect(stored.posOrderId).toBeUndefined();
    expect(outbound()).toEqual([jetRequest(incoming.id, 'failed')]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ transmissionId: 'synthetic-transmission', errorCode: 'INACTIVE' });
    expect((await getRepo().listEvents(stored.id)).map((e) => e.type)).toContain('routed_to_skip_tablet');
  });

  it('keeps the order new and describes a refused tablet handoff without claiming success', async () => {
    fallbackStatus = 503;
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({ status: 'new', channelError: expect.stringContaining('tablet hand-off not sent') });
    const events = (await getRepo().listEvents(stored.id)).map((e) => e.type);
    expect(events).toContain('routed_to_skip_tablet_failed');
    expect(events).not.toContain('routed_to_skip_tablet');
    expect(outbound()).toEqual([jetRequest(event().id, 'failed')]);
  });

  it('respects signature verification and the connector live switch', async () => {
    expect((await handleSignedOrder(event(), 'invalid-secret')).status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
    expect(await getRepo().listDocs(INBOX)).toEqual([]);
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({ status: 'new', channelError: expect.stringContaining('tablet hand-off not sent') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls sent-to-pos-success only after Clover returns the ID', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({ status: 'accepted', posOrderId: POS });
    expect(outbound()).toEqual([`${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`, jetRequest(event().id, 'success')]);
  });

  it.each([
    { case: 'a creation with its cancellation worker withheld', worker: 'withheld', adopt: false, remap: false },
    { case: 'a creation with its cancellation worker run', worker: 'run', adopt: false, remap: false },
    { case: 'a creation while the store mapping moves to another kitchen and register', worker: 'run', adopt: false, remap: true },
    { case: 'a resumed receipt lookup with its cancellation worker withheld', worker: 'withheld', adopt: true, remap: false },
    { case: 'a resumed legacy title-only lookup with its cancellation worker withheld', worker: 'withheld', adopt: true, remap: false, legacy: true },
  ])('handles the Clover receipt without printing or accepting during $case', async ({ worker, adopt, remap, legacy }) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const parsed = parseSkipOrder(incoming)!;
    let storedOrderId: string | undefined;
    if (adopt) {
      const { order } = await repo.insertOrderIfNew({ ...parsed, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString() });
      storedOrderId = order.id;
    }
    const movedMerchant = 'TESTMERCH0002';
    if (remap) vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [movedMerchant]: 'fixture-moved-register-token' }));
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const create = `${register}/atomic_order/orders`;
    const lookup = `${register}/orders?filter=`;
    const close = `${register}/orders/${POS}`;
    const movedClose = `${CLOVER}/v3/merchants/${movedMerchant}/orders/${POS}`;
    const respond = fetchMock.getMockImplementation()!;
    const beforeResponse: Array<{ status: string | undefined; posOrderId: string | undefined }> = [];
    let fixtureError: unknown;
    fetchMock.mockImplementation(async (url, init) => {
      const address = String(url);
      const inFlight = adopt ? address.startsWith(lookup) && (!init?.method || init.method === 'GET') : address === create && init?.method === 'POST';
      if (inFlight) {
        try {
          const before = await repo.findOrder('skip', incoming.id);
          beforeResponse.push({ status: before?.status, posOrderId: before?.posOrderId });
          if (remap) {
            const store = await repo.findStore('skip', STORE);
            if (!store) throw new Error('The fixture store was not mapped');
            await repo.upsertStore({ ...store, locationCode: 'TEST_MOVED', cloverMerchantId: movedMerchant });
          }
          const cancel = await saveCancellationWithWorkerWithheld(incoming.id);
          if (worker === 'run') await cancel();
          const after = await repo.findOrder('skip', incoming.id);
          beforeResponse.push({ status: after?.status, posOrderId: after?.posOrderId });
        } catch (error) {
          fixtureError = error;
        }
        if (adopt) {
          const note = legacy ? 'Prior Clover order without a Food Hub marker' : `Fixture Clover receipt | [FH:${storedOrderId}]`;
          return Response.json({ elements: [{ id: POS, title: cloverOrderTitle(parsed), note, total: 1150 }] });
        }
      }
      if (address.endsWith('/print_event') && init?.method === 'POST') return Response.json({ id: 'fixture-print' });
      if ([close, movedClose].includes(address) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      return respond(url, init);
    });

    const order = await processQueuedOrder(incoming);
    expect(fixtureError).toBeUndefined();
    expect(beforeResponse).toEqual([
      { status: 'new', posOrderId: undefined }, { status: worker === 'run' ? 'cancelled' : 'new', posOrderId: undefined },
    ]);
    if (legacy) {
      expect({
        status: order.status, receipt: order.posOrderId,
        requests: fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET']),
      }).toEqual({ status: 'cancelled', receipt: undefined, requests: [[expect.stringContaining(lookup), 'GET']] });
      expect(order.timeline?.cancelReason).toBe('CUSTOMER_REQUEST');
      expect((await repo.listDocs<InboxEntry>(INBOX)).map(({ data }) => data)).toContainEqual(expect.objectContaining({ kind: 'skip_cancel', status: 'received' }));
      expect((await repo.listEvents(order.id)).map((entry) => entry.type)).not.toContain('pos_adopted');
      return;
    }
    expect({
      status: order.status, receipt: order.posOrderId, closed: Boolean(order.timeline?.posClosedAt),
      requests: fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET']),
    }).toEqual({
      status: 'cancelled', receipt: POS, closed: true,
      requests: [adopt ? [expect.stringContaining(lookup), 'GET'] : [create, 'POST'], [close, 'DELETE']],
    });
    expect(order.timeline?.cancelReason).toBe('CUSTOMER_REQUEST');
    expect(order.timeline?.posMerchantId).toBe(MERCHANT);
    expect(order.locationCode).toBe('TEST');
    if (remap) expect(await repo.findStore('skip', STORE)).toMatchObject({ locationCode: 'TEST_MOVED', cloverMerchantId: movedMerchant });
    const types = (await repo.listEvents(order.id)).map((entry) => entry.type);
    expect(types).not.toContain('printed');
    expect(types.filter((type) => type === (adopt ? 'pos_adopted' : 'pos_injected'))).toHaveLength(1);
  });

  it('records the confirmed Skip receipt once and rejects the same receipt ID for a different Clover register', async () => {
    const repo = getRepo();
    const normalized = parseSkipOrder(event())!;
    const { order } = await repo.insertOrderIfNew({ ...normalized, locationCode: 'TEST' });
    const receipt = {
      kind: 'record_receipt', externalOrderId: order.externalOrderId, orderId: order.id,
      posOrderId: POS, merchantId: MERCHANT, adopted: false,
      evidence: { posOrderId: 'untrusted-audit-value', merchantId: 'untrusted-audit-value', freeLines: 1 },
    } as const;
    const recorded = await repo.applySkipLifecycle(receipt);
    expect(recorded).toMatchObject({ recorded: true, order: { id: order.id, status: 'new', posOrderId: POS, timeline: { posMerchantId: MERCHANT } } });
    const saved = structuredClone(recorded.order);
    const repeated = await repo.applySkipLifecycle(receipt);
    expect(repeated.order).toEqual(saved);
    expect(repeated.recorded).toBeUndefined();
    expect(await repo.applySkipLifecycle({ ...receipt, merchantId: 'TESTMERCH0002' })).toMatchObject({ outcome: 'conflicting_receipt' });
    expect(await repo.getOrder(order.id)).toEqual(saved);
    expect(await repo.listEvents(order.id)).toEqual([expect.objectContaining({ type: 'pos_injected', detail: { posOrderId: POS, merchantId: MERCHANT, freeLines: 1 } })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('rechecks a confirmed receipt on inbox retry without another Clover create or print (cancel before retry: %s)', async (cancelBeforeRetry) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const create = `${register}/atomic_order/orders`;
    const print = `${register}/print_event`;
    const close = `${register}/orders/${POS}`;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === print && init?.method === 'POST') return Response.json({ id: 'fixture-print' });
      if (String(url) === close && init?.method === 'DELETE') return new Response(null, { status: 204 });
      return respond(url, init);
    });
    let checkFailed = false;
    const applySkipLifecycle = repo.applySkipLifecycle.bind(repo);
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (!checkFailed && String(input.kind) === 'check_receipt') {
        checkFailed = true;
        throw new Error('Synthetic Skip confirmed receipt check outage');
      }
      return applySkipLifecycle(input);
    });

    const first = await processQueuedOrder(incoming);
    expect(checkFailed).toBe(true);
    expect(first).toMatchObject({ status: 'new', posOrderId: POS, timeline: { posMerchantId: MERCHANT, printedAt: expect.any(String) } });
    expect(outbound()).toEqual([create, print]);
    const [failed] = await repo.listDocs<InboxEntry>(INBOX);
    expect(failed?.data).toMatchObject({ kind: 'order', status: 'failed', attempts: 1, nextAt: expect.any(String) });
    if (!failed?.data.nextAt) throw new Error('The receipt check failure has no retry date');
    if (cancelBeforeRetry) await saveCancellationWithWorkerWithheld(incoming.id);

    expect(await sweepInbox({ now: Date.parse(failed.data.nextAt) + 1 })).toEqual({ processed: 1, failed: 0 });
    expect(await repo.getOrder(first.id)).toMatchObject({ status: cancelBeforeRetry ? 'cancelled' : 'accepted', posOrderId: POS });
    expect(outbound()).toEqual([create, print, cancelBeforeRetry ? close : jetRequest(incoming.id, 'success')]);
    expect((await repo.getDoc<InboxEntry>(INBOX, failed.id))?.data).toMatchObject({ status: 'done', attempts: 2, orderId: first.id });
  });

  it('does not acknowledge a resumed delivery without a receipt', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    cloverReceipt = false;
    const incoming = event();
    await getRepo().insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: new Date(Date.now() - 100_000).toISOString() });
    const stored = await processQueuedOrder(incoming);
    expect(stored).toMatchObject({ status: 'new', posError: expect.stringContaining('did not include an order id') });
    expect((await getRepo().listEvents(stored.id)).map((e) => e.type)).toContain('resumed');
    expect(outbound().some((url) => url.startsWith(JET))).toBe(false);
    await autoAcceptAfterClover(stored);
    expect(outbound().some((url) => url.startsWith(JET))).toBe(false);
  });

  it('keeps deliberate holds and explicit staff confirmation separate from automatic acknowledgement', async () => {
    const held = await processIncomingOrder(parseSkipOrder(event())!, { holdClover: 'Held for staff review' });
    expect(held.order).toMatchObject({ status: 'new', posError: 'Held for staff review' });
    expect(fetchMock).not.toHaveBeenCalled();
    const confirmed = await runOrderAction(held.order.id, 'accept_no_pos');
    expect(confirmed.order?.status).toBe('accepted');
    expect(outbound()).toEqual([jetRequest(event().id, 'success')]);
  });

  it('keeps manual-accept and unmapped orders pending when Clover is optional', async () => {
    await getRepo().upsertStore({ channel: 'skip', channelStoreId: STORE, brandName: 'Test brand', locationCode: 'TEST', autoAccept: false, online: true, meta: {} });
    const manual = await processQueuedOrder();
    expect(manual).toMatchObject({ status: 'new', posError: expect.stringContaining('turned off') });
    const unmapped = await processIncomingOrder(parseSkipOrder({ ...event('unmapped-test'), posLocationId: 'UNMAPPED' })!);
    expect(unmapped.order).toMatchObject({ status: 'new', posError: expect.stringContaining('turned off') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the read-only via-Clover adapter and makes no calls to JET', async () => {
    vi.stubEnv('FOODHUB_VIA_CLOVER', 'skip');
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({ status: 'new', channelError: expect.stringContaining('linked through Clover') });
    expect((await getRepo().listEvents(stored.id)).map((e) => e.type)).not.toContain('routed_to_skip_tablet_failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not route screen and relay orders back to the Skip API', async () => {
    const screen = await processIncomingOrder({ ...parseSkipOrder(event('screen-test'))!, viaHub: 'screen' });
    expect(screen.order.status).toBe('accepted');
    await processIncomingOrder({ ...parseSkipOrder(event('relay-test'))!, viaHub: 'relay' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
