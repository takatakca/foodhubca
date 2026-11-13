// FH-024: the two Clover locks that lived in one process's memory — the order-send guard (pipeline.ts
// `cloverSending()`) and the token-refresh guard (clover-oauth.ts `inflight`) — are claims in the database
// (repo.claimKv) now, so two servers cannot send the same order to Clover at once nor burn a single-use
// refresh token. In these tests the repository IS the shared database (in-memory repo): a claim placed
// directly on it is exactly a claim another server holds. A claim is refused while the first holder has it,
// released when the guarded step ends, and taken over once it is older than the 10-minute stuck window.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUberOrder } from '../lib/foodhub/adapters/uber-eats';
import { cloverSendingClaimKey, isSendingToClover, resendToClover } from '../lib/foodhub/pipeline';
import { _resetOrderTypeCache } from '../lib/foodhub/pos/clover-order';
import { cloverOAuthToken, cloverRefreshClaimKey, finishCloverConnect } from '../lib/foodhub/pos/clover-oauth';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu, StoredOrder } from '../lib/foodhub/types';

// Route background work (next/server after()) runs right away in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

const realFetch = globalThis.fetch;
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

// ---------------------------------------------------------------------------
// Part A — the send lock (pipeline.ts), harness modelled on reconcile-pr6.
// ---------------------------------------------------------------------------

const MID = 'TESTMERCH0001';
type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let cloverOrders: Array<{ id: string; title: string; total: number; createdTime: number }> = [];
/** Runs while Clover is creating an order (to observe the claim mid-send). */
let duringAtomic: (() => Promise<void>) | null = null;
let seq = 0;

const jsonRes = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));
const agoMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function mockCloverPos() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (url.hostname === 'api.clover.test') {
      if (p.endsWith('/order_types')) return jsonRes({ elements: [{ id: 'OT-ONLINE-DELIV', label: 'Online Order Delivery' }, { id: 'OT-ONLINE-PICKUP', label: 'Online Order Pick Up' }] });
      if (p.endsWith('/atomic_order/orders')) {
        const id = `CLV${++seq}`;
        cloverOrders.push({ id, title: body.orderCart.title, total: 1999, createdTime: Date.now() });
        if (duringAtomic) await duringAtomic();
        return jsonRes({ id, total: 1999 });
      }
      if (/\/orders$/.test(p) && method === 'GET') return jsonRes({ elements: cloverOrders.map((o) => ({ ...o })) });
      if (p.endsWith('/print_event')) return jsonRes({ id: `PE-${body?.orderRef?.id}`, state: 'CREATED' });
      if (/\/orders\/[^/]+$/.test(p)) return jsonRes({ id: p.split('/').pop() });
    }
    return jsonRes({}, 404);
  }) as any;
}

function uberDetails(id: string) {
  return {
    id, display_id: id.slice(-5).toUpperCase(), store: { id: 'ue-popoulet-ndg' }, eater: { first_name: 'Marie' }, type: 'DELIVERY_BY_UBER',
    cart: { items: [{ id: 'CLV-6MCX', external_data: 'CLV-6MCX', title: '6 MCX + Frites', quantity: 1, price: { base_unit_price: { amount: 1679 }, unit_price: { amount: 1679 }, total_price: { amount: 1679 } } }] },
    payment: { charges: { sub_total: { amount: 1679 }, tax: { amount: 252 }, total: { amount: 1931 } } },
    placed_at: agoMin(0),
  };
}

