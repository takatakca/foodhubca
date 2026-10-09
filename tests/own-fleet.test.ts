// Our own couriers, the third fleet (docs/ON2GO_HUB_ECOSYSTEM.md § 5): off by default; when on, dispatch compares our
// cost per delivery with DoorDash Drive and books the cheapest; the delivery goes to the courier on shift with the fewest
// running deliveries; his personal link (revocable) opens his page; his taps move the delivery and the order through the
// same path as the fleet webhooks; a decline or a problem flags the order for a person; nobody sees another's deliveries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocation } from '../lib/foodhub/catalog';
import { courierAction, courierBoard, handleCourierRequest } from '../lib/foodhub/delivery/courier-app';
import { dispatchOrder, fleetReadiness } from '../lib/foodhub/delivery/dispatch';
import { createDirectOrder } from '../lib/foodhub/delivery/orders';
import { courierFromToken, getOwnFleet, newCourierLink, pickCourier, saveOwnFleet } from '../lib/foodhub/delivery/own-fleet';
import { getDelivery, getDirectOrder, saveDeliverySettings } from '../lib/foodhub/delivery/store';
import { setFeature } from '../lib/foodhub/expansion/features';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

const actor = { username: 'mgr', name: 'Marc', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let driveFee = 975;
let calls: string[] = [];
let sms: string[] = [];

const ENV = ['DOORDASH_DRIVE_DEVELOPER_ID', 'DOORDASH_DRIVE_KEY_ID', 'DOORDASH_DRIVE_SIGNING_SECRET', 'DOORDASH_DRIVE_ENV', 'UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET', 'LIVE_CONNECTORS_GLOBAL_ENABLED'];

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.SESSION_SECRET = 'test-session-secret-for-courier-links';
  process.env.FOODHUB_PUBLIC_URL = 'https://hub.test';
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, {
    DOORDASH_DRIVE_DEVELOPER_ID: 'dev-1', DOORDASH_DRIVE_KEY_ID: 'key-1', DOORDASH_DRIVE_SIGNING_SECRET: Buffer.from('drive-secret').toString('base64'),
    TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000',
  });
  driveFee = 975; calls = []; sms = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    calls.push(u);
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/drive/v2/quotes')) return json({ external_delivery_id: body.external_delivery_id, delivery_status: 'quote', fee: driveFee, currency: 'CAD' });
    if (/\/drive\/v2\/quotes\/.+\/accept$/.test(u)) return json({ external_delivery_id: u.split('/').at(-2), delivery_status: 'created', fee: driveFee, tracking_url: 'https://track.doordash.com/x' });
    if (u.includes('/Messages.json')) { sms.push(new URLSearchParams(String(init.body)).get('Body') ?? ''); return json({ sid: 'SM1' }, 201); }
    return json({ ok: true });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await saveLocation({ code: 'JT', name: 'Saint-Léonard', address: '5839 Rue Jean-Talon E', city: 'Montréal', postalCode: 'H1S 1M2', phone: '514 555-0200', active: true });
  await setFeature('delivery', true, actor);
  await saveDeliverySettings({ compareQuotes: false, locations: { NDG: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 8, postalPrefixes: [], maxAutoFee: 15 } } });
});
afterEach(() => { globalThis.fetch = realFetch; });

const DROP = { street: '5555 Monkland Ave', unit: '3', city: 'Montréal', province: 'QC', postalCode: 'H4A 1E1', country: 'CA', instructions: 'Code 1234' };
const LINES = [{ name: 'Poulet entier', quantity: 1, unitPrice: 24.99, total: 24.99, modifiers: [] }];
const order = () => createDirectOrder({ source: 'manual', brandName: 'Po Poulet', locationCode: 'NDG', customer: { name: 'Ana Bel', phone: '514 555 1234' }, fulfillment: 'delivery', dropoff: DROP, lines: LINES, payment: 'paid', tip: 4, deliveryFee: 4.99 }, actor);

