// "Enter in Clover" from a platform screen (lib/foodhub/screen-entry.ts): the order a person types from an Uber Eats,
// DoorDash or Skip screen becomes a Clover order at the platform's prices, accepted and recorded as PAID with the
// platform tender at once, its ticket printed once — and the platform itself is never called.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOrderTypeCache } from '../lib/foodhub/pos/clover-order';
import { allowedActions, runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import {
  buildScreenEntryOrder, enterScreenOrder, menuForForm, normalizeOrderCode, screenEntryChannel, screenEntryOptions, type ScreenEntryInput,
} from '../lib/foodhub/screen-entry';
import type { PlatformScreen } from '../lib/foodhub/screens';
import type { MasterMenu } from '../lib/foodhub/types';

const MID = 'TESTMERCH0001';
const STAFF = { username: 'cook', name: 'Cook', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
type Call = { method: string; host: string; path: string; body: any };
let calls: Call[] = [];
let seq = 0;
let failAtomic = false;
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ method, host: url.hostname, path: url.pathname, body });
    const p = url.pathname;
    if (url.hostname !== 'api.clover.test') return json({}, 404);
    if (p.endsWith('/order_types')) return json({ elements: [{ id: 'OT-DD', label: 'DoorDash' }, { id: 'OT-UE', label: 'Uber Eats' }] });
    if (p.endsWith('/tenders')) return method === 'POST' ? json({ id: 'T-NEW', label: body?.label }) : json({ elements: [{ id: 'T-DD', label: 'DoorDash' }, { id: 'T-UE', label: 'Uber Eats' }, { id: 'T-CASH', label: 'Cash' }] });
    if (p.endsWith('/atomic_order/orders')) {
      if (failAtomic) return json({ message: 'down' }, 500);
      const total = (body.orderCart.lineItems as any[]).reduce((s, l) => s + l.price, 0);
      return json({ id: `CLV${++seq}`, total });
    }
    if (p.endsWith('/print_event')) return json({ id: `PE-${body?.orderRef?.id}`, state: 'CREATED' });
    if (/\/orders\/[^/]+\/payments$/.test(p)) return json({ id: `PAY-${++seq}` });
    if (/\/orders\/[^/]+$/.test(p)) return json({ id: p.split('/').pop(), total: 3610 });
    return json({}, 404);
  }) as any;
}

