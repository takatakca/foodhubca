// Interac e-Transfer for website orders (contract section B, 2026-10-29): the fee declared before checkout and checked,
// re-pricing from the brand menu with a $0.02 tolerance on the total, the customer token, the hold + instructions text,
// the release exactly once by a person ("Transfer received"), reminder + expiry, the late transfer flagged for a person,
// the courier booked by the dispatch tick once released, the masked settings, and the older `paid: boolean` payloads
// kept as they were. Clover (clover-direct) and texts (notify) are mocked: nothing leaves the test.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sms: [] as Array<{ to: string; body: string; preview?: string; purpose: string }>, chat: [] as string[], clover: 0, cloverFail: false }));

vi.mock('../lib/foodhub/delivery/clover-direct', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/delivery/clover-direct')>()),
  createDirectOrderInClover: vi.fn(async () => {
    h.clover++;
    await new Promise((r) => setTimeout(r, 5));
    return h.cloverFail ? { ok: false, error: 'Clover returned HTTP 500: boom' } : { ok: true, posOrderId: `CLV-${h.clover}`, merchantId: 'MID-TEST', printed: 'printed' };
  }),
}));
vi.mock('../lib/foodhub/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/notify')>()),
  smsConfigured: () => true,
  sendSms: vi.fn(async (m: { to: string; body: string }, meta: { purpose: string; preview?: string }) => { h.sms.push({ to: m.to, body: m.body, preview: meta.preview, purpose: meta.purpose }); return { ok: true, channel: 'sms', message: 'sent' }; }),
  postToChat: vi.fn(async (m: { title: string }) => { h.chat.push(m.title); return { ok: true, channel: 'chat', message: 'ok' }; }),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

import { saveLocation } from '../lib/foodhub/catalog';
import { buildDirectCloverCart, createDirectOrderInClover } from '../lib/foodhub/delivery/clover-direct';
import { tickDispatch } from '../lib/foodhub/delivery/dispatch';
import {
  INTERAC_SMS, brandInitials, interacFeeAllIn, interacInstructions, interacLatePending, interacReadiness, interacSummary, markInteracReceived, markLateInteracRefunded,
  releaseLateInterac, tickInterac,
} from '../lib/foodhub/delivery/interac';
import { runDirectAction, totalsFor } from '../lib/foodhub/delivery/orders';
import { cleanInterac, getDeliverySettings, getDirectOrder, maskDeliverySettings, saveDeliverySettings } from '../lib/foodhub/delivery/store';
import { INTERAC_ANSWER_MASK } from '../lib/foodhub/delivery/types';
import { receiveWebsiteOrder } from '../lib/foodhub/delivery/website';
import { setFeature } from '../lib/foodhub/expansion/features';
import { tickExpansion } from '../lib/foodhub/expansion/tick';
import { getRepo } from '../lib/foodhub/repo';
import { sessionKey } from '../lib/foodhub/session';
import { trackOrder } from '../lib/foodhub/storefront/checkout';
import type { MasterMenu } from '../lib/foodhub/types';
import { POST as websiteOrderRoute } from '../app/api/foodhub/webhooks/website-order/route';

