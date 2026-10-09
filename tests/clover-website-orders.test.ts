// Website orders taken by Clover Online Ordering, mirrored on the Food Hub kitchen screen. Clover is the source of truth.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCloverState, classifyCloverOrder, cloverOnlineBlockedReason, handleCloverOrderEvents, importCloverWebsiteOrders, isCloverOnlineOrderType,
  isFoodHubTitle, isSiteWebMarked, listOpenWebsiteOrders, readCloverOrderState, runWebsiteOrderAction, upsertCloverOnlineOrder, websiteOrderDocId,
} from '../lib/foodhub/pos/clover-website-orders';
import { getDirectOrder, listDirectOrders } from '../lib/foodhub/delivery/store';
import { runDirectAction } from '../lib/foodhub/delivery/orders';
import { createDirectOrderInClover } from '../lib/foodhub/delivery/clover-direct';
import { isOwnDeliveryOrder } from '../lib/foodhub/delivery/clover-source';
import { getRepo } from '../lib/foodhub/repo';

const MID = 'TESTMERCH0003'; // made-up merchant ID (public repository)
const realFetch = globalThis.fetch;
const min = 60_000;
const actor = { username: 'cook', name: 'Cook', source: 'dashboard' as const };
let cloverOrders: any[] = [];
let calls: Array<{ method: string; path: string }> = [];

const ORDER_TYPES = [{ id: 'OT-OLP', label: 'Online Order Pick Up' }, { id: 'OT-OLD', label: 'Online Order Delivery' }, { id: 'OT-DINE', label: 'Dine In' }, { id: 'OT-DD', label: 'DoorDash' }];

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ method, path: url.pathname });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/order_types')) return json({ elements: ORDER_TYPES });
    if (url.pathname.endsWith('/tenders')) return json({ elements: [{ id: 'T-CARD', label: 'Credit Card' }, { id: 'T-DD', label: 'DoorDash' }] });
    if (url.pathname.endsWith('/orders')) {
      const since = Number((url.searchParams.get('filter') || '').split('>=')[1] || 0);
      return json({ elements: Number(url.searchParams.get('offset') || 0) ? [] : cloverOrders.filter((o) => o.createdTime >= since) });
    }
    const one = url.pathname.match(/\/orders\/([^/]+)$/);
    if (one && method === 'GET') { const o = cloverOrders.find((x) => x.id === one[1]); return o ? json(o) : json({ message: 'Not Found' }, 404); }
    return json({}, 404);
  }) as any;
}

function webOrder(id: string, createdTime: number, extra: Record<string, unknown> = {}) {
  return {
    id, createdTime, title: '', total: 2299, currency: 'CAD', state: 'locked', paymentState: 'PAID', orderType: { id: 'OT-OLP' },
    lineItems: { elements: [
      { id: `${id}-L1`, name: 'Pizza Pepperoni', price: 1599, item: { id: 'clv-pizza' }, printed: true, modifications: { elements: [{ name: 'Extra fromage', amount: 200 }] } },
      { id: `${id}-L2`, name: 'Coke', price: 300, printed: true, note: 'allergie arachides' },
    ] },
    payments: { elements: [{ id: `${id}-P`, amount: 2299, taxAmount: 300, tipAmount: 0, result: 'SUCCESS', tender: { id: 'T-CARD' } }] },
    customers: { elements: [{ firstName: 'Léa', lastName: 'Tremblay' }] },
    ...extra,
  };
}

