// Takatak MEV (QCMEV): Food Hub order → foodhub.sale.v1, one fixture per channel. Placeholder data only.
// Every sale is also checked against QCMEV's own contract rules (line = qty × unit, items + options + fees − discount =
// subtotal, total = subtotal + GST + QST, no negative amount), so a payload QCMEV would refuse fails here first.
import { describe, expect, it } from 'vitest';
import { hcoTaxCents } from '../lib/foodhub/pos/clover-checkout';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import type { StoredOrder } from '../lib/foodhub/types';
import { preTaxFromIncluded, quebecTaxCents, reconcileTax, roundHalfUpDiv } from '../lib/foodhub/mev/money';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { copyOf, printableDoc } from '../lib/foodhub/mev/printable';
import type { MevRecord } from '../lib/foodhub/mev/types';
import {
  canonicalJson, contentHashOf, creditFor, creditKeyFor, isoWithOffset, lineCents, payloadHashOf, printFor, printKeyFor, saleKeyFor, sha256, tenderMode, toMevSaleFromDirect, toMevSaleFromStored, type MapCtx,
} from '../lib/foodhub/mev/map';
import type { FoodHubSaleV1 } from '../lib/foodhub/mev/types';

const CTX: MapCtx = { tenantId: 'takatak', testMode: true, trigger: 'accept' };
const AT = '2026-10-24T16:00:00.000Z';

function stored(p: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: 'ord-1', channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'uber-e2e-1', displayId: 'A1B2C', channelStoreId: 'store-1', brandName: 'Po Poulet', locationCode: 'E2E_A',
    fulfillment: 'delivery', placedAt: AT, currency: 'CAD', subtotal: 33.98, tax: 5.09, deliveryFee: 2.99, tip: 3, discount: 0, total: 39.07, raw: {},
    lines: [{ externalId: 'clv-item-1', posItemRef: 'clv-item-1', name: 'Poulet Grillé', quantity: 2, unitPrice: 15.99, total: 33.98, modifiers: [{ name: 'Piri-piri', quantity: 1, unitPrice: 1 }] }],
    status: 'accepted', timeline: { acceptedAt: AT, acceptedBy: 'auto' }, createdAt: AT, updatedAt: AT, ...p,
  };
}

function direct(p: Partial<DirectOrder> = {}): DirectOrder {
  return {
    id: 'dir_e2e1', number: 'T-1042', source: 'phone', brandName: 'Po Poulet', locationCode: 'E2E_A', customer: { name: 'Client Test' }, fulfillment: 'pickup',
    lines: [{ name: 'Poulet Grillé', quantity: 1, unitPrice: 14.99, total: 14.99, modifiers: [] }, { name: 'Frites', quantity: 2, unitPrice: 4.99, total: 9.98, modifiers: [] }],
    subtotal: 24.97, tax: 3.74, deliveryFee: 0, tip: 2, total: 30.71, currency: 'CAD', payment: 'pay_at_pickup', status: 'completed', containsAlcohol: false,
    placedAt: AT, events: [{ at: AT, type: 'received', message: 'Phone' }, { at: '2026-10-24T16:20:00.000Z', type: 'picked_up', message: 'Picked up' }], createdAt: AT, updatedAt: AT, ...p,
  };
}

