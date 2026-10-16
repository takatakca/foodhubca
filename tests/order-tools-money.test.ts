// Kitchen order tools — the money of one order, read-only, from the reconciliation engine (mocked here).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOrderMoneyCache, orderMoney, ORDER_MONEY_TTL_MS, type OrderMoneyDeps } from '../lib/foodhub/order-tools/order-money';
import type { OrderRecon, ReconCase } from '../lib/foodhub/recon/engine';

const order = { id: 'ord-1', channel: 'uber_eats' as const, createdAt: '2026-10-10T22:30:00Z', locationCode: 'NDG' };

const recon = (o: Partial<OrderRecon> & { orderId: string }): OrderRecon => ({
  channel: 'uber_eats', ref: 'r', displayId: 'A1', brandName: 'Alpha', locationCode: 'NDG', storeId: 's', date: '2026-10-10', fulfillment: 'delivery', orderStatus: 'completed',
  total: 30, expected: { sales: 25, tax: 3.74, commission: 7.5, commissionTax: 1.12, fixedFee: 0, net: 20.12, ratePct: 30 }, actual: 18.12, diff: -2, status: 'short_paid',
  lines: 2, payoutDate: '2026-10-14', refunds: 0, errorCharges: -2, adjustments: 0, promotions: 0, planConfirmed: true, caseStatus: 'open', ...o,
});
const kase = (c: Partial<ReconCase> & { id: string }): ReconCase => ({
  type: 'short_paid', channel: 'uber_eats', ref: 'r', orderId: 'ord-1', brandName: 'Alpha', locationCode: 'NDG', orderDate: '2026-10-10', amount: 2, status: 'open', notes: [], openedAt: '2026-10-15', updatedAt: '2026-10-15', ...c,
});

function deps(rows: OrderRecon[], cases: ReconCase[], now = Date.parse('2026-10-16T12:00:00Z')) {
  const d = {
    reconcile: vi.fn(async () => ({ orders: rows })),
    listCases: vi.fn(async () => cases),
    now: vi.fn(() => now),
  };
  return d as typeof d & OrderMoneyDeps;
}

beforeEach(() => clearOrderMoneyCache());

describe('orderMoney', () => {
  it('asks the engine for a day either side of the order, on its channel and kitchen, and keeps only this order', async () => {
    const d = deps([recon({ orderId: 'other', actual: 99 }), recon({ orderId: 'ord-1' })], [kase({ id: 'c-other', orderId: 'other', amount: 50 }), kase({ id: 'c1' })]);
    const m = await orderMoney(order, d);
    expect(d.reconcile).toHaveBeenCalledWith({ from: '2026-10-09', to: '2026-10-11', channels: ['uber_eats'], locationCodes: ['NDG'] });
    expect(d.listCases).toHaveBeenCalledWith({ channels: ['uber_eats'] });
    expect(m).toEqual({
      status: 'short_paid', expected: 20.12, actual: 18.12, diff: -2, errorCharges: -2, adjustments: 0, refunds: 0, promotions: 0, payoutDate: '2026-10-14',
      case: { id: 'c1', type: 'short_paid', status: 'open', amount: 2 },
    });
  });

  it('prefers an open / disputed case over a closed one', async () => {
    const d = deps([recon({ orderId: 'ord-1' })], [kase({ id: 'old', status: 'recovered', amount: 9 }), kase({ id: 'live', status: 'disputed', amount: 1 })]);
    expect((await orderMoney(order, d)).case?.id).toBe('live');
  });

  it('not_yet when no statement covers the order (no row, pending or not covered)', async () => {
    expect(await orderMoney(order, deps([], []))).toEqual({ status: 'not_yet', case: null });
    clearOrderMoneyCache();
    expect(await orderMoney(order, deps([recon({ orderId: 'ord-1', status: 'not_covered', actual: null, diff: null, payoutDate: null })], []))).toEqual({ status: 'not_yet', case: null, expected: 20.12, payoutDate: null });
    clearOrderMoneyCache();
    expect((await orderMoney(order, deps([recon({ orderId: 'ord-1', status: 'pending' })], []))).status).toBe('not_yet');
  });

  it('caches each order for 60 seconds', async () => {
    let now = Date.parse('2026-10-16T12:00:00Z');
    const d = deps([recon({ orderId: 'ord-1' })], []);
    d.now.mockImplementation(() => now);
    await orderMoney(order, d);
    now += ORDER_MONEY_TTL_MS - 1;
    await orderMoney(order, d);
    expect(d.reconcile).toHaveBeenCalledTimes(1);
    now += 2;
    await orderMoney(order, d);
    expect(d.reconcile).toHaveBeenCalledTimes(2);
  });

  it('is read-only: the module exposes no write (no submit, approve or case update)', async () => {
    const mod = await import('../lib/foodhub/order-tools/order-money');
    expect(Object.keys(mod).sort()).toEqual(['ORDER_MONEY_TTL_MS', 'clearOrderMoneyCache', 'orderMoney']);
  });
});
