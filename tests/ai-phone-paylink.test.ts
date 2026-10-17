// AI phone go-live (task 34): the Clover payment link (held order released exactly once, expiry, extra payments), the
// Duo / Trio / Combo upsell with the Clover modifier refs, the Clover direct-order body (modifications, printer by
// kitchen, kitchens without a register), the Po Poulet lock (Saint-Léonard only), the AI circuit breaker, voicemail
// emails, the public address trim, and the call simulator / readiness list (nothing sent).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocation } from '../lib/foodhub/catalog';
import { publicBaseUrl } from '../lib/foodhub/config';
import { buildDirectCloverCart, createDirectOrderInClover, kitchenHasNoRegister } from '../lib/foodhub/delivery/clover-direct';
import { createDirectOrder } from '../lib/foodhub/delivery/orders';
import { cancelHeldOrder, payAtCounter, paylinkReadiness, payLinkState, startPayLink, tickPaylinks } from '../lib/foodhub/delivery/paylink';
import { getDirectOrder } from '../lib/foodhub/delivery/store';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import { setFeature } from '../lib/foodhub/expansion/features';
import { classifyAiError, noteAiFailure, phoneAiUsable, resetAiHealth } from '../lib/foodhub/phone/ai-health';
import { parseBrandPhones } from '../lib/foodhub/phone/brand-lines';
import { addToCart, addUpsell, buildPhoneMenu, cartToLines, upsellKind, upsellOffer } from '../lib/foodhub/phone/cart';
import { getCall } from '../lib/foodhub/phone/calls';
import { ivrStart } from '../lib/foodhub/phone/ivr/engine';
import { emailVoicemail } from '../lib/foodhub/phone/ivr/engine';
import { getIvrCall, newIvrCall, saveIvrCall } from '../lib/foodhub/phone/ivr/records';
import { DEFAULT_PAYMENT, brandLockedAt, savePhoneSettings } from '../lib/foodhub/phone/settings';
import { phonePaymentPlan } from '../lib/foodhub/phone/order';
import { phoneReadiness } from '../lib/foodhub/phone/readiness';
import { readTwiml, simulateCall } from '../lib/foodhub/phone/sim/driver';
import { simulateTurn } from '../lib/foodhub/phone/voice';
import { verifyTwilio } from '../lib/foodhub/phone/twilio';
import { buildCheckoutRequest, checkoutTotalCents, clearTaxCache, cloverSignatureHeader, hasMarker } from '../lib/foodhub/pos/clover-checkout';
import { hashPassword } from '../lib/foodhub/auth';
import { tickDispatch } from '../lib/foodhub/delivery/dispatch';
import { saveDeliverySettings, saveDirectOrder } from '../lib/foodhub/delivery/store';
import { saveHours } from '../lib/foodhub/hours';
import { placePhoneOrder } from '../lib/foodhub/phone/order';
import { languageChoice } from '../lib/foodhub/phone/voice';
import { POST as simRoute } from '../app/api/foodhub/phone/sim/route';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { POST as hcoWebhook } from '../app/api/foodhub/webhooks/clover-checkout/route';
import { GET as payPage, POST as payPost } from '../app/p/[token]/route';
import { claudeResponse, openAllDay, text, toolUse } from './helpers/phone-harness';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
const MID = 'MIDSL0000001';
const ENV_KEYS = ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_ECOMM_PRIVATE_KEY', 'CLOVER_ECOMM_KEYS', 'CLOVER_HCO_WEBHOOK_SECRET', 'CLOVER_BASE_URL', 'CLOVER_HCO_BASE_URL', 'FOODHUB_CLOVER_NO_REGISTER', 'CLOVER_PRINT_DEVICES', 'FOODHUB_POS_INJECTION', 'ALERT_WEBHOOK_URL', 'ANTHROPIC_API_KEY', 'FOODHUB_PHONE_TEST_CALLERS', 'FOODHUB_CLOVER_AUTOPRINT', 'FOODHUB_PAYLINK_PRINT', 'CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'PHONE_OWN_MERCHANTS'];

let sms: Array<{ to: string; body: string }> = [];
let chat: string[] = [];
let prints: Array<{ url: string; body: any }> = [];
let checkouts: any[] = [];
let atomic: any[] = [];
let claude: any[] = [];
let paidOrders: any[] = [];
let payAmount = 2300;
let checkoutFail = false;
let taxFail = false;
let orderLists = 0;

const UPSELL_MENU: MasterMenu = {
  brandName: 'Po Poulet', updatedAt: '', posMerchantId: MID,
  categories: [{ ref: 'c1', name: 'Chicken', nameFr: 'Poulet', sortOrder: 1 }],
  items: [
    { ref: 'i1', name: 'Quarter chicken', nameFr: 'Quart de poulet', price: 12.99, categoryRef: 'c1', available: true, posItemRef: 'CLVITEM1', modifierGroupRefs: ['gs', 'gd', 'gt', 'gc'] },
    { ref: 'i2', name: 'Salad', nameFr: 'Salade', price: 6, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'gs', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'ms', name: 'Gravy', nameFr: 'Sauce BBQ', price: 1, available: true }] },
    { ref: 'gd', name: 'Duo — Breuvage', min: 0, max: 1, modifiers: [{ ref: 'dp', name: 'Pepsi', price: 2.5, available: true, posModifierRef: 'CMOD-DUO-PEPSI' }, { ref: 'd7', name: '7UP', price: 2.5, available: true, posModifierRef: 'CMOD-DUO-7UP' }] },
    { ref: 'gt', name: 'Trio — Frite + Breuvage', min: 0, max: 1, modifiers: [{ ref: 'tp', name: 'Pepsi', price: 5.42, available: true, posModifierRef: 'CMOD-TRIO-PEPSI' }] },
    { ref: 'gc', name: 'Combo — Poutine classique + Breuvage', min: 0, max: 1, modifiers: [{ ref: 'cp', name: 'Pepsi', price: 7.58, available: true, posModifierRef: 'CMOD-COMBO-PEPSI' }] },
  ],
};

