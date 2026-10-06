// Clover injection: a platform promotion (order.discount) is sent as an order-level discount on the atomic order,
// in negative cents, so Clover's total matches the payment recorded at hand-off (cloverPaymentAmounts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCents } from '../lib/foodhub/config';
import { cloverOrderDiscount, injectOrder } from '../lib/foodhub/pos/clover';
import { cloverPaymentAmounts } from '../lib/foodhub/pos/clover-books';
import type { StoredOrder } from '../lib/foodhub/types';

const MID = 'DISCMERCHANT1';
const realFetch = globalThis.fetch;
const ENV_KEYS = ['FOODHUB_FORCE_MEMORY', 'FOODHUB_POS_INJECTION', 'CLOVER_BASE_URL', 'CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_TOKENS'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let posted: Array<{ url: string; body: any }> = [];

function order(over: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: 'ord-1', status: 'new', createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z',
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'uber-order-discount-1', displayId: 'A1B2C',
    channelStoreId: 'uber-store-1', fulfillment: 'delivery', placedAt: '2026-10-06T12:00:00.000Z', currency: 'CAD',
    // Clover lines: 2 × (12.99 + 1.00 modifier) + 1 × 4.99 = 32.97
    subtotal: 32.97, tax: 4.94, deliveryFee: 0, tip: 0, discount: 0, total: 37.91,
    lines: [
      { name: 'Poulet Grillé', quantity: 2, unitPrice: 12.99, total: 27.98, posItemRef: 'clv-item-1', modifiers: [{ name: 'Sauce', quantity: 1, unitPrice: 1 }] },
      { name: 'Frites', quantity: 1, unitPrice: 4.99, total: 4.99, modifiers: [] },
    ],
    raw: {},
    ...over,
  };
}

async function inject(o: StoredOrder) {
  const res = await injectOrder(o, MID);
  expect(res).toEqual({ ok: true, posOrderId: 'CLV-DISC-1' });
  expect(posted).toHaveLength(1);
  expect(posted[0].url).toBe(`https://api.clover.test/v3/merchants/${MID}/atomic_order/orders`);
  return posted[0].body.orderCart as { lineItems: Array<{ price: number }>; discounts?: Array<{ name: string; amount: number }> };
}

const linesTotal = (cart: { lineItems: Array<{ price: number }> }) => cart.lineItems.reduce((s, l) => s + l.price, 0);

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  delete process.env.FOODHUB_POS_INJECTION;
  delete process.env.CLOVER_MERCHANT_TOKENS;
  process.env.CLOVER_BASE_URL = 'https://api.clover.test';
  process.env.CLOVER_MERCHANT_ID = MID;
  process.env.CLOVER_ACCESS_TOKEN = 'clover-token-test';
  posted = [];
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    posted.push({ url: String(input), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ id: 'CLV-DISC-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

describe('Clover atomic order: platform promotion as an order-level discount', () => {
  it('no discount → no discounts field on the order cart', async () => {
    const cart = await inject(order({ discount: 0 }));
    expect(cart).not.toHaveProperty('discounts');
    expect(linesTotal(cart)).toBe(3297);
  });

  it('older orders without a discount value (undefined / NaN) send no discount either', async () => {
    expect(await inject(order({ discount: undefined as unknown as number }))).not.toHaveProperty('discounts');
    posted = [];
    expect(await inject(order({ discount: Number.NaN }))).not.toHaveProperty('discounts');
  });

  it('discount 3.50 → one discount of −350 cents named after the platform', async () => {
    const cart = await inject(order({ discount: 3.5 }));
    expect(cart.discounts).toEqual([{ name: 'Uber Eats promotion', amount: -350 }]);
  });

  it('uses each platform label (DoorDash, SkipTheDishes)', async () => {
    expect((await inject(order({ channel: 'doordash', marketplace: 'doordash', discount: 3.5 }))).discounts).toEqual([{ name: 'DoorDash promotion', amount: -350 }]);
    posted = [];
    expect((await inject(order({ channel: 'skip', marketplace: 'skip', discount: 1.25 }))).discounts).toEqual([{ name: 'SkipTheDishes promotion', amount: -125 }]);
  });

  it('a discount larger than the line items is capped at the line items total (Clover total never negative)', async () => {
    const cart = await inject(order({ discount: 50 }));
    expect(cart.discounts).toEqual([{ name: 'Uber Eats promotion', amount: -3297 }]);
    expect(linesTotal(cart) + cart.discounts![0].amount).toBe(0);
  });

  it('a discount equal to the line items is sent in full', async () => {
    const cart = await inject(order({ discount: 32.97 }));
    expect(cart.discounts?.[0].amount).toBe(-3297);
  });

  it('a negative discount is never sent (Clover discounts are ≤ 0; no surcharge)', async () => {
    expect(await inject(order({ discount: -3.5 }))).not.toHaveProperty('discounts');
  });

  it('rounds with toCents: below half a cent → none, half a cent and up → at least −1', async () => {
    expect(await inject(order({ discount: 0.004 }))).not.toHaveProperty('discounts');
    posted = [];
    expect((await inject(order({ discount: 0.005 }))).discounts).toEqual([{ name: 'Uber Eats promotion', amount: -1 }]);
    posted = [];
    expect((await inject(order({ discount: 0.01 }))).discounts).toEqual([{ name: 'Uber Eats promotion', amount: -1 }]);
    for (const d of [0.015, 0.995, 1.005, 2.675, 3.505, 12.345]) {
      expect(cloverOrderDiscount({ marketplace: 'uber_eats', discount: d }, 3297)?.amount).toBe(-toCents(d));
    }
  });

  it('Clover total (lines − discount + tax) equals the payment recorded at hand-off for cent amounts', async () => {
    for (const d of [0.01, 0.99, 3.5, 12.34, 32.96]) {
      posted = [];
      const o = order({ discount: d });
      const cart = await inject(o);
      // Clover lines match the platform subtotal here, so Clover's pre-tax total is subtotal − discount.
      expect(linesTotal(cart)).toBe(toCents(o.subtotal));
      expect(linesTotal(cart) + cart.discounts![0].amount + toCents(o.tax)).toBe(cloverPaymentAmounts(o).amount);
    }
  });

  it('discount name stays within Clover’s 64-character limit for an unknown marketplace label', () => {
    const d = cloverOrderDiscount({ marketplace: 'x'.repeat(80) as StoredOrder['marketplace'], discount: 2 }, 1000);
    expect(d?.name.length).toBe(64);
    expect(d?.amount).toBe(-200);
  });

  it('pure helper: no line items total → nothing to discount', () => {
    expect(cloverOrderDiscount({ marketplace: 'doordash', discount: 3.5 }, 0)).toBeNull();
    expect(cloverOrderDiscount({ marketplace: 'doordash', discount: 3.5 }, 200)).toEqual({ name: 'DoorDash promotion', amount: -200 });
  });
});
