import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../app/api/foodhub/kitchen/print-queue/route';
import { POST } from '../app/api/foodhub/kitchen/print-queue/[orderId]/printed/route';
import { sessionCookieFor } from '../lib/foodhub/auth';
import { saveDirectOrder } from '../lib/foodhub/delivery/store';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import { enrollDevice } from '../lib/foodhub/identity/devices';
import { buildPrintQueue, claimTabletPrint, parseSince } from '../lib/foodhub/kitchen/print-queue';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder, StoredOrder } from '../lib/foodhub/types';

const BASE = 'http://localhost/api/foodhub/kitchen/print-queue';
const DEVICE = 'tablet-test-0001';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function fresh() {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.SESSION_SECRET = 'print-queue-test-secret-0123456789-abcdefghijkl';
  process.env.DASHBOARD_PASSWORD = 'print-queue-owner-password';
  (globalThis as any).__foodhubMem = undefined;
}

async function ownerCookie() {
  return (await sessionCookieFor(null, 'password')).split(';')[0];
}

async function addOrder(over: Partial<NormalizedOrder> & { locationCode?: string; createdAt?: string } = {}): Promise<StoredOrder> {
  const n: NormalizedOrder & { locationCode?: string; createdAt?: string } = {
    channel: 'doordash', marketplace: 'doordash', externalOrderId: `ext-${Math.random().toString(36).slice(2)}`, displayId: 'D42', channelStoreId: 'store-1',
    brandName: 'Burger Test', customerName: 'Alex Martin', fulfillment: 'delivery', placedAt: ago(1), currency: 'CAD',
    subtotal: 10, tax: 1.5, deliveryFee: 0, tip: 0, discount: 0, total: 11.5, lines: [{ name: 'Burger', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }], raw: {},
    locationCode: 'NDG', createdAt: ago(1), ...over,
  };
  return (await getRepo().insertOrderIfNew(n)).order;
}

async function addDirect(over: Partial<DirectOrder> = {}): Promise<DirectOrder> {
  const at = ago(1);
  return saveDirectOrder({
    id: `d-${Math.random().toString(36).slice(2)}`, number: 'T-100', source: 'phone', brandName: 'Burger Test', locationCode: 'NDG', customer: { name: 'Sam Roy' },
    fulfillment: 'pickup', lines: [{ name: 'Frites', quantity: 2, unitPrice: 4, total: 8, modifiers: [] }], subtotal: 8, tax: 1.2, deliveryFee: 0, tip: 0, total: 9.2,
    currency: 'CAD', payment: 'paid', status: 'in_kitchen', containsAlcohol: false, placedAt: at, events: [], createdAt: at, updatedAt: at, ...over,
  } as DirectOrder);
}

const get = (qs: string, cookie?: string) => GET(new Request(`${BASE}${qs}`, { headers: cookie ? { cookie } : {} }));
const claim = (orderId: string, body: Record<string, unknown>, cookie?: string) =>
  POST(new Request(`${BASE}/${encodeURIComponent(orderId)}/printed`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ orderId }) });

describe('kitchen print queue: who may call', () => {
  beforeEach(fresh);

  it('answers 401 without a session or an enrolled tablet', async () => {
    expect((await get('?location=NDG')).status).toBe(401);
    expect((await claim('x', { deviceId: DEVICE })).status).toBe(401);
    expect((await get('?location=NDG', 'takatak_session=forged.value')).status).toBe(401);
  });

  it('a signed-in owner must name the kitchen; a one-kitchen person does not', async () => {
    const cookie = await ownerCookie();
    const r = await get('', cookie);
    expect(r.status).toBe(400);
    expect((await r.json()).needLocation).toBe(true);
    const okRes = await get('?location=NDG', cookie);
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body.location).toBe('NDG');
    expect(body.items).toEqual([]);

    await getRepo().saveUser({ username: 'cook', name: 'Cook', role: 'operator', locations: ['VERDUN'], active: true, passwordHash: null });
    const cook = (await sessionCookieFor((await getRepo().getUser('cook'))!, 'otp')).split(';')[0];
    expect((await (await get('', cook)).json()).location).toBe('VERDUN');
    expect((await get('?location=NDG', cook)).status).toBe(403);
  });

  it('an enrolled tablet (device cookie only, PIN screen) reads its own kitchen and no other', async () => {
    const { cookie } = await enrollDevice({ name: 'Tablette NDG', locationCode: 'NDG' }, { name: 'Owner', source: 'dashboard' } as any);
    const dev = cookie.split(';')[0];
    await addOrder();
    const r = await get(`?device=${DEVICE}`, dev);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.location).toBe('NDG');
    expect(body.items).toHaveLength(1);
    expect((await get('?location=VERDUN', dev)).status).toBe(403);
  });
});

