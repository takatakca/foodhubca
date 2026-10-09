// Own-order delivery: DoorDash Drive quote → accept, safety checks (paid, address, area, alcohol), fleet webhooks moving
// the order forward only, the customer's tracking text, auto-dispatch timing and fee limit, cancel, Uber Direct signing,
// and the website order intake.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocationAlcohol } from '../lib/foodhub/alcohol/rules';
import { saveLocation } from '../lib/foodhub/catalog';
import { cancelCourier, dispatchOrder, dispatchProblems, tickDispatch } from '../lib/foodhub/delivery/dispatch';
import { driveBody, driveEventStatus } from '../lib/foodhub/delivery/doordash-drive';
import { createDirectOrder, runDirectAction } from '../lib/foodhub/delivery/orders';
import { getDelivery, getDirectOrder, saveDeliverySettings } from '../lib/foodhub/delivery/store';
import { uberDeliveryBody, uberDirect } from '../lib/foodhub/delivery/uber-direct';
import { handleFleetWebhook } from '../lib/foodhub/delivery/webhook';
import { receiveWebsiteOrder } from '../lib/foodhub/delivery/website';
import { setFeature } from '../lib/foodhub/expansion/features';
import { getRepo } from '../lib/foodhub/repo';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

const actor = { username: 'mgr', name: 'Marc', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body: any; headers: Record<string, string> }> = [];
let quoteFee = 975;

const ENV = ['DOORDASH_DRIVE_DEVELOPER_ID', 'DOORDASH_DRIVE_KEY_ID', 'DOORDASH_DRIVE_SIGNING_SECRET', 'DOORDASH_DRIVE_ENV', 'DOORDASH_DRIVE_WEBHOOK_SECRET', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'UBER_DIRECT_WEBHOOK_SECRET', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'];

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  for (const k of ENV) delete process.env[k];
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  Object.assign(process.env, {
    DOORDASH_DRIVE_DEVELOPER_ID: 'dev-1', DOORDASH_DRIVE_KEY_ID: 'key-1', DOORDASH_DRIVE_SIGNING_SECRET: Buffer.from('drive-secret').toString('base64'),
    DOORDASH_DRIVE_WEBHOOK_SECRET: 'drive-hook-token', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000',
  });
  calls = [];
  quoteFee = 975;
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    const body = init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : String(init.body)) : null;
    calls.push({ url: u, method: String(init.method ?? 'GET'), body, headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/drive/v2/quotes')) return json({ external_delivery_id: body.external_delivery_id, delivery_status: 'quote', fee: quoteFee, currency: 'CAD', dropoff_time_estimated: '2026-10-07T23:00:00Z' });
    if (/\/drive\/v2\/quotes\/.+\/accept$/.test(u)) return json({ external_delivery_id: u.split('/').at(-2), delivery_status: 'created', fee: quoteFee, tracking_url: 'https://track.doordash.com/x', support_reference: '123' });
    if (/\/drive\/v2\/deliveries\/.+\/cancel$/.test(u)) return json({ external_delivery_id: u.split('/').at(-2), delivery_status: 'cancelled' });
    if (u.includes('/Messages.json')) return json({ sid: 'SM1' }, 201);
    return json({ ok: true });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG — 6280 Somerled', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await setFeature('delivery', true, actor);
  await saveDeliverySettings({ compareQuotes: false, locations: { NDG: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } });
});
afterEach(() => { globalThis.fetch = realFetch; });

const DROP = { street: '5555 Monkland Ave', unit: '3', city: 'Montréal', province: 'QC', postalCode: 'H4A 1E1', country: 'CA', instructions: 'Code 1234' };
const LINES = [{ name: 'Poulet entier', quantity: 1, unitPrice: 24.99, total: 24.99, modifiers: [{ name: 'Piri-piri', quantity: 1, unitPrice: 0 }] }];

async function order(extra: Record<string, unknown> = {}) {
  return createDirectOrder({ source: 'manual', brandName: 'Po Poulet', locationCode: 'NDG', customer: { name: 'Ana Bel', phone: '514 555 1234' }, fulfillment: 'delivery', dropoff: DROP, lines: LINES, payment: 'paid', tip: 4, deliveryFee: 4.99, ...extra }, actor);
}

