// ON2GO storefront: the cart is priced on the server (client prices ignored), group min / max, unavailable options,
// Duo / Trio / Combo optional (one per line, never pre-selected, Clover modifier refs carried), Québec taxes.
import { describe, expect, it } from 'vitest';
import { QC_TAX_RATE } from '../lib/foodhub/delivery/orders';
import { cartSchema, cleanCustomer, cleanSrc, priceCart, storefrontPhone } from '../lib/foodhub/storefront/cart';
import { buildPublicMenu } from '../lib/foodhub/storefront/catalog';
import { BRAND, LOC, SLUG, at, everyDay, fixtureMenu } from './helpers/storefront-fixture';

const sellable = (now = at(13)) => buildPublicMenu({
  slug: SLUG, brandName: BRAND, cfg: { enabled: true, slug: SLUG, locationCode: LOC, payOnline: true, payAtPickup: true, pickupMaxTotal: 150 }, brandActive: true,
  menu: fixtureMenu(), hours: { locations: { [LOC]: everyDay('06:00', '23:00') }, brands: {}, holidays: [] }, stores: [], location: null, now,
});
type Line = Parameters<typeof priceCart>[1]['lines'][number];
const pita = (options: Line['options'], qty = 1): Line => ({ ref: 'i-pita', qty, options });

describe('server pricing', () => {
  it('ignores prices sent by the browser and prices from the menu (base + options)', () => {
    const parsed = cartSchema.parse({
      slug: SLUG, lang: 'fr', customer: { name: 'Test Client', phone: '514 555 0199' },
      lines: [{ ref: 'i-pita', qty: 2, price: 0.01, total: 0.02, options: [{ group: 'g-size', ref: 'm-lg', price: 0 }, { group: 'g-extra', ref: 'm-cheese' }] }],
      total: 0.03,
    });
    expect(JSON.stringify(parsed)).not.toContain('0.01');
    const r = priceCart(sellable(), parsed);
    if (!r.ok) throw new Error(r.error);
    expect(r.lines[0]).toMatchObject({ name: 'Chicken pita', posItemRef: 'CLV-ITEM-PITA', quantity: 2, unitPrice: 12.5, total: 33 }); // (12.50 + 3 + 1) × 2
    expect(r.lines[0].modifiers).toEqual([
      { externalId: 'm-lg', posModifierRef: 'CLV-MOD-LG', name: 'Large', quantity: 1, unitPrice: 3 },
      { externalId: 'm-cheese', name: 'Cheese', quantity: 1, unitPrice: 1 },
    ]);
    expect(r.subtotal).toBe(33);
    expect(r.tax).toBe(Math.round(33 * QC_TAX_RATE * 100) / 100); // 4.94
    expect(r.total).toBe(37.94);
  });

  it('enforces each group’s min and max (FR / EN messages)', () => {
    const none = priceCart(sellable(), { lang: 'fr', lines: [pita([])] });
    expect(none).toMatchObject({ ok: false, line: 0 });
    if (!none.ok) expect(none.error).toMatch(/au moins 1 option dans « Format »/);
    const tooMany = priceCart(sellable(), { lang: 'en', lines: [pita([{ group: 'g-size', ref: 'm-reg' }, { group: 'g-size', ref: 'm-lg' }])] });
    if (tooMany.ok) throw new Error('expected an error');
    expect(tooMany.error).toMatch(/at most 1 option in "Size"/);
    const extras = priceCart(sellable(), { lang: 'en', lines: [pita([{ group: 'g-size', ref: 'm-reg' }, { group: 'g-extra', ref: 'm-cheese', qty: 3 }])] });
    expect(extras.ok).toBe(false);
  });

  it('refuses an unavailable option, an unknown item or option, an 86’d item, alcohol and a category not served now', () => {
    const hot = priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'm-reg' }, { group: 'g-extra', ref: 'm-hot' }])] });
    if (hot.ok) throw new Error('expected an error');
    expect(hot.error).toMatch(/Sauce piquante.+plus disponible/);
    expect(priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'nope' }])] })).toMatchObject({ ok: false });
    expect(priceCart(sellable(), { lang: 'fr', lines: [{ ref: 'ghost', qty: 1, options: [] }] })).toMatchObject({ ok: false });
    expect(priceCart(sellable(), { lang: 'fr', lines: [{ ref: 'i-plate', qty: 1, options: [] }] })).toMatchObject({ ok: false });
    expect(priceCart(sellable(), { lang: 'fr', lines: [{ ref: 'i-beer', qty: 1, options: [] }] })).toMatchObject({ ok: false });
    const eggs = priceCart(sellable(at(13)), { lang: 'fr', lines: [{ ref: 'i-eggs', qty: 1, options: [] }] });
    if (eggs.ok) throw new Error('expected an error');
    expect(eggs.error).toMatch(/Déjeuners.+pas servi/);
    expect(priceCart(sellable(at(8)), { lang: 'fr', lines: [{ ref: 'i-eggs', qty: 1, options: [] }] }).ok).toBe(true);
  });

  it('Duo / Trio / Combo: optional, at most one meal per line, drink priced and linked from the menu', () => {
    const plain = priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'm-reg' }])] });
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.lines[0].modifiers.map((m) => m.externalId)).toEqual(['m-reg']); // nothing pre-selected
    const duo = priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'm-reg' }, { group: 'g-duo', ref: 'd-7up' }])] });
    if (!duo.ok) throw new Error(duo.error);
    expect(duo.lines[0].modifiers.at(-1)).toEqual({ externalId: 'd-7up', posModifierRef: 'CLV-MOD-DUO-7UP', name: '7UP', quantity: 1, unitPrice: 2.5 });
    expect(duo.lines[0].total).toBe(15);
    const both = priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'm-reg' }, { group: 'g-duo', ref: 'd-pepsi' }, { group: 'g-trio', ref: 't-pepsi' }])] });
    if (both.ok) throw new Error('expected an error');
    expect(both.error).toMatch(/un seul repas/);
  });

  it('QC tax on several lines (GST + QST 14.975 %)', () => {
    const r = priceCart(sellable(), { lang: 'fr', lines: [pita([{ group: 'g-size', ref: 'm-reg' }], 1), { ref: 'i-juice', qty: 3, options: [] }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.subtotal).toBe(21.5);
    expect(r.tax).toBe(3.22);
    expect(r.total).toBe(24.72);
  });
});