async function twoCouriers(enabled = true) {
  return saveOwnFleet({
    enabled, costPerDelivery: 6,
    couriers: [
      { name: 'Sami', phone: '514 555 0301', locations: ['NDG'], onShift: true },
      { name: 'Lina', phone: '514 555 0302', locations: ['NDG', 'JT'], onShift: true },
      { name: 'Paul', phone: '514 555 0303', locations: ['JT'], onShift: false },
    ],
  }, actor);
}

describe('our couriers as the third fleet', () => {
  it('is off by default: dispatch only asks DoorDash Drive, exactly as before', async () => {
    expect((await getOwnFleet()).enabled).toBe(false);
    const r = await dispatchOrder((await order()).id, actor);
    expect(r.ok).toBe(true);
    expect(r.delivery!.fleet).toBe('doordash_drive');
    expect(r.quotes!.map((q) => q.fleet)).toEqual(['doordash_drive']);
    expect(fleetReadiness().map((f) => f.fleet)).toContain('own_fleet');
  });

  it('when on, compares our cost with Drive and books the cheapest — our courier with the fewest running deliveries', async () => {
    await twoCouriers();
    const first = await dispatchOrder((await order()).id, actor);
    expect(first.ok).toBe(true);
    expect(first.delivery).toMatchObject({ fleet: 'own_fleet', status: 'assigned', fee: 6, courier: { name: 'Lina' } });
    expect(first.quotes!.map((q) => `${q.fleet}:${q.fee}`)).toEqual(['own_fleet:6', 'doordash_drive:9.75']);
    expect(calls.some((u) => /\/accept$/.test(u))).toBe(false); // Drive was only asked for a price
    // Next one goes to the other courier on shift at NDG (fewest running deliveries).
    const second = await dispatchOrder((await order()).id, actor);
    expect(second.delivery!.courier!.name).toBe('Sami');
    // Drive cheaper than our cost: Drive is booked.
    driveFee = 450;
    const third = await dispatchOrder((await order()).id, actor);
    expect(third.delivery!.fleet).toBe('doordash_drive');
  });

  it('nobody on shift for that kitchen: Drive takes it', async () => {
    await saveOwnFleet({ enabled: true, couriers: [{ name: 'Paul', phone: '514 555 0303', locations: ['JT'], onShift: true }] }, actor);
    expect(await pickCourier('NDG')).toBeNull();
    const r = await dispatchOrder((await order()).id, actor);
    expect(r.delivery!.fleet).toBe('doordash_drive');
    expect(r.quotes!.find((q) => q.fleet === 'own_fleet')!.error).toMatch(/on shift for NDG/);
  });
});