const SL_LINE = { number: '+14385550142', name: 'Po Poulet Saint-Léonard', locationCode: 'SAINT_LEONARD', brands: ['Po Poulet'], enabled: true, delivery: false };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__fhPayHits = undefined;
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    FOODHUB_PUBLIC_URL: 'https://hub.test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000',
    CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clv-token', CLOVER_BASE_URL: 'https://clover.test', CLOVER_HCO_BASE_URL: 'https://hco.test',
    CLOVER_ECOMM_PRIVATE_KEY: 'ecomm-key', CLOVER_HCO_WEBHOOK_SECRET: 'whsec-test', ALERT_WEBHOOK_URL: 'https://chat.test/hook', FOODHUB_CLOVER_RETRY_MS: '0',
  });
  sms = []; chat = []; prints = []; checkouts = []; atomic = []; claude = []; paidOrders = []; payAmount = 2300; checkoutFail = false; taxFail = false; orderLists = 0;
  clearTaxCache();
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : undefined;
    if (u.includes('/Messages.json')) { const p = new URLSearchParams(String(init.body)); sms.push({ to: p.get('To') ?? '', body: p.get('Body') ?? '' }); return json({ sid: 'SM1' }, 201); }
    if (u.startsWith('https://chat.test')) { chat.push(String(init.body)); return json({}); }
    if (u.includes('/v1/messages')) return json(claude.shift() ?? claudeResponse([text('Autre chose ?')]));
    if (u.includes('/tax_rates') && taxFail) return json({ elements: [{ id: 'TX9', name: 'Sales Tax', rate: 14975 }] });
    if (u.includes('/tax_rates')) return json({ elements: [{ id: 'TX1', name: 'TPS', rate: 500_000 }, { id: 'TX2', name: 'TVQ', rate: 997_500 }] });
    if (u.startsWith('https://hco.test/invoicingcheckoutservice/v1/checkouts') && checkoutFail) return json({ message: 'Internal error' }, 500);
    if (u.startsWith('https://hco.test/invoicingcheckoutservice/v1/checkouts')) { checkouts.push(body); return json({ href: `https://checkout.clover.test/s/${checkouts.length}`, checkoutSessionId: `SESS${checkouts.length}`, expirationTime: Date.now() + 15 * 60_000 }); }
    const pay = u.match(/\/payments\/([^/?]+)\?expand=order/);
    if (pay) return json({ id: pay[1], amount: payAmount, result: 'SUCCESS', order: { id: `CLV-${pay[1]}` } });
    if (u.includes('/order_types')) return json({ elements: [{ id: 'OT-PHONE', label: 'Téléphone' }, { id: 'OT-DD', label: 'DoorDash' }] });
    if (u.includes('/print_event')) { prints.push({ url: u, body }); return json({ id: `PE${prints.length}`, state: 'CREATED' }); }
    if (u.includes('/atomic_order/orders')) { atomic.push(body); return json({ id: `ATOM${atomic.length}` }); }
    if (/\/orders\?/.test(u)) { orderLists++; return json({ elements: paidOrders }); }
    if (/\/orders\/[^/?]+$/.test(u)) return json({});
    return json({});
  }) as any;
  await saveLocation({ code: 'SAINT_LEONARD', name: 'SAINT-LÉONARD', address: '5839 Rue Jean-Talon E', city: 'Saint-Léonard', postalCode: 'H1S 1M4', phone: '514 555-0100', active: true });
  await saveLocation({ code: 'NDG_MAIN', name: 'NDG MAIN', address: '6280 Av Somerled', city: 'Montréal', postalCode: 'H3X 2B6', phone: '514 555-0101', active: true });
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-sl', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} } as any);
  await getRepo().saveMenu(UPSELL_MENU);
  await openAllDay(['SAINT_LEONARD', 'NDG_MAIN']);
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV_KEYS) delete process.env[k]; });

async function heldOrder(over: Partial<Parameters<typeof createDirectOrder>[0]> = {}): Promise<DirectOrder> {
  return createDirectOrder({
    source: 'phone_ai', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', customer: { name: 'Marie Tremblay', phone: '+15145550111', lang: 'fr' },
    fulfillment: 'pickup', lines: [{ name: 'Quart de poulet', quantity: 1, unitPrice: 20, total: 20, modifiers: [] }], payment: 'pay_at_pickup', holdForPayment: true, ...over,
  }, actor);
}

function webhook(body: Record<string, unknown>, secret = 'whsec-test') {
  const raw = JSON.stringify(body);
  return new Request('https://hub.test/api/foodhub/webhooks/clover-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Clover-Signature': cloverSignatureHeader(raw, secret) }, body: raw });
}