/** QCMEV's validateSale + mapSale subtotal rule (backend/src/integrations/foodhub/foodhub.contract.ts), re-stated. */
function qcmevAccepts(s: FoodHubSaleV1): string[] {
  const errs: string[] = [];
  const nonNeg = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const q = (x: string) => /^\d{1,6}(\.\d{1,3})?$/.test(x) && Number(x) > 0;
  if (!/^[A-Za-z0-9._:#-]{1,160}$/.test(s.saleKey) || !s.saleKey.startsWith(`fh:${s.tenantId}:`)) errs.push('saleKey');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.test(s.occurredAt)) errs.push('occurredAt');
  if (!s.lines.length) errs.push('lines');
  let items = 0;
  for (const l of s.lines) {
    if (!q(l.quantity) || !nonNeg(l.unitPriceCents) || !nonNeg(l.totalCents)) errs.push(`line ${l.description}`);
    else if (Math.abs(lineCents(l.unitPriceCents, Number(l.quantity)) - l.totalCents) > 1) errs.push(`line total ${l.description}`);
    items += l.totalCents;
    for (const m of l.modifiers) { if (!q(m.quantity) || !nonNeg(m.unitPriceCents) || !nonNeg(m.totalCents)) errs.push(`mod ${m.description}`); items += m.totalCents; }
  }
  const fees = (s.serviceType === 'LVR' ? s.fees.deliveryCents : 0) + s.fees.serviceFeeCents;
  if (!nonNeg(s.discountCents)) errs.push('discount');
  if (items + fees - s.discountCents !== s.amounts.subtotalCents) errs.push(`subtotal ${items + fees - s.discountCents} != ${s.amounts.subtotalCents}`);
  if (s.amounts.totalCents !== s.amounts.subtotalCents + s.amounts.gstCents + s.amounts.qstCents) errs.push('total');
  if (!nonNeg(s.amounts.gstCents) || !nonNeg(s.amounts.qstCents)) errs.push('tax');
  if (s.serviceType === 'LVT' && s.amounts.tipCents) errs.push('tip on LVT');
  if (!['ARG', 'CHQ', 'CRE', 'DEB', 'CPR', 'MIX', 'AUT', 'INC', 'AUC'].includes(s.payment.mode)) errs.push('payment');
  if (s.ecommerce && ['ARG', 'CHQ'].includes(s.payment.mode)) errs.push('ecommerce cash');
  if (s.payloadHash !== payloadHashOf(s as unknown as Record<string, unknown>)) errs.push('payloadHash');
  return errs;
}

function sale(r: ReturnType<typeof toMevSaleFromStored>): FoodHubSaleV1 {
  if (!r.ok) throw new Error(`not mapped: ${r.reason}`);
  return r.sale;
}

describe('money: each tax rounded half-up on its own', () => {
  it('rounds halves away from zero, with integers only', () => {
    expect(roundHalfUpDiv(5, 10)).toBe(1);
    expect(roundHalfUpDiv(4, 10)).toBe(0);
    expect(roundHalfUpDiv(-5, 10)).toBe(-1);
    expect(quebecTaxCents(1000)).toEqual({ gstCents: 50, qstCents: 100 }); // 99.75 → 100
    expect(quebecTaxCents(3398)).toEqual({ gstCents: 170, qstCents: 339 }); // 169.9 / 338.95 → 339
    expect(quebecTaxCents(-3398)).toEqual({ gstCents: -170, qstCents: -339 });
  });
  it('gives the same cents as Clover Hosted Checkout for every base up to 300 $', () => {
    const rates = [{ id: 'G', name: 'GST', rate: 500000 }, { id: 'Q', name: 'QST', rate: 997500 }];
    for (let b = 0; b <= 30_000; b += 7) {
      const t = quebecTaxCents(b);
      expect(t.gstCents + t.qstCents).toBe(hcoTaxCents(b, rates as never));
    }
  });
  it('keeps the computed split when the platform tax agrees, splits the platform tax otherwise (taxGap)', () => {
    expect(reconcileTax({ gstCents: 170, qstCents: 339 }, 509)).toEqual({ gstCents: 170, qstCents: 339, taxGap: false });
    expect(reconcileTax({ gstCents: 170, qstCents: 339 }, 510)).toEqual({ gstCents: 170, qstCents: 339, taxGap: false });
    const gap = reconcileTax({ gstCents: 170, qstCents: 339 }, 600);
    expect(gap.taxGap).toBe(true);
    expect(gap.gstCents + gap.qstCents).toBe(600);
  });
});

describe('civil date and time in America/Montreal', () => {
  it('an order at 23:30 local keeps its local date, with the right offset in summer and winter', () => {
    expect(isoWithOffset(Date.UTC(2026, 9, 25, 3, 30, 0))).toBe('2026-10-24T23:30:00-04:00');
    expect(isoWithOffset(Date.UTC(2026, 0, 16, 4, 30, 0))).toBe('2026-01-15T23:30:00-05:00');
  });
  it('a platform order uses its acceptance time', () => {
    const s = sale(toMevSaleFromStored(stored({ timeline: { acceptedAt: '2026-10-25T03:30:00.000Z', acceptedBy: 'auto' } }), CTX));
    expect(s.occurredAt).toBe('2026-10-24T23:30:00-04:00');
  });
});

describe('platform orders → LVT', () => {
  it('Uber delivery: no courier tip, no platform delivery fee, items + options add up, collected by the platform', () => {
    const s = sale(toMevSaleFromStored(stored(), CTX));
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s.serviceType).toBe('LVT');
    expect(s.saleKey).toBe('fh:takatak:stored:uber_eats:uber-e2e-1');
    expect(s.amounts.tipCents).toBe(0);
    expect(s.fees).toEqual({ deliveryCents: 0, serviceFeeCents: 0 });
    expect(s.lines[0]).toMatchObject({ quantity: '2', unitPriceCents: 1599, totalCents: 3198, taxCode: 'FP', activity: 'RES' });
    expect(s.lines[0].modifiers[0]).toMatchObject({ description: 'Piri-piri', quantity: '2', unitPriceCents: 100, totalCents: 200 });
    expect(s.amounts).toEqual({ subtotalCents: 3398, gstCents: 170, qstCents: 339, totalCents: 3907, tipCents: 0 });
    expect(s.payment).toEqual({ mode: 'AUT', collectedBy: 'platform' });
    expect(s.ecommerce).toBe(false);
    expect(s.testMode).toBe(true);
    expect(s.user.id).toBe('FOODHUB-AUTO');
    expect(JSON.stringify(s)).not.toMatch(/RT0001|TQ0001|codeAutoris|noTPS|noTVQ/);
  });
  it('DoorDash pickup with a restaurant promotion: only the merchant-funded part is the discount', () => {
    const s = sale(toMevSaleFromStored(stored({
      channel: 'doordash', marketplace: 'doordash', externalOrderId: 'dd-e2e-1', fulfillment: 'pickup', subtotal: 20, tax: 2.7, tip: 0, discount: 5, total: 22.7,
      lines: [{ name: 'Poulet', quantity: 1, unitPrice: 20, total: 20, modifiers: [] }], doorDash: { merchantFundedDiscount: 2, doordashFundedDiscount: 3 },
    }), CTX));
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s.discountCents).toBe(200);
    expect(s.amounts.subtotalCents).toBe(1800);
  });
  it('Skip handed to the tablet (tax 0 in the feed): the tax is computed from the base', () => {
    const s = sale(toMevSaleFromStored(stored({ channel: 'skip', marketplace: 'skip', externalOrderId: 'skip-failed-1', status: 'failed', tax: 0, subtotal: 24.97, total: 24.97, lines: [{ name: 'Poulet', quantity: 1, unitPrice: 14.99, total: 14.99, modifiers: [] }, { name: 'Frites', quantity: 2, unitPrice: 4.99, total: 9.98, modifiers: [] }] }), CTX));
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s.flags?.taxComputed).toBe(true);
    expect(s.amounts).toMatchObject({ subtotalCents: 2497, gstCents: 125, qstCents: 249, totalCents: 2871 });
  });
  it('lines that do not add up are never balanced with an invented line or « Rabais »: the sale waits for a person', () => {
    const more = toMevSaleFromStored(stored({ subtotal: 35, tax: 5.24 }), CTX);
    expect(more).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
    const less = toMevSaleFromStored(stored({ subtotal: 30, tax: 4.49 }), CTX);
    expect(less).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
    // A cent or two of platform rounding: the lines are the receipt (flagged), no extra line.
    const round = sale(toMevSaleFromStored(stored({ subtotal: 33.97 }), CTX));
    expect(qcmevAccepts(round)).toEqual([]);
    expect(round.flags?.subtotalRounded).toBe(true);
    expect(round.lines).toHaveLength(1);
    expect(round.discountCents).toBe(0);
    for (const s of [round]) expect(JSON.stringify(s)).not.toMatch(/ÉCART|PRICE DIFFERENCE|"COMMANDE"|"Article"|"Option"|divers/i);
  });
  it('no item, an unnamed item or a paid unnamed option → waits for a person; a free unnamed option is left out', () => {
    expect(toMevSaleFromStored(stored({ lines: [], subtotal: 0, tax: 0, total: 0 }), CTX)).toMatchObject({ ok: false, reason: 'no_lines' });
    expect(toMevSaleFromStored(stored({ lines: [{ name: ' ', quantity: 1, unitPrice: 33.98, total: 33.98, modifiers: [] }] }), CTX)).toMatchObject({ ok: false, reason: 'description_missing' });
    expect(toMevSaleFromStored(stored({ lines: [{ name: 'Poulet', quantity: 1, unitPrice: 32.98, total: 33.98, modifiers: [{ name: '', quantity: 1, unitPrice: 1 }] }] }), CTX)).toMatchObject({ ok: false, reason: 'description_missing' });
    const free = sale(toMevSaleFromStored(stored({ lines: [{ name: 'Poulet', quantity: 2, unitPrice: 16.99, total: 33.98, modifiers: [{ name: '', quantity: 1, unitPrice: 0 }] }] }), CTX));
    expect(free.lines[0].modifiers).toEqual([]);
    expect(qcmevAccepts(free)).toEqual([]);
  });
  it('Skip (JET Connect): item prices are before tax, as in JET\'s documented examples; tax-included lines are held, never a « Rabais »', () => {
    // JET's "Delivery by restaurant" example on Skip: Cheesy Pasta 500, items_in_cart { inc_tax 600, tax 100 }.
    const jet = parseSkipOrder({ id: 'jet-doc', posLocationId: 'R1', type: 'delivery-by-delivery-partner', items: [{ name: 'Cheesy Pasta', plu: 'P1', price: 500, quantity: 1 }], payment: { items_in_cart: { inc_tax: 600, tax: 100 }, final: { inc_tax: 600, tax: 100 } } })!;
    const ok = sale(toMevSaleFromStored(stored({ ...jet, channel: 'skip', marketplace: 'skip' } as Partial<StoredOrder>), CTX));
    expect(ok.amounts.subtotalCents).toBe(500);
    expect(ok.discountCents).toBe(0);
    // The old fixture (lines = the tax-included total 26.47, tax 3.45): would have printed a 3,45 $ « Rabais ».
    const incl = parseSkipOrder({ id: 'skip-incl', posLocationId: 'R1', type: 'delivery-by-delivery-partner', items: [{ name: 'Poulet Grillé', price: 1549, quantity: 1, children: [{ name: 'Piri-piri', price: 100 }] }, { name: 'Frites', price: 499, quantity: 2 }], payment: { items_in_cart: { inc_tax: 2647, tax: 345 }, final: { inc_tax: 2647, tax: 345 } } })!;
    expect(toMevSaleFromStored(stored({ ...incl, channel: 'skip', marketplace: 'skip' } as Partial<StoredOrder>), CTX)).toMatchObject({ ok: false, reason: 'amounts_mismatch' });
  });
  it('Too Good To Go (prices taxes included, no tax in the feed): pre-tax prices worked out, total = what the customer paid', () => {
    expect(preTaxFromIncluded(599)).toBe(521);
    for (let inc = 100; inc <= 5000; inc += 37) {
      const b = preTaxFromIncluded(inc);
      const t = quebecTaxCents(b);
      expect(Math.abs(b + t.gstCents + t.qstCents - inc)).toBeLessThanOrEqual(1);
    }
    const relay = sale(toMevSaleFromStored(stored({ channel: 'tgtg', marketplace: 'tgtg', viaHub: 'relay', externalOrderId: 'TGTG-77', fulfillment: 'pickup', tax: 0, subtotal: 11.98, total: 11.98, tip: 0, lines: [{ name: 'Panier surprise', quantity: 2, unitPrice: 5.99, total: 11.98, modifiers: [] }] }), CTX));
    expect(relay.source.channel).toBe('relay');
    expect(qcmevAccepts(relay)).toEqual([]);
    expect(relay.lines[0]).toMatchObject({ quantity: '2', unitPriceCents: 521, totalCents: 1042 });
    expect(relay.amounts).toEqual({ subtotalCents: 1042, gstCents: 52, qstCents: 104, totalCents: 1198, tipCents: 0 });
    expect(relay.flags?.taxIncluded).toBe(true);
    expect(relay.receipt.format).toBe('PAP');
  });
  it('the Too Good To Go daily bag count is never a sale (log_order): many customers, after the day, nobody to hand an invoice to', () => {
    const bagLog = { channel: 'tgtg' as const, marketplace: 'tgtg' as const, tax: 0, subtotal: 17.97, total: 17.97, tip: 0, deliveryFee: 0, fulfillment: 'pickup' as const, status: 'completed' as const, lines: [{ name: 'Surprise Bag', quantity: 3, unitPrice: 5.99, total: 17.97, modifiers: [] }] };
    expect(toMevSaleFromStored(stored({ ...bagLog, externalOrderId: 'tgtg-log-E2E_A-2026-10-24', raw: { source: 'daily_log' } }), CTX)).toEqual({ ok: false, reason: 'log_order' });
    // Recognised by its id alone too (an older log without raw.source).
    expect(toMevSaleFromStored(stored({ ...bagLog, externalOrderId: 'tgtg-log-E2E_A-2026-10-23', raw: {} }), CTX)).toEqual({ ok: false, reason: 'log_order' });
  });
  it('a Too Good To Go bag handed over at the counter (« Sac remis ») is its own LVT sale, printed for the customer (PAP)', () => {
    const one = sale(toMevSaleFromStored(stored({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: 'tgtg-pickup-E2E_A-x1', raw: { source: 'tgtg_pickup' }, status: 'completed', tax: 0, subtotal: 5.99, total: 5.99, tip: 0, deliveryFee: 0, fulfillment: 'pickup', lines: [{ name: 'Surprise Bag', quantity: 1, unitPrice: 5.99, total: 5.99, modifiers: [] }] }), CTX));
    expect(qcmevAccepts(one)).toEqual([]);
    expect(one).toMatchObject({ serviceType: 'LVT', receipt: { format: 'PAP', deliver: 'print' }, payment: { mode: 'AUT', collectedBy: 'platform' } });
    expect(one.amounts).toEqual({ subtotalCents: 521, gstCents: 26, qstCents: 52, totalCents: 599, tipCents: 0 });
  });
  it('a new order is not a sale yet; ready trigger waits for ready', () => {
    expect(toMevSaleFromStored(stored({ status: 'new' }), CTX)).toEqual({ ok: false, reason: 'not_final' });
    expect(toMevSaleFromStored(stored({ status: 'accepted' }), { ...CTX, trigger: 'ready' })).toEqual({ ok: false, reason: 'not_final' });
    expect(toMevSaleFromStored(stored({ status: 'ready', timeline: { readyAt: AT } }), { ...CTX, trigger: 'ready' }).ok).toBe(true);
    expect(toMevSaleFromStored(stored({ status: 'cancelled' }), CTX)).toEqual({ ok: false, reason: 'cancelled_before_sale' });
  });
  it('a $0 order is AUC', () => {
    const s = sale(toMevSaleFromStored(stored({ subtotal: 0, tax: 0, total: 0, lines: [{ name: 'Repas offert', quantity: 1, unitPrice: 0, total: 0, modifiers: [] }] }), CTX));
    expect(s.payment.mode).toBe('AUC');
    expect(s.amounts.totalCents).toBe(0);
    expect(qcmevAccepts(s)).toEqual([]);
  });
  it('the menu tax code applies per line (F = GST only)', () => {
    const s = sale(toMevSaleFromStored(stored({ subtotal: 10, tax: 0.5, lines: [{ posItemRef: 'eau', name: 'Eau', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }] }), { ...CTX, taxCodeOf: () => 'F' }));
    expect(s.lines[0].taxCode).toBe('F');
    expect(s.amounts).toMatchObject({ gstCents: 50, qstCents: 0 });
  });
});

