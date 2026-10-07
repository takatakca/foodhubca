// Uber Eats integration, final audit (2026-10-07) against developer.uber.com/docs/eats: activation (pos_data,
// integration_enabled, order manager), menu body (one translation, tax_info, energy_interval), webhook inbox and
// replay, documented event payloads, missed-order check, tokens, "Do not touch" and the publish-to-all-Uber dry run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetUberTokenMemory, invalidateUberToken, listUberStorePages, uberAccessToken, uberApiBase, uberOrderManager, uberTokenUrl } from '../lib/foodhub/adapters/uber-eats';
import { activateUberStores, activationMessage, explainActivationError, suggestMapping, uberPosDataBody } from '../lib/foodhub/adapters/uber-provision';
import { saveUberWebhook, UBER_INBOX, type UberInboxEntry } from '../lib/foodhub/adapters/uber-inbox';
import { getInboxEntry, sweepInbox } from '../lib/foodhub/inbox';
import { handleUberEvent, recoverMissedUberOrders, runUberWebhook } from '../lib/foodhub/adapters/uber-events';
import { checkUberMenu, toUberMenu } from '../lib/foodhub/menu/translate';
import { result } from '../lib/foodhub/config';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, MasterMenu, PublishContext } from '../lib/foodhub/types';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; auth: string | null };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = init.headers as Record<string, string> | undefined;
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url: String(url), method: init.method || 'GET', body, auth: h?.Authorization ?? null };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const tokenCalls = () => calls.filter((c) => c.url.endsWith('/oauth/v2/token'));
const settle = () => new Promise((r) => setTimeout(r, 40));

const API = 'https://api.uber.com';
const appToken = (c: Call) => (c.url.endsWith('/oauth/v2/token') ? { status: 200, body: { access_token: 'app-token', expires_in: 2592000 } } : null);

const store = (over: Partial<ChannelStore> = {}): Omit<ChannelStore, 'id'> => ({ channel: 'uber_eats', channelStoreId: 'uber-ndg', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {}, ...over });

const menu: MasterMenu = {
  brandName: 'Po Poulet',
  categories: [{ ref: 'mains', name: 'Plats', nameFr: 'Plats principaux', sortOrder: 1 }, { ref: 'empty', name: 'Empty', sortOrder: 2 }],
  items: [
    { ref: 'i1', name: 'Grilled chicken', nameFr: 'Poulet grillé', price: 10, calories: 780, categoryRef: 'mains', available: true, modifierGroupRefs: ['g1', 'g2'] },
    { ref: 'i2', name: 'Fries', price: 4, categoryRef: 'mains', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'g1', name: 'Sauce', min: 1, max: 1, modifiers: [{ ref: 'm1', name: 'Piri-piri', price: 1, available: true }, { ref: 'm2', name: 'BBQ', price: 0, available: true }] },
    // The same option (m1) in a second group: one Uber item, not two.
    { ref: 'g2', name: 'Extra sauce', min: 0, max: 2, modifiers: [{ ref: 'm1', name: 'Piri-piri', price: 1, available: true }] },
  ],
  channelMarkupPct: { uber_eats: 20 },
  updatedAt: new Date().toISOString(),
};
const ctx: PublishContext = { hours: null, holidays: [], timezone: 'America/Toronto', today: '2026-10-07', language: 'both' };

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.UBER_CLIENT_ID = 'uber-id';
  process.env.UBER_CLIENT_SECRET = 'secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  for (const k of ['UBER_ACCESS_TOKEN', 'UBER_BASE_URL', 'UBER_AUTH_URL', 'UBER_LOGIN_URL', 'UBER_ENV', 'UBER_OAUTH_SCOPE', 'UBER_TAX_RATE_PCT', 'CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN']) delete process.env[k];
  forgetUberTokenMemory();
  await invalidateUberToken('orders'); await invalidateUberToken('poll');
});
afterEach(() => vi.unstubAllGlobals());