const actor = { username: 'mgr', name: 'Marc', source: 'dashboard' as const };
const other = { username: 'cook', name: 'Léa', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let drive: Array<{ url: string; body: any }> = [];

const MENU: MasterMenu = {
  brandName: 'Po Poulet', updatedAt: '',
  categories: [{ ref: 'c1', name: 'Chicken', nameFr: 'Poulet', sortOrder: 1 }],
  items: [
    { ref: 'i-whole', name: 'Whole chicken', nameFr: 'Poulet entier', price: 24.99, categoryRef: 'c1', available: true, posItemRef: 'CLV-WHOLE', modifierGroupRefs: ['gs'] },
    { ref: 'i-salad', name: 'Salad', nameFr: 'Salade', price: 6, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [{ ref: 'gs', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm-piri', name: 'Piri-piri', price: 1.5, available: true, posModifierRef: 'CMOD-PIRI' }] }],
};

const DROP = { street: '5555 Monkland Ave', unit: '3', city: 'Montréal', province: 'QC', postalCode: 'H4A 1E1', country: 'CA', instructions: 'Code 1234' };
const FEE = { code: 'interac', name: 'Frais Interac e-Transfer', amount: 5 };
/** 1 × whole chicken 24.99 + Piri-piri 1.50, 1 × salad 6.00 → subtotal 32.49; fee 5.00; taxes on 37.49 = 5.61; tip 2 → 45.10. */
const ITEMS = [{ ref: 'i-whole', name: 'Poulet entier', quantity: 1, price: 24.99, options: [{ ref: 'm-piri', name: 'Piri-piri', price: 1.5 }] }, { ref: 'i-salad', name: 'Salade', quantity: 1, price: 6 }];
const TOTAL = totalsFor([{ name: 'a', quantity: 1, unitPrice: 24.99, total: 26.49, modifiers: [] }, { name: 'b', quantity: 1, unitPrice: 6, total: 6, modifiers: [] }], 0, 2, true, [FEE]).total;

function payload(extra: Record<string, unknown> = {}) {
  return { id: `W-${crypto.randomUUID().slice(0, 8)}`, brand: 'Po Poulet', location: 'NDG', customer: { name: 'Ana Bel', phone: '514-555-1234', lang: 'fr' }, fulfillment: 'pickup', items: ITEMS, tip: 2, payment: 'interac', fees: [FEE], total: TOTAL, ...extra };
}

async function placed(extra: Record<string, unknown> = {}) {
  const r = await receiveWebsiteOrder(payload(extra));
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.order;
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_PUBLIC_URL = 'https://hub.example.test';
  process.env.FOODHUB_WEBSITE_ORDER_SECRET = 'web-order-test';
  process.env.SESSION_SECRET = 'interac-test-session-secret-0123456789';
  for (const k of ['FOODHUB_INTERAC_EMAIL', 'FOODHUB_INTERAC_FEE', 'FOODHUB_WEBSITE_TENANT', 'DOORDASH_DRIVE_ENV', 'LIVE_CONNECTORS_GLOBAL_ENABLED']) delete process.env[k];
  Object.assign(process.env, { DOORDASH_DRIVE_DEVELOPER_ID: 'dev-1', DOORDASH_DRIVE_KEY_ID: 'key-1', DOORDASH_DRIVE_SIGNING_SECRET: Buffer.from('drive-secret').toString('base64'), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw', TWILIO_FROM: '+15145550000' });
  h.sms = []; h.chat = []; h.clover = 0; h.cloverFail = false; drive = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/drive/v2/quotes')) { drive.push({ url: u, body }); return json({ external_delivery_id: body.external_delivery_id, delivery_status: 'quote', fee: 975, currency: 'CAD' }); }
    if (/\/drive\/v2\/quotes\/.+\/accept$/.test(u)) return json({ external_delivery_id: u.split('/').at(-2), delivery_status: 'created', fee: 975, tracking_url: 'https://track.example.test/x' });
    return json({ ok: true });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG — 6280 Somerled', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await getRepo().saveMenu(MENU);
  await setFeature('delivery', true, actor);
  await saveDeliverySettings({ compareQuotes: false, interac: { enabled: true, fee: 5, recipientEmail: 'paiements@example.test', autoDeposit: true, holdMinutes: 45, reminderMinutes: 20 } as any, locations: { NDG: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } });
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('fee and prices: what the customer saw is what Food Hub charges', () => {
  it('the all-in fee the site must show is the fee plus GST and QST', () => {
    expect(interacFeeAllIn(5)).toBe(5.75);
    expect(interacFeeAllIn(0)).toBe(0);
    expect(TOTAL).toBe(45.1);
  });

  it('payment "interac" needs the fee line, at the Food Hub amount, and the all-in total', async () => {
    expect(await receiveWebsiteOrder(payload({ fees: undefined }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/needs the fee line/) });
    expect(await receiveWebsiteOrder(payload({ fees: [{ ...FEE, amount: 4 }] }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Interac fee 4\.00 differs from the Food Hub setting 5\.00/) });
    expect(await receiveWebsiteOrder(payload({ fees: [FEE, FEE] }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/more than once/) });
    expect(await receiveWebsiteOrder(payload({ fees: [{ code: 'service', name: 'x', amount: 1 }] }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Unknown fee/) });
    expect(await receiveWebsiteOrder(payload({ total: undefined }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/total is required/) });
    expect(await receiveWebsiteOrder(payload({ payment: 'paid', fees: [FEE], total: undefined }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/payment is not "interac"/) });
    expect(await receiveWebsiteOrder(payload({ payment: 'cash' }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Unknown payment/) });
    expect(h.clover).toBe(0);
  });

  it('re-prices every line from the brand menu: unknown item, wrong price or unconfirmed paid option → 422; tolerance $0.02 on the total', async () => {
    const bad = (items: unknown, re: RegExp) => expect(receiveWebsiteOrder(payload({ items }))).resolves.toMatchObject({ ok: false, status: 422, error: expect.stringMatching(re) });
    await bad([{ ref: 'i-nope', name: 'Mystery dish', quantity: 1, price: 9 }], /"Mystery dish" \(ref i-nope\) is not on the Po Poulet menu/);
    await bad([{ ref: 'i-whole', name: 'Poulet entier', quantity: 1, price: 19.99 }], /the site charged 19\.99 but the menu price is 24\.99/);
    await bad([{ ref: 'i-whole', name: 'Poulet entier', quantity: 1, price: 24.99, options: [{ name: 'Extra magic', price: 3 }] }], /Option "Extra magic" of "Whole chicken" is not on the menu/);
    await bad([{ ref: 'i-whole', name: 'Poulet entier', quantity: 1, price: 24.99, options: [{ ref: 'm-piri', name: 'Piri-piri', price: 0.5 }] }], /Option "Piri-piri" of "Whole chicken": the site charged 0\.50 but the menu price is 1\.50/);
    expect(await receiveWebsiteOrder(payload({ total: TOTAL + 0.05 }))).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Total 45\.15 differs from Food Hub's 45\.10/) });
    // Within the tolerance: accepted, and Food Hub's own total is kept.
    const near = await receiveWebsiteOrder(payload({ total: TOTAL - 0.02 }));
    expect(near.ok && near.order.total).toBe(TOTAL);
    // A free option that is not on the menu is a note; a line found by name (no ref) is priced from the menu.
    const byName = await receiveWebsiteOrder(payload({ items: [{ name: 'Salade', quantity: 2, price: 6, options: [{ name: 'Sans oignons', price: 0 }] }], total: totalsFor([{ name: 's', quantity: 2, unitPrice: 6, total: 12, modifiers: [] }], 0, 2, true, [FEE]).total }));
    expect(byName.ok && byName.order.lines[0]).toMatchObject({ quantity: 2, unitPrice: 6, total: 12, modifiers: [{ name: 'Sans oignons', unitPrice: 0 }] });
    // A linked option carries its Clover modifier id.
    const o = await placed();
    expect(o.lines[0]).toMatchObject({ posItemRef: 'CLV-WHOLE', unitPrice: 24.99, total: 26.49, modifiers: [{ name: 'Piri-piri', unitPrice: 1.5, posModifierRef: 'CMOD-PIRI' }] });
  });

  it('Interac off, or no recipient e-mail for the kitchen → 422; the env fallback counts', async () => {
    await saveDeliverySettings({ interac: { enabled: false } as any });
    expect(await receiveWebsiteOrder(payload())).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/turned off/) });
    await saveDeliverySettings({ interac: { enabled: true, recipientEmail: '' } as any });
    expect((await getDeliverySettings()).interac.recipientEmail).toBe('');
    expect(await receiveWebsiteOrder(payload())).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/No Interac e-mail for NDG/) });
    process.env.FOODHUB_INTERAC_EMAIL = 'Compte@Example.test';
    expect((await getDeliverySettings()).interac.recipientEmail).toBe('compte@example.test');
    const o = await placed();
    expect(o.interac!.recipient).toBe('compte@example.test');
    // A kitchen with its own e-mail wins.
    await saveDeliverySettings({ interac: { recipients: { NDG: 'ndg@example.test' } } as any });
    expect((await placed()).interac!.recipient).toBe('ndg@example.test');
    expect(interacReadiness(await getDeliverySettings(), 'OTHER')).toMatchObject({ ok: true, recipient: 'compte@example.test' });
  });

  it('the older `paid: boolean` payloads work unchanged: no re-pricing, no fee, straight to Clover', async () => {
    const r = await receiveWebsiteOrder({ id: 'W-legacy', brand: 'Po Poulet', location: 'NDG', customer: { name: 'Ana', phone: '514-555-1234' }, fulfillment: 'pickup', items: [{ name: 'Poulet', quantity: 2, price: 12.5 }, { name: 'Mystery', quantity: 1, price: 3 }], paid: true });
    expect(r.ok && r.order).toMatchObject({ payment: 'paid', status: 'in_kitchen', subtotal: 28, posOrderId: 'CLV-1' });
    expect(r.ok && r.order.interac).toBeUndefined();
    expect(r.ok && r.order.fees).toBeUndefined();
    // payment "paid" / "pay_at_pickup" with the contract: priced from the menu, total checked when given, no fee.
    const paid = await receiveWebsiteOrder(payload({ payment: 'paid', fees: undefined, total: undefined }));
    expect(paid.ok && paid.order).toMatchObject({ payment: 'paid', status: 'in_kitchen', total: totalsFor([{ name: 'a', quantity: 1, unitPrice: 24.99, total: 26.49, modifiers: [] }, { name: 'b', quantity: 1, unitPrice: 6, total: 6, modifiers: [] }], 0, 2).total });
    const counter = await receiveWebsiteOrder(payload({ payment: 'pay_at_pickup', fees: undefined, total: 99 }));
    expect(counter).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Total 99\.00 differs/) });
  });
});

