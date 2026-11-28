// Delivery orders created in Clover by Clover's own platform integrations (Clover ↔ DoorDash…) — read-only in Food Hub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, importCloverPlatformOrders, platformFromLabel } from '../lib/foodhub/pos/clover-platform-orders';
import { allowedActions } from '../lib/foodhub/pipeline';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { getRepo } from '../lib/foodhub/repo';

const MID = 'TESTMERCH0002'; // made-up merchant ID (public repository)
const realFetch = globalThis.fetch;
let cloverOrders: any[] = [];
let calls: string[] = [];
let orderRequests: URLSearchParams[] = [];
let orderResponse: ((query: URLSearchParams) => Response | Promise<Response> | undefined) | undefined;

const sinceKey = `clover_platform_orders_since:${MID}`;
const day = 24 * 60 * 60_000;

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const json = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/order_types')) return json({ elements: [{ id: 'OT-DD', label: 'DoorDash' }, { id: 'OT-HERE', label: 'Sur place' }] });
    if (url.pathname.endsWith('/tenders')) return json({ elements: [{ id: 'T-CASH', label: 'Cash' }, { id: 'T-UBER', label: 'Uber Eats' }] });
    if (url.pathname.endsWith('/orders')) {
      const { searchParams } = url;
      orderRequests.push(searchParams);
      const intercepted = orderResponse?.(searchParams);
      if (intercepted) return intercepted;
      const filters = searchParams.getAll('filter');
      const since = Number(filters.find((filter) => filter.startsWith('createdTime>='))?.split('>=')[1] ?? 0);
      const until = Number(filters.find((filter) => filter.startsWith('createdTime<'))?.split('<')[1] ?? Infinity);
      const offset = Number(searchParams.get('offset') ?? 0);
      const limit = Number(searchParams.get('limit') ?? 100);
      const direction = searchParams.get('orderBy') === 'createdTime ASC,id ASC' ? 1 : -1;
      const rows = cloverOrders.filter((order) => order.createdTime >= since && order.createdTime < until)
        .sort((a, b) => direction * (a.createdTime - b.createdTime || a.id.localeCompare(b.id)));
      return json({ elements: rows.slice(offset, offset + limit) });
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
  cloverOrders = []; calls = []; orderRequests = []; orderResponse = undefined;
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
    // free text at the register only counts with the full platform name (go-live audit)
    expect(detectPlatform({ title: 'Table 4', note: 'skip the pickles' }, types, tenders)).toBeNull();
    expect(detectPlatform({ title: 'Uber' }, types, tenders)).toBeNull();
    expect(detectPlatform({ title: 'SkipTheDishes #4471' }, types, tenders)).toBe('skip');
    expect(detectPlatform({ note: 'Uber Eats order 9F3K2' }, types, tenders)).toBe('uber_eats');
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

  it.each([
    { ageMinutes: 10, status: 'accepted' },
    { ageMinutes: 100, status: 'completed' },
  ])('records the Clover receipt and $status status even if the import stops after the insert', async ({ ageMinutes, status }) => {
    const now = Date.now();
    const createdAt = now - ageMinutes * min;
    const repo = getRepo();
    const insert = repo.insertOrderIfNew.bind(repo);
    const externalOrderId = 'clover-DDNATIVE-INTERRUPTED';
    cloverOrders = [cloverOrder('DDNATIVE-INTERRUPTED', createdAt, { orderType: { id: 'OT-DD' } })];

    const interrupted = vi.spyOn(repo, 'insertOrderIfNew').mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new Error('Connection lost after the order insert committed');
    });
    try {
      const first = await importCloverPlatformOrders(MID, { now });
      expect(first.error).toBe('Connection lost after the order insert committed');
    } finally {
      interrupted.mockRestore();
    }

    const persistedOnInsert = await repo.findOrder('doordash', externalOrderId);
    const replay = await importCloverPlatformOrders(MID, { now: now + min });
    expect(replay).toMatchObject({ imported: 0, posOrderIds: [] });
    expect(replay.error).toBeUndefined();
    const rows = (await repo.listOrders()).filter((order) => order.externalOrderId === externalOrderId);
    expect(rows).toEqual([persistedOnInsert]);
    expect(rows[0]).toMatchObject({
      viaPos: 'clover',
      status,
      posOrderId: 'DDNATIVE-INTERRUPTED',
      timeline: {
        acceptedAt: new Date(createdAt).toISOString(),
        acceptedBy: 'clover',
        seenAt: expect.any(String),
        seenBy: 'Clover',
      },
    });
    expect(rows[0].timeline?.completedAt).toEqual(status === 'completed' ? expect.any(String) : undefined);
  });

  it('resumes a bounded window across the page budget without losing orders sharing the same creation time', async () => {
    const now = Date.now();
    const placed = now - 5 * min;
    const repo = getRepo();
    await repo.setKv(sinceKey, now - 10 * min);
    cloverOrders = Array.from({ length: 1003 }, (_, i) => {
      const id = `ORDER${String(i).padStart(4, '0')}`;
      return cloverOrder(id, placed, i === 0 || i === 990 || i === 991 || i === 1002 ? {} : { title: 'Table 4' });
    });
    cloverOrders.push(cloverOrder('JUSTAGED', now - 2 * min), cloverOrder('FRESH', now - 2 * min + 1));

    const first = await importCloverPlatformOrders(MID, { now });
    expect(first.error).toBeUndefined();
    expect(orderRequests).toHaveLength(10);
    expect(first.posOrderIds).toEqual(['ORDER0000', 'ORDER0990']);
    expect(await repo.getKv(sinceKey)).toBe(now - 10 * min);
    expect(orderRequests[0].getAll('filter')).toEqual([`createdTime>=${now - 10 * min}`, `createdTime<${now - 2 * min + 1}`]);
    expect(orderRequests[0].get('orderBy')).toBe('createdTime ASC,id ASC');

    const next = await importCloverPlatformOrders(MID, { now: now + day + min });
    expect(next).toMatchObject({ imported: 3, posOrderIds: ['ORDER0991', 'ORDER1002', 'JUSTAGED'] });
    expect(orderRequests[10].getAll('filter')).toEqual(orderRequests[0].getAll('filter'));
    expect(await repo.getKv(sinceKey)).toBe(now - 2 * min + 1);
    expect(await repo.findOrder('doordash', 'clover-FRESH')).toBeNull();

    const last = await importCloverPlatformOrders(MID, { now: now + day + 2 * min });
    expect(last.posOrderIds).toEqual(['FRESH']);
    const orders = await repo.listOrders();
    expect(orders).toHaveLength(6);
  });

  it('restarts the same window if Clover removes an order before the current page', async () => {
    const now = Date.now();
    const repo = getRepo();
    cloverOrders = Array.from({ length: 105 }, (_, i) => {
      const id = `ORDER${String(i).padStart(4, '0')}`;
      return cloverOrder(id, now - 5 * min, i === 100 ? {} : { title: 'Table 4' });
    });
    orderResponse = (query) => {
      if (query.get('offset') === '99') {
        cloverOrders.shift();
        orderResponse = undefined;
      }
      return undefined;
    };

    const result = await importCloverPlatformOrders(MID, { now });
    expect(result.posOrderIds).toEqual(['ORDER0100']);
    expect(orderRequests.map((query) => query.get('offset'))).toEqual(['0', '99', '0', '99']);
    expect(await repo.getKv(sinceKey)).toBe(now - 2 * min + 1);
  });

  it('does not duplicate orders or move the cursor back when an older poll finishes late', async () => {
    const now = Date.now();
    const repo = getRepo();
    const early = cloverOrder('EARLY', now - 5 * min);
    cloverOrders = [early, cloverOrder('LATER', now - min)];
    let release = () => {};
    let signal = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { signal = resolve; });
    orderResponse = async () => {
      orderResponse = undefined;
      signal();
      await held;
      return Response.json({ elements: [early] });
    };

    const late = importCloverPlatformOrders(MID, { now });
    let second, third;
    try {
      await entered;
      second = await importCloverPlatformOrders(MID, { now: now + 3 * min });
      third = await importCloverPlatformOrders(MID, { now: now + 6 * min });
    } finally {
      release();
    }
    expect(second?.posOrderIds).toEqual(['EARLY']);
    expect(third?.posOrderIds).toEqual(['LATER']);
    expect((await late).imported).toBe(0);
    expect(await repo.getKv(sinceKey)).toBe(now + 4 * min + 1);
    expect(await repo.listOrders()).toHaveLength(2);
  });

  it('preserves the current window on provider errors and malformed results', async () => {
    const now = Date.now();
    const since = now - 2 * day;
    const repo = getRepo();
    await repo.setKv(sinceKey, since);
    cloverOrders = [cloverOrder('OLDER', since + min)];
    orderResponse = () => new Response('{"error":"unavailable"}', { status: 503 });
    expect((await importCloverPlatformOrders(MID, { now })).error).toBeTruthy();
    expect(await repo.getKv(sinceKey)).toBe(since);
    orderResponse = () => new Response('{"unexpected":[]}');
    expect((await importCloverPlatformOrders(MID, { now })).error).toBeTruthy();
    expect(await repo.getKv(sinceKey)).toBe(since);
    orderResponse = () => new Response('{"elements":[{"id":"BROKEN"}]}');
    expect((await importCloverPlatformOrders(MID, { now })).error).toBeTruthy();
    expect(await repo.getKv(sinceKey)).toBe(since);

    orderResponse = undefined;
    expect((await importCloverPlatformOrders(MID, { now })).posOrderIds).toEqual(['OLDER']);
    expect(await repo.getKv(sinceKey)).toBe(now - 2 * min + 1);
  });

  it('reports a saved cursor outside Clover’s documented history without acknowledging it', async () => {
    const now = Date.now();
    const since = now - 91 * day;
    const repo = getRepo();
    await repo.setKv(sinceKey, since);
    const result = await importCloverPlatformOrders(MID, { now });
    expect(result.error).toMatch(/90 days/);
    expect(orderRequests).toHaveLength(0);
    expect(await repo.getKv(sinceKey)).toBe(since);
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

  it('many brands on one Clover: the brand comes from the order when it names one, otherwise it stays unknown (never guessed)', async () => {
    const now = Date.now();
    const repo = getRepo();
    for (const [brand, loc, id] of [['Po Poulet', 'NDG_6284', 'dd-pp'], ['Pi Pita', 'NDG_6284', 'dd-pita'], ['OOeuf', 'HOCHELAGA', 'dd-oeuf']] as const) {
      await repo.upsertStore({ channel: 'doordash', channelStoreId: id, brandName: brand, locationCode: loc, cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
    }
    cloverOrders = [
      cloverOrder('NAMED1', now - 5 * min, { orderType: { id: 'OT-DD' }, note: 'DoorDash — Pi Pita (NDG)' }),
      cloverOrder('ANON1', now - 5 * min, { orderType: { id: 'OT-DD' } }),
    ];
    await importCloverPlatformOrders(MID, { now });
    expect(await repo.findOrder('doordash', 'clover-NAMED1')).toMatchObject({ brandName: 'Pi Pita', locationCode: 'NDG_6284' });
    const anon = await repo.findOrder('doordash', 'clover-ANON1');
    expect(anon?.brandName).toBeUndefined();
    expect(anon?.locationCode).toBeUndefined();
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