describe('Clover payment link: held until paid, released exactly once', () => {
  it('holds the order, texts the link (token never in the outbox) and makes a Clover session with GST / QST and our mark', async () => {
    const o = await heldOrder();
    expect(o.status).toBe('awaiting_payment');
    expect(o.payment).toBe('unpaid');
    expect(atomic).toHaveLength(0); // nothing in Clover yet
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const token = r.order.paylink!.token;
    expect(token.length).toBeGreaterThanOrEqual(22);
    expect(sms).toHaveLength(1);
    expect(sms[0].body).toContain(`https://hub.test/p/${token}`);
    expect(sms[0].body).toMatch(/Po Poulet : commande .+, total 23,00 \$\. Payez en toute sécurité avec Clover/);
    expect(checkouts[0].shoppingCart.lineItems[0]).toMatchObject({ price: 2000, unitQty: 1, note: `Réf. ${o.number}` });
    expect(checkouts[0].shoppingCart.lineItems[0].taxRates.map((x: any) => x.rate)).toEqual([500_000, 997_500]);
    expect(r.order.paylink!.expectedCents).toBe(2300);
    const outbox = JSON.stringify(await getRepo().listDocs('fh_outbox' as any, { limit: 50 }).catch(() => []));
    expect(outbox).not.toContain(token);
  });

  it('webhook APPROVED → in the kitchen, ticket printed once; a replay changes nothing; a second payment is flagged for a refund', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    // Wrong signature: refused.
    expect((await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAY1', merchantId: MID, data: 'SESS1' }, 'wrong'))).status).toBe(401);
    expect((await getDirectOrder(o.id))!.status).toBe('awaiting_payment');
    const res = await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAY1', merchantId: MID, data: 'SESS1' }));
    expect(res.status).toBe(200);
    const paid = (await getDirectOrder(o.id))!;
    expect(paid.status).toBe('in_kitchen');
    expect(paid.payment).toBe('paid');
    expect(paid.posOrderId).toBe('CLV-PAY1');
    expect(paid.paylink!.releasedAt).toBeTruthy();
    expect(paid.attention).toBeUndefined();
    expect(prints).toHaveLength(1);
    expect(sms.at(-1)!.body).toMatch(/paiement reçu, merci! Commande .+ prête pour emporter vers/);
    expect(payLinkState(paid)).toBe('paid');
    // The same event again (Clover retries): nothing more.
    await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAY1', merchantId: MID, data: 'SESS1' }));
    expect(prints).toHaveLength(1);
    // A second payment for the same order: never printed, flagged for a person to refund.
    await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAY2', merchantId: MID, data: 'SESS1' }));
    const after = (await getDirectOrder(o.id))!;
    expect(prints).toHaveLength(1);
    expect(after.paylink!.extraPayments).toEqual(['PAY2']);
    expect(after.attention).toMatch(/Paiement en double/);
    expect(chat.some((c) => c.includes('double payment'))).toBe(true);
  });

  it('a lost webhook: the 20-second check finds our mark on the paid Clover order and releases it', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'en', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    paidOrders = [{ id: 'CLV-POLL', lineItems: { elements: [{ note: `Réf. ${o.number}` }] }, payments: { elements: [{ id: 'PAYPOLL', result: 'SUCCESS', amount: 2300 }] } }];
    const out = await tickPaylinks(Date.now() + 25_000);
    expect(out.released).toBe(1);
    const paid = (await getDirectOrder(o.id))!;
    expect(paid.status).toBe('in_kitchen');
    expect(paid.posOrderId).toBe('CLV-POLL');
    expect(prints).toHaveLength(1);
    expect(sms.at(-1)!.body).toMatch(/^Po Poulet: payment received, thank you!/);
  });

  it('one reminder, then expiry: cancelled with a courtesy text; a payment after that is flagged, never printed', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'es', expiryMin: 20, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const t0 = Date.parse(r.order.paylink!.createdAt);
    expect((await tickPaylinks(t0 + 11 * 60_000)).reminded).toBe(1);
    expect((await tickPaylinks(t0 + 12 * 60_000)).reminded).toBe(0);
    expect(sms.at(-1)!.body).toMatch(/espera su pago/);
    const out = await tickPaylinks(t0 + 21 * 60_000);
    expect(out.cancelled).toBe(1);
    const gone = (await getDirectOrder(o.id))!;
    expect(gone.status).toBe('cancelled');
    expect(sms.at(-1)!.body).toMatch(/No se le cobró nada/);
    await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'LATE1', merchantId: MID, data: 'SESS1' }));
    const late = (await getDirectOrder(o.id))!;
    expect(late.status).toBe('cancelled');
    expect(late.paylink!.extraPayments).toEqual(['LATE1']);
    expect(prints).toHaveLength(0);
  });

  it('the customer page: summary on GET (no Clover call), Clover page on POST', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const token = r.order.paylink!.token;
    const before = checkouts.length;
    const page = await payPage(new Request(`https://hub.test/p/${token}`), { params: Promise.resolve({ token }) });
    const html = await page.text();
    expect(html).toContain('Payer avec Clover');
    expect(html).toContain('Bonjour Marie');
    expect(html).not.toContain('Tremblay');
    expect(checkouts.length).toBe(before);
    const go = await payPost(new Request(`https://hub.test/p/${token}`, { method: 'POST' }), { params: Promise.resolve({ token }) });
    expect(go.status).toBe(303);
    expect(go.headers.get('Location')).toBe('https://checkout.clover.test/s/1');
    expect((await payPage(new Request('https://hub.test/p/not-a-real-token-at-all'), { params: Promise.resolve({ token: 'not-a-real-token-at-all' }) })).status).toBe(404);
  });

  it('without a Hosted Checkout key, nothing changes: no link offered, pay at the counter as before', async () => {
    delete process.env.CLOVER_ECOMM_PRIVATE_KEY;
    expect((await paylinkReadiness('Po Poulet', 'SAINT_LEONARD')).ok).toBe(false);
    expect(await phonePaymentPlan(SL_LINE, { payment: DEFAULT_PAYMENT })).toMatchObject({ link: false, counter: true });
    expect(await tickPaylinks()).toEqual({ checked: 0, released: 0, cancelled: 0, reminded: 0 });
  });

  it('never on another kitchen: no store mapped there, or a kitchen without a register', async () => {
    expect((await paylinkReadiness('Pi Pita', 'NDG_MAIN')).ok).toBe(false);
    process.env.FOODHUB_CLOVER_NO_REGISTER = 'saint_leonard';
    expect((await paylinkReadiness('Po Poulet', 'SAINT_LEONARD')).reason).toMatch(/no Clover register/);
  });
});

