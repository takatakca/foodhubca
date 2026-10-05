// Delivery orders created in Clover by Clover's own platform integrations (Clover ↔ DoorDash…) — read-only in Food Hub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, importCloverPlatformOrders, platformFromLabel } from '../lib/foodhub/pos/clover-platform-orders';
import { allowedActions } from '../lib/foodhub/pipeline';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { getRepo } from '../lib/foodhub/repo';

const MID = 'YJ4W50YPJQSQ1';
const realFetch = globalThis.fetch;
let cloverOrders: any[] = [];
let calls: string[] = [];

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const json = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/order_types')) return json({ elements: [{ id: 'OT-DD', label: 'DoorDash' }, { id: 'OT-HERE', label: 'Sur place' }] });
    if (url.pathname.endsWith('/tenders')) return json({ elements: [{ id: 'T-CASH', label: 'Cash' }, { id: 'T-UBER', label: 'Uber Eats' }] });
    if (url.pathname.endsWith('/orders')) {
      const since = Number((url.searchParams.get('filter') || '').split('>=')[1] || 0);
      return json({ elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverOrders.filter((o) => o.createdTime >= since) });
    }
    return new Response('{}', { status: 404 });
  }) as any;
}

const min = 60_000;
function cloverOrder(id: string, createdTime: number, extra: Record<string, unknown> = {}) {
  return {
    id, createdTime, title: `DoorDash #${id}`, total: 2499, currency: 'CAD', state: 'locked',
    lineItems: { elements: [{ id: `${id}-L1`, name: 'Poulet Grillé', price: 1599, item: { id: 'clv-item-1' }, modifications: { elements: [{ name: 'Piri-piri', amount: 100 }] } }, { id: `${id}-L2`, name: 'Frites', price: 499 }] },
    payments: { elements: [{ id: `${id}-P`, amount: 2499, taxAmount: 301, tipAmount: 0, tender: { id: 'T-OTHER' } }] },
    customers: { elements: [{ firstName: 'Ana', lastName: 'B.' }] },
    ...extra,
  };
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.CLOVER_MERCHANT_ID = MID;
  process.env.CLOVER_ACCESS_TOKEN = 'ENV-TOKEN';
  delete process.env.FOODHUB_CLOVER_PLATFORM_ORDERS;
  cloverOrders = []; calls = [];
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('platform orders received through Clover', () => {
  it('recognises the platform from an order type, a tender, a title or a note', () => {
    expect(platformFromLabel('DoorDash')).toBe('doordash');
    expect(platformFromLabel('UBER EATS')).toBe('uber_eats');
    expect(platformFromLabel('SkipTheDishes')).toBe('skip');
    expect(platformFromLabel('Too Good To Go')).toBe('tgtg');
    expect(platformFromLabel('Sur place')).toBeNull();
    const types = new Map([['OT-DD', 'DoorDash']]);
    const tenders = new Map([['T-UBER', 'Uber Eats']]);
    expect(detectPlatform({ orderType: { id: 'OT-DD' } }, types, tenders)).toBe('doordash');
    expect(detectPlatform({ payments: { elements: [{ tender: { id: 'T-UBER' } }] } }, types, tenders)).toBe('uber_eats');
    expect(detectPlatform({ title: 'Table 4' }, types, tenders)).toBeNull();
  });

  it('adds the DoorDash order read-only (via Clover), skips in-store and Food Hub orders, never twice', async () => {
    const now = Date.now();
    cloverOrders = [
      cloverOrder('DDNATIVE1', now - 10 * min, { orderType: { id: 'OT-DD' } }),
      cloverOrder('INSTORE1', now - 9 * min, { title: 'Table 4', orderType: { id: 'OT-HERE' }, payments: { elements: [{ amount: 1500, tender: { id: 'T-CASH' } }] } }),
      cloverOrder('FOODHUB1', now - 8 * min, { orderType: { id: 'OT-DD' } }),
      cloverOrder('TOONEW', now - 30_000, { orderType: { id: 'OT-DD' } }),
    ];
    const r = await importCloverPlatformOrders(MID, { now, knownPosOrderIds: new Set(['FOODHUB1']) });
    expect(r.error).toBeUndefined();
    expect(r.imported).toBe(1);
    expect(r.posOrderIds).toEqual(['DDNATIVE1']);
    const o = await getRepo().findOrder('doordash', 'clover-DDNATIVE1');
    expect(o?.viaPos).toBe('clover');
    expect(o?.status).toBe('accepted');
    expect(o?.posOrderId).toBe('DDNATIVE1');
    expect(o?.displayId).toBe('DDNATIVE1');
    expect(o?.customerName).toBe('Ana B.');
    expect(o?.total).toBe(24.99);
    expect(o?.tax).toBe(3.01);
    expect(o?.lines[0]).toMatchObject({ name: 'Poulet Grillé', posItemRef: 'clv-item-1', unitPrice: 15.99, total: 16.99 });
    expect(o?.timeline?.seenAt).toBeTruthy(); // no new-order pop-up: Clover already printed it

    // next run: the too-new order is now old enough; nothing is added twice
    const r2 = await importCloverPlatformOrders(MID, { now: now + 3 * min, knownPosOrderIds: new Set(['FOODHUB1', 'DDNATIVE1']) });
    expect(r2.posOrderIds).toEqual(['TOONEW']);
    const r3 = await importCloverPlatformOrders(MID, { now: now + 6 * min });
    expect(r3.imported).toBe(0);
  });

  it('never reads back an order Food Hub created itself, even when its Clover id was not saved', async () => {
    const now = Date.now();
    await getRepo().insertOrderIfNew({ channel: 'doordash', marketplace: 'doordash', externalOrderId: 'dd-real-1', displayId: 'A1B2C3', channelStoreId: 'dd-store', fulfillment: 'delivery', placedAt: new Date(now - 20 * min).toISOString(), currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10, lines: [], raw: {} });
    cloverOrders = [cloverOrder('ORPHAN1', now - 10 * min, { title: 'DoorDash #A1B2C3', orderType: { id: 'OT-DD' } })];
    expect((await importCloverPlatformOrders(MID, { now })).imported).toBe(0);
  });

  it('only lets the kitchen move it on its own screen and never records a Clover payment', async () => {
    const now = Date.now();
    cloverOrders = [cloverOrder('DDNATIVE2', now - 10 * min, { orderType: { id: 'OT-DD' } })];
    await importCloverPlatformOrders(MID, { now });
    const o = (await getRepo().findOrder('doordash', 'clover-DDNATIVE2'))!;
    expect(allowedActions(o)).toEqual(['ready', 'complete', 'print']);
    calls = [];
    const done = await getRepo().updateOrder(o.id, { status: 'completed' });
    expect(await settleInClover(done)).toEqual(done);
    expect(calls).toEqual([]);
  });

  it('old orders arrive as completed, and FOODHUB_CLOVER_PLATFORM_ORDERS=off turns it off', async () => {
    const now = Date.now();
    cloverOrders = [cloverOrder('OLD1', now - 5 * 60 * min, { orderType: { id: 'OT-DD' } })];
    process.env.FOODHUB_CLOVER_PLATFORM_ORDERS = 'off';
    expect((await importCloverPlatformOrders(MID, { now })).imported).toBe(0);
    delete process.env.FOODHUB_CLOVER_PLATFORM_ORDERS;
    await importCloverPlatformOrders(MID, { now });
    expect((await getRepo().findOrder('doordash', 'clover-OLD1'))?.status).toBe('completed');
  });
});

describe('platforms linked to Clover directly (FOODHUB_VIA_CLOVER)', async () => {
  const { getAdapter } = await import('../lib/foodhub/adapters');
  it('shows DoorDash as linked through Clover and refuses platform actions without pretending they were done', async () => {
    process.env.FOODHUB_VIA_CLOVER = 'doordash';
    try {
      const dd = getAdapter('doordash');
      const r = dd.readiness();
      expect(r).toMatchObject({ configured: true, canSend: false, viaClover: true, missing: [] });
      expect(r.noteFr).toMatch(/Relié par Clover/);
      const store = { id: 's1', channel: 'doordash', channelStoreId: 'dd-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} } as any;
      const res = await dd.setStoreOnline(store, false);
      expect(res.ok).toBe(false);
      expect(res.status).toBe('blocked');
      expect(res.message).toMatch(/linked through Clover/);
      expect(getAdapter('uber_eats').readiness().viaClover).toBeUndefined();
    } finally {
      delete process.env.FOODHUB_VIA_CLOVER;
    }
    expect(getAdapter('doordash').readiness().viaClover).toBeUndefined();
  });
});