const posts = () => calls.filter((c) => c.method !== 'GET');

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.CLOVER_MERCHANT_ID = MID;
  process.env.CLOVER_ACCESS_TOKEN = 'ENV-TOKEN';
  for (const k of ['FOODHUB_CLOVER_WEBSITE_ORDERS', 'FOODHUB_CLOVER_WEBSITE_ORDER_TYPES', 'FOODHUB_CLOVER_WEBSITE_LOCATION', 'FOODHUB_CLOVER_WEBSITE_BRAND', 'FOODHUB_CLOVER_WEBSITE_CLOSE_MIN']) delete process.env[k];
  cloverOrders = []; calls = [];
  mockClover();
  // One kitchen uses this Clover: website orders go there.
  await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-ppp', brandName: 'PPP Pizzeria', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('recognising a website order in Clover', () => {
  const types = new Map(ORDER_TYPES.map((t) => [t.id, t.label]));
  const tenders = new Map([['T-CARD', 'Credit Card'], ['T-DD', 'DoorDash']]);
  const kind = (co: any, known?: Set<string>) => classifyCloverOrder(co, { orderTypes: types, tenders, known });

  it('a Clover online-ordering order type is a website order; platforms, Food Hub tickets and in-store orders are not', () => {
    expect(kind({ id: 'A', orderType: { id: 'OT-OLP' } })).toBe('website');
    expect(kind({ id: 'A', orderType: { id: 'OT-OLD' } })).toBe('website');
    expect(kind({ id: 'A', orderType: { id: 'OT-DINE' } })).toBe('other');
    expect(kind({ id: 'A' })).toBe('other');
    expect(kind({ id: 'A', orderType: { id: 'OT-DD' } })).toBe('platform');
    // Food Hub's own tickets use the same "Online Order Pick Up" type: recognised by title or by their known Clover id.
    expect(kind({ id: 'A', title: 'DoorDash #P41', orderType: { id: 'OT-OLP' } })).toBe('foodhub');
    expect(kind({ id: 'A', title: 'CANCELLED — Uber Eats #9F3K2', orderType: { id: 'OT-OLP' } })).toBe('foodhub');
    expect(kind({ id: 'A', title: '🌐 W-1043 · Po Poulet', orderType: { id: 'OT-OLP' } })).toBe('foodhub');
    expect(kind({ id: 'FH1', title: '', orderType: { id: 'OT-OLP' } }, new Set(['FH1']))).toBe('foodhub');
    // A delivery platform paid through Clover with an online type is still that platform's order.
    expect(kind({ id: 'A', orderType: { id: 'OT-OLP' }, payments: { elements: [{ tender: { id: 'T-DD' } }] } })).toBe('platform');
    expect(isFoodHubTitle('Léa T.')).toBe(false);
  });

  it('a brand website paying with Clover Hosted Checkout marks its order "Site web" (no online order type needed)', () => {
    expect(kind({ id: 'A', title: '🌐 Site web · PPP-AB12C · Marie' })).toBe('website');
    expect(kind({ id: 'A', title: '', note: 'SITE WEB pppmtl.com | POUR EMPORTER / PICKUP | PAYÉ EN LIGNE / PAID ONLINE (Clover)' })).toBe('website');
    expect(kind({ id: 'A', title: 'Website order', orderType: { id: 'OT-DINE' } })).toBe('website');
    expect(isSiteWebMarked({ title: 'Table 4 — site visit' })).toBe(false);
    // Food Hub's own website tickets and platform orders keep their kind.
    expect(kind({ id: 'A', title: '🌐 W-1043 · PPP Pizzeria' })).toBe('foodhub');
    expect(kind({ id: 'A', title: '🌐 Site web · PPP-AB12C', payments: { elements: [{ tender: { id: 'T-DD' } }] } })).toBe('platform');
    expect(kind({ id: 'FH1', title: '🌐 Site web · PPP-AB12C' }, new Set(['FH1']))).toBe('foodhub');
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    expect(kind({ id: 'A', title: '🌐 Site web · PPP-AB12C · Marie' })).toBe('other');
  });

  it('FOODHUB_CLOVER_WEBSITE_ORDER_TYPES pins the types; =off turns the whole thing off', () => {
    process.env.FOODHUB_CLOVER_WEBSITE_ORDER_TYPES = 'Dine In';
    expect(isCloverOnlineOrderType({ orderType: { id: 'OT-DINE' } }, types)).toBe(true);
    expect(isCloverOnlineOrderType({ orderType: { id: 'OT-OLP' } }, types)).toBe(false);
    process.env.FOODHUB_CLOVER_WEBSITE_ORDER_TYPES = 'ot-olp';
    expect(isCloverOnlineOrderType({ orderType: { id: 'OT-OLP' } }, types)).toBe(true);
    delete process.env.FOODHUB_CLOVER_WEBSITE_ORDER_TYPES;
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    expect(kind({ id: 'A', orderType: { id: 'OT-OLP' } })).toBe('other');
  });

  it('the own-delivery reader leaves Clover online "Delivery" orders to the website mirror (never imported twice)', () => {
    expect(isOwnDeliveryOrder({ orderType: { id: 'OT-OLD' } }, types)).toBe(false);
    expect(isOwnDeliveryOrder({ orderType: { id: 'X' } }, new Map([['X', 'Livraison']]))).toBe(true);
    process.env.FOODHUB_CLOVER_WEBSITE_ORDERS = 'off';
    expect(isOwnDeliveryOrder({ orderType: { id: 'OT-OLD' } }, types)).toBe(true);
  });
});