describe('booking a DoorDash Drive courier', () => {
  it('quotes then accepts, with every field DoorDash requires', async () => {
    const o = await order();
    expect(o.number).toMatch(/^M-\d+/);
    expect(o.total).toBeCloseTo(24.99 + 4.99 + (24.99 + 4.99) * 0.14975 + 4, 2);
    expect(await dispatchProblems(o)).toEqual([]);
    const r = await dispatchOrder(o.id, actor);
    expect(r.ok).toBe(true);
    const quote = calls.find((c) => c.url.endsWith('/drive/v2/quotes'))!;
    expect(quote.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(quote.body).toMatchObject({
      pickup_business_name: 'Po Poulet', pickup_phone_number: '+15145550100', pickup_address: '6280 Somerled Ave, Montréal, QC H4V 1R9, Canada',
      dropoff_address: '5555 Monkland Ave, #3, Montréal, QC H4A 1E1, Canada', dropoff_phone_number: '+15145551234', dropoff_contact_given_name: 'Ana', dropoff_contact_family_name: 'Bel',
      order_value: Math.round((24.99 + o.tax) * 100), tip: 400, currency: 'CAD', pickup_reference_tag: o.number, contactless_dropoff: false, action_if_undeliverable: 'return_to_pickup',
      items: [{ name: 'Poulet entier', quantity: 1, price: 2499, description: 'Piri-piri' }],
    });
    expect(quote.body.dropoff_instructions).toContain('Code 1234');
    expect(quote.body.order_contains).toBeUndefined();
    expect(calls.some((c) => c.url.endsWith(`/drive/v2/quotes/${quote.body.external_delivery_id}/accept`) && c.body.tip === 400)).toBe(true);
    expect(r.delivery).toMatchObject({ fleet: 'doordash_drive', environment: 'sandbox', status: 'created', fee: 9.75, trackingUrl: 'https://track.doordash.com/x', requestedBy: 'Marc' });
    expect((await getDirectOrder(o.id))!.deliveryId).toBe(r.delivery!.id);
    // A second request does not book a second courier.
    expect((await dispatchOrder(o.id, actor)).message).toMatch(/already booked/);
  });

  it('refuses unpaid orders, pickup orders, a missing phone, and a closed kitchen rule', async () => {
    expect(await dispatchProblems(await order({ payment: 'unpaid' }))).toContain('Not paid yet — couriers do not collect money. Take the payment, then tap "Payment taken".');
    expect((await dispatchProblems(await order({ fulfillment: 'pickup' })))).toContain('This is a pickup order.');
    expect((await dispatchProblems(await order({ customer: { name: 'X' } })))[0]).toMatch(/phone number is missing/);
    await saveDeliverySettings({ locations: { NDG: { enabled: false } as any } });
    expect((await dispatchProblems(await order())).join(' ')).toMatch(/not turned on for NDG/);
    expect(calls.filter((c) => c.url.includes('/drive/'))).toHaveLength(0);
  });

  it('alcohol: blocked without permit + agreement, then flagged for the Dasher ID check', async () => {
    const withBeer = [...LINES, { name: 'Bière', quantity: 1, unitPrice: 7, total: 7, modifiers: [], alcohol: true }];
    const o = await order({ lines: withBeer });
    expect(o.containsAlcohol).toBe(true);
    expect((await dispatchProblems(o)).join(' ')).toMatch(/Alcohol: Alcohol is turned off/);
    await setFeature('alcohol', true, actor);
    await saveLocationAlcohol('NDG', { permitType: 'restaurant', permitNumber: 'R-1', verify: true, channels: { own_delivery: true } }, actor);
    expect((await dispatchProblems(o, undefined, Date.parse('2026-10-07T22:00:00Z'))).join(' ')).toMatch(/written agreement/);
    await saveLocationAlcohol('NDG', { thirdPartyAgreement: true, channels: { own_delivery: true } }, actor);
    expect(await dispatchProblems(o, undefined, Date.parse('2026-10-07T22:00:00Z'))).toEqual([]);
    expect((await dispatchProblems(o, undefined, Date.parse('2026-10-08T03:30:00Z'))).join(' ')).toMatch(/legal sale hours/);
    const beerOnly = await order({ lines: [withBeer[1]] });
    expect((await dispatchProblems(beerOnly, undefined, Date.parse('2026-10-07T22:00:00Z'))).join(' ')).toMatch(/only with food/);
    const body = driveBody({ id: 'x', reference: 'M-1', pickup: { businessName: 'B', address: 'a', phone: '+15145550100', locationCode: 'NDG' }, dropoff: { name: 'n', address: 'd', phone: '+15145551234' }, orderValue: 10, tip: 1, currency: 'CAD', items: [], containsAlcohol: true, undeliverable: 'dispose', fleetSms: true });
    expect(body).toMatchObject({ order_contains: { alcohol: true }, action_if_undeliverable: 'return_to_pickup', contactless_dropoff: false });
  });

  it('production credentials send nothing until the live switch is on', async () => {
    process.env.DOORDASH_DRIVE_ENV = 'production';
    const r = await dispatchOrder((await order()).id, actor);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/LIVE_CONNECTORS_GLOBAL_ENABLED/);
    expect(calls.filter((c) => c.url.includes('/drive/'))).toHaveLength(0);
  });
});

