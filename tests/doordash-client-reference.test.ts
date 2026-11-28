import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as doorDashWebhook } from '../app/api/foodhub/webhooks/doordash/route';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => Promise<void>> }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(),
  after: (task: () => Promise<void>) => { deferred.push(task); },
}));

const AUTH = 'synthetic-doordash-authorization';
const CLOVER = 'https://clover.fixture.test';
const POS_ID = 'FIXTUREPOS001';
const provider = vi.fn<typeof fetch>();
const NORTH = { store: 'fixture-dd-north', name: 'FIXTURE_NORTH', merchant: 'FIXTUREMIDN01' };
const SOUTH = { store: 'fixture-dd-south', name: 'FIXTURE_SOUTH', merchant: 'FIXTUREMIDS01' };
type Kitchen = typeof NORTH;

async function addOrder(kitchen: Kitchen, ref: string, opts: Pick<NormalizedOrder, 'viaPos' | 'viaHub'> & { createdAt?: string } = {}) {
  const repo = getRepo();
  await repo.upsertStore({
    channel: 'doordash', channelStoreId: kitchen.store, locationCode: kitchen.name, brandName: 'Fixture brand',
    cloverMerchantId: kitchen.merchant, autoAccept: false, online: true, meta: {},
  });
  const { order } = await repo.insertOrderIfNew({
    channel: 'doordash', marketplace: 'doordash', externalOrderId: ref, channelStoreId: kitchen.store,
    locationCode: kitchen.name, brandName: 'Fixture brand', currency: 'CAD', fulfillment: 'pickup', placedAt: opts.createdAt ?? new Date().toISOString(), subtotal: 10, total: 10,
    tax: 0, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, ...opts,
  });
  const saved = await repo.updateOrder(order.id, { posOrderId: POS_ID, status: 'ready' });
  if (!saved) throw new Error('Missing DoorDash fixture order');
  return saved;
}

async function post(body: Record<string, unknown>) {
  const res = await doorDashWebhook(new NextRequest('http://hub.local/api/foodhub/webhooks/doordash', {
    method: 'POST', headers: { authorization: AUTH }, body: JSON.stringify(body),
  }));
  for (const task of deferred.splice(0)) await task();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
}

const cancellation = (clientOrderId: string = POS_ID, fields: Record<string, unknown> = {}) => ({
  event: { type: 'order_cancel' }, client_order_id: clientOrderId, cancel_reason: 'Customer requested cancellation', ...fields,
});

const dasherUpdate = (delivery: Record<string, unknown>, fields: Record<string, unknown> = {}) => ({
  event: { type: 'dasher_status_update' }, ...fields,
  delivery: { client_order_id: POS_ID, dasher_status: 'arrived_at_store', ...delivery },
});

async function expectKept(body: Record<string, unknown>) {
  expect(await getRepo().listJobs(10)).toContainEqual(expect.objectContaining({
    channel: 'doordash', kind: 'webhook_unparsed', request: expect.objectContaining({ body }),
  }));
}

beforeEach(() => {
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_VIA_CLOVER: undefined, DOORDASH_ENV: undefined, DOORDASH_SANDBOX_STORE_IDS: undefined,
    DOORDASH_WEBHOOK_SECRET: AUTH, DOORDASH_SANDBOX_WEBHOOK_SECRET: undefined, FOODHUB_MEV: 'off', FOODHUB_CLOVER_DELETE_CANCELLED: 'on',
    CLOVER_BASE_URL: CLOVER, CLOVER_MERCHANT_ID: undefined, CLOVER_ACCESS_TOKEN: undefined,
    CLOVER_MERCHANT_TOKENS: JSON.stringify({ [NORTH.merchant]: 'fixture-token-a', [SOUTH.merchant]: 'fixture-token-b' }),
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  provider.mockReset().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', provider);
});