describe('what Clover says about the order', () => {
  it('reads deleted, refunded, voided, partly refunded, paid and printed — never a "ready" Clover does not have', () => {
    expect(readCloverOrderState(null)).toMatchObject({ gone: true });
    expect(readCloverOrderState({ deleted: true })).toMatchObject({ gone: true });
    expect(readCloverOrderState({ total: 1000, paymentState: 'REFUNDED' })).toMatchObject({ refunded: true, paid: false, reason: 'Refunded in Clover' });
    expect(readCloverOrderState({ total: 1000, paymentState: 'CREDITED' })).toMatchObject({ refunded: true });
    expect(readCloverOrderState({ total: 1000, payments: { elements: [{ amount: 1000, result: 'VOIDED' }] } })).toMatchObject({ refunded: true, reason: 'Payment voided in Clover' });
    expect(readCloverOrderState({ total: 1000, paymentState: 'PARTIALLY_REFUNDED' })).toMatchObject({ refunded: false, partlyRefunded: true });
    expect(readCloverOrderState({ total: 1000, refunds: { elements: [{ amount: 1000 }] } })).toMatchObject({ refunded: true });
    const s = readCloverOrderState({ total: 1000, paymentState: 'PAID', lineItems: { elements: [{ printed: false }, { printed: true }] } });
    expect(s).toMatchObject({ gone: false, refunded: false, paid: true, printed: true });
    expect(Object.keys(s)).not.toContain('ready');
  });
});

