// The whole order path against simulated Clover + Uber Eats: inventory-linked Clover order with modifications, the
// delivery / pickup order type, accept only after Clover confirms, automatic Clover retries (30 s / 2 min) without a
// second ticket, cancellations winning over retries, and the webhook inbox (saved before the answer, processed again
// after a crash or a failure, replayable).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInboxEntry, inboxSummary, receiveWebhook, replayInboxEntry, runInboxEntry, sweepInbox } from '../lib/foodhub/inbox';
import { _resetOrderTypeCache } from '../lib/foodhub/pos/clover-order';
import { applyExternalStatus, processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { runCloverRetries } from '../lib/foodhub/recovery';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu, NormalizedOrder } from '../lib/foodhub/types';

const MID = 'TESTMERCH0001';
const realFetch = globalThis.fetch;
type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let cloverMode: 'ok' | 'down' | 'timeout-created' = 'ok';
let cloverOrders: Array<{ id: string; title: string; total: number; createdTime: number }> = [];
let uberFetchFails = 0;
let seq = 0;

const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));

function mockPlatforms() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (url.hostname === 'auth.uber.test') return json({ access_token: 'uber-tok', expires_in: 2592000 });
    if (url.hostname === 'api.uber.test') {
      if (p.startsWith('/v2/eats/order/')) {
        if (uberFetchFails > 0) { uberFetchFails--; return json({ message: 'temporarily unavailable' }, 503); }
        return json(uberOrderDetails(p.split('/').pop()!));
      }
      return new Response(null, { status: 204 });
    }
    if (url.hostname === 'api.clover.test') {
      if (p.endsWith('/order_types')) return json({ elements: [{ id: 'OT-ONLINE-DELIV', label: 'Online Order Delivery' }, { id: 'OT-ONLINE-PICKUP', label: 'Online Order Pick Up' }, { id: 'OT-DELIV-HIDDEN', label: 'Delivery', hidden: true }] });
      if (p.endsWith('/atomic_order/orders')) {
        if (cloverMode === 'down') return json({ message: 'Service Unavailable' }, 503);
        const id = `CLV${++seq}`;
        const total = (body.orderCart.lineItems as any[]).reduce((s, l) => s + l.price + (l.modifications ?? []).reduce((m: number, x: any) => m + x.amount, 0), 0);
        cloverOrders.push({ id, title: body.orderCart.title, total, createdTime: Date.now() });
        if (cloverMode === 'timeout-created') throw new Error('The operation was aborted due to timeout');
        return json({ id, total });
      }
      if (/\/orders$/.test(p) && method === 'GET') return json({ elements: cloverOrders.map((o) => ({ id: o.id, title: o.title, total: o.total, createdTime: o.createdTime })) });
      if (p.endsWith('/print_event')) return json({ id: `PE-${body?.orderRef?.id}`, state: 'CREATED' });
      if (p.endsWith('/tenders')) return method === 'POST' ? json({ id: 'T-UBER', label: body?.label }) : json({ elements: [] });
      if (/\/orders\/[^/]+\/payments$/.test(p)) return json({ id: `PAY-${++seq}` });
      if (/\/orders\/[^/]+$/.test(p)) return json({ id: p.split('/').pop() });
    }
    return json({}, 404);
  }) as any;
}

function uberOrderDetails(id: string) {
  return {
    id, display_id: id.slice(-5).toUpperCase(), store: { id: 'ue-popoulet-ndg' }, eater: { first_name: 'Marie', phone: '+15145550123', phone_code: '12345' }, type: id.includes('pickup') ? 'PICK_UP' : 'DELIVERY_BY_UBER',
    cart: { items: [{ id: 'CLV-6MCX', external_data: 'CLV-6MCX', title: '6 MCX + Frites', quantity: 1, price: { base_unit_price: { amount: 1679 }, unit_price: { amount: 1679 }, total_price: { amount: 1739 } },
      selected_modifier_groups: [{ id: 'GRP-BOISSON', selected_items: [{ id: 'mod:MOD-7UP', external_data: 'MOD-7UP', title: '7UP', quantity: 1, price: { unit_price: { amount: 0 } } }] }, { id: 'GRP-SAUCE', selected_items: [{ id: 'mod:MOD-BBQ', title: 'Sauce BBQ', quantity: 1, price: { unit_price: { amount: 60 } } }] }] }] },
    payment: { charges: { sub_total: { amount: 1739 }, tax: { amount: 260 }, total: { amount: 1999 }, tip: { amount: 300 } } },
    placed_at: new Date().toISOString(),
  };
}

