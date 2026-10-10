// Just Eat Takeaway / Skip logistics operations (delivery pools, order delivery state) and Skip Delivery-as-a-Service (the
// third courier fleet), against mocked HTTP. Coverage table: docs/SKIP_API_COVERAGE.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildJetLogisticsRequest, JET_LOGISTICS_OPS, jetDelivery, jetLocalTimestamp, jetLogisticsCall, jetPools, validateJetLogisticsBody,
} from '../lib/foodhub/adapters/jet-logistics';
import {
  parseCollectPoints, parseSkipDaasWebhook, registerSkipDaasWebhook, resetSkipDaasCache, resetSkipDaasToken, resolveCollectPoint, skipCreateBody, skipDaas, skipDaasEstimate, skipDaasNotificationConfig,
  skipDaasRequestAssistance, skipDaasSimulate, skipEstimateBody, skipDaasStatus,
} from '../lib/foodhub/delivery/skip-daas';
import { FLEETS, fleetReadiness, quoteFleets } from '../lib/foodhub/delivery/dispatch';
import { DEFAULT_DELIVERY_SETTINGS } from '../lib/foodhub/delivery/types';
import type { DeliveryRequest } from '../lib/foodhub/delivery/fleet';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function mockFetch(routes: Array<[RegExp, (c: Call, n: number) => { status: number; body?: unknown }]>) {
  calls = [];
  const seen = new Map<RegExp, number>();
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' && init.body ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    for (const [re, fn] of routes) {
      if (!re.test(c.url)) continue;
      const n = (seen.get(re) ?? 0) + 1; seen.set(re, n);
      const r = fn(c, n);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }));
}

/** operationIds of the 24 delivery-supplier operations in the published specification. */
const LOGISTICS_IDS = [
  'deliveryPoolsGet', 'deliveryPoolsPost', 'deliveryPoolsDeliveryPoolIdGet', 'deliveryPoolsDeliveryPoolIdPut', 'deliveryPoolsDeliveryPoolIdPatch', 'deliveryPoolsDeliveryPoolIdHoursPut',
  'deliveryPoolsDeliveryPoolIdAvailabilityRelativeGet', 'deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', 'deliveryPoolsDeliveryPoolIdChangeRiskPost', 'deliveryPoolsDeliveryPoolIdStatusGet',
  'deliveryPoolsDeliveryPoolIdOfflineEventsPost', 'deliveryPoolsDeliveryPoolIdOfflineEventsDelete', 'deliveryPoolsDeliveryPoolIdRestaurantsPut', 'deliveryPoolsDeliveryPoolIdRestaurantsDelete',
  'restaurantsDriverEtaPut', 'ordersOrderIdDeliverystateDriverassignedPut', 'ordersOrderIdDeliverystateDriverunassignedPut', 'ordersOrderIdDeliverystateAtrestaurantetaPut',
  'ordersOrderIdDeliverystateAtrestaurantPut', 'ordersOrderIdDeliverystateOnitswayPut', 'ordersOrderIdDeliverystateAtdeliveryaddressPut', 'ordersOrderIdDeliverystateDeliveredPut',
  'ordersOrderIdDeliverystateDriverlocationPut', 'ordersDeliverystateDriverlocationPut',
];

beforeEach(() => {
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  process.env.SKIP_PARTNER_API_KEY = 'partner-key';
  process.env.SKIP_PARTNER_API_BASE_URL = 'https://partner.test/';
  process.env.SKIP_DAAS_CLIENT_ID = 'cid';
  process.env.SKIP_DAAS_CLIENT_SECRET = 'csecret';
  process.env.SKIP_DAAS_ENV = 'sandbox';
  process.env.SKIP_DAAS_WEBHOOK_SECRET = 'daas-hook-secret';
  delete process.env.SKIP_DAAS_COLLECT_POINTS;
  delete process.env.SKIP_DAAS_DEFAULT_EMAIL;
  delete process.env.SKIP_DAAS_BASE_URL;
  delete process.env.SKIP_DAAS_AUTH_URL;
  resetSkipDaasToken();
  resetSkipDaasCache();
});
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; });

