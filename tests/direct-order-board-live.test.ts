// Optional actual Postgres/PostgREST proof. Run only on an isolated loopback schema with FOODHUB_OPERATOR_READ_PROOF=1.
import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DOC_REVIEW_PATHS, getRepo } from '../lib/foodhub/repo';
import { boardDeliveries, listDirectOrderBoard } from '../lib/foodhub/delivery/board';
import { DELIVERIES, DIRECT_ORDERS, listDirectOrders } from '../lib/foodhub/delivery/store';
import type { Delivery, DirectOrder } from '../lib/foodhub/delivery/types';

const enabled = process.env.FOODHUB_OPERATOR_READ_PROOF === '1';
const prefix = `operator-read-${crypto.randomBytes(5).toString('hex')}`;
const own = `${prefix}-OWN`, foreign = `${prefix}-OTHER`;
const now = Date.now(), stamp = (days: number) => new Date(now - days * 86400000).toISOString();
const since = stamp(2);
const link: DirectOrder['paylink'] = { token: 'synthetic-local-only', merchantId: 'synthetic-merchant', marker: 'synthetic-marker', lang: 'en', createdAt: stamp(60), expiresAt: stamp(59), reminderMin: 0, sessions: [], expectedCents: 1150 };
function order(id: string, patch: Partial<DirectOrder> = {}): DirectOrder {
  return { id: `${prefix}-${id}`, number: `SYNTHETIC-${id}`, source: 'website', sourceRef: `${prefix}-${id}`, brandName: 'Synthetic restaurant', locationCode: own, customer: { name: 'Synthetic customer' }, fulfillment: 'pickup', payment: 'pay_at_pickup', status: 'completed', lines: [], subtotal: 10, tax: 1.5, tip: 0, deliveryFee: 0, total: 11.5, currency: 'CAD', containsAlcohol: false, placedAt: stamp(1), createdAt: stamp(1), updatedAt: stamp(1), events: [], ...patch };
}

describe.skipIf(!enabled)('actual isolated PostgreSQL operator reads', () => {
  beforeAll(() => {
    const url = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.invalid');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(getRepo().mode).toBe('supabase');
  });
  it('runs actual non-null JSON predicates, scoped before pagination, through the 1,000-row boundary', async () => {
    const repo = getRepo();
    const collection = `${prefix}-filter`;
    await repo.putDocs<Record<string, unknown>>(collection, [
      ...Array.from({ length: 1001 }, (_, index) => ({ id: `own-${index}`, at: stamp(2), data: { locationCode: own, paylink: { extraPayments: [] } } })),
      ...Array.from({ length: 1005 }, (_, index) => ({ id: `foreign-${index}`, at: stamp(0), data: { locationCode: foreign, attention: 'Foreign synthetic notice' } })),
      { id: 'null', at: stamp(0), data: { locationCode: own, attention: null, paylink: null } },
    ]);
    const rows = await repo.listDocs(collection, { dataLocationCodes: [own], dataAnyPresent: [...DOC_REVIEW_PATHS], limit: 1001 });
    expect(rows).toHaveLength(1001);
    expect(rows.every((row) => row.id.startsWith('own-'))).toBe(true);
    const exact = await repo.listDocs(collection, { ids: ['own-1000'], limit: 1 });
    expect(exact.map((row) => row.id)).toEqual(['own-1000']);
    expect(await repo.listDocs(collection, { dataLocationCodes: [] })).toEqual([]);
    expect(await repo.listDocs(collection, { ids: [] })).toEqual([]);
  }, 60000);
  it('keeps older scoped work and attaches only that order’s exact old courier', async () => {
    const repo = getRepo();
    const old = { createdAt: stamp(60), placedAt: stamp(60), updatedAt: stamp(60) };
    const paid = order('paid-held', { ...old, status: 'awaiting_payment', payment: 'paid', paylink: { ...link, paidAt: stamp(59) } });
    const late = order('late-card', { ...old, status: 'cancelled', paylink: { ...link, extraPayments: ['synthetic-late-payment'] } });
    const active = order('old-active', { ...old, status: 'out_for_delivery', fulfillment: 'delivery', deliveryId: `${prefix}-delivery` });
    const wrong = order('wrong-reference', { ...old, status: 'out_for_delivery', fulfillment: 'delivery', deliveryId: `${prefix}-wrong-delivery` });
    const recent = order('recent');
    const records = [paid, late, active, wrong, recent,
      ...Array.from({ length: 1005 }, (_, index) => order(`foreign-${index}`, { locationCode: foreign, createdAt: stamp(0), status: 'awaiting_payment' as const, attention: 'Foreign synthetic exception' })),
      order('settled-old', old),
    ];
    await repo.putDocs<DirectOrder>(DIRECT_ORDERS, records.map((data) => ({ id: data.id, key: `website:${data.sourceRef}`, at: data.createdAt, data })));
    expect((await listDirectOrders({ locationCodes: [own], since, limit: 1 })).map((row) => row.id)).toEqual([recent.id]);
    const board = await listDirectOrderBoard({ since, locationCodes: [own] });
    expect(board.coverage.partial).toBe(false);
    expect(board.orders.map((row) => row.id).sort()).toEqual([paid, late, active, wrong, recent].map((row) => row.id).sort());
    const delivery = (id: string, orderId: string): Delivery => ({ id, orderId, fleet: 'own_fleet', environment: 'sandbox', status: 'assigned', tip: 0, orderValue: 11.5, containsAlcohol: false, requestedBy: 'Synthetic proof', timeline: [], createdAt: stamp(60), updatedAt: stamp(60) });
    const ownedDelivery = delivery(active.deliveryId!, active.id), wrongDelivery = delivery(wrong.deliveryId!, 'a-foreign-order');
    await repo.putDocs(DELIVERIES, [ownedDelivery, wrongDelivery].map((data) => ({ id: data.id, key: data.orderId, at: data.createdAt, data })));
    const mapped = await boardDeliveries(board.orders);
    expect(mapped.get(active.id)?.id).toBe(ownedDelivery.id);
    expect(mapped.has(wrong.id)).toBe(false);
    expect(JSON.stringify(board.orders)).not.toContain('Foreign synthetic exception');
  }, 60000);
});