const menu: MasterMenu = {
  brandName: 'Po Poulet', posMerchantId: MID,
  categories: [{ ref: 'CAT', name: 'Poulet', sortOrder: 0 }],
  items: [{ ref: 'CLV-6MCX', posItemRef: 'CLV-6MCX', name: '6 MCX + Frites', price: 16.79, categoryRef: 'CAT', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
  updatedAt: new Date().toISOString(),
};

const ENV_A: Record<string, string> = {
  FOODHUB_FORCE_MEMORY: 'true', LIVE_CONNECTORS_GLOBAL_ENABLED: 'true', FOODHUB_RETRY_TIMER: 'off',
  CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clover-token',
  UBER_BASE_URL: 'https://api.uber.test', UBER_AUTH_URL: 'https://auth.uber.test/oauth/v2/token', UBER_CLIENT_ID: 'uber-id', UBER_CLIENT_SECRET: 'uber-secret',
};
const CLEARED_A = ['CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'FOODHUB_CLOVER_RETRY_S', 'FOODHUB_VIA_CLOVER', 'CLOVER_CLIENT_ID', 'SESSION_SECRET'];
const savedA: Record<string, string | undefined> = {};

async function waitingOrder(id: string): Promise<StoredOrder> {
  const n = { ...parseUberOrder(uberDetails(id))!, channelStoreId: 'ue-popoulet-ndg' };
  const { order } = await getRepo().insertOrderIfNew({ ...n, brandName: 'Po Poulet', locationCode: 'NDG_6284' });
  return (await getRepo().updateOrder(order.id, { posError: 'register offline' }))!;
}

describe('FH-024 — the Clover send lock lives in the database (pipeline.ts)', () => {
  beforeEach(async () => {
    for (const [k, v] of Object.entries(ENV_A)) { savedA[k] = process.env[k]; process.env[k] = v; }
    for (const k of CLEARED_A) { savedA[k] = process.env[k]; delete process.env[k]; }
    (globalThis as any).__foodhubMem = undefined;
    (globalThis as any).__foodhubCloverSending = undefined;
    calls = []; cloverOrders = []; duringAtomic = null; seq = 0;
    _resetOrderTypeCache();
    mockCloverPos();
    await getRepo().saveMenu(menu);
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'ue-popoulet-ndg', brandName: 'Po Poulet', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedA)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('claim semantics: a second claim on the send key is refused while the first holds; release allows re-claim', async () => {
    const repo = getRepo();
    const key = cloverSendingClaimKey('order-claim-1');
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(false);
    await repo.releaseKv(key);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true);
  });

  it('a send claim held by another server refuses the send — nothing reaches Clover — and releasing it lets the send through', async () => {
    const repo = getRepo();
    const o = await waitingOrder('uber-lock-held');
    const key = cloverSendingClaimKey(o.id);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true); // another server is sending it
    expect(await isSendingToClover(o.id)).toBe(true);
    const refused = await resendToClover(o);
    expect(refused.pos).toMatchObject({ ok: false, skipped: true });
    expect(sent('POST', /atomic_order/)).toHaveLength(0);
    // The refused send must not give back a claim that is not its own.
    expect(await repo.getKv(key)).not.toBeNull();
    await repo.releaseKv(key); // the other server finished
    expect(await isSendingToClover(o.id)).toBe(false);
    const sentOk = await resendToClover(o);
    expect(sentOk.pos.ok).toBe(true);
    expect(sent('POST', /atomic_order/)).toHaveLength(1);
  });

  it('our own send holds the claim in the database while it runs and gives it back when it ends', async () => {
    const repo = getRepo();
    const o = await waitingOrder('uber-lock-own');
    let during: boolean | null = null;
    let kvDuring: unknown = null;
    duringAtomic = async () => { during = await isSendingToClover(o.id); kvDuring = await repo.getKv(cloverSendingClaimKey(o.id)); };
    const r = await resendToClover(o);
    expect(r.pos.ok).toBe(true);
    expect(during).toBe(true);
    expect(kvDuring).toMatchObject({ at: expect.any(String) });
    expect(await repo.getKv(cloverSendingClaimKey(o.id))).toBeNull();
    expect(await isSendingToClover(o.id)).toBe(false);
  });

  it('a send claim abandoned by a server that stopped mid-send is taken over after the stuck window', async () => {
    const repo = getRepo();
    const o = await waitingOrder('uber-lock-stuck');
    await repo.claimKv(cloverSendingClaimKey(o.id), { at: agoIso(11 * 60_000) }); // claimed 11 minutes ago, never released
    const r = await resendToClover(o);
    expect(r.pos.ok).toBe(true);
    expect(sent('POST', /atomic_order/)).toHaveLength(1);
    expect(await repo.getKv(cloverSendingClaimKey(o.id))).toBeNull(); // our send gave its claim back
  });

  it('two sends at once on this server still produce exactly one Clover order (the claim backs the local guard)', async () => {
    const o = await waitingOrder('uber-lock-race');
    const [a, b] = await Promise.all([resendToClover(o), resendToClover(o)]);
    expect(a.pos.ok).toBe(true);
    expect(b.pos).toMatchObject({ ok: false, skipped: true });
    expect(sent('POST', /atomic_order/)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Part B — the token-refresh lock (clover-oauth.ts), harness modelled on clover-app.
// ---------------------------------------------------------------------------

const APP = 'TESTAPP000001';
type OAuthCall = { url: string; method: string; body: any };
let oauthCalls: OAuthCall[] = [];
let tokenSeq = 0;

function mockCloverOAuth() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    oauthCalls.push({ url: String(input), method, body });
    const js = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const now = Math.floor(Date.now() / 1000);
    if (url.hostname === 'chat.example') return js(200, {});
    if (p === '/oauth/v2/token') {
      if (body?.code !== 'GOOD-CODE' || body?.client_secret !== 'app-secret-test') return js(400, { message: 'invalid code' });
      tokenSeq++;
      return js(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 });
    }
    if (p === '/oauth/v2/refresh') {
      if (!String(body?.refresh_token || '').startsWith('RT-')) return js(401, {});
      tokenSeq++;
      return js(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 });
    }
    if (p === `/v3/apps/${APP}/merchants/${MID}/billing_info`) return js(200, { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Free' } });
    const m = `/v3/merchants/${MID}`;
    if (p === m) return js(200, { id: MID, name: 'Test Bistro', address: { city: 'Montréal', state: 'QC', country: 'CA' } });
    if (p === `${m}/items`) return js(200, { elements: [{ id: 'I1' }] });
    if (p === `${m}/categories`) return js(200, { elements: [{ id: 'C1' }] });
    if (p === `${m}/devices`) return js(200, { elements: [{ id: 'D1' }] });
    if (p === `${m}/order_types`) return js(200, { elements: [] });
    if (p === `${m}/tenders`) return js(200, { elements: [{ id: 'T-CASH', label: 'Cash' }] });
    return js(404, {});
  }) as any;
}

const refreshCalls = () => oauthCalls.filter((c) => c.url.endsWith('/oauth/v2/refresh'));

describe('FH-024 — the Clover token-refresh lock lives in the database (clover-oauth.ts)', () => {
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
    process.env.CLOVER_CLIENT_ID = APP;
    process.env.CLOVER_CLIENT_SECRET = 'app-secret-test';
    process.env.CLOVER_BASE_URL = 'https://api.clover.com';
    process.env.FOODHUB_PUBLIC_URL = 'https://foodhub.example';
    process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef';
    delete process.env.CLOVER_ACCESS_TOKEN; delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_MERCHANT_TOKENS; delete process.env.CLOVER_WEB_URL;
    delete process.env.ALERT_WEBHOOK_URL; delete process.env.FOODHUB_OWNER_EMAIL;
    process.env.CLOVER_ALLOWED_MERCHANTS = MID;
    oauthCalls = []; tokenSeq = 0;
    mockCloverOAuth();
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('claim semantics: a second claim on the refresh key is refused while the first holds; release allows re-claim', async () => {
    const repo = getRepo();
    const key = cloverRefreshClaimKey('foodhub', MID);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(false);
    await repo.releaseKv(key);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true);
  });

  it('while another server holds the refresh claim, no refresh POST is made — the still-valid token is handed back; after its release the refresh runs', async () => {
    const repo = getRepo();
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const now = Math.floor(Date.now() / 1000);
    const key = cloverRefreshClaimKey('foodhub', MID);
    expect(await repo.claimKv(key, { at: new Date().toISOString() })).toBe(true); // another server is refreshing now
    const held = await cloverOAuthToken(MID, now + 1800 - 60); // inside the 5-minute refresh margin
    expect(held).toBe('AT-1'); // the token we already have (still valid): never a second POST with the single-use RT-1
    expect(refreshCalls()).toHaveLength(0);
    expect(await repo.getKv(key)).not.toBeNull(); // our call did not give back a claim that is not ours
    await repo.releaseKv(key); // the other server finished (its save is what the next call reads)
    const fresh = await cloverOAuthToken(MID, now + 1800 - 60);
    expect(fresh).toBe('AT-2');
    expect(refreshCalls()).toHaveLength(1);
    expect(refreshCalls()[0].body).toEqual({ client_id: APP, refresh_token: 'RT-1' });
    expect(await repo.getKv(key)).toBeNull(); // our refresh gave its claim back
  });

  it('our own refresh holds the claim in the database while the POST runs and gives it back when it ends', async () => {
    const repo = getRepo();
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const base = globalThis.fetch;
    let claimDuring: unknown = null;
    globalThis.fetch = vi.fn(async (input: any, init: any) => {
      if (String(input).endsWith('/oauth/v2/refresh')) claimDuring = await repo.getKv(cloverRefreshClaimKey('foodhub', MID));
      return base(input, init);
    }) as any;
    const now = Math.floor(Date.now() / 1000);
    expect(await cloverOAuthToken(MID, now + 1800 - 60)).toBe('AT-2');
    expect(claimDuring).toMatchObject({ at: expect.any(String) });
    expect(await repo.getKv(cloverRefreshClaimKey('foodhub', MID))).toBeNull();
  });

  it('a refresh claim abandoned by a server that stopped mid-refresh is taken over after the stuck window', async () => {
    const repo = getRepo();
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await repo.claimKv(cloverRefreshClaimKey('foodhub', MID), { at: agoIso(11 * 60_000) }); // 11 minutes ago, never released
    const now = Math.floor(Date.now() / 1000);
    expect(await cloverOAuthToken(MID, now + 1800 - 60)).toBe('AT-2');
    expect(refreshCalls()).toHaveLength(1);
    expect(await repo.getKv(cloverRefreshClaimKey('foodhub', MID))).toBeNull();
  });

  it('two token calls at once on this server still share exactly one refresh POST', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const now = Math.floor(Date.now() / 1000);
    const [a, b] = await Promise.all([cloverOAuthToken(MID, now + 1800 - 60), cloverOAuthToken(MID, now + 1800 - 60)]);
    expect(a).toBe('AT-2');
    expect(b).toBe('AT-2');
    expect(refreshCalls()).toHaveLength(1);
  });
});