function driveHook(body: Record<string, unknown>, token = 'drive-hook-token') {
  return handleFleetWebhook('doordash_drive', new Request('https://hub.test/api/foodhub/webhooks/doordash-drive', { method: 'POST', headers: { Authorization: `Basic ${token}` }, body: JSON.stringify(body) }));
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('DoorDash Drive webhooks', () => {
  it('move the delivery and the order forward, text the tracking link once, ignore late events', async () => {
    const o = await order();
    const d = (await dispatchOrder(o.id, actor)).delivery!;
    expect((await driveHook({ event_name: 'DASHER_CONFIRMED', external_delivery_id: d.id }, 'wrong')).status).toBe(401);
    expect((await driveHook({ event_name: 'DASHER_CONFIRMED', external_delivery_id: d.id, dasher_name: 'Lea', dasher_location: { lat: 45.47, lng: -73.61 } })).status).toBe(200);
    await settle();
    expect((await getDelivery(d.id))).toMatchObject({ status: 'assigned', courier: { name: 'Lea', lat: 45.47 } });
    const sms = calls.filter((c) => c.url.includes('/Messages.json'));
    expect(sms).toHaveLength(1);
    expect(String(sms[0].body)).toContain(encodeURIComponent('https://track.doordash.com/x'));
    await driveHook({ event_name: 'DASHER_PICKED_UP', external_delivery_id: d.id });
    await settle();
    expect((await getDirectOrder(o.id))!.status).toBe('out_for_delivery');
    await driveHook({ event_name: 'DASHER_DROPPED_OFF', external_delivery_id: d.id });
    await settle();
    expect((await getDirectOrder(o.id))!.status).toBe('completed');
    await driveHook({ event_name: 'DASHER_CONFIRMED_PICKUP_ARRIVAL', external_delivery_id: d.id });
    await settle();
    expect((await getDelivery(d.id))!.status).toBe('delivered');
    expect(calls.filter((c) => c.url.includes('/Messages.json'))).toHaveLength(1);
  });

  it('a courier cancellation flags the order for a person; unknown deliveries are kept', async () => {
    const o = await order();
    const d = (await dispatchOrder(o.id, actor)).delivery!;
    await driveHook({ event_name: 'DELIVERY_CANCELLED', external_delivery_id: d.id, cancellation_reason_message: 'No Dasher available' });
    await settle();
    expect((await getDirectOrder(o.id))!.attention).toMatch(/Cancelled by the courier service — No Dasher available/);
    await driveHook({ event_name: 'DASHER_CONFIRMED', external_delivery_id: 'nobody' });
    await settle();
    expect((await getRepo().listDocs('delivery_webhooks')).length).toBe(1);
    expect(driveEventStatus('dasher_enroute_to_dropoff')).toBe('picked_up');
  });
});

describe('auto-dispatch and cancel', () => {
  it('books at ready time − lead minutes, stops above the fee limit', async () => {
    await saveDeliverySettings({ locations: { NDG: { enabled: true, autoDispatch: true, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } });
    const o = await order();
    const ready = Date.parse(o.readyAt!);
    expect((await tickDispatch(ready - 20 * 60_000)).booked).toBe(0);
    expect((await tickDispatch(ready - 9 * 60_000)).booked).toBe(1);
    quoteFee = 2500;
    const pricey = await order();
    expect((await tickDispatch(Date.parse(pricey.readyAt!))).booked).toBe(0);
    const after = (await getDirectOrder(pricey.id))!;
    expect(after.attention).toMatch(/above the 15.00 \$ auto limit/);
    expect(after.deliveryId).toBeUndefined();
    expect((await tickDispatch(Date.parse(pricey.readyAt!) + 10 * 60_000)).booked).toBe(0);
  });

  it('cancel calls DoorDash, and a cancelled order frees the board', async () => {
    const o = await order();
    await dispatchOrder(o.id, actor);
    const r = await cancelCourier(o.id, actor, 'Customer cancelled');
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/cancel'))).toBe(true);
    expect((await getDelivery(r.delivery!.id))!.status).toBe('cancelled');
    const cancelled = await runDirectAction(o.id, 'cancel', actor, { reason: 'Customer called' });
    expect(cancelled.events.at(-1)!.message).toMatch(/already paid: refund it in Clover/);
  });
});

describe('Uber Direct', () => {
  it('verifies signed webhooks and builds structured addresses with the ID check', () => {
    process.env.UBER_DIRECT_WEBHOOK_SECRET = 'uber-key';
    const raw = JSON.stringify({ kind: 'event.delivery_status', delivery_id: 'del_1', status: 'pickup_complete', data: { id: 'del_1', external_id: 'fhd-1' } });
    const sig = crypto.createHmac('sha256', 'uber-key').update(raw).digest('hex');
    expect(uberDirect.verifyWebhook(new Headers({ 'x-uber-signature': sig }), raw)).toBe(true);
    expect(uberDirect.verifyWebhook(new Headers({ 'x-uber-signature': 'bad' }), raw)).toBe(false);
    expect(uberDirect.parseWebhook(JSON.parse(raw))).toMatchObject({ ref: 'fhd-1', fleetDeliveryId: 'del_1', status: 'picked_up' });
    const body = uberDeliveryBody({ id: 'fhd-1', reference: 'M-1', pickup: { businessName: 'Po Poulet', address: 'x', parts: { street: '6280 Somerled Ave', city: 'Montréal', province: 'QC', postalCode: 'H4V 1R9', country: 'CA' }, phone: '514 555 0100', locationCode: 'NDG' }, dropoff: { name: 'Ana', address: 'y', phone: '5145551234' }, orderValue: 30, tip: 3, currency: 'CAD', items: [{ name: 'Poulet', quantity: 1, price: 24.99 }], containsAlcohol: true, minAge: 18, undeliverable: 'dispose', fleetSms: true }, 'dqt_1');
    expect(JSON.parse(body.pickup_address)).toEqual({ street_address: ['6280 Somerled Ave'], city: 'Montréal', state: 'QC', zip_code: 'H4V 1R9', country: 'CA' });
    expect(body).toMatchObject({ quote_id: 'dqt_1', external_id: 'fhd-1', manifest_total_value: 3000, tip: 300, undeliverable_action: 'return', dropoff_verification: { identification: { min_age: 18 } } });
  });
});

describe('website orders', () => {
  it('creates once per website id and refuses alcohol the rules do not allow', async () => {
    const payload = { id: 'W-77', brand: 'Po Poulet', location: 'NDG', customer: { name: 'Ana', phone: '514-555-1234' }, fulfillment: 'delivery', address: '5555 Monkland Ave, Montréal, QC H4A 1E1', items: [{ name: 'Poulet', quantity: 2, price: 12.5 }], paid: true, tip: 2 };
    const a = await receiveWebsiteOrder(payload);
    const b = await receiveWebsiteOrder(payload);
    expect(a.ok && b.ok && a.order.id === b.order.id && b.duplicate).toBe(true);
    if (a.ok) expect(a.order).toMatchObject({ source: 'website', payment: 'paid', subtotal: 25, dropoff: { postalCode: 'H4A 1E1' } });
    const beer = await receiveWebsiteOrder({ ...payload, id: 'W-78', items: [{ name: 'Bière', quantity: 1, price: 7, alcohol: true }] });
    expect(beer).toMatchObject({ ok: false, status: 422 });
  });
});

describe('Settings → Expansion readiness', () => {
  it('asks for a phone only at the kitchens that deliver their own orders', async () => {
    const { expansionSummary } = await import('../lib/foodhub/expansion/summary');
    const phoneCheck = async () => (await expansionSummary()).features.find((f) => f.key === 'delivery')!.checks.find((c) => c.href === '/settings/business')!;
    expect(await phoneCheck()).toMatchObject({ ok: true }); // NDG delivers and has a phone; the seeded kitchens without one do not deliver
    await saveLocation({ code: 'NDG', name: 'NDG — 6280 Somerled', address: '6280 Somerled Ave', active: true });
    expect(await phoneCheck()).toMatchObject({ ok: false, en: expect.stringContaining('NDG — 6280 Somerled') });
  });
});
