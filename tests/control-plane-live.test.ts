// Run only through scripts/verify-control-plane.mjs. The repository is real PostgreSQL/PostgREST;
// the receiver is an isolated HTTP wire stand-in. Actual V1 handlers are covered by control-plane.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredControlPlane } from '../lib/foodhub/control-plane/config';
import { CONTROL_PLANE_OUTBOX, observeOrders, tickControlPlane, type OutboxEntry } from '../lib/foodhub/control-plane/outbox';
import { controlPlaneStatus } from '../lib/foodhub/control-plane/status';
import { getRepo } from '../lib/foodhub/repo';
import { supabaseAdmin } from '../lib/supabase/server';
import type { NormalizedOrder } from '../lib/foodhub/types';

const enabled = process.env.FOODHUB_CONTROL_PLANE_PROOF === '1';
const base = Number(process.env.CONTROL_PLANE_PROOF_BASE);
const stage = process.env.CONTROL_PLANE_PROOF_STAGE;
const fixture = (externalOrderId: string, locationCode = 'TEST_KITCHEN'): NormalizedOrder & { locationCode: string } => ({
  channel: 'doordash', marketplace: 'doordash', externalOrderId, displayId: 'LOCAL DEMO', brandName: 'Synthetic kitchen', channelStoreId: 'fixture', locationCode,
  customerName: 'MUST NOT LEAVE FOODHUB', fulfillment: 'delivery', currency: 'CAD', placedAt: new Date(base).toISOString(), subtotal: 10, tax: 1, total: 11, deliveryFee: 0, tip: 0, discount: 0,
  lines: [{ name: 'MUST NOT LEAVE FOODHUB', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: { privatePhone: '+15145550101' },
});
const clock = (offset: number) => { vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(base + offset); };
const entries = async () => getRepo().listDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX);
afterEach(() => vi.useRealTimers());

describe.skipIf(!enabled)('isolated durable control-plane proof', () => {
  it('uses the actual persistent repository', () => { expect(getRepo().mode).toBe('supabase');expect(configuredControlPlane().config).not.toBeNull(); });
  it.skipIf(stage !== '1')('filters nested marker ownership before limit, and pages tied order timestamps through PostgREST', async () => {
    const repo = getRepo();
    await repo.putDocs('control_plane_filter_proof', Array.from({ length: 8 }, (_, i) => ({ id: `candidate-${i}`, at: new Date(base + i).toISOString(), data: {
      number: 'DEMO-123', paylink: { merchantId: i < 2 ? 'expected-merchant' : 'foreign-merchant', marker: 'same-marker', extra: 'allowed' },
    } })));
    const matches = await repo.listDocs('control_plane_filter_proof', { dataEquals: { number: 'DEMO-123', paylink: { merchantId: 'expected-merchant', marker: 'same-marker' } }, limit: 2 });
    expect(matches.map((d) => d.id).sort()).toEqual(['candidate-0', 'candidate-1']);
    expect(await repo.listDocs('control_plane_filter_proof', { dataEquals: { number: 'DEMO-123', paylink: { marker: 'same' } }, limit: 2 })).toHaveLength(0);
    clock(-20_000);
    const rows = await Promise.all([0, 1, 2].map(async (i) => (await repo.insertOrderIfNew(fixture(`cursor-${i}`, 'UNMAPPED'))).order));
    const stamp = new Date(base - 20_000).toISOString().replace(/\.\d{3}Z$/, '.123456Z');
    const response = await supabaseAdmin().from('fh_orders').update({ updated_at: stamp }).in('id', rows.map((o) => o.id));expect(response.error).toBeNull();
    const first = await repo.listChangedOrders({ since: new Date(base - 21_000).toISOString(), limit: 2 });expect(first).toHaveLength(2);
    const last = first.at(-1)!;
    const second = await repo.listChangedOrders({ since: new Date(base - 21_000).toISOString(), after: { at: last.updatedAt, id: last.id }, limit: 2 });expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((o) => o.id)).size).toBe(3);
    expect([...first, ...second].map((o) => o.id)).toEqual(rows.map((o) => o.id).sort());
  });
  it.skipIf(stage !== '1')('persists the immutable event and cursor after a lost HTTP acknowledgement', async () => {
    const repo = getRepo();clock(0);expect((await tickControlPlane(base)).queued).toBe(0);
    clock(1000);const order = (await repo.insertOrderIfNew(fixture('durable-order'))).order;
    // PostgreSQL's default clock is real; align only this synthetic row with the explicit scenario clock.
    const stamp = new Date(base + 1000).toISOString();
    const seeded = await supabaseAdmin().from('fh_orders').update({ created_at: stamp, updated_at: stamp }).eq('id', order.id);expect(seeded.error).toBeNull();
    await repo.setKv('control-plane:proof-order', order.id);
    expect((await tickControlPlane(base + 1000)).queued).toBe(1);
    clock(31_000);expect((await tickControlPlane(base + 31_000)).sent).toBe(0);
    const pending = await entries();expect(pending).toHaveLength(1);expect(pending[0].data).toMatchObject({ state: 'pending', attempts: 1 });
    const event = JSON.parse(pending[0].data.rawBody);expect(event.event_type).toBe('order.created');
    expect(pending[0].data.rawBody).not.toMatch(/MUST NOT|15145550101|subtotal|customer|privatePhone|payment/);
    await repo.setKv('control-plane:proof-first-body', pending[0].data.rawBody);
    clock(32_000);await repo.patchOrder(order.id, { printedAt: new Date(base + 32_000).toISOString() }, { status: 'ready' });
    expect((await repo.getOrder(order.id))?.status).toBe('ready');expect((await controlPlaneStatus()).pending).toBe(1);
  });
  it.skipIf(stage !== '2')('restarts with the same durable body and acknowledges the duplicate, then reports actual completion once', async () => {
    const repo = getRepo();const config = configuredControlPlane().config!;
    const firstBody = await repo.getKv<string>('control-plane:proof-first-body');expect(firstBody).toBeTruthy();
    const cursor = await repo.getKv<{ after: unknown }>(`control-plane:cursor:${config.fingerprint}`);expect(cursor?.after).toBeTruthy();
    expect((await entries())[0].data.rawBody).toBe(firstBody);
    clock(62_000);expect((await tickControlPlane(base + 62_000)).sent).toBe(1);
    expect((await entries())[0].data).toMatchObject({ state: 'sent', attempts: 2, rawBody: firstBody });
    const id = await repo.getKv<string>('control-plane:proof-order');expect(id).toBeTruthy();
    clock(63_000);await repo.patchOrder(id!, { completedAt: new Date(base + 63_000).toISOString() }, { status: 'completed' });
    expect((await tickControlPlane(base + 63_000)).queued).toBe(1);
    clock(94_000);expect((await tickControlPlane(base + 94_000)).sent).toBe(1);
    expect(await observeOrders(config, base + 95_000)).toMatchObject({ queued: 0 });
    const done = await entries();expect(done).toHaveLength(2);expect(done.every((d) => d.data.state === 'sent')).toBe(true);
    expect(new Set(done.map((d) => JSON.parse(d.data.rawBody).event_type))).toEqual(new Set(['order.created', 'order.fulfilled']));
    expect(await controlPlaneStatus()).toMatchObject({ durable: true, sent: 2, pending: 0, failed: 0 });
  });
});
