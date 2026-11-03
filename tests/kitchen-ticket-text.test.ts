import { describe, expect, it } from 'vitest';
import {
  clock, moneyText, printable, renderCancelTicket, renderKitchenTicket, stripMarkup, ticketFromDirectOrder, ticketFromStoredOrder, wrap,
  type KitchenTicket, type TicketWidth,
} from '../lib/foodhub/kitchen/ticket-text';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import type { StoredOrder } from '../lib/foodhub/types';

// 2026-10-30 16:05 UTC = 12:05 in Montréal (EDT until 2026-11-01).
const PLACED = '2026-10-30T16:05:00.000Z';

function order(over: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: 'o1', channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'ext-123456789', displayId: 'A1B2C', channelStoreId: 's1',
    brandName: 'Poutine Express', customerName: 'Marie-Ève Tremblay', fulfillment: 'pickup', placedAt: PLACED, currency: 'CAD',
    subtotal: 20, tax: 3.45, deliveryFee: 0, tip: 0, discount: 0, total: 23.45, notes: 'Sonnez à la porte « arrière »',
    lines: [
      { name: 'Poutine classique', quantity: 2, unitPrice: 8, total: 16, notes: 'sans oignons', modifiers: [{ name: 'Sauce extra', quantity: 1, unitPrice: 0, total: 0 }, { name: 'Bacon', quantity: 2, unitPrice: 1, total: 2 }] as any },
      { name: 'Coke', quantity: 1, unitPrice: 2, total: 2, modifiers: [] },
    ],
    raw: {}, status: 'new', locationCode: 'NDG', createdAt: PLACED, updatedAt: PLACED, timeline: { readyTarget: '2026-10-30T16:25:00.000Z' },
    ...over,
  } as StoredOrder;
}

const widths: TicketWidth[] = [32, 42];

