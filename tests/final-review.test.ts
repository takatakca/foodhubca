// Release 1.4.0 review follow-ups: the behaviours the adversarial review found untested.
import { beforeEach, describe, expect, it } from 'vitest';
import { basicOwner, clientIp, resetThrottle } from '../lib/foodhub/session';
import { acceptNeedsClover, allowedActions, applyExternalStatus, processIncomingOrder } from '../lib/foodhub/pipeline';
import { readPending } from '../lib/foodhub/courier';
import { getRepo } from '../lib/foodhub/repo';
import { autoCompleteBaseMs, autoCompleteOldOrders } from '../lib/foodhub/sync';
import { recordBackgroundFailure } from '../lib/foodhub/webhook-utils';
import type { NormalizedOrder, StoredOrder } from '../lib/foodhub/types';

const H = 3600_000;
const order = (over: Partial<StoredOrder> = {}): StoredOrder => ({
  id: 'o1', channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'ext-1', displayId: 'EXT1', channelStoreId: 's1', fulfillment: 'delivery',
  placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5, total: 11.5, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {},
  status: 'new', timeline: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
} as StoredOrder);
const incoming = (externalOrderId: string, over: Partial<NormalizedOrder> & { createdAt?: string } = {}): NormalizedOrder => ({
  channel: 'doordash', marketplace: 'doordash', externalOrderId, displayId: externalOrderId.toUpperCase(), channelStoreId: 'dd-unmapped', fulfillment: 'delivery',
  placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5, total: 11.5, deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, createdAt: new Date().toISOString(), ...over,
} as NormalizedOrder);

describe('sign-in gate follow-ups', () => {
  beforeEach(() => { resetThrottle(); process.env.DASHBOARD_PASSWORD = 'owner-pass-123'; });
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
  it('the owner password only counts under the owner username (or none), so rotating usernames cannot dodge the throttle', () => {
    expect(basicOwner(basic('owner', 'owner-pass-123'))).toBe(true);
    expect(basicOwner(basic('', 'owner-pass-123'))).toBe(true);
    expect(basicOwner(basic('alice', 'owner-pass-123'))).toBe(false);
    expect(basicOwner(basic('owner', 'nope'))).toBe(false);
  });
  it('x-forwarded-for is only honoured behind a trusted proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    delete process.env.FOODHUB_TRUST_PROXY; delete process.env.VERCEL;
    expect(clientIp(h)).toBe('local');
    process.env.FOODHUB_TRUST_PROXY = 'true';
    expect(clientIp(h)).toBe('203.0.113.9');
    delete process.env.FOODHUB_TRUST_PROXY; process.env.VERCEL = '1';
    expect(clientIp(h)).toBe('203.0.113.9');
    delete process.env.VERCEL;
  });
});

describe('never accept an order Clover did not receive', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env = { ...env }; delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_ACCESS_TOKEN; delete process.env.CLOVER_MERCHANT_TOKENS; delete process.env.FOODHUB_POS_INJECTION; });
  it('with Clover configured, a new order without a Clover copy only offers the explicit override', () => {
    process.env.CLOVER_MERCHANT_ID = 'M1'; process.env.CLOVER_ACCESS_TOKEN = 't';
    expect(acceptNeedsClover(order())).toBe(true);
    expect(allowedActions(order())).toContain('accept_no_pos');
    expect(allowedActions(order())).not.toContain('accept');
    expect(allowedActions(order({ posOrderId: 'CLV1' }))).toContain('accept');
  });
  it('without any Clover, plain accept is offered — unless this order\'s own injection failed', () => {
    expect(acceptNeedsClover(order())).toBe(false);
    expect(allowedActions(order())).toContain('accept');
    expect(acceptNeedsClover(order({ posError: 'No Clover API token for merchant M9' }))).toBe(true);
  });
  it('"Send to Clover" is never offered for orders on the Skip tablet, cancelled or done', () => {
    expect(allowedActions(order({ status: 'failed' }))).not.toContain('retry_pos');
    expect(allowedActions(order({ status: 'cancelled' }))).not.toContain('retry_pos');
    expect(allowedActions(order({ status: 'completed' }))).not.toContain('retry_pos');
    expect(allowedActions(order({ status: 'accepted' }))).toContain('retry_pos');
  });
});

