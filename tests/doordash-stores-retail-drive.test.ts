// DoorDash API coverage (task 23), part 3: store status / menu on-off / hours check / 86 reconciliation, onboarding (SOW, SSIO,
// retail self-serve), Marketplace for Retailers, every Drive endpoint, the Ads API, the legacy API, the pharmacy deeplink, and
// the action registry — including a sweep proving that no action reaches Po Poulet NDG (DoorDash 27982486).
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveHours } from '../lib/foodhub/hours';
import { doorDashDrive } from '../lib/foodhub/delivery/doordash-drive';
import {
  allDrivePages, autocompleteDriveAddress, cancelDriveDelivery, checkDriveServiceability, compareDriveStores, createCheckoutSession, createDriveBusiness, DRIVE_UPDATABLE, driveClassic, getDriveStore,
  listDriveBusinesses, listDriveStoresOf, recordCheckoutDelivery, setDriveTip, tellDriveOrderReady, updateDriveDelivery, verifyCheckoutWebhook,
} from '../lib/foodhub/delivery/drive-api';
import { applyFleetEvent } from '../lib/foodhub/delivery/dispatch';
import { saveDelivery } from '../lib/foodhub/delivery/store';
import { DOORDASH_ACTIONS, doorDashApiStatus, runDoorDashAction } from '../lib/foodhub/doordash/actions';
import * as ads from '../lib/foodhub/doordash/ads';
import { legacy } from '../lib/foodhub/doordash/legacy';
import { managedMerchantConnectUrl, nvMultiLocationOnboardingIntent, requestDoorDashActivation, sowBody, ssio } from '../lib/foodhub/doordash/onboarding';
import { buildPharmacyDeeplink, pharmacyItemProblem } from '../lib/foodhub/doordash/pharmacy';
import {
  addCheckoutTransactions, authorizeCheckoutTransaction, createRetailPullJob, doorDashRetailReadiness, inventoryPullAnswer, promotionProblems, pushRetailCatalog, pushRetailPromotion, pushRetailStoreHours,
  pushRetailStoreItems, setRetailFulfillmentCapacity, storeHoursPullAnswer, updateRetailBusinessItems, type RetailPromotion,
} from '../lib/foodhub/doordash/retail';
import { setDoorDashSleep } from '../lib/foodhub/doordash/retry';
import { reconcileDoorDashAvailability, setDoorDashMenuActive, setDoorDashStoreStatus, verifyDoorDashHours } from '../lib/foodhub/doordash/stores';
import { setFeature } from '../lib/foodhub/expansion/features';
import { cleanProduct } from '../lib/foodhub/retail/catalog';
import { toDoorDashRetailItemsRequest, retailImageProblem } from '../lib/foodhub/retail/platforms';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, MasterMenu } from '../lib/foodhub/types';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* not json */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'DOORDASH_RETAIL_ENABLED', 'DOORDASH_RETAIL_BUSINESS_ID',
  'DOORDASH_DRIVE_DEVELOPER_ID', 'DOORDASH_DRIVE_KEY_ID', 'DOORDASH_DRIVE_SIGNING_SECRET', 'DOORDASH_DRIVE_ENV', 'DOORDASH_ADS_API_KEY', 'DOORDASH_ADS_AUTH_HEADER', 'DOORDASH_CHECKOUT_API_KEY', 'DOORDASH_SOW_URL', 'FOODHUB_MENU_LOCKED_STORES',
  'FOODHUB_FEATURE_RETAIL'];
const saved: Record<string, string | undefined> = {};
const actor = { username: 'o', name: 'Owner', source: 'dashboard' as const };
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  setDoorDashSleep(async () => undefined);
  Object.assign(process.env, {
    DOORDASH_DEVELOPER_ID: 'dev', DOORDASH_KEY_ID: 'kid', DOORDASH_SIGNING_SECRET: 'c2VjcmV0', DOORDASH_PROVIDER_TYPE: 'takatak_sandbox', DOORDASH_WEBHOOK_SECRET: 'dd-secret', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true',
    DOORDASH_DRIVE_DEVELOPER_ID: 'd1', DOORDASH_DRIVE_KEY_ID: 'k1', DOORDASH_DRIVE_SIGNING_SECRET: 'c2VjcmV0',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDoorDashSleep();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const PO = '27982486';
async function ddStore(over: Partial<ChannelStore> = {}): Promise<ChannelStore> {
  return getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-1', brandName: 'Pi Pita', locationCode: 'L1', autoAccept: true, online: true, meta: {}, ...over } as never);
}
const menu = (): MasterMenu => ({
  brandName: 'Pi Pita', categories: [{ ref: 'c1', name: 'Pitas', sortOrder: 0 }],
  items: [
    { ref: 'i1', name: 'Shawarma', price: 12, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] },
    { ref: 'i2', name: 'Falafel', price: 10, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [{ ref: 'g1', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm1', name: 'Garlic', price: 0, available: true }] }],
  updatedAt: new Date().toISOString(), unavailableByLocation: { L1: ['i2'] },
});

describe('store status (PUT …/status)', () => {
  it('pauses with a reason and an end time, resumes with is_active only', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    const r = await setDoorDashStoreStatus('dd-1', { active: false, reason: 'operational_issues', notes: 'Kitchen fire drill', endTime: '2026-10-10T08:00:00-04:00' });
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://openapi.doordash.com/marketplace/api/v1/stores/dd-1/status', body: { is_active: false, reason: 'operational_issues', notes: 'Kitchen fire drill', end_time: '2026-10-10T08:00:00-04:00', merchant_supplied_id: 'dd-1' } });
    await setDoorDashStoreStatus('dd-1', { active: true });
    expect(calls[1].body).toEqual({ is_active: true });
    await setDoorDashStoreStatus('dd-1', { active: false, reason: 'payment_issue', durationHours: 2 });
    expect(calls[2].body).toMatchObject({ duration_in_hours: 2 });
  });

  it('refuses a missing reason, an unknown reason, both end time and duration, and a bad end time', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    expect((await setDoorDashStoreStatus('dd-1', { active: false })).message).toMatch(/Choose a reason/);
    expect((await setDoorDashStoreStatus('dd-1', { active: false, reason: 'nope' as never })).message).toMatch(/Choose a reason/);
    expect((await setDoorDashStoreStatus('dd-1', { active: false, reason: 'operational_issues', endTime: '2026-10-10T08:00:00-04:00', durationHours: 1 })).message).toMatch(/OR a duration/);
    expect((await setDoorDashStoreStatus('dd-1', { active: false, reason: 'operational_issues', endTime: 'tomorrow' })).message).toMatch(/timezone offset/);
    expect(calls).toHaveLength(0);
  });

  it('a 400 says banking info / active menu is missing and that retrying does not help', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'activation failed' } }));
    expect((await setDoorDashStoreStatus('dd-1', { active: true })).message).toMatch(/banking information/);
    expect(calls).toHaveLength(1);
  });
});