describe('kitchen ticket text (tablet printer)', () => {
  it.each(widths)('fits %i columns, and the big order number fits half of them', (width) => {
    const long = order({ brandName: 'La Très Grande Cantine du Quartier Notre-Dame-de-Grâce', lines: [{ name: 'Sandwich au porc effiloché avec salade de chou crémeuse et frites maison', quantity: 1, unitPrice: 15, total: 15, modifiers: [{ name: 'Supplément fromage en grains de la fromagerie locale', quantity: 3, unitPrice: 1, total: 3 }] as any, notes: 'Couper en deux, emballer séparément, ajouter beaucoup de serviettes' }] });
    for (const ticket of [renderKitchenTicket(ticketFromStoredOrder(long), { width, lang: 'fr' }), renderKitchenTicket(ticketFromStoredOrder(long), { width, lang: 'en' })]) {
      const raw = ticket.split('\n');
      const shown = stripMarkup(ticket);
      shown.forEach((l, i) => {
        const limit = raw[i].startsWith('@@H') ? width / 2 : width;
        expect(l.length, `line ${i} "${l}"`).toBeLessThanOrEqual(limit);
      });
      expect(raw.some((l) => l.startsWith('@@HBC ') && l.includes('#A1B2C'))).toBe(true);
    }
  });

  it.each(widths)('carries brand, number, platform, first name, pickup, times, lines, notes and total (fr, %i)', (width) => {
    const text = stripMarkup(renderKitchenTicket(ticketFromStoredOrder(order()), { width, lang: 'fr' })).join('\n');
    expect(text).toContain('UBER EATS');
    expect(text).toContain('#A1B2C');
    expect(text).toContain('Poutine Express');
    expect(text).toContain('Client : Marie-Ève');
    expect(text).not.toContain('Tremblay');
    expect(text).toMatch(/POUR EMPORTER +12:05/);
    expect(text).toMatch(/PRÊTE À +12:25/);
    expect(text).toContain('2 x Poutine classique');
    expect(text).toContain('  + Sauce extra');
    expect(text).toContain('  + 2 x Bacon');
    expect(text).toContain('  » sans oignons');
    expect(text).toContain('1 x Coke');
    expect(text).toContain('NOTE :');
    expect(text).toContain('Sonnez à la porte « arrière »');
    expect(text).toContain('Articles : 3');
    expect(text).toMatch(/TOTAL +23,45 \$/);
  });

  it('speaks English and says delivery', () => {
    const text = stripMarkup(renderKitchenTicket(ticketFromStoredOrder(order({ fulfillment: 'delivery' })), { width: 42, lang: 'en' })).join('\n');
    expect(text).toMatch(/DELIVERY +12:05/);
    expect(text).toMatch(/READY AT +12:25/);
    expect(text).toContain('Customer : Marie-Ève');
    expect(text).toMatch(/TOTAL +\$23\.45/);
    expect(text).toContain('Items : 3');
  });

  it('prints no amount when Takatak MEV issues the invoice', () => {
    const issued = order({ timeline: { mev: { status: 'issued', saleKey: 'k' } as any } });
    expect(stripMarkup(renderKitchenTicket(ticketFromStoredOrder(issued), { width: 42, lang: 'fr' })).join('\n')).not.toMatch(/TOTAL|\$/);
    const shadow = order({ timeline: { mev: { status: 'shadow', saleKey: 'k' } as any } });
    expect(stripMarkup(renderKitchenTicket(ticketFromStoredOrder(shadow), { width: 42, lang: 'fr' })).join('\n')).toMatch(/TOTAL/);
  });

  it('customer text can never style the paper, and odd characters become printable', () => {
    const t: KitchenTicket = { platform: 'DOORDASH', number: '#9', fulfillment: 'pickup', placedAt: PLACED, total: null, notes: '@@HBC hack', lines: [{ quantity: 1, name: '@@B Café “spécial” — œuf 🍳' }] };
    const raw = renderKitchenTicket(t, { width: 32, lang: 'fr' }).split('\n');
    expect(raw.filter((l) => l.startsWith('@@HBC'))).toEqual(['@@HBC #9']);
    expect(raw).toContain(' @@HBC hack');
    expect(raw).toContain('@@B 1 x @@B Café "spécial" - oeuf');
    expect(printable('Crème brûlée ½ — 5 €')).toBe('Crème brûlée ½ - 5 €');
    expect(printable('a\nb\tc\u0007')).toBe('a b c');
  });

  it('wraps long words and lines, keeps the indent', () => {
    expect(wrap('2 x Poutine extra large au fromage', 16, 4)).toEqual(['2 x Poutine', '    extra large', '    au fromage']);
    expect(wrap('ABCDEFGHIJKLMNOPQRST', 8)).toEqual(['ABCDEFGH', 'IJKLMNOP', 'QRST']);
  });

  it('formats time in Montréal and money per language', () => {
    expect(clock(PLACED)).toBe('12:05');
    expect(clock('2026-12-01T23:30:00Z')).toBe('18:30'); // EST
    expect(clock('not a date')).toBe('');
    expect(moneyText(1234.5, 'fr')).toBe('1234,50 $');
    expect(moneyText(1234.5, 'en')).toBe('$1234.50');
  });

  it.each(widths)('cancel ticket: ANNULÉE in big letters, the number, do not cook (%i)', (width) => {
    const ticket = renderCancelTicket({ platform: 'DOORDASH', number: '#77', brandName: 'Bánh Mì', cancelledAt: '2026-10-30T16:40:00Z', reason: 'Client a annulé' }, { width, lang: 'fr' });
    const raw = ticket.split('\n');
    expect(raw).toContain('@@HBC ANNULÉE');
    expect(raw).toContain('@@HBC #77');
    const text = stripMarkup(ticket).join('\n');
    expect(text).toContain('NE PAS PRÉPARER');
    expect(text).toContain('Annulée à 12:40');
    expect(text).toContain('Raison : Client a annulé');
    stripMarkup(ticket).forEach((l, i) => expect(l.length).toBeLessThanOrEqual(raw[i].startsWith('@@H') ? width / 2 : width));
    expect(renderCancelTicket({ platform: 'DOORDASH', number: '#77' }, { width, lang: 'en' })).toContain('@@HBC CANCELLED');
  });

  it('own orders: source label, number, first name, to be paid at the counter', () => {
    const d = {
      id: 'd1', number: 'IA-1043', source: 'phone_ai', brandName: 'Rôtisserie Test', locationCode: 'NDG', customer: { name: 'Jean Untel' }, fulfillment: 'pickup',
      lines: [{ name: 'Demi-poulet', quantity: 1, unitPrice: 14, total: 14, modifiers: [] }], subtotal: 14, tax: 2.1, deliveryFee: 0, tip: 0, total: 16.1, currency: 'CAD',
      payment: 'pay_at_pickup', status: 'in_kitchen', containsAlcohol: false, placedAt: PLACED, events: [], createdAt: PLACED, updatedAt: PLACED,
    } as unknown as DirectOrder;
    const fr = stripMarkup(renderKitchenTicket(ticketFromDirectOrder(d, 'fr'), { width: 32, lang: 'fr' })).join('\n');
    expect(fr).toContain('TÉLÉPHONE (IA)');
    expect(fr).toContain('IA-1043');
    expect(fr).toContain('Client : Jean');
    expect(fr).toContain('À PAYER AU COMPTOIR');
    expect(fr).toMatch(/TOTAL +16,10 \$/);
    const en = stripMarkup(renderKitchenTicket(ticketFromDirectOrder(d, 'en'), { width: 32, lang: 'en' })).join('\n');
    expect(en).toContain('PHONE (AI)');
    expect(en).toContain('PAY AT THE COUNTER');
  });
});
