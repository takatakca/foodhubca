// Clover register sales → Takatak MEV (lib/foodhub/mev/clover-register.ts): which Clover orders count, how a register
// sale becomes foodhub.sale.v1 (lines, Clover's tax checked, tender, tip, table service), and the whole path through the
// outbox against the QCMEV stand-in and a fake Clover API: webhook, catch-up poll, refund, deletion, unknown kitchen.
// Memory repository, placeholder data only.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain ESM helper shared with the e2e harness (no type declarations)
import { createMockQcmev, mockQcmevFetch } from '../scripts/e2e/mock-qcmev.mjs';
import { saveLocation } from '../lib/foodhub/catalog';
import {
  cloverRegisterEnabled, getRegisterSale, handleCloverRegisterEvents, ingestRegisterOrder, isRegisterOrder, pollCloverRegister, registerFacts, registerSaleId,
} from '../lib/foodhub/mev/clover-register';
import { setSevOfRecord } from '../lib/foodhub/mev/config';
import { registerBaseKey } from '../lib/foodhub/mev/hooks';
import { registerTender, toMevSaleFromRegister } from '../lib/foodhub/mev/map';
import { jobsFor, settleMevKicks } from '../lib/foodhub/mev/outbox';
import type { RegisterSale } from '../lib/foodhub/mev/types';
import { getRepo } from '../lib/foodhub/repo';

const SECRET = crypto.randomBytes(32).toString('hex');
const QCMEV = 'http://qcmev.test';
const CLOVER = 'http://clover.test';
const MID = 'MIDREGISTER1';
const ACTOR = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let mock: any;
/** The fake Clover's orders, by id (null = deleted). */
let clover: Map<string, any>;

const NO_MAPS = { orderTypes: new Map<string, string>(), tenders: new Map<string, string>() };
const ctx = { tenantId: 'takatak', testMode: true, trigger: 'accept' as const };

/** A Clover register order: Poutine 11,50 $ + 2 × Boisson 2,75 $ = 17,00 $; TPS 0,85 + TVQ 1,70 = 19,55 $ paid in cash. */
function cloverOrder(id: string, p: { tender?: string; tip?: number; tax?: number; total?: number; paid?: boolean; type?: string; title?: string; discount?: boolean; refunds?: any[]; refundedLine?: boolean; state?: string } = {}) {
  const tax = p.tax ?? 255;
  const total = p.total ?? 1955;
  const paid = p.paid !== false;
  return {
    id, title: p.title ?? '', total, paymentState: p.state ?? (paid ? 'PAID' : 'OPEN'), createdTime: Date.now() - 60_000,
    ...(p.type ? { orderType: { id: 'OT1', label: p.type } } : {}),
    lineItems: { elements: [
      { id: `${id}-L1`, name: 'Poutine régulière', price: 1150, item: { id: 'ITEM-POUTINE' }, ...(p.refundedLine ? { refunded: true } : {}) },
      { id: `${id}-L2`, name: 'Boisson gazeuse', price: 275, unitQty: 2000, item: { id: 'ITEM-POP' } },
    ] },
    ...(p.discount ? { discounts: { elements: [{ id: 'D1', name: 'Rabais employé', amount: -200 }] } } : {}),
    payments: { elements: paid ? [{ id: `${id}-P1`, amount: total, taxAmount: tax, tipAmount: p.tip ?? 0, result: 'SUCCESS', createdTime: Date.now() - 30_000, tender: { label: p.tender ?? 'Cash' } }] : [] },
    refunds: { elements: p.refunds ?? [] },
  };
}