describe('kitchen print queue: since cursor', () => {
  beforeEach(fresh);

  it('parses, defaults to 15 minutes back and clamps to 24 hours and now', () => {
    const now = Date.parse('2026-10-30T16:00:00Z');
    expect(parseSince(null, now)).toBe('2026-10-30T15:45:00.000Z');
    expect(parseSince('garbage', now)).toBe('2026-10-30T15:45:00.000Z');
    expect(parseSince('2026-10-30T15:59:00Z', now)).toBe('2026-10-30T15:59:00.000Z');
    expect(parseSince('2026-10-01T00:00:00Z', now)).toBe('2026-10-29T16:00:00.000Z');
    expect(parseSince('2027-01-01T00:00:00Z', now)).toBe('2026-10-30T16:00:00.000Z');
  });

  it('returns only orders that reached this kitchen since the cursor, with a ticket at the paper width', async () => {
    const old = await addOrder({ createdAt: ago(30), displayId: 'OLD' });
    const recent = await addOrder({ createdAt: ago(2), displayId: 'NEW' });
    await addOrder({ createdAt: ago(2), displayId: 'ELSEWHERE', locationCode: 'VERDUN' });
    const q = await buildPrintQueue({ location: 'NDG', since: ago(10), paper: '58' });
    expect(q.items.map((i) => i.orderId)).toEqual([recent.id]);
    expect(q.width).toBe(32);
    expect(q.items[0].ticket).toContain('@@HBC #NEW');
    for (const line of q.items[0].ticket.split('\n')) expect(line.replace(/^@@[A-Z]* /, '').length).toBeLessThanOrEqual(32);
    const wider = await buildPrintQueue({ location: 'NDG', since: ago(60), paper: '80', lang: 'en' });
    expect(wider.items.map((i) => i.orderId).sort()).toEqual([old.id, recent.id].sort());
    expect(wider.width).toBe(42);
    expect(wider.items[0].ticket).toContain('DELIVERY');
    // Default cursor: 15 minutes back.
    expect((await buildPrintQueue({ location: 'NDG' })).items.map((i) => i.orderId)).toEqual([recent.id]);
  });

  it('a scheduled order waits for its fire time, then counts from it', async () => {
    const sched = await addOrder({ createdAt: ago(120), displayId: 'SCHED' });
    await getRepo().patchOrder(sched.id, { fireAt: new Date(Date.now() + 3600_000).toISOString() });
    expect((await buildPrintQueue({ location: 'NDG', since: ago(180) })).items).toEqual([]);
    await getRepo().patchOrder(sched.id, { fireAt: ago(1), firedAt: ago(1) });
    expect((await buildPrintQueue({ location: 'NDG', since: ago(5) })).items.map((i) => i.orderId)).toEqual([sched.id]);
  });

  it('own orders: in the kitchen yes, held for payment no, paid later counts from its release', async () => {
    const phone = await addDirect({ number: 'T-1' });
    await addDirect({ number: 'T-2', status: 'awaiting_payment' });
    await addDirect({ number: 'WEB-9', source: 'clover_online' }); // Clover Online Ordering prints its own
    const released = await addDirect({ number: 'T-3', createdAt: ago(60), placedAt: ago(60), paylink: { releasedAt: ago(1) } as any });
    const q = await buildPrintQueue({ location: 'NDG', since: ago(10) });
    expect(q.items.map((i) => i.orderId).sort()).toEqual([phone.id, released.id].sort());
    expect(q.items.every((i) => i.source === 'direct' && i.kind === 'order')).toBe(true);
    expect(q.items.find((i) => i.orderId === phone.id)!.ticket).toContain('TÉLÉPHONE');
  });
});