describe('store suggestions for the 17 Uber stores', () => {
  it('9 NDG stores at 6280 Somerled and 8 at 5839 Jean-Talon (Food Hub says 5837) get a location; brands from Uber names', () => {
    expect(suggestMapping('BIN MOLLE & BIN DURE', '6280 Avenue Somerled, Montréal')).toEqual({ suggestedBrand: 'Bin molle & Bin Dure', suggestedLocation: 'NDG_MAIN' });
    expect(suggestMapping("O'OEUFS EXPRESS", '6280 Avenue Somerled')).toEqual({ suggestedBrand: 'OOeuf', suggestedLocation: 'NDG_MAIN' });
    expect(suggestMapping('Po Poulet', '5839 Rue Jean-Talon E, Saint-Léonard')).toEqual({ suggestedBrand: 'Po Poulet', suggestedLocation: 'SAINT_LEONARD' });
    expect(suggestMapping('Pi Pita', 'Rue Jean-Talon Est').suggestedLocation).toBe('SAINT_LEONARD'); // the only kitchen on that street
    expect(suggestMapping('X', '6290 Avenue Somerled').suggestedLocation).toBeUndefined(); // two kitchens on Somerled: never guessed
    expect(suggestMapping('Pizza Algerie', '6280 Avenue Somerled').suggestedBrand).toBeUndefined();
  });
});

describe('Uber menu body (PUT /v2/eats/stores/{id}/menus)', () => {
  it('one translation per text, tax_info on every item, calories as energy_interval (E5), +20% on items and options', () => {
    const u = toUberMenu(menu, ctx);
    const i1 = u.items.find((i) => i.id === 'i1') as any;
    expect(i1.title.translations).toEqual({ fr_ca: 'Poulet grillé / Grilled chicken' });
    expect(i1.tax_info).toEqual({});
    expect(i1.nutritional_info).toEqual({ calories: { energy_interval: { lower: 78000000, upper: 78000000 } } });
    expect(i1.price_info.price).toBe(1200);
    expect((u.items.find((i) => i.id === 'mod:m1') as any).price_info.price).toBe(120);
    expect(u.items.every((i) => 'tax_info' in i)).toBe(true);
  });
  it('UBER_TAX_RATE_PCT adds tax_rate on first-level items only (when Uber asks for it)', () => {
    process.env.UBER_TAX_RATE_PCT = '14.975';
    const u = toUberMenu(menu, ctx);
    expect((u.items.find((i) => i.id === 'i1') as any).tax_info).toEqual({ tax_rate: 14.975 });
    expect((u.items.find((i) => i.id === 'mod:m1') as any).tax_info).toEqual({});
    process.env.UBER_TAX_RATE_PCT = 'abc';
    expect((toUberMenu(menu, ctx).items.find((i) => i.id === 'i1') as any).tax_info).toEqual({});
  });
  it('an option shared by two groups is one item; an empty category is left out; the body passes the checks', () => {
    const u = toUberMenu(menu, ctx);
    expect(u.items.filter((i) => i.id === 'mod:m1')).toHaveLength(1);
    expect(u.modifier_groups.find((g) => g.id === 'g2')?.modifier_options).toEqual([{ id: 'mod:m1', type: 'ITEM' }]);
    expect(u.categories.map((c) => c.id)).toEqual(['mains']);
    expect(u.menus[0].category_ids).toEqual(['mains']);
    expect(checkUberMenu(u)).toEqual([]);
  });
  it('checkUberMenu catches what Uber would refuse', () => {
    const u = toUberMenu(menu, ctx) as any;
    u.modifier_groups[0].quantity_info.quantity = { min_permitted: 3, max_permitted: 1 };
    u.categories[0].entities.push({ id: 'ghost', type: 'ITEM' });
    const codes = checkUberMenu(u).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['uber_group_min_max', 'uber_group_min_options', 'uber_missing_item']));
  });
});