describe('delivery pools and order delivery state (JET delivery-supplier operations)', () => {
  it('lists all 24 operations of the specification, once each', () => {
    expect(JET_LOGISTICS_OPS.map((o) => o.id).sort()).toEqual([...LOGISTICS_IDS].sort());
    expect(new Set(JET_LOGISTICS_OPS.map((o) => `${o.method} ${o.path}`)).size).toBe(24);
  });

  it('builds the requests: path parameters encoded, the query kept, a body only where the operation takes one', () => {
    expect(buildJetLogisticsRequest('deliveryPoolsGet')).toEqual({ method: 'GET', url: 'https://partner.test/delivery/pools', body: undefined });
    expect(buildJetLogisticsRequest('deliveryPoolsDeliveryPoolIdOfflineEventsDelete', { path: { deliveryPoolId: 'p 1' }, query: { reason: 'manual' } }))
      .toEqual({ method: 'DELETE', url: 'https://partner.test/delivery/pools/p%201/offline-events?reason=manual', body: undefined });
    expect(buildJetLogisticsRequest('deliveryPoolsDeliveryPoolIdOfflineEventsDelete', { path: { deliveryPoolId: 'p1' } })).toEqual({ error: 'reason is required.' });
    expect(buildJetLogisticsRequest('ordersOrderIdDeliverystateDeliveredPut', {})).toEqual({ error: 'orderId is required.' });
    expect(buildJetLogisticsRequest('nope')).toMatchObject({ error: expect.stringContaining('Unknown') });
  });

  it('refuses what the specification says is invalid, before anything is sent', () => {
    expect(validateJetLogisticsBody('deliveryPoolsPost', {})).toContain('name');
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdChangeRiskPost', { riskLevel: 10 })).toContain('0 to 9');
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdChangeRiskPost', { riskLevel: 9 })).toBeNull();
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', { bestGuess: '10' })).toContain('hh:mm:ss');
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdAvailabilityRelativePut', { bestGuess: '00:12:30' })).toBeNull();
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdRestaurantsPut', { restaurants: ['abc'] })).toContain('whole numbers');
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdOfflineEventsPost', { reason: 'storm' })).toContain('manual');
    expect(validateJetLogisticsBody('restaurantsDriverEtaPut', [{ restaurantId: '1', etaAtRestaurant: 12 }])).toBeNull();
    expect(validateJetLogisticsBody('restaurantsDriverEtaPut', [])).toContain('restaurantId');
    const day = { poolTimes: [{ startTime: '10:00', endTime: '22:00' }] };
    const week = { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: { poolTimes: [], closed: true } };
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdHoursPut', week)).toBeNull();
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdHoursPut', { ...week, sunday: undefined })).toContain('sunday');
    expect(validateJetLogisticsBody('deliveryPoolsDeliveryPoolIdHoursPut', { ...week, monday: { poolTimes: [{ startTime: '10:00', endTime: '12:00' }, { startTime: '14:00', endTime: '20:00' }] } })).toContain('only one');
    expect(validateJetLogisticsBody('ordersOrderIdDeliverystateDriverlocationPut', { DriverId: 'd', TimeStampWithUtcOffset: '2026-10-09T01:00:00-04:00' })).toContain('Location');
    expect(validateJetLogisticsBody('ordersOrderIdDeliverystateDriverlocationPut', { DriverId: 'd', TimeStampWithUtcOffset: '2026-10-09T01:00:00-04:00', Location: { Latitude: 95, Longitude: 0 } })).toContain('Latitude');
    expect(validateJetLogisticsBody('ordersOrderIdDeliverystateDriverlocationPut', { DriverId: 'd', TimeStampWithUtcOffset: '2026-10-09T01:00:00-04:00', Location: { Latitude: 45.5, Longitude: -73.6 } })).toBeNull();
    expect(validateJetLogisticsBody('ordersOrderIdDeliverystateDriverassignedPut', { DriverId: 'd', TimeStampWithUtcOffset: '2026-10-09T01:00:00-04:00' })).toContain('VehicleDetails');
  });

  it('sends with Authorization: JE-API-KEY, answers 501 honestly, and is blocked without the key', async () => {
    mockFetch([[/\/delivery\/pools$/, (c) => (c.method === 'GET' ? { status: 200, body: { 'pool-1': { name: 'Fleet', restaurants: [1] } } } : { status: 201 })], [/offline-events/, () => ({ status: 501 })]]);
    const list = await jetPools.list();
    expect(list).toMatchObject({ ok: true, response: { 'pool-1': { name: 'Fleet' } } });
    expect(calls[0].headers.Authorization).toBe('JE-API-KEY partner-key');
    expect(await jetPools.create({ name: 'North', restaurants: [5, 6] })).toMatchObject({ ok: true });
    expect(calls[1].body).toEqual({ name: 'North', restaurants: [5, 6] });
    const off = await jetPools.takeOffline('pool-1');
    expect(off.ok).toBe(false);
    expect(off.message).toContain('not implemented');
    expect(calls[2].body).toEqual({ reason: 'manual' });
    delete process.env.SKIP_PARTNER_API_BASE_URL;
    expect((await jetPools.list()).status).toBe('blocked');
    process.env.SKIP_PARTNER_API_BASE_URL = 'https://partner.test';
    delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
    expect((await jetPools.list()).status).toBe('blocked');
    expect(calls).toHaveLength(3);
  });

  it('the delivery-state helpers hit the documented paths (driver assigned … delivered, bulk locations, pickup ETA)', async () => {
    mockFetch([[/./, () => ({ status: 200 })]]);
    const ts = jetLocalTimestamp(Date.UTC(2026, 9, 9, 5, 0, 0, 123), 'America/Toronto');
    expect(ts).toBe('2026-10-09T01:00:00.123-04:00');
    const base = { DriverId: 'd1', TimeStampWithUtcOffset: ts, Location: { Latitude: 45.5, Longitude: -73.6 } };
    await jetDelivery.driverAssigned('A1', { ...base, DriverName: 'Léa', VehicleDetails: { Vehicle: 'bike' } });
    await jetDelivery.atRestaurantEta('A1', { driverId: 'd1', bestGuess: ts });
    await jetDelivery.atRestaurant('A1', base);
    await jetDelivery.onItsWay('A1', base);
    await jetDelivery.atDeliveryAddress('A1', base);
    await jetDelivery.delivered('A1', base);
    await jetDelivery.driverUnassigned('A1', base);
    await jetDelivery.driverLocation('A1', base);
    await jetDelivery.driverLocations([{ ...base, OrderId: 'A1' }]);
    await jetPools.setPickupEta([{ restaurantId: '9', etaAtRestaurant: 12 }]);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'PUT /orders/A1/deliverystate/driverassigned', 'PUT /orders/A1/deliverystate/atrestauranteta', 'PUT /orders/A1/deliverystate/atrestaurant', 'PUT /orders/A1/deliverystate/onitsway',
      'PUT /orders/A1/deliverystate/atdeliveryaddress', 'PUT /orders/A1/deliverystate/delivered', 'PUT /orders/A1/deliverystate/driverunassigned', 'PUT /orders/A1/deliverystate/driverlocation',
      'PUT /orders/deliverystate/driverlocation', 'PUT /restaurants/driver/eta',
    ]);
    expect((await jetLogisticsCall('ordersOrderIdDeliverystateDeliveredPut', { path: { orderId: 'A1' }, body: {} })).status).toBe('error');
  });

  it('the pool calls reach their paths', async () => {
    mockFetch([[/./, () => ({ status: 200, body: {} })]]);
    await jetPools.get('p1'); await jetPools.replace('p1', { name: 'N' }); await jetPools.modify('p1', { name: 'M' }); await jetPools.getPickupAvailability('p1'); await jetPools.setPickupAvailability('p1', '00:10:00');
    await jetPools.changeRisk('p1', 3); await jetPools.status('p1'); await jetPools.deleteOfflineEvents('p1'); await jetPools.addRestaurants('p1', [1]); await jetPools.removeRestaurants('p1', [1]);
    await jetPools.setHours('p1', Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { poolTimes: [{ startTime: '10:00', endTime: '22:00' }] }])));
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'GET /delivery/pools/p1', 'PUT /delivery/pools/p1', 'PATCH /delivery/pools/p1', 'GET /delivery/pools/p1/availability/relative', 'PUT /delivery/pools/p1/availability/relative',
      'POST /delivery/pools/p1/change-risk', 'GET /delivery/pools/p1/status', 'DELETE /delivery/pools/p1/offline-events?reason=manual', 'PUT /delivery/pools/p1/restaurants',
      'DELETE /delivery/pools/p1/restaurants', 'PUT /delivery/pools/p1/hours',
    ]);
  });
});