describe('menu on / off, hours check and 86 reconciliation', () => {
  it('hides the whole menu: a publish with active false, honouring the store lock', async () => {
    const store = await ddStore();
    await getRepo().saveMenu(menu());
    mockFetch(() => ({ status: 202, body: { reference: 'r' } }));
    const r = await setDoorDashMenuActive(store, false, actor);
    expect(r.ok).toBe(true);
    expect(calls[0].body.menu.active).toBe(false);
    await setDoorDashMenuActive(store, true, actor);
    expect(calls[1].body.menu.active).toBe(true);
    const po = await ddStore({ channelStoreId: PO, brandName: 'Po Poulet' });
    mockFetch(() => ({ status: 202, body: {} }));
    expect((await setDoorDashMenuActive(po, false, actor)).message).toMatch(/protected/);
    expect(calls).toHaveLength(0);
  });

  it('verifyDoorDashHours: matching hours pass; a missing holiday and different hours are reported', async () => {
    const store = await ddStore();
    await getRepo().saveMenu(menu());
    const date = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const week = { monday: [{ open: '11:00', close: '21:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] };
    await saveHours({ locations: { L1: week as never }, brands: {}, holidays: [{ date, name: 'Holiday', closed: true, locationCodes: [] } as never] });
    const live = (open: string, special: unknown[]) => ({ status: 200, body: { menus: [{ menu_id: 'm', name: 'Main', is_active: true, open_hours: [{ day_index: 'MON', start_time: open, end_time: '21:00:00' }], special_hours: special }] } });
    mockFetch(() => live('11:00:00', [{ date, start_time: '00:00:00', end_time: '23:59:59', closed: true }]));
    expect(await verifyDoorDashHours(store)).toMatchObject({ ok: true, diffs: [] });
    mockFetch(() => live('10:00:00', []));
    const r = await verifyDoorDashHours(store);
    expect(r.ok).toBe(false);
    expect(r.diffs.join(' ')).toMatch(/regular hours MON 11:00-21:00 are not on DoorDash/);
    expect(r.diffs.join(' ')).toMatch(/has regular hours MON 10:00-21:00/);
    expect(r.diffs.join(' ')).toMatch(new RegExp(`special / holiday hours ${date} closed are not on DoorDash`));
  });

  const liveMenu = (i1Active: boolean, i2Active: boolean) => ({ status: 200, body: { menus: [{ id: 'm', menu: { name: 'Main', active: true, categories: [{ items: [
    { merchant_supplied_id: 'i1', name: 'Shawarma', active: i1Active, price: 1200, extras: [{ options: [{ merchant_supplied_id: 'm1', name: 'Garlic', active: true, price: 0 }] }] },
    { merchant_supplied_id: 'i2', name: 'Falafel', active: i2Active, price: 1000 },
    { merchant_supplied_id: 'zz', name: 'Not ours', active: true, price: 1 },
  ] }] } }] } });

  it('reconcile reports drift both ways, the DoorDash window, and ignores what Food Hub does not know', async () => {
    const store = await ddStore();
    await getRepo().saveMenu(menu());
    mockFetch((c) => (c.url.endsWith('/store_menu') ? liveMenu(false, true) : { status: 200, body: { merchant_supplied_id: 'i1', is_active: false, start_time: '2026-10-09 10:00:00', end_time: '2026-10-09 22:00:00' } }));
    const r = await reconcileDoorDashAvailability(store, { actor });
    expect(r.ok).toBe(true);
    expect(r.unknownOnDoorDash).toBe(1);
    expect(r.drift.map((d) => [d.id, d.foodHub, d.doordash])).toEqual([['i1', 'on', 'off'], ['i2', 'off', 'on']]);
    expect(r.drift[0].detail).toMatch(/until 2026-10-09 22:00:00/);
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('reconcile with fix re-86s only what Food Hub has off; restock also switches back on what DoorDash has off', async () => {
    const store = await ddStore();
    await getRepo().saveMenu(menu());
    mockFetch((c) => (c.method === 'PUT' ? { status: 200, body: {} } : c.url.endsWith('/store_menu') ? liveMenu(false, true) : { status: 200, body: { merchant_supplied_id: 'i1', is_active: false } }));
    const fixed = await reconcileDoorDashAvailability(store, { fix: true, actor });
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ url: expect.stringMatching(/\/stores\/dd-1\/items\/status$/), body: [{ merchant_supplied_id: 'i2', is_active: false }] });
    expect(fixed.fixed).toBe(1);
    const both = await reconcileDoorDashAvailability(store, { fix: true, restock: true, actor });
    expect(calls.filter((c) => c.method === 'PUT').some((c) => JSON.stringify(c.body) === JSON.stringify([{ merchant_supplied_id: 'i1', is_active: true }]))).toBe(true);
    expect(both.fixed).toBe(2);
  });

  it('a locked store is not reconciled (not even read) and "do not touch" blocks the fix', async () => {
    const po = await ddStore({ channelStoreId: PO, brandName: 'Po Poulet' });
    mockFetch(() => ({ status: 200, body: {} }));
    expect((await reconcileDoorDashAvailability(po, { actor })).message).toMatch(/protected/);
    const dnt = await ddStore({ channelStoreId: 'dd-2', brandName: 'Pi Pita', locationCode: 'L2', meta: { doNotTouch: true } });
    expect((await reconcileDoorDashAvailability(dnt, { fix: true, actor })).message).toMatch(/Do not touch/);
    expect(calls).toHaveLength(0);
  });
});

describe('onboarding: SOW, SSIO, retail self-serve', () => {
  const kitchen = { name: 'NDG kitchen', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9' };
  const me = { firstName: 'Marc', lastName: 'B', email: 'marc@example.com' };

  it('sowBody fills every required field from stored data, or says what is missing', async () => {
    const store = await ddStore({ meta: { platformStoreId: '4455' } });
    expect(sowBody(store, kitchen, me, 'admin@example.com').body).toMatchObject({
      partner_store_id: 'dd-1', partner_business_id: 'Pi Pita', doordash_store_id: 4455, partner_store_name: 'Pi Pita', provider_type: 'takatak_sandbox', address_line_1: '6280 Somerled Ave', address_city: 'Montréal', address_state: 'QC', address_zip: 'H4V 1R9',
      requestor_first_name: 'Marc', requestor_email: 'marc@example.com', merchant_decision_maker_email: 'admin@example.com',
    });
    expect(sowBody(store, { ...kitchen, postalCode: '' }, me, 'a@b.co').error).toMatch(/incomplete/);
    expect(sowBody(store, kitchen, { ...me, email: 'x' }, 'a@b.co').error).toMatch(/email/);
    expect(sowBody(store, kitchen, me, 'nope').error).toMatch(/decision maker/);
    delete process.env.DOORDASH_PROVIDER_TYPE;
    expect(sowBody(store, kitchen, me, 'a@b.co').error).toMatch(/PROVIDER_TYPE/);
  });

  it('requestDoorDashActivation POSTs the Store Onboarding Webhook once and remembers INTEGRATION_REQUESTED', async () => {
    const store = await ddStore();
    mockFetch(() => ({ status: 200, body: { message: 'OK' } }));
    const r = await requestDoorDashActivation(store, kitchen, me, 'admin@example.com', actor);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://openapi.doordash.com/webhooks/stores/onboarding' });
    expect((await getRepo().getStore(store.id))!.meta.doordashOnboarding).toMatchObject({ status: 'INTEGRATION_REQUESTED' });
  });

  it('requestDoorDashActivation refuses the protected store', async () => {
    const po = await ddStore({ channelStoreId: PO, brandName: 'Po Poulet' });
    mockFetch(() => ({ status: 200, body: {} }));
    expect((await requestDoorDashActivation(po, kitchen, me, 'admin@example.com', actor)).message).toMatch(/protected/);
    expect(calls).toHaveLength(0);
  });

  it('SSIO endpoints use the documented paths, the Merchant JWT header and the 100 limit', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    await ssio.exchangeToken({ code: 'abc' });
    await ssio.storeCandidates('mx-jwt', 500, 5);
    await ssio.initialize('mx-jwt', { location_id: 'dd-1' });
    await ssio.status('ob-1'); await ssio.putMenu('ob-1', { menu: {} }); await ssio.enable('ob-1'); await ssio.signupUrl({}); await ssio.reset('ob-1'); await ssio.onboardingMenu('ob-1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://openapi.doordash.com/marketplace', '')}`)).toEqual([
      'POST /api/v2/tokens', 'GET /api/v2/store_candidates?limit=100&offset=5', 'POST /api/v2/store_onboarding', 'GET /api/v2/store_onboarding/ob-1', 'POST /api/v2/store_onboarding/ob-1/menus',
      'POST /api/v2/store_onboarding/ob-1/enable', 'POST /api/v2/signup_url', 'DELETE /api/v2/store_onboarding/ob-1', 'GET /api/v1/store_onboarding/ob-1/store_menu',
    ]);
    expect(calls[1].headers.mxauthorization).toBe('mx-jwt');
    expect(calls[2].headers.mxauthorization).toBe('mx-jwt');
  });

  it('managed merchant connect URL and the 1-100 location intent', async () => {
    const req = { location_id: 'l1', location_group_id: 'g1', store_name: 'Pi Pita', address: { line_1: '1 Rue X', city: 'Montréal', state: 'QC', zip: 'H1H 1H1' }, first_name: 'M', last_name: 'B', email: 'm@b.co', merchant_decision_maker_email: 'a@b.co', order_protocol: 'POS', fulfillment_protocol: 'MERCHANT_PICK', locale: 'en-US' } as const;
    mockFetch(() => ({ status: 200, body: { managed_merchant_connect_url: 'https://doordash.com/x' } }));
    expect((await managedMerchantConnectUrl(req)).data).toEqual({ managed_merchant_connect_url: 'https://doordash.com/x' });
    expect(calls[0].url).toMatch(/\/api\/v2\/managed_merchant_connect_url$/);
    expect((await nvMultiLocationOnboardingIntent([])).message).toMatch(/between 1 and 100/);
    expect((await nvMultiLocationOnboardingIntent([req, req])).ok).toBe(true);
    expect(calls[1].body.requests).toHaveLength(2);
    expect((await managedMerchantConnectUrl({ ...req, location_id: PO })).message).toMatch(/protected/);
    mockFetch(() => ({ status: 409, body: {} }));
    expect((await managedMerchantConnectUrl(req)).message).toMatch(/already has this store/);
  });
});

describe('Marketplace for Retailers', () => {
  const apple = () => cleanProduct({ sku: 'APL', name: 'Apples', category: 'Fruit', price: 3.99, soldBy: 'weight', unit: 'kg', barcodes: ['4011'], stock: { L1: 20 }, imageUrl: 'https://img.example.com/apple.jpg' });
  const milk = () => cleanProduct({ sku: 'MLK', name: 'Milk 2%', category: 'Dairy', price: 4.5, barcodes: ['036000291452'], stock: { L1: 0 }, imageUrl: 'https://img.example.com/milk.png' });
  const noPic = () => cleanProduct({ sku: 'NOP', name: 'No picture', category: 'X', price: 1 });

  it('the catalogue request has the scope, official categorisation and UPC / PLU identifiers; products without a usable image are left out', () => {
    const { request, leftOut } = toDoorDashRetailItemsRequest([apple(), milk(), noPic()], 'biz-1');
    expect(request.scope).toEqual({ business_ids: ['biz-1'] });
    expect(request.items).toHaveLength(2);
    expect(request.items[0]).toMatchObject({ merchant_supplied_item_id: 'APL', item_categorizations: [{ category: { name: 'Fruit' } }], other_identifiers: [{ identifier_type: 'PLU', identifier_value: '4011' }], product_traits: ['WEIGHTED'] });
    expect(request.items[1].other_identifiers).toEqual([{ identifier_type: 'UPC', identifier_value: '036000291452' }]);
    expect(leftOut).toEqual([{ sku: 'NOP', name: 'No picture', problem: expect.stringMatching(/at least one image/) }]);
    expect(retailImageProblem('http://x.com/a.jpg')).toMatch(/https/);
    expect(retailImageProblem('https://x.com/a.jpg?w=1')).toMatch(/query/);
    expect(retailImageProblem('https://x.com/a.gif')).toMatch(/\.jpg/);
    expect(retailImageProblem('https://x.com/a.png')).toBeNull();
  });

  it('nothing is sent until DoorDash approved Retail and the business id is set', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    expect((await pushRetailCatalog([apple()])).result).toMatchObject({ ok: false, status: 'blocked', message: expect.stringMatching(/not switched on/) });
    process.env.DOORDASH_RETAIL_ENABLED = 'true';
    await setFeature('retail', true, actor);
    expect((await pushRetailCatalog([apple()])).result.message).toMatch(/BUSINESS_ID/);
    expect(doorDashRetailReadiness()).toMatchObject({ enabled: true, ready: false });
    expect(calls).toHaveLength(0);
  });

  it('catalogue, store items, hours, capacity, job, promotion, business prices and checkout hit the documented endpoints', async () => {
    process.env.DOORDASH_RETAIL_ENABLED = 'true'; process.env.DOORDASH_RETAIL_BUSINESS_ID = 'biz-1';
    await setFeature('retail', true, actor);
    await ddStore({ channelStoreId: 'store-9', locationCode: 'L1' });
    mockFetch(() => ({ status: 202, body: { operation_id: 'op', operation_status: 'QUEUED', message: 'ok' } }));
    const cat = await pushRetailCatalog([apple(), milk(), noPic()], 'add', actor);
    expect(cat.sent).toBe(2);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://openapi.doordash.com/marketplace/api/v2/items', body: { scope: { business_ids: ['biz-1'] } } });
    await pushRetailCatalog([apple()], 'update');
    expect(calls[1].method).toBe('PATCH');

    // store items: batches of 1000, POST needs 50 items for a brand new menu
    const many = Array.from({ length: 1200 }, (_, i) => cleanProduct({ sku: `S${i}`, name: `P${i}`, category: 'C', price: 1, stock: { L1: 5 }, barcodes: [] }));
    const sent = await pushRetailStoreItems('store-9', 'L1', 'update', many);
    expect(sent.sent).toBe(1200);
    const patches = calls.filter((c) => c.url.endsWith('/stores/store-9/items'));
    expect(patches.map((c) => c.body.items.length)).toEqual([1000, 200]);
    expect(patches[0].body.items[0]).toMatchObject({ merchant_supplied_item_id: 'S0', item_availability: 'ACTIVE', price_info: { base_price: 100 }, balance_on_hand: 5 });
    expect((await pushRetailStoreItems('store-9', 'L1', 'add', many.slice(0, 10))).result.message).toMatch(/at least 50/);

    await pushRetailStoreHours('store-9', 'Pi Pita', 'L1');
    expect(calls.at(-1)?.method).toBe('PATCH');
    await saveHours({ locations: { L1: { monday: [{ open: '09:00', close: '17:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } as never }, brands: {}, holidays: [] });
    expect((await pushRetailStoreHours('store-9', 'Pi Pita', 'L1')).ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({ url: expect.stringMatching(/\/api\/v2\/stores\/store-9$/), body: { merchant_supplied_store_id: 'store-9', open_hours: [{ day_index: 'MON', start_time: '09:00:00', end_time: '17:00:00' }] } });

    await setRetailFulfillmentCapacity('store-9', 'OVER_CAPACITY', new Date('2026-10-09T12:00:00Z'));
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/stores\/store-9\/fulfillment_capacity$/), body: { status: 'OVER_CAPACITY', status_timestamp: '2026-10-09T12:00:00.000Z' } });
    await createRetailPullJob('store-9', true);
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/api\/v2\/jobs$/), body: { job_type: 'PULL_STORE_ITEMS_WITH_PAGINATION', job_parameters: { store_location_id: 'store-9', pull_mode: 'REPLACE' } } });
    await updateRetailBusinessItems([{ merchant_supplied_item_id: 'APL', price_info: { base_price: 450 } }]);
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/\/api\/v2\/businesses\/biz-1\/items$/) });
    await authorizeCheckoutTransaction('store-9', { dd_direct_scan_code: 'SCAN', transaction_contents: { total: 10, currency_code: 'CAD' } });
    expect(calls.at(-1)?.url).toMatch(/stores\/store-9\/checkout\/transactions\/auth$/);
    await addCheckoutTransactions('store-9', [{ merchant_supplied_transaction_id: 't1', in_store_transaction_contents: { total: 10, currency_code: 'CAD' } }]);
    expect(calls.at(-1)?.url).toMatch(/stores\/store-9\/checkout\/transactions$/);
  });

  it('promotions are validated and sent to the promotions endpoint', async () => {
    process.env.DOORDASH_RETAIL_ENABLED = 'true'; process.env.DOORDASH_RETAIL_BUSINESS_ID = 'biz-1';
    await setFeature('retail', true, actor);
    const promo: RetailPromotion = { promotion_id: 'p1', promotion_type: 'BUY_X_SAVE_Y', funding_source: 'MERCHANT', purchase_criteria: { purchase_items: ['APL'], purchase_quantity: 2 }, discount_options: { discount_price_off: 100 }, start_time: '2026-10-10T00:00:00Z', end_time: '2026-10-17T00:00:00Z' };
    expect(promotionProblems(promo)).toEqual([]);
    expect(promotionProblems({ ...promo, end_time: '2026-10-01T00:00:00Z', purchase_criteria: { purchase_items: [], purchase_quantity: 0 } }).length).toBe(2);
    mockFetch(() => ({ status: 202, body: {} }));
    expect((await pushRetailPromotion('store-9', { ...promo, promotion_id: '' })).message).toMatch(/promotion_id/);
    expect((await pushRetailPromotion('store-9', promo, 'update')).ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/\/api\/v2\/promotions\/stores\/store-9$/), body: { promotion_id: 'p1' } });
  });

  it('the inventory pull answer lists active and inactive products, paginated on request; hours pull answers the Store model', async () => {
    const all = [apple(), milk(), { ...noPic(), active: false }];
    const plain = inventoryPullAnswer(all, 'L1', false);
    expect(plain.items.map((i) => [i.merchant_supplied_item_id, i.item_availability])).toEqual([['APL', 'ACTIVE'], ['MLK', 'INACTIVE'], ['NOP', 'INACTIVE']]);
    expect(plain.items[1].price_info).toEqual({ base_price: 450 });
    const many = Array.from({ length: 1100 }, (_, i) => cleanProduct({ sku: `S${i}`, name: `P${i}`, category: 'C', price: 1, stock: { L1: 5 } }));
    const p2 = inventoryPullAnswer(many, 'L1', false, 2) as { items: unknown[]; meta: Record<string, string> };
    expect(p2.items).toHaveLength(500);
    expect(p2.meta).toEqual({ current_page: '2', page_size: '500', total_page: '3' });
    expect(inventoryPullAnswer(many, 'L1', false, 3)).toMatchObject({ meta: { page_size: '100' } });
    const alcohol = cleanProduct({ sku: 'WIN', name: 'Wine', category: 'Wine', price: 15, alcohol: { abv: 12 }, stock: { L1: 3 } });
    expect(inventoryPullAnswer([alcohol], 'L1', false).items).toEqual([]);
    expect(inventoryPullAnswer([alcohol], 'L1', true).items).toHaveLength(1);
    await saveHours({ locations: { L1: { monday: [{ open: '09:00', close: '17:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } as never }, brands: {}, holidays: [] });
    expect(await storeHoursPullAnswer('store-9', 'Pi Pita', 'L1')).toMatchObject({ merchant_supplied_store_id: 'store-9', open_hours: [{ day_index: 'MON' }], special_hours: [] });
  });

  it('retail calls refuse the protected store (path or body) before anything is sent', async () => {
    process.env.DOORDASH_RETAIL_ENABLED = 'true'; process.env.DOORDASH_RETAIL_BUSINESS_ID = 'biz-1';
    await setFeature('retail', true, actor);
    mockFetch(() => ({ status: 202, body: {} }));
    const promo: RetailPromotion = { promotion_id: 'p1', promotion_type: 'BUY_X_SAVE_Y', funding_source: 'MERCHANT', purchase_criteria: { purchase_items: ['A'], purchase_quantity: 1 }, discount_options: {}, start_time: '2026-10-10T00:00:00Z', end_time: '2026-10-17T00:00:00Z' };
    const results = await Promise.all([
      pushRetailStoreItems(PO, 'NDG', 'update', [cleanProduct({ sku: 'A', name: 'A', category: 'C', price: 1, stock: { NDG: 1 } })]), setRetailFulfillmentCapacity(PO, 'OVER_CAPACITY'), createRetailPullJob(PO), pushRetailStoreHours(PO, 'Po Poulet', 'NDG'),
      pushRetailPromotion(PO, promo), authorizeCheckoutTransaction(PO, { dd_direct_scan_code: 'x', transaction_contents: { total: 1, currency_code: 'CAD' } }), addCheckoutTransactions(PO, [{ merchant_supplied_transaction_id: 't', in_store_transaction_contents: { total: 1, currency_code: 'CAD' } }]),
    ]);
    for (const r of results) expect(JSON.stringify(r)).toMatch(/protected/);
    expect(calls).toHaveLength(0);
  });
});

describe('DoorDash Drive: every endpoint', () => {
  it('update delivery sends only the documented fields; tip in cents; order_ready_time when the kitchen is done', async () => {
    mockFetch(() => ({ status: 200, body: { external_delivery_id: 'd1' } }));
    expect((await updateDriveDelivery('d1', { nope: 1 })).message).toMatch(/does not accept: nope/);
    expect((await updateDriveDelivery('d1', {})).message).toMatch(/Nothing to change/);
    expect(DRIVE_UPDATABLE).toContain('order_ready_time');
    await setDriveTip('d1', 5.5);
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'https://openapi.doordash.com/drive/v2/deliveries/d1', body: { tip: 550 } });
    expect((await setDriveTip('d1', -1)).ok).toBe(false);
    await saveDelivery({ id: 'fhd-1', orderId: 'ord-1', fleet: 'doordash_drive', environment: 'sandbox', status: 'assigned', tip: 0, orderValue: 20, containsAlcohol: false, requestedBy: 'o', timeline: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const told = await tellDriveOrderReady('ord-1', new Date('2026-10-09T15:00:00Z'));
    expect(told.sent).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/deliveries\/fhd-1$/), body: { order_ready_time: '2026-10-09T15:00:00.000Z' } });
    expect((await tellDriveOrderReady('other-order')).sent).toBe(false);
  });

  it('cancel with reason_code / should_create_return_delivery; serviceability; address suggestions', async () => {
    mockFetch((c) => (c.url.endsWith('/serviceability') ? { status: 200, body: { is_serviceable: false, reasons_not_serviceable: ['OUT_OF_RANGE'] } } : { status: 200, body: { results: [{ address: { formatted_address: '1 Rue X' } }] } }));
    await cancelDriveDelivery('d1', { reasonCode: 'CHANGE_OF_MIND', shouldCreateReturnDelivery: false });
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://openapi.doordash.com/drive/v2/deliveries/d1/cancel', body: { reason_code: 'CHANGE_OF_MIND', should_create_return_delivery: false } });
    const s = await checkDriveServiceability({ pickup_address: '6280 Somerled, Montréal', dropoff_address: '1 Rue X, Laval' });
    expect(s.data).toEqual({ is_serviceable: false, reasons_not_serviceable: ['OUT_OF_RANGE'] });
    expect(calls[1].url).toBe('https://openapi.doordash.com/drive/v2/serviceability');
    expect((await checkDriveServiceability({ dropoff_address: '' })).message).toMatch(/required/);
    expect((await autocompleteDriveAddress({ input_address: '12' })).data?.results).toEqual([]);
    expect(calls).toHaveLength(2);
    const a = await autocompleteDriveAddress({ input_address: '123 rue S' });
    expect(a.data?.results?.[0].address).toMatchObject({ formatted_address: '1 Rue X' });
    expect(calls[2].body).toMatchObject({ input_address: '123 rue S', country: 'CA', max_results: 5 });
  });

  it('businesses and stores: create / get / list with the continuation token, compared with Food Hub’s registry', async () => {
    mockFetch((c) => {
      if (c.method === 'GET' && c.url.endsWith('/stores')) return { status: 200, body: { result: [{ external_store_id: 'NDG' }, { external_store_id: 'EXTRA' }], continuation_token: null, result_count: 2 } };
      if (c.method === 'GET' && c.url.includes('continuationToken=tok')) return { status: 200, body: { result: [{ external_business_id: 'b1' }], continuation_token: null, result_count: 1 } };
      if (c.method === 'GET' && c.url.includes('/businesses')) return { status: 200, body: { result: [{ external_business_id: 'b0' }], continuation_token: 'tok', result_count: 1 } };
      return { status: 200, body: { external_business_id: 'b1' } };
    });
    const first = await listDriveBusinesses({ activationStatus: 'ACTIVE' });
    expect(first.data).toEqual({ result: [{ external_business_id: 'b0' }], continuationToken: 'tok', resultCount: 1 });
    expect(calls[0].url).toBe('https://openapi.doordash.com/developer/v1/businesses?activationStatus=ACTIVE');
    const pages = await allDrivePages((t) => listDriveBusinesses({ continuationToken: t }));
    expect(pages.data).toHaveLength(2);
    await createDriveBusiness({ external_business_id: 'b1', name: 'TAKATAK' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: 'https://openapi.doordash.com/developer/v1/businesses' });
    await getDriveStore('b1', 'NDG');
    expect(calls.at(-1)?.url).toBe('https://openapi.doordash.com/developer/v1/businesses/b1/stores/NDG');
    expect((await listDriveStoresOf('b1')).data?.result).toHaveLength(2);
    const cmp = await compareDriveStores('b1', { NDG: { storeId: 'NDG' }, MTL: { storeId: 'MTL' } });
    expect(cmp.data).toEqual({ onDoorDash: 2, missing: ['MTL'], unregistered: ['EXTRA'] });
  });

  it('Drive (classic) uses /drive/v1; Drive refuses a pickup store that is protected', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    await driveClassic.estimate({ a: 1 }); await driveClassic.validate({}); await driveClassic.create({}); await driveClassic.get('x'); await driveClassic.update('x', {}); await driveClassic.cancel('x');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://openapi.doordash.com', '')}`)).toEqual([
      'POST /drive/v1/estimates', 'POST /drive/v1/validations', 'POST /drive/v1/deliveries', 'GET /drive/v1/deliveries/x', 'PATCH /drive/v1/deliveries/x', 'PUT /drive/v1/deliveries/x/cancel',
    ]);
    const before = calls.length;
    expect((await updateDriveDelivery('d1', { pickup_external_store_id: PO })).message).toMatch(/protected/);
    expect((await getDriveStore('b1', PO)).message).toMatch(/protected/);
    expect((await checkDriveServiceability({ dropoff_address: 'x', pickup_external_store_id: PO })).message).toMatch(/protected/);
    expect(calls).toHaveLength(before);
  });

  it('DoorDash Checkout API: session with the API key, webview URL, retry on 5xx, webhook key check', async () => {
    const session = { cart: { items: [{ merchant_supplied_id: 'i1', quantity: 1 }] }, currency: 'CAD' as const, consumer: { email: 'a@b.co' }, delivery_address: { street: '1 Rue X', city: 'Montréal', state: 'QC', zip_code: 'H1H 1H1', country: 'CA' }, external_store_id: 'dd-1' };
    mockFetch(() => ({ status: 200, body: { order_session_id: 'sess-1' } }));
    expect((await createCheckoutSession(session)).status).toBe('blocked');
    process.env.DOORDASH_CHECKOUT_API_KEY = 'key-1';
    let n = 0;
    mockFetch(() => (++n === 1 ? { status: 503, body: {} } : { status: 200, body: { order_session_id: 'sess-1' } }));
    const r = await createCheckoutSession(session);
    expect(r).toMatchObject({ ok: true, orderSessionId: 'sess-1', webviewUrl: 'https://order.online/embed/v1/checkout/?order_session_id=sess-1' });
    expect(calls[0]).toMatchObject({ url: 'https://api.doordash.com/drive/v1/checkout', headers: expect.objectContaining({ authorization: 'Bearer key-1' }) });
    expect((await createCheckoutSession({ ...session, external_store_id: PO })).message).toMatch(/protected/);
    expect(verifyCheckoutWebhook(new Headers({ authorization: 'Bearer key-1' }))).toBe(true);
    expect(verifyCheckoutWebhook(new Headers({ authorization: 'Bearer nope' }))).toBe(false);
    expect(await recordCheckoutDelivery({ external_order_id: 'o1', tracking_url: 'https://t', event_category: 'delivery_created' })).toBe('recorded');
    expect(await getRepo().getKv('doordash_checkout:o1')).toMatchObject({ trackingUrl: 'https://t' });
  });

  it('Drive webhooks: proof photos and signature, batching, shopping and parcel events reach the delivery', async () => {
    const ev = doorDashDrive.parseWebhook({ event_name: 'DASHER_DROPPED_OFF', external_delivery_id: 'fhd-9', dropoff_verification_image_url: 'https://img/d.jpg', dropoff_signature_image_url: 'https://img/s.png', pickup_verification_image_url: 'https://img/p.jpg' })!;
    expect(ev).toMatchObject({ status: 'delivered', proof: { pickupImageUrl: 'https://img/p.jpg', dropoffImageUrl: 'https://img/d.jpg', signatureImageUrl: 'https://img/s.png' } });
    expect(doorDashDrive.parseWebhook({ event_name: 'DELIVERY_BATCHED', external_delivery_id: 'x', force_batch_id: 'abcdef123456' })).toMatchObject({ status: null, note: expect.stringMatching(/Batched/) });
    expect(doorDashDrive.parseWebhook({ event_name: 'DASHER_COMPLETED_SHOPPING', external_delivery_id: 'x', shopped_items: [{}, {}], unfulfilled_items: [{}] })?.note).toBe('Shopping complete: 2 item(s) picked, 1 not found');
    expect(doorDashDrive.parseWebhook({ event_name: 'DASHER_COMPLETED_STAGING', external_delivery_id: 'x', staged_containers: [{}] })?.note).toMatch(/staged/);
    expect(doorDashDrive.parseWebhook({ event_name: 'PARCEL_SCANNED', external_delivery_id: 'x', description: 'Scanned at the hub' })?.note).toBe('Scanned at the hub');
    const now = new Date().toISOString();
    await saveDelivery({ id: 'fhd-9', orderId: 'ord-9', fleet: 'doordash_drive', environment: 'sandbox', status: 'picked_up', tip: 0, orderValue: 20, containsAlcohol: false, requestedBy: 'o', timeline: [], createdAt: now, updatedAt: now });
    const out = await applyFleetEvent(ev);
    expect(out.delivery?.proof).toMatchObject({ signatureImageUrl: 'https://img/s.png' });
    const noted = await applyFleetEvent({ fleet: 'doordash_drive', ref: 'fhd-9', status: null, event: 'DELIVERY_BATCHED', at: now, note: 'Batched with other deliveries' });
    expect(noted.delivery?.timeline.at(-1)).toMatchObject({ status: 'note', message: 'Batched with other deliveries' });
  });
});