describe('Duo / Trio / Combo upsell', () => {
  it('reads the upsell groups from the menu, offers them once per item, never inside add_item, always with the drink', async () => {
    expect(upsellKind({ name: 'Duo — Breuvage', min: 0 })).toBe('duo');
    expect(upsellKind({ name: 'Combos familiaux', min: 0 })).toBeNull();
    expect(upsellKind({ name: 'Trio — Frite + Breuvage', min: 1 })).toBeNull();
    const menu = await buildPhoneMenu(SL_LINE);
    expect(menu.text).toContain('UPSELL DUO "Duo — Breuvage"');
    expect(menu.text).toContain('option_ref=cp "Pepsi" +7.58');
    // Inside add_item: refused (the caller must pick the drink first).
    expect(addToCart(menu, [], { brand: 'Po Poulet', item_ref: 'i1', quantity: 1, option_refs: ['dp'], notes: null }).ok).toBe(false);
    const a = addToCart(menu, [], { brand: 'Po Poulet', item_ref: 'i1', quantity: 2, option_refs: ['ms'], notes: null });
    if (!a.ok) throw new Error(a.error);
    expect(upsellOffer(menu, a.cart[0])).toMatch(/Duo — Breuvage \(\+2\.50 \$; drinks: dp=Pepsi, d7=7UP\) \| Trio — Frite \+ Breuvage \(\+5\.42 \$.*Combo — Poutine classique \+ Breuvage \(\+7\.58/);
    expect(upsellOffer(menu, addToCart(menu, [], { brand: 'Po Poulet', item_ref: 'i2', quantity: 1, option_refs: [], notes: null }).cart[0])).toBeNull();
    // The drink was not asked: refused.
    expect(addUpsell(menu, a.cart, { line_number: 1, option_ref: 'tp', caller_chose_drink: false }).ok).toBe(false);
    const b = addUpsell(menu, a.cart, { line_number: 1, option_ref: 'tp', caller_chose_drink: true });
    if (!b.ok) throw new Error(b.error);
    expect(b.cart[0].modifiers.at(-1)).toMatchObject({ ref: 'tp', price: 5.42, upsell: 'trio', posRef: 'CMOD-TRIO-PEPSI' });
    // Only one of the three per item.
    expect(addUpsell(menu, b.cart, { line_number: 1, option_ref: 'cp', caller_chose_drink: true }).ok).toBe(false);
    expect(upsellOffer(menu, b.cart[0])).toBeNull();
    // The order line carries the Clover modifier id.
    const [line] = cartToLines(b.cart);
    expect(line.modifiers.find((m) => m.externalId === 'tp')).toMatchObject({ posModifierRef: 'CMOD-TRIO-PEPSI', unitPrice: 5.42 });
    expect(line.total).toBeCloseTo((12.99 + 1 + 5.42) * 2, 2);
  });

  it('the agent offers it once per call: the first main dish gets the UPSELL note, the next one not', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await setFeature('phone', true, actor);
    await savePhoneSettings({ lines: [SL_LINE as any] }, actor);
    const lineId = (await (await import('../lib/foodhub/phone/settings')).getPhoneSettings()).lines[0].id;
    const requests: any[] = [];
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => { if (String(url).includes('/v1/messages')) requests.push(JSON.parse(String(init.body))); return base(url, init); }) as any;
    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i1', quantity: 1, option_refs: [], notes: '' }, 'tu_a1')], 'tool_use'),
      claudeResponse([text('Voulez-vous en faire un Duo, un Trio ou un Combo ?')]),
      claudeResponse([toolUse('add_upsell', { line_number: 1, option_ref: 'd7', caller_chose_drink: true }, 'tu_u1'), toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i1', quantity: 1, option_refs: [], notes: '' }, 'tu_a2')], 'tool_use'),
      claudeResponse([text('Parfait, un Duo avec un 7UP, et un deuxième quart de poulet.')]),
    ];
    const t1 = await simulateTurn(lineId, null, 'Un quart de poulet');
    const firstResult = JSON.stringify(requests[1].messages.at(-1));
    expect(firstResult).toContain('UPSELL (offer it now, once');
    const t2 = await simulateTurn(lineId, t1.call.id, 'Oui, un Duo avec un 7UP, et un autre quart');
    const secondResults = JSON.stringify(requests[3].messages.at(-1));
    expect(secondResults).toContain('Duo — Breuvage : 7UP');
    expect(secondResults).not.toContain('UPSELL (offer it now');
    const call = (await getCall(t2.call.id))!;
    expect(call.upsellOffered).toBe(true);
    expect(call.cart[0].modifiers[0]).toMatchObject({ upsell: 'duo', posRef: 'CMOD-DUO-7UP' });
  });
});

describe('Clover direct order: modifications, the kitchen printer, kitchens without a register', () => {
  const order = (over: Partial<DirectOrder> = {}): DirectOrder => ({
    id: 'd1', number: 'IA-1043', source: 'phone_ai', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', customer: { name: 'Marie', phone: '+15145550111' }, fulfillment: 'pickup',
    lines: [
      { name: 'Quart de poulet', posItemRef: 'CLVITEM1', quantity: 2, unitPrice: 12.99, total: 0, modifiers: [{ name: 'Sauce BBQ', quantity: 1, unitPrice: 1 }, { name: 'Duo — Breuvage : 7UP', posModifierRef: 'CMOD-DUO-7UP', quantity: 1, unitPrice: 2.5 }] },
      { name: 'Salade', quantity: 1, unitPrice: 6, total: 6, modifiers: [{ name: 'Extra', posModifierRef: 'CMOD-X', quantity: 1, unitPrice: 1 }] },
    ],
    subtotal: 0, tax: 0, deliveryFee: 0, tip: 0, total: 0, currency: 'CAD', payment: 'pay_at_pickup', status: 'new', containsAlcohol: false, placedAt: '', events: [], createdAt: '', updatedAt: '', ...over,
  } as DirectOrder);

  it('linked options are Clover modifications, others stay in the price and the note; the lines add up to the subtotal', () => {
    const { orderCart, cents } = buildDirectCloverCart(order(), 'OT-PHONE');
    const items = orderCart.lineItems as any[];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ item: { id: 'CLVITEM1' }, price: 1399, note: 'Sauce BBQ', modifications: [{ modifier: { id: 'CMOD-DUO-7UP' }, amount: 250 }] });
    // An unlinked item cannot carry a Clover modification: folded into its price.
    expect(items[2]).toMatchObject({ price: 700, note: 'Extra' });
    expect(items[2].modifications).toBeUndefined();
    expect(cents).toBe((1399 + 250) * 2 + 700);
    expect(orderCart.orderType).toEqual({ id: 'OT-PHONE' });
  });

  it('prints on that kitchen’s printer; a kitchen without a register never gets a Clover order', async () => {
    process.env.CLOVER_PRINT_DEVICES = JSON.stringify({ [`${MID}|SAINT_LEONARD`]: 'PRN-SL', [MID]: 'PRN-DEFAULT' });
    const r = await createDirectOrderInClover(order());
    expect(r.ok).toBe(true);
    expect(prints).toHaveLength(1);
    expect(prints[0].body).toEqual({ orderRef: { id: 'ATOM1' }, deviceRef: { id: 'PRN-SL' } });
    expect(atomic[0].orderCart.lineItems[0].modifications[0].modifier.id).toBe('CMOD-DUO-7UP');
    process.env.FOODHUB_CLOVER_NO_REGISTER = 'HOCHELAGA, SAINT_LEONARD';
    expect(kitchenHasNoRegister('saint_leonard')).toBe(true);
    const skipped = await createDirectOrderInClover(order());
    expect(skipped).toMatchObject({ ok: false, skipped: true });
    expect(atomic).toHaveLength(1);
    delete process.env.FOODHUB_CLOVER_NO_REGISTER;
    expect(kitchenHasNoRegister('SAINT_LEONARD')).toBe(false);
  });
});

