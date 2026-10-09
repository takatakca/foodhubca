// Platform order → Clover order: lines and options linked to the Clover inventory (id, then name, else free text with
// a warning), real Clover modifications, order types (delivery / pickup), kitchen note, tips and the total check.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCloverOrderCart, cloverOrderNote, cloverPrintDeviceForLocation, cloverTipCents, cloverTotalGap, describeMappingWarnings, FREE_TEXT_NOTE, mapOrderLines, normName, pickFulfillmentType } from '../lib/foodhub/pos/clover-order';
import type { MasterMenu, OrderLine, StoredOrder } from '../lib/foodhub/types';

const menu: MasterMenu = {
  brandName: 'Po Poulet',
  posMerchantId: 'TESTMERCH0001',
  categories: [{ ref: 'CAT-POULET', name: 'Poulet', sortOrder: 0 }],
  items: [
    { ref: 'CLV-6MCX', posItemRef: 'CLV-6MCX', name: '6 MCX + Frites + Sauce + Pepsi (CROQ. OU AIL)', nameFr: undefined, price: 13.99, categoryRef: 'CAT-POULET', available: true, modifierGroupRefs: ['GRP-BOISSON', 'GRP-SAUCE'] },
    { ref: 'CLV-CHOU', posItemRef: 'CLV-CHOU', name: 'SALADE DE CHOU', nameFr: 'Salade de chou', price: 2.71, categoryRef: 'CAT-POULET', available: true, modifierGroupRefs: [] },
    { ref: 'poutine-moyenne', posItemRef: 'CLV-POUTINE', name: 'Poutine Moyenne', price: 9.99, categoryRef: 'CAT-POULET', available: true, modifierGroupRefs: [] },
    { ref: 'fh-only', name: 'Combo Food Hub', price: 20, categoryRef: 'CAT-POULET', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'GRP-BOISSON', name: '(Ac-6) Boisson', min: 1, max: 1, modifiers: [{ ref: 'MOD-PEPSI', posModifierRef: 'MOD-PEPSI', name: 'Pepsi', price: 0, available: true }, { ref: 'MOD-7UP', posModifierRef: 'MOD-7UP', name: '7UP', price: 0, available: true }] },
    { ref: 'GRP-SAUCE', name: 'Sauce incluse', min: 0, max: 2, modifiers: [{ ref: 'MOD-BBQ', posModifierRef: 'MOD-BBQ', name: 'Sauce BBQ', price: 0.5, available: true }, { ref: 'MOD-HOUSE', name: 'Sauce maison (Food Hub)', price: 1, available: true }] },
  ],
  updatedAt: new Date().toISOString(),
};

const line = (over: Partial<OrderLine>): OrderLine => ({ name: 'x', quantity: 1, unitPrice: 1, total: 1, modifiers: [], ...over });

function order(over: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: 'o1', status: 'new', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'uber-abc-123', displayId: 'A1B2C', channelStoreId: 'ue-1',
    customerName: 'Marie', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD',
    subtotal: 0, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 0, lines: [], raw: {}, ...over,
  };
}

describe('names', () => {
  it('ignores accents, case, punctuation and plural s/x', () => {
    expect(normName('Poutine  Moyenne!')).toBe(normName('poutines moyenne'));
    expect(normName('Salade de CHOUX')).toBe(normName('salade de chou'));
    expect(normName('Gâteau Oréo')).toBe('gateau oreo');
    expect(normName('Bœuf & frites')).toBe('boeuf et frite');
  });
});

