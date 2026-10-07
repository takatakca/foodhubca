// Clover App Market app: OAuth v2 connect (direct launch, launch without a code, owner-started), token refresh,
// uninstall, pending approval and the owner alert, the read-only register snapshot and billing_info, the signed
// welcome ticket, and the "send a test order" check.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveCloverMerchant, CLOVER_CONNECT_ERRORS, cloverOAuthToken, cloverWebUrl, cloverWelcome, cloverWelcomeQuery, finishCloverConnect,
  handleCloverAppEvents, isLaunchState, listCloverConnections, startCloverConnect, startCloverLaunch,
} from '../lib/foodhub/pos/clover-oauth';
import { allCloverMerchants, cloverReadiness, cloverToken } from '../lib/foodhub/pos/clover';
import { sendCloverTestOrder } from '../lib/foodhub/pos/clover-test-order';

const MID = 'TESTMERCH0001'; // a made-up merchant ID (the repository is public: never a real one)
const APP = 'TESTAPP000001';
const realFetch = globalThis.fetch;
type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let tokenSeq = 0;
let orderSeq = 0;

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(input), method, body });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const now = Math.floor(Date.now() / 1000);
    if (url.hostname === 'chat.example') return json(200, {});
    if (p === '/oauth/v2/token') {
      if (body?.code !== 'GOOD-CODE' || body?.client_secret !== 'app-secret-test') return json(400, { message: 'invalid code' });
      tokenSeq++;
      return json(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    if (p === '/oauth/v2/refresh') {
      if (!String(body?.refresh_token || '').startsWith('RT-')) return json(401, {});
      tokenSeq++;
      return json(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    if (p === `/v3/apps/${APP}/merchants/${MID}/billing_info`) return json(200, { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Free' } });
    const m = `/v3/merchants/${MID}`;
    if (p === m) return json(200, { id: MID, name: 'Test Bistro', address: { city: 'Montréal', state: 'QC', country: 'CA' } });
    if (p === `${m}/items`) return json(200, { elements: [{ id: 'I1' }, { id: 'I2' }, { id: 'I3' }] });
    if (p === `${m}/categories`) return json(200, { elements: [{ id: 'C1' }] });
    if (p === `${m}/devices`) return json(200, { elements: [{ id: 'D1' }] });
    if (p === `${m}/order_types`) return method === 'POST' ? json(200, { id: 'OT-UBER', label: body?.label }) : json(200, { elements: [] });
    if (p === `${m}/tenders`) return method === 'POST' ? json(200, { id: 'T-UBER', label: body?.label }) : json(200, { elements: [{ id: 'T-CASH', label: 'Cash' }] });
    if (p === `${m}/atomic_order/orders`) { orderSeq++; return json(200, { id: `CLV${orderSeq}` }); }
    if (p === `${m}/print_event`) return json(200, { id: 'PE-1', state: 'CREATED' });
    if (/\/orders\/CLV\d+\/payments$/.test(p)) return json(200, { id: 'PAY-1' });
    if (/\/orders\/CLV\d+$/.test(p)) return json(200, { id: p.split('/').pop(), total: 2242 }); // Clover's total with its own tax
    return json(404, {});
  }) as any;
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_CLIENT_ID = APP;
  process.env.CLOVER_CLIENT_SECRET = 'app-secret-test';
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.FOODHUB_PUBLIC_URL = 'https://foodhub.example';
  process.env.SESSION_SECRET = 'clover-app-test-session-secret-0123456789';
  delete process.env.CLOVER_ACCESS_TOKEN; delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_MERCHANT_TOKENS; delete process.env.CLOVER_WEB_URL;
  delete process.env.ALERT_WEBHOOK_URL; delete process.env.FOODHUB_OWNER_EMAIL;
  process.env.CLOVER_ALLOWED_MERCHANTS = MID; // the owner's own merchant: trusted when it opens the app from Clover
  calls = []; tokenSeq = 0; orderSeq = 0;
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Clover app connection (OAuth v2)', () => {
  it('builds the authorize URL on the right Clover site with the Food Hub callback', async () => {
    const url = new URL(await startCloverConnect('Owner'));
    expect(url.origin).toBe('https://www.clover.com');
    expect(url.pathname).toBe('/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe(APP);
    expect(url.searchParams.get('redirect_uri')).toBe('https://foodhub.example/api/foodhub/clover-connect/callback');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{36}$/);
    process.env.CLOVER_BASE_URL = 'https://apisandbox.dev.clover.com';
    expect(cloverWebUrl()).toBe('https://sandbox.dev.clover.com');
  });

  it('connects a merchant launched from Clover (no state), stores tokens and never lists them', async () => {
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: APP });
    expect(r).toEqual({ ok: true, merchantId: MID, name: 'Test Bistro', pending: false, fromClover: true });
    const tokenCall = calls.find((c) => c.url.endsWith('/oauth/v2/token'));
    expect(tokenCall?.body).toEqual({ client_id: APP, client_secret: 'app-secret-test', code: 'GOOD-CODE' });
    const list = await listCloverConnections();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Test Bistro');
    expect(JSON.stringify(list)).not.toMatch(/AT-|RT-/);
    expect(await cloverToken(MID)).toBe('AT-1');
    expect(await allCloverMerchants([])).toContain(MID);
    expect(cloverReadiness().configured).toBe(true);
  });

  it('reads the register (read-only) and the App Market subscription when the merchant connects', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const [c] = await listCloverConnections();
    expect(c.profile).toMatchObject({ city: 'Montréal', region: 'QC', country: 'CA', items: 3, categories: 1, orderTypes: 0, tenders: 1, devices: 1, missing: [] });
    expect(c.billing).toMatchObject({ status: 'ACTIVE', inTrial: false, plan: 'Free' });
    expect(calls.filter((x) => x.url.includes(`/v3/merchants/${MID}`)).every((x) => x.method === 'GET')).toBe(true); // nothing written
  });

  it('flags a Clover plan without Inventory / Orders', async () => {
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any, init: any) => {
      const u = String(input);
      if (/\/(items|categories|order_types)\?/.test(u)) return new Response('{}', { status: 403 });
      return base(input, init);
    }) as any;
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const [c] = await listCloverConnections();
    expect(c.profile?.missing).toEqual(['inventory', 'orders']);
    expect(c.profile?.items).toBeNull();
  });

  it('rejects a wrong app, a bad merchant id, a reused state and a refused code — with a code for the welcome page', async () => {
    const wrong = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: 'OTHERAPP' });
    expect(wrong.ok === false && wrong.code).toBe('wrong_app');
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: 'x' })).ok).toBe(false);
    const refused = await finishCloverConnect({ code: 'BAD', merchantId: MID });
    expect(refused.ok === false && refused.code).toBe('code_refused');
    const state = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state })).ok).toBe(true);
    const reused = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state });
    expect(reused.ok === false && reused.code).toBe('state_expired');
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: 'f'.repeat(36) })).ok).toBe(false);
    for (const k of Object.keys(CLOVER_CONNECT_ERRORS) as Array<keyof typeof CLOVER_CONNECT_ERRORS>) {
      expect(CLOVER_CONNECT_ERRORS[k].fr.length).toBeGreaterThan(10);
      expect(CLOVER_CONNECT_ERRORS[k].en.length).toBeGreaterThan(10);
    }
  });

  it('launch without a code: asks Clover for one with a signed, stateless launch state, counted as a launch from Clover', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const url = new URL(await startCloverLaunch());
    expect(url.pathname).toBe('/oauth/v2/authorize');
    const state = url.searchParams.get('state')!;
    expect(isLaunchState(state)).toBe(true);
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state });
    expect(r).toMatchObject({ ok: true, pending: true, fromClover: true }); // unknown merchant: waits for the owner
    // Tampered or expired launch states are refused.
    const forged = `${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}`;
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: forged })).ok).toBe(false);
    const old = new URL(await startCloverLaunch(Date.now() - 20 * 60_000)).searchParams.get('state');
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: old })).ok).toBe(false);
  });

  it('refreshes the access token shortly before it expires', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const now = Math.floor(Date.now() / 1000);
    expect(await cloverOAuthToken(MID, now)).toBe('AT-1');                 // 30 minutes left: kept
    expect(await cloverOAuthToken(MID, now + 1800 - 60)).toBe('AT-2');     // 1 minute left: refreshed
    const refreshCall = calls.find((c) => c.url.endsWith('/oauth/v2/refresh'));
    expect(refreshCall?.body).toEqual({ client_id: APP, refresh_token: 'RT-1' });
    expect(await cloverOAuthToken(MID)).toBe('AT-2');
  });

  it('retries a Clover 429 (rate limit) instead of failing', async () => {
    process.env.FOODHUB_CLOVER_RETRY_MS = '0';
    const base = globalThis.fetch;
    let first = true;
    globalThis.fetch = vi.fn(async (input: any, init: any) => {
      if (first && String(input).endsWith('/oauth/v2/token')) { first = false; return new Response('{}', { status: 429, headers: { 'retry-after': '0' } }); }
      return base(input, init);
    }) as any;
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID })).ok).toBe(true);
    delete process.env.FOODHUB_CLOVER_RETRY_MS;
  });

  it('forgets a merchant that uninstalls the app, and ignores other apps', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const other = await handleCloverAppEvents({ appId: 'OTHER', merchants: { [MID]: [{ objectId: 'A:OTHERAPP', type: 'DELETE' }] } });
    expect(other.uninstalled).toEqual([]);
    const r = await handleCloverAppEvents({ appId: APP, merchants: { [MID]: [{ objectId: `A:${APP}`, type: 'DELETE' }] } });
    expect(r.uninstalled).toEqual([MID]);
    expect(await cloverToken(MID)).toBeNull();
    expect(await listCloverConnections()).toEqual([]);
  });

  it('reads the subscription again when Clover reports a change (App UPDATE)', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const before = calls.filter((c) => c.url.includes('billing_info')).length;
    await handleCloverAppEvents({ appId: APP, merchants: { [MID]: [{ objectId: `A:${APP}`, type: 'UPDATE' }] } });
    expect(calls.filter((c) => c.url.includes('billing_info')).length).toBe(before + 1);
  });

  it('keeps an unknown merchant that installs from Clover pending until the owner approves it', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: APP });
    expect(r).toEqual({ ok: true, merchantId: MID, name: 'Test Bistro', pending: true, fromClover: true });
    expect((await listCloverConnections())[0].status).toBe('pending');
    expect(await cloverToken(MID)).toBeNull();                 // no orders, no sync
    expect(await allCloverMerchants([])).not.toContain(MID);
    expect(await approveCloverMerchant(MID, 'Owner')).toBe(true);
    expect((await listCloverConnections())[0].status).toBe('active');
    expect(await cloverToken(MID)).toBe('AT-1');
    expect(await allCloverMerchants([])).toContain(MID);
  });

  it('tells the owner once when a merchant starts waiting (team chat), not on every re-open', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    process.env.ALERT_WEBHOOK_URL = 'https://chat.example/hook';
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await vi.waitFor(() => expect(calls.filter((c) => c.url.startsWith('https://chat.example')).length).toBe(1));
    expect(JSON.stringify(calls.find((c) => c.url.startsWith('https://chat.example'))?.body)).toContain('Test Bistro');
  });

  it('approves at once when the owner starts the connection from Food Hub', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const state = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state });
    expect(r.ok && r.pending).toBe(false);
    expect(await cloverToken(MID)).toBe('AT-1');
  });

  it('keeps environment tokens first (existing installs keep working)', async () => {
    process.env.CLOVER_MERCHANT_ID = MID; process.env.CLOVER_ACCESS_TOKEN = 'ENV-TOKEN';
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    expect(await cloverToken(MID)).toBe('ENV-TOKEN');
  });
});

