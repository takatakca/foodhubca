// Payment link options added for the ordering page: notify 'none' (the link opens in the customer's browser) texts
// nothing — no link, no reminder, no expiry text — and paylinkReadiness(…, { needSms: false }) skips only the texts
// check. The default (texted link) is unchanged. Clover (clover-checkout, clover-direct, REST token) and notify are
// mocked: nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sms: [] as Array<{ to: string; body: string }>, smsOn: false, sessions: 0 }));

vi.mock('../lib/foodhub/pos/clover-checkout', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover-checkout')>()),
  ecommConfigured: () => true,
  ecommKeyFor: () => 'ecomm-test-key',
  merchantQcTaxRates: async () => [{ id: 'TX1', name: 'TPS', rate: 500_000 }, { id: 'TX2', name: 'TVQ', rate: 997_500 }],
  createHostedCheckout: async () => { h.sessions++; return { ok: true, href: `https://checkout.example.test/s/${h.sessions}`, sessionId: `SESS${h.sessions}`, expiresAt: Date.now() + 15 * 60_000 }; },
  findPaidByMarker: async () => [],
  paymentWithOrder: async () => null,
  updateCloverOrder: async () => true,
}));
vi.mock('../lib/foodhub/delivery/clover-direct', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/delivery/clover-direct')>()),
  explicitMerchantFor: async () => 'MID-TEST',
  kitchenHasNoRegister: () => false,
  createDirectOrderInClover: async () => ({ ok: true, posOrderId: 'CLV-TEST', merchantId: 'MID-TEST' }),
}));
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({ ...(await orig<typeof import('../lib/foodhub/pos/clover')>()), cloverToken: async () => 'rest-test-token' }));
vi.mock('../lib/foodhub/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/notify')>()),
  smsConfigured: () => h.smsOn,
  sendSms: vi.fn(async (m: { to: string; body: string }) => { h.sms.push(m); return { ok: true, channel: 'sms', message: 'sent' }; }),
  postToChat: vi.fn(async () => ({ ok: true, channel: 'chat', message: 'ok' })),
}));

import { createDirectOrder } from '../lib/foodhub/delivery/orders';
import { paylinkReadiness, payLinkNotify, startPayLink, tickPaylinks } from '../lib/foodhub/delivery/paylink';
import { getDirectOrder } from '../lib/foodhub/delivery/store';

const actor = { username: 'storefront', name: 'Commander direct', source: 'api' as const };

async function held() {
  return createDirectOrder({
    source: 'website', sourceRef: 'sf_test', brandName: 'Pi Pita', locationCode: 'NDG_MAIN', customer: { name: 'Client', phone: '+15145550177', lang: 'fr' },
    fulfillment: 'pickup', lines: [{ name: 'Pita', quantity: 1, unitPrice: 20, total: 20, modifiers: [] }], payment: 'paid', holdForPayment: true,
  }, actor);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_PUBLIC_URL = 'https://hub.example.test';
  h.sms = []; h.smsOn = false; h.sessions = 0;
});

describe('paylinkReadiness needSms', () => {
  it('without texts: refused by default, ready with needSms false; every other check stays', async () => {
    expect(await paylinkReadiness('Pi Pita', 'NDG_MAIN')).toMatchObject({ ok: false, reason: expect.stringMatching(/Texts are not set up/) });
    expect(await paylinkReadiness('Pi Pita', 'NDG_MAIN', { needSms: false })).toEqual({ ok: true, merchantId: 'MID-TEST' });
    expect(await paylinkReadiness('Pi Pita', 'NDG_MAIN', { needSms: true })).toMatchObject({ ok: false });
    process.env.FOODHUB_PUBLIC_URL = 'http://localhost:3000';
    expect(await paylinkReadiness('Pi Pita', 'NDG_MAIN', { needSms: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/https/) });
  });
});

describe('startPayLink notify', () => {
  it("notify 'none': no text at all (link, reminder, expiry); event 'Payment link opened in the browser'", async () => {
    const o = await held();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 20, reminderMin: 10, notify: 'none' });
    if (!r.ok) throw new Error(r.error);
    expect(r.smsOk).toBe(false);
    expect(h.sms).toHaveLength(0);
    expect(payLinkNotify(r.order.paylink)).toBe('none');
    expect(r.order.paylink!.reminderMin).toBe(0);
    expect(r.order.events.map((e) => e.message)).toContain('Payment link opened in the browser');
    const t0 = Date.parse(r.order.paylink!.createdAt);
    h.smsOn = true;
    await tickPaylinks(t0 + 11 * 60_000); // would be the reminder
    expect(h.sms).toHaveLength(0);
    await tickPaylinks(t0 + 40 * 60_000); // expiry → cancelled, silently
    const after = (await getDirectOrder(o.id))!;
    expect(after.status).toBe('cancelled');
    expect(h.sms).toHaveLength(0);
  });

  it("default ('sms') is unchanged: the link is texted and the expiry text is sent", async () => {
    h.smsOn = true;
    const o = await held();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 20, reminderMin: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(payLinkNotify(r.order.paylink)).toBe('sms');
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].body).toContain('https://hub.example.test/p/');
    await tickPaylinks(Date.parse(r.order.paylink!.createdAt) + 40 * 60_000);
    expect((await getDirectOrder(o.id))!.status).toBe('cancelled');
    expect(h.sms.at(-1)!.body).toMatch(/a expiré/);
  });
});