describe('activation (integration activation flow)', () => {
  it('order manager is read from order_manager_client_id — never guessed', () => {
    expect(uberOrderManager({ order_manager_client_id: 'uber-id' })).toBe('foodhub');
    expect(uberOrderManager({ order_manager_client_id: 'uber-id', is_order_manager_pending: true })).toBe('pending');
    expect(uberOrderManager({ order_manager_client_id: 'urbanpiper' })).toBe('other');
    expect(uberOrderManager({ is_order_manager: true, integration_enabled: true })).toBe('unknown');
    expect(uberOrderManager(undefined)).toBe('unknown');
  });
  it('pos_data body: integrator ids, no manual acceptance, courier webhooks, webhooks_version unset', () => {
    const b = uberPosDataBody({ brandName: 'Pi Pita', locationCode: 'SAINT_LEONARD' });
    expect(b).toMatchObject({ integrator_store_id: 'SAINT_LEONARD:Pi Pita', integrator_brand_id: 'Pi Pita', is_order_manager: true, require_manual_acceptance: false });
    expect(b.webhooks_config.delivery_status_webhooks.is_enabled).toBe(true);
    expect('webhooks_version' in b.webhooks_config).toBe(false);
  });
  it('a refused activation says why in owner words (UrbanPiper, wrong login, store not visible)', () => {
    expect(explainActivationError(result('uber_eats', 'error', 'POST … returned HTTP 400: store already has an active integration', { httpStatus: 400 }))).toMatch(/UrbanPiper.*merchants@uber\.com/);
    expect(explainActivationError(result('uber_eats', 'error', 'nope', { httpStatus: 403 }))).toMatch(/Uber Eats Manager owner account/);
    expect(explainActivationError(result('uber_eats', 'error', 'nope', { httpStatus: 404 }))).toMatch(/production access/);
    expect(activationMessage({ result: result('uber_eats', 'done', 'OK'), enabled: result('uber_eats', 'done', 'OK'), pos: { orderManager: 'other', integrationEnabled: true, orderManagerClientId: 'up', checkedAt: '' } })).toMatch(/UrbanPiper/);
  });
  it('POST pos_data with the merchant token, then PATCH integration_enabled and GET pos_data with the app token', async () => {
    const id = 'a'.repeat(36);
    await getRepo().setKv(`uber-connect:${id}`, { createdAt: Date.now(), token: 'merchant-token', stores: [] });
    mockFetch((c) => appToken(c) ?? (c.method === 'GET' && c.url.endsWith('/pos_data') ? { status: 200, body: { order_manager_client_id: 'urbanpiper', integration_enabled: true } } : { status: 204 }));
    const [a] = await activateUberStores(id, [{ storeId: 'uber-stl', brandName: 'Pi Pita', locationCode: 'SAINT_LEONARD' }]);
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/pos_data'))?.auth).toBe('Bearer merchant-token');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.auth).toBe('Bearer app-token');
    expect(patch?.body).toEqual({ integration_enabled: true });
    expect(a.pos?.orderManager).toBe('other');
    expect(a.message).toMatch(/UrbanPiper/);
    expect((await getRepo().getKv<{ token: string | null }>(`uber-connect:${id}`))?.token).toBeNull(); // merchant token discarded
  });
});

describe('tokens and hosts', () => {
  it('one token request: kept in the database for other instances / restarts; a new secret never reuses it', async () => {
    mockFetch((c) => appToken(c) ?? { status: 200, body: {} });
    expect(await uberAccessToken()).toBe('app-token');
    forgetUberTokenMemory(); // cold start
    expect(await uberAccessToken()).toBe('app-token');
    expect(tokenCalls()).toHaveLength(1);
    process.env.UBER_CLIENT_SECRET = 'rotated';
    forgetUberTokenMemory();
    await uberAccessToken();
    expect(tokenCalls()).toHaveLength(2);
  });
  it('UBER_ENV=sandbox uses sandbox-login.uber.com + test-api.uber.com (Uber: mixing domains fails)', () => {
    expect(uberTokenUrl()).toBe('https://auth.uber.com/oauth/v2/token');
    process.env.UBER_ENV = 'sandbox';
    expect(uberTokenUrl()).toBe('https://sandbox-login.uber.com/oauth/v2/token');
    expect(uberApiBase()).toBe('https://test-api.uber.com');
  });
  it('store list follows next_key and stops on a repeated key', async () => {
    const pages: Record<string, unknown> = { '': { stores: [{ store_id: 'a' }], next_key: 'k1' }, k1: { stores: [{ store_id: 'b' }], next_key: 'k1' } };
    const rows = await listUberStorePages(async (url) => new Response(JSON.stringify(pages[new URL(url).searchParams.get('start_key') ?? '']), { status: 200 }));
    expect(rows.map((r) => r.store_id)).toEqual(['a', 'b']);
  });
});