describe('own orders', () => {
  it('phone pickup paid cash at the counter: CMP, ARG, the tip is the restaurant’s (pourb)', () => {
    const r = toMevSaleFromDirect(direct(), { ...CTX, tender: 'ARG' });
    const s = sale(r);
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s).toMatchObject({ serviceType: 'CMP', ecommerce: false, payment: { mode: 'ARG', collectedBy: 'cash' } });
    expect(s.amounts).toMatchObject({ subtotalCents: 2497, tipCents: 200 });
    expect(s.amounts.totalCents).toBe(2497 + s.amounts.gstCents + s.amounts.qstCents);
    expect(s.saleKey).toBe('fh:takatak:direct:phone:dir_e2e1');
    expect(s.occurredAt).toBe('2026-10-24T12:20:00-04:00');
  });
  it('a pay-at-pickup order whose tender is unknown waits (never INC)', () => {
    expect(toMevSaleFromDirect(direct(), CTX)).toEqual({ ok: false, reason: 'tender_unknown' });
  });
  it('website, own delivery paid online: LVR, e-commerce, card, the delivery fee is the restaurant’s', () => {
    const s = sale(toMevSaleFromDirect(direct({ source: 'website', sourceRef: 'web-77', fulfillment: 'delivery', deliveryFee: 4.99, tip: 0, tax: 4.49, payment: 'paid', status: 'in_kitchen', customer: { name: 'Client', phone: '+15140000000' } }), CTX));
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s).toMatchObject({ serviceType: 'LVR', ecommerce: true, payment: { mode: 'CRE' }, fees: { deliveryCents: 499 }, receipt: { format: 'PEL', deliver: 'sms' } });
    expect(s.amounts.subtotalCents).toBe(2497 + 499);
    expect(s.source.channel).toBe('website');
  });
  it('storefront orders are their own channel; paid online never shows cash', () => {
    const s = sale(toMevSaleFromDirect(direct({ source: 'website', sourceRef: 'sf_abc', payment: 'paid', status: 'in_kitchen' }), { ...CTX, tender: 'ARG' }));
    expect(s.source.channel).toBe('storefront');
    expect(s.payment.mode).toBe('CRE');
  });
  it('waits for the payment link; a cancelled order is not a sale', () => {
    expect(toMevSaleFromDirect(direct({ status: 'awaiting_payment', payment: 'unpaid' }), CTX)).toEqual({ ok: false, reason: 'awaiting_payment' });
    expect(toMevSaleFromDirect(direct({ status: 'cancelled' }), CTX)).toEqual({ ok: false, reason: 'cancelled_before_sale' });
    expect(toMevSaleFromDirect(direct({ status: 'in_kitchen' }), CTX)).toEqual({ ok: false, reason: 'not_final' });
  });
  it('Interac e-Transfer confirmed by a person: the fee is the restaurant’s service fee (taxed, in the total), AUT, e-commerce, never tender_unknown', () => {
    // 24.97 of food + 5.00 Interac fee = 29.97; GST 1.50 + QST 2.99 = 4.49; tip 2.00 → the customer sent 36.46.
    const interac = { reference: 'PP-7K3Q', amount: 36.46, recipient: 'paiements@example.test', autoDeposit: true, lang: 'fr' as const, createdAt: AT, expiresAt: AT, reminderMin: 20, receivedAt: '2026-10-24T16:05:00.000Z', receivedBy: 'Marc', releasedAt: '2026-10-24T16:05:01.000Z' };
    const o = direct({
      source: 'website', sourceRef: 'W-1001', payment: 'paid', status: 'in_kitchen', fees: [{ code: 'interac', name: 'Frais Interac e-Transfer', amount: 5 }], tax: 4.49, tip: 2, total: 36.46, interac,
      customer: { name: 'Client', phone: '+15140000000' }, events: [{ at: AT, type: 'received', message: 'Website' }, { at: '2026-10-24T16:05:00.000Z', type: 'paid', message: 'Interac e-Transfer PP-7K3Q received', by: 'Marc' }],
    });
    const s = sale(toMevSaleFromDirect(o, CTX)); // no tender given: an Interac order never waits for one
    expect(qcmevAccepts(s)).toEqual([]);
    expect(s).toMatchObject({ serviceType: 'CMP', ecommerce: true, fees: { deliveryCents: 0, serviceFeeCents: 500 }, payment: { mode: 'AUT', collectedBy: 'paylink', reference: 'PP-7K3Q' } });
    expect(s.amounts).toMatchObject({ subtotalCents: 2497 + 500, gstCents: 150, qstCents: 299, tipCents: 200 });
    expect(s.amounts.totalCents + s.amounts.tipCents).toBe(3646);
    expect(s.flags?.taxGap).toBeUndefined();
    expect(s.occurredAt).toBe('2026-10-24T12:05:00-04:00');
    // Switched to "pay at the counter" (fee taken off): the tender comes from the counter as for every pickup.
    const counter = direct({ source: 'website', sourceRef: 'W-1002', payment: 'pay_at_pickup', interac: { ...interac, receivedAt: undefined, receivedBy: undefined, releasedAt: undefined, cancelReason: 'pay at the counter' } });
    expect(toMevSaleFromDirect(counter, CTX)).toEqual({ ok: false, reason: 'tender_unknown' });
    expect(sale(toMevSaleFromDirect(counter, { ...CTX, tender: 'DEB' })).fees.serviceFeeCents).toBe(0);
  });
});

