// Financial crash/concurrency regressions: real direct orders/repository/payment consumers;
// only external Clover, printer and SMS boundaries are simulated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectOrder, PayLink } from '../lib/foodhub/delivery/types';
import type { HostedCheckoutRequest } from '../lib/foodhub/pos/clover-checkout';

const h = vi.hoisted(() => ({
  checkouts: [] as Array<{ merchant: string; body: HostedCheckoutRequest }>,
  rows: [] as Array<{ id: string; lineItems: { elements: Array<{ note: string }> }; payments: { elements: Array<{ id: string; result: string; amount: number }> } }>,
  texts: [] as Array<{ to: string; body: string }>,
  prints: [] as Array<{ orderId: string; merchantId?: string }>,
  providerUnreadable: false,
}));

vi.mock('../lib/foodhub/pos/clover-checkout', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover-checkout')>()),
  ecommConfigured: () => true,
  ecommKeyFor: () => 'fake-checkout-key',
  merchantQcTaxRates: async () => [{ id: 'GST', name: 'TPS', rate: 500_000 }, { id: 'QST', name: 'TVQ', rate: 997_500 }],
  createHostedCheckout: vi.fn(async (merchant: string, body: HostedCheckoutRequest) => {
    h.checkouts.push({ merchant, body });
    return { ok: true, sessionId: `SESSION-${h.checkouts.length}`, href: `https://checkout.example.test/${h.checkouts.length}`, expiresAt: Date.now() + 900_000 };
  }),
}));
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover')>()),
  cloverToken: async () => 'fake-rest-token',
  cloverAutoPrintEnabled: () => true,
}));
vi.mock('../lib/foodhub/pos/clover-order', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover-order')>()),
  printKitchenTicket: vi.fn(async (orderId: string, merchantId?: string) => { h.prints.push({ orderId, merchantId }); return { ok: true, message: 'Synthetic print confirmed' }; }),
}));
vi.mock('../lib/foodhub/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/notify')>()),
  smsConfigured: () => true,
  sendSms: vi.fn(async (input: { to: string; body: string }) => { h.texts.push(input); return { ok: true, channel: 'sms', message: 'Synthetic text confirmed' }; }),
  postToChat: vi.fn(async () => ({ ok: true, channel: 'chat', message: 'Synthetic team notification' })),
}));

import { createDirectOrder } from '../lib/foodhub/delivery/orders';
import { cancelHeldOrder, checkPayLink, openPayLink, payAtCounter, releasePaidOrder, startPayLink, tickPaylinks } from '../lib/foodhub/delivery/paylink';
import { DIRECT_ORDERS, getDirectOrder, nextOrderNumber, saveDirectOrder } from '../lib/foodhub/delivery/store';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { cloverSignatureHeader, hasMarker, payMarker } from '../lib/foodhub/pos/clover-checkout';
import { getRepo } from '../lib/foodhub/repo';
import { POST as hostedCheckoutWebhook } from '../app/api/foodhub/webhooks/clover-checkout/route';

const NOW = Date.parse('2026-11-04T18:00:00Z');
const MID = 'LOCALMERCH01';
const actor = { username: 'test', name: 'Synthetic test', source: 'api' as const };

