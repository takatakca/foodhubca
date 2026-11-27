import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as actOnOrder } from '../app/api/foodhub/orders/[id]/route';
import { POST as receiveSkipCancellation } from '../app/api/foodhub/webhooks/skip/cancel/route';
import { POST as receiveSkipBackup } from '../app/api/foodhub/webhooks/skip/failed/route';
import { POST as receiveSkipOrder } from '../app/api/foodhub/webhooks/skip/orders/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { hashPassword } from '../lib/foodhub/auth';
import { readPending } from '../lib/foodhub/courier';
import { INBOX, inboxOrderCutoff, runInboxEntry, sweepInbox, type InboxEntry } from '../lib/foodhub/inbox';
import { allowedActions, autoAcceptAfterClover, processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { cloverOrderTitle } from '../lib/foodhub/pos/clover-order';
import { getRepo } from '../lib/foodhub/repo';
import { runCloverRetries } from '../lib/foodhub/recovery';
import { fireDueScheduled } from '../lib/foodhub/scheduling';

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

function barrier() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

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

async function saveBackupWithWorkerWithheld(orderId: string, storeId = STORE) {
  const body = { validationError: 'fixture fallback', order: {
    orderId, totalPrice: 1150, restaurant: { id: storeId }, items: [{ name: 'Fixture meal', plu: 'fixture-plu', price: 1150, quantity: 1 }],
  } };
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const queued = afterCallbacks.length;
  const reply = await receiveSkipBackup(new NextRequest('http://hub.local/api/foodhub/webhooks/skip/failed', {
    method: 'POST', headers: { 'X-JET-Connect-Hash': `HMAC-SHA256 t=${Date.now()},signature=${signature}` }, body: raw,
  }));
  expect(reply.status).toBe(200);
  expect(await reply.json()).toEqual(body);
  expect((await getRepo().listDocs<InboxEntry>(INBOX)).map(({ data }) => data)).toContainEqual(expect.objectContaining({ kind: 'skip_backup', status: 'received', body }));
  const work = afterCallbacks.splice(queued);
  expect(work).toHaveLength(1);
  return work[0];
}

async function processSignedBackup(orderId: string) {
  const work = await saveBackupWithWorkerWithheld(orderId);
  await work();
}

async function processOrdinaryWhileBackupWaits(incoming = event()) {
  const reply = await handleSignedOrder(incoming);
  expect(reply.status).toBe(202);
  expect(await reply.json()).toEqual({ OrderId: incoming.id });
  const process = afterCallbacks.shift();
  expect(process).toBeDefined();
  await process?.();
  return getRepo().findOrder('skip', incoming.id);
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
  it('removes a held historical Skip order from automatic Clover retries without a provider call', async () => {
    const repo = getRepo();
    const now = Date.now();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(event())!, locationCode: 'TEST' });
    const prior = { attempts: 1, uncertain: true, nextAt: new Date(now - 1000).toISOString(), lastError: 'Clover network error: connection dropped' };
    await repo.patchOrder(order.id, { posRetry: prior });
    expect(await runCloverRetries({ now })).toEqual({ due: 0, recovered: 0, failed: 0, gaveUp: 0 });
    expect(await runCloverRetries({ now: now + 1000 })).toEqual({ due: 0, recovered: 0, failed: 0, gaveUp: 0 });
    expect(await repo.getOrder(order.id)).toMatchObject({
      status: 'new', posError: expect.stringContaining('Skip Clover receipt needs review:'),
      timeline: { posRetry: { ...prior, nextAt: null } },
    });
    expect((await repo.listEvents(order.id)).filter(({ type }) => type === 'needs_attention')).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['accept_no_pos', 'deny'] as const)('holds operator action %s after a legacy Clover timeout with unknown original register', async (action) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST' });
    const legacy = await repo.updateOrder(order.id, { posError: 'Clover network error: connection dropped after sending the request' });
    if (!legacy) throw new Error('The legacy order was not saved');

    const result = await runOrderAction(legacy.id, action);

    expect({ visible: allowedActions(legacy).includes(action), ok: result.result.ok, status: result.order?.status, requests: outbound() })
      .toEqual({ visible: false, ok: false, status: 'new', requests: [] });
  });

  it('holds an uncertain legacy retry instead of trying the replaced register when its earlier request has no saved provenance', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(event())!, locationCode: 'TEST' });
    await repo.patchOrder(order.id, { posRetry: { attempts: 1, nextAt: null, uncertain: true, lastError: 'Earlier response could not be confirmed' } });
    const replacement = 'TESTMERCH0002';
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [replacement]: 'fixture-replacement-clover-token' }));
    const mapping = await repo.findStore('skip', STORE);
    if (!mapping) throw new Error('The fixture mapping was not saved');
    await repo.updateStore(mapping.id, { cloverMerchantId: replacement });

    const result = await runOrderAction(order.id, 'retry_pos');

    expect({ ok: result.result.ok, receipt: result.order?.posOrderId, requests: outbound() })
      .toEqual({ ok: false, receipt: undefined, requests: [] });
  });

  it.each(['accept_no_pos', 'deny'] as const)('checks fresh legacy uncertainty inside the atomic decision for operator action %s', async (action) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(event())!, locationCode: 'TEST' });
    const before = await repo.updateOrder(order.id, { posError: 'Clover returned HTTP 422: could not validate' });
    if (!before) throw new Error('The fixture order was not saved');
    expect(allowedActions(before)).toContain(action);
    const uncertain = 'Clover network error: response lost';
    const apply = repo.applySkipLifecycle.bind(repo);
    let changed = false;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (input.kind === 'prepare_jet') {
        await repo.updateOrder(order.id, { posError: uncertain });
        changed = true;
      }
      return apply(input);
    });

    const result = await runOrderAction(order.id, action);

    expect(changed).toBe(true);
    expect({ ok: result.result.ok, status: result.order?.status, requests: outbound() })
      .toEqual({ ok: false, status: 'new', requests: [] });
  });

  it('lets an explicitly tagged expired pre-send lease finish the first Clover send', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const expired = new Date(Date.now() - 110_000).toISOString();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: expired });
    const lease = { attempts: 0, nextAt: null, uncertain: true, claim: 'fixture-expired-resume-only-lease', claimedAt: expired, resumeOnly: true as const };
    await repo.patchOrder(order.id, { posRetry: lease });

    const resumed = await processQueuedOrder(incoming);

    expect(resumed).toMatchObject({ status: 'accepted', posOrderId: POS });
    expect(outbound().filter((url) => url.endsWith('/atomic_order/orders'))).toEqual([`${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`]);
  });

  it('holds an identically shaped untagged historical lease instead of resending to Clover or confirming to JET', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const expired = new Date(Date.now() - 110_000).toISOString();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST', createdAt: expired });
    await repo.patchOrder(order.id, { posRetry: { attempts: 0, nextAt: null, uncertain: true, claim: 'fixture-legacy-untagged-lease', claimedAt: expired } });

    const held = await processQueuedOrder(incoming);

    expect({ status: held.status, receipt: held.posOrderId, requests: outbound() }).toEqual({ status: 'new', receipt: undefined, requests: [] });
  });

  it.each(['accept_no_pos', 'deny'] as const)('allows an authenticated kitchen manager to perform %s after a definite live-path Clover 422', async (action) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const create = `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`;
    const respond = fetchMock.getMockImplementation()!;
    fallbackStatus = 422;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === create && init?.method === 'POST') return Response.json({ error: 'Fixture validation refusal' }, { status: 422 });
      return respond(url, init);
    });
    const refused = await processQueuedOrder(incoming);
    expect(refused).toMatchObject({ status: 'new', posError: expect.stringContaining('HTTP 422') });
    expect(refused.timeline?.posCreateAttempt).toBeUndefined();
    expect(allowedActions(refused)).toContain(action);
    expect(outbound()).toEqual([create, jetRequest(incoming.id, 'failed')]);

    fallbackStatus = 204;
    const password = 'synthetic-operator-password';
    const user = await repo.saveUser({ username: 'fixture-kitchen-manager', name: 'Fixture manager', role: 'manager', locations: ['TEST'], active: true, passwordHash: hashPassword(password) });
    const url = `https://hub.example.test/api/foodhub/orders/${refused.id}`;
    const response = await actOnOrder(new Request(url, { method: 'POST', headers: {
      authorization: `Basic ${Buffer.from(`${user.username}:${password}`).toString('base64')}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ id: refused.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { ok: true }, order: { status: action === 'deny' ? 'failed' : 'accepted' } });
    expect(outbound()).toEqual([create, jetRequest(incoming.id, 'failed'), jetRequest(incoming.id, action === 'deny' ? 'failed' : 'success')]);
  });

  it('never prints a due scheduled Skip ticket when an uncertain older receipt has no confirmed register', async () => {
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    const repo = getRepo();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(event())!, locationCode: 'TEST' });
    const store = await repo.findStore('skip', STORE);
    if (!store) throw new Error('The fixture mapping was not saved');
    await repo.updateStore(store.id, { cloverMerchantId: MERCHANT });
    await repo.patchOrder(order.id, { fireAt: '2026-11-02T12:00:00Z' }, {
      status: 'accepted', posOrderId: POS, posError: 'Clover network error: earlier response dropped',
    });
    const print = `${CLOVER}/v3/merchants/${MERCHANT}/print_event`;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === print && init?.method === 'POST') return Response.json({ id: 'fixture-queued-print' });
      return respond(url, init);
    });

    await fireDueScheduled(Date.parse('2026-11-02T12:01:00Z'));

    expect((await repo.getOrder(order.id))?.timeline?.printedAt).toBeUndefined();
    expect(outbound()).toEqual([]);
  });

  const terminalReceiptCases = (['cancel', 'backup'] as const).flatMap((notice) =>
    (['uncertain', 'partial pointer', 'refused', 'confirmed pair'] as const).map((receipt) => ({ notice, receipt })));
  it.each(terminalReceiptCases)('handles a signed $notice with a legacy $receipt Clover result', async ({ notice, receipt }) => {
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const savedKitchen = receipt === 'uncertain' ? undefined : 'TEST';
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: savedKitchen });
    const uncertain = 'Clover network error: response dropped';
    const refusal = 'Clover returned HTTP 422: could not validate';
    const history = receipt === 'refused' ? refusal : uncertain;
    const known = receipt === 'confirmed pair';
    const hasPointer = known || receipt === 'partial pointer';
    const needsReview = receipt === 'uncertain' || receipt === 'partial pointer';
    await repo.patchOrder(order.id, {
      posRetry: { attempts: 1, nextAt: null, lastError: history, ...(receipt === 'refused' ? {} : { uncertain: true }) },
      ...(known ? { posMerchantId: MERCHANT } : {}),
    }, { posError: history, ...(hasPointer ? { posOrderId: POS } : {}) });
    const original = `${CLOVER}/v3/merchants/${MERCHANT}/orders/${POS}`;
    const replacement = 'TESTMERCH0002';
    if (hasPointer) {
      vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [replacement]: 'synthetic-replacement-token' }));
      const mapping = await repo.findStore('skip', STORE);
      if (!mapping) throw new Error('The fixture mapping was not saved');
      await repo.updateStore(mapping.id, { cloverMerchantId: replacement });
    }
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if ([original, `${CLOVER}/v3/merchants/${replacement}/orders/${POS}`].includes(String(url)) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      return respond(url, init);
    });
    const terminal = async () => {
      if (notice === 'cancel') await (await saveCancellationWithWorkerWithheld(incoming.id))();
      else await processSignedBackup(incoming.id);
    };

    await terminal();
    await terminal();

    const saved = await repo.getOrder(order.id);
    expect(saved).toMatchObject({ status: notice === 'cancel' ? 'cancelled' : 'failed' });
    expect(saved?.locationCode).toBe(savedKitchen);
    const review = (await repo.listEvents(order.id)).filter((entry) => entry.type === 'needs_attention');
    expect(outbound()).toEqual(known ? [original] : []);
    expect(review).toHaveLength(needsReview ? 1 : 0);
    if (needsReview) {
      expect(review[0].detail?.reason).toMatch(/Clover/i);
      expect(saved?.timeline?.posRetry?.uncertain).toBe(true);
    }
    expect(saved?.posOrderId).toBe(hasPointer ? POS : undefined);
    expect(Boolean(saved?.timeline?.posClosedAt)).toBe(known);
  });

  it.each(['OTHER_UNMAPPED_STORE', ''] as const)('holds a signed backup with a different or missing store after its worker runs (%s)', async (storeId) => {
    const repo = getRepo();
    const incoming = event();
    const { order } = await repo.insertOrderIfNew({ ...parseSkipOrder(incoming)!, locationCode: 'TEST' });
    await (await saveBackupWithWorkerWithheld(incoming.id, storeId))();
    expect(await repo.getOrder(order.id)).toMatchObject({ status: 'new', channelStoreId: STORE });
    const notice = (await repo.listDocs<InboxEntry>(INBOX)).find(({ data }) => data.kind === 'skip_backup');
    expect(notice?.data).toMatchObject({ status: 'failed', lastError: expect.stringContaining('does not match the stored order') });
    expect(await repo.listEvents(order.id)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([true, false])('respects a matching signed backup before first intake even while its worker is withheld (mapped: %s)', async (mapped) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    if (!mapped) {
      const store = await repo.findStore('skip', STORE);
      if (!store) throw new Error('The fixture mapping is missing');
      await repo.deleteStore(store.id);
    }
    const incoming = event('fixture-backup-before-intake');
    const backup = await saveBackupWithWorkerWithheld(incoming.id);
    expect(await repo.findOrder('skip', incoming.id)).toBeNull();

    const order = await processOrdinaryWhileBackupWaits(incoming);

    expect({ requests: outbound(), receipt: order?.posOrderId }).toEqual({ requests: [], receipt: undefined });
    await backup();
    expect(await repo.findOrder('skip', incoming.id)).toMatchObject({ status: 'failed' });
  });

  it('does not call Clover when a matching signed backup is saved just before the Clover reservation', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event('fixture-backup-before-clover');
    const apply = repo.applySkipLifecycle.bind(repo);
    let backup: Awaited<ReturnType<typeof saveBackupWithWorkerWithheld>> | undefined;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (!backup && input.kind === 'prepare_clover') backup = await saveBackupWithWorkerWithheld(incoming.id);
      return apply(input);
    });

    const order = await processOrdinaryWhileBackupWaits(incoming);

    expect(backup).toBeDefined();
    expect({ requests: outbound(), receipt: order?.posOrderId }).toEqual({ requests: [], receipt: undefined });
  });

  it('closes the original receipt without printing when a matching signed backup is saved during Clover creation', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const incoming = event('fixture-backup-during-clover');
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const create = `${register}/atomic_order/orders`;
    const close = `${register}/orders/${POS}`;
    const print = `${register}/print_event`;
    const respond = fetchMock.getMockImplementation()!;
    let backup: Awaited<ReturnType<typeof saveBackupWithWorkerWithheld>> | undefined;
    fetchMock.mockImplementation(async (url, init) => {
      const address = String(url);
      if (address === create && init?.method === 'POST') {
        backup = await saveBackupWithWorkerWithheld(incoming.id);
        return Response.json({ id: POS });
      }
      if (address === print && init?.method === 'POST') return Response.json({ id: 'fixture-printed' });
      if (address === close && init?.method === 'DELETE') return new Response(null, { status: 204 });
      return respond(url, init);
    });

    const order = await processOrdinaryWhileBackupWaits(incoming);

    expect(backup).toBeDefined();
    expect({ status: order?.status, receipt: order?.posOrderId, merchant: order?.timeline?.posMerchantId,
      closed: Boolean(order?.timeline?.posClosedAt), requests: outbound() })
      .toEqual({ status: 'failed', receipt: POS, merchant: MERCHANT, closed: true, requests: [create, close] });
  });

  it('does not call JET when a matching signed backup is saved just before the confirmation transaction', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event('fixture-backup-before-jet');
    const apply = repo.applySkipLifecycle.bind(repo);
    let backup: Awaited<ReturnType<typeof saveBackupWithWorkerWithheld>> | undefined;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (!backup && input.kind === 'prepare_jet' && input.signal === 'accept') backup = await saveBackupWithWorkerWithheld(incoming.id);
      return apply(input);
    });

    const order = await processOrdinaryWhileBackupWaits(incoming);

    expect(backup).toBeDefined();
    expect(order?.posOrderId).toBe(POS);
    expect(outbound().filter((url) => url.startsWith(JET))).toEqual([]);
  });

  it.each([
    { name: 'a different mapped store', store: 'FIXTURE-OTHER-MAPPED', otherMapped: true },
    { name: 'a different unmapped store', store: 'FIXTURE-OTHER-UNMAPPED' },
    { name: 'a blank store id', store: '' },
    { name: 'a different order at the same store', store: STORE, otherOrder: true },
    { name: 'another order sharing the truncated inbox reference', store: STORE, longReference: true },
  ])('continues ordinary intake when the withheld backup names $name', async ({ store, otherMapped, otherOrder, longReference }) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const prefix = 'a'.repeat(200);
    const incoming = event(longReference ? `${prefix}-ordinary` : 'fixture-ordinary-order');
    if (otherMapped) await getRepo().upsertStore({ channel: 'skip', channelStoreId: store, brandName: 'Other fixture', locationCode: 'OTHER', autoAccept: true, online: true, meta: {} });
    await saveBackupWithWorkerWithheld(longReference ? `${prefix}-foreign` : otherOrder ? 'fixture-unrelated-order' : incoming.id, store);

    expect(await processOrdinaryWhileBackupWaits(incoming)).toMatchObject({ status: 'accepted', posOrderId: POS });
    expect(outbound()).toEqual([`${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`, jetRequest(incoming.id, 'success')]);
  });

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
    fallbackStatus = 422;
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({ status: 'new', channelError: expect.stringContaining('tablet hand-off not sent') });
    expect(stored.timeline?.skipJetAttempt).toBeUndefined();
    const events = (await getRepo().listEvents(stored.id)).map((e) => e.type);
    expect(events).toContain('routed_to_skip_tablet_failed');
    expect(events).not.toContain('routed_to_skip_tablet');
    expect(outbound()).toEqual([jetRequest(event().id, 'failed')]);
    const operator = await runOrderAction(stored.id, 'accept_no_pos');
    expect(operator.order).toMatchObject({ status: 'accepted', timeline: { skipJetAttempt: { outcome: 'accepted', manual: true } } });
    expect(outbound()).toEqual([jetRequest(event().id, 'failed'), jetRequest(event().id, 'success')]);
  });

  it('holds both outbound paths when the tablet handoff may have reached Skip', async () => {
    fallbackStatus = 503;
    const stored = await processQueuedOrder();
    expect(stored).toMatchObject({
      status: 'new',
      channelError: expect.stringContaining('response needs review'),
      timeline: { skipJetAttempt: { signal: 'fallback', outcome: 'uncertain' } },
    });
    expect((await getRepo().listEvents(stored.id)).filter((e) => e.type === 'routed_to_skip_tablet_failed'))
      .toEqual([expect.objectContaining({ detail: expect.objectContaining({ uncertain: true }) })]);
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    for (const action of ['accept_no_pos', 'deny', 'retry_pos'] as const) {
      expect((await runOrderAction(stored.id, action)).result.ok).toBe(false);
    }
    expect((await handleSignedOrder(event())).status).toBe(202);
    for (const callback of afterCallbacks.splice(0)) await callback();
    expect(outbound()).toEqual([jetRequest(event().id, 'failed')]);
  });

  it('still handles the signed tablet backup after recording JET fallback but losing the local audit event', async () => {
    const repo = getRepo();
    const add = repo.addEvent.bind(repo);
    vi.spyOn(repo, 'addEvent').mockImplementation(async (...args) => {
      if (args[1] === 'routed_to_skip_tablet') throw new Error('Synthetic worker exit before fallback audit');
      return add(...args);
    });
    const order = await processQueuedOrder();
    expect(order).toMatchObject({ status: 'failed', timeline: { skipJetAttempt: { signal: 'fallback', outcome: 'fallback' } } });
    expect((await repo.listEvents(order.id)).some(({ type }) => type === 'routed_to_skip_tablet')).toBe(false);
    await processSignedBackup(event().id);
    const backup = (await repo.listDocs<InboxEntry>(INBOX)).find(({ data }) => data.kind === 'skip_backup');
    expect(backup?.data).toMatchObject({ status: 'done', result: 'Skip tablet backup recorded.', orderId: order.id });
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

  it.each([
    { case: 'its cancellation worker withheld', worker: 'withheld', ambiguous: false },
    { case: 'its cancellation worker applied and store remapped', worker: 'applied', ambiguous: false },
    { case: 'an ambiguous original-register lookup', worker: 'withheld', ambiguous: true },
    { case: 'a marked copy becoming visible on a later active-order retry', worker: 'none', ambiguous: false, delayedVisibility: true },
  ])('reconciles or holds a lost Clover create response with $case', async ({ worker, ambiguous, delayedVisibility }) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const movedMerchant = 'TESTMERCH0002';
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ [movedMerchant]: 'fixture-moved-register-token' }));
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const create = `${register}/atomic_order/orders`;
    const lookup = `${register}/orders?filter=`;
    const close = `${register}/orders/${POS}`;
    const print = `${register}/print_event`;
    const respond = fetchMock.getMockImplementation()!;
    let remoteCopy: { id: string; title: string; note: string; total: number } | undefined;
    let originalReceiptMarker: string | undefined;
    let timelineBeforeCreate: unknown;
    let stateDuringCreate: string | undefined;
    let lookups = 0;
    let fixtureError: unknown;
    fetchMock.mockImplementation(async (url, init) => {
      const address = String(url);
      if (address === create && init?.method === 'POST') {
        try {
          const stored = await repo.findOrder('skip', incoming.id);
          if (!stored) throw new Error('The fixture order was not saved before the Clover create');
          timelineBeforeCreate = structuredClone(stored.timeline);
          const { title, note } = JSON.parse(String(init.body)).orderCart;
          remoteCopy = { id: POS, title, note, total: 1150 };
          originalReceiptMarker = note.endsWith(` | [FH:${stored.id}]`) ? stored.id : undefined;
          if (worker === 'applied') {
            const store = await repo.findStore('skip', STORE);
            if (!store) throw new Error('The fixture store was not mapped');
            await repo.upsertStore({ ...store, locationCode: 'TEST_MOVED', cloverMerchantId: movedMerchant });
          }
          if (worker !== 'none') {
            const cancel = await saveCancellationWithWorkerWithheld(incoming.id);
            if (worker === 'applied') await cancel();
          }
          stateDuringCreate = (await repo.findOrder('skip', incoming.id))?.status;
        } catch (error) {
          fixtureError = error;
        }
        throw new Error('Synthetic Clover network disconnect after remote commit');
      }
      if (address.startsWith(lookup) && (!init?.method || init.method === 'GET')) {
        lookups += 1;
        if (delayedVisibility && lookups === 1) return Response.json({ elements: [] });
        const elements = remoteCopy ? [remoteCopy] : [];
        if (remoteCopy && ambiguous) elements.push({ ...remoteCopy, id: 'legacy-title-match', note: 'Existing Clover order with the same title' });
        return Response.json({ elements });
      }
      if (address === close && init?.method === 'DELETE') {
        remoteCopy = undefined;
        return new Response(null, { status: 204 });
      }
      if (address === print && init?.method === 'POST') return Response.json({ id: 'fixture-print' });
      return respond(url, init);
    });

    const first = await processQueuedOrder(incoming);
    expect(fixtureError).toBeUndefined();
    expect(originalReceiptMarker).toBe(first.id);
    expect(timelineBeforeCreate).toMatchObject({ posCreateAttempt: { merchantId: MERCHANT, at: expect.any(String) } });
    expect(stateDuringCreate).toBe(worker === 'applied' ? 'cancelled' : 'new');
    const notification = (await repo.listDocs<InboxEntry>(INBOX)).find(({ data }) => data.kind === 'order');
    if (delayedVisibility) {
      expect(first).toMatchObject({ status: 'new', timeline: { posCreateAttempt: { merchantId: MERCHANT } } });
      expect(first.posOrderId).toBeUndefined();
      expect(notification?.data).toMatchObject({ status: 'failed', attempts: 1, nextAt: expect.any(String) });
      for (const action of ['accept', 'accept_no_pos', 'deny'] as const) {
        const held = await runOrderAction(first.id, action);
        expect(held.result).toMatchObject({ ok: false, message: expect.stringContaining('pending receipt') });
      }
      expect(outbound()).toEqual([create, expect.stringContaining(lookup)]);
    }
    const lookedUp = outbound().some((url) => url.startsWith(lookup));
    if (notification?.data.status === 'failed' && notification.data.nextAt && (!ambiguous || !lookedUp)) {
      await sweepInbox({ now: Date.parse(notification.data.nextAt) + 1 });
    }
    const order = await repo.getOrder(first.id);
    if (delayedVisibility) {
      expect(order).toMatchObject({ status: 'accepted', posOrderId: POS, locationCode: 'TEST', timeline: { posMerchantId: MERCHANT, printedAt: expect.any(String) } });
      expect(outbound()).toEqual([create, expect.stringContaining(lookup), expect.stringContaining(lookup), print, jetRequest(incoming.id, 'success')]);
      expect((await repo.getDoc<InboxEntry>(INBOX, notification!.id))?.data).toMatchObject({ status: 'done', attempts: 2, orderId: first.id });
      return;
    }
    if (ambiguous) {
      expect(order).toMatchObject({ status: 'cancelled', locationCode: 'TEST', timeline: { cancelReason: 'CUSTOMER_REQUEST', posCreateAttempt: { merchantId: MERCHANT } } });
      expect(order?.posOrderId).toBeUndefined();
      expect(remoteCopy).toBeDefined();
      expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET']))
        .toEqual([[create, 'POST'], [expect.stringContaining(lookup), 'GET']]);
      return;
    }
    expect({
      status: order?.status, receipt: order?.posOrderId, remoteCopyRemains: Boolean(remoteCopy),
      requests: fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET']),
    }).toEqual({
      status: 'cancelled', receipt: POS, remoteCopyRemains: false,
      requests: [[create, 'POST'], [expect.stringContaining(lookup), 'GET'], [close, 'DELETE']],
    });
    expect(order).toMatchObject({ locationCode: 'TEST', timeline: { posMerchantId: MERCHANT, posClosedAt: expect.any(String), cancelReason: 'CUSTOMER_REQUEST' } });
    expect((await repo.listEvents(first.id)).map((entry) => entry.type).filter((type) => type === 'pos_adopted')).toHaveLength(1);
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

  it.each(['cancel', 'backup'] as const)('reconciles a lost Clover confirmation when a signed %s arrives after the order retry deadline', async (notice) => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'on');
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const create = `${register}/atomic_order/orders`;
    const lookup = `${register}/orders?filter=`;
    const close = `${register}/orders/${POS}`;
    let remoteCopy: { id: string; title: string; note: string } | undefined;
    let visible = false;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const address = String(url);
      if (address === create && init?.method === 'POST') {
        const { title, note } = JSON.parse(String(init.body)).orderCart;
        remoteCopy = { id: POS, title, note };
        throw new Error('Synthetic loss after Clover committed the order');
      }
      if (address.startsWith(lookup)) return Response.json({ elements: visible && remoteCopy ? [remoteCopy] : [] });
      if (address === close && init?.method === 'DELETE') {
        remoteCopy = undefined;
        return new Response(null, { status: 204 });
      }
      return respond(url, init);
    });

    const first = await processQueuedOrder(incoming);
    expect(first).toMatchObject({ status: 'new', timeline: { posCreateAttempt: { merchantId: MERCHANT } } });
    expect(first.posOrderId).toBeUndefined();
    expect(remoteCopy?.note).toMatch(new RegExp(`\\[FH:${first.id}\\]$`));
    const inbox = (await repo.listDocs<InboxEntry>(INBOX))[0];
    const cutoff = await inboxOrderCutoff(inbox.data);
    expect(cutoff?.deadline).toBe(true);
    expect(await runInboxEntry(inbox.id, { now: cutoff!.at + 1 })).toMatchObject({ status: 'failed', attempts: 1, nextAt: null, lastError: expect.stringContaining('answer window') });
    expect(outbound()).toEqual([create, expect.stringContaining(lookup)]);

    const store = (await repo.findStore('skip', STORE))!;
    await repo.upsertStore({ ...store, locationCode: 'MOVED', cloverMerchantId: 'OTHER-REGISTER' });
    visible = true;
    const processNotice = async () => {
      if (notice === 'backup') await processSignedBackup(incoming.id);
      else await (await saveCancellationWithWorkerWithheld(incoming.id))();
    };
    await processNotice();
    await processNotice();

    expect(await repo.getOrder(first.id)).toMatchObject({
      status: notice === 'backup' ? 'failed' : 'cancelled', locationCode: 'TEST', posOrderId: POS,
      timeline: { posMerchantId: MERCHANT, posClosedAt: expect.any(String) },
    });
    expect(remoteCopy).toBeUndefined();
    expect(outbound()).toEqual([create, expect.stringContaining(lookup), expect.stringContaining(lookup), close]);
    expect((await repo.getDoc<InboxEntry>(INBOX, inbox.id))?.data).toMatchObject({ status: 'failed', attempts: 1, nextAt: null });
    const events = (await repo.listEvents(first.id)).map(({ type }) => type);
    for (const type of ['pos_adopted', 'pos_cancelled', notice === 'backup' ? 'routed_to_skip_tablet' : 'platform_status']) {
      expect(events.filter((eventType) => eventType === type)).toHaveLength(1);
    }
  });

  it('closes a known receipt only once on its original register when the signed tablet backup arrives', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    vi.stubEnv('FOODHUB_CLOVER_DELETE_CANCELLED', 'on');
    const repo = getRepo();
    const incoming = event();
    const register = `${CLOVER}/v3/merchants/${MERCHANT}`;
    const close = `${register}/orders/${POS}`;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === close && init?.method === 'DELETE') return new Response(null, { status: 204 });
      return respond(url, init);
    });
    const first = await processQueuedOrder(incoming);
    expect(first).toMatchObject({ status: 'accepted', posOrderId: POS, timeline: { posMerchantId: MERCHANT } });
    const store = (await repo.findStore('skip', STORE))!;
    await repo.upsertStore({ ...store, locationCode: 'MOVED', cloverMerchantId: 'OTHER-REGISTER' });

    await processSignedBackup(incoming.id);
    await processSignedBackup(incoming.id);

    expect(await repo.getOrder(first.id)).toMatchObject({ status: 'failed', posOrderId: POS, timeline: { posMerchantId: MERCHANT, posClosedAt: expect.any(String) } });
    expect(outbound()).toEqual([`${register}/atomic_order/orders`, jetRequest(incoming.id, 'success'), close]);
    const events = (await repo.listEvents(first.id)).map(({ type }) => type);
    expect(events.filter((type) => type === 'pos_cancelled')).toHaveLength(1);
    expect(events.filter((type) => type === 'routed_to_skip_tablet')).toHaveLength(1);
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

  it('does not send an operator Skip confirmation while the signed order is still awaiting its Clover receipt', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const create = `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`;
    const prepped = barrier();
    const proceedWithCreate = barrier();
    const manualPassedGate = barrier();
    const proceedWithManual = barrier();
    const posting = barrier();
    const replyWithReceipt = barrier();
    let readyTargetWrites = 0;
    let inFlightTimeline: unknown;
    const patchOrder = repo.patchOrder.bind(repo);
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (...args) => {
      if (args[1].readyTarget) {
        readyTargetWrites += 1;
        if (readyTargetWrites === 1) {
          const saved = await patchOrder(...args);
          prepped.open();
          await proceedWithCreate.wait;
          return saved;
        }
        if (readyTargetWrites === 2) {
          manualPassedGate.open();
          await proceedWithManual.wait;
        }
      }
      return patchOrder(...args);
    });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === create && init?.method === 'POST') {
        inFlightTimeline = structuredClone((await repo.findOrder('skip', incoming.id))?.timeline);
        posting.open();
        await replyWithReceipt.wait;
      }
      return respond(url, init);
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const process = afterCallbacks.shift();
    if (!process) throw new Error('The signed Skip order did not schedule its worker');
    const processing = process();
    let manual: ReturnType<typeof runOrderAction> | undefined;
    try {
      await Promise.race([prepped.wait, processing.then(() => { throw new Error('The signed order ended before preparation'); })]);
      const order = await repo.findOrder('skip', incoming.id);
      if (!order) throw new Error('The signed Skip order did not save');
      manual = runOrderAction(order.id, 'accept_no_pos', { prepMinutes: 20 });
      await Promise.race([manualPassedGate.wait, manual]);
      proceedWithCreate.open();
      const cloverStarted = await Promise.race([posting.wait.then(() => true), processing.then(() => false)]);
      proceedWithManual.open();
      const operator = await manual;
      if (cloverStarted) {
        expect(inFlightTimeline).toMatchObject({ posCreateAttempt: { merchantId: MERCHANT } });
        expect({ manualAccepted: operator.result.ok, callsBeforeCloverReply: outbound() })
          .toEqual({ manualAccepted: false, callsBeforeCloverReply: [create] });
      } else {
        expect({ manualAccepted: operator.result.ok, providerRequests: outbound() })
          .toEqual({ manualAccepted: true, providerRequests: [jetRequest(incoming.id, 'success')] });
      }
    } finally {
      proceedWithCreate.open();
      proceedWithManual.open();
      replyWithReceipt.open();
      await Promise.allSettled([processing, manual]);
    }
  });

  it('does not create a Clover copy while an operator confirmation is already in flight', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const incoming = event();
    const create = `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`;
    const confirmed = jetRequest(incoming.id, 'success');
    const repo = getRepo();
    const prepared = barrier();
    const resumeIntake = barrier();
    const jetPosting = barrier();
    const finishJet = barrier();
    const cloverPosting = barrier();
    const finishClover = barrier();
    const patchOrder = repo.patchOrder.bind(repo);
    let heldPrep = false;
    vi.spyOn(repo, 'patchOrder').mockImplementation(async (...args) => {
      const order = await patchOrder(...args);
      if (!heldPrep && args[1].readyTarget) {
        heldPrep = true;
        prepared.open();
        await resumeIntake.wait;
      }
      return order;
    });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === confirmed && init?.method === 'POST') {
        jetPosting.open();
        await finishJet.wait;
      }
      if (String(url) === create && init?.method === 'POST') {
        cloverPosting.open();
        await finishClover.wait;
      }
      return respond(url, init);
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const process = afterCallbacks.shift();
    if (!process) throw new Error('The signed Skip order did not schedule its worker');
    const processing = process();
    let manual: ReturnType<typeof runOrderAction> | undefined;
    try {
      await Promise.race([prepared.wait, processing.then(() => { throw new Error('Signed intake ended before local preparation'); })]);
      const order = await repo.findOrder('skip', incoming.id);
      if (!order) throw new Error('The signed Skip order did not save');
      manual = runOrderAction(order.id, 'accept_no_pos');
      await Promise.race([jetPosting.wait, manual.then(() => { throw new Error('Operator did not start its confirmation'); })]);
      resumeIntake.open();
      await Promise.race([cloverPosting.wait, processing]);
      expect(outbound()).toEqual([confirmed]);
      finishJet.open();
      expect((await manual).result.ok).toBe(true);
      expect(await repo.getOrder(order.id)).toMatchObject({ status: 'accepted' });
    } finally {
      resumeIntake.open();
      finishJet.open();
      finishClover.open();
      await Promise.allSettled([processing, manual]);
    }
  });

  it('blocks intake with a stale new status after an operator has already confirmed in Skip', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const beforeReservation = barrier();
    const resumeIntake = barrier();
    const apply = repo.applySkipLifecycle.bind(repo);
    let held = false;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (input.kind === 'prepare_clover' && !held) {
        held = true;
        beforeReservation.open();
        await resumeIntake.wait;
      }
      return apply(input);
    });
    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const process = afterCallbacks.shift();
    if (!process) throw new Error('The signed Skip order did not schedule its worker');
    const processing = process();
    try {
      await Promise.race([beforeReservation.wait, processing.then(() => { throw new Error('Signed intake did not reach Clover reservation'); })]);
      const order = (await repo.findOrder('skip', incoming.id))!;
      const operator = await runOrderAction(order.id, 'accept_no_pos');
      expect(operator.order).toMatchObject({ status: 'accepted', timeline: { skipJetAttempt: { outcome: 'accepted', manual: true } } });
      resumeIntake.open();
      await processing;
      expect(outbound()).toEqual([jetRequest(incoming.id, 'success')]);
      const resend = await runOrderAction(order.id, 'retry_pos');
      expect(resend.order).toMatchObject({ status: 'accepted', posOrderId: POS });
      expect(outbound()).toEqual([jetRequest(incoming.id, 'success'), `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`]);
    } finally {
      resumeIntake.open();
      await Promise.allSettled([processing]);
    }
  });

  it('holds the first Skip Clover send when the mapping changes before reservation', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const repo = getRepo();
    const incoming = event();
    const apply = repo.applySkipLifecycle.bind(repo);
    let moved = false;
    vi.spyOn(repo, 'applySkipLifecycle').mockImplementation(async (input) => {
      if (input.kind === 'prepare_clover' && !moved) {
        const store = (await repo.findStore('skip', STORE))!;
        await repo.upsertStore({ ...store, locationCode: 'OTHER_KITCHEN', cloverMerchantId: 'OTHER_REGISTER' });
        moved = true;
      }
      return apply(input);
    });
    const order = await processQueuedOrder(incoming);
    expect(moved).toBe(true);
    expect(order).toMatchObject({ status: 'new', locationCode: 'TEST', posError: expect.stringContaining('mapping changed') });
    expect(order.timeline?.posCreateAttempt).toBeUndefined();
    expect(order.timeline?.skipJetAttempt).toBeUndefined();
    expect((await repo.listEvents(order.id)).filter(({ type }) => type === 'needs_attention')).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send an operator confirmation while a definite Clover refusal is being handed to the Skip tablet', async () => {
    vi.stubEnv('FOODHUB_POS_INJECTION', undefined);
    const incoming = event();
    const create = `${CLOVER}/v3/merchants/${MERCHANT}/atomic_order/orders`;
    const failed = jetRequest(incoming.id, 'failed');
    const repo = getRepo();
    const tabletPosting = barrier();
    const finishTablet = barrier();
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === create && init?.method === 'POST') return Response.json({ message: 'Synthetic validation refusal' }, { status: 400 });
      if (String(url) === failed && init?.method === 'POST') {
        tabletPosting.open();
        await finishTablet.wait;
      }
      return respond(url, init);
    });

    expect((await handleSignedOrder(incoming)).status).toBe(202);
    const process = afterCallbacks.shift();
    if (!process) throw new Error('The signed Skip order did not schedule its worker');
    const processing = process();
    try {
      await Promise.race([tabletPosting.wait, processing.then(() => { throw new Error('Explicit Clover refusal did not start a tablet fallback'); })]);
      const order = await repo.findOrder('skip', incoming.id);
      if (!order) throw new Error('The signed Skip order did not save');
      expect(order).toMatchObject({ status: 'new' });
      expect(order.timeline?.posCreateAttempt).toBeUndefined();
      const operator = await runOrderAction(order.id, 'accept_no_pos');
      expect({ manualAccepted: operator.result.ok, requestsBeforeTabletReply: outbound() })
        .toEqual({ manualAccepted: false, requestsBeforeTabletReply: [create, failed] });
      finishTablet.open();
      await processing;
      expect(await repo.getOrder(order.id)).toMatchObject({ status: 'failed' });
    } finally {
      finishTablet.open();
      await processing;
    }
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