describe('keys, hashes, credit notes, prints', () => {
  it('keys keep only QCMEV-safe characters', () => {
    expect(saleKeyFor('takatak', 'stored', 'relay', 'TGTG 77/ä')).toBe('fh:takatak:stored:relay:TGTG-77-');
    expect(creditKeyFor('fh:takatak:stored:uber_eats:x', 1)).toBe('fh:takatak:stored:uber_eats:x:cn:1');
    expect(printKeyFor('fh:takatak:stored:uber_eats:x', 'DUP', 2)).toBe('fh:takatak:stored:uber_eats:x:pr:dup2');
  });
  it('canonical JSON sorts keys and drops undefined; the payload hash ignores itself', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [1, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[1,{"y":2,"z":1}]},"b":1}');
    const s = sale(toMevSaleFromStored(stored(), CTX));
    expect(s.payloadHash).toBe(sha256(canonicalJson({ ...s, payloadHash: undefined })));
  });
  it('the Clover id arriving later changes the payload, not the fiscal content', () => {
    const a = toMevSaleFromStored(stored(), CTX);
    const b = toMevSaleFromStored(stored({ posOrderId: 'CLV9' }), CTX);
    if (!a.ok || !b.ok) throw new Error('map');
    expect(a.sale.payloadHash).not.toBe(b.sale.payloadHash);
    expect(a.contentHash).toBe(b.contentHash);
    const c = toMevSaleFromStored(stored({ subtotal: 15.99, tax: 2.4, lines: [{ name: 'Poulet Grillé', quantity: 1, unitPrice: 15.99, total: 15.99, modifiers: [] }] }), CTX);
    if (!c.ok) throw new Error('map');
    expect(c.contentHash).not.toBe(a.contentHash);
    expect(contentHashOf(a.sale)).toBe(a.contentHash);
  });
  it('a full credit note carries the magnitudes and names its sale', () => {
    const s = sale(toMevSaleFromStored(stored(), CTX));
    const c = creditFor(s, creditKeyFor(s.saleKey, 1), 'cancelled', Date.parse(AT));
    expect(c).toMatchObject({ schema: 'foodhub.credit.v1', saleKey: s.saleKey, creditKey: `${s.saleKey}:cn:1`, full: true, reason: 'cancelled', amounts: { subtotalCents: 3398, totalCents: 3907 } });
    expect(c.payloadHash).toBe(payloadHashOf(c as unknown as Record<string, unknown>));
    const p = printFor(s, printKeyFor(s.saleKey, 'DUP', 1), 'DUP');
    expect(p).toMatchObject({ schema: 'foodhub.print.v1', mode: 'DUP', printKey: `${s.saleKey}:pr:dup1` });
  });
  it('Clover tender labels → payment modes (unknown → null)', () => {
    expect(tenderMode(['Cash'])).toBe('ARG');
    expect(tenderMode(['Débit Interac'])).toBe('DEB');
    expect(tenderMode(['Credit Card'])).toBe('CRE');
    expect(tenderMode(['Gift Card'])).toBe('CPR');
    expect(tenderMode(['Cash', 'Credit Card'])).toBe('MIX');
    expect(tenderMode(['Uber Eats'])).toBeNull();
    expect(tenderMode([])).toBeNull();
  });
});