const req = (over: Partial<DeliveryRequest> = {}): DeliveryRequest => ({
  id: 'fhd-1', reference: 'W-12',
  pickup: { businessName: 'Po Poulet', address: '1 Rue Test, Montréal', parts: { street: '1 Rue Test', city: 'Montréal', province: 'QC', postalCode: 'H4A1A1', country: 'CA' }, phone: '+15145550100', locationCode: 'NDG_MAIN', instructions: 'Side door' },
  dropoff: { name: 'Ana Bel', address: '5555 Av Monkland, Montréal', parts: { street: '5555 Av Monkland', unit: '3', city: 'Montréal', province: 'QC', postalCode: 'H4A1B2', country: 'CA' }, phone: '514-555-1234', email: 'ana@example.com', instructions: 'Door code 1234' },
  orderValue: 31.5, tip: 3, currency: 'CAD', items: [{ name: 'Poulet', quantity: 2, price: 15.75, externalId: 'P1' }], containsAlcohol: false, undeliverable: 'return_to_pickup', fleetSms: true, ...over,
});

describe('Skip Delivery (Delivery as a Service): the third courier fleet', () => {
  const routes: Array<[RegExp, (c: Call, n: number) => { status: number; body?: unknown }]> = [
    [/openid-connect\/token$/, () => ({ status: 200, body: { access_token: 'jwt-1', token_type: 'Bearer', expires_in: 300 } })],
    [/\/v1\/delivery\/collect-points/, () => ({ status: 200, body: { collectPoints: [{ id: 'cp-1', name: 'Po Poulet NDG', address: '1 Rue Test', city: 'Montréal' }, { id: 'cp-2', name: 'Other', address: '9 Autre' }] } })],
    [/\/v1\/delivery\/estimate$/, () => ({ status: 200, body: { requestId: 'req-1', dynamicDeliveryFee: 549, estimatedEarliestCollectTime: '2026-10-09T01:20:00Z', estimatedEarliestDeliverTime: '2026-10-09T01:50:00Z' } })],
    [/\/v1\/delivery$/, () => ({ status: 202, body: { deliveryId: 'del-1', requestId: 'req-1', orderNumber: 7, vendorOrderId: 'W-12', deliveryProperties: { isReturn: false } } })],
    [/\/v1\/delivery\/status\/req-1$/, () => ({ status: 200, body: { status: 'ASSIGNED', orderId: 'ord-9', orderTrackerURL: 'https://track.skip.test/x', courier: { name: 'Léa' } } })],
    [/cancellation-request$/, () => ({ status: 200, body: { requestId: 'req-1', message: 'Cancellation requested' } })],
  ];

  it('is a registered fleet with its own readiness (staging by default, nothing sent in production without the live switch)', () => {
    expect(Object.keys(FLEETS)).toContain('skip_daas');
    const r = skipDaas.readiness();
    expect(r).toMatchObject({ fleet: 'skip_daas', label: 'Skip Delivery', configured: true, canSend: true, environment: 'sandbox', webhookPath: '/api/foodhub/webhooks/skip-daas' });
    process.env.SKIP_DAAS_ENV = 'production';
    delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
    expect(skipDaas.readiness()).toMatchObject({ environment: 'production', canSend: false });
    delete process.env.SKIP_DAAS_CLIENT_ID;
    expect(skipDaas.readiness()).toMatchObject({ configured: false, missing: ['SKIP_DAAS_CLIENT_ID'] });
    expect(fleetReadiness().map((f) => f.fleet)).toEqual(['doordash_drive', 'uber_direct', 'skip_daas']);
  });

  it('token (Basic client credentials, User-Agent), collect point match, estimate then booking with the requestId', async () => {
    mockFetch(routes);
    const q = await skipDaas.quote(req());
    expect(q).toMatchObject({ ok: true, fleet: 'skip_daas', fee: 5.49, quoteId: 'req-1', pickupEta: '2026-10-09T01:20:00Z' });
    expect(calls[0].url).toBe('https://api-staging.skipthedishes.com/auth/realms/daas/protocol/openid-connect/token');
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(calls[0].headers['User-Agent']).toContain('TAKATAK-FoodHub');
    const est = calls.find((c) => /estimate$/.test(c.url))!;
    expect(est.url).toBe('https://api-daas-staging.skipthedishes.com/v1/delivery/estimate');
    expect(est.headers.Authorization).toBe('Bearer jwt-1');
    expect(est.body).toMatchObject({ collect: { id: 'cp-1' }, delivery: { name: 'Ana Bel', emailAddress: 'ana@example.com', phoneNumber: '+15145551234', address: '5555 Av Monkland #3', city: 'Montréal', postalCode: 'H4A1B2' }, deliveryDetails: { preparationDuration: 15, hasAlcohol: false }, deliveryOptions: { unreachablePreference: 'RETURN' } });
    expect(est.body.itemList).toEqual([{ itemId: 'P1', name: 'Poulet', quantity: 2, price: 1575, category: 'FOOD' }]);
    const booked = await skipDaas.create(req(), q);
    expect(booked).toMatchObject({ ok: true, status: 'done', fleetDeliveryId: 'req-1', deliveryStatus: 'created', fee: 5.49 });
    const create = calls.find((c) => c.method === 'POST' && /\/v1\/delivery$/.test(c.url))!;
    expect(create.body).toMatchObject({ requestId: 'req-1', vendorOrderId: 'W-12', orderValue: 3150, tip: 300, paymentType: 'PREPAID', metadata: { deliveryId: 'fhd-1' } });
    expect(calls.filter((c) => /openid-connect/.test(c.url))).toHaveLength(1);
    expect(calls.filter((c) => /estimate/.test(c.url))).toHaveLength(1);
  });

  it('books without a fresh quote by estimating first; reads status; cancels by requestId', async () => {
    mockFetch(routes);
    const booked = await skipDaas.create(req());
    expect(booked.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`).filter((x) => /delivery/.test(x))).toEqual(['GET /v1/delivery/collect-points', 'POST /v1/delivery/estimate', 'POST /v1/delivery']);
    const got = await skipDaas.get('fhd-1', 'req-1');
    expect(got).toMatchObject({ ok: true, deliveryStatus: 'assigned', trackingUrl: 'https://track.skip.test/x', supportReference: 'ord-9', courier: { name: 'Léa' } });
    const cancelled = await skipDaas.cancel('fhd-1', 'req-1');
    expect(cancelled.ok).toBe(true);
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({ method: 'PUT', body: { requestId: 'req-1' } });
  });

  it('explains what is missing instead of guessing (e-mail, phone, collect point)', async () => {
    mockFetch(routes);
    expect(skipEstimateBody(req({ dropoff: { ...req().dropoff, email: undefined } }), 'cp-1')).toMatchObject({ error: expect.stringContaining('e-mail') });
    process.env.SKIP_DAAS_DEFAULT_EMAIL = 'orders@example.com';
    const withDefault = skipEstimateBody(req({ dropoff: { ...req().dropoff, email: undefined } }), 'cp-1');
    expect('body' in withDefault && withDefault.body.delivery.emailAddress).toBe('orders@example.com');
    expect(skipEstimateBody(req({ dropoff: { ...req().dropoff, phone: 'x' } }), 'cp-1')).toMatchObject({ error: expect.stringContaining('phone') });
    const unmatched = await resolveCollectPoint({ ...req().pickup, businessName: 'Zzz', parts: { street: '77 Nowhere', city: 'X', province: 'QC', postalCode: '', country: 'CA' }, address: '77 Nowhere', locationCode: 'ELSEWHERE' });
    expect(unmatched.error).toContain('SKIP_DAAS_COLLECT_POINTS');
    process.env.SKIP_DAAS_COLLECT_POINTS = 'ELSEWHERE=cp-9, NDG_MAIN = cp-1';
    expect(parseCollectPoints()).toEqual({ ELSEWHERE: 'cp-9', NDG_MAIN: 'cp-1' });
    expect(await resolveCollectPoint({ ...req().pickup, locationCode: 'ELSEWHERE' })).toEqual({ id: 'cp-9' });
    const advance = skipEstimateBody(req({ pickupAt: new Date(Date.now() + 3600_000).toISOString(), containsAlcohol: true, minAge: 18 }), 'cp-1');
    expect('body' in advance && advance.body).toMatchObject({ deliveryDetails: { hasAlcohol: true, ageRestriction: 18, ageVerificationWithId: true } });
    expect('body' in advance && advance.body.targetCollectTime).toBeTruthy();
    expect(skipCreateBody(req(), 'r1').specialInstructions).toBe('Door code 1234 — Side door');
  });

  it('is asked for a price next to the other fleets when comparing, never when it has no keys', async () => {
    mockFetch([...routes, [/doordash|uber/, () => ({ status: 500 })]]);
    process.env.DOORDASH_DRIVE_DEVELOPER_ID = 'x';
    const quotes = await quoteFleets(req(), { ...DEFAULT_DELIVERY_SETTINGS, compareQuotes: true, primaryFleet: 'skip_daas' });
    expect(quotes.some((q) => q.fleet === 'skip_daas' && q.ok)).toBe(true);
    delete process.env.DOORDASH_DRIVE_DEVELOPER_ID;
    delete process.env.SKIP_DAAS_CLIENT_ID;
    const none = await quoteFleets(req(), { ...DEFAULT_DELIVERY_SETTINGS, compareQuotes: true, primaryFleet: 'doordash_drive' });
    expect(none.every((q) => q.fleet !== 'skip_daas')).toBe(true);
  });

  it('maps the delivery statuses', () => {
    expect(['UNASSIGNED', 'ASSIGNED', 'IN_TRANSIT_TO_COLLECT', 'ARRIVED_TO_COLLECT', 'COLLECTED', 'IN_TRANSIT_TO_DELIVER', 'ARRIVED_TO_DELIVER', 'DELIVERED', 'RETURN_INITIATED', 'CANCELLED', 'CANCELLATION_FAILURE', 'UNKNOWN'].map(skipDaasStatus))
      .toEqual(['created', 'assigned', 'assigned', 'at_pickup', 'picked_up', 'picked_up', 'at_dropoff', 'delivered', 'returning', 'cancelled', null, null]);
  });

  it('reads all nine webhook event types and finds our delivery by the metadata', () => {
    const common = { requestId: 'req-1', vendorOrderId: 'W-12', metadata: { deliveryId: 'fhd-1' }, deliveryProperties: { isReturn: false } };
    const ev = (type: string, data: Record<string, unknown>) => parseSkipDaasWebhook({ id: 'e', type, timestamp: '2026-10-09T01:00:00Z', data: { ...common, ...data } })!;
    expect(ev('COURIERJOBSTATUS', { status: 'COLLECTED', orderId: 'ord-9', orderTrackerURL: 'https://track.skip.test/x', courier: { name: 'Léa' } })).toMatchObject({ fleet: 'skip_daas', ref: 'fhd-1', fleetDeliveryId: 'req-1', status: 'picked_up', trackingUrl: 'https://track.skip.test/x', supportReference: 'ord-9', courier: { name: 'Léa' } });
    expect(ev('CANCELJOBSTATUS', { status: true })).toMatchObject({ status: 'cancelled' });
    expect(ev('CANCELJOBSTATUS', { status: false, message: 'Courier already has it' })).toMatchObject({ status: null, cancelReason: 'Courier already has it' });
    expect(ev('COURIERCOLLECTIONTIME', { courierETA: '2026-10-09T01:15:00Z' })).toMatchObject({ status: null, pickupEta: '2026-10-09T01:15:00Z' });
    expect(ev('DELIVERYCREATED', {})).toMatchObject({ status: 'created' });
    expect(ev('COURIERLOCATION', { latitude: 45.5, longitude: -73.6 })).toMatchObject({ status: null, courier: { lat: 45.5, lng: -73.6 } });
    expect(ev('DELIVERYREJECTED', { message: 'No courier' })).toMatchObject({ status: 'failed', cancelReason: 'No courier' });
    expect(ev('COURIERDELIVERYTIME', { postPurchaseDeliveryEta: '2026-10-09T01:40:00Z' })).toMatchObject({ dropoffEta: '2026-10-09T01:40:00Z' });
    expect(ev('PROOFOFDELIVERY', { pinCode: '1234', status: 'VALID' })).toMatchObject({ status: null, event: 'PROOFOFDELIVERY' });
    expect(ev('PROOFOFDELIVERY_PICTURE', { urls: ['https://x'] })).toMatchObject({ status: null });
    expect(parseSkipDaasWebhook({ type: 'SOMETHING', data: { requestId: 'r' } })).toBeNull();
    expect(parseSkipDaasWebhook({ type: 'COURIERJOBSTATUS', data: {} })).toBeNull();
    expect(parseSkipDaasWebhook({})).toBeNull();
  });

  it('checks the webhook secret: x-api-key, Basic, and nothing without a configured secret', () => {
    const body = '{}';
    expect(skipDaas.verifyWebhook(new Headers({ 'x-api-key': 'daas-hook-secret' }), body)).toBe(true);
    expect(skipDaas.verifyWebhook(new Headers({ 'x-api-key': 'wrong' }), body)).toBe(false);
    expect(skipDaas.verifyWebhook(new Headers({ authorization: `Basic ${Buffer.from('user:daas-hook-secret').toString('base64')}` }), body)).toBe(true);
    process.env.SKIP_DAAS_WEBHOOK_USERNAME = 'takatak';
    expect(skipDaas.verifyWebhook(new Headers({ authorization: `Basic ${Buffer.from('user:daas-hook-secret').toString('base64')}` }), body)).toBe(false);
    delete process.env.SKIP_DAAS_WEBHOOK_USERNAME;
    delete process.env.SKIP_DAAS_WEBHOOK_SECRET;
    expect(skipDaas.verifyWebhook(new Headers({ 'x-api-key': 'daas-hook-secret' }), body)).toBe(false);
  });

  it('notification configuration (create, read, patch, delete), assistance (CA) and simulation (staging only)', async () => {
    mockFetch([...routes, [/notification-config$/, (c) => (c.method === 'GET' ? { status: 200, body: { email: 'a@b.ca', endpoint: 'https://hub.test/x', subscriptions: ['ALL'] } } : { status: 204 })], [/request-assistance$/, () => ({ status: 200, body: { requestId: 'req-1' } })], [/simulate$/, () => ({ status: 200, body: { requestId: 'req-1' } })]]);
    process.env.FOODHUB_PUBLIC_URL = 'https://hub.test';
    process.env.SKIP_DAAS_CONTACT_EMAIL = 'ops@example.com';
    expect(await registerSkipDaasWebhook()).toMatchObject({ ok: true });
    const created = calls.find((c) => c.method === 'POST' && /notification-config/.test(c.url))!;
    expect(created.body).toEqual({ email: 'ops@example.com', endpoint: 'https://hub.test/api/foodhub/webhooks/skip-daas', secret: 'daas-hook-secret', type: 'TOKEN', subscriptions: ['ALL'] });
    expect((await skipDaasNotificationConfig.create({ email: 'nope', endpoint: 'http://x', secret: '', type: 'TOKEN' })).message).toContain('https');
    expect((await skipDaasNotificationConfig.patch({ subscriptions: ['COURIERLOCATION', 'BOGUS' as any] })).message).toContain('subscriptions');
    expect(await skipDaasNotificationConfig.get()).toMatchObject({ ok: true, response: { subscriptions: ['ALL'] } });
    expect(await skipDaasNotificationConfig.patch({ endpoint: 'https://hub.test/y' })).toMatchObject({ ok: true });
    expect(await skipDaasNotificationConfig.delete()).toMatchObject({ ok: true });
    expect(await skipDaasRequestAssistance('req-1', 'cp-1', 'REPORT_COURIER_DELAY')).toMatchObject({ ok: true });
    expect((await skipDaasRequestAssistance('req-1', 'cp-1', 'JUST_BECAUSE' as any)).ok).toBe(false);
    expect(await skipDaasSimulate('req-1', { deliveryStep: 'DELIVERED', stepWaitDuration: 500 })).toMatchObject({ ok: true });
    expect(calls[calls.length - 1].body).toEqual({ requestId: 'req-1', deliveryStep: 'DELIVERED', stepWaitDuration: 500 });
    process.env.SKIP_DAAS_ENV = 'production';
    expect((await skipDaasSimulate('req-1')).status).toBe('blocked');
    delete process.env.SKIP_DAAS_WEBHOOK_SECRET;
    expect((await registerSkipDaasWebhook()).status).toBe('blocked');
  });

  it('a standalone estimate call', async () => {
    mockFetch(routes);
    const built = skipEstimateBody(req(), 'cp-1');
    const res = await skipDaasEstimate('body' in built ? built.body : (undefined as never));
    expect(res).toMatchObject({ ok: true, response: { requestId: 'req-1' } });
  });
});