afterEach(() => {
  expect(deferred).toHaveLength(0);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('DoorDash signed legacy order attribution', () => {
  it.each([
    ['cancellation', cancellation()],
    ['Dasher pickup', { event: { type: 'dasher_status_update' }, delivery: { client_order_id: POS_ID, dasher_status: 'picked_up' } }],
    ['order release', { event: { type: 'order_release' }, client_order_id: POS_ID, dasher: {} }],
  ] as const)('keeps an ambiguous %s and does not touch either kitchen', async (_kind, body) => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    await post(body);

    for (const o of [north, south]) {
      expect(await getRepo().getOrder(o.id)).toEqual(o);
      expect(await getRepo().listEvents(o.id)).toEqual([]);
    }
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('does not use a short recent window as evidence that a Clover ID is unique', async () => {
    await addOrder(NORTH, 'fixture-older', { createdAt: new Date(Date.now() - 4 * 86400_000).toISOString() });
    const recent = await addOrder(SOUTH, 'fixture-recent');
    const body = cancellation();
    await post(body);
    expect(await getRepo().getOrder(recent.id)).toEqual(recent);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('uses the supplied merchant store ID to attest the exact kitchen', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    await post(cancellation(POS_ID, { store: { merchant_supplied_id: SOUTH.store } }));

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toMatchObject({ status: 'cancelled', timeline: { cancelledBy: 'customer' } });
    expect(provider.mock.calls.map(([u, init]) => [String(u), init?.method])).toEqual([
      [`${CLOVER}/v3/merchants/${SOUTH.merchant}/orders/${POS_ID}`, 'DELETE'],
    ]);
  });

  it('uses the nested Dasher location for a shared Clover reference and records its payment only once', async () => {
    vi.stubEnv('FOODHUB_CLOVER_RECORD_PAYMENT', 'on');
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    const tenderUrl = `${CLOVER}/v3/merchants/${SOUTH.merchant}/tenders?limit=1000`;
    const paymentUrl = `${CLOVER}/v3/merchants/${SOUTH.merchant}/orders/${POS_ID}/payments`;
    provider.mockImplementation(async (url, init) => {
      if (String(url) === tenderUrl && !init?.method) {
        return Response.json({ elements: [{ id: 'fixture-tender', label: 'DoorDash' }] });
      }
      if (String(url) === paymentUrl && init?.method === 'POST') return Response.json({ id: 'fixture-payment' });
      throw new Error(`Unexpected fixture provider request: ${String(url)}`);
    });
    const body = dasherUpdate({ location_id: SOUTH.store, dasher_status: 'dasher_out_for_delivery' });

    await post(body);
    const saved = await getRepo().getOrder(south.id);
    expect(saved).toMatchObject({
      status: 'dispatched', timeline: { courier: { status: 'picked_up' }, dispatchedAt: expect.any(String), posPaymentId: 'fixture-payment' },
    });
    await post(body);

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().listEvents(north.id)).toEqual([]);
    expect(await getRepo().getOrder(south.id)).toMatchObject({
      status: 'dispatched', timeline: { dispatchedAt: saved?.timeline?.dispatchedAt, posPaymentId: 'fixture-payment' },
    });
    expect(provider.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      [tenderUrl, undefined],
      [paymentUrl, 'POST'],
    ]);
  });

  it('holds a unique Clover reference when the Dasher location names another kitchen', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const body = dasherUpdate({ location_id: SOUTH.store, dasher_status: 'dasher_out_for_delivery' });
    await post(body);

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().listEvents(north.id)).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('uses matching Dasher and merchant store references', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    await post(dasherUpdate({ location_id: SOUTH.store }, { store: { merchant_supplied_id: SOUTH.store } }));

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toMatchObject({ timeline: { courier: { status: 'at_store' } } });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { store: { merchant_supplied_id: NORTH.store } },
    { location_id: NORTH.store },
  ])('holds conflicting Dasher location and store references %o', async (fields) => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    const body = dasherUpdate({ location_id: SOUTH.store }, fields);
    await post(body);

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toEqual(south);
    expect(await getRepo().listEvents(north.id)).toEqual([]);
    expect(await getRepo().listEvents(south.id)).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('keeps the provider order ID authoritative for a Dasher update with conflicting legacy scope', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    await post(dasherUpdate({ external_order_id: south.externalOrderId, location_id: SOUTH.store }, { store: { merchant_supplied_id: NORTH.store } }));

    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toMatchObject({ timeline: { courier: { status: 'at_store' } } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('retains an internal-order reference with a conflicting supplied store', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const body = cancellation(north.id, { store: { merchant_supplied_id: SOUTH.store } });
    await post(body);
    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('keeps an ambiguous reference that is both an internal order ID and a different order’s Clover ID', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    const shared = await getRepo().updateOrder(south.id, { posOrderId: north.id });
    const body = cancellation(north.id);
    await post(body);
    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toEqual(shared);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('keeps an exact internal order ID usable when the source and supplied store agree', async () => {
    const order = await addOrder(NORTH, 'fixture-direct-internal');
    await post(cancellation(order.id, { store: { merchant_supplied_id: NORTH.store } }));
    expect(await getRepo().getOrder(order.id)).toMatchObject({ status: 'cancelled', timeline: { cancelledBy: 'customer' } });
  });

  it.each([{ viaPos: 'clover' }, { viaHub: 'relay' }, { viaHub: 'screen' }] as const)('never uses legacy POS fallback for non-direct source %o', async (source) => {
    const order = await addOrder(NORTH, 'fixture-foreign-source', source);
    const body = cancellation();
    await post(body);
    expect(await getRepo().getOrder(order.id)).toEqual(order);
    expect(provider).not.toHaveBeenCalled();
    await expectKept(body);
  });

  it('keeps the provider order ID authoritative when the obsolete client reference is ambiguous', async () => {
    const north = await addOrder(NORTH, 'fixture-dd-order-north');
    const south = await addOrder(SOUTH, 'fixture-dd-order-south');
    await post(cancellation(POS_ID, { external_order_id: south.externalOrderId }));
    expect(await getRepo().getOrder(north.id)).toEqual(north);
    expect(await getRepo().getOrder(south.id)).toMatchObject({ status: 'cancelled' });
  });

  it('keeps a unique recent direct POS reference usable without a supplied store ID', async () => {
    const order = await addOrder(NORTH, 'fixture-direct-unique');
    await post(cancellation());
    expect(await getRepo().getOrder(order.id)).toMatchObject({ status: 'cancelled', timeline: { cancelledBy: 'customer' } });
    expect(provider.mock.calls.map(([u, init]) => [String(u), init?.method])).toEqual([
      [`${CLOVER}/v3/merchants/${NORTH.merchant}/orders/${POS_ID}`, 'DELETE'],
    ]);
  });
});