describe('Ads, legacy Marketplace, pharmacy deeplink', () => {
  it('Ads: blocked without the key; with it, the documented paths, the key header and the live switch for changes', async () => {
    mockFetch(() => ({ status: 200, body: { campaigns: [] } }));
    expect((await ads.listCampaigns('sp')).message).toMatch(/Ads API key missing/);
    process.env.DOORDASH_ADS_API_KEY = 'ads-key';
    await ads.listCampaigns('sb', { startIndex: 0, count: 10 });
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://openapi.doordash.com/ads/api/v1/sb/campaigns?startIndex=0&count=10', headers: expect.objectContaining({ authorization: 'Bearer ads-key' }) });
    process.env.DOORDASH_ADS_AUTH_HEADER = 'x-api-key';
    await ads.getMerchants();
    expect(calls[1].headers['x-api-key']).toBe('ads-key');
    await ads.createCampaign('sp', { name: 'Spring', budget: { daily: { unitAmount: 5000 } }, startDate: '2026-10-10 00:00:00' });
    expect(calls[2]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/ads\/api\/v1\/sp\/campaigns$/) });
    delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
    expect((await ads.updateCampaign('sp', { campaignId: 'c1', status: 'PAUSED' })).message).toMatch(/LIVE_CONNECTORS_GLOBAL_ENABLED/);
    expect(calls).toHaveLength(3);
    expect(ads.listAdGroups('sp', {})).toMatchObject({ status: 'blocked' });
    expect(await ads.validateCatalog([])).toMatchObject({ status: 'blocked' });
    expect(await ads.createAdsReport('NOPE' as never, { reportName: 'x', startDate: 'a', endDate: 'b' })).toMatchObject({ status: 'blocked' });
  });

  it('Ads: all 27 operations have a function with the documented path', async () => {
    process.env.DOORDASH_ADS_API_KEY = 'k';
    mockFetch(() => ({ status: 200, body: {} }));
    const adsT = { name: 'n', startDate: 'a', endDate: 'b', campaignId: 'c', adGroupId: 'g' };
    await Promise.all([
      ads.createCampaign('sp', { name: 'n', budget: {}, startDate: 'a' }), ads.updateCampaign('sp', { campaignId: 'c' }), ads.listCampaigns('sp'), ads.getCampaign('sp', 'c'), ads.campaignRecommendations('c'),
      ads.createAdGroup('sp', adsT), ads.updateAdGroup('sp', adsT), ads.listAdGroups('sp', { campaignIdFilter: 'c' }), ads.getAdGroup('sp', 'g'),
      ads.createProductAd('sp', { campaignId: 'c', adGroupId: 'g', idType: 'UPC', productId: 'p' }), ads.listProductAds('sp', { adGroupIdFilter: 'g' }), ads.deleteProductAd('sp', { campaignId: 'c', adGroupId: 'g', idType: 'UPC', productId: 'p' }),
      ads.createAsset({ name: 'a', type: 'IMAGE', width: 1, height: 1 }), ads.getAsset('a'), ads.registerAsset('a'), ads.createCreatives({ campaignId: 'c', adGroupId: 'g', creatives: [] }), ads.listCreatives('c'),
      ads.getMerchants(), ads.recommendedKeywords({ placements: [{ type: 'SEARCH' }], products: [] }), ads.recommendedKeywordsForAdGroup('g', { placements: [{ type: 'SEARCH' }], products: [] }),
      ads.searchResources({ classificationType: 'BRAND', resourceTypes: ['L1_BRAND'] }), ads.validateCatalog([{ idType: 'UPC', productId: 'p' }]), ads.menuLabels(), ads.audienceEstimate({ filters: [{ field: 'PLACEMENT', values: ['SEARCH'] }] }),
      ads.createAdsReport('CAMPAIGN', { reportName: 'r', startDate: 'a', endDate: 'b' }), ads.downloadAdsReport('r'), ads.listAdsReports({ startDate: '2026-01-01' }),
    ]);
    const seen = new Set(calls.map((c) => `${c.method} ${c.url.replace('https://openapi.doordash.com/ads/api/v1', '').split('?')[0]}`));
    expect(seen.size).toBe(27);
    for (const s of ['POST /sp/campaigns', 'PUT /sp/campaigns', 'GET /campaigns/c/recommendations', 'DELETE /sp/productAds', 'POST /assets/a/register', 'POST /sb/creatives', 'GET /sb/creatives', 'POST /sp/adGroups/g/keywords', 'POST /resources/search', 'POST /sp/catalogs/validate',
      'GET /menu/labels', 'POST /targeting/audience/estimate', 'POST /sp/reports/CAMPAIGN/create', 'GET /sp/reports/download/r', 'GET /sp/reports/list']) expect(seen.has(s)).toBe(true);
  });

  it('the legacy API lives on pointofsale.doordash.com with its own activation paths', async () => {
    mockFetch(() => ({ status: 200, body: {} }));
    await legacy.storeInfo('dd-1'); await legacy.setStoreActivation('dd-1', { is_active: false, reason: 'operational_issues' });
    await legacy.setItemActivation('dd-1', [{ merchant_supplied_id: 'i1', is_active: false }]); await legacy.setItemOptionActivation('dd-1', [{ merchant_supplied_id: 'o1', is_active: true }]);
    await legacy.menuDetails('dd-1'); await legacy.storeMenu('dd-1'); await legacy.confirmOrder('o', {}); await legacy.adjustOrder('o', {}); await legacy.cancelOrder('o', {}); await legacy.orderEvent('o', 'order_ready_for_pickup', {}); await legacy.createMenu({}, 'dd-1'); await legacy.updateMenu('m', {}, 'dd-1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://pointofsale.doordash.com', '')}`)).toEqual([
      'GET /api/v1/stores/dd-1', 'PUT /api/v1/stores/dd-1/activation-status', 'PUT /api/v1/stores/dd-1/item/activation-status', 'PUT /api/v1/stores/dd-1/item_option/activation-status',
      'GET /api/v1/stores/dd-1/menu_details', 'GET /api/v1/stores/dd-1/store_menu', 'PATCH /api/v1/orders/o', 'PATCH /api/v1/orders/o/adjustment', 'PATCH /api/v1/orders/o/cancellation',
      'PATCH /api/v1/orders/o/events/order_ready_for_pickup', 'POST /api/v1/menus', 'PATCH /api/v1/menus/m',
    ]);
    const before = calls.length;
    expect((await legacy.storeInfo(PO)).message).toMatch(/protected/);
    expect((await legacy.setItemActivation(PO, [])).message).toMatch(/protected/);
    expect(calls).toHaveLength(before);
  });

  it('pharmacy deeplink: item format, expiry, PHI refusal and an RSA signature that verifies', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const link = { merchantTag: 'abc', storeId: '123', items: [{ name: 'PRO', copayCents: 500, expiresAtUnix: future }] };
    expect(buildPharmacyDeeplink(link).url).toBe(`https://www.doordash.com/rx/abc?store_id=123&item=${encodeURIComponent(`PRO:500:${future}`)}`);
    expect(buildPharmacyDeeplink({ ...link, items: [{ name: 'John 1980-01-01', copayCents: 1, expiresAtUnix: future }] }).error).toMatch(/personal data/);
    expect(buildPharmacyDeeplink({ ...link, items: [{ name: 'PRO', copayCents: 1, expiresAtUnix: 1 }] }).error).toMatch(/future/);
    expect(pharmacyItemProblem('a:b')).toMatch(/cannot contain/);
    expect(buildPharmacyDeeplink({ ...link, fulfillmentType: 'pdf_417' }).error).toMatch(/fulfillment_data/);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const signed = buildPharmacyDeeplink(link, { privateKeyPem: pem }).url!;
    const [unsigned, sig] = signed.split('&signature=');
    expect(signed.endsWith(`&signature=${sig}`)).toBe(true);
    expect(crypto.verify('RSA-SHA256', Buffer.from(unsigned), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(decodeURIComponent(sig), 'base64url'))).toBe(true);
  });
});