describe('the courier page', () => {
  it('a personal link opens his board; a new link cancels the old one; an inactive courier is locked out', async () => {
    const s = await twoCouriers();
    const lina = s.couriers.find((c) => c.name === 'Lina')!;
    const link = await newCourierLink(lina.id);
    expect(link).toMatch(/^https:\/\/hub\.test\/courier#t=[\w-]+\.[\w-]+$/);
    const token = link.split('#t=')[1];
    expect((await courierFromToken(token))!.name).toBe('Lina');
    const fresh = (await newCourierLink(lina.id)).split('#t=')[1];
    expect(await courierFromToken(token)).toBeNull();
    expect((await courierFromToken(fresh))!.id).toBe(lina.id);
    expect((await handleCourierRequest('forged.token')).status).toBe(401);
    await saveOwnFleet({ couriers: (await getOwnFleet()).couriers.map((c) => (c.id === lina.id ? { ...c, active: false } : c)) }, actor);
    expect(await courierFromToken(fresh)).toBeNull();
  });

  it('his taps move the delivery and the order: at the kitchen → picked up → delivered', async () => {
    await twoCouriers();
    const o = await order();
    const r = await dispatchOrder(o.id, actor);
    const lina = (await getOwnFleet()).couriers.find((c) => c.name === 'Lina')!;
    const token = (await newCourierLink(lina.id)).split('#t=')[1];
    const board = await handleCourierRequest(token);
    const stops = (board.data.board as any).stops;
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ number: o.number, brand: 'Po Poulet', paid: true, tip: 4, dropoff: { name: 'Ana Bel', unit: '3', phone: '+15145551234', instructions: 'Code 1234' }, pickup: { phone: '+15145550100' } });

    expect((await handleCourierRequest(token, { action: 'at_pickup', deliveryId: r.delivery!.id })).status).toBe(200);
    expect((await handleCourierRequest(token, { action: 'picked_up', deliveryId: r.delivery!.id })).status).toBe(200);
    expect((await getDirectOrder(o.id))!.status).toBe('out_for_delivery');
    // Statuses only move forward.
    expect((await handleCourierRequest(token, { action: 'at_pickup', deliveryId: r.delivery!.id })).status).toBe(409);
    await handleCourierRequest(token, { action: 'delivered', deliveryId: r.delivery!.id });
    expect((await getDelivery(r.delivery!.id))!.status).toBe('delivered');
    expect((await getDirectOrder(o.id))!.status).toBe('completed');
    // Over: the customer's address is gone from his page.
    expect(((await courierBoard(lina)).stops)).toHaveLength(0);
  });

  it('a decline (before pickup) or a problem flags the order for a person; another courier cannot touch it', async () => {
    await twoCouriers();
    const o = await order();
    const r = await dispatchOrder(o.id, actor);
    const fleet = await getOwnFleet();
    const lina = fleet.couriers.find((c) => c.name === 'Lina')!;
    const sami = fleet.couriers.find((c) => c.name === 'Sami')!;
    expect(await courierAction(sami, r.delivery!.id, 'picked_up')).toEqual({ ok: false, message: 'This delivery is not yours.' });
    expect((await courierAction(lina, r.delivery!.id, 'problem')).ok).toBe(false); // a problem needs words
    expect((await courierAction(lina, r.delivery!.id, 'problem', 'Building door locked')).ok).toBe(true);
    expect((await getDirectOrder(o.id))!.attention).toBe('Courier Lina: Building door locked');
    expect((await courierAction(lina, r.delivery!.id, 'decline', 'flat tire')).ok).toBe(true);
    expect((await getDelivery(r.delivery!.id))).toMatchObject({ status: 'cancelled', cancelReason: 'Declined by Lina — flat tire' });
    expect((await getDirectOrder(o.id))!.attention).toMatch(/Cancelled by the courier service — Declined by Lina/);
  });

  it('shift on/off from his page decides whether he gets deliveries', async () => {
    const s = await twoCouriers();
    const paul = s.couriers.find((c) => c.name === 'Paul')!;
    const token = (await newCourierLink(paul.id)).split('#t=')[1];
    expect(await pickCourier('JT')).toMatchObject({ name: 'Lina' });
    await handleCourierRequest(token, { action: 'shift', onShift: true });
    await handleCourierRequest((await newCourierLink(s.couriers.find((c) => c.name === 'Lina')!.id)).split('#t=')[1], { action: 'shift', onShift: false });
    expect(await pickCourier('JT')).toMatchObject({ name: 'Paul' });
  });

  it('refuses bad courier records', async () => {
    await expect(saveOwnFleet({ couriers: [{ name: 'X', phone: 'abc', locations: ['NDG'] }] }, actor)).rejects.toThrow(/phone number/);
    await expect(saveOwnFleet({ couriers: [{ name: 'X', phone: '514 555 0399', locations: [] }] }, actor)).rejects.toThrow(/at least one kitchen/);
    await expect(saveOwnFleet({ couriers: [{ name: 'A', phone: '514 555 0399', locations: ['NDG'] }, { name: 'B', phone: '514-555-0399', locations: ['NDG'] }] }, actor)).rejects.toThrow(/already used/);
    await expect(saveOwnFleet({ costPerDelivery: -1 }, actor)).rejects.toThrow(/Cost per delivery/);
  });
});