const ENV: Record<string, string> = {
  FOODHUB_FORCE_MEMORY: 'true', FOODHUB_RETRY_TIMER: 'off', FOODHUB_TIMEZONE: 'America/Toronto',
  CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clover-token',
};
const CLEAR = ['CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'FOODHUB_CLOVER_ORDER_TYPE_MODE', 'CLOVER_ORDER_TYPES', 'CLOVER_CLIENT_ID', 'FOODHUB_VIA_CLOVER',
  'FOODHUB_CLOVER_RECORD_PAYMENT', 'CLOVER_PRINT_DEVICE_ID', 'CLOVER_PRINT_DEVICES', 'FOODHUB_CLOVER_AUTOPRINT', 'FOODHUB_CLOVER_DELETE_CANCELLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of CLEAR) { saved[k] = process.env[k]; delete process.env[k]; }
  (globalThis as any).__foodhubMem = undefined;
  calls = []; seq = 0; failAtomic = false;
  _resetOrderTypeCache();
  mockClover();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const MENU: MasterMenu = {
  brandName: 'OOeuf',
  categories: [{ ref: 'c-break', name: 'Déjeuners', sortOrder: 1 }],
  items: [
    { ref: 'i-bene', name: 'Bénédictine', price: 10, categoryRef: 'c-break', available: true, modifierGroupRefs: ['g-extra'], posItemRef: 'CLV-ITEM-BENE' },
    { ref: 'i-toast', name: 'Rôties', price: 4, categoryRef: 'c-break', available: false, modifierGroupRefs: [] },
  ],
  modifierGroups: [{ ref: 'g-extra', name: 'Extras', min: 0, max: 3, modifiers: [{ ref: 'm-bacon', name: 'Bacon', price: 1, available: true }] }],
  channelMarkupPct: { doordash: 20 },
  updatedAt: '2026-11-05T00:00:00.000Z',
};

const SCREEN: PlatformScreen = {
  id: 's01', name: 'DoorDash 1', platform: 'doordash', locationCode: 'NDG_6284', viewUrl: 'https://screens.example.test/s01/', createdBy: 'Owner', createdAt: '2026-11-05T00:00:00.000Z',
};

async function setup(opts: { autoAccept?: boolean } = {}) {
  const repo = getRepo();
  await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-ooeuf', brandName: 'OOeuf', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: opts.autoAccept ?? false, online: true, meta: {} });
  await repo.saveMenu(MENU);
}

const INPUT: ScreenEntryInput = {
  orderCode: '#a1b2 c3', customerName: 'Marie', fulfillment: 'delivery', note: 'Sans ustensiles',
  lines: [
    { ref: 'i-bene', quantity: 2, note: 'Œufs bien cuits', modifiers: [{ ref: 'm-bacon', quantity: 1 }] },
    { name: 'Combo spécial DoorDash', unitPrice: 5, quantity: 1, modifiers: [] },
  ],
};

describe('building the order from what the screen shows', () => {
  it('platform prices (menu + DoorDash markup), options, a dish not in the menu, QC taxes, the ticket header', () => {
    const r = buildScreenEntryOrder(INPUT, { channel: 'doordash', store: { channelStoreId: 'dd-ooeuf', brandName: 'OOeuf' }, menu: MENU, province: 'QC', screen: SCREEN, enteredBy: 'Cook', now: Date.parse('2026-11-05T15:00:00Z') });
    if ('error' in r) throw new Error(r.error);
    const o = r.order;
    expect(o).toMatchObject({ channel: 'doordash', marketplace: 'doordash', externalOrderId: 'screen-A1B2C3', displayId: 'A1B2C3', viaHub: 'screen', customerName: 'Marie', channelStoreId: 'dd-ooeuf', brandName: 'OOeuf' });
    // 10 $ + 20 % = 12 $, bacon 1 $ + 20 % = 1.20 $, × 2 = 26.40 $; the combo 5 $ as typed.
    expect(o.lines[0]).toMatchObject({ externalId: 'i-bene', name: 'Bénédictine', quantity: 2, unitPrice: 12, total: 26.4, notes: 'Œufs bien cuits' });
    expect(o.lines[0].modifiers).toEqual([{ externalId: 'm-bacon', name: 'Bacon', quantity: 1, unitPrice: 1.2 }]);
    expect(o.lines[1]).toMatchObject({ name: 'Combo spécial DoorDash', unitPrice: 5, total: 5 });
    expect(o.lines[1].externalId).toBeUndefined();
    // GST 5 % = 1.57 $, QST 9.975 % = 3.13 $.
    expect(o).toMatchObject({ subtotal: 31.4, tax: 4.7, total: 36.1, tip: 0, deliveryFee: 0 });
    expect(o.notes).toBe('DOORDASH #A1B2C3 | MARIE | ENTRÉE À LA MAIN / ENTERED BY HAND | Sans ustensiles');
    expect(o.raw).toMatchObject({ source: 'screen_entry', screenId: 's01', enteredBy: 'Cook' });
  });

  it('refuses an unusable order number, a dish no longer on the menu and a line with neither dish nor price', () => {
    const ctx = { channel: 'doordash' as const, store: { channelStoreId: 'dd-ooeuf', brandName: 'OOeuf' }, menu: MENU, province: 'QC' as const, screen: SCREEN, enteredBy: 'Cook' };
    expect(buildScreenEntryOrder({ ...INPUT, orderCode: '#!' }, ctx)).toHaveProperty('error');
    expect(buildScreenEntryOrder({ ...INPUT, lines: [{ ref: 'gone', quantity: 1, modifiers: [] }] }, ctx)).toHaveProperty('error');
    expect(buildScreenEntryOrder({ ...INPUT, lines: [{ name: 'No price', quantity: 1, modifiers: [] }] }, ctx)).toHaveProperty('error');
    expect(buildScreenEntryOrder({ ...INPUT, lines: [{ ref: 'i-bene', quantity: 1, modifiers: [{ ref: 'gone', quantity: 1 }] }] }, ctx)).toHaveProperty('error');
  });

  it('order numbers and platforms', () => {
    expect(normalizeOrderCode(' #12ab-34 ')).toBe('12AB-34');
    expect(normalizeOrderCode('ab')).toBeNull();
    expect(screenEntryChannel('ubereats')).toBe('uber_eats');
    expect(screenEntryChannel('skip')).toBe('skip');
    expect(screenEntryChannel('other')).toBeNull();
  });

  it('the form shows the menu at the platform price, sold-out dishes included (the order is already placed)', () => {
    const m = menuForForm(MENU, 'doordash');
    expect(m).toHaveLength(1);
    expect(m[0].items.map((i) => [i.name, i.price, i.available])).toEqual([['Bénédictine', 12, true], ['Rôties', 4.8, false]]);
    expect(m[0].items[0].options).toEqual([{ group: 'Extras', ref: 'm-bacon', name: 'Bacon', price: 1.2 }]);
  });
});

describe('entered from the screen → Clover, paid, printed — the platform is never called', () => {
  it('creates the Clover order, accepts it, records the DoorDash payment at once and prints one ticket', async () => {
    await setup();
    const r = await enterScreenOrder(SCREEN, INPUT, STAFF);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ inClover: true, paid: true, printed: true });
    const order = (await getRepo().getOrder(r.order.id))!;
    expect(order).toMatchObject({ status: 'accepted', viaHub: 'screen', posOrderId: 'CLV1', brandName: 'OOeuf', locationCode: 'NDG_6284', total: 36.1 });

    const cart = sent('POST', /\/atomic_order\/orders$/)[0].body.orderCart;
    expect(cart.note).toContain('DOORDASH #A1B2C3');
    expect(cart.note).toContain('ENTERED BY HAND');
    expect(sent('POST', /\/print_event$/)).toHaveLength(1);
    const pay = sent('POST', /\/orders\/CLV1\/payments$/);
    expect(pay).toHaveLength(1);
    expect(pay[0].body).toMatchObject({ amount: 3610, taxAmount: 470, tender: { id: 'T-DD' }, result: 'SUCCESS' });
    // Only Clover was called: nothing went to DoorDash (or any other host).
    expect(calls.every((c) => c.host === 'api.clover.test')).toBe(true);

    const events = (await getRepo().listEvents(order.id)).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(['received', 'printed', 'accepted', 'pos_paid', 'screen_entry']));
  });

  it('the same platform order number twice never makes a second order, ticket or payment', async () => {
    await setup();
    expect((await enterScreenOrder(SCREEN, INPUT, STAFF)).ok).toBe(true);
    const again = await enterScreenOrder(SCREEN, { ...INPUT, orderCode: 'a1b2c3' }, STAFF);
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect(sent('POST', /\/print_event$/)).toHaveLength(1);
    expect(sent('POST', /\/payments$/)).toHaveLength(1);
  });

  it('Clover down: the order is kept in Food Hub, not accepted, not paid (the retry and "Send to Clover" take over)', async () => {
    await setup();
    failAtomic = true;
    const r = await enterScreenOrder(SCREEN, INPUT, STAFF);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ inClover: false, paid: false, printed: false });
    expect((await getRepo().getOrder(r.order.id))!.status).toBe('new');
    expect(sent('POST', /\/payments$/)).toHaveLength(0);
  });

  it('cancel stays in Food Hub and Clover (the staff cancels on the platform screen); nothing reaches the platform', async () => {
    await setup();
    const r = await enterScreenOrder(SCREEN, INPUT, STAFF);
    if (!r.ok) throw new Error(r.error);
    const order = (await getRepo().getOrder(r.order.id))!;
    expect(allowedActions(order)).toEqual(expect.arrayContaining(['ready', 'cancel', 'print']));
    expect(allowedActions(order)).not.toContain('report_missing');
    const before = calls.length;
    const c = await runOrderAction(order.id, 'cancel', { reasonCode: 'customer_request', actor: STAFF });
    expect(c.result.ok).toBe(true);
    expect(c.order?.status).toBe('cancelled');
    expect(calls.slice(before).every((x) => x.host === 'api.clover.test')).toBe(true);
    // Already paid in Clover: flagged for a refund in Clover, never silently left as a sale.
    expect((await getRepo().listEvents(order.id)).map((e) => e.type)).toContain('pos_paid_then_cancelled');
  });

  it('refuses a platform linked through Clover, a protected store and a screen of another platform', async () => {
    await setup();
    process.env.FOODHUB_VIA_CLOVER = 'doordash';
    expect(await enterScreenOrder(SCREEN, INPUT, STAFF)).toMatchObject({ ok: false, status: 409 });
    expect((await screenEntryOptions(SCREEN)).blocked).toMatch(/linked through Clover/);
    delete process.env.FOODHUB_VIA_CLOVER;

    expect(await enterScreenOrder(SCREEN, { ...INPUT, channelStoreId: '27982486' }, STAFF)).toMatchObject({ ok: false, status: 403 });
    expect(await enterScreenOrder({ ...SCREEN, platform: 'other' }, INPUT, STAFF)).toMatchObject({ ok: false, status: 400 });
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
  });

  it('the form lists only this kitchen\'s mapped stores (and only the screen\'s own stores when it has a list)', async () => {
    await setup();
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-elsewhere', brandName: 'Bolon', locationCode: 'SAINT_LEONARD', cloverMerchantId: MID, autoAccept: false, online: true, meta: {} });
    const o = await screenEntryOptions(SCREEN);
    expect(o.blocked).toBeNull();
    expect(o.stores.map((s) => s.channelStoreId)).toEqual(['dd-ooeuf']);
    expect(o.stores[0].menu[0].items[0]).toMatchObject({ name: 'Bénédictine', price: 12 });
    expect((await screenEntryOptions({ ...SCREEN, storeIds: ['dd-other'] })).blocked).toMatch(/No DoorDash store/);
  });
});