describe('printed once (Revenu Québec, « Modes d\'impression »)', () => {
  const rec = (p: Partial<MevRecord> = {}): MevRecord => ({ status: 'accepted', saleKey: 'fh:takatak:stored:uber_eats:x', text80mm: ['a', '[CODE QR]', 'b'], format: 'PAP', updatedAt: AT, ...p });
  it('the original of an issued paper receipt; nothing for ELE / NON, pending or credited receipts', () => {
    expect(printableDoc(rec(), 'FAC')?.key).toBe('fh:takatak:stored:uber_eats:x');
    expect(printableDoc(rec({ format: 'ELE' }), 'FAC')).toBeNull();
    expect(printableDoc(rec({ format: 'NON' }), 'FAC')).toBeNull();
    expect(printableDoc(rec({ status: 'pending', text80mm: undefined }), 'FAC')).toBeNull();
    expect(printableDoc(rec({ status: 'credited' }), 'FAC')).toBeNull();
  });
  it('a copy is the newest issued RPR / DUP, with its own QR', () => {
    const r = rec({ prints: [{ printKey: 'k:pr:rpr1', mode: 'RPR', status: 'accepted', text80mm: ['x'], qrImage: 'data:image/png;base64,AAAA', at: AT }, { printKey: 'k:pr:rpr2', mode: 'RPR', status: 'pending', at: AT }] });
    expect(printableDoc(r, 'RPR')).toMatchObject({ key: 'k:pr:rpr1', qrImage: 'data:image/png;base64,AAAA' });
    expect(printableDoc(r, 'DUP')).toBeNull();
    expect(copyOf('RPR')).toBe('RPR');
    expect(copyOf('anything')).toBe('FAC');
  });
});