// Uber webhooks live in the shared webhook inbox (lib/foodhub/inbox.ts, kind "uber"; entry id = Uber's event_id).
describe('webhook inbox (saved before the 200, replayed if unfinished)', () => {
  it('a re-delivered event_id is a duplicate; an unfinished copy older than 2 minutes is processed again', async () => {
    const body = { event_type: 'orders.notification', event_id: 'evt-1', meta: { resource_id: 'o1' } };
    const raw = JSON.stringify(body);
    const first = await saveUberWebhook(body, raw);
    expect(first).toEqual({ id: 'evt-1', duplicate: false });
    expect((await saveUberWebhook(body, raw)).duplicate).toBe(true);
    expect(await getInboxEntry('evt-1')).toMatchObject({ channel: 'uber_eats', kind: 'uber', reference: 'o1', status: 'received' });
    // Delivered again 3 minutes later while the first copy never finished (the server stopped): processed again.
    expect((await saveUberWebhook(body, raw, Date.now() + 3 * 60_000)).duplicate).toBe(false);
  });
  it('the recovery sweep replays only what is still unfinished after 2 minutes', async () => {
    const a = await saveUberWebhook({ event_type: 'x', event_id: 'pending-1' }, '{}');
    const b = await saveUberWebhook({ event_type: 'x', event_id: 'done-1' }, '{}');
    expect(await runUberWebhook(b.id)).toBe(true);
    expect(await sweepInbox({ now: Date.now() })).toEqual({ processed: 0, failed: 0 }); // too early
    expect(await sweepInbox({ now: Date.now() + 3 * 60_000 })).toEqual({ processed: 1, failed: 0 });
    expect((await getInboxEntry(a.id))?.status).toBe('done');
  });
  it('route: saved before the 200, processed after; a store that cannot be saved gets 503 so Uber retries', async () => {
    const crypto = await import('node:crypto');
    process.env.UBER_WEBHOOK_SIGNING_KEY = 'sign-key';
    const { POST } = await import('../app/api/foodhub/webhooks/uber-eats/route');
    await getRepo().upsertStore(store());
    const raw = JSON.stringify({ event_type: 'store.status.changed', event_id: 'evt-status-1', meta: { resource_id: 'uber-ndg', status: 'PAUSED' } });
    const req = () => new Request('http://hub.local/api/foodhub/webhooks/uber-eats', { method: 'POST', headers: { 'x-uber-signature': crypto.createHmac('sha256', 'sign-key').update(raw).digest('hex') }, body: raw });
    expect((await POST(req() as any)).status).toBe(200);
    await settle();
    expect((await getRepo().getDoc<UberInboxEntry>(UBER_INBOX, 'evt-status-1'))?.data.status).toBe('done');
    expect((await getRepo().findStore('uber_eats', 'uber-ndg'))?.online).toBe(false);
    const spy = vi.spyOn(getRepo(), 'putDocs').mockRejectedValueOnce(new Error('db down'));
    const raw2 = raw.replace('evt-status-1', 'evt-status-2');
    const res = await POST(new Request('http://hub.local/x', { method: 'POST', headers: { 'x-uber-signature': crypto.createHmac('sha256', 'sign-key').update(raw2).digest('hex') }, body: raw2 }) as any);
    expect(res.status).toBe(503);
    spy.mockRestore();
  });
  it('a failed processing is kept and retried by itself; after the last automatic try it waits for Replay and alerts', async () => {
    mockFetch((c) => appToken(c) ?? { status: 500, body: { message: 'boom' } });
    const body = { event_type: 'orders.notification', event_id: 'evt-fail', meta: { resource_id: 'o-fail', user_id: 'uber-ndg' }, resource_href: `${API}/v2/eats/order/o-fail` };
    const { id } = await saveUberWebhook(body, JSON.stringify(body));
    const failedNow = () => getRepo().listActivity({}).then((rows) => rows.filter((a) => a.action === 'webhook_failed'));
    expect(await runUberWebhook(id)).toBe(false);
    const e1 = await getInboxEntry(id);
    expect(e1).toMatchObject({ status: 'failed', attempts: 1 });
    expect(e1?.nextAt).toBeTruthy();
    expect(await failedNow()).toHaveLength(0);
    await runUberWebhook(id);
    await runUberWebhook(id);
    expect(await getInboxEntry(id)).toMatchObject({ status: 'failed', attempts: 3, nextAt: null });
    expect((await getRepo().getDoc<UberInboxEntry>(UBER_INBOX, id))?.data.body).toEqual(body);
    expect(await failedNow()).toHaveLength(1);
  });
});