describe('Po Poulet is sold only at Saint-Léonard', () => {
  it('never at NDG nor Hochelaga, by phone line or brand line', () => {
    expect(brandLockedAt('Po Poulet', { code: 'SAINT_LEONARD', name: 'SAINT-LÉONARD', address: '5839 Rue Jean-Talon E' }, 'SAINT_LEONARD')).toBe(false);
    expect(brandLockedAt('Po Poulet', { code: 'NDG_MAIN', name: 'NDG MAIN', address: '6280 Av Somerled' }, 'NDG_MAIN')).toBe(true);
    expect(brandLockedAt('Po Poulet', { code: 'HOCHELAGA', name: 'HOCHELAGA', address: '3583 Rue Sainte-Catherine E' }, 'HOCHELAGA')).toBe(true);
    expect(brandLockedAt('Pi Pita', { code: 'HOCHELAGA' }, 'HOCHELAGA')).toBe(false);
    const r = parseBrandPhones(JSON.stringify({ '+15145550101': { brand: 'Po Poulet', kitchen: 'Hochelaga' }, '+15145550102': { brand: 'Po Poulet', kitchen: 'Jean-Talon' } }));
    expect(r.lines.map((l) => l.kitchen)).toEqual(['Jean-Talon']);
    expect(r.problems[0]).toMatch(/no phone line for Po Poulet NDG/);
  });
});