describe('linking order lines to the Clover inventory', () => {
  it('by id (the ref Food Hub published, or the Clover id itself), with the options by id and by name', () => {
    const r = mapOrderLines([
      line({ externalId: 'CLV-6MCX', name: '6 MCX', modifiers: [{ externalId: 'mod:MOD-PEPSI', name: 'Pepsi', quantity: 1, unitPrice: 0 }, { name: 'SAUCE bbq', quantity: 2, unitPrice: 0.6 }] }),
      line({ externalId: 'CLV-POUTINE', name: 'Poutine' }),
    ], menu);
    expect(r.lines[0]).toMatchObject({ posItemRef: 'CLV-6MCX', mapping: 'id' });
    expect(r.lines[0].modifiers.map((m) => m.posModifierRef)).toEqual(['MOD-PEPSI', 'MOD-BBQ']);
    expect(r.lines[1]).toMatchObject({ posItemRef: 'CLV-POUTINE', mapping: 'id' });
    expect(r.warnings).toEqual([]);
    expect(r.stats).toMatchObject({ itemsById: 2, modifiers: 2, modifiersLinked: 2 });
  });

  it('by name when the platform sends no usable id — accents, plural, and the bilingual "FR / EN" title', () => {
    const r = mapOrderLines([
      line({ externalId: 'uber-random-uuid', name: 'Salade de choux' }),
      line({ name: 'Poutine moyennes' }),
      line({ name: 'Salade de chou / Coleslaw' }),
    ], menu);
    expect(r.lines.map((l) => [l.posItemRef, l.mapping])).toEqual([['CLV-CHOU', 'name'], ['CLV-POUTINE', 'name'], ['CLV-CHOU', 'name']]);
  });

  it('nothing matches → free-text line with a warning; an item Clover does not know → free text too; a line is never dropped', () => {
    const r = mapOrderLines([line({ name: 'Mystery special', modifiers: [{ name: 'Extra sauce', quantity: 1, unitPrice: 1 }] }), line({ externalId: 'fh-only', name: 'Combo Food Hub' })], menu);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.every((l) => l.mapping === 'free' && !l.posItemRef)).toBe(true);
    expect(r.warnings).toEqual([
      { line: 0, kind: 'item', name: 'Mystery special', reason: 'no_match' },
      { line: 1, kind: 'item', name: 'Combo Food Hub', reason: 'no_clover_link' },
    ]);
    expect(describeMappingWarnings(r.warnings)[0].en).toMatch(/not found in the menu — sent as free text/);
    expect(describeMappingWarnings(r.warnings)[1].fr).toMatch(/n’est pas relié à Clover/);
  });

  it('an option Clover does not know is flagged, the item stays linked', () => {
    const r = mapOrderLines([line({ externalId: 'CLV-6MCX', name: '6 MCX', modifiers: [{ name: 'Sauce maison (Food Hub)', quantity: 1, unitPrice: 1 }, { name: 'Ketchup', quantity: 1, unitPrice: 0 }] })], menu);
    expect(r.lines[0].posItemRef).toBe('CLV-6MCX');
    expect(r.warnings.map((w) => [w.kind, w.name, w.reason])).toEqual([['modifier', 'Sauce maison (Food Hub)', 'no_clover_link'], ['modifier', 'Ketchup', 'no_match']]);
  });

  it('a menu imported from another Clover merchant → everything as free text (foreign ids would be refused), one warning', () => {
    const r = mapOrderLines([line({ externalId: 'CLV-6MCX', name: '6 MCX' }), line({ name: 'Poutine Moyenne' })], menu, { foreign: true });
    expect(r.lines.every((l) => !l.posItemRef)).toBe(true);
    expect(r.warnings).toEqual([{ line: -1, kind: 'item', name: '*', reason: 'foreign_menu' }]);
  });

  it('orders already carrying Clover ids (read back from Clover) are kept as they are', () => {
    const r = mapOrderLines([line({ posItemRef: 'X1', name: 'Anything', modifiers: [{ posModifierRef: 'M1', name: 'm', quantity: 1, unitPrice: 0 }] })], null);
    expect(r.lines[0]).toMatchObject({ posItemRef: 'X1', mapping: 'id' });
  });
});

describe('the Clover order body', () => {
  it('inventory items with real modifications (amounts = platform prices), one line per unit; unknown options folded into the price', () => {
    const lines = mapOrderLines([
      line({ externalId: 'CLV-6MCX', name: '6 MCX + Frites', quantity: 2, unitPrice: 16.79, total: 34.78, modifiers: [{ externalId: 'MOD-7UP', name: '7UP', quantity: 1, unitPrice: 0 }, { externalId: 'MOD-BBQ', name: 'Sauce BBQ', quantity: 2, unitPrice: 0.6 }, { name: 'Ketchup', quantity: 1, unitPrice: 0 }] }),
      line({ name: 'Mystery special', unitPrice: 5, total: 5.5, modifiers: [{ name: 'Extra', quantity: 1, unitPrice: 0.5 }], notes: 'sans oignon' }),
    ], menu).lines;
    // Platform subtotal: 2 × (16.79 + 2 × 0.60) + (5.00 + 0.50) = 41.48
    const cart = buildCloverOrderCart(order({ lines, subtotal: 41.48 }), { orderTypeId: 'OT-ONLINE-DELIV' });
    const items = cart.body.orderCart.lineItems as any[];
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      name: '6 MCX + Frites', price: 1679, item: { id: 'CLV-6MCX' },
      modifications: [{ modifier: { id: 'MOD-7UP' }, name: '7UP', amount: 0 }, { modifier: { id: 'MOD-BBQ' }, name: 'Sauce BBQ', amount: 60 }, { modifier: { id: 'MOD-BBQ' }, name: 'Sauce BBQ', amount: 60 }],
      note: 'Ketchup',
    });
    expect(items[1]).toEqual(items[0]);
    expect(items[2]).toEqual({ name: 'Mystery special', price: 550, note: `Extra, Note: sans oignon, ${FREE_TEXT_NOTE}` });
    // Clover's pre-tax total (line prices + modification amounts) = what the platform charged for the food.
    const sum = items.reduce((s, l) => s + l.price + (l.modifications ?? []).reduce((m: number, x: { amount: number }) => m + x.amount, 0), 0);
    expect(sum).toBe(4148);
    expect(cart.linesCents).toBe(4148);
    expect(cart.freeLines).toBe(1);
    expect(cart.body.orderCart.orderType).toEqual({ id: 'OT-ONLINE-DELIV' });
    expect(cart.body.orderCart.title).toBe('Uber Eats #A1B2C');
    expect(String(cart.body.orderCart.note)).toMatch(/⚠ 1 article\(s\) hors inventaire Clover/);
  });

  it('the kitchen note: delivery or pickup, customer, platform phone with its code, courier, the customer’s words', () => {
    const note = cloverOrderNote(order({ fulfillment: 'pickup', notes: 'ALLERGIE arachides', raw: { eater: { phone: '+15145550123', phone_code: '123 45' } }, timeline: { courier: { status: 'assigned', name: 'Sam', updatedAt: '', source: 'uber' } } }));
    expect(note).toBe('CUEILLETTE / PICKUP | Client: Marie | Tél: +15145550123 code 12345 | Livreur/Courier: Sam | ALLERGIE arachides');
    expect(cloverOrderNote(order({ notes: 'x'.repeat(400) })).length).toBe(255);
  });
});

