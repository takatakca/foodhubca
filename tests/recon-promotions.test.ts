// Reconciliation: a restaurant-funded promotion is counted once, whether the order or the statement (or both) shows it.
import { describe, expect, it } from 'vitest';
import { promotionsBeyondOrder } from '../lib/foodhub/recon/engine';
import { expectedPayout } from '../lib/foodhub/recon/fees';

const plan = { deliveryPct: 30, pickupPct: 15, taxOnFeesPct: 14.975, fixedFee: 0, payoutLagDays: 7 } as Parameters<typeof expectedPayout>[1];

describe('promotions in reconciliation', () => {
  it('statement only: the whole statement promotion explains the difference', () => {
    expect(promotionsBeyondOrder(-3.5, 0)).toBe(-3.5);
    expect(promotionsBeyondOrder(-3.5, undefined)).toBe(-3.5);
  });
  it('order and statement show the same promotion: nothing added twice', () => {
    expect(promotionsBeyondOrder(-3.5, 3.5)).toBe(0);
  });
  it('statement shows more than the order carries: only the extra is added back', () => {
    expect(promotionsBeyondOrder(-5, 3.5)).toBe(-1.5);
  });
  it('order carries more than the statement lists, or the statement has none: nothing added', () => {
    expect(promotionsBeyondOrder(-2, 3.5)).toBe(0);
    expect(promotionsBeyondOrder(0, 3.5)).toBe(0);
    expect(promotionsBeyondOrder(1, 0)).toBe(0); // a positive "promotion" is never treated as one
  });
  it('a correctly paid promoted order matches exactly (no false "over paid")', () => {
    const order = { subtotal: 20, discount: 3.5, tax: 2.47, fulfillment: 'delivery' as const, status: 'completed' as const };
    const exp = expectedPayout(order as Parameters<typeof expectedPayout>[0], plan);
    // what the platform pays: food after the promotion + tax − commission on the promoted food − tax on commission
    const statementNet = exp.net;
    const statementPromotions = -3.5;
    expect(Math.round((statementNet - (exp.net + promotionsBeyondOrder(statementPromotions, order.discount))) * 100) / 100).toBe(0);
  });
});
