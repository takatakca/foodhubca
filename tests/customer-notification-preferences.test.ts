import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertVerifiedCustomer, updateCustomer } from '../lib/foodhub/customers/store';
import { listOutbox, sendSms } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';

const PHONE = '+15145550101';
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC-local'); vi.stubEnv('TWILIO_AUTH_TOKEN', 'local-only'); vi.stubEnv('TWILIO_FROM', '+15145550199');
  fetcher.mockReset(); fetcher.mockResolvedValue(new Response(JSON.stringify({ sid: 'SM-local' }), { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function customer(orderUpdates: boolean, marketingConsent = false) {
  const { customer: c } = await upsertVerifiedCustomer({ phone: PHONE, tenant: 'on2go' });
  return updateCustomer(c.id, (current) => ({ ...current, marketingConsent, preferences: { orderUpdates, offersSms: false, offersEmail: false } }));
}
describe('customer order-update text choices', () => {
  it('suppresses confirmation/tracking without a provider call and records skipped instead of sent', async () => {
    await customer(false, true);
    for (const purpose of ['direct_order_confirmation', 'delivery_tracking']) {
      expect(await sendSms({ to: PHONE, body: 'Fictional order update' }, { purpose })).toMatchObject({ ok: true, skipped: true });
    }
    expect(fetcher).not.toHaveBeenCalled();
    const outbox = await listOutbox();
    expect(outbox).toHaveLength(2);
    expect(outbox.every((entry) => entry.skipped && entry.message.includes('disabled by the customer'))).toBe(true);
    expect(JSON.stringify(outbox)).not.toContain(PHONE);
  });
  it('honors operational opt-in separately from marketing consent and retains default guest behavior', async () => {
    await customer(true, false);
    expect(await sendSms({ to: PHONE, body: 'Fictional confirmation' }, { purpose: 'direct_order_confirmation' })).toMatchObject({ ok: true });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SM-guest' }), { status: 201 }));
    expect(await sendSms({ to: '+15145550102', body: 'Fictional guest update' }, { purpose: 'delivery_tracking' })).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not block sign-in or payment/security texts when optional progress updates are off', async () => {
    await customer(false);
    for (const purpose of ['sign_in', 'paylink_initial']) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SM-required' }), { status: 201 }));
      expect(await sendSms({ to: PHONE, body: 'Synthetic required message' }, { purpose, secret: true })).toMatchObject({ ok: true });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not send optional updates if durable preference lookup fails', async () => {
    const lookup = vi.spyOn(getRepo(), 'listDocs').mockRejectedValue(new Error('Synthetic database outage'));
    expect(await sendSms({ to: PHONE, body: 'Synthetic update' }, { purpose: 'delivery_tracking' })).toMatchObject({ ok: false, skipped: true });
    expect(fetcher).not.toHaveBeenCalled();
    lookup.mockRestore();
  });
});