describe('cart input', () => {
  it('validates sizes, honeypot and attribution; normalises the phone', () => {
    const base = { slug: SLUG, customer: { name: 'A', phone: '5145550199' }, lines: [{ ref: 'i-juice', qty: 1 }] };
    expect(cartSchema.safeParse(base).success).toBe(true);
    expect(cartSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(cartSchema.safeParse({ ...base, lines: Array.from({ length: 31 }, () => ({ ref: 'i-juice', qty: 1 })) }).success).toBe(false);
    expect(cartSchema.safeParse({ ...base, lines: [{ ref: 'i-juice', qty: 21 }] }).success).toBe(false);
    expect(cartSchema.safeParse({ ...base, lines: [{ ref: 'i-juice', qty: 1, notes: 'x'.repeat(141) }] }).success).toBe(false);
    expect(cartSchema.safeParse({ ...base, customer: { name: 'x'.repeat(61), phone: '5145550199' } }).success).toBe(false);
    expect(cartSchema.safeParse({ ...base, website: 'http://spam.example' }).success).toBe(false);
    expect(cartSchema.parse({ ...base, src: 'instagram' }).src).toBe('instagram');
    expect(cartSchema.parse({ ...base, src: 'table-12' }).src).toBe('table-12');
    expect(cartSchema.parse({ ...base, src: '<script>' }).src).toBeUndefined();
    expect(cleanSrc('QR')).toBe('qr');
    expect(cleanCustomer({ name: '  Marie   T ', phone: '(514) 555-0199' }, 'fr')).toEqual({ ok: true, customer: { name: 'Marie T', phone: '+15145550199', lang: 'fr' } });
    expect(cleanCustomer({ name: 'Marie', phone: '123' }, 'en')).toMatchObject({ ok: false, error: 'Enter a valid Canadian or US phone number.' });
  });

  it('phones: Canada / US only — never an international or premium number (texts are sent to it)', () => {
    for (const ok of ['5145550199', '514-555-0199', '+1 514 555 0199', '1 (438) 555-0101', '+12125550100']) expect(storefrontPhone(ok)).toMatch(/^\+1\d{10}$/);
    for (const bad of ['+44 20 7946 0958', '+882 1234 5678', '+33612345678', '011 44 20 7946 0958', '0044207946095', '+1 876 555 0100', '+1 809 555 0100', '+1 900 555 0100',
      '1234567890', '5141234567', '911 555 0100', '514 911 0100', '+1 514 555 01999', '']) expect(storefrontPhone(bad)).toBeNull();
    expect(cleanCustomer({ name: 'A', phone: '+44 20 7946 0958' }, 'fr')).toMatchObject({ ok: false, error: 'Entrez un numéro de téléphone valide du Canada ou des États-Unis.' });
  });
});
