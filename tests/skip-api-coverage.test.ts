// SkipTheDishes / Just Eat Takeaway JET Connect: every operation of the published specification that Food Hub calls or
// receives, against mocked HTTP (no network). Coverage table: docs/SKIP_API_COVERAGE.md.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSkipOrder, skipAdapter, skipFailureBody, skipFailureCode } from '../lib/foodhub/adapters/skip';
import {
  amendSkipOrderLegacy, describeSkipModificationErrors, getSkipAmendmentLegacy, getSkipModificationState, goLiveSkipLocation, modifySkipOrder, onboardSkipLocation, parseSkipModificationCallback,
  parseSkipOnboardingNotice, parseSkipOrderTime, setSkipServiceTimes, skipModificationBody, skipOnboardingConfigurationBody, submitSkipOnboardingConfiguration, toSkipServiceTimes,
  validateSkipModification, verifySkipOnboardingSignature,
} from '../lib/foodhub/adapters/skip-api';
import { publishSkipMenus, validateSkipMenusPayload } from '../lib/foodhub/menu/skip-catalogue';
import { finalOrderDifference, handleSkipFinalOrder, handleSkipModificationCallback, handleSkipOrderTime, listSkipOnboarding, pushSkipServiceTimes, recordSkipOnboarding, startSkipOnboarding } from '../lib/foodhub/skip-ops';
import { SYSTEM_ACTOR } from '../lib/foodhub/activity';
import { getRepo } from '../lib/foodhub/repo';
import type { StoredOrder, WeeklyHours } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function mockFetch(routes: Array<[RegExp, (c: Call, n: number) => { status: number; body?: unknown }]>) {
  calls = [];
  const seen = new Map<RegExp, number>();
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: RequestInit = {}) => {
    const c: Call = { url: String(url), method: init.method || 'GET', body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null, headers: (init.headers ?? {}) as Record<string, string> };
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

const order = (over: Partial<StoredOrder> = {}): StoredOrder => ({
  id: 'o1', channel: 'skip', marketplace: 'skip', externalOrderId: 'ord-1', channelStoreId: 'R1', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD',
  subtotal: 10, tax: 1.5, deliveryFee: 0, tip: 0, discount: 0, total: 11.5, lines: [{ name: 'Burger', quantity: 2, unitPrice: 5, total: 10, externalId: 'P1', modifiers: [] }], raw: {}, status: 'accepted',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.SKIP_JET_API_KEY = 'jet-key';
  process.env.SKIP_JET_BASE_URL = 'https://jet.test';
  process.env.SKIP_WEBHOOK_HMAC_SECRET = 'hmac';
  process.env.SKIP_ONBOARDING_HMAC_SECRET = 'onboard-secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  process.env.FOODHUB_POS_INJECTION = 'off';
});
afterEach(() => { vi.unstubAllGlobals(); globalThis.fetch = realFetch; delete process.env.FOODHUB_POS_INJECTION; });

describe('Receive Order: the documented payment block', () => {
  // The "Delivery by restaurant" example of the specification.
  const byRestaurant = {
    id: '7494e975', third_party_order_reference: '207217603', type: 'delivery-by-merchant', posLocationId: '22617', location: { id: 2267, timezone: 'US/Mountain' },
    items: [{ name: 'Cheesy Pasta', plu: 'MMcc0', price: 500, notes: 'please make it extra cheesy', children: [] }],
    created_at: '1606780145', deliver_at: '1606780980', delivery_notes: 'blue house', payment_method: 'CASH',
    payment: { items_in_cart: { inc_tax: 600, tax: 100 }, adjustments: [{ name: 'deliveryFee', price: { inc_tax: 240, tax: 40 } }], final: { inc_tax: 840, tax: 140 }, deposit: 0 },
    delivery: { first_name: 'John' }, total: 600,
  };
  it('total is what the customer paid (payment.final), the delivery fee and tip come from the adjustments', () => {
    const o = parseSkipOrder(byRestaurant)!;
    expect(o).toMatchObject({ total: 8.4, tax: 1.4, subtotal: 5, deliveryFee: 2.4, tip: 0, fulfillment: 'delivery' });
    expect(o.readyBy).toBe(new Date(1606780980 * 1000).toISOString());
    expect(o.notes).toContain('Delivery by the restaurant');
    const withTip = parseSkipOrder({ ...byRestaurant, payment: { ...byRestaurant.payment, adjustments: [...byRestaurant.payment.adjustments, { name: 'driverTip', price: { inc_tax: 300, tax: 0 } }, { name: 'discount', price: { inc_tax: 150, tax: 20 } }], final: { inc_tax: 990, tax: 120 } } })!;
    expect(withTip).toMatchObject({ tip: 3, discount: 1.5, total: 9.9 });
  });
  it('grocery fields: picked weight and the customer’s substitution choice reach the line notes', () => {
    const o = parseSkipOrder({ ...byRestaurant, items: [{ name: 'Steak', plu: 'S1', price: 1500, quantity: 1, netQuantity: 385, substitution: { preference: 'bestmatch' }, notes: 'thin', children: [] }] })!;
    expect(o.lines[0].notes).toBe('thin · Substitute with the best match if unavailable · Weight 385 g');
  });
  it('the legacy single `total` still works when payment.final is absent', () => {
    expect(parseSkipOrder({ id: 'x', posLocationId: 'R', items: [{ name: 'A', price: 1000, quantity: 1 }], total: 1000 })!.total).toBe(10);
  });
});

describe('sent-to-pos-failed carries the documented body', () => {
  it('maps the kitchen’s reason to one of JET’s error codes', () => {
    expect(skipFailureCode('Item out of stock')).toBe('MENU_ERROR');
    expect(skipFailureCode('Kitchen closed')).toBe('STORE_CLOSED');
    expect(skipFailureCode('Clover did not receive the order')).toBe('INACTIVE');
    expect(skipFailureCode('too busy')).toBe('IN_USE');
    expect(skipFailureCode('whatever')).toBe('UNKNOWN');
    const body = skipFailureBody(order({ raw: { transmission_id: 'tx-9' } }), 'Item out of stock', new Date('2026-10-09T01:00:00Z'));
    expect(body).toEqual({ happenedAt: '2026-10-09T01:00:00.000Z', errorCode: 'MENU_ERROR', errorMessage: 'Item out of stock', transmissionId: 'tx-9' });
  });
  it('denyOrder posts errorCode + errorMessage to /order/{id}/sent-to-pos-failed', async () => {
    mockFetch([[/sent-to-pos-failed/, () => ({ status: 204 })]]);
    const res = await skipAdapter.denyOrder(order(), 'Kitchen closed');
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe('https://jet.test/order/ord-1/sent-to-pos-failed');
    expect(calls[0].body).toMatchObject({ errorCode: 'STORE_CLOSED', errorMessage: 'Kitchen closed' });
    expect(calls[0].headers['X-Flyt-Api-Key']).toBe('jet-key');
    expect(calls[0].headers['x-jet-application']).toBe('takatak-foodhub');
  });
});

describe('order modification: out of stock, substitutions, weights', () => {
  it('checks the request before sending anything', () => {
    expect(skipModificationBody([])).toMatchObject({ error: expect.stringContaining('Nothing to change') });
    expect(skipModificationBody([{ addedItems: [{ plu: 'B', quantity: 1 }] }])).toMatchObject({ error: expect.stringContaining('replaces') });
    expect(skipModificationBody([{ removedItems: [{ plu: 'A', missingQuantity: 0 }] }])).toMatchObject({ error: expect.stringContaining('above zero') });
    expect(skipModificationBody([{ adjustedItems: [{ plu: 'A', netQuantity: 385.5 }] }])).toMatchObject({ error: expect.stringContaining('whole grams') });
    expect(skipModificationBody([{ removedItems: [{ plu: ' A ', missingQuantity: 1 }], addedItems: [{ plu: 'B', quantity: 1 }] }, { adjustedItems: [{ plu: 'C', netQuantity: 385 }] }]))
      .toEqual({ body: { modifications: [{ removedItems: [{ plu: 'A', missingQuantity: 1 }], addedItems: [{ plu: 'B', quantity: 1 }] }, { adjustedItems: [{ plu: 'C', netQuantity: 385 }] }] } });
  });
  it('POST /orders/{id}/modification (202 = queued), 409 = already modified, errors explained', async () => {
    mockFetch([[/\/orders\/ord-1\/modification$/, (_c, n) => (n === 1 ? { status: 202 } : n === 2 ? { status: 409 } : { status: 400, body: { orderId: 'ord-1', type: 'failure', errors: [{ errorCode: 'addedPriceIsGreaterThanRemoved', added: { plu: 'B', quantity: 1 } }] } })]]);
    const mods = [{ removedItems: [{ plu: 'A', missingQuantity: 1 }], addedItems: [{ plu: 'B', quantity: 1 }] }];
    const ok = await modifySkipOrder(order(), mods);
    expect(ok).toMatchObject({ ok: true, status: 'queued' });
    expect(calls[0].body).toEqual({ modifications: mods });
    expect(await modifySkipOrder(order(), mods)).toMatchObject({ ok: false, message: expect.stringContaining('only be modified once') });
    expect(await modifySkipOrder(order(), mods)).toMatchObject({ ok: false, message: expect.stringContaining('costs more than the item it replaces') });
  });
  it('validation: a dry run that lists what JET would refuse', async () => {
    mockFetch([[/\/orders\/ord-1\/validation$/, (_c, n) => (n === 1 ? { status: 200, body: { orderId: 'ord-1', errors: [], type: 'failure' } } : { status: 200, body: { orderId: 'ord-1', type: 'failure', errors: [{ errorCode: 'removedItemNotFound', removed: { plu: 'Z', missingQuantity: 1 } }] } })]]);
    const mods = [{ removedItems: [{ plu: 'Z', missingQuantity: 1 }] }];
    expect(await validateSkipModification(order(), mods)).toMatchObject({ ok: true, message: 'Skip would accept this change.' });
    const bad = await validateSkipModification(order(), mods);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('a removed item is not on the order (item Z)');
  });
  it('GET /orders/{id}/modification gives the state', async () => {
    mockFetch([[/modification$/, () => ({ status: 200, body: { orderId: 'ord-1', state: 'pending' } })]]);
    expect(await getSkipModificationState(order())).toMatchObject({ ok: true, state: 'pending' });
    expect(calls[0].method).toBe('GET');
  });
  it('reads the callback JET sends after a change', () => {
    expect(parseSkipModificationCallback({ orderId: 'o', type: 'success' })).toMatchObject({ success: true });
    const f = parseSkipModificationCallback({ orderId: 'o', type: 'failure', errors: [{ errorCode: 'notSupported' }] })!;
    expect(f.success).toBe(false);
    expect(f.text).toContain('not supported');
    expect(parseSkipModificationCallback({ hello: 1 })).toBeNull();
    expect(describeSkipModificationErrors([{ errorCode: 'brandNew' }])).toBe('brandNew');
  });
  it('the older amend calls still work (POST then GET progress; 409 = once)', async () => {
    mockFetch([[/\/orders\/brand\/ord-1\/amend$/, (c) => (c.method === 'POST' ? { status: 202 } : { status: 200, body: { orderId: 'ord-1', state: 'accepted' } })]]);
    expect(await amendSkipOrderLegacy('brand', 'ord-1', [{ plu: 'A', missingQuantity: 1 }])).toMatchObject({ ok: true });
    expect(calls[0].body).toEqual({ items: [{ reason: 'missing', plu: 'A', missingQuantity: 1 }] });
    expect(await getSkipAmendmentLegacy('brand', 'ord-1')).toMatchObject({ ok: true, state: 'accepted' });
    expect((await amendSkipOrderLegacy('brand', 'ord-1', [])).ok).toBe(false);
  });
});

describe('service times (opening hours)', () => {
  const week = { monday: [{ open: '11:00', close: '22:00' }], tuesday: [], wednesday: [{ open: '9:00', close: '14:00' }, { open: '17:00', close: '21:30' }], thursday: [], friday: [], saturday: [{ open: '12:00', close: '02:00' }], sunday: [] } as unknown as WeeklyHours;
  it('builds the JET body: closed days left out, overnight slots split, Delivery and Collection', () => {
    const b = toSkipServiceTimes(week, 'America/Toronto')!;
    expect(b.timezone).toBe('America/Toronto');
    expect(b.serviceTimes.map((s) => s.serviceType)).toEqual(['Delivery', 'Collection']);
    const t = b.serviceTimes[0].openingTimes;
    expect(t.monday).toEqual([{ openingTime: '11:00', closingTime: '22:00' }]);
    expect(t.wednesday).toEqual([{ openingTime: '09:00', closingTime: '14:00' }, { openingTime: '17:00', closingTime: '21:30' }]);
    expect(t.saturday).toEqual([{ openingTime: '12:00', closingTime: '23:59' }]);
    expect(t.sunday).toEqual([{ openingTime: '00:00', closingTime: '02:00' }]);
    expect(t.tuesday).toBeUndefined();
    expect(toSkipServiceTimes(week, 'America/Toronto', ['Collection'])!.serviceTimes).toHaveLength(1);
    expect(toSkipServiceTimes({} as WeeklyHours, 'America/Toronto')).toBeNull();
  });
  it('PUT /restaurants/{ref}/servicetimes; nothing sent for a week with no hours', async () => {
    mockFetch([[/servicetimes$/, () => ({ status: 202, body: { success: true } })]]);
    expect(await setSkipServiceTimes({ channelStoreId: 'NDG POP' }, week, 'America/Toronto')).toMatchObject({ ok: true, status: 'queued' });
    expect(calls[0].url).toBe('https://jet.test/restaurants/NDG%20POP/servicetimes');
    expect(calls[0].method).toBe('PUT');
    const none = await setSkipServiceTimes({ channelStoreId: 'R' }, null, 'America/Toronto');
    expect(none.status).toBe('skipped');
    expect(calls).toHaveLength(1);
  });
  it('pushes the Food Hub hours of every mapped Skip store, leaving a locked store alone', async () => {
    const repo = getRepo();
    await repo.upsertStore({ channel: 'skip', channelStoreId: 'R1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    await repo.upsertStore({ channel: 'skip', channelStoreId: 'LOCKED', brandName: 'Po Poulet', locationCode: 'NDG_LOCKED', autoAccept: true, online: true, meta: { menuLocked: true } });
    await repo.setKv('hours', { locations: { NDG_MAIN: week, NDG_LOCKED: week }, brands: {}, holidays: [] });
    mockFetch([[/servicetimes$/, () => ({ status: 202, body: { success: true } })]]);
    const rows = await pushSkipServiceTimes();
    expect(rows.map((r) => [r.channelStoreId, r.result.status])).toEqual(expect.arrayContaining([['R1', 'queued'], ['LOCKED', 'skipped']]));
    expect(calls.filter((c) => /servicetimes/.test(c.url))).toHaveLength(1);
  });
});

describe('partner onboarding', () => {
  it('POST /partners/{market}/locations/onboard: market and id checked, 409 explained', async () => {
    mockFetch([[/\/partners\/CA\/locations\/onboard$/, (_c, n) => (n === 1 ? { status: 202 } : { status: 409, body: { fault: { faultId: 'f', errors: [{ description: 'live' }] } } })]]);
    expect((await onboardSkipLocation('canada', '1234')).ok).toBe(false);
    expect((await onboardSkipLocation('ca', '')).ok).toBe(false);
    expect(await onboardSkipLocation('ca', '1234')).toMatchObject({ ok: true });
    expect(calls[0].body).toEqual({ locationId: '1234' });
    const refused = await onboardSkipLocation('CA', '1234');
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('already live');
  });
  it('configuration body: catalogue and/or order contract, https only', async () => {
    expect(skipOnboardingConfigurationBody({})).toMatchObject({ error: expect.any(String) });
    expect(skipOnboardingConfigurationBody({ order: { orderInjectionUrl: 'http://x', locationId: '1' } })).toMatchObject({ error: expect.stringContaining('https') });
    const built = skipOnboardingConfigurationBody({ catalogueLocationId: 'L1', order: { orderInjectionUrl: 'https://hub.test/api/foodhub/webhooks/skip/orders', locationId: 'L1' } });
    expect(built).toEqual({ body: { catalogue: { contract: 'universal', config: { locationId: 'L1' } }, order: { contract: 'universal', config: { orderInjectionUrl: 'https://hub.test/api/foodhub/webhooks/skip/orders', locationId: 'L1' } } } });
    mockFetch([[/configuration$/, () => ({ status: 202 })]]);
    const sid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    expect((await submitSkipOnboardingConfiguration('nope', { catalogueLocationId: 'L1' })).ok).toBe(false);
    expect(await submitSkipOnboardingConfiguration(sid, { catalogueLocationId: 'L1' })).toMatchObject({ ok: true });
    expect(calls[0].url).toBe(`https://jet.test/partners/onboarding/${sid}/configuration`);
  });
  it('POST …/go-live (409 = not ready)', async () => {
    mockFetch([[/go-live$/, (_c, n) => (n === 1 ? { status: 202 } : { status: 409 })]]);
    expect(await goLiveSkipLocation('L1')).toMatchObject({ ok: true });
    expect(calls[0].url).toBe('https://jet.test/partners/locations/L1/go-live');
    expect((await goLiveSkipLocation('L1')).message).toContain('not ready');
  });
  it('the notification signature: sha256=hex(HMAC(secret, timestamp + "\\n" + body)), 5 minutes, secret required', () => {
    const body = JSON.stringify({ eventType: 'onboardingActionRequired' });
    const ts = '2026-10-09T01:00:00.000Z';
    const sig = `sha256=${crypto.createHmac('sha256', 'onboard-secret').update(`${ts}\n${body}`).digest('hex')}`;
    const now = Date.parse(ts) + 60_000;
    const headers = new Headers({ 'x-webhook-timestamp': ts, 'x-webhook-signature': sig });
    expect(verifySkipOnboardingSignature(headers, body, 'onboard-secret', now)).toBe(true);
    expect(verifySkipOnboardingSignature(headers, body, 'onboard-secret', now + 10 * 60_000)).toBe(false);
    expect(verifySkipOnboardingSignature(headers, body + ' ', 'onboard-secret', now)).toBe(false);
    expect(verifySkipOnboardingSignature(headers, body, 'other', now)).toBe(false);
    expect(verifySkipOnboardingSignature(headers, body, '', now)).toBe(false);
    expect(verifySkipOnboardingSignature(new Headers({ 'x-webhook-timestamp': ts }), body, 'onboard-secret', now)).toBe(false);
  });
  it('keeps a session and says what to do next; a start made here is tied to the session that follows', async () => {
    mockFetch([[/onboard$/, () => ({ status: 202 })]]);
    await startSkipOnboarding({ market: 'ca', jetLocationId: '555', posLocationId: 'NDG_MAIN' }, SYSTEM_ACTOR);
    const sid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const notice = parseSkipOnboardingNotice({ eventType: 'onboardingActionRequired', sessionId: sid, stage: 'awaitingConfiguration', timestamp: '2026-10-09T01:00:00Z', referenceId: 'r1', restaurantMetadata: { name: 'Po Poulet', country: 'CA' } })!;
    const session = await recordSkipOnboarding(notice);
    expect(session).toMatchObject({ sessionId: sid, stage: 'awaitingConfiguration', posLocationId: 'NDG_MAIN', jetLocationId: '555', market: 'CA' });
    expect(session.nextStep).toContain('Send the configuration');
    const live = await recordSkipOnboarding(parseSkipOnboardingNotice({ eventType: 'onboardingLocationLive', sessionId: sid, stage: 'live', timestamp: '2026-10-09T02:00:00Z' })!);
    expect(live.history).toHaveLength(2);
    expect(live.nextStep).toContain('live on Skip');
    expect((await listSkipOnboarding()).sessions).toHaveLength(1);
    expect(parseSkipOnboardingNotice({ eventType: 'weird', sessionId: sid, stage: 'live' })).toBeNull();
  });
});

describe('notifications JET sends', () => {
  it('final picked order: the real total replaces the first one; the lines stay as they were cooked', async () => {
    const repo = getRepo();
    const { order: stored } = await repo.insertOrderIfNew({ channel: 'skip', marketplace: 'skip', externalOrderId: 'ord-1', channelStoreId: 'R1', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5, deliveryFee: 0, tip: 0, discount: 0, total: 11.5,
      lines: [{ name: 'Burger', quantity: 2, unitPrice: 5, total: 10, externalId: 'P1', modifiers: [] }], raw: {} });
    const final = parseSkipOrder({ id: 'ord-1', posLocationId: 'R1', type: 'delivery-by-delivery-partner', items: [{ name: 'Burger', plu: 'P1', price: 500, quantity: 1 }], payment: { items_in_cart: { inc_tax: 575, tax: 75 }, final: { inc_tax: 575, tax: 75 } }, total: 575 })!;
    expect(finalOrderDifference(stored.lines, final.lines)).toEqual([{ name: 'Burger', ordered: 2, final: 1 }]);
    const r = await handleSkipFinalOrder(final);
    expect(r).toMatchObject({ applied: true });
    expect(r.message).toContain('11.50 → 5.75');
    expect(await repo.getOrder(stored.id)).toMatchObject({ total: 5.75, subtotal: 5, tax: 0.75 });
    expect((await repo.getOrder(stored.id))!.lines[0].quantity).toBe(2);
    expect((await repo.listEvents(stored.id)).some((e) => e.type === 'skip_final_picked')).toBe(true);
    expect(await handleSkipFinalOrder({ ...final, externalOrderId: 'unknown' })).toMatchObject({ applied: false, keep: expect.any(String) });
  });
  it('modification callback: success noted, failure raises an alert on the order', async () => {
    const repo = getRepo();
    const { order: stored } = await repo.insertOrderIfNew({ channel: 'skip', marketplace: 'skip', externalOrderId: 'ord-2', channelStoreId: 'R1', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 1, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 1, lines: [], raw: {} });
    expect((await handleSkipModificationCallback({ orderId: 'ord-2', type: 'success' })).applied).toBe(true);
    expect((await handleSkipModificationCallback({ orderId: 'ord-2', type: 'failure', errors: [{ errorCode: 'removedItemNotFound' }] })).message).toContain('refused');
    const types = (await repo.listEvents(stored.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['skip_modification_succeeded', 'skip_modification_failed']));
    expect((await repo.listActivity({})).some((a) => a.action === 'skip_modification_failed' && a.status === 'failed')).toBe(true);
    expect(await handleSkipModificationCallback({ nothing: true })).toMatchObject({ applied: false, keep: expect.any(String) });
    expect(await handleSkipModificationCallback({ orderId: 'nope', type: 'success' })).toMatchObject({ applied: false, keep: expect.any(String) });
  });
  it('order time updated: kept on the store', async () => {
    const repo = getRepo();
    const store = await repo.upsertStore({ channel: 'skip', channelStoreId: 'R1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    const n = parseSkipOrderTime({ restaurantId: 'R1', serviceType: 'Delivery', dayOfWeek: 'Monday', lowerBoundMinutes: 25, upperBoundMinutes: 35 })!;
    expect(await handleSkipOrderTime(n)).toBe(true);
    expect((await repo.getStore(store.id))!.meta).toMatchObject({ skipOrderTimes: { delivery: { monday: { from: 25, to: 35 } } } });
    expect(await handleSkipOrderTime({ ...n, restaurantId: 'unknown' })).toBe(false);
    expect(parseSkipOrderTime({ restaurantId: 'R1' })).toBeNull();
  });
});

describe('catalogue in JET Connect shape (restaurant and grocery / retail)', () => {
  const menu = () => ({
    restaurants: ['R1'],
    menus: [{
      name: 'Épicerie', reference: 'm1', type: 'DELIVERY', availability: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, ['08:00 - 22:00']])),
      categories: [{ name: 'Laitier', description: '', items: [{
        name: 'Lait 2 %', plu: 'MILK-2L', price: 549, gtin: '036000291452', allergens: ['MILK'], product_types: ['PACKAGED_FOOD'], tax_category: 'REDUCED_RATE', low_stock_threshold: 5,
        volume: { unit: 'l', net_value: 2 }, weight: { unit: 'kg', gross_value: 2, net_value: 2 }, deposit: { type: 'single_use', amount: 10, included_in_total_price: true },
        manufacturer: { name: 'Laiterie', brand: 'Lait+', country_of_origin: 'Canada' }, storage: { type: 'COOL_DRY' }, nutritional_info: { kcal: 120 }, servings_range: { min: 1, max: 8 },
        swap: { name: 'Format', options: [{ name: '1 L', plu: 'MILK-1L', price: 299, reference: 'm1l' }] },
        portions: [{ name: 'Sac', description: '', plu: 'MILK-BAG', price: 399, modifiers: [] }],
      }] }],
      quantity_restrictions: [{ id: 'q1', name: 'Alcool', maximum: 6, restricted_quantity_plus: [{ plu: 'MILK-2L', contributing_quantity: 1 }] }],
    }],
  });
  it('accepts a full grocery catalogue and refuses what JET would refuse', () => {
    expect(validateSkipMenusPayload(menu())).toEqual([]);
    const bad = menu() as any;
    bad.menus[0].type = 'PICKUP';
    bad.menus[0].categories[0].items[0].allergens = ['GLUTEN'];
    bad.menus[0].categories[0].items[0].weight = { unit: 'oz', gross_value: 1.5, net_value: 1 };
    bad.menus[0].availability.monday = ['8am-10pm'];
    bad.callback_url = 'http://nope';
    const problems = validateSkipMenusPayload(bad).join(' | ');
    expect(problems).toContain('type is COLLECTION or DELIVERY');
    expect(problems).toContain('allergens can only hold');
    expect(problems).toContain('weight needs whole net_value and gross_value in g or kg');
    expect(problems).toContain('availability.monday slots look like');
    expect(problems).toContain('callback_url must be an https');
    expect(validateSkipMenusPayload({ restaurants: [], menus: [] })).toHaveLength(2);
  });
  it('POST /menus with the callback address; nothing is sent when the structure is wrong', async () => {
    process.env.FOODHUB_PUBLIC_URL = 'https://hub.test';
    mockFetch([[/\/menus$/, () => ({ status: 202 })]]);
    const res = await publishSkipMenus(menu() as any);
    expect(res).toMatchObject({ ok: true, status: 'queued' });
    expect(calls[0].body.callback_url).toBe('https://hub.test/api/foodhub/webhooks/skip/menu-status');
    const bad = await publishSkipMenus({ restaurants: [], menus: [] } as any);
    expect(bad.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('nothing leaves without the key and the live switch', () => {
  it('blocked, not faked', async () => {
    delete process.env.SKIP_JET_API_KEY;
    mockFetch([]);
    for (const r of [await getSkipModificationState(order()), await goLiveSkipLocation('L1'), await modifySkipOrder(order(), [{ removedItems: [{ plu: 'A', missingQuantity: 1 }] }])]) {
      expect(r.status).toBe('blocked');
    }
    expect(calls).toHaveLength(0);
  });
});