describe('poller: Clover → Food Hub kitchen screen', () => {
  it('shows a website order once, as accepted in Clover, without ever writing to Clover', async () => {
    const now = Date.now();
    cloverOrders = [
      webOrder('WEB1', now - 2 * min),
      webOrder('INSTORE1', now - 2 * min, { orderType: { id: 'OT-DINE' } }),
      webOrder('DD1', now - 2 * min, { orderType: { id: 'OT-DD' }, title: 'DoorDash #A1' }),
      webOrder('FHTICKET', now - 2 * min, { title: 'Uber Eats #9F3K2' }),
      webOrder('TOOFRESH', now - 3_000),
    ];
    const r = await importCloverWebsiteOrders(MID, { now });
    expect(r.error).toBeUndefined();
    expect(r.imported).toBe(1);
    const o = (await getDirectOrder(websiteOrderDocId('WEB1')))!;
    expect(o).toMatchObject({
      source: 'clover_online', sourceRef: 'WEB1', posOrderId: 'WEB1', posMerchantId: MID, status: 'in_kitchen', payment: 'paid',
      brandName: 'PPP Pizzeria', locationCode: 'NDG_6284', fulfillment: 'pickup', total: 22.99, tax: 3, customer: { name: 'Léa T.' },
    });
    expect(o.number).toMatch(/^WEB-\d+$/);
    expect(o.posPrintedAt).toBeTruthy();
    expect(o.lines[0]).toMatchObject({ name: 'Pizza Pepperoni', posItemRef: 'clv-pizza', unitPrice: 15.99, total: 17.99 });
    expect(o.events[0].message).toMatch(/accepted in Clover/);
    // Read-only: no Clover order created, no print event, nothing written.
    expect(posts()).toEqual([]);
    // Next run: the fresh one is old enough now; nothing shown twice.
    const r2 = await importCloverWebsiteOrders(MID, { now: now + min });
    expect(r2.imported).toBe(1);
    expect((await importCloverWebsiteOrders(MID, { now: now + 2 * min })).imported).toBe(0);
    expect((await listDirectOrders()).filter((d) => d.sourceRef === 'WEB1')).toHaveLength(1);
    expect((await listOpenWebsiteOrders({ locationCodes: ['NDG_6284'], now: now + 2 * min })).map((d) => d.sourceRef)).toEqual(['WEB1', 'TOOFRESH']);
    expect(await listOpenWebsiteOrders({ locationCodes: ['HOCHELAGA'], now: now + 2 * min })).toEqual([]);
  });

  it('an order Clover dated a little before the last run (its clock differs from ours) is still read', async () => {
    const now = Date.now();
    await importCloverWebsiteOrders(MID, { now }); // nothing yet; the cursor moves on
    cloverOrders = [webOrder('SKEW1', now - 30_000)];
    expect((await importCloverWebsiteOrders(MID, { now: now + 15_000 })).imported).toBe(1);
  });

  it('never reads back an order Food Hub created itself (its Clover id is known)', async () => {
    const now = Date.now();
    const { order } = await getRepo().insertOrderIfNew({ channel: 'doordash', marketplace: 'doordash', externalOrderId: 'dd-1', channelStoreId: 'dd-ppp', fulfillment: 'pickup', placedAt: new Date(now - 5 * min).toISOString(), currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10, lines: [], raw: {} });
    await getRepo().updateOrder(order.id, { posOrderId: 'FHCLV1' });
    cloverOrders = [webOrder('FHCLV1', now - 2 * min)];
    expect((await importCloverWebsiteOrders(MID, { now })).imported).toBe(0);
  });

  it('mirrors Clover: printed later, then refunded → cancelled on the kitchen screen; a deleted order too', async () => {
    const now = Date.now();
    const unprinted = webOrder('WEB2', now - 2 * min);
    unprinted.lineItems.elements.forEach((l: any) => { l.printed = false; });
    cloverOrders = [unprinted, webOrder('WEB3', now - 2 * min)];
    await importCloverWebsiteOrders(MID, { now });
    expect((await getDirectOrder(websiteOrderDocId('WEB2')))?.posPrintedAt).toBeUndefined();

    unprinted.lineItems.elements.forEach((l: any) => { l.printed = true; });
    expect((await importCloverWebsiteOrders(MID, { now: now + min })).updated).toBe(1);
    expect((await getDirectOrder(websiteOrderDocId('WEB2')))?.posPrintedAt).toBeTruthy();

    unprinted.paymentState = 'REFUNDED';
    cloverOrders = cloverOrders.filter((o) => o.id !== 'WEB3'); // deleted in Clover → 404
    await importCloverWebsiteOrders(MID, { now: now + 2 * min });
    const w2 = (await getDirectOrder(websiteOrderDocId('WEB2')))!;
    const w3 = (await getDirectOrder(websiteOrderDocId('WEB3')))!;
    expect(w2.status).toBe('cancelled');
    expect(w2.events.at(-1)?.message).toMatch(/Refunded in Clover/);
    expect(w3.status).toBe('cancelled');
    expect(w3.events.at(-1)?.message).toMatch(/Removed in Clover/);
    expect(posts()).toEqual([]);
  });

  it('an order already refunded the first time it is seen is not shown; an old one is kept as history only', async () => {
    const now = Date.now();
    cloverOrders = [webOrder('REF1', now - 2 * min, { paymentState: 'REFUNDED' }), webOrder('OLD1', now - 5 * 60 * min), webOrder('OLD2', now - 2 * 60 * min)];
    await importCloverWebsiteOrders(MID, { now });
    expect(await getDirectOrder(websiteOrderDocId('REF1'))).toBeNull();
    expect((await getDirectOrder(websiteOrderDocId('OLD1')))?.status).toBe('completed');
    expect((await getDirectOrder(websiteOrderDocId('OLD2')))?.status).toBe('completed'); // first seen 2 h late (e.g. first run after a deploy)
  });

  it('several kitchens on one Clover: the kitchen is pinned by FOODHUB_CLOVER_WEBSITE_LOCATION, else guessed and flagged', async () => {
    const now = Date.now();
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-hoch', brandName: 'OOeuf', locationCode: 'HOCHELAGA', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
    cloverOrders = [webOrder('G1', now - 2 * min)];
    await importCloverWebsiteOrders(MID, { now });
    expect((await getDirectOrder(websiteOrderDocId('G1')))?.attention).toMatch(/FOODHUB_CLOVER_WEBSITE_LOCATION/);
    process.env.FOODHUB_CLOVER_WEBSITE_LOCATION = JSON.stringify({ [MID]: 'HOCHELAGA' });
    process.env.FOODHUB_CLOVER_WEBSITE_BRAND = 'PPP Pizzeria';
    const r = await upsertCloverOnlineOrder(MID, webOrder('G2', now - 2 * min), { now });
    expect(r.order).toMatchObject({ locationCode: 'HOCHELAGA', brandName: 'PPP Pizzeria' });
    expect(r.order?.attention).toBeUndefined();
  });
});