describe('welcome page ticket', () => {
  it('signs a ticket for the connected merchant and shows only that merchant, live', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const q = await cloverWelcomeQuery(r);
    expect(Object.keys(q)).toEqual(['t']);
    expect(await cloverWelcome(q.t)).toMatchObject({ merchantId: MID, name: 'Test Bistro', status: 'pending', profile: { items: 3 } });
    await approveCloverMerchant(MID, 'Owner');
    expect((await cloverWelcome(q.t))?.status).toBe('active');
    expect(JSON.stringify(await cloverWelcome(q.t))).not.toMatch(/AT-|RT-/);
    await handleCloverAppEvents({ appId: APP, merchants: { [MID]: [{ objectId: `A:${APP}`, type: 'DELETE' }] } });
    expect((await cloverWelcome(q.t))?.status).toBe('gone');
  });

  it('a forged or missing ticket shows nothing; a failure carries only an error code', async () => {
    expect(await cloverWelcome(null)).toBeNull();
    expect(await cloverWelcome('eyJtIjoiVEVTVE1FUkNIMDAwMSIsImV4cCI6OTk5OTk5OTk5OX0.forged')).toBeNull();
    const fail = await finishCloverConnect({ code: 'BAD', merchantId: MID });
    expect(await cloverWelcomeQuery(fail)).toEqual({ status: 'error', err: 'code_refused' });
  });
});