function facts(co: any): RegisterSale {
  return { ...registerFacts(co), id: registerSaleId(MID, co.id), merchantId: MID, locationCode: 'E2E_A', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function env() {
  process.env.FOODHUB_MEV = 'simulator';
  process.env.FOODHUB_FEATURE_MEV = 'on';
  process.env.FOODHUB_MEV_LOCATIONS = 'E2E_A,E2E_B';
  process.env.FOODHUB_MEV_URL = QCMEV;
  process.env.FOODHUB_MEV_SECRET = SECRET;
  process.env.FOODHUB_MEV_RETRY_S = '1,2';
  process.env.FOODHUB_MEV_CLOVER_REGISTER = 'on';
  process.env.CLOVER_BASE_URL = CLOVER;
  process.env.CLOVER_MERCHANT_TOKENS = JSON.stringify({ [MID]: 'tok-test' });
}

/** Clover REST answers from `clover` (orders), with one order type and the tenders. */
async function fakeClover(input: any): Promise<Response> {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  const path = url.pathname.replace(`/v3/merchants/${MID}/`, '');
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (path === 'order_types') return json(200, { elements: [{ id: 'OT1', label: 'Sur place' }, { id: 'OT2', label: 'Online Order Pick Up' }] });
  if (path === 'tenders') return json(200, { elements: [{ id: 'T1', label: 'Cash' }] });
  if (path === 'orders') return json(200, { elements: [...clover.values()].filter(Boolean) });
  const m = path.match(/^orders\/([^/]+)$/);
  if (m) {
    const co = clover.get(decodeURIComponent(m[1]));
    return co ? json(200, co) : json(404, { message: 'Not found' });
  }
  return json(404, {});
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_RETRY_TIMER = 'off';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__mevHealth = undefined;
  for (const k of ['FOODHUB_MEV', 'FOODHUB_FEATURE_MEV', 'FOODHUB_MEV_LOCATIONS', 'FOODHUB_MEV_URL', 'FOODHUB_MEV_SECRET', 'FOODHUB_MEV_CLOVER_REGISTER', 'FOODHUB_MEV_REGISTER_LOCATION',
    'FOODHUB_MEV_REGISTER_TABLE_TYPES', 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_ID', 'CLOVER_MERCHANT_TOKENS', 'CLOVER_BASE_URL', 'FOODHUB_MEV_CLOVER_NOTE']) delete process.env[k];
  mock = createMockQcmev({ secret: SECRET, tenant: 'takatak', locations: ['E2E_A', 'E2E_B'] });
  clover = new Map();
  globalThis.fetch = vi.fn(mockQcmevFetch(mock, QCMEV, fakeClover)) as any;
});
afterEach(async () => { await settleMevKicks(); globalThis.fetch = realFetch; });

const posts = () => mock.state.calls.filter((c: any) => c.method === 'POST');

describe('which Clover orders are register sales', () => {
  it('a plain register order is; Food Hub\'s own, a platform\'s and an online order are not', () => {
    expect(isRegisterOrder(cloverOrder('A'), NO_MAPS)).toBe(true);
    expect(isRegisterOrder(cloverOrder('B', { title: 'DoorDash #9F3K2' }), NO_MAPS)).toBe(false);
    expect(isRegisterOrder(cloverOrder('C', { title: '🌐 W-1043 · Po Poulet' }), NO_MAPS)).toBe(false);
    expect(isRegisterOrder(cloverOrder('D', { type: 'Online Order Pick Up' }), NO_MAPS)).toBe(false);
    expect(isRegisterOrder(cloverOrder('E', { title: '🌐 Site web · PPP-AB12C · Marie' }), NO_MAPS)).toBe(false);
    expect(isRegisterOrder(cloverOrder('F'), { ...NO_MAPS, known: new Set(['F']) })).toBe(false);
  });
});

describe('register sale → foodhub.sale.v1', () => {
  it('cash at the counter: the lines are the receipt, TPS / TVQ match what Clover charged', () => {
    const m = toMevSaleFromRegister(facts(cloverOrder('A')), ctx);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.sale.source).toMatchObject({ model: 'pos', channel: 'clover_pos', externalOrderId: 'A', posOrderId: 'A' });
    expect(m.sale.saleKey).toBe(`fh:takatak:pos:clover_pos:${registerSaleId(MID, 'A')}`);
    expect(m.sale.serviceType).toBe('CMP');
    expect(m.sale.lines.map((l) => [l.description, l.quantity, l.totalCents])).toEqual([['Poutine régulière', '1', 1150], ['Boisson gazeuse', '2', 550]]);
    expect(m.sale.amounts).toEqual({ subtotalCents: 1700, gstCents: 85, qstCents: 170, totalCents: 1955, tipCents: 0 });
    expect(m.sale.payment).toEqual({ mode: 'ARG', collectedBy: 'cash' });
    expect(m.sale.receipt).toEqual({ format: 'PAP', deliver: 'print' });
    expect(m.sale.ecommerce).toBe(false);
  });

  it('card with a tip: the tip is the pourb, never in the total', () => {
    const m = toMevSaleFromRegister(facts(cloverOrder('A', { tender: 'Credit Card', tip: 300 })), ctx);
    expect(m.ok && m.sale.amounts).toEqual({ subtotalCents: 1700, gstCents: 85, qstCents: 170, totalCents: 1955, tipCents: 300 });
    expect(m.ok && m.sale.payment).toEqual({ mode: 'CRE', collectedBy: 'clover_tender' });
  });

  it('a wrong tax rate in Clover (the stray « Sales Tax ») → held for a person, never sent with invented tax', () => {
    const m = toMevSaleFromRegister(facts(cloverOrder('A', { tax: 258, total: 1958 })), ctx);
    expect(m).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
    expect(!m.ok && m.detail).toMatch(/tax rates in Clover/);
  });

  it('a Clover discount becomes the restaurant\'s discount; the same gap with no discount waits for a person', () => {
    // 17,00 $ − 2,00 $ = 15,00 $ → TPS 0,75 + TVQ 1,50 = 17,25 $
    const withDiscount = toMevSaleFromRegister(facts(cloverOrder('A', { discount: true, tax: 225, total: 1725 })), ctx);
    expect(withDiscount.ok && withDiscount.sale.discountCents).toBe(200);
    expect(withDiscount.ok && withDiscount.sale.amounts).toEqual({ subtotalCents: 1500, gstCents: 75, qstCents: 150, totalCents: 1725, tipCents: 0 });
    expect(toMevSaleFromRegister(facts(cloverOrder('A', { tax: 225, total: 1725 })), ctx)).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
  });

  it('tenders: debit, gift card, several, an unknown one (Autre), and $0 (Aucun paiement)', () => {
    expect(registerTender(['Debit'], 100)).toBe('DEB');
    expect(registerTender(['Gift Card'], 100)).toBe('CPR');
    expect(registerTender(['Cash', 'Credit Card'], 100)).toBe('MIX');
    expect(registerTender(['House account'], 100)).toBe('AUT');
    expect(registerTender(['Cash', 'House account'], 100)).toBe('MIX');
    expect(registerTender([], 0)).toBe('AUC');
    expect(registerTender([], 100)).toBeNull();
  });

  it('table service by order type (default « table », or FOODHUB_MEV_REGISTER_TABLE_TYPES)', () => {
    const t = toMevSaleFromRegister(facts(cloverOrder('A', { type: 'Service aux tables' })), ctx);
    expect(t.ok && t.sale.serviceType).toBe('TBL');
    const pinned = toMevSaleFromRegister(facts(cloverOrder('A', { type: 'Salle' })), { ...ctx, tableTypes: /^(salle)$/i });
    expect(pinned.ok && pinned.sale.serviceType).toBe('TBL');
  });

  it('not paid yet = not a sale; refunded by an amount only = a person decides', () => {
    expect(toMevSaleFromRegister(facts(cloverOrder('A', { paid: false })), ctx)).toMatchObject({ ok: false, reason: 'not_final' });
    const partial = facts(cloverOrder('A', { state: 'PARTIALLY_REFUNDED', refunds: [{ amount: 500, taxAmount: 0 }] }));
    expect(partial.partlyRefundedByAmount).toBe(true);
    expect(toMevSaleFromRegister(partial, ctx)).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
  });
});

describe('register sales through QCMEV (outbox, stand-in QCMEV, fake Clover)', () => {
  beforeEach(async () => {
    env();
    await saveLocation({ code: 'E2E_A', name: 'Cuisine A (test)', address: '1 rue Exemple', active: true });
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'store-reg', brandName: 'Po Poulet', locationCode: 'E2E_A', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
    await setSevOfRecord('E2E_A', 'qcmev', ACTOR);
  });

  it('off unless FOODHUB_MEV_CLOVER_REGISTER=on: a webhook reads nothing', async () => {
    delete process.env.FOODHUB_MEV_CLOVER_REGISTER;
    expect(cloverRegisterEnabled()).toBe(false);
    clover.set('A', cloverOrder('A'));
    expect(await handleCloverRegisterEvents({ merchants: { [MID]: [{ objectId: 'O:A', type: 'CREATE' }] } })).toEqual({ events: 0, recorded: 0 });
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it('paid at the register → one invoice; the webhook again → nothing new; refunded → full credit note', async () => {
    clover.set('A', cloverOrder('A', { tender: 'Debit' }));
    const hook = { merchants: { [MID]: [{ objectId: 'O:A', type: 'UPDATE' }] } };
    expect((await handleCloverRegisterEvents(hook)).recorded).toBe(1);
    await settleMevKicks();
    expect(posts().map((c: any) => c.path)).toEqual(['/api/v1/integrations/foodhub/sales']);
    expect(posts()[0].body).toMatchObject({ source: { model: 'pos', channel: 'clover_pos' }, serviceType: 'CMP', payment: { mode: 'DEB' }, amounts: { totalCents: 1955 }, testMode: true });
    const id = registerSaleId(MID, 'A');
    expect((await getRegisterSale(id))?.mev).toMatchObject({ status: 'accepted', noTrans: '1' });

    await handleCloverRegisterEvents(hook);
    await settleMevKicks();
    expect(posts().length).toBe(1);

    clover.set('A', cloverOrder('A', { tender: 'Debit', state: 'REFUNDED', refunds: [{ amount: 1955, taxAmount: 255 }] }));
    await handleCloverRegisterEvents(hook);
    await settleMevKicks();
    expect(posts().map((c: any) => c.path)).toEqual(['/api/v1/integrations/foodhub/sales', `/api/v1/integrations/foodhub/sales/${encodeURIComponent(registerBaseKey({ id }, 'takatak'))}/credit-notes`]);
    expect((await getRegisterSale(id))?.mev?.status).toBe('credited');
  });

  it('an item refunded in Clover → credit note + corrected receipt that names the original', async () => {
    clover.set('A', cloverOrder('A'));
    await ingestRegisterOrder(MID, clover.get('A'));
    await settleMevKicks();
    // Poutine refunded (line refund): 2 × Boisson 5,50 $ → TPS 0,28 + TVQ 0,55 = 6,33 $ left.
    clover.set('A', cloverOrder('A', { refundedLine: true, state: 'PARTIALLY_REFUNDED', refunds: [{ amount: 1322, taxAmount: 172 }] }));
    await ingestRegisterOrder(MID, clover.get('A'));
    await settleMevKicks();
    const kinds = (await jobsFor(registerBaseKey({ id: registerSaleId(MID, 'A') }, 'takatak'))).map((j) => `${j.kind}:${j.status}`);
    expect(kinds).toEqual(['sale:done', 'credit:done', 'sale:done']);
    const corrected = posts().at(-1).body;
    expect(corrected.referenceSaleKey).toBe(registerBaseKey({ id: registerSaleId(MID, 'A') }, 'takatak'));
    expect(corrected.amounts).toEqual({ subtotalCents: 550, gstCents: 28, qstCents: 55, totalCents: 633, tipCents: 0 });
  });

  it('deleted in Clover after it was paid → credited; an open tab never paid → never a sale', async () => {
    clover.set('A', cloverOrder('A'));
    await ingestRegisterOrder(MID, clover.get('A'));
    await settleMevKicks();
    clover.delete('A');
    await handleCloverRegisterEvents({ merchants: { [MID]: [{ objectId: 'O:A', type: 'DELETE' }] } });
    await settleMevKicks();
    expect(posts().length).toBe(2);
    expect(posts()[1].path).toMatch(/credit-notes$/);

    clover.set('B', cloverOrder('B', { paid: false }));
    await handleCloverRegisterEvents({ merchants: { [MID]: [{ objectId: 'O:B', type: 'CREATE' }] } });
    await settleMevKicks();
    expect(posts().length).toBe(2);
    expect(await getRegisterSale(registerSaleId(MID, 'B'))).toBeNull();
  });

  it('a missed webhook: the catch-up poll finds the paid register sale once, and skips the others', async () => {
    clover.set('A', cloverOrder('A'));
    clover.set('W', cloverOrder('W', { type: 'Online Order Pick Up' }));
    clover.set('U', cloverOrder('U', { title: 'Uber Eats #AB12C' }));
    const r = await pollCloverRegister(MID);
    expect(r).toEqual({ recorded: 1 });
    await settleMevKicks();
    expect(posts().length).toBe(1);
    await pollCloverRegister(MID);
    await settleMevKicks();
    expect(posts().length).toBe(1);
  });

  it('a merchant used by two kitchens and no FOODHUB_MEV_REGISTER_LOCATION → nothing numbered on a guessed device; pinned → sent', async () => {
    await saveLocation({ code: 'E2E_B', name: 'Cuisine B (test)', address: '2 rue Exemple', active: true });
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'store-reg-b', brandName: 'Po Poulet', locationCode: 'E2E_B', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
    clover.set('A', cloverOrder('A'));
    expect(await ingestRegisterOrder(MID, clover.get('A'))).toBeNull();
    await settleMevKicks();
    expect(posts().length).toBe(0);
    process.env.FOODHUB_MEV_REGISTER_LOCATION = JSON.stringify({ [MID]: 'E2E_A' });
    expect((await ingestRegisterOrder(MID, clover.get('A')))?.locationCode).toBe('E2E_A');
    await settleMevKicks();
    expect(posts().length).toBe(1);
  });
});