async function held(ref: string, phone = '+15145550101', locationCode = 'NDG_MAIN'): Promise<DirectOrder> {
  return createDirectOrder({
    source: 'website', sourceRef: ref, brandName: 'Pi Pita', locationCode, customer: { name: ref, phone, lang: 'en' },
    fulfillment: 'pickup', lines: [{ name: 'Pita', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }],
    totals: { subtotal: 10, tax: 1.5, total: 11.5 }, payment: 'paid', holdForPayment: true,
  }, actor);
}
function savedLink(o: DirectOrder, legacy = false): PayLink {
  return {
    token: `token-${o.id.replace(/[^A-Za-z0-9]/g, '')}`,
    merchantId: MID, marker: legacy ? `Réf. ${o.number}` : payMarker(o.number, o.id), lang: 'en',
    createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1_200_000).toISOString(), reminderMin: 0,
    sessions: [{ id: `SESSION-${o.id}`, href: `https://checkout.example.test/${o.id}`, createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 900_000).toISOString() }], expectedCents: 1150,
  };
}
async function attach(o: DirectOrder, legacy = false): Promise<DirectOrder> {
  const saved = await saveDirectOrder({ ...o, paylink: savedLink(o, legacy) });
  await getRepo().setKv(`paylink:${saved.paylink!.token}`, saved.id);
  return saved;
}
function providerPayment(marker: string, id = 'PAY-ONE', cloverOrderId = 'CLV-ONE') {
  h.rows = [{ id: cloverOrderId, lineItems: { elements: [{ note: marker }] }, payments: { elements: [{ id, result: 'SUCCESS', amount: 1150 }] } }];
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_PUBLIC_URL', 'https://hub.example.test');
  vi.stubEnv('CLOVER_BASE_URL', 'https://clover.example.test');
  vi.stubEnv('FOODHUB_PAYLINK_PRINT', 'on');
  vi.stubEnv('FOODHUB_CLOVER_NO_REGISTER', '');
  vi.stubEnv('TAKATAK_MEV_MODE', 'off');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  h.checkouts = []; h.rows = []; h.texts = []; h.prints = [];
  h.providerUnreadable = false;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname !== 'clover.example.test') throw new Error('Outbound call prohibited in financial tests');
    if (url.pathname.endsWith('/order_types')) return Response.json({ elements: [] });
    if (url.pathname.endsWith('/orders') && (!init.method || init.method === 'GET')) return h.providerUnreadable ? Response.json({ error: 'Synthetic provider status outage' }, { status: 503 }) : Response.json({ elements: h.rows });
    if (url.pathname.includes('/payments/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const row = h.rows.find((o) => o.payments.elements.some((p) => p.id === id));
      const payment = row?.payments.elements.find((p) => p.id === id);
      return payment ? Response.json({ ...payment, order: { id: row!.id } }) : Response.json({}, { status: 404 });
    }
    if (url.pathname.includes('/orders/') && init.method === 'POST') return Response.json({ id: url.pathname.split('/').at(-1) });
    throw new Error(`Unexpected mocked Clover request: ${init.method ?? 'GET'} ${url.pathname}`);
  }));
  await saveHours({ locations: { NDG_MAIN: allDayWeek(), SAINT_LEONARD: allDayWeek() }, brands: {}, holidays: [] });
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'financial-safety-fixture', brandName: 'Pi Pita', locationCode: 'NDG_MAIN', cloverMerchantId: MID, autoAccept: false, online: true, meta: {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('durable direct-order number allocation', () => {
  it('allocates unique numbers to concurrent callers and keeps their reservations durable', async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => nextOrderNumber('website')));
    expect(new Set(numbers).size).toBe(20);
    for (const number of numbers) expect(await getRepo().getKv(`direct_order_number:${number.slice(2)}`)).not.toBeNull();
    const later = await nextOrderNumber('website');
    expect(numbers).not.toContain(later);
  });
  it('does not reset the sequence to a reusable default when its read fails', async () => {
    const repo = getRepo(), read = repo.getKv.bind(repo);
    const fault = vi.spyOn(repo, 'getKv').mockImplementation((key) => key === 'direct_order_seq' ? Promise.reject(new Error('Synthetic sequence read outage')) : read(key));
    await expect(nextOrderNumber('website')).rejects.toThrow();
    fault.mockRestore();
    expect(await nextOrderNumber('website')).toBe('W-1001');
  });
  it('retains an uncertain reservation after a sequence write fails and never issues it again', async () => {
    const repo = getRepo(), write = repo.setKv.bind(repo);
    const fault = vi.spyOn(repo, 'setKv').mockImplementation((key, value) => key === 'direct_order_seq' ? Promise.reject(new Error('Synthetic sequence write outage')) : write(key, value));
    await expect(nextOrderNumber('website')).rejects.toThrow();
    fault.mockRestore();
    expect(await repo.getKv('direct_order_number:1001')).not.toBeNull();
    expect(await nextOrderNumber('website')).toBe('W-1002');
  });
  it('does not reuse a legacy order number when a pre-upgrade sequence is behind its saved orders', async () => {
    const original = await held('legacy-number');
    await getRepo().setKv('direct_order_seq', 1000);
    await getRepo().releaseKv('direct_order_number:1001'); // old releases did not reserve numbers atomically.
    const next = await nextOrderNumber('website');
    expect(next).not.toBe(original.number);
    expect(next).toBe('W-1002');
  });
});