describe('order types, tips and totals', () => {
  const rows = [
    { id: 'OT-ONLINE-DELIV', label: 'Online Order Delivery' }, { id: 'OT-ONLINE-PICKUP', label: 'Online Order Pick Up' },
    { id: 'OT-DINE-IN', label: 'Dine In' }, { id: 'OT-DELIV-HIDDEN', label: 'Delivery', hidden: true }, { id: 'OT-PICKUP-HIDDEN', label: 'In-store Pickup', hidden: true },
  ];
  it('uses the merchant’s own "Online Order Delivery" / "Online Order Pick Up" types', () => {
    expect(pickFulfillmentType(rows, 'delivery')).toBe('OT-ONLINE-DELIV');
    expect(pickFulfillmentType(rows, 'pickup')).toBe('OT-ONLINE-PICKUP');
    expect(pickFulfillmentType([{ id: 'D', label: 'Delivery', hidden: true }, { id: 'L', label: 'Livraison' }], 'delivery')).toBe('L');
    expect(pickFulfillmentType([{ id: 'X', label: 'Dine In' }], 'delivery')).toBeNull();
  });

  afterEach(() => { delete process.env.FOODHUB_CLOVER_RECORD_TIPS; });
  it('a delivery tip is the courier’s (never on the Clover payment); pickup and own-delivery tips are the restaurant’s', () => {
    expect(cloverTipCents({ tip: 3, fulfillment: 'delivery', raw: { type: 'DELIVERY_BY_UBER' } })).toBe(0);
    expect(cloverTipCents({ tip: 3, fulfillment: 'pickup', raw: {} })).toBe(300);
    expect(cloverTipCents({ tip: 2.5, fulfillment: 'delivery', raw: { type: 'DELIVERY_BY_RESTAURANT' } })).toBe(250);
    process.env.FOODHUB_CLOVER_RECORD_TIPS = 'off';
    expect(cloverTipCents({ tip: 3, fulfillment: 'pickup', raw: {} })).toBe(0);
  });

  it('flags a Clover total that differs from the platform (e.g. the stray 0.14975 % "Sales Tax"), within a cent per line', () => {
    const o = order({ subtotal: 40, tax: 5.99, discount: 0 });
    expect(cloverTotalGap(o, 4599, 3)).toEqual({ gapCents: 0, flagged: false });
    expect(cloverTotalGap(o, 4601, 3).flagged).toBe(false);
    expect(cloverTotalGap(o, 4605, 3)).toEqual({ gapCents: 6, flagged: true });
  });
});

describe('kitchen printer per location', () => {
  afterEach(() => { delete process.env.CLOVER_PRINT_DEVICES; });
  it('one Clover for several kitchens: the location’s printer when set, otherwise the merchant default (null here)', () => {
    process.env.CLOVER_PRINT_DEVICES = JSON.stringify({ 'TESTMERCH0001|NDG_6284': 'DUO-NDG', 'TESTMERCH0001|HOCHELAGA': 'FLEX-HOCH', TESTMERCH0001: 'DEFAULT' });
    expect(cloverPrintDeviceForLocation('TESTMERCH0001', 'NDG_6284')).toBe('DUO-NDG');
    expect(cloverPrintDeviceForLocation('TESTMERCH0001', 'HOCHELAGA')).toBe('FLEX-HOCH');
    expect(cloverPrintDeviceForLocation('TESTMERCH0001', 'SAINT_LEONARD')).toBeNull();
    expect(cloverPrintDeviceForLocation('TESTMERCH0001', undefined)).toBeNull();
    process.env.CLOVER_PRINT_DEVICES = 'not json';
    expect(cloverPrintDeviceForLocation('TESTMERCH0001', 'NDG_6284')).toBeNull();
  });
});

beforeEach(() => { delete process.env.FOODHUB_CLOVER_RECORD_TIPS; });
