import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo, type DocFilter } from '../lib/foodhub/repo';
import { boardDeliveries, DIRECT_BOARD_DELIVERY_BATCH_LIMIT, DIRECT_BOARD_RESULT_LIMIT, listDirectOrderBoard } from '../lib/foodhub/delivery/board';
import { DELIVERIES, DIRECT_ORDERS, listDirectOrders } from '../lib/foodhub/delivery/store';
import type { Delivery, DirectOrder } from '../lib/foodhub/delivery/types';
import { GET } from '../app/api/foodhub/delivery/route';
import { GET as detailGet, POST as detailPost } from '../app/api/foodhub/delivery/[id]/route';
import { GET as activeGet } from '../app/api/foodhub/delivery/active/route';
import { activeDelivery, cancelCourier, FLEETS } from '../lib/foodhub/delivery/dispatch';

const NOW = Date.parse('2026-11-04T18:00:00Z');
const stamp = (days: number) => new Date(NOW - days * 86400000).toISOString();
const since = stamp(2);
const password = 'Synthetic-board-reader-42';
const link: DirectOrder['paylink'] = { token: 'synthetic-token', merchantId: 'synthetic-merchant', marker: 'synthetic-marker', lang: 'en', createdAt: stamp(60), expiresAt: stamp(59), reminderMin: 0, sessions: [], expectedCents: 1150 };
function order(id: string, patch: Partial<DirectOrder> = {}): DirectOrder {
  return { id, number: id, source: 'website', sourceRef: `source-${id}`, brandName: 'Synthetic restaurant', locationCode: 'OWN', customer: { name: 'Synthetic customer' }, fulfillment: 'pickup', payment: 'pay_at_pickup', status: 'completed', lines: [], subtotal: 10, tax: 1.5, tip: 0, deliveryFee: 0, total: 11.5, currency: 'CAD', containsAlcohol: false, placedAt: stamp(1), createdAt: stamp(1), updatedAt: stamp(1), events: [], ...patch };
}
async function seed(orders: DirectOrder[]) {
  await getRepo().putDocs<DirectOrder>(DIRECT_ORDERS, orders.map((data) => ({ id: data.id, key: `website:${data.sourceRef}`, at: data.createdAt, data })));
}
const request = (query = '') => new Request(`http://hub.local/api/foodhub/delivery${query ? `?${query}` : ''}`, { headers: { authorization: `Basic ${Buffer.from(`board_reader:${password}`).toString('base64')}`, 'x-forwarded-for': '10.1.42.44' } });
const read = async (query = '') => { const response = await GET(request(query), {}); return { response, body: await response.json() }; };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true'); vi.stubEnv('FOODHUB_TRUST_PROXY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', 'Synthetic-board-owner-42');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  await getRepo().saveUser({ username: 'board_reader', name: 'Synthetic scoped operator', role: 'operator', locations: ['OWN'], active: true, lastLoginAt: null, passwordHash: hashPassword(password) });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Provider calls forbidden in board reads'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded direct-order board retrieval', () => {
  it('pushes actor/location scope before the result limit despite newer foreign-location saturation', async () => {
    await seed([order('owned', { status: 'in_kitchen', fulfillment: 'delivery' }), ...Array.from({ length: 1100 }, (_, index) => order(`foreign-${index}`, { locationCode: 'OTHER', createdAt: stamp(0), customer: { name: 'Foreign secret' } }))]);
    expect((await listDirectOrders({ locationCodes: ['OWN'], limit: 1 })).map((row) => row.id)).toEqual(['owned']);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.orders.map((row: DirectOrder) => row.id)).toEqual(['owned']);
    expect(body.coverage.partial).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Foreign secret');
    expect((await read('locations=OTHER')).body.orders).toEqual([]);
    expect((await read('locations=OWN,OTHER')).body.orders.map((row: DirectOrder) => row.id)).toEqual(['owned']);
    vi.stubEnv('FOODHUB_FEATURE_DELIVERY', 'on');
    const active = await (await activeGet(request(), {})).json();
    expect(active.items.map((row: DirectOrder) => row.id)).toEqual(['owned']);
  });
  it('includes old active and unresolved financial observations without pulling settled historical orders into the board', async () => {
    const old = { placedAt: stamp(60), createdAt: stamp(60), updatedAt: stamp(60) };
    await seed([
      order('paid-held', { ...old, status: 'awaiting_payment', payment: 'paid', paylink: { ...link, paidAt: stamp(59) } }),
      order('late-cancelled', { ...old, status: 'cancelled', paylink: { ...link, extraPayments: ['synthetic-late'] } }),
      order('extra-completed', { ...old, paylink: { ...link, extraPayments: ['synthetic-extra'] } }),
      order('persisted-review', { ...old, paylink: { ...link, flag: 'Paiement à vérifier — verify ownership' } }),
      order('old-ready', { ...old, status: 'ready', payment: 'paid' }),
      order('settled-completed', old),
      order('handled-transfer', { ...old, status: 'cancelled', interac: { reference: 'TRANSFER', amount: 11.5, recipient: 'restaurant@example.test', autoDeposit: true, lang: 'en', createdAt: stamp(60), expiresAt: stamp(59), reminderMin: 0, answer: 'never-expose', lateTransfers: [{ at: stamp(59), by: 'Synthetic operator', refundedAt: stamp(58) }] } }),
    ]);
    const { body } = await read();
    expect(body.orders.map((row: DirectOrder) => row.id).sort()).toEqual(['extra-completed', 'late-cancelled', 'old-ready', 'paid-held', 'persisted-review']);
    expect(body.coverage).toMatchObject({ recentSince: since, partial: false });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('applies the selected brand before every recent/active/review limit', async () => {
    await seed([
      order('target-recent', { brandName: 'Target brand' }),
      order('target-old-active', { brandName: 'Target brand', status: 'ready', createdAt: stamp(60) }),
      order('target-old-review', { brandName: 'Target brand', status: 'cancelled', createdAt: stamp(60), paylink: { ...link, extraPayments: ['synthetic-extra'] } }),
      ...Array.from({ length: 1100 }, (_, index) => order(`other-brand-${index}`, { brandName: 'Other brand', createdAt: stamp(0), status: 'ready', attention: 'Other brand notice' })),
    ]);
    const { body } = await read('brand=Target%20brand');
    expect(body.orders.map((row: DirectOrder) => row.id).sort()).toEqual(['target-old-active', 'target-old-review', 'target-recent']);
    expect(body.coverage.partial).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Other brand notice');
  });
  it('restores the exact old attached courier and refuses a mismatched stored delivery reference', async () => {
    const old = { createdAt: stamp(40), placedAt: stamp(40), updatedAt: stamp(40), status: 'out_for_delivery' as const, fulfillment: 'delivery' as const };
    await seed([order('with-old-courier', { ...old, deliveryId: 'old-delivery' }), order('bad-reference', { ...old, deliveryId: 'foreign-delivery' }), order('bad-recent-reference', { ...old, createdAt: stamp(0), deliveryId: 'foreign-delivery' })]);
    const delivery = (id: string, orderId: string, name: string): Delivery => ({ id, orderId, fleet: 'own_fleet', environment: 'sandbox', status: 'assigned', tip: 0, orderValue: 11.5, containsAlcohol: false, requestedBy: 'Synthetic operator', timeline: [], createdAt: stamp(40), updatedAt: stamp(40), courier: { name, updatedAt: stamp(40) } });
    await getRepo().putDocs(DELIVERIES, [
      { id: 'old-delivery', key: 'with-old-courier', at: stamp(40), data: delivery('old-delivery', 'with-old-courier', 'Owned old courier') },
      { id: 'foreign-delivery', key: 'another-order', at: stamp(40), data: delivery('foreign-delivery', 'another-order', 'Foreign courier secret') },
    ]);
    const { body } = await read();
    expect(body.orders.find((row: DirectOrder) => row.id === 'with-old-courier').delivery.courier.name).toBe('Owned old courier');
    expect(body.orders.find((row: DirectOrder) => row.id === 'bad-reference').delivery).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Foreign courier secret');
    vi.stubEnv('FOODHUB_FEATURE_DELIVERY', 'on');
    const active = await (await activeGet(request(), {})).json();
    expect(active.items.find((row: DirectOrder) => row.id === 'bad-recent-reference').delivery).toBeNull();
    expect(JSON.stringify(active)).not.toContain('Foreign courier secret');
    const bad = (await getRepo().getDoc<DirectOrder>(DIRECT_ORDERS, 'bad-reference'))!.data;
    expect(await activeDelivery(bad)).toBeNull();
    const detail = await detailGet(request(), { params: Promise.resolve({ id: bad.id }) });
    const detailBody = await detail.json();
    expect(detail.status).toBe(200);
    expect(detailBody.running).toBeNull();
    expect(JSON.stringify(detailBody)).not.toContain('Foreign courier secret');
    const before = await getRepo().getDoc<Delivery>(DELIVERIES, 'foreign-delivery');
    const cancel = vi.spyOn(FLEETS.own_fleet, 'cancel');
    const refresh = vi.spyOn(FLEETS.own_fleet, 'get');
    expect((await cancelCourier(bad.id, { username: 'owner', name: 'Synthetic operator', source: 'api' }, 'Synthetic cancellation')).ok).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    const refreshed = await detailPost(new Request('http://hub.local/api/foodhub/delivery/bad-reference', { method: 'POST', headers: { ...Object.fromEntries(request().headers), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) }), { params: Promise.resolve({ id: bad.id }) });
    expect([200, 409]).toContain(refreshed.status);
    expect(refresh).not.toHaveBeenCalled();
    expect(await getRepo().getDoc<Delivery>(DELIVERIES, 'foreign-delivery')).toEqual(before);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  it('does not truncate a second chunk of exact attached deliveries', async () => {
    const orders = Array.from({ length: 501 }, (_, index) => order(`order-${index}`, { deliveryId: `delivery-${index}` }));
    await getRepo().putDocs(DELIVERIES, orders.map((row) => ({ id: row.deliveryId!, data: { id: row.deliveryId!, orderId: row.id } })));
    const found = await boardDeliveries(orders);
    expect(found.size).toBe(501);
    expect(found.get('order-500')?.id).toBe('delivery-500');
  });
  it('keeps actual SDK request targets within a conservative budget for long and reserved-character delivery IDs', async () => {
    const repo = getRepo();
    const orders = Array.from({ length: 501 }, (_, index) => order(`budget-order-${index}`, { deliveryId: `${index}-${'é(,test)'.repeat(20)}` }));
    await repo.putDocs(DELIVERIES, orders.map((row) => ({ id: row.deliveryId!, data: { id: row.deliveryId!, orderId: row.id } })));
    const original = repo.listDocs.bind(repo);
    const chunks: string[][] = [];
    vi.spyOn(repo, 'listDocs').mockImplementation(async <T>(collection: string, filter: DocFilter = {}) => {
      if (collection === DELIVERIES && filter.ids) chunks.push(filter.ids);
      return original<T>(collection, filter);
    });
    const found = await boardDeliveries(orders);
    expect(found.size).toBe(orders.length);
    expect(chunks.length).toBeGreaterThan(1);
    const client = createClient('http://127.0.0.1:1', 'synthetic-local-key', { auth: { persistSession: false, autoRefreshToken: false } });
    for (const ids of chunks) {
      expect(ids.length).toBeLessThanOrEqual(DIRECT_BOARD_DELIVERY_BATCH_LIMIT);
      const query = client.from('fh_docs').select('id,key,at,data').eq('collection', DELIVERIES).order('at', { ascending: false, nullsFirst: false }).order('id').range(0, ids.length - 1).in('id', ids);
      const url = (query as unknown as { url: URL }).url;
      expect(Buffer.byteLength(url.pathname + url.search)).toBeLessThan(4500);
    }
  });
  it('reports recent and active read limits instead of counting a partial board as complete', async () => {
    await seed(Array.from({ length: 1001 }, (_, index) => order(`recent-${index}`)));
    let board = await listDirectOrderBoard({ since, locationCodes: ['OWN'] });
    expect(board.orders).toHaveLength(1000);
    expect(board.coverage).toMatchObject({ recentLimitReached: true, partial: true });
    await seed(Array.from({ length: 1001 }, (_, index) => order(`old-held-${index}`, { status: 'awaiting_payment', createdAt: stamp(60), updatedAt: stamp(60) })));
    board = await listDirectOrderBoard({ since, locationCodes: ['OWN'] });
    expect(board.coverage.activeStatusesLimited).toEqual(['awaiting_payment']);
    expect(board.coverage.partial).toBe(true);
  });
  it('reports a clipped review scan even when none of the scanned historical flags remain unresolved', async () => {
    await seed(Array.from({ length: 5001 }, (_, index) => order(`history-${index}`, { createdAt: new Date(NOW - 60 * 86400000 - index * 1000).toISOString(), paylink: index === 5000 ? { ...link, extraPayments: ['outside-the-bounded-scan'] } : { ...link, flag: 'Historical non-review flag' } })));
    const board = await listDirectOrderBoard({ since, locationCodes: ['OWN'] });
    expect(board.orders).toEqual([]);
    expect(board.coverage).toMatchObject({ reviewScanLimit: 5000, reviewScanLimitReached: true, partial: true });
  });
  it('caps the final response and reports missing results even when each active-stage query is individually complete', async () => {
    await seed(['awaiting_payment', 'new', 'in_kitchen', 'ready', 'out_for_delivery'].flatMap((status) => Array.from({ length: 650 }, (_, index) => order(`${status}-${index}`, { status: status as DirectOrder['status'], createdAt: stamp(60), updatedAt: stamp(60) }))));
    const board = await listDirectOrderBoard({ since, locationCodes: ['OWN'] });
    expect(board.orders).toHaveLength(DIRECT_BOARD_RESULT_LIMIT);
    expect(board.coverage).toMatchObject({ activeStatusesLimited: [], recentLimitReached: false, reviewScanLimitReached: false, resultLimitReached: true, partial: true });
  });
  it('requires authentication for both normal and extended exception reads', async () => {
    expect((await GET(new Request('http://hub.local/api/foodhub/delivery?days=30'), {})).status).toBe(401);
  });
});