describe('AI circuit breaker, voicemail emails, public address', () => {
  it('a credit / auth failure pauses the AI, alerts the team once, and the ON2GO menu runs on the keypad', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(classifyAiError({ status: 401, message: 'invalid x-api-key' }).kind).toBe('fatal');
    expect(classifyAiError({ status: 400, message: 'Your credit balance is too low' }).kind).toBe('fatal');
    expect(classifyAiError({ status: 529, message: 'Overloaded' }).kind).toBe('transient');
    expect(await phoneAiUsable()).toBe(true);
    const f = await noteAiFailure({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' });
    expect(f.tripped).toBe(true);
    await noteAiFailure({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' });
    expect(await phoneAiUsable()).toBe(false);
    expect(chat.filter((c) => c.includes('Phone AI paused'))).toHaveLength(1);
    const xml = await (await ivrStart(new URLSearchParams({ CallSid: 'CA-BRK', From: '+15145550111', To: '+15145550000' }))).text();
    expect(xml).toContain('Pour le français, faites le 1.');
    expect(xml).not.toContain('Comment puis-je vous aider');
    await resetAiHealth();
    expect(await phoneAiUsable()).toBe(true);
  });

  it('a voicemail is marked emailed only once the email really went out', async () => {
    await saveIvrCall({ ...newIvrCall('CA-VM1', '+15145550111', '+15145550000'), voicemail: { ticketId: 'tk_1', recordingUrl: 'https://api.twilio.com/rec/RE1', durationSec: 12 } });
    expect(await emailVoicemail('CA-VM1')).toBe(false);
    const c = (await getIvrCall('CA-VM1'))!;
    expect(c.voicemail!.emailedAt).toBeUndefined();
    expect(c.voicemail!.emailTries).toBe(1);
    // No way to email: the team chat got it once instead.
    expect(c.voicemail!.chatAt).toBeTruthy();
  });

  it('FOODHUB_PUBLIC_URL is trimmed; a bad request URL never throws in the Twilio check', () => {
    process.env.FOODHUB_PUBLIC_URL = '  https://hub.test/ \n';
    expect(publicBaseUrl()).toBe('https://hub.test');
    expect(verifyTwilio(new Headers({ 'x-twilio-signature': 'abc' }), 'not a url', new URLSearchParams())).toBe(false);
  });
});

describe('Call simulator and readiness (nothing sent)', () => {
  it('reads TwiML the way Twilio would', () => {
    const r = readTwiml('<Response><Gather action="/x/turn" language="fr-CA" speechModel="googlev2_telephony" hints="a, b"><Say voice="v" language="fr-CA">Bonjour l&apos;ami</Say><Play>https://a/b.mp3</Play></Gather></Response>');
    expect(r).toMatchObject({ said: ["Bonjour l'ami", '[audio]'], next: 'listen', action: '/x/turn', listen: { language: 'fr-CA', model: 'googlev2_telephony', hints: true } });
    expect(readTwiml('<Response><Say>x</Say><Dial callerId="+1">+15145551234</Dial></Response>')).toMatchObject({ next: 'dial', dial: '+1••••••1234' });
  });

  it('plays the ON2GO menu on the keypad: the courier link text is shown, never sent; voicemail at the end', async () => {
    const r = await simulateCall({ target: 'ivr', from: '+15145550111', inputs: [{ digits: '1' }, { digits: '5' }] });
    expect(r.steps[0].said.join(' ')).toContain('Pour le français, faites le 1.');
    expect(r.ended).toBe('voicemail');
    expect(r.sent.find((x) => x.channel === 'sms')?.body).toBe('ON2GO — Devenir livreur ou livreuse : https://on2go.ca');
    expect(sms).toHaveLength(0);
    const call = (await getIvrCall(r.callSid))!;
    expect(call.simulated).toBe(true);
    expect(call.status).toBe('ended');
  });

  it('the readiness list says what each kitchen can do, and flags hours never set — read only', async () => {
    await setFeature('phone', true, actor);
    await savePhoneSettings({ lines: [SL_LINE as any, { ...SL_LINE, number: '+14385550143', name: 'Pi Pita NDG', locationCode: 'NDG_MAIN', brands: ['Pi Pita'] }] }, actor);
    await openAllDay(['SAINT_LEONARD']);
    const r = await phoneReadiness();
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id.startsWith('hours_') && c.id.endsWith('NDG_MAIN'))).toMatchObject({ level: 'stop' });
    expect(r.checks.find((c) => c.id.startsWith('register_') && c.id.endsWith('NDG_MAIN'))?.level).toBe('warn');
    expect(r.checks.find((c) => c.id === 'twilio')?.level).toBe('ok');
    expect(r.checks.some((c) => c.id.startsWith('menu_') && c.level === 'ok' && /Duo \/ Trio \/ Combo/.test(c.en))).toBe(true);
    expect(r.checks.some((c) => c.id.startsWith('pay_') && c.level === 'ok')).toBe(true);
    expect(sms).toHaveLength(0);
    expect(atomic).toHaveLength(0);
  });
});

describe('review fixes: payment link edge cases', () => {
  const DROP = { street: '5839 Rue Jean-Talon E', unit: '2', city: 'Saint-Léonard', province: 'QC', postalCode: 'H1S 1M4', country: 'CA' };
  const closedWeek = () => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, []])) as any;

  it('a tip on a delivery link is an untaxed line: the texted total, the page and Clover all say the same amount', async () => {
    const o = await heldOrder({ fulfillment: 'delivery', dropoff: DROP as any, deliveryFee: 5, tip: 3, payment: 'unpaid' });
    expect(o.total).toBeCloseTo(31.74, 2);
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const items = checkouts[0].shoppingCart.lineItems;
    const tip = items.find((l: any) => /Pourboire/.test(l.name));
    expect(tip).toMatchObject({ price: 300, unitQty: 1 });
    expect(tip.taxRates).toBeUndefined();
    // 25.00 taxed: GST 1.25 + QST 2.49 (rounded one by one) + 3.00 tip.
    expect(r.order.paylink!.expectedCents).toBe(3174);
    expect(sms[0].body).toContain('total 31,74 $');
    const token = r.order.paylink!.token;
    const html = await (await payPage(new Request(`https://hub.test/p/${token}`), { params: Promise.resolve({ token }) })).text();
    expect(html).toContain('Pourboire');
    expect(html).toMatch(/31,74/);
    // Without a tip: no tip line, and the tax is on every line.
    const req = buildCheckoutRequest({ number: 'X', lines: o.lines, deliveryFee: 0, customer: {}, tip: 0 }, [{ name: 'TPS', rate: 500_000 }, { name: 'TVQ', rate: 997_500 }], { success: '', failure: '', cancel: '' });
    expect(req.shoppingCart.lineItems).toHaveLength(1);
    expect(checkoutTotalCents(req)).toBe(2300);
  });

  it('a delivery paid while the kitchen is closed: nothing printed, no courier booked automatically, the flag survives', async () => {
    await setFeature('delivery', true, actor);
    await saveDeliverySettings({ locations: { SAINT_LEONARD: { enabled: true, autoDispatch: true, leadMinutes: 10, maxDistanceKm: 0, postalPrefixes: [], maxAutoFee: 15 } } });
    const o = await heldOrder({ fulfillment: 'delivery', dropoff: DROP as any, deliveryFee: 5, payment: 'unpaid' });
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    await saveHours({ locations: { SAINT_LEONARD: closedWeek() }, brands: {}, holidays: [] });
    payAmount = r.order.paylink!.expectedCents;
    await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAYC', merchantId: MID, data: 'SESS1' }));
    const paid = (await getDirectOrder(o.id))!;
    expect(paid.payment).toBe('paid');
    expect(prints).toHaveLength(0);
    expect(paid.attention).toMatch(/cuisine est fermée/);
    expect(paid.paylink!.flag).toBe(paid.attention);
    expect(paid.autoDispatch).toMatchObject({ attempts: 3, stoppedReason: 'paid_while_closed' });
    expect((await tickDispatch(Date.now() + 3 * 3600_000)).booked).toBe(0);
    const after = (await getDirectOrder(o.id))!;
    expect(after.events.some((e) => e.type === 'auto_dispatch')).toBe(false);
    expect(after.attention).toMatch(/cuisine est fermée/);
    expect(sms.at(-1)!.body).toMatch(/Un membre de notre équipe vous appelle/);
  });

  it('pay at the counter stops the link; a payment that lands afterwards is flagged for a refund, never printed', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const conv = await payAtCounter(o.id, actor);
    expect(conv.payment).toBe('pay_at_pickup');
    expect(conv.status).not.toBe('awaiting_payment');
    expect(conv.paylink!.cancelledAt).toBeTruthy();
    const printsBefore = prints.length;
    await hcoWebhook(webhook({ type: 'PAYMENT', status: 'APPROVED', id: 'PAYLATE', merchantId: MID, data: 'SESS1' }));
    const after = (await getDirectOrder(o.id))!;
    expect(after.paylink!.extraPayments).toEqual(['PAYLATE']);
    expect(after.attention).toMatch(/rembourse/);
    expect(prints.length).toBe(printsBefore);
  });

  it('cancel vs a release: a running release wins, a release that died long ago does not block the cancel', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const cur = (await getDirectOrder(o.id))!;
    await saveDirectOrder({ ...cur, paylink: { ...cur.paylink!, releaseClaim: 'other', releaseClaimAt: new Date().toISOString() } });
    expect((await cancelHeldOrder(o.id, 'staff', 'Owner')).status).toBe('awaiting_payment');
    const again = (await getDirectOrder(o.id))!;
    await saveDirectOrder({ ...again, paylink: { ...again.paylink!, releaseClaimAt: new Date(Date.now() - 10 * 60_000).toISOString() } });
    expect((await cancelHeldOrder(o.id, 'staff', 'Owner')).status).toBe('cancelled');
  });

  it('the poller matches our whole mark: "Réf. IA-104" never releases the order of "Réf. IA-1043"', () => {
    expect(hasMarker('Réf. IA-1043', 'Réf. IA-104')).toBe(false);
    expect(hasMarker('Réf. IA-10430 · Sauce', 'Réf. IA-1043')).toBe(false);
    expect(hasMarker('Réf. IA-1043 · Sauce BBQ', 'Réf. IA-1043')).toBe(true);
    expect(hasMarker('Réf. IA-1043', 'Réf. IA-1043')).toBe(true);
  });

  it('the poller never releases a payment short of the total: a person checks it in Clover', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'en', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const due = r.order.paylink!.expectedCents;
    paidOrders = [{ id: 'CLV-SHORT', lineItems: { elements: [{ note: `Réf. ${o.number}` }] }, payments: { elements: [{ id: 'PAYSHORT', result: 'SUCCESS', amount: due - 500 }] } }];
    const out = await tickPaylinks(Date.now() + 25_000);
    expect(out.released).toBe(0);
    const held = (await getDirectOrder(o.id))!;
    expect(held.status).toBe('awaiting_payment');
    expect(held.attention).toMatch(/moins que le total/);
    expect(prints).toHaveLength(0);
  });

  it('the customer page asks Clover at most once per 10 s after the return from Clover', async () => {
    const o = await heldOrder();
    const r = await startPayLink(o, { lang: 'fr', expiryMin: 30, reminderMin: 10 });
    if (!r.ok) throw new Error(r.error);
    const token = r.order.paylink!.token;
    const get = () => payPage(new Request(`https://hub.test/p/${token}?r=ok`), { params: Promise.resolve({ token }) });
    await get();
    await get();
    await get();
    expect(orderLists).toBe(1);
  });

  it('readiness: a merchant without GST / QST rates gets no link (pickup at the counter instead)', async () => {
    taxFail = true;
    const r = await paylinkReadiness('Po Poulet', 'SAINT_LEONARD');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/GST.*QST/);
    expect(await phonePaymentPlan(SL_LINE, { payment: DEFAULT_PAYMENT })).toMatchObject({ link: false, counter: true });
  });

  it('a payment link that cannot be created: the next place_order at the counter is accepted', async () => {
    const menu = await buildPhoneMenu(SL_LINE);
    const added = addToCart(menu, [], { brand: 'Po Poulet', item_ref: 'i2', quantity: 1, option_refs: [], notes: null });
    if (!added.ok) throw new Error(added.error);
    const call: any = {
      id: 'CA-LINKFAIL', lineId: 'l1', lineName: SL_LINE.name, locationCode: 'SAINT_LEONARD', brands: SL_LINE.brands, from: '+15145550111', to: SL_LINE.number, lang: 'fr', status: 'active',
      startedAt: new Date().toISOString(), turns: 3, transcript: [], messages: [], cart: added.cart, customer: { name: 'Marie', phone: '+15145550111', fulfillment: 'pickup' }, updatedAt: new Date().toISOString(),
    };
    const line: any = { ...SL_LINE, id: 'l1' };
    checkoutFail = true;
    const opts = { confirmed: true, simulate: false, smsConfirmation: false, settings: { payment: DEFAULT_PAYMENT } };
    const first = await placePhoneOrder(call, line, menu, { ...opts, payment: 'link' });
    expect(first.ok).toBe(false);
    expect(first.call.linkFailed).toBe(true);
    // Before the fix this was refused ("pickup is paid by the texted link"), leaving the caller stuck.
    const second = await placePhoneOrder(first.call, line, menu, { ...opts, payment: 'counter' });
    expect(second.ok).toBe(true);
    expect(second.order!.status).not.toBe('awaiting_payment');
    expect(second.order!.payment).toBe('pay_at_pickup');
  });
});