describe('order-bound payment identity and durable ownership', () => {
  it('uses the immutable order identity in new stored links and actual Clover checkout notes', async () => {
    const a = await held('customer-a'), b = await held('customer-b', '+15145550102');
    const collision = await saveDirectOrder({ ...b, number: a.number });
    const aa = await startPayLink(a, { lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    const bb = await startPayLink(collision, { lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    if (!aa.ok || !bb.ok) throw new Error('Expected usable local payment links');
    expect(aa.order.paylink!.marker).not.toBe(bb.order.paylink!.marker);
    expect(h.checkouts[0].body.shoppingCart.lineItems[0].note).toContain(aa.order.paylink!.marker);
    expect(h.checkouts[1].body.shoppingCart.lineItems[0].note).toContain(bb.order.paylink!.marker);
    expect(hasMarker(h.checkouts[0].body.shoppingCart.lineItems[0].note!, `Réf. ${a.number}`)).toBe(false);
    expect(payMarker(a.number, a.id)).toBe(payMarker('W-9999', a.id));
  });
  it('leaves both legacy duplicate-marker customer orders unpaid for manual review', async () => {
    const a = await attach(await held('legacy-a'), true);
    const rawB = await held('legacy-b', '+15145550102');
    const b = await attach(await saveDirectOrder({ ...rawB, number: a.number }), true);
    providerPayment(a.paylink!.marker);
    await checkPayLink(a.id, 'poller', NOW);
    await checkPayLink(b.id, 'poller', NOW);
    for (const id of [a.id, b.id]) {
      const stored = (await getDirectOrder(id))!;
      expect(stored.status).toBe('awaiting_payment');
      expect(stored.payment).toBe('unpaid');
      expect(stored.paylink!.paymentId).toBeUndefined();
      expect(stored.attention).toBeTruthy();
    }
    expect(h.prints).toHaveLength(0); expect(h.texts).toHaveLength(0);
  });
  it('still releases a unique stored legacy marker from the actual Clover poller response', async () => {
    const o = await attach(await held('unique-legacy'), true);
    providerPayment(o.paylink!.marker);
    expect((await checkPayLink(o.id, 'poller', NOW)).state).toBe('paid');
    const stored = (await getDirectOrder(o.id))!;
    expect(stored.payment).toBe('paid');
    expect(stored.paylink!.marker).toBe(o.paylink!.marker);
    expect(h.prints).toHaveLength(1);
  });
  it('keeps a unique legacy link usable when the same human number exists under another merchant or a new ID marker', async () => {
    const a = await attach(await held('unique-legacy-owner'), true);
    const otherMerchantRaw = await held('other-merchant-number', '+15145550102');
    const otherMerchant = await attach(await saveDirectOrder({ ...otherMerchantRaw, number: a.number }), true);
    await saveDirectOrder({ ...otherMerchant, paylink: { ...otherMerchant.paylink!, merchantId: 'OTHERMERCH02' } });
    const newIdentityRaw = await held('new-identity-number', '+15145550103');
    const newIdentity = await attach(await saveDirectOrder({ ...newIdentityRaw, number: a.number }));
    providerPayment(a.paylink!.marker);
    expect((await checkPayLink(a.id, 'poller', NOW)).state).toBe('paid');
    expect((await getDirectOrder(otherMerchant.id))!.payment).toBe('unpaid');
    expect((await getDirectOrder(newIdentity.id))!.payment).toBe('unpaid');
    expect(h.prints).toHaveLength(1);
  });
  it('finds relevant legacy collisions before limiting the lookup, despite several newer unrelated merchants', async () => {
    const rawA = await held('old-group-a');
    const a = await attach(await saveDirectOrder({ ...rawA, createdAt: new Date(NOW - 3_600_000).toISOString() }), true);
    const rawB = await held('old-group-b', '+15145550102');
    const b = await attach(await saveDirectOrder({ ...rawB, number: a.number, createdAt: new Date(NOW - 3_600_000).toISOString() }), true);
    for (let n = 0; n < 3; n++) {
      const raw = await held(`unrelated-merchant-${n}`, `+1514555011${n}`);
      const other = await attach(await saveDirectOrder({ ...raw, number: a.number }), true);
      await saveDirectOrder({ ...other, paylink: { ...other.paylink!, merchantId: `UNRELATED-${n}` } });
    }
    providerPayment(a.paylink!.marker);
    await checkPayLink(a.id, 'poller', NOW);
    await checkPayLink(b.id, 'poller', NOW);
    for (const id of [a.id, b.id]) {
      const stored = (await getDirectOrder(id))!;
      expect(stored.payment).toBe('unpaid');
      expect(stored.status).toBe('awaiting_payment');
      expect(stored.attention).toBeTruthy();
    }
    expect(h.prints).toHaveLength(0);
  });
  it('preserves the marker of an existing legacy link when opening a fresh Clover session', async () => {
    const o = await attach(await held('refresh-legacy'), true);
    const oldSession = { ...o.paylink!.sessions[0], createdAt: new Date(NOW - 14 * 60_000).toISOString() };
    const stored = await saveDirectOrder({ ...o, paylink: { ...o.paylink!, sessions: [oldSession] } });
    expect((await openPayLink(stored.paylink!.token, NOW)).ok).toBe(true);
    expect(h.checkouts).toHaveLength(1);
    expect(h.checkouts[0].body.shoppingCart.lineItems[0].note).toBe(stored.paylink!.marker);
  });
  it('does not let one successful Clover payment release a different customer order', async () => {
    const a = await attach(await held('owner-a')), b = await attach(await held('owner-b', '+15145550102'));
    const ev = { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' as const };
    expect((await releasePaidOrder(a.id, ev, NOW)).state).toBe('released');
    await releasePaidOrder(b.id, ev, NOW);
    expect((await getDirectOrder(a.id))!.payment).toBe('paid');
    const other = (await getDirectOrder(b.id))!;
    expect(other.payment).toBe('unpaid'); expect(other.status).toBe('awaiting_payment'); expect(other.attention).toBeTruthy();
    expect(h.prints).toHaveLength(1);
  });
  it('does not adopt another order’s payment from customer notes containing its marker', async () => {
    const a = await attach(await held('noted-a')), b = await attach(await held('noted-b', '+15145550102'));
    h.rows = [{
      id: 'CLV-ONE',
      lineItems: { elements: [{ note: `${b.paylink!.marker} · Note: please write ${a.paylink!.marker}` }, { note: `Note: ${a.paylink!.marker}` }] },
      payments: { elements: [{ id: 'PAY-ONE', result: 'SUCCESS', amount: 1150 }] },
    }];
    await checkPayLink(a.id, 'poller', NOW);
    expect((await getDirectOrder(a.id))!.payment).toBe('unpaid');
    expect(h.prints).toHaveLength(0);
    expect((await checkPayLink(b.id, 'poller', NOW)).state).toBe('paid');
    expect((await getDirectOrder(a.id))!.payment).toBe('unpaid');
    expect(h.prints).toHaveLength(1);
  });
  it('still finds a valid producer marker when Clover returns that item after another line', async () => {
    const o = await attach(await held('reordered-lines'));
    h.rows = [{
      id: 'CLV-ONE', lineItems: { elements: [{ note: 'Note: no onions' }, { note: `${o.paylink!.marker} · Sauce BBQ` }] },
      payments: { elements: [{ id: 'PAY-ONE', result: 'SUCCESS', amount: 1150 }] },
    }];
    expect((await checkPayLink(o.id, 'poller', NOW)).state).toBe('paid');
    expect((await getDirectOrder(o.id))!.paylink!.paymentId).toBe('PAY-ONE');
    expect(h.prints).toHaveLength(1);
  });
  it('processes actual signed approval HTTP events with the same payment ID independently for two merchants', async () => {
    const otherMid = 'OTHERMERCH02';
    const secret = 'synthetic-hco-signing-secret';
    vi.stubEnv('CLOVER_HCO_WEBHOOK_SECRET', secret);
    vi.stubEnv('CLOVER_ECOMM_KEYS', JSON.stringify({ [MID]: 'fake-key-a', [otherMid]: 'fake-key-b' }));
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'financial-safety-other', brandName: 'Pi Pita', locationCode: 'SAINT_LEONARD', cloverMerchantId: otherMid, autoAccept: false, online: true, meta: {} });
    const a = await held('http-a'), b = await held('http-b', '+15145550102', 'SAINT_LEONARD');
    const aa = await startPayLink(a, { lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    const bb = await startPayLink(b, { lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    if (!aa.ok || !bb.ok) throw new Error('Expected two synthetic merchant checkout sessions');
    const event = (sessionId: string, merchantId: string) => {
      const raw = JSON.stringify({ type: 'PAYMENT', status: 'APPROVED', id: 'PAY-ONE', merchantId, data: sessionId });
      return new Request('https://hub.example.test/api/foodhub/webhooks/clover-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Clover-Signature': cloverSignatureHeader(raw, secret) }, body: raw });
    };
    providerPayment(aa.order.paylink!.marker);
    const first = await hostedCheckoutWebhook(event(aa.order.paylink!.sessions[0].id, MID));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ state: 'released' });
    const second = await hostedCheckoutWebhook(event(bb.order.paylink!.sessions[0].id, otherMid));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ state: 'released' });
    expect((await getDirectOrder(a.id))!.payment).toBe('paid');
    expect((await getDirectOrder(b.id))!.payment).toBe('paid');
    expect(h.prints.map((print) => print.merchantId).sort()).toEqual([MID, otherMid].sort());
    const replay = await hostedCheckoutWebhook(event(aa.order.paylink!.sessions[0].id, MID));
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(h.prints).toHaveLength(2);
  });
  it('keeps ownership scoped to the known merchant when two merchants use the same Clover payment identifier', async () => {
    const a = await attach(await held('merchant-a'));
    const originalB = await attach(await held('merchant-b', '+15145550102'));
    const b = await saveDirectOrder({ ...originalB, paylink: { ...originalB.paylink!, merchantId: 'OTHERMERCH02' } });
    const ev = { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' as const };
    expect((await releasePaidOrder(a.id, ev, NOW)).state).toBe('released');
    expect((await releasePaidOrder(b.id, ev, NOW)).state).toBe('released');
    expect((await getDirectOrder(a.id))!.payment).toBe('paid');
    expect((await getDirectOrder(b.id))!.payment).toBe('paid');
    expect(h.prints.map((print) => print.merchantId).sort()).toEqual([MID, 'OTHERMERCH02'].sort());
  });
  it('does not assign an older existing owner’s payment when several unrelated newer Clover references mask it', async () => {
    const rawOwner = await attach(await held('historical-owner'));
    const owner = await saveDirectOrder({ ...rawOwner, createdAt: new Date(NOW - 3_600_000).toISOString(), status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-ONE', posMerchantId: MID, paylink: { ...rawOwner.paylink!, paymentId: 'PAY-ONE', paidAt: new Date(NOW - 3_600_000).toISOString(), releasedAt: new Date(NOW - 3_600_000).toISOString(), cloverOrderId: 'CLV-ONE' } });
    for (let n = 0; n < 3; n++) {
      const other = await attach(await held(`other-payment-merchant-${n}`, `+1514555011${n}`));
      const merchantId = `OTHER-MERCHANT-${n}`;
      await saveDirectOrder({ ...other, status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-ONE', posMerchantId: merchantId, paylink: { ...other.paylink!, merchantId, paymentId: `PAY-OTHER-${n}`, paidAt: new Date(NOW).toISOString(), releasedAt: new Date(NOW).toISOString(), cloverOrderId: 'CLV-ONE' } });
    }
    const target = await attach(await held('not-the-payment-owner', '+15145550109'));
    await releasePaidOrder(target.id, { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' }, NOW);
    expect((await getDirectOrder(target.id))!.payment).toBe('unpaid');
    expect((await getDirectOrder(target.id))!.attention).toBeTruthy();
    expect((await getDirectOrder(owner.id))!.paylink!.paymentId).toBe('PAY-ONE');
    expect(h.prints).toHaveLength(0);
  });
  it('holds an incomplete Clover-reference sample even when it includes this paid order and a known other merchant', async () => {
    const original = await attach(await held('current-reference-owner'));
    const at = new Date(NOW - 180_001).toISOString();
    await saveDirectOrder({ ...original, payment: 'paid', posOrderId: 'CLV-ONE', posMerchantId: MID, paylink: { ...original.paylink!, paymentId: 'PAY-ONE', paidAt: at, paidCents: 1150, cloverOrderId: 'CLV-ONE', releaseClaim: 'old-release', releaseClaimAt: at } });
    const known = await attach(await held('known-other-reference', '+15145550102'));
    await saveDirectOrder({ ...known, createdAt: new Date(NOW - 1000).toISOString(), status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-ONE', posMerchantId: 'OTHERMERCH02', paylink: { ...known.paylink!, merchantId: 'OTHERMERCH02', paymentId: 'PAY-OTHER', paidAt: at, releasedAt: at, cloverOrderId: 'CLV-ONE' } });
    const unknown = await held('old-unknown-reference', '+15145550103');
    await saveDirectOrder({ ...unknown, createdAt: new Date(NOW - 3_600_000).toISOString(), status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-ONE' });
    const result = await releasePaidOrder(original.id, { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' }, NOW);
    expect(result.state).toBe('review');
    const stored = (await getDirectOrder(original.id))!;
    expect(stored.status).toBe('awaiting_payment');
    expect(stored.paylink!.paymentId).toBe('PAY-ONE');
    expect(stored.attention).toBeTruthy();
    expect(h.prints).toHaveLength(0);
  });
  it('establishes ownership even when the first replay is an already-released pre-upgrade order', async () => {
    const a = await attach(await held('already-owner-a')), b = await attach(await held('already-owner-b', '+15145550102'));
    await saveDirectOrder({ ...a, status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-ONE', paylink: { ...a.paylink!, paymentId: 'PAY-ONE', paidAt: new Date(NOW - 60_000).toISOString(), releasedAt: new Date(NOW - 60_000).toISOString(), cloverOrderId: 'CLV-ONE' } });
    const ev = { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' as const };
    expect((await releasePaidOrder(a.id, ev, NOW)).state).toBe('already');
    await releasePaidOrder(b.id, ev, NOW);
    expect((await getDirectOrder(b.id))!.payment).toBe('unpaid');
    expect((await getDirectOrder(b.id))!.attention).toBeTruthy();
    expect(h.prints).toHaveLength(0);
  });
  it('fails closed without printing when the durable payment-ownership claim is unavailable', async () => {
    const o = await attach(await held('claim-outage'));
    const repo = getRepo(), claim = repo.claimKv.bind(repo);
    const fault = vi.spyOn(repo, 'claimKv').mockImplementation((key, value) => key.startsWith('paylink_payment:') ? Promise.reject(new Error('Synthetic ownership store outage')) : claim(key, value));
    await releasePaidOrder(o.id, { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' }, NOW).catch(() => undefined);
    fault.mockRestore();
    expect((await getDirectOrder(o.id))!.payment).toBe('unpaid');
    expect((await getDirectOrder(o.id))!.status).toBe('awaiting_payment');
    expect(h.prints).toHaveLength(0);
  });
  it('retains ownership and pauses the interrupted original order for review without transferring its payment', async () => {
    const a = await attach(await held('crash-owner-a')), b = await attach(await held('crash-owner-b', '+15145550102'));
    const repo = getRepo(), put = repo.putDocs.bind(repo);
    const claims = vi.spyOn(repo, 'claimKv');
    let crashed = false;
    const fault = vi.spyOn(repo, 'putDocs').mockImplementation(async (collection, docs) => {
      if (!crashed && collection === DIRECT_ORDERS && docs.some((doc) => doc.id === a.id && (doc.data as DirectOrder).payment === 'paid')) { crashed = true; throw new Error('Synthetic crash before paid-state commit'); }
      return put(collection, docs);
    });
    const ev = { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'webhook' as const };
    await expect(releasePaidOrder(a.id, ev, NOW)).rejects.toThrow('Synthetic crash');
    fault.mockRestore();
    await releasePaidOrder(b.id, ev, NOW + 180_001);
    expect((await getDirectOrder(b.id))!.payment).toBe('unpaid');
    await releasePaidOrder(a.id, ev, NOW + 180_001);
    const original = (await getDirectOrder(a.id))!;
    expect(original.status).toBe('awaiting_payment');
    expect(original.payment).toBe('unpaid');
    expect(original.attention).toBeTruthy();
    const ownerKey = claims.mock.calls.find(([key]) => key.startsWith('paylink_payment:'))?.[0];
    expect(ownerKey).toBeTruthy();
    expect(await repo.getKv(ownerKey!)).toMatchObject({ orderId: a.id, merchantId: MID, paymentId: ev.paymentId });
    expect(h.prints).toHaveLength(0);
  });
});

describe('paid interruption and print evidence', () => {
  it('preserves the first paid evidence when a different charge arrives during an interrupted release', async () => {
    const o = await attach(await held('partial-first-payment'));
    const firstPaidAt = new Date(NOW - 180_001).toISOString();
    await saveDirectOrder({ ...o, payment: 'paid', posOrderId: 'CLV-FIRST', posMerchantId: MID, paylink: { ...o.paylink!, paymentId: 'PAY-FIRST', paidAt: firstPaidAt, paidCents: 1150, cloverOrderId: 'CLV-FIRST', releaseClaim: 'old-release', releaseClaimAt: firstPaidAt } });
    const result = await releasePaidOrder(o.id, { paymentId: 'PAY-SECOND', cloverOrderId: 'CLV-SECOND', amountCents: 1150, via: 'webhook' }, NOW);
    expect(['extra', 'review']).toContain(result.state);
    const stored = (await getDirectOrder(o.id))!;
    expect(stored.status).toBe('awaiting_payment');
    expect(stored.payment).toBe('paid');
    expect(stored.posOrderId).toBe('CLV-FIRST');
    expect(stored.paylink!.paymentId).toBe('PAY-FIRST');
    expect(stored.paylink!.paidAt).toBe(firstPaidAt);
    expect(stored.paylink!.cloverOrderId).toBe('CLV-FIRST');
    expect(stored.attention).toBeTruthy();
    expect(h.prints).toHaveLength(0);
  });
  it.each([
    { label: 'held paidAt-only evidence', status: 'awaiting_payment' as const, payment: 'unpaid' as const, paidAt: new Date(NOW - 180_001).toISOString() },
    { label: 'already-released paid state', status: 'in_kitchen' as const, payment: 'paid' as const, paidAt: undefined },
  ])('holds $label without an initial payment ID instead of adopting a newly incoming payment', async ({ label, status, payment, paidAt }) => {
    const o = await attach(await held(label));
    await saveDirectOrder({ ...o, status, payment, paylink: { ...o.paylink!, ...(paidAt ? { paidAt } : {}), ...(status === 'in_kitchen' ? { releasedAt: new Date(NOW - 60_000).toISOString() } : {}) } });
    const result = await releasePaidOrder(o.id, { paymentId: 'PAY-NEW', cloverOrderId: 'CLV-NEW', amountCents: 1150, via: 'webhook' }, NOW);
    expect(result.state).toBe('review');
    const stored = (await getDirectOrder(o.id))!;
    expect(stored.status).toBe(status);
    expect(stored.payment).toBe(payment);
    expect(stored.paylink!.paymentId).toBeUndefined();
    expect(stored.posOrderId).toBeUndefined();
    expect(stored.attention).toBeTruthy();
    expect(h.prints).toHaveLength(0);
  });
  it.each(['payment', 'paidAt', 'paymentId'] as const)('never cancels or sends a nothing-charged text with saved %s evidence', async (kind) => {
    const o = await attach(await held(`paid-${kind}`));
    const saved = await saveDirectOrder({
      ...o, ...(kind === 'payment' ? { payment: 'paid' as const } : {}),
      paylink: { ...o.paylink!, ...(kind === 'paidAt' ? { paidAt: new Date(NOW - 180_001).toISOString() } : {}), ...(kind === 'paymentId' ? { paymentId: 'PAY-ONE' } : {}), releaseClaim: 'interrupted', releaseClaimAt: new Date(NOW - 180_001).toISOString() },
    });
    const after = await cancelHeldOrder(saved.id, 'Expired after interruption');
    expect(after.status).not.toBe('cancelled');
    if (after.status !== 'in_kitchen') expect(after.attention).toBeTruthy();
    expect(h.texts.some((text) => /nothing was charged|aucun montant|no se le cobr/i.test(text.body))).toBe(false);
  });
  it('does not blindly reprint an uncertain claim or silently call it healthy after recovery', async () => {
    const o = await attach(await held('uncertain-print'));
    await saveDirectOrder({ ...o, payment: 'paid', posOrderId: 'CLV-ONE', paylink: { ...o.paylink!, paymentId: 'PAY-ONE', paidAt: new Date(NOW - 180_001).toISOString(), cloverOrderId: 'CLV-ONE', printClaimAt: new Date(NOW - 180_001).toISOString(), releaseClaim: 'interrupted', releaseClaimAt: new Date(NOW - 180_001).toISOString() } });
    await releasePaidOrder(o.id, { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'poller' }, NOW);
    const stored = (await getDirectOrder(o.id))!;
    expect(h.prints).toHaveLength(0);
    expect(stored.paylink!.printedAt).toBeUndefined();
    expect(stored.attention).toMatch(/imprim|print|billet|ticket/i);
    expect(stored.paylink!.flag || stored.paylink!.printError).toBeTruthy();
  });
  it('retains confirmed print evidence without printing or flagging a duplicate', async () => {
    const o = await attach(await held('confirmed-print'));
    const printedAt = new Date(NOW - 180_001).toISOString();
    await saveDirectOrder({ ...o, payment: 'paid', posOrderId: 'CLV-ONE', paylink: { ...o.paylink!, paymentId: 'PAY-ONE', paidAt: printedAt, cloverOrderId: 'CLV-ONE', printClaimAt: printedAt, printedAt, releaseClaim: 'interrupted', releaseClaimAt: printedAt } });
    await releasePaidOrder(o.id, { paymentId: 'PAY-ONE', cloverOrderId: 'CLV-ONE', amountCents: 1150, via: 'poller' }, NOW);
    const stored = (await getDirectOrder(o.id))!;
    expect(stored.status).toBe('in_kitchen');
    expect(stored.paylink!.printedAt).toBe(printedAt);
    expect(stored.attention).toBeUndefined(); expect(h.prints).toHaveLength(0);
  });
});

describe('unverified and partial payment status', () => {
  it('holds an expired order for persistent review when the provider cannot be read, without a cancellation text', async () => {
    const o = await attach(await held('unknown-at-expiry'));
    h.providerUnreadable = true;
    const result = await tickPaylinks(NOW + 21 * 60_000);
    const stored = (await getDirectOrder(o.id))!;
    expect(result.cancelled).toBe(0);
    expect(stored.status).toBe('awaiting_payment');
    expect(stored.payment).toBe('unpaid');
    expect(stored.attention).toBeTruthy();
    expect(stored.paylink!.flag).toBeTruthy();
    await tickPaylinks(NOW + 22 * 60_000);
    expect((await getDirectOrder(o.id))!.status).toBe('awaiting_payment');
    expect(h.texts).toHaveLength(0); expect(h.prints).toHaveLength(0);
  });
  it('cancels confirmed-empty expired orders with neutral verification copy, without promising no charge', async () => {
    const o = await attach(await held('empty-at-expiry'));
    const result = await tickPaylinks(NOW + 21 * 60_000);
    expect(result.cancelled).toBe(1);
    expect((await getDirectOrder(o.id))!.status).toBe('cancelled');
    expect(h.texts).toHaveLength(1);
    expect(h.texts[0].body).toMatch(/contact the restaurant to verify/i);
    expect(h.texts[0].body).not.toMatch(/nothing was charged|no charge|aucun montant|no se le cobr/i);
    expect(h.prints).toHaveLength(0);
  });
  it('binds an underpayment to its original order and blocks another payment page or checkout session', async () => {
    const raw = await held('partial-payment-owner');
    const initial = await startPayLink(raw, { lang: 'en', expiryMin: 20, reminderMin: 0, notify: 'none' });
    if (!initial.ok) throw new Error(initial.error);
    const o = initial.order;
    providerPayment(o.paylink!.marker, 'PAY-PARTIAL', 'CLV-PARTIAL');
    h.rows[0].payments.elements[0].amount = 500;
    const claims = vi.spyOn(getRepo(), 'claimKv');
    expect((await checkPayLink(o.id, 'poller', NOW)).state).toBe('review');
    const stored = (await getDirectOrder(o.id))!;
    expect(stored.status).toBe('awaiting_payment'); expect(stored.payment).toBe('unpaid');
    expect(stored.attention).toBeTruthy();
    const claimKey = claims.mock.calls.find(([key]) => key.startsWith('paylink_payment:'))?.[0];
    expect(claimKey).toBeTruthy();
    expect(await getRepo().getKv(claimKey!)).toMatchObject({ orderId: o.id, merchantId: MID, paymentId: 'PAY-PARTIAL' });
    const before = h.checkouts.length;
    const opened = await openPayLink(o.paylink!.token, NOW);
    expect(opened.ok).toBe(false); expect(opened).not.toHaveProperty('href');
    expect(h.checkouts).toHaveLength(before);
    const other = await attach(await held('partial-payment-not-owner', '+15145550102'));
    await releasePaidOrder(other.id, { paymentId: 'PAY-PARTIAL', cloverOrderId: 'CLV-PARTIAL', amountCents: 500, via: 'webhook' }, NOW);
    expect((await getDirectOrder(other.id))!.payment).toBe('unpaid');
    expect(h.prints).toHaveLength(0); expect(h.texts).toHaveLength(0);
  });
  it('does not convert to pay-at-counter when the provider payment status is unknown', async () => {
    const o = await attach(await held('unknown-at-counter'));
    h.providerUnreadable = true;
    const after = await payAtCounter(o.id, actor);
    expect(after.status).toBe('awaiting_payment');
    expect(after.payment).toBe('unpaid');
    expect(after.attention).toBeTruthy();
    expect(after.posOrderId).toBeUndefined();
    expect(h.prints).toHaveLength(0); expect(h.texts).toHaveLength(0);
  });
  it('does not return a payment href or create a checkout while provider status is unknown', async () => {
    const o = await attach(await held('unknown-open-payment'));
    h.providerUnreadable = true;
    const opened = await openPayLink(o.paylink!.token, NOW);
    expect(opened.ok).toBe(false); expect(opened).not.toHaveProperty('href');
    expect(h.checkouts).toHaveLength(0);
    expect((await getDirectOrder(o.id))!.status).toBe('awaiting_payment');
    expect((await getDirectOrder(o.id))!.payment).toBe('unpaid');
    expect(h.prints).toHaveLength(0); expect(h.texts).toHaveLength(0);
  });
});
