import { describe, expect, it } from 'vitest';
import { courierFilterLabel, matchesOrderFilters, orderCourier, orderIssues, orderOutcome, parseOrderFilters, withOrderFilters } from '../lib/foodhub/orders/issues';
import type { StoredOrder } from '../lib/foodhub/types';
const order = (patch: Partial<StoredOrder> = {}): StoredOrder => ({ id: 'one', channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'platform-one', channelStoreId: 'store', fulfillment: 'delivery', placedAt: '2026-11-04T12:00:00Z', currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10, lines: [], raw: {}, status: 'accepted', createdAt: '2026-11-04T12:00:00Z', updatedAt: '2026-11-04T12:00:00Z', ...patch });
const filters = (q = '') => parseOrderFilters(new URLSearchParams(q));

describe('recorded order investigation filters', () => {
  it('treats unknown filters as invalid instead of silently showing all orders', () => {
    for (const q of ['issue=refunded', 'outcome=delivered', 'courier=none', 'issue=any,clover']) expect(() => filters(q)).toThrow(/Invalid .* filter/);
  });
  it('classifies existing failures and reported missing items, without inferring a failure from missing optional data', () => {
    expect(orderIssues(order())).toEqual([]);
    expect(orderIssues(order({ posError: 'failed', channelError: 'denied', mappingWarnings: [{ line: 0, name: 'Item', kind: 'item', reason: 'no_match' }], timeline: { printError: 'paper', missingItems: [{ name: 'Item', quantity: 1, at: '2026-11-04' }] } }))).toEqual(['clover', 'platform', 'printing', 'mapping', 'missing_items']);
  });
  it('does not retain a resolved Clover injection/payment failure as a current issue', () => {
    expect(orderIssues(order({ posError: 'old', posOrderId: 'resolved', timeline: { posPaymentError: 'old', posPaymentId: 'paid' } }))).toEqual([]);
    expect(orderIssues(order({ timeline: { posPaymentError: 'not recorded' } }))).toEqual(['clover']);
  });
  it('keeps completed status separate from explicit courier delivery and cancellation attribution', () => {
    expect(orderOutcome(order({ status: 'completed' }))).toBe('completed');
    expect(orderCourier(order({ status: 'completed' }))).toBe('not_reported');
    for (const source of ['store', 'customer', 'platform'] as const) expect(orderOutcome(order({ status: 'cancelled', timeline: { cancelledBy: source } }))).toBe(`cancelled_${source}`);
    expect(orderOutcome(order({ status: 'cancelled' }))).toBe('cancelled_unknown');
    expect(orderOutcome(order({ status: 'failed' }))).toBe('tablet');
    expect(orderOutcome(order({ status: 'dispatched' }))).toBe('in_progress');
  });
  it('distinguishes unreported, explicitly unassigned, delivery reported and non-delivery orders', () => {
    expect(orderCourier(order())).toBe('not_reported');
    for (const status of ['unassigned', 'assigned', 'arriving', 'at_store', 'picked_up', 'delivered'] as const) expect(orderCourier(order({ timeline: { courier: { status, updatedAt: '2026-11-04', source: 'webhook' } } }))).toBe(status);
    expect(orderCourier(order({ fulfillment: 'pickup' }))).toBe('not_applicable');
    expect(courierFilterLabel((_fr, en) => en, 'not_reported')).toBe('Courier not reported');
  });
  it('ANDs issue, outcome and courier filters on the same order', () => {
    const o = order({ channelError: 'blocked', timeline: { courier: { status: 'at_store', updatedAt: '2026-11-04', source: 'webhook' } } });
    expect(matchesOrderFilters(o, filters('issue=any&outcome=in_progress&courier=at_store'))).toBe(true);
    expect(matchesOrderFilters(o, filters('issue=platform'))).toBe(true);
    for (const q of ['issue=none', 'issue=clover', 'outcome=completed', 'courier=not_reported']) expect(matchesOrderFilters(o, filters(q))).toBe(false);
    expect(matchesOrderFilters(order(), filters('issue=none'))).toBe(true);
  });
  it('persists and clears only order filters, retaining provider, restaurant, date, view and open order', () => {
    const original = 'view=history&range=custom&from=2026-10-31&to=2026-11-04&kitchen=NDG&brand=Po+Poulet&channel=doordash&open=one';
    const changed = withOrderFilters(original, { issue: 'printing', outcome: 'in_progress', courier: 'at_store', status: 'accepted', q: '#42' });
    expect(filters(changed)).toEqual({ issue: 'printing', outcome: 'in_progress', courier: 'at_store' });
    expect(new URLSearchParams(changed).get('q')).toBe('#42');
    expect(withOrderFilters(changed, { issue: '', outcome: '', courier: '', status: '', q: '' })).toBe(original);
  });
});