const uberOrder = (id: string, state = 'CREATED') => ({
  id, display_id: id.slice(-4), current_state: state, store: { id: 'uber-ndg' }, eater: { first_name: 'Marie' }, type: 'DELIVERY_BY_UBER', placed_at: new Date().toISOString(),
  cart: { items: [{ id: 'i1', external_data: 'i1', title: 'Grilled chicken', quantity: 1, price: { unit_price: { amount: 1200 }, total_price: { amount: 1200 } } }] },
  payment: { charges: { sub_total: { amount: 1200 }, tax: { amount: 180 }, total: { amount: 1380, currency_code: 'CAD' } } },
});

describe('documented event payloads', () => {
  it('delivery.state_changed reads the order from meta.order_id; FAILED is flagged', async () => {
    const repo = getRepo();
    await repo.upsertStore(store());
    const { order } = await repo.insertOrderIfNew({ channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'o-courier', channelStoreId: 'uber-ndg', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 1, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 1, lines: [], raw: {} });
    await handleUberEvent({ event_type: 'delivery.state_changed', meta: { courier_trip_id: 't', store_id: 'uber-ndg', order_id: 'o-courier', status: 'ARRIVED_AT_PICKUP' } });
    expect((await repo.getOrder(order.id))?.timeline?.courier?.status).toBe('at_store');
    await handleUberEvent({ event_type: 'delivery.state_changed', meta: { order_id: 'o-courier', status: 'FAILED' } });
    expect((await repo.listEvents(order.id)).some((e) => e.type === 'courier_failed')).toBe(true);
  });
  it('store.provisioned: reads who gets the orders, finishes switching the order webhooks on, flags a menu request', async () => {
    const repo = getRepo();
    await repo.upsertStore(store({ meta: { provisionedAt: new Date().toISOString(), awaitingProvision: true } }));
    let enabled = false;
    mockFetch((c) => appToken(c) ?? (c.method === 'PATCH' ? ((enabled = true), { status: 204 }) : c.url.endsWith('/pos_data') ? { status: 200, body: { order_manager_client_id: 'uber-id', integration_enabled: enabled } } : { status: 204 }));
    await handleUberEvent({ event_type: 'store.provisioned', store_id: 'uber-ndg', perform_refresh_menu: true });
    const s = await repo.findStore('uber_eats', 'uber-ndg');
    expect(s?.meta).toMatchObject({ provisioned: true, awaitingProvision: false, uberPos: { orderManager: 'foodhub', integrationEnabled: true } });
    expect(s?.meta.menuRefreshRequested).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // the menu is never pushed blindly
  });
  it('an order already CANCELED when Food Hub reads it is recorded cancelled and never accepted', async () => {
    await getRepo().upsertStore(store());
    mockFetch((c) => appToken(c) ?? (c.url.includes('/v2/eats/order/') ? { status: 200, body: uberOrder('o-late', 'CANCELED') } : { status: 204 }));
    await handleUberEvent({ event_type: 'orders.notification', meta: { resource_id: 'o-late', user_id: 'uber-ndg' }, resource_href: `${API}/v2/eats/order/o-late` });
    expect((await getRepo().findOrder('uber_eats', 'o-late'))?.status).toBe('cancelled');
    expect(calls.some((c) => c.url.includes('accept_pos_order'))).toBe(false);
  });
  it('orders.customer_order_edit flags the order for the kitchen without touching Clover', async () => {
    const repo = getRepo();
    await repo.upsertStore(store());
    const { order } = await repo.insertOrderIfNew({ channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'o-edit', channelStoreId: 'uber-ndg', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 1, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 1, lines: [], raw: {} });
    mockFetch((c) => appToken(c) ?? { status: 200, body: uberOrder('o-edit') });
    await handleUberEvent({ event_type: 'orders.customer_order_edit', meta: { resource_id: 'o-edit' }, resource_href: `${API}/v2/eats/order/o-edit` });
    expect((await repo.getOrder(order.id))?.channelError).toMatch(/customer changed/);
    expect((await repo.listEvents(order.id)).find((e) => e.type === 'customer_order_edit')?.detail.lines).toEqual(['1× Grilled chicken']);
  });
});

