// Automatic "Send to Clover" when Clover did not take a new order (MASTER_PLAN Phase 1 item 6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const injectMock = vi.fn();
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover')>()),
  cloverInjectionEnabled: () => true,
  cloverExpected: () => true,
  allCloverMerchants: async () => ['M1'],
  injectOrder: (...args: unknown[]) => injectMock(...args),
  printCloverOrder: async () => ({ ok: true, message: 'printed' }),
}));

import { uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { MAX_POS_RETRIES, POS_RETRY_DELAYS_MS, posRetryDue, processIncomingOrder, retryFailedInjections } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';

const order = (id: string): NormalizedOrder => ({
  channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: id, channelStoreId: 'ue-1', fulfillment: 'delivery',
  placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5, deliveryFee: 0, tip: 0, discount: 0, total: 11.5,
  lines: [{ name: 'Poutine', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: {},
});
const fail = { ok: false, skipped: false, error: 'Clover HTTP 503' };

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  injectMock.mockReset();
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-1', brandName: 'Po Poulet', locationCode: 'NDG', cloverMerchantId: 'M1', autoAccept: true, online: true, meta: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('automatic Clover retry', () => {
  it('a failed injection is retried after 30 s, reaches Clover on the 2nd try, prints and auto-accepts', async () => {
    const accept = vi.spyOn(uberEatsAdapter, 'acceptOrder').mockResolvedValue({ channel: 'uber_eats', ok: true, status: 'done', message: 'OK' });
    injectMock.mockResolvedValueOnce(fail).mockResolvedValueOnce({ ok: true, posOrderId: 'CLV-9' });
    const { order: o, accept: first } = await processIncomingOrder(order('u-1'));
    expect(first).toBeUndefined(); // never accepted while Clover does not have it
    expect(o.timeline?.posRetryAt).toBeTruthy();
    const t0 = Date.parse(o.timeline!.posRetryAt!) - POS_RETRY_DELAYS_MS[0];

    expect(await retryFailedInjections(t0 + 10_000)).toBe(0); // not due yet
    expect(injectMock).toHaveBeenCalledTimes(1);
    expect(await retryFailedInjections(t0 + POS_RETRY_DELAYS_MS[0] + 1)).toBe(1);
    const after = (await getRepo().getOrder(o.id))!;
    expect(after).toMatchObject({ posOrderId: 'CLV-9', status: 'accepted' });
    expect(after.posError).toBeUndefined();
    expect(after.timeline).toMatchObject({ posRetries: 1, acceptedBy: 'auto' });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0][1]).toBe('CLV-9');
  });

  it('spaces the tries 30 s → 2 min → 5 min and stops after the last one', async () => {
    injectMock.mockResolvedValue(fail);
    const { order: o } = await processIncomingOrder(order('u-2'));
    let at = Date.parse(o.timeline!.posRetryAt!);
    for (let i = 1; i <= MAX_POS_RETRIES; i++) {
      await retryFailedInjections(at);
      const cur = (await getRepo().getOrder(o.id))!;
      expect(cur.timeline?.posRetries).toBe(i);
      if (i < MAX_POS_RETRIES) {
        expect(Date.parse(cur.timeline!.posRetryAt!) - at).toBe(POS_RETRY_DELAYS_MS[i]);
        at = Date.parse(cur.timeline!.posRetryAt!);
      } else {
        expect(cur.timeline?.posRetryAt).toBeUndefined();
      }
    }
    expect(injectMock).toHaveBeenCalledTimes(1 + MAX_POS_RETRIES);
    await retryFailedInjections(at + 3600_000);
    expect(injectMock).toHaveBeenCalledTimes(1 + MAX_POS_RETRIES); // no 4th automatic try
    const events = await getRepo().listEvents(o.id);
    expect(events.some((e) => e.type === 'needs_attention' && /automatic tries/.test(String((e.detail as { reason?: string })?.reason)))).toBe(true);
  });

  it('never retries a cancelled order, nor one accepted by hand without Clover', async () => {
    injectMock.mockResolvedValue(fail);
    const { order: a } = await processIncomingOrder(order('u-3'));
    await getRepo().updateOrder(a.id, { status: 'cancelled' });
    const { order: b } = await processIncomingOrder(order('u-4'));
    await getRepo().patchOrder(b.id, { acceptedBy: 'manager', acceptedAt: new Date().toISOString() }, { status: 'accepted' });
    const later = Date.parse(a.timeline!.posRetryAt!) + 60_000;
    expect(posRetryDue((await getRepo().getOrder(a.id))!, later)).toBe(false);
    expect(posRetryDue((await getRepo().getOrder(b.id))!, later)).toBe(false);
    await retryFailedInjections(later);
    expect(injectMock).toHaveBeenCalledTimes(2); // only the two arrivals
  });

  it('"Clover is not part of this deployment" (skipped) plans no retry', async () => {
    injectMock.mockResolvedValue({ ok: false, skipped: true, error: 'POS injection is turned off' });
    const { order: o } = await processIncomingOrder(order('u-5'));
    expect(o.timeline?.posRetryAt).toBeUndefined();
    expect(await retryFailedInjections(Date.now() + 3600_000)).toBe(0);
  });
});