describe('kitchen print queue: never twice, cancelled never printed', () => {
  beforeEach(fresh);

  it('claims once per device: the second claim and the queue both say already printed', async () => {
    const cookie = await ownerCookie();
    const o = await addOrder();
    const first = await (await claim(o.id, { deviceId: DEVICE, source: 'platform', location: 'NDG' }, cookie)).json();
    expect(first).toMatchObject({ ok: true, claimed: true, id: `platform:${o.id}:order` });
    const again = await (await claim(o.id, { deviceId: DEVICE, location: 'NDG' }, cookie)).json();
    expect(again).toMatchObject({ ok: true, claimed: false, reason: 'already_printed' });
    const q = await (await get(`?location=NDG&device=${DEVICE}`, cookie)).json();
    expect(q.items[0]).toMatchObject({ orderId: o.id, printed: true });
    // Another tablet has its own claim.
    expect(await claimTabletPrint({ orderId: o.id, deviceId: 'tablet-test-0002', location: 'NDG', by: 'test' })).toMatchObject({ claimed: true });
    // Two claims racing for one device: exactly one wins.
    const o2 = await addOrder();
    const race = await Promise.all([1, 2, 3].map(() => claimTabletPrint({ orderId: o2.id, deviceId: DEVICE, location: 'NDG', by: 'test' })));
    expect(race.filter((r) => r.claimed)).toHaveLength(1);
    expect((await getRepo().listEvents(o.id)).some((e) => e.type === 'tablet_printed')).toBe(true);
  });

  it('refuses a bad device id, an unknown order and another kitchen\'s order', async () => {
    const cookie = await ownerCookie();
    const o = await addOrder({ locationCode: 'VERDUN' });
    expect((await claim(o.id, { deviceId: 'x' }, cookie)).status).toBe(400);
    expect((await claim('nope', { deviceId: DEVICE, location: 'NDG' }, cookie)).status).toBe(404);
    expect((await claim(o.id, { deviceId: DEVICE, location: 'NDG' }, cookie)).status).toBe(404);
  });

  it('a cancelled order is never printed; once printed, its cancellation gives one short ANNULÉE ticket', async () => {
    const early = await addOrder({ displayId: 'EARLY' });
    await getRepo().patchOrder(early.id, { cancelledAt: new Date().toISOString(), cancelledBy: 'customer' }, { status: 'cancelled' });
    let q = await buildPrintQueue({ location: 'NDG', deviceId: DEVICE });
    expect(q.items).toEqual([]);
    expect(await claimTabletPrint({ orderId: early.id, deviceId: DEVICE, location: 'NDG', by: 't' })).toMatchObject({ claimed: false, reason: 'cancelled' });

    const o = await addOrder({ displayId: 'LATE' });
    expect(await claimTabletPrint({ orderId: o.id, deviceId: DEVICE, location: 'NDG', by: 't' })).toMatchObject({ claimed: true });
    expect(await claimTabletPrint({ orderId: o.id, deviceId: DEVICE, location: 'NDG', by: 't', kind: 'cancel' })).toMatchObject({ claimed: false, reason: 'not_cancelled' });
    await getRepo().patchOrder(o.id, { cancelledAt: new Date().toISOString(), cancelledBy: 'platform', cancelReason: 'Client a annulé' }, { status: 'cancelled' });
    q = await buildPrintQueue({ location: 'NDG', deviceId: DEVICE });
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ orderId: o.id, kind: 'cancel', id: `platform:${o.id}:cancel`, printed: false });
    expect(q.items[0].ticket).toContain('@@HBC ANNULÉE');
    expect(q.items[0].ticket).toContain('@@HBC #LATE');
    // No device id: nothing to say about cancellations (they depend on what this device printed).
    expect((await buildPrintQueue({ location: 'NDG' })).items).toEqual([]);
    // Another tablet never printed it: no cancel ticket there.
    expect((await buildPrintQueue({ location: 'NDG', deviceId: 'tablet-test-0009' })).items).toEqual([]);
    expect(await claimTabletPrint({ orderId: o.id, deviceId: 'tablet-test-0009', location: 'NDG', by: 't', kind: 'cancel' })).toMatchObject({ claimed: false, reason: 'not_printed_here' });

    expect(await claimTabletPrint({ orderId: o.id, deviceId: DEVICE, location: 'NDG', by: 't', kind: 'cancel' })).toMatchObject({ claimed: true });
    expect(await claimTabletPrint({ orderId: o.id, deviceId: DEVICE, location: 'NDG', by: 't', kind: 'cancel' })).toMatchObject({ claimed: false, reason: 'already_printed' });
    expect((await buildPrintQueue({ location: 'NDG', deviceId: DEVICE })).items).toEqual([]);
  });

  it('own orders: claimed once, and a cancelled own order is not printed', async () => {
    const d = await addDirect();
    expect(await claimTabletPrint({ orderId: d.id, deviceId: DEVICE, location: 'NDG', by: 't', source: 'direct' })).toMatchObject({ claimed: true, id: `direct:${d.id}:order` });
    expect(await claimTabletPrint({ orderId: d.id, deviceId: DEVICE, location: 'NDG', by: 't' })).toMatchObject({ claimed: false, reason: 'already_printed' });
    const c = await addDirect({ status: 'cancelled' });
    expect(await claimTabletPrint({ orderId: c.id, deviceId: DEVICE, location: 'NDG', by: 't' })).toMatchObject({ claimed: false, reason: 'cancelled' });
    const held = await addDirect({ status: 'awaiting_payment' });
    expect(await claimTabletPrint({ orderId: held.id, deviceId: DEVICE, location: 'NDG', by: 't' })).toMatchObject({ claimed: false, reason: 'not_for_kitchen' });
  });
});