describe('missed-order check (created-orders)', () => {
  it('only stores Uber confirmed as Food Hub’s; 60 s head start; nothing past the 11.5-minute window', async () => {
    const repo = getRepo();
    await repo.upsertStore(store({ meta: { uberPos: { orderManager: 'foodhub' } } }));
    await repo.upsertStore(store({ channelStoreId: 'uber-up', meta: { uberPos: { orderManager: 'other' } } }));
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    mockFetch((c) => appToken(c)
      ?? (c.url.includes('/uber-ndg/created-orders') ? { status: 200, body: { orders: [{ id: 'o-missed', placed_at: ago(3) }, { id: 'o-old', placed_at: ago(15) }, { id: 'o-new', placed_at: ago(0.2) }] } }
        : c.url.includes('/v2/eats/order/') ? { status: 200, body: uberOrder(c.url.split('/').pop()!) } : { status: 204 }));
    expect(await recoverMissedUberOrders()).toEqual({ recovered: 1 });
    expect(await repo.findOrder('uber_eats', 'o-missed')).not.toBeNull();
    expect(await repo.findOrder('uber_eats', 'o-old')).toBeNull();
    expect(await repo.findOrder('uber_eats', 'o-new')).toBeNull();
    expect(calls.some((c) => c.url.includes('/uber-up/'))).toBe(false);
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'false';
    calls.length = 0;
    expect(await recoverMissedUberOrders()).toEqual({ recovered: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('"Do not touch" and publish to all Uber stores', () => {
  it('publishMenu and 86 never reach a "do not touch" store; the dry run calls nothing; publish-all sends only ready stores', async () => {
    const repo = getRepo();
    await repo.saveMenu(menu);
    await repo.upsertStore(store());
    await repo.upsertStore(store({ channelStoreId: 'uber-dnt', locationCode: 'SAINT_LEONARD', meta: { doNotTouch: true } }));
    await repo.upsertStore(store({ channelStoreId: 'uber-nomenu', brandName: 'Pi Pita' }));
    mockFetch((c) => appToken(c) ?? { status: 204 });
    const { publishMenu, setItemAvailability } = await import('../lib/foodhub/ops');
    const rows = await publishMenu('Po Poulet');
    expect(rows.find((r) => r.channelStoreId === 'uber-dnt')?.result.status).toBe('skipped');
    await setItemAvailability('Po Poulet', ['i1'], false);
    expect(calls.some((c) => c.url.includes('uber-dnt'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/uber-ndg/menus'))).toBe(true);

    const { planUberPublish, publishAllUber } = await import('../lib/foodhub/menu/uber-publish');
    calls.length = 0;
    const plan = await planUberPublish();
    expect(calls).toHaveLength(0);
    const row = (cid: string) => plan.rows.find((r) => r.channelStoreId === cid)!;
    expect(row('uber-ndg')).toMatchObject({ action: 'publish', markupPct: 20, counts: { items: 2, modifierGroups: 2, modifierOptions: 2 } });
    expect(row('uber-ndg').samples[0]).toEqual({ name: 'Grilled chicken', base: 10, uber: 12 });
    expect(row('uber-dnt').skip).toBe('do_not_touch');
    expect(row('uber-nomenu').skip).toBe('no_menu');
    expect(plan.summary).toEqual({ stores: 3, publish: 1, doNotTouch: 1, blocked: 1 });
    const { results } = await publishAllUber();
    expect(calls.filter((c) => c.method === 'PUT').map((c) => new URL(c.url).pathname)).toEqual(['/v2/eats/stores/uber-ndg/menus']);
    expect(results.map((r) => [r.channelStoreId, r.result.status]).sort()).toEqual([['uber-dnt', 'skipped'], ['uber-ndg', 'done'], ['uber-nomenu', 'blocked']]);
  });
});