const menu: MasterMenu = {
  brandName: 'Po Poulet', posMerchantId: MID,
  categories: [{ ref: 'CAT', name: 'Poulet', sortOrder: 0 }],
  items: [{ ref: 'CLV-6MCX', posItemRef: 'CLV-6MCX', name: '6 MCX + Frites + Sauce + Pepsi', price: 13.99, categoryRef: 'CAT', available: true, modifierGroupRefs: ['GRP-BOISSON', 'GRP-SAUCE'] }],
  modifierGroups: [
    { ref: 'GRP-BOISSON', name: 'Boisson', min: 1, max: 1, modifiers: [{ ref: 'MOD-7UP', posModifierRef: 'MOD-7UP', name: '7UP', price: 0, available: true }] },
    { ref: 'GRP-SAUCE', name: 'Sauce', min: 0, max: 2, modifiers: [{ ref: 'MOD-BBQ', posModifierRef: 'MOD-BBQ', name: 'Sauce BBQ', price: 0.5, available: true }] },
  ],
  updatedAt: new Date().toISOString(),
};

const ENV: Record<string, string> = {
  FOODHUB_FORCE_MEMORY: 'true', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true', FOODHUB_RETRY_TIMER: 'off',
  CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clover-token',
  UBER_BASE_URL: 'https://api.uber.test', UBER_AUTH_URL: 'https://auth.uber.test/oauth/v2/token', UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-secret',
};
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of ['CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'FOODHUB_CLOVER_RETRY_S', 'FOODHUB_CLOVER_ORDER_TYPE_MODE', 'CLOVER_ORDER_TYPES', 'CLOVER_CLIENT_ID']) { saved[k] = process.env[k]; delete process.env[k]; }
  (globalThis as any).__foodhubMem = undefined;
  calls = []; cloverOrders = []; cloverMode = 'ok'; uberFetchFails = 0; seq = 0;
  _resetOrderTypeCache();
  mockPlatforms();
  await getRepo().saveMenu(menu);
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function uberOrder(id: string): Promise<NormalizedOrder> {
  const { parseUberOrder } = await import('../lib/foodhub/adapters/uber-eats');
  return parseUberOrder(uberOrderDetails(id))!;
}

describe('Uber order → Clover → accept', () => {
  it('creates the Clover order with the inventory item, its real modifications and the delivery order type — then accepts', async () => {
    const out = await processIncomingOrder(await uberOrder('uber-ord-1'));
    expect(out.order.status).toBe('accepted');
    const atomic = sent('POST', /\/atomic_order\/orders$/);
    expect(atomic).toHaveLength(1);
    const cart = atomic[0].body.orderCart;
    expect(cart.orderType).toEqual({ id: 'OT-ONLINE-DELIV' });
    expect(cart.lineItems).toEqual([{ name: '6 MCX + Frites', price: 1679, item: { id: 'CLV-6MCX' }, modifications: [{ modifier: { id: 'MOD-7UP' }, name: '7UP', amount: 0 }, { modifier: { id: 'MOD-BBQ' }, name: 'Sauce BBQ', amount: 60 }] }]);
    expect(cart.note).toMatch(/LIVRAISON \/ DELIVERY \| Client: Marie \| Tél: \+15145550123 code 12345/);
    // Order of events: Clover first, the kitchen ticket, then the platform accept carrying the Clover id.
    const order = calls.findIndex((c) => /atomic_order/.test(c.path));
    const print = calls.findIndex((c) => /print_event/.test(c.path));
    const accept = calls.findIndex((c) => /accept_pos_order$/.test(c.path));
    expect(order).toBeLessThan(print);
    expect(print).toBeLessThan(accept);
    expect(calls[accept].body.external_reference_id).toBe(out.order.posOrderId);
    expect((await getRepo().listEvents(out.order.id)).map((e) => e.type)).toEqual(expect.arrayContaining(['received', 'pos_injected', 'printed', 'accepted']));
  });

  it('pickup uses "Online Order Pick Up"; the pickup tip goes on the Clover payment when it leaves the kitchen', async () => {
    const out = await processIncomingOrder(await uberOrder('uber-pickup-2'));
    expect(sent('POST', /\/atomic_order\/orders$/)[0].body.orderCart.orderType).toEqual({ id: 'OT-ONLINE-PICKUP' });
    await runOrderAction(out.order.id, 'ready');
    await runOrderAction(out.order.id, 'complete');
    const pay = sent('POST', /\/orders\/[^/]+\/payments$/)[0]?.body;
    expect(pay).toMatchObject({ amount: 1999, taxAmount: 260, tipAmount: 300 });
  });

  it('a line Clover does not know reaches Clover as free text, with a warning on the order', async () => {
    const n = await uberOrder('uber-ord-3');
    n.lines.push({ externalId: 'not-in-menu', name: 'Chef special', quantity: 1, unitPrice: 4, total: 4, modifiers: [] });
    const out = await processIncomingOrder(n);
    expect(out.order.status).toBe('accepted');
    expect(out.order.mappingWarnings).toEqual([{ line: 1, kind: 'item', name: 'Chef special', reason: 'no_match' }]);
    expect(sent('POST', /\/atomic_order\/orders$/)[0].body.orderCart.lineItems[1]).toMatchObject({ name: 'Chef special', price: 400 });
    expect((await getRepo().listEvents(out.order.id)).find((e) => e.type === 'mapping_warning')?.detail.message).toMatch(/Chef special/);
  });
});

describe('automatic Clover retries (30 s, then 2 min) before waking a manager', () => {
  it('Clover down → never accepted; Clover back on the retry → in Clover, printed, accepted once', async () => {
    cloverMode = 'down';
    const out = await processIncomingOrder(await uberOrder('uber-retry-1'));
    expect(out.order.status).toBe('new');
    expect(out.order.timeline?.posRetry).toMatchObject({ attempts: 0 });
    expect(sent('POST', /accept_pos_order$/)).toHaveLength(0);
    // Not due yet.
    expect((await runCloverRetries({ now: Date.now() + 5_000 })).due).toBe(0);
    cloverMode = 'ok';
    const r = await runCloverRetries({ now: Date.now() + 31_000 });
    expect(r).toMatchObject({ due: 1, recovered: 1 });
    const o = (await getRepo().getOrder(out.order.id))!;
    expect(o.posOrderId).toBe('CLV1');
    expect(o.status).toBe('accepted');
    expect(o.posError).toBeUndefined();
    expect(sent('POST', /accept_pos_order$/)).toHaveLength(1);
    expect(sent('POST', /print_event$/)).toHaveLength(1);
    // Done: a later run does nothing.
    expect((await runCloverRetries({ now: Date.now() + 200_000 })).due).toBe(0);
  });

  it('the lost answer: Clover created it but the answer timed out → the retry links that order, no second ticket', async () => {
    cloverMode = 'timeout-created';
    const out = await processIncomingOrder(await uberOrder('uber-retry-2'));
    expect(out.order.status).toBe('new');
    expect(cloverOrders).toHaveLength(1);
    cloverMode = 'ok';
    await runCloverRetries({ now: Date.now() + 31_000 });
    const o = (await getRepo().getOrder(out.order.id))!;
    expect(o.posOrderId).toBe(cloverOrders[0].id);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect(o.status).toBe('accepted');
    expect((await getRepo().listEvents(o.id)).some((e) => e.type === 'pos_adopted')).toBe(true);
  });

  it('still down after 30 s and 2 min → gives up and the Watchtower incident turns critical', async () => {
    cloverMode = 'down';
    const out = await processIncomingOrder(await uberOrder('uber-retry-3'));
    const t0 = Date.now();
    expect((await runCloverRetries({ now: t0 + 31_000 })).failed).toBe(1);
    expect((await getRepo().getOrder(out.order.id))!.timeline?.posRetry).toMatchObject({ attempts: 1 });
    expect((await runCloverRetries({ now: t0 + 31_000 + 121_000 })).gaveUp).toBe(1);
    const o = (await getRepo().getOrder(out.order.id))!;
    expect(o.timeline?.posRetry?.gaveUpAt).toBeTruthy();
    expect(o.status).toBe('new');
    expect(sent('POST', /accept_pos_order$/)).toHaveLength(0);
    expect((await runCloverRetries({ now: t0 + 900_000 })).due).toBe(0);
  });

  it('a cancellation that arrives while Clover is being retried wins: nothing is sent to Clover again', async () => {
    cloverMode = 'down';
    const out = await processIncomingOrder(await uberOrder('uber-retry-4'));
    await applyExternalStatus('uber_eats', 'uber-retry-4', 'cancelled', { event: 'orders.cancel' });
    cloverMode = 'ok';
    expect((await runCloverRetries({ now: Date.now() + 31_000 })).recovered).toBe(0);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect((await getRepo().getOrder(out.order.id))!.status).toBe('cancelled');
  });
});

describe('webhook inbox — saved before the answer, never lost', () => {
  const uberEvent = (id: string) => ({ event_type: 'orders.notification', meta: { resource_id: id, user_id: 'ue-popoulet-ndg' }, resource_href: `https://api.uber.test/v2/eats/order/${id}` });

  it('a saved webhook the server never got to process (stopped right after answering) is processed by the sweep', async () => {
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: uberEvent('uber-inbox-1'), reference: 'uber-inbox-1' });
    expect((await inboxSummary()).received).toBe(1);
    expect((await sweepInbox({ now: Date.now() + 10_000 })).processed).toBe(0); // still young: maybe being processed
    expect((await sweepInbox({ now: Date.now() + 130_000 })).processed).toBe(1);
    expect((await getInboxEntry(e.id))?.status).toBe('done');
    expect((await getRepo().findOrder('uber_eats', 'uber-inbox-1'))?.status).toBe('accepted');
  });

  it('Uber refuses the order fetch → failed, retried by itself after 30 s → order arrives', async () => {
    uberFetchFails = 2;
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: uberEvent('uber-inbox-2'), reference: 'uber-inbox-2' });
    const failed = await runInboxEntry(e.id);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(failed?.lastError).toMatch(/HTTP 503/);
    expect(failed?.nextAt).toBeTruthy();
    expect(await getRepo().findOrder('uber_eats', 'uber-inbox-2')).toBeNull();
    expect((await sweepInbox({ now: Date.now() + 31_000 })).processed).toBe(1);
    expect((await getRepo().findOrder('uber_eats', 'uber-inbox-2'))?.posOrderId).toBe('CLV1');
  });

  it('after the automatic tries it waits for a person; Replay processes it, and a second Replay never duplicates the order', async () => {
    uberFetchFails = 99;
    const e = await receiveWebhook({ channel: 'uber_eats', kind: 'uber', body: uberEvent('uber-inbox-3'), reference: 'uber-inbox-3' });
    await runInboxEntry(e.id);
    await runInboxEntry(e.id);
    const third = await runInboxEntry(e.id);
    expect(third).toMatchObject({ status: 'failed', attempts: 3, nextAt: null });
    expect((await inboxSummary()).failed).toBe(1);
    uberFetchFails = 0;
    const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
    expect((await replayInboxEntry(e.id, actor))?.status).toBe('done');
    expect((await replayInboxEntry(e.id, actor))?.result).toMatch(/duplicate/);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect((await getRepo().listActivity({})).some((a) => a.action === 'webhook_replayed')).toBe(true);
  });
});
