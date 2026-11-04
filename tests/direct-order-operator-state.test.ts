import { describe, expect, it } from 'vitest';
import { directOrderReview, hasCourierRequestRoute } from '../lib/foodhub/delivery/operator-state';
import { directOrderStatusLabel, paymentBadge } from '../components/expansion/labels';
import type { DirectOrder } from '../lib/foodhub/delivery/types';

type Order = Parameters<typeof directOrderReview>[0];
const link: DirectOrder['paylink'] = { token: 'synthetic-token', merchantId: 'synthetic-merchant', marker: 'synthetic-marker', lang: 'en', createdAt: '2026-11-04T12:00:00Z', expiresAt: '2026-11-04T12:20:00Z', reminderMin: 0, sessions: [], expectedCents: 1250 };
const transfer: DirectOrder['interac'] = { reference: 'synthetic-reference', recipient: 'restaurant@example.test', amount: 12.5, autoDeposit: true, lang: 'en', createdAt: '2026-11-04T12:00:00Z', expiresAt: '2026-11-04T12:20:00Z', reminderMin: 0 };
const base = (patch: Partial<Order> = {}): Order => ({ status: 'awaiting_payment', payment: 'unpaid', paylink: link, ...patch });
const en = (_fr: string, english: string) => english;
const fr = (french: string) => french;

describe('operator payment follow-through', () => {
  it.each(['paymentId', 'paidAt'] as const)('holds a recorded %s for kitchen confirmation rather than another payment', (field) => {
    const order = base({ paylink: { ...link, [field]: 'synthetic-recorded-evidence' } });
    expect(directOrderReview(order)).toMatchObject({ cardReleasePending: true, blockPaymentActions: true, needsPerson: true });
    expect(paymentBadge(en, order).label).toContain('Payment received');
    expect(directOrderStatusLabel(en, order)).not.toMatch(/Waiting for payment/);
  });

  it('also recognizes the existing paid order field before release finishes', () => {
    const order = base({ payment: 'paid' });
    expect(directOrderReview(order)).toMatchObject({ cardRecorded: true, cardReleasePending: true, needsPerson: true });
  });

  it.each(['cancelled', 'completed'] as const)('keeps a late/extra card payment visible after %s, even when attention text was cleared', (status) => {
    const order = base({ status, attention: undefined, paylink: { ...link, extraPayments: ['synthetic-extra-payment'] } });
    expect(directOrderReview(order)).toMatchObject({ extraCardPayment: true, cardReview: true, needsPerson: true, blockPaymentActions: true });
    expect(directOrderStatusLabel(en, order)).toBe(status === 'cancelled' ? 'Cancelled' : 'Completed');
    expect(paymentBadge(fr, order)).toMatchObject({ tone: 'wait', label: 'Paiement à vérifier' });
  });

  it('keeps a persisted ownership/release review visible without guessing that money arrived', () => {
    const order = base({ paylink: { ...link, flag: 'Paiement à vérifier — interrupted release' } });
    expect(directOrderReview(order)).toMatchObject({ cardReview: true, cardRecorded: false, blockPaymentActions: true, needsPerson: true });
    expect(paymentBadge(en, order).label).toBe('Payment needs review');
  });

  it.each(['in_kitchen', 'ready', 'completed'] as const)('preserves the ordinary paid %s stage and does not create a permanent hold', (status) => {
    const order = base({ status, payment: 'paid', paylink: { ...link, paidAt: '2026-11-04T12:01:00Z', releasedAt: '2026-11-04T12:02:00Z' } });
    expect(directOrderReview(order)).toMatchObject({ cardReview: false, cardReleasePending: false, needsPerson: false, blockPaymentActions: false });
    expect(directOrderStatusLabel(en, order)).not.toMatch(/review|unconfirmed/i);
    expect(paymentBadge(en, order)).toEqual({ tone: 'go', label: 'Paid' });
  });

  it('preserves ordinary unpaid link actions', () => {
    const order = base();
    expect(directOrderReview(order)).toMatchObject({ blockPaymentActions: false, needsPerson: false });
    expect(paymentBadge(en, order).label).toBe('Payment link sent');
    expect(directOrderStatusLabel(fr, order)).toBe('En attente de paiement');
  });

  it('shows a recorded Interac transfer as received while preserving its existing finish-release action', () => {
    const order = base({ paylink: undefined, payment: 'paid', interac: { ...transfer, receivedAt: '2026-11-04T12:01:00Z' } });
    expect(directOrderReview(order)).toMatchObject({ transferReleasePending: true, blockPaymentActions: false, needsPerson: true });
    expect(paymentBadge(en, order).label).toContain('Payment received');
  });

  it('does not hide card review behind stale mixed Interac fields', () => {
    const order = base({ interac: transfer, paylink: { ...link, flag: 'Paiement à vérifier — ambiguous reference' } });
    expect(directOrderReview(order).blockPaymentActions).toBe(true);
    expect(paymentBadge(en, order).label).toBe('Payment needs review');
  });

  it('retains the existing unresolved-versus-handled late Interac distinction', () => {
    const order = base({ status: 'cancelled', paylink: undefined, interac: { ...transfer, lateTransfers: [{ at: '2026-11-04T12:01:00Z', by: 'Synthetic operator' }] } });
    expect(directOrderReview(order).needsPerson).toBe(true);
    const late = order.interac!.lateTransfers![0];
    expect(directOrderReview({ ...order, interac: { ...order.interac!, lateTransfers: [{ ...late, refundedAt: '2026-11-04T12:02:00Z' }] } }).needsPerson).toBe(false);
  });
});

describe('courier request readiness', () => {
  it('does not claim every courier is unavailable when Uber Direct can send and DoorDash Drive cannot', () => {
    expect(hasCourierRequestRoute([{ configured: false, canSend: false }, { configured: true, canSend: true }])).toBe(true);
  });
  it('does not equate configured credentials with permission to send', () => {
    expect(hasCourierRequestRoute([{ configured: true, canSend: false }])).toBe(false);
  });
  it('reports unavailable when no configured route can send', () => {
    expect(hasCourierRequestRoute([{ configured: false, canSend: false }])).toBe(false);
    expect(hasCourierRequestRoute([])).toBe(false);
  });
});