describe('send a test order to my Clover', () => {
  it('creates, prints and pays a TEST order on an approved merchant, for Clover’s own total', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const r = await sendCloverTestOrder(MID);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.key, s.ok])).toEqual([['created', true], ['printed', true], ['paid', true]]);
    const order = calls.find((c) => c.url.endsWith('/atomic_order/orders'))!.body.orderCart;
    expect(order.title).toMatch(/^Uber Eats #TEST-/);
    expect(order.orderType).toEqual({ id: 'OT-UBER' });
    expect(order.lineItems.map((l: any) => l.price)).toEqual([1450, 250, 250]);
    const pay = calls.find((c) => /\/payments$/.test(c.url))!.body;
    expect(pay).toMatchObject({ amount: 2242, taxAmount: 292, tender: { id: 'T-UBER' }, result: 'SUCCESS' });
  });

  it('refuses a merchant that is not approved, and allows 3 test orders an hour', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const pending = await sendCloverTestOrder(MID);
    expect(pending.ok === false && pending.reason).toBe('not_approved');
    expect(calls.some((c) => c.url.endsWith('/atomic_order/orders'))).toBe(false);
    await approveCloverMerchant(MID, 'Owner');
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) expect((await sendCloverTestOrder(MID, t0 + i)).ok).toBe(true);
    const fourth = await sendCloverTestOrder(MID, t0 + 10);
    expect(fourth.ok === false && fourth.reason).toBe('limited');
    expect((await sendCloverTestOrder(MID, t0 + 61 * 60_000)).ok).toBe(true);
  });
});