describe('webhook: Clover Orders events', () => {
  const hook = (...events: Array<[string, string]>) => ({ appId: 'APP', merchants: { [MID]: events.map(([id, type]) => ({ objectId: `O:${id}`, type, ts: Date.now() })) } });

  it('a new website order shows at once; updates and deletes follow; other orders cost one read only', async () => {
    const now = Date.now();
    cloverOrders = [webOrder('WH1', now - 5_000), webOrder('INSTORE2', now - 5_000, { orderType: { id: 'OT-DINE' } })];
    const r = await handleCloverOrderEvents(hook(['WH1', 'CREATE'], ['INSTORE2', 'CREATE']), now);
    expect(r.imported).toBe(1);
    expect((await getDirectOrder(websiteOrderDocId('WH1')))?.status).toBe('in_kitchen');

    // The in-store order is not re-read on each of its updates.
    calls = [];
    await handleCloverOrderEvents(hook(['INSTORE2', 'UPDATE']), now + 1000);
    expect(calls.filter((c) => c.path.endsWith('/orders/INSTORE2'))).toEqual([]);

    // The poller meets the same order: still one copy.
    await importCloverWebsiteOrders(MID, { now: now + min });
    expect((await listDirectOrders()).filter((d) => d.sourceRef === 'WH1')).toHaveLength(1);

    // Refunded in Clover → UPDATE → cancelled here. Deleted → cancelled too.
    cloverOrders[0].paymentState = 'REFUNDED';
    await handleCloverOrderEvents(hook(['WH1', 'UPDATE']), now + 2 * min);
    expect((await getDirectOrder(websiteOrderDocId('WH1')))?.status).toBe('cancelled');
    cloverOrders.push(webOrder('WH2', now));
    await handleCloverOrderEvents(hook(['WH2', 'CREATE']), now + 2 * min);
    await handleCloverOrderEvents(hook(['WH2', 'UPDATE'], ['WH2', 'DELETE']), now + 3 * min);
    expect((await getDirectOrder(websiteOrderDocId('WH2')))?.status).toBe('cancelled');
    expect(posts()).toEqual([]);
  });

  it('an order Clover is still building (no order type yet) is looked at again on its next update', async () => {
    const now = Date.now();
    const bare = { id: 'BARE1', createdTime: now, total: 0, lineItems: { elements: [] } };
    cloverOrders = [bare];
    expect((await handleCloverOrderEvents(hook(['BARE1', 'CREATE']), now)).imported).toBe(0);
    cloverOrders = [webOrder('BARE1', now)];
    expect((await handleCloverOrderEvents(hook(['BARE1', 'UPDATE']), now + 2000)).imported).toBe(1);
  });
});

describe('Food Hub never takes control of a Clover order', () => {
  it('the kitchen screen keeps only Seen / Ready / Done, locally; everything else is "do it in Clover"', async () => {
    const now = Date.now();
    await upsertCloverOnlineOrder(MID, webOrder('ACT1', now - min), { now });
    const id = websiteOrderDocId('ACT1');
    calls = [];
    expect((await runWebsiteOrderAction(id, 'ack', actor)).seenAt).toBeTruthy();
    const ready = await runWebsiteOrderAction(id, 'ready', actor);
    expect(ready.status).toBe('ready');
    expect(ready.events.at(-1)?.message).toMatch(/Food Hub screen only/);
    expect(calls).toEqual([]); // nothing sent to Clover

    for (const a of ['cancel', 'mark_paid', 'retry_clover', 'dispatch', 'update', 'print']) expect(cloverOnlineBlockedReason(ready, a)).toMatch(/Clover/);
    expect(cloverOnlineBlockedReason(ready, 'complete')).toBeNull();
    expect(cloverOnlineBlockedReason({ source: 'phone' }, 'cancel')).toBeNull();
    await expect(runDirectAction(id, 'cancel', actor)).rejects.toThrow(/do it in Clover/);
    await expect(runDirectAction(id, 'retry_clover', actor)).rejects.toThrow(/do it in Clover/);
    // Never re-sent to Clover, even if something asked.
    expect(await createDirectOrderInClover(ready)).toMatchObject({ ok: false, skipped: true });
    expect(calls).toEqual([]);
  });

  it('Clover wins: a refund in Clover cancels an order the kitchen already marked done', async () => {
    const now = Date.now();
    await upsertCloverOnlineOrder(MID, webOrder('WIN1', now - min), { now });
    const done = await runWebsiteOrderAction(websiteOrderDocId('WIN1'), 'complete', actor);
    expect(done.status).toBe('completed');
    const r = await applyCloverState(done, readCloverOrderState({ total: 2299, paymentState: 'REFUNDED' }));
    expect(r.order.status).toBe('cancelled');
    await expect(runWebsiteOrderAction(websiteOrderDocId('WIN1'), 'ready', actor)).rejects.toThrow(/cancelled in Clover/);
  });
});
