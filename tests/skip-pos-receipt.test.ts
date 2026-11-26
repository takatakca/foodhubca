import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as receiveSkipOrder } from '../app/api/foodhub/webhooks/skip/orders/route';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { INBOX } from '../lib/foodhub/inbox';
import { autoAcceptAfterClover, processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('automatic receipt of direct Skip orders', () => {
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