describe('platform markup (in-store prices in Clover, +X% on delivery apps)', async () => {
  const { priceFor, modifierPriceFor, withMarkup, toDoorDashMenu, toUberMenu, toSkipMenu } = await import('../lib/foodhub/menu/translate');
  const base = {
    brandName: 'Po Poulet', updatedAt: new Date().toISOString(),
    categories: [{ ref: 'c1', name: 'Poulet', sortOrder: 0 }],
    items: [
      { ref: 'i1', name: '15 MCX', price: 23.99, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] },
      { ref: 'i2', name: 'Feta', price: 3.33, categoryRef: 'c1', available: true, modifierGroupRefs: [], channelPrices: { doordash: 3.99 } },
    ],
    modifierGroups: [{ ref: 'g1', name: 'Extras', min: 0, max: 2, modifiers: [{ ref: 'm1', name: 'Sauce', price: 1.25, available: true }, { ref: 'm2', name: 'Rien', price: 0, available: true }] }],
    channelMarkupPct: { doordash: 20, uber_eats: 15 },
  } as any;
  it('rounds to the cent and gives back the old DoorDash prices', () => {
    expect(withMarkup(23.99, 20)).toBe(28.79);
    expect(withMarkup(16.99, 20)).toBe(20.39);
    expect(withMarkup(0, 20)).toBe(0);
    expect(withMarkup(10, 0)).toBe(10);
  });
  it('applies the markup per platform; a per-item price wins; Skip without markup stays in-store', () => {
    expect(priceFor(base.items[0], 'doordash', base)).toBe(28.79);
    expect(priceFor(base.items[0], 'uber_eats', base)).toBe(27.59);
    expect(priceFor(base.items[0], 'skip', base)).toBe(23.99);
    expect(priceFor(base.items[1], 'doordash', base)).toBe(3.99);
    expect(modifierPriceFor(base.modifierGroups[0].modifiers[0], 'doordash', base)).toBe(1.5);
    expect(priceFor(base.items[0], 'doordash')).toBe(23.99); // no menu given = base price
  });
  it('publishes marked-up prices in the DoorDash, Uber and Skip menu payloads', () => {
    const dd = JSON.stringify(toDoorDashMenu(base, 'store', 'prov', 'ref'));
    expect(dd).toContain('"price":2879');
    expect(dd).toContain('"price":399');
    expect(dd).toContain('"price":150');
    const ub = JSON.stringify(toUberMenu(base));
    expect(ub).toContain('"price":2759');
    const sk = JSON.stringify(toSkipMenu(base, ['r1']));
    expect(sk).toContain('"price":2399');
    expect(sk).toContain('"price":125');
  });
});