describe('the action registry', () => {
  it('has a unique id per action, a permission, and a group for the console', () => {
    const ids = DOORDASH_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of DOORDASH_ACTIONS) { expect(a.perm).toBeDefined(); expect(a.group).toBeTruthy(); expect(a.help.length).toBeGreaterThan(10); }
    expect(doorDashApiStatus().map((s) => s.key)).toEqual(['marketplace', 'adjustment', 'reports', 'retail', 'drive', 'ads', 'checkout']);
  });

  it('SWEEP: no action of the registry reaches Po Poulet NDG (27982486) — not as a store, an order, a path or a body', async () => {
    process.env.DOORDASH_RETAIL_ENABLED = 'true'; process.env.DOORDASH_RETAIL_BUSINESS_ID = 'biz-1'; process.env.DOORDASH_ADS_API_KEY = 'k';
    process.env.DOORDASH_ORDER_ADJUSTMENT = 'true'; process.env.DOORDASH_ORDER_RETURNS = 'true'; process.env.DOORDASH_CHECKOUT_API_KEY = 'ck';
    await setFeature('retail', true, actor);
    const po = await ddStore({ channelStoreId: 'NDG_6284-POPOULET', brandName: 'Po Poulet', locationCode: 'NDG_6284', meta: { platformStoreId: PO } });
    const n = parseDoorDashOrderFixture();
    const { order } = await getRepo().insertOrderIfNew({ ...n, channelStoreId: PO, brandName: 'Po Poulet', locationCode: 'NDG_6284' } as never);
    mockFetch(() => ({ status: 200, body: {} }));
    const inputs: Record<string, Record<string, unknown>> = {
      store_details: {}, menu_details: {}, store_menu: {}, item_availability: { itemId: 'i1' }, verify_hours: {}, reconcile: { fix: true, restock: true },
      store_status: { active: false, reason: 'operational_issues' }, menu_active: { active: false }, request_activation: { merchantEmail: 'a@b.co', firstName: 'A', lastName: 'B', email: 'a@b.co' },
      order_substitute: { line: 0, name: 'X', itemId: 'x', price: 1 }, order_option: { line: 0, option: 0, quantity: 0 }, order_ready_event: {}, order_return: { items: [{ merchant_supplied_id: 'i1', quantity: 1 }], locationId: PO },
      retail_store_items: { mode: 'update' }, retail_store_hours: {}, retail_capacity: {}, retail_pull_job: {}, retail_promotion: { promotion: { promotion_id: 'p', promotion_type: 'BUY_X_SAVE_Y', purchase_criteria: { purchase_items: ['a'], purchase_quantity: 1 }, start_time: '2026-10-10T00:00:00Z', end_time: '2026-10-11T00:00:00Z' } },
      retail_checkout_auth: { request: { dd_direct_scan_code: 'x', transaction_contents: { total: 1, currency_code: 'CAD' } } },
      retail_checkout_transactions: { transactions: [{ merchant_supplied_transaction_id: 't', in_store_transaction_contents: { total: 1, currency_code: 'CAD' } }] },
      raw_get: { path: `/api/v1/stores/${PO}/store_details` },
    };
    const withBody = (op: string, extra: Record<string, unknown> = {}) => ({ op, ...extra });
    const sweepOps: Array<[string, Record<string, unknown>]> = [
      ['managed_connect', { body: { location_id: PO, location_group_id: 'g', store_name: 'x' } }],
      ['nv_intent', { requests: [{ location_id: PO }] }],
      ['ssio', withBody('initialize', { body: { merchantJwt: 'j', request: { location_id: PO } } })],
      ['drive', withBody('getStore', { id: 'b1', id2: PO })],
      ['drive', withBody('updateDelivery', { id: 'd1', body: { pickup_external_store_id: PO } })],
      ['drive', withBody('serviceability', { body: { dropoff_address: 'x', pickup_external_store_id: PO } })],
      ['checkout_session', { session: { cart: { items: [] }, currency: 'CAD', consumer: { email: 'a@b.co' }, delivery_address: {}, external_store_id: PO } }],
      ['legacy', withBody('storeInfo', { id: PO })], ['legacy', withBody('setItemActivation', { id: PO, body: [] })],
    ];
    const results: Array<{ id: string; message: string }> = [];
    for (const a of DOORDASH_ACTIONS) {
      const base = inputs[a.id];
      if (!base) continue;
      const input = { ...base, ...(a.params.some((p) => p.type === 'store') ? { store: po.id } : {}), ...(a.params.some((p) => p.type === 'order') ? { order: order.id } : {}) };
      const out = await runDoorDashAction(a, { actor, input });
      results.push({ id: a.id, message: out.message });
      expect(out.ok, `${a.id}: ${out.message}`).toBe(false);
    }
    for (const [id, input] of sweepOps) {
      const a = DOORDASH_ACTIONS.find((x) => x.id === id)!;
      const out = await runDoorDashAction(a, { actor, input });
      results.push({ id, message: out.message });
      expect(out.ok, `${id} ${JSON.stringify(input).slice(0, 60)}: ${out.message}`).toBe(false);
    }
    // Everything refused with the protected-store message, and not one request left Food Hub.
    for (const r of results) expect(r.message, r.id).toMatch(/protected|not switched on|allowlist|Do not touch|Choose/i);
    expect(calls, JSON.stringify(calls.map((c) => c.url))).toHaveLength(0);
  });

  it('a normal store goes through the same actions: store details are read with the store’s id', async () => {
    const store = await ddStore();
    mockFetch(() => ({ status: 200, body: { merchant_supplied_id: 'dd-1', is_active: true } }));
    const a = DOORDASH_ACTIONS.find((x) => x.id === 'store_details')!;
    const out = await runDoorDashAction(a, { actor, input: { store: store.id } });
    expect(out.ok).toBe(true);
    expect(calls[0].url).toMatch(/\/stores\/dd-1\/store_details$/);
    expect((await runDoorDashAction(a, { actor, input: {} })).message).toBe('Choose a store.');
  });
});

import { parseDoorDashOrder } from '../lib/foodhub/adapters/doordash';
function parseDoorDashOrderFixture() {
  return parseDoorDashOrder({ order: { id: 'po-order-1', store: { merchant_supplied_id: PO }, subtotal: 1000, tax: 150, fulfillment_type: 'pickup', categories: [{ items: [{ merchant_supplied_id: 'i1', name: 'Poulet', price: 1000, quantity: 1, line_item_id: 'li-1', extras: [{ options: [{ merchant_supplied_id: 'o1', name: 'Sauce', price: 0, quantity: 1, line_option_id: 'lo-1' }] }] }] }] } })!;
}