describe('review fixes: AI breaker, simulator, language keys', () => {
  it('a 400 that belongs to one conversation never pauses the AI; a test conversation never touches the breaker', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(classifyAiError({ status: 400, message: 'messages.3: thinking blocks cannot be modified' }).kind).toBe('call');
    expect(classifyAiError({ status: 400, message: 'prompt is too long: 210000 tokens > 200000 maximum' }).kind).toBe('call');
    expect(classifyAiError({ status: 400, message: 'model: claude-x is not a valid model' }).kind).toBe('fatal');
    expect(classifyAiError({ status: 400, type: 'billing_error', message: 'billing' }).kind).toBe('fatal');
    for (let i = 0; i < 5; i++) expect((await noteAiFailure({ status: 400, message: 'tool_result block mismatch' })).tripped).toBe(false);
    expect(await phoneAiUsable()).toBe(true);
    expect((await noteAiFailure({ status: 401, message: 'invalid x-api-key' }, { test: true })).tripped).toBe(false);
    expect(await phoneAiUsable()).toBe(true);
    expect(chat.filter((c) => c.includes('Phone AI paused'))).toHaveLength(0);
  });

  it('the call simulator is owner-only and never uses a caller number typed in', async () => {
    const before = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'owner-pass-test-1';
    try {
      await getRepo().saveUser({ username: 'lea', name: 'Léa', role: 'manager', locations: ['SAINT_LEONARD'], passwordHash: hashPassword('manager-pass-1'), active: true } as any);
      const body = JSON.stringify({ target: 'ivr', from: '+15145550111', inputs: [{ digits: '1' }] });
      const as = (who: string) => new Request('https://hub.test/api/foodhub/phone/sim', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(who).toString('base64')}` }, body });
      expect((await simRoute(as('lea:manager-pass-1'), undefined as any)).status).toBe(403);
      const res = await simRoute(as('owner:owner-pass-test-1'), undefined as any);
      expect(res.status).toBe(200);
      const out = (await res.json()) as any;
      const call = (await getIvrCall(out.callSid ?? out.data?.callSid))!;
      expect(call.from).toBe('+15555550123');
    } finally {
      if (before === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = before;
    }
  });

  it('ordering line: keys 2 / 3 switch the language only on the greeting; mid-order only a request said alone', () => {
    expect(languageChoice(0, '2', '')).toEqual({ lang: 'en', rest: '' });
    expect(languageChoice(3, '2', '')).toBeNull();
    expect(languageChoice(3, '3', '')).toBeNull();
    expect(languageChoice(3, '', 'French fries please')).toBeNull();
    expect(languageChoice(3, '', 'Two French fries')).toBeNull();
    expect(languageChoice(3, '', 'English please')).toEqual({ lang: 'en', rest: '' });
    expect(languageChoice(3, '', 'English, I want to add a chicken')).toBeNull();
    expect(languageChoice(0, '', 'English, I want to order a chicken')).toEqual({ lang: 'en', rest: 'i want to order a chicken' });
  });
});

describe('TAKATAK Phone: the texted pay link needs the app for the kitchen\'s merchant', () => {
  async function pickupCall(id: string) {
    const menu = await buildPhoneMenu(SL_LINE);
    const added = addToCart(menu, [], { brand: 'Po Poulet', item_ref: 'i2', quantity: 1, option_refs: [], notes: null });
    if (!added.ok) throw new Error(added.error);
    const call: any = {
      id, lineId: 'l1', lineName: SL_LINE.name, locationCode: 'SAINT_LEONARD', brands: SL_LINE.brands, from: '+15145550111', to: SL_LINE.number, lang: 'fr', status: 'active',
      startedAt: new Date().toISOString(), turns: 3, transcript: [], messages: [], cart: added.cart, customer: { name: 'Marie', phone: '+15145550111', fulfillment: 'pickup' }, updatedAt: new Date().toISOString(),
    };
    return { menu, call, line: { ...SL_LINE, id: 'l1' } as any };
  }
  const opts = { confirmed: true, simulate: false, smsConfirmation: false, settings: { payment: DEFAULT_PAYMENT } };

  it('without the phone app (as today) the link is offered and texted', async () => {
    expect(await phonePaymentPlan(SL_LINE, { payment: DEFAULT_PAYMENT })).toMatchObject({ link: true });
    const { menu, call, line } = await pickupCall('CA-GATE-OFF');
    const r = await placePhoneOrder(call, line, menu, { ...opts, payment: 'link' });
    expect(r.ok).toBe(true);
    expect(r.order!.status).toBe('awaiting_payment');
    expect(sms.filter((m) => m.body.includes('https://hub.test/p/'))).toHaveLength(1);
  });

  it('phone app set, merchant not entitled: no link offered, the pickup is placed for the counter and no link is texted', async () => {
    Object.assign(process.env, { CLOVER_PHONE_APP_ID: 'TESTPHONEAPP4', CLOVER_PHONE_APP_SECRET: 'phone-secret-test' });
    const plan = await phonePaymentPlan(SL_LINE, { payment: DEFAULT_PAYMENT });
    expect(plan).toMatchObject({ link: false, counter: true });
    expect(plan.reason).toMatch(/TAKATAK Phone not active for kitchen SAINT_LEONARD \(not_installed\): no payment link/);
    const { menu, call, line } = await pickupCall('CA-GATE-ON');
    const r = await placePhoneOrder(call, line, menu, { ...opts, payment: 'link' });
    expect(r.ok).toBe(true);
    expect(r.order!.status).not.toBe('awaiting_payment');
    expect(r.order!.payment).toBe('pay_at_pickup');
    expect(checkouts).toHaveLength(0);
    expect(sms.filter((m) => m.body.includes('https://hub.test/p/'))).toHaveLength(0);
  });

  it('our own merchant (PHONE_OWN_MERCHANTS): the link works as before', async () => {
    Object.assign(process.env, { CLOVER_PHONE_APP_ID: 'TESTPHONEAPP4', CLOVER_PHONE_APP_SECRET: 'phone-secret-test', PHONE_OWN_MERCHANTS: MID });
    expect(await phonePaymentPlan(SL_LINE, { payment: DEFAULT_PAYMENT })).toMatchObject({ link: true });
  });
});