describe('auto-complete respects scheduled orders and never sweeps ancient ones', () => {
  beforeEach(() => { process.env.FOODHUB_FORCE_MEMORY = 'true'; (globalThis as any).__foodhubMem = undefined; delete process.env.FOODHUB_AUTO_COMPLETE_MIN; });
  it('ages a scheduled order from its fire time, not its arrival', () => {
    const now = Date.now();
    const o = order({ createdAt: new Date(now - 5 * H).toISOString(), timeline: { fireAt: new Date(now - 1 * H).toISOString() } });
    expect(autoCompleteBaseMs(o)).toBe(now - 1 * H);
  });
  it('completes a 2-hour-old accepted order, keeps a waiting scheduled order and a 3-day-old one', async () => {
    const repo = getRepo();
    const now = Date.now();
    const mk = async (ext: string, createdAt: number, timeline: StoredOrder['timeline'] = {}) => {
      const { order: o } = await repo.insertOrderIfNew({ ...incoming(ext, { createdAt: new Date(createdAt).toISOString() }) });
      await repo.updateOrder(o.id, { status: 'accepted', timeline });
      return o.id;
    };
    const stale = await mk('stale', now - 2 * H);
    const scheduled = await mk('sched', now - 3 * H, { fireAt: new Date(now + 2 * H).toISOString(), scheduledFor: new Date(now + 2.5 * H).toISOString() });
    const ancient = await mk('ancient', now - 72 * H);
    expect(await autoCompleteOldOrders(now)).toBe(1);
    expect((await repo.getOrder(stale))?.status).toBe('completed');
    expect((await repo.getOrder(scheduled))?.status).toBe('accepted');
    expect((await repo.getOrder(ancient))?.status).toBe('accepted');
  });
});

describe('platform events that arrive before (or during) the order itself', () => {
  beforeEach(() => { process.env.FOODHUB_FORCE_MEMORY = 'true'; (globalThis as any).__foodhubMem = undefined; delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_ACCESS_TOKEN; });
  it('a cancel for an unknown order waits, then cancels the order on arrival without accepting it', async () => {
    expect(await applyExternalStatus('doordash', 'dd-early', 'cancelled', { event: 'order.cancel' })).toBeNull();
    expect((await readPending('doordash', 'dd-early'))?.status?.platformState).toBe('cancelled');
    const out = await processIncomingOrder(incoming('dd-early'));
    expect(out.order.status).toBe('cancelled');
    expect(out.accept).toBeUndefined();
    expect(await readPending('doordash', 'dd-early')).toBeNull(); // consumed
    const events = await getRepo().listEvents(out.order.id);
    expect(events.map((e) => e.type)).toContain('platform_status');
    expect(events.map((e) => e.type)).not.toContain('pos_injected');
  });
  it('a cancel that lands while the order is being processed is applied directly and marked consumed', async () => {
    const out = await processIncomingOrder(incoming('dd-late'));
    expect(out.order.status).not.toBe('cancelled');
    const after = await applyExternalStatus('doordash', 'dd-late', 'cancelled', { event: 'order.cancel' });
    expect(after?.status).toBe('cancelled');
  });
});

describe('deferred webhook work never fails silently', () => {
  beforeEach(() => { process.env.FOODHUB_FORCE_MEMORY = 'true'; (globalThis as any).__foodhubMem = undefined; });
  it('keeps the payload as an unparsed job and logs a failed activity entry', async () => {
    await recordBackgroundFailure('order doordash:dd-x', new Error('Clover timed out'), { channel: 'doordash', body: { id: 'dd-x' }, reference: 'dd-x', kind: 'order' });
    const repo = getRepo();
    const job = (await repo.listJobs(10)).find((j) => j.kind === 'webhook_unparsed');
    expect(job?.status).toBe('error');
    expect(job?.reference).toBe('dd-x');
    expect(String((job?.result as any)?.reason)).toMatch(/Clover timed out/);
    const activity = await repo.listActivity({ limit: 10 });
    expect(activity.some((a) => a.action === 'webhook_failed' && a.status === 'failed')).toBe(true);
  });
});