describe('customer token (verify-only stand-in for feature/customer-identity)', () => {
  async function token(customerId: string, tenant: string, exp = Math.floor(Date.now() / 1000) + 3600, version = 1, key?: CryptoKey) {
    const body = `cust.${customerId}.${tenant}.${exp}.${version}`;
    const k = key ?? (await sessionKey())!;
    const sig = Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body))).toString('base64url');
    return `${body}.${sig}`;
  }

  it('links the order to the customer; another tenant → 403; a forged or expired token → 401; no token → no link', async () => {
    const good = await placed({ customerToken: await token('c_42', 'pppmtl') });
    expect(good.customer.id).toBe('c_42');
    expect((await placed()).customer.id).toBeUndefined();
    expect(await receiveWebsiteOrder(payload({ customerToken: await token('c_42', 'othersite') }))).toMatchObject({ ok: false, status: 403 });
    process.env.FOODHUB_WEBSITE_TENANT = 'othersite';
    expect((await placed({ customerToken: await token('c_43', 'othersite') })).customer.id).toBe('c_43');
    expect((await placed({ tenant: 'pppmtl', customerToken: await token('c_44', 'pppmtl') })).customer.id).toBe('c_44');
    expect(await receiveWebsiteOrder(payload({ customerToken: await token('c_42', 'pppmtl', Math.floor(Date.now() / 1000) - 10) }))).toMatchObject({ ok: false, status: 401 });
    const forged = await crypto.subtle.importKey('raw', new TextEncoder().encode('not-the-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    expect(await receiveWebsiteOrder(payload({ customerToken: await token('c_42', 'pppmtl', undefined, 1, forged) }))).toMatchObject({ ok: false, status: 401 });
    expect(await receiveWebsiteOrder(payload({ customerToken: 'cust.x' }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe('held until a person confirms: instructions, reminder, expiry', () => {
  it('holds the order (nothing in Clover), texts the instructions, answers the site with the same instructions and never the answer', async () => {
    const o = await placed();
    expect(o).toMatchObject({ status: 'awaiting_payment', payment: 'unpaid', total: TOTAL, fees: [{ code: 'interac', amount: 5 }] });
    expect(o.tax).toBe(5.61); // GST + QST on 32.49 + 5.00
    expect(o.interac).toMatchObject({ reference: expect.stringMatching(/^PP-[A-HJ-NP-Z2-9]{4}$/), amount: TOTAL, recipient: 'paiements@example.test', autoDeposit: true, reminderMin: 20, lang: 'fr' });
    expect(Date.parse(o.interac!.expiresAt) - Date.parse(o.interac!.createdAt)).toBe(45 * 60_000);
    expect(h.clover).toBe(0);
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].to).toBe('+15145551234');
    expect(h.sms[0].body).toContain('virement Interac à paiements@example.test');
    expect(h.sms[0].body).toContain(`montant exact 45,10 $, message : ${o.interac!.reference}`);
    expect(h.sms[0].body).toMatch(/À envoyer avant \d/);
    expect(h.sms[0].body).not.toMatch(/24 ?h/);
    expect(o.interac!.smsAt).toBeTruthy();
    const s = interacSummary(o);
    expect(s).toMatchObject({ recipient: 'paiements@example.test', amount: TOTAL, reference: o.interac!.reference, autoDeposit: true, expiresAt: o.interac!.expiresAt });
    expect(Object.keys(s)).not.toContain('answer');
    expect(Object.keys(s)).not.toContain('question');
    expect(s.instructionsFr).toContain(`• Message : ${o.interac!.reference}`);
    expect(s.instructionsEn).toContain('Exact amount: $45.10');
    expect(o.events.map((e) => e.type)).toEqual(expect.arrayContaining(['received', 'awaiting_payment', 'interac_created', 'interac_sent']));
    // The tracking page shows the hold and what to send.
    const r = await receiveWebsiteOrder(payload({ customer: { name: 'Ana', phone: '514-555-1234', lang: 'en' } }));
    expect(r.ok && r.trackPath).toMatch(/^\/commander\/[a-z0-9-]+\/suivi\/[A-Za-z0-9_-]{20,}$/);
    const token = (r.ok && r.trackPath!.split('/').at(-1)) || '';
    expect(await trackOrder(token)).toMatchObject({ status: 'awaiting_payment', readyAt: null, interac: { recipient: 'paiements@example.test', autoDeposit: true } });
    expect(h.sms.at(-1)!.body).toMatch(/^Po Poulet: order W-\d+, total \$45\.10\. Pay by Interac e-Transfer to paiements@example\.test/);
  });

  it('auto-deposit off: question and answer are texted and sent to the site, the answer never reaches the outbox preview, the summary or the tracking page', async () => {
    await saveDeliverySettings({ interac: { autoDeposit: false, question: 'Couleur du camion', answer: 'Rouge' } as any });
    const o = await placed();
    expect(o.interac).toMatchObject({ autoDeposit: false, question: 'Couleur du camion', answer: 'Rouge' });
    expect(h.sms[0].body).toContain('Question de sécurité : Couleur du camion — réponse : Rouge.');
    expect(h.sms[0].preview).toContain('réponse : ••••');
    expect(h.sms[0].preview).not.toContain('Rouge');
    const s = interacSummary(o);
    expect(s).toMatchObject({ question: 'Couleur du camion', autoDeposit: false });
    expect(Object.keys(s)).not.toContain('answer');
    expect(s.instructionsFr).toContain('réponse : Rouge');
    expect(JSON.stringify(o.events)).not.toContain('Rouge');
    const r = await receiveWebsiteOrder(payload());
    const view = await trackOrder((r.ok && r.trackPath!.split('/').at(-1)) || '');
    expect(view?.interac).toMatchObject({ question: 'Couleur du camion' });
    expect(JSON.stringify(view)).not.toContain('Rouge');
    // Question without an answer: refused before any order is made.
    await saveDeliverySettings({ interac: { answer: '' } as any });
    expect(await receiveWebsiteOrder(payload())).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/security question or its answer is missing/) });
  });

  it('one reminder, then expiry: cancelled with a courtesy text that promises a person returns a transfer already sent', async () => {
    const o = await placed();
    const t0 = Date.parse(o.interac!.createdAt);
    expect(await tickInterac(t0 + 19 * 60_000)).toEqual({ checked: 1, cancelled: 0, reminded: 0 });
    expect(await tickInterac(t0 + 21 * 60_000)).toEqual({ checked: 1, cancelled: 0, reminded: 1 });
    expect(h.sms.at(-1)!.body).toMatch(/attend votre virement Interac .* Sans virement d’ici 24 min, elle sera annulée\./);
    expect(await tickInterac(t0 + 22 * 60_000)).toEqual({ checked: 1, cancelled: 0, reminded: 0 });
    expect(await tickInterac(t0 + 45 * 60_000)).toEqual({ checked: 1, cancelled: 1, reminded: 0 });
    const gone = (await getDirectOrder(o.id))!;
    expect(gone.status).toBe('cancelled');
    expect(gone.interac!.cancelledAt).toBeTruthy();
    expect(h.sms.at(-1)!.body).toBe(INTERAC_SMS.expired(gone, 'fr'));
    expect(h.sms.at(-1)!.body).toMatch(/annulée\. Si vous l’avez envoyé, une personne de notre équipe vous le retourne\./);
    expect(h.sms.at(-1)!.body).not.toMatch(/Aucun montant/);
    expect(h.clover).toBe(0);
    expect(await tickInterac(t0 + 50 * 60_000)).toEqual({ checked: 0, cancelled: 0, reminded: 0 });
  });

  it('the expansion tick runs the Interac check with own delivery on', async () => {
    const o = await placed();
    const out = await tickExpansion(Date.parse(o.interac!.createdAt) + 46 * 60_000);
    expect(out.interac).toEqual({ checked: 1, cancelled: 1, reminded: 0 });
    expect((await getDirectOrder(o.id))!.status).toBe('cancelled');
  });

  it('a person cancels from the console: the customer is told; "Transfer received" afterwards is a late transfer', async () => {
    const o = await placed();
    const c = await runDirectAction(o.id, 'cancel', actor, { reason: 'closed early' });
    expect(c.status).toBe('cancelled');
    expect(c.interac!.cancelReason).toContain('closed early');
    expect(h.sms.at(-1)!.body).toBe(INTERAC_SMS.cancelled(c, 'fr'));
    expect((await markInteracReceived(o.id, actor)).state).toBe('late');
  });
});

describe('release exactly once, by a person', () => {
  it('"Transfer received" → paid by that person, ONE Clover order (the ticket), in the kitchen, confirmation texted; a second press changes nothing', async () => {
    const o = await placed();
    const [a, b] = await Promise.all([markInteracReceived(o.id, actor), markInteracReceived(o.id, other)]);
    expect([a.state, b.state].sort()).toEqual(['already', 'released']);
    expect(h.clover).toBe(1);
    expect(createDirectOrderInClover).toHaveBeenCalledTimes(1);
    const paid = (await getDirectOrder(o.id))!;
    expect(paid).toMatchObject({ status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-1' });
    expect(paid.interac).toMatchObject({ receivedAt: expect.any(String), receivedBy: 'Marc', releasedAt: expect.any(String) });
    expect(paid.interac!.releaseClaim).toBeUndefined();
    expect(paid.attention).toBeUndefined();
    expect(paid.readyAt && Date.parse(paid.readyAt) > Date.now()).toBe(true);
    expect(paid.events.find((e) => e.type === 'paid')).toMatchObject({ by: 'Marc', message: expect.stringContaining(`Interac e-Transfer ${o.interac!.reference} received — 45.10 $ (confirmed by Marc)`) });
    expect(h.sms.at(-1)!.body).toMatch(/^Po Poulet : virement Interac reçu, merci! Commande W-\d+ prête pour emporter vers /);
    expect((await markInteracReceived(o.id, actor)).state).toBe('already');
    expect(h.clover).toBe(1);
    // The Clover order reads as paid by Interac, with the fee as its own line.
    const cart = buildDirectCloverCart(paid, null);
    expect(cart.orderCart.note).toContain(`PAYÉ — VIREMENT INTERAC ${o.interac!.reference}`);
    expect(cart.orderCart.lineItems).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Frais Interac e-Transfer', price: 500 })]));
    expect(cart.cents).toBe(2649 + 600 + 500);
    // The console action goes through the same path; the tracking page no longer shows the instructions.
    await expect(runDirectAction(o.id, 'interac_received', actor)).resolves.toMatchObject({ status: 'in_kitchen' });
    expect(h.clover).toBe(1);
  });

  it('Clover refuses the ticket: the order is paid and waits with "Send to Clover" (retry), never pressed "received" twice', async () => {
    const o = await placed();
    h.cloverFail = true;
    const r = await markInteracReceived(o.id, actor);
    expect(r.state).toBe('released');
    expect(r.order).toMatchObject({ status: 'new', payment: 'paid', posError: expect.stringContaining('HTTP 500') });
    h.cloverFail = false;
    const again = await runDirectAction(o.id, 'retry_clover', actor);
    expect(again).toMatchObject({ status: 'in_kitchen', posOrderId: 'CLV-2', posError: undefined });
    expect(h.clover).toBe(2);
  });

  it('a held Interac order refuses "Payment taken" / "Send to Clover" / "Ready"; a pickup can switch to pay at the counter', async () => {
    const o = await placed();
    await expect(runDirectAction(o.id, 'mark_paid', actor)).rejects.toThrow(/waits for its Interac e-Transfer/);
    await expect(runDirectAction(o.id, 'retry_clover', actor)).rejects.toThrow(/waits for its Interac e-Transfer/);
    await expect(runDirectAction(o.id, 'ready', actor)).rejects.toThrow(/not paid yet/);
    await expect(runDirectAction(o.id, 'resend_paylink', actor)).rejects.toThrow(/no payment link/);
    const again = await runDirectAction(o.id, 'interac_resend', actor);
    expect(again.events.filter((e) => e.type === 'interac_sent')).toHaveLength(2);
    const counter = await runDirectAction(o.id, 'pay_at_counter', actor);
    expect(counter).toMatchObject({ status: 'in_kitchen', payment: 'pay_at_pickup', posOrderId: 'CLV-1' });
    expect(counter.interac!.cancelReason).toBe('pay at the counter');
    expect(h.sms.at(-1)!.body).toMatch(/Paiement au comptoir/);
    expect((await markInteracReceived(o.id, actor)).state).toBe('already');
    expect(h.clover).toBe(1);
    // A delivery cannot: the courier never collects money.
    const d = await placed({ fulfillment: 'delivery', address: DROP });
    await expect(runDirectAction(d.id, 'pay_at_counter', actor)).rejects.toThrow(/delivery is paid before the courier leaves/);
    // Not an Interac order: the Interac buttons refuse.
    const legacy = await receiveWebsiteOrder({ id: 'W-leg', brand: 'Po Poulet', location: 'NDG', customer: { phone: '514-555-1234' }, fulfillment: 'pickup', items: [{ name: 'Poulet', quantity: 1, price: 12.5 }], paid: true });
    await expect(runDirectAction(legacy.ok ? legacy.order.id : '', 'interac_received', actor)).rejects.toThrow(/not paid by Interac/);
  });

  it('received AFTER the expiry: never released by itself — flagged once for a person, who sends it to the kitchen anyway or notes the refund by hand', async () => {
    const o = await placed();
    await tickInterac(Date.parse(o.interac!.createdAt) + 46 * 60_000);
    expect((await getDirectOrder(o.id))!.status).toBe('cancelled');
    const late = await markInteracReceived(o.id, actor);
    expect(late.state).toBe('late');
    expect(late.order.status).toBe('cancelled');
    expect(late.order.payment).toBe('unpaid');
    expect(late.order.attention).toMatch(/reçu après l’annulation .* une personne décide/);
    expect(late.order.interac!.lateTransfers).toEqual([{ at: expect.any(String), by: 'Marc' }]);
    expect(interacLatePending(late.order)).toBe(true);
    expect(h.clover).toBe(0);
    expect(h.chat.some((c) => /after the cancel/.test(c))).toBe(true);
    expect((await markInteracReceived(o.id, other)).state).toBe('late');
    expect((await getDirectOrder(o.id))!.interac!.lateTransfers).toHaveLength(1);
    await expect(runDirectAction(o.id, 'interac_received', actor)).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.clover).toBe(0);
    // Option A: send it to the kitchen anyway (once).
    const sent = await releaseLateInterac(o.id, other);
    expect(sent).toMatchObject({ status: 'in_kitchen', payment: 'paid', posOrderId: 'CLV-1', attention: undefined });
    expect(sent.interac!.lateTransfers![0]).toMatchObject({ releasedAt: expect.any(String), releasedBy: 'Léa' });
    expect(interacLatePending(sent)).toBe(false);
    await expect(releaseLateInterac(o.id, other)).rejects.toThrow(/already sent/);
    expect(h.clover).toBe(1);
    expect(h.sms.at(-1)!.body).toMatch(/virement Interac reçu, merci!/);
    // Option B, on another order: the money was returned by hand — noted, flag cleared, nothing printed.
    const p = await placed();
    await tickInterac(Date.parse(p.interac!.createdAt) + 46 * 60_000);
    await markInteracReceived(p.id, actor);
    await expect(markLateInteracRefunded(p.id, other)).resolves.toMatchObject({ status: 'cancelled', attention: undefined });
    expect((await getDirectOrder(p.id))!.interac!.lateTransfers![0]).toMatchObject({ refundedAt: expect.any(String), refundedBy: 'Léa' });
    await expect(markLateInteracRefunded(p.id, other)).rejects.toThrow(/No late transfer/);
    await expect(releaseLateInterac(p.id, other)).rejects.toThrow(/No late transfer/);
    expect(h.clover).toBe(1);
  });
});

describe('delivery: the courier is booked by the dispatch tick once the transfer is confirmed', () => {
  it('nothing while held (whatever "allow unpaid dispatch" says); booked after "Transfer received"', async () => {
    await saveDeliverySettings({ allowUnpaidDispatch: true, locations: { NDG: { enabled: true, autoDispatch: true, leadMinutes: 60, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } });
    const o = await placed({ fulfillment: 'delivery', address: DROP, deliveryFee: 4.99, total: totalsFor([{ name: 'a', quantity: 1, unitPrice: 24.99, total: 26.49, modifiers: [] }, { name: 'b', quantity: 1, unitPrice: 6, total: 6, modifiers: [] }], 4.99, 2, true, [FEE]).total });
    expect(o).toMatchObject({ status: 'awaiting_payment', fulfillment: 'delivery', deliveryFee: 4.99 });
    expect(await tickDispatch()).toEqual({ checked: 0, booked: 0 });
    expect(drive).toHaveLength(0);
    const r = await markInteracReceived(o.id, actor);
    expect(r.state).toBe('released');
    expect(r.order.attention).toBeUndefined();
    expect(h.sms.at(-1)!.body).toMatch(/virement Interac reçu, merci! Commande W-\d+ en préparation, livraison dans environ 45 minutes/);
    const t = await tickDispatch();
    expect(t.booked).toBe(1);
    expect(drive).toHaveLength(1);
    expect(drive[0].body).toMatchObject({ pickup_business_name: 'Po Poulet', dropoff_phone_number: '+15145551234', tip: 200, order_value: Math.round((r.order.subtotal + r.order.tax) * 100) });
    const after = (await getDirectOrder(o.id))!;
    expect(after.deliveryId).toBeTruthy();
    expect((await tickDispatch()).booked).toBe(0);
  });

  it('auto-dispatch off: released with a flag asking a person to call a courier', async () => {
    const o = await placed({ fulfillment: 'delivery', address: DROP });
    const r = await markInteracReceived(o.id, actor);
    expect(r.order.attention).toMatch(/appelez un livreur/);
    expect(r.order.status).toBe('in_kitchen');
  });
});

describe('settings: the answer never reaches the browser', () => {
  it('masked in the API shape; the mask sent back keeps the stored answer; an empty answer clears it; env fee fallback', async () => {
    await saveDeliverySettings({ interac: { autoDeposit: false, question: 'Ville ?', answer: 'Montréal' } as any });
    const s = await getDeliverySettings();
    expect(s.interac.answer).toBe('Montréal');
    const shown = maskDeliverySettings(s);
    expect(shown.interac.answer).toBe(INTERAC_ANSWER_MASK);
    expect(JSON.stringify(shown)).not.toContain('Montréal');
    await saveDeliverySettings({ interac: { ...shown.interac, question: 'Ville ?!' } });
    expect((await getDeliverySettings()).interac).toMatchObject({ answer: 'Montréal', question: 'Ville ?!' });
    await saveDeliverySettings({ interac: { answer: '' } as any });
    expect((await getDeliverySettings()).interac.answer).toBe('');
    expect(maskDeliverySettings(await getDeliverySettings()).interac.answer).toBe('');
    // Bounds and env fallback for the fee.
    expect(cleanInterac({ fee: -3, holdMinutes: 1, reminderMinutes: 9999, recipients: { 'bad code': 'x@y.z', NDG: 'not-an-email', SL: 'Ok@Example.test' } })).toMatchObject({ fee: 0, holdMinutes: 10, reminderMinutes: 240, recipients: { SL: 'ok@example.test' } });
    process.env.FOODHUB_INTERAC_FEE = '3.5';
    expect(cleanInterac(undefined).fee).toBe(3.5);
    expect(cleanInterac({ fee: 5 }).fee).toBe(5);
    expect(brandInitials('Po Poulet')).toBe('PP');
    expect(brandInitials('PPP Pizzeria')).toBe('PP');
    expect(brandInitials('Ooeuf')).toBe('OOE');
    expect(interacInstructions(await placed(), 'en')).toMatch(/^Pay order W-\d+ by Interac e-Transfer:\n• Recipient: paiements@example\.test\n• Exact amount: \$45\.10\n• Message: PP-[A-Z2-9]{4}\nSend it before /);
  });
});

describe('the webhook route', () => {
  const post = (body: unknown, auth = 'Bearer web-order-test') => websiteOrderRoute(new Request('https://hub.example.test/api/foodhub/webhooks/website-order', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  it('answers an Interac order with the instructions (contract B) and the tracking link; the same id twice → the same instructions', async () => {
    expect((await post(payload(), 'Bearer nope')).status).toBe(401);
    const body = payload();
    const res = await post(body);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, duplicate: false, number: expect.stringMatching(/^W-\d+$/), total: TOTAL, status: 'awaiting_payment', payment: 'unpaid', interac: { recipient: 'paiements@example.test', amount: TOTAL, reference: expect.stringMatching(/^PP-/), autoDeposit: true, instructionsFr: expect.stringContaining('Destinataire : paiements@example.test'), instructionsEn: expect.stringContaining('Recipient: paiements@example.test') }, trackUrl: expect.stringMatching(/^https:\/\/hub\.example\.test\/commander\/[a-z0-9-]+\/suivi\//) });
    expect(JSON.stringify(j)).not.toContain('"answer"');
    const again = await (await post(body)).json();
    expect(again).toMatchObject({ ok: true, duplicate: true, id: j.id, interac: { reference: j.interac.reference } });
    const bad = await post(payload({ fees: [] }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/needs the fee line/);
  });
});
