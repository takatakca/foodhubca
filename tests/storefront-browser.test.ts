// Native browser contract tests. No provider calls, order placement or real customer records.
import { describe, expect, it } from 'vitest';
import { cartSchema } from '@/lib/foodhub/storefront/cart';
import { buildCheckout, parseCart, parseCheckout, parseQuote, parseTrack, readPendingCheckout, writePendingCheckout } from '@/app/commander/[slug]/checkout-browser';

const quote = { quoteId: 'a'.repeat(64), subtotal: 25, tax: 3.75, total: 28.75, taxes: { province: 'QC', rate: .14975, label: { fr: 'TPS + TVQ', en: 'GST + QST' } }, lines: [{ ref: 'pita', qty: 2, name: 'Pita', unitPrice: 12.5, total: 25, options: [] }] };
const cart = { slug: 'pita-custom', lines: [{ id: 'a', ref: 'pita', qty: 2, options: [], notes: 'No onion' }] };

describe('native storefront browser checkout contract', () => {
  it('builds an actual server-accepted quoted intent while retaining attribution', () => {
    const request = buildCheckout(cart, { name: 'Test Customer', phone: '5145550177', email: '' }, 'fr', 'pickup', { quoteId: quote.quoteId, idempotencyKey: 'native-exact-request-001', src: 'instagram' });
    const accepted = cartSchema.parse(request);
    expect(accepted).toMatchObject({ slug: 'pita-custom', pay: 'pickup', src: 'instagram', quoteId: quote.quoteId, idempotencyKey: 'native-exact-request-001', customer: { phone: '+15145550177' } });
    expect(accepted.lines).toEqual([{ ref: 'pita', qty: 2, notes: 'No onion', options: [] }]);
  });

  it('recovers the same pending intent/key and attribution after reload', () => {
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
    const request = buildCheckout(cart, { name: 'Test Customer', phone: '5145550177', email: '' }, 'en', 'pickup', { quoteId: quote.quoteId, idempotencyKey: 'native-exact-request-001', src: 'table-12' });
    writePendingCheckout(store, cart.slug, { quote, request });
    expect(readPendingCheckout(store, cart.slug)?.request).toEqual(request);
    expect(readPendingCheckout(store, 'another-brand')).toBeNull();
    writePendingCheckout(store, cart.slug, null);
    expect(readPendingCheckout(store, cart.slug)).toBeNull();
  });

  it('rejects damaged carts and incomplete prices rather than enabling confirmation', () => {
    expect(parseCart('pita-custom', { slug: 'pita-custom', lines: [{ ref: 'pita', qty: -2, options: [] }, { ref: 'pita', qty: 1, options: [{ group: 'g', ref: 'o', qty: 500 }] }] }).lines).toEqual([]);
    expect(parseQuote(quote)?.total).toBe(28.75);
    expect(parseQuote({ ...quote, total: 1 })).toBeNull();
    expect(parseQuote({ ...quote, quoteId: 'unknown' })).toBeNull();
    expect(parseCheckout(409, { reason: 'quote_changed', quote }, 'en')).toMatchObject({ ok: false, reason: 'quote_changed', quote });
    expect(parseCheckout(409, { reason: 'review_required' }, 'en')).toMatchObject({ ok: false, reason: 'review_required' });
  });

  it('never resumes a payment on an untrusted host or an already completed order', () => {
    expect(parseTrack({ ok: true, number: 'SF-1', status: 'awaiting_payment', payUrl: '/p/known-token' })?.payUrl).toBe('http://localhost/p/known-token');
    expect(parseTrack({ ok: true, number: 'SF-1', status: 'completed', payUrl: '/p/known-token' })?.payUrl).toBeUndefined();
    expect(parseTrack({ ok: true, number: 'SF-1', status: 'awaiting_payment', payUrl: 'https://other.test/p/token' })?.payUrl).toBeUndefined();
    expect(parseTrack({ ok: true, number: 'SF-1', status: 'unknown-state' })).toBeNull();
  });
});
