// Several Clover App Market apps on one backend: TAKATAK Food Hub (unchanged) + the AI phone app (sold separately).
// Per-app registry, OAuth start/callback, token stores keyed by (app, merchant) with old single-app tokens still read,
// per-app webhook verification + dispatch, uninstall of one app only, refresh locks per app, the phone entitlement
// (billing_info cached, grace periods) and TAKATAK Phone per-minute metering. Clover is never called: fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

import { cloverApp, cloverAppByAppId, cloverApps, cloverPhoneAppEnabled } from '../lib/foodhub/pos/clover-apps';
import { cloverAppsOverview } from '../lib/foodhub/pos/clover-apps-status';
import { appInstalled, phoneCloverToken, phoneEntitled, voiceAiEntitled } from '../lib/foodhub/pos/clover-entitlement';
import {
  aiHandledSeconds, billableMinutes, getMinuteRecord, phoneMinutesSummary, recordCallMinutes, settlePhoneMinutes,
} from '../lib/foodhub/pos/clover-phone-minutes';
import {
  approveCloverMerchant, cloverAppReadiness, cloverAppToken, cloverOAuthToken, cloverWelcome, cloverWelcomeQuery, finishCloverConnect,
  handleCloverAppEvents, listCloverConnections, patchCloverBillingState, patchCloverConnection, readCloverBillingState, startCloverConnect, startCloverLaunch,
} from '../lib/foodhub/pos/clover-oauth';
import { DELETE as merchantsDelete, GET as merchantsGet, POST as merchantsPost } from '../app/api/foodhub/clover-connect/merchants/route';
import { cloverToken } from '../lib/foodhub/pos/clover';
import { cloverWebhookGate } from '../lib/foodhub/pos/clover-webhook-gate';
import { getRepo } from '../lib/foodhub/repo';
import { POST as foodhubWebhook } from '../app/api/foodhub/webhooks/clover/route';
import { POST as phoneWebhook } from '../app/api/foodhub/webhooks/clover/phone/route';
import { GET as phoneCallback } from '../app/api/foodhub/clover-connect/phone/callback/route';
import { GET as phoneStart } from '../app/api/foodhub/clover-connect/phone/start/route';
import { POST as testOrderRoute } from '../app/api/foodhub/clover-connect/test-order/route';

// Made-up IDs (the repository is public: never real ones).
const MID = 'TESTMERCH0001';
const MID2 = 'TESTMERCH0002';
const FH_APP = 'TESTAPP000001';
const PH_APP = 'TESTPHONEAPP1';
const realFetch = globalThis.fetch;
type Call = { url: string; method: string; body: any; auth: string | null };
let calls: Call[] = [];
let seq = 0;
/** billing_info answers per "appId:merchantId"; missing = ACTIVE, no trial. */
let billing: Record<string, unknown> = {};
let billingDown = false;
/** billing_info down for these merchants only (Clover unreachable for one merchant). */
let billingDownFor = new Set<string>();
let meteredStatus = 200;
/** billing_info / refresh never answer until the request is aborted (Clover hanging). */
let billingHang = false;
let refreshHang = false;
let refreshStatus = 200;
/** The metered POST reaches Clover but its answer is lost (timeout). */
let meteredTimeout = false;
/** The metered POST fails at the network level with this code (ECONNREFUSED = never left; ECONNRESET = may have). */
let meteredNetwork = '';
const hang = (signal?: AbortSignal | null) => new Promise<Response>((_, reject) => {
  const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort);
});

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(input), method, body, auth: init.headers?.Authorization ?? null });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const now = Math.floor(Date.now() / 1000);
    const secrets: Record<string, string> = { [FH_APP]: 'fh-secret-test', [PH_APP]: 'phone-secret-test' };
    const prefix = (id: string) => (id === PH_APP ? 'PAT' : 'AT');
    if (p === '/oauth/v2/token') {
      if (body?.code !== 'GOOD-CODE' || secrets[body?.client_id] !== body?.client_secret) return json(400, { message: 'invalid code' });
      seq++;
      return json(200, { access_token: `${prefix(body.client_id)}-${seq}`, access_token_expiration: now + 1800, refresh_token: `RT-${body.client_id}-${seq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    if (p === '/oauth/v2/refresh') {
      if (refreshHang) return hang(init.signal);
      if (refreshStatus !== 200) return json(refreshStatus, { message: 'refresh refused' });
      seq++;
      return json(200, { access_token: `${prefix(body?.client_id)}-R${seq}`, access_token_expiration: now + 1800, refresh_token: `RT-${body?.client_id}-${seq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    const bi = p.match(/^\/v3\/apps\/([^/]+)\/merchants\/([^/]+)\/billing_info$/);
    if (bi) {
      if (billingHang) return hang(init.signal);
      if (billingDown || billingDownFor.has(bi[2])) return json(503, {});
      return json(200, billing[`${bi[1]}:${bi[2]}`] ?? { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Essentiel' } });
    }
    if (/\/metereds\//.test(p)) {
      if (meteredTimeout) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      if (meteredNetwork) throw Object.assign(new TypeError('fetch failed'), { cause: { code: meteredNetwork } });
      return json(meteredStatus, { id: 'MTR-1' });
    }
    const m = p.match(/^\/v3\/merchants\/([^/]+)$/);
    if (m) return json(200, { id: m[1], name: `Bistro ${m[1].slice(-1)}`, address: { city: 'Montréal', state: 'QC', country: 'CA' } });
    if (/^\/v3\/merchants\/[^/]+\/(items|categories|order_types|tenders|devices)$/.test(p)) return json(200, { elements: [] });
    return json(404, {});
  }) as any;
}

function setPhoneEnv() {
  process.env.CLOVER_PHONE_APP_ID = PH_APP;
  process.env.CLOVER_PHONE_APP_SECRET = 'phone-secret-test';
  process.env.CLOVER_PHONE_WEBHOOK_AUTH = 'phone-hook-auth';
  process.env.CLOVER_PHONE_METERED_MINUTE_ID = 'METERED01';
}
const PHONE_ENV = ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'CLOVER_PHONE_WEBHOOK_AUTH', 'CLOVER_PHONE_METERED_MINUTE_ID', 'CLOVER_PHONE_APP_NAME', 'PHONE_OWN_MERCHANTS', 'FOODHUB_PHONE_METERED_ENABLED', 'FOODHUB_BILLING_EXEMPT_MERCHANTS'];

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_CLIENT_ID = FH_APP;
  process.env.CLOVER_CLIENT_SECRET = 'fh-secret-test';
  process.env.CLOVER_WEBHOOK_AUTH = 'fh-hook-auth';
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.FOODHUB_PUBLIC_URL = 'https://foodhub.example';
  process.env.SESSION_SECRET = 'clover-multi-app-test-session-secret-0123';
  process.env.CLOVER_ALLOWED_MERCHANTS = `${MID},${MID2}`;
  for (const k of [...PHONE_ENV, 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_ID', 'CLOVER_MERCHANT_TOKENS', 'CLOVER_WEB_URL', 'ALERT_WEBHOOK_URL', 'FOODHUB_OWNER_EMAIL']) delete process.env[k];
  calls = []; seq = 0; billing = {}; billingDown = false; billingDownFor = new Set(); meteredStatus = 200;
  billingHang = false; refreshHang = false; refreshStatus = 200; meteredTimeout = false; meteredNetwork = '';
  delete process.env.CONNECTOR_NETWORK_TIMEOUT_MS;
  delete process.env.DASHBOARD_PASSWORD;
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

const tick = () => new Promise((r) => setTimeout(r, 0));
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);
const appEvent = (appId: string, mid: string, type: 'CREATE' | 'UPDATE' | 'DELETE') => ({ appId, merchants: { [mid]: [{ objectId: `A:${appId}`, type, ts: Date.now() }] } });

describe('without the phone app env, everything behaves as before', () => {
  it('lists Food Hub as the only enabled app, the phone app as not set', async () => {
    expect(cloverPhoneAppEnabled()).toBe(false);
    expect(cloverApps().map((a) => a.key)).toEqual(['foodhub', 'phone']);
    expect(cloverApp('foodhub')).toMatchObject({ name: 'TAKATAK Food Hub', appId: FH_APP, tokenStoreKey: 'clover_oauth_merchants', verifyKey: 'clover_webhook_verification' });
    expect(cloverApp('phone')).toMatchObject({ name: 'TAKATAK Phone AI', appId: null, events: ['app'] });
    expect(cloverAppByAppId(FH_APP)).toBe('foodhub');
    expect(cloverAppByAppId(PH_APP)).toBe(null);
    expect(cloverAppReadiness()).toMatchObject({ configured: true, appId: FH_APP, launchPath: '/api/foodhub/clover-connect/callback', webhookUrl: 'https://foodhub.example/api/foodhub/webhooks/clover' });
    const overview = await cloverAppsOverview();
    expect(overview.map((a) => [a.key, a.enabled, a.configured])).toEqual([['foodhub', true, true], ['phone', false, false]]);
    expect(overview[1].missing).toEqual(['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET']);
  });

  it('phone routes answer 404', async () => {
    expect((await phoneCallback(req('https://foodhub.example/api/foodhub/clover-connect/phone/callback?code=GOOD-CODE&merchant_id=TESTMERCH0001'))).status).toBe(404);
    expect((await phoneStart(new Request('https://foodhub.example/api/foodhub/clover-connect/phone/start'))).status).toBe(404);
    expect((await phoneWebhook(req('https://foodhub.example/api/foodhub/webhooks/clover/phone', { method: 'POST', body: JSON.stringify({ verificationCode: 'abc' }) }))).status).toBe(404);
    expect(await getRepo().getKv('clover_webhook_verification:phone')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('the phone gate is off: calls allowed, nothing billed, Clover never asked', async () => {
    const e = await voiceAiEntitled(MID);
    expect(e).toMatchObject({ ok: true, reason: 'gate_off', billable: false });
    expect(await phoneEntitled(MID, 'setup')).toMatchObject({ ok: true, reason: 'gate_off' });
    process.env.FOODHUB_PHONE_METERED_ENABLED = 'true';
    expect(await recordCallMinutes({ callSid: 'CA-GATEOFF', merchantId: MID, aiSeconds: 90 })).toMatchObject({ outcome: 'not_billable', reason: 'gate_off', minutes: 2 });
    expect(calls).toHaveLength(0);
  });

  it('reads Food Hub tokens saved before several apps existed (no appId on the record)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await getRepo().setKv('clover_oauth_merchants', { [MID]: { merchantId: MID, accessToken: 'OLD-TOKEN', accessTokenExpiration: exp, connectedAt: '2026-10-01T00:00:00.000Z' } });
    expect(await cloverOAuthToken(MID)).toBe('OLD-TOKEN');
    expect(await cloverToken(MID)).toBe('OLD-TOKEN');
    expect((await listCloverConnections()).map((c) => c.merchantId)).toEqual([MID]);
    expect(await appInstalled('foodhub', MID)).toBe(true);
    expect(await appInstalled(FH_APP, MID)).toBe(true);
    expect(await appInstalled('phone', MID)).toBe(false);
  });

  it('Food Hub webhook: verification under its own key, its auth code, all three handlers', async () => {
    const v = await foodhubWebhook(req('https://foodhub.example/api/foodhub/webhooks/clover', { method: 'POST', body: JSON.stringify({ verificationCode: 'FH-CODE' }) }));
    expect(v.status).toBe(200);
    expect(await getRepo().getKv('clover_webhook_verification')).toMatchObject({ code: 'FH-CODE' });
    const bad = await foodhubWebhook(req('https://foodhub.example/api/foodhub/webhooks/clover', { method: 'POST', body: JSON.stringify({ merchants: {} }), headers: { 'x-clover-auth': 'wrong' } }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: 'X-Clover-Auth check failed (set CLOVER_WEBHOOK_AUTH).' });
  });
});

describe('phone app OAuth (its own keys, callback and token store)', () => {
  beforeEach(setPhoneEnv);

  it('builds the authorize URL with the phone App ID and the phone callback', async () => {
    const url = new URL(await startCloverConnect('Owner', 'phone'));
    expect(url.searchParams.get('client_id')).toBe(PH_APP);
    expect(url.searchParams.get('redirect_uri')).toBe('https://foodhub.example/api/foodhub/clover-connect/phone/callback');
    expect(cloverAppReadiness('phone')).toMatchObject({ configured: true, appId: PH_APP, webhookUrl: 'https://foodhub.example/api/foodhub/webhooks/clover/phone' });
  });

  it('connects with the phone secret, stores tokens per (app, merchant), Food Hub untouched', async () => {
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: PH_APP, app: 'phone' });
    expect(r).toMatchObject({ ok: true, merchantId: MID, pending: false, app: 'phone' });
    expect(calls.find((c) => c.url.endsWith('/oauth/v2/token'))?.body).toEqual({ client_id: PH_APP, client_secret: 'phone-secret-test', code: 'GOOD-CODE' });
    expect(calls.some((c) => c.url.includes(`/v3/apps/${PH_APP}/merchants/${MID}/billing_info`))).toBe(true);
    const saved = await getRepo().getKv<Record<string, any>>('clover_oauth_merchants:phone');
    expect(saved?.[MID]).toMatchObject({ appId: PH_APP, accessToken: 'PAT-1', billing: { status: 'ACTIVE' } });
    expect(await getRepo().getKv('clover_oauth_merchants')).toBeNull();
    // Food Hub features never use the phone token; phone features use it first.
    expect(await cloverToken(MID)).toBeNull();
    expect(await cloverAppToken('phone', MID)).toBe('PAT-1');
    expect(await phoneCloverToken(MID)).toBe('PAT-1');
    expect(await appInstalled('phone', MID)).toBe(true);
    expect(await appInstalled(PH_APP, MID)).toBe(true);
    expect(await appInstalled('foodhub', MID)).toBe(false);
    expect(JSON.stringify(await listCloverConnections('phone'))).not.toMatch(/PAT-|RT-/);
  });

  it('phone features fall back to the Food Hub token when only Food Hub is installed', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'foodhub' });
    expect(await phoneCloverToken(MID)).toBe('AT-1');
  });

  it('refuses a Food Hub link, a Food Hub owner state and a Food Hub launch state on the phone callback', async () => {
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: FH_APP, app: 'phone' })).toMatchObject({ ok: false, code: 'wrong_app' });
    const fhState = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: fhState, app: 'phone' })).toMatchObject({ ok: false, code: 'state_expired' });
    const fhLaunch = new URL(await startCloverLaunch()).searchParams.get('state');
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: fhLaunch, app: 'phone' })).toMatchObject({ ok: false, code: 'state_expired' });
    // and the reverse: a phone launch state is refused by Food Hub
    const phLaunch = new URL(await startCloverLaunch(Date.now(), 'phone')).searchParams.get('state');
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: phLaunch })).toMatchObject({ ok: false, code: 'state_expired' });
    // a phone owner state works on the phone callback
    const phState = new URL(await startCloverConnect('Owner', 'phone')).searchParams.get('state');
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: phState, app: 'phone' })).toMatchObject({ ok: true, fromClover: false });
  });

  it('callback route: launch without a code asks Clover with the phone App ID; with a code it lands on the phone welcome', async () => {
    const launch = await phoneCallback(req('https://foodhub.example/api/foodhub/clover-connect/phone/callback'));
    expect(launch.status).toBe(307);
    expect(new URL(launch.headers.get('location')!).searchParams.get('client_id')).toBe(PH_APP);
    const done = await phoneCallback(req(`https://foodhub.example/api/foodhub/clover-connect/phone/callback?code=GOOD-CODE&merchant_id=${MID}&client_id=${PH_APP}`));
    const loc = new URL(done.headers.get('location')!);
    expect(loc.pathname).toBe('/welcome/clover');
    expect(loc.searchParams.get('app')).toBe('phone');
    const w = await cloverWelcome(loc.searchParams.get('t'));
    expect(w).toMatchObject({ merchantId: MID, status: 'active', app: 'phone' });
    // The phone ticket never sends a Food Hub test order.
    const t = await testOrderRoute(req('https://foodhub.example/api/foodhub/clover-connect/test-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: loc.searchParams.get('t') }) }));
    expect(t.status).toBe(401);
  });

  it('a stranger installing the phone app waits for the owner; one already approved in Food Hub does not', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    expect(r).toMatchObject({ ok: true, pending: true, app: 'phone' });
    expect(await cloverAppToken('phone', MID)).toBeNull();
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: false, reason: 'pending_approval' });
    expect(await approveCloverMerchant(MID, 'Owner', 'phone')).toBe(true);
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: true, reason: 'active' });
    // MID2: approved in Food Hub first (owner-started), then installs the phone app from Clover → trusted at once.
    const st = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID2, state: st });
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID2, app: 'phone' })).toMatchObject({ pending: false });
    // Our own restaurants are trusted too.
    process.env.PHONE_OWN_MERCHANTS = 'TESTMERCH0003';
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: 'TESTMERCH0003', app: 'phone' })).toMatchObject({ pending: false });
  });

  it('refreshes each app’s token with its own client id, one lock per (app, merchant)', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const later = Math.floor(Date.now() / 1000) + 1800 - 60; // under the 5-minute margin
    const [a, b, c] = await Promise.all([cloverOAuthToken(MID, later), cloverAppToken('phone', MID, later), cloverAppToken('phone', MID, later)]);
    const refreshes = calls.filter((x) => x.url.endsWith('/oauth/v2/refresh'));
    expect(refreshes.map((x) => x.body.client_id).sort()).toEqual([PH_APP, FH_APP].sort());
    expect(a).toMatch(/^AT-R/);
    expect(b).toMatch(/^PAT-R/);
    expect(c).toBe(b);
  });
});

describe('phone webhook (own verification, own auth, App events only)', () => {
  beforeEach(setPhoneEnv);
  const url = 'https://foodhub.example/api/foodhub/webhooks/clover/phone';

  it('stores the verification code under the phone key only', async () => {
    const r = await phoneWebhook(req(url, { method: 'POST', body: JSON.stringify({ verificationCode: 'PH-CODE' }) }));
    expect(r.status).toBe(200);
    expect(await getRepo().getKv('clover_webhook_verification:phone')).toMatchObject({ code: 'PH-CODE' });
    expect(await getRepo().getKv('clover_webhook_verification')).toBeNull();
    const ov = await cloverAppsOverview({ showVerification: true });
    expect(ov.find((a) => a.key === 'phone')?.verification?.code).toBe('PH-CODE');
    expect(ov.find((a) => a.key === 'foodhub')?.verification).toBeNull();
  });

  it('refuses Food Hub’s auth code; Food Hub refuses the phone’s', async () => {
    const body = JSON.stringify(appEvent(PH_APP, MID, 'UPDATE'));
    expect((await phoneWebhook(req(url, { method: 'POST', body, headers: { 'x-clover-auth': 'fh-hook-auth' } }))).status).toBe(401);
    expect((await foodhubWebhook(req('https://foodhub.example/api/foodhub/webhooks/clover', { method: 'POST', body, headers: { 'x-clover-auth': 'phone-hook-auth' } }))).status).toBe(401);
    expect(await cloverWebhookGate('phone', JSON.parse(body), 'phone-hook-auth')).toEqual({ done: false });
  });

  it('uninstalling the phone app removes only the phone tokens; Food Hub keeps working', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    expect((await cloverAppsOverview()).every((a) => a.installs[0]?.bothApps)).toBe(true);
    const r = await phoneWebhook(req(url, { method: 'POST', body: JSON.stringify(appEvent(PH_APP, MID, 'DELETE')), headers: { 'x-clover-auth': 'phone-hook-auth' } }));
    expect(r.status).toBe(200);
    await tick(); await tick();
    expect(await listCloverConnections('phone')).toHaveLength(0);
    expect(await cloverOAuthToken(MID)).toBe('AT-1');
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: false, reason: 'not_installed' });
    process.env.FOODHUB_PHONE_METERED_ENABLED = 'true';
    expect(await recordCallMinutes({ callSid: 'CA-UNINST', merchantId: MID, aiSeconds: 30 })).toMatchObject({ outcome: 'not_billable', reason: 'not_installed' });
    expect(calls.filter((c) => c.url.includes('/metereds/'))).toHaveLength(0);
  });

  it('a phone-app event on the Food Hub webhook (or the reverse) touches nothing', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    expect(await handleCloverAppEvents(appEvent(PH_APP, MID, 'DELETE'))).toEqual({ uninstalled: [], installed: [] });
    expect(await handleCloverAppEvents(appEvent(FH_APP, MID, 'DELETE'), 'phone')).toEqual({ uninstalled: [], installed: [] });
    expect(await listCloverConnections()).toHaveLength(1);
    expect(await listCloverConnections('phone')).toHaveLength(1);
    // Food Hub uninstall leaves the phone app alone.
    expect(await handleCloverAppEvents(appEvent(FH_APP, MID, 'DELETE'))).toEqual({ uninstalled: [MID], installed: [] });
    expect(await cloverAppToken('phone', MID)).toBe('PAT-2');
  });
});

describe('phone entitlement (billing_info, saved 15 minutes, grace periods)', () => {
  beforeEach(setPhoneEnv);
  const billingCalls = () => calls.filter((c) => c.url.includes(`/v3/apps/${PH_APP}/merchants/${MID}/billing_info`)).length;

  it('own restaurants: yes, never billed; not installed: no', async () => {
    process.env.PHONE_OWN_MERCHANTS = `${MID2}, OTHER0000001`;
    expect(await voiceAiEntitled(MID2)).toMatchObject({ ok: true, reason: 'own_merchant', billable: false });
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: false, reason: 'not_installed' });
    expect(await voiceAiEntitled('')).toMatchObject({ ok: false, reason: 'not_installed' });
  });

  it('ACTIVE is billable, trial is not; the answer is saved for 15 minutes and an App event clears it', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const n0 = billingCalls();
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: true, reason: 'active', billable: true, cached: true, plan: 'Essentiel' });
    expect(billingCalls()).toBe(n0);
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: true, appSubscription: { name: 'Pro' } };
    expect(await voiceAiEntitled(MID, 'call', { now: Date.now() + 16 * 60_000 })).toMatchObject({ ok: true, reason: 'trial', billable: false, cached: false, plan: 'Pro' });
    expect(billingCalls()).toBe(n0 + 1);
    billing[`${PH_APP}:${MID}`] = { status: 'SUPPRESSED' };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'CREATE'), 'phone'); // any event: saved answer is stale
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: false, reason: 'suspended' });
    billing[`${PH_APP}:${MID}`] = { status: 'INACTIVE' };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone'); // UPDATE reads it again at once
    expect(await voiceAiEntitled(MID)).toMatchObject({ ok: false, reason: 'inactive', cached: true });
  });

  it('LAPSED: live calls for 7 days, never a setup step', async () => {
    billing[`${PH_APP}:${MID}`] = { status: 'LAPSED', daysLapsed: 2 };
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    expect(await voiceAiEntitled(MID, 'call')).toMatchObject({ ok: true, reason: 'lapsed_grace', billable: false });
    expect(await voiceAiEntitled(MID, 'setup')).toMatchObject({ ok: false, reason: 'lapsed' });
    billing[`${PH_APP}:${MID}`] = { status: 'LAPSED', daysLapsed: 8 };
    expect(await voiceAiEntitled(MID, 'call', { now: Date.now() + 16 * 60_000 })).toMatchObject({ ok: false, reason: 'lapsed' });
    // Without daysLapsed, our own first-seen date counts.
    billing[`${PH_APP}:${MID}`] = { status: 'LAPSED' };
    expect(await voiceAiEntitled(MID, 'call', { now: Date.now() + 6 * 86400_000 })).toMatchObject({ ok: true, reason: 'lapsed_grace' });
    expect(await voiceAiEntitled(MID, 'call', { now: Date.now() + 9 * 86400_000 })).toMatchObject({ ok: false, reason: 'lapsed' });
  });

  it('Clover not answering: calls ride on the last good answer for 3 days, setup is refused', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    billingDown = true;
    const later = Date.now() + 20 * 60_000;
    expect(await voiceAiEntitled(MID, 'call', { now: later })).toMatchObject({ ok: true, reason: 'clover_unreachable_grace', billable: false });
    expect(await voiceAiEntitled(MID, 'setup', { now: later })).toMatchObject({ ok: false, reason: 'clover_unreachable' });
    expect(await voiceAiEntitled(MID, 'call', { now: Date.now() + 4 * 86400_000 })).toMatchObject({ ok: false, reason: 'clover_unreachable' });
  });

  it('ignores phone tokens issued to a former phone App ID', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    process.env.CLOVER_PHONE_APP_ID = 'TESTPHONEAPP2';
    expect(await appInstalled('phone', MID)).toBe(false);
    expect(await cloverAppToken('phone', MID)).toBeNull();
  });
});

describe('welcome query for the phone app', () => {
  beforeEach(setPhoneEnv);
  it('carries app=phone; errors too', async () => {
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const q = await cloverWelcomeQuery(r);
    expect(q.app).toBe('phone');
    expect((await cloverWelcome(q.t))?.app).toBe('phone');
    expect(await cloverWelcomeQuery({ ok: false, code: 'no_code', error: 'x', fromClover: true, app: 'phone' })).toEqual({ status: 'error', err: 'no_code', app: 'phone' });
    // Food Hub tickets keep their shape (no app).
    const f = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const fq = await cloverWelcomeQuery(f);
    expect(fq.app).toBeUndefined();
    expect((await cloverWelcome(fq.t))?.app).toBeUndefined();
  });
});

describe('live-call check never hangs on Clover', () => {
  beforeEach(setPhoneEnv);
  const billingCalls = () => calls.filter((c) => c.url.includes('/billing_info')).length;

  it('a hung billing_info answers within the budget from the grace rules, and Clover is not asked again for a while', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    billingHang = true;
    const later = Date.now() + 20 * 60_000;
    const n0 = billingCalls();
    const t0 = Date.now();
    const e = await voiceAiEntitled(MID, 'call', { now: later, budgetMs: 150 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(e).toMatchObject({ ok: true, reason: 'clover_unreachable_grace', billable: false });
    expect(billingCalls()).toBe(n0 + 1);
    expect((await readCloverBillingState(MID, 'phone')).checkFailedAt).toBeTruthy();
    // The next calls in the following minutes answer at once, without asking Clover.
    const t1 = Date.now();
    expect(await voiceAiEntitled(MID, 'call', { now: later + 30_000, budgetMs: 150 })).toMatchObject({ ok: true, reason: 'clover_unreachable_grace' });
    expect(await voiceAiEntitled(MID, 'setup', { now: later + 60_000, budgetMs: 150 })).toMatchObject({ ok: false, reason: 'clover_unreachable' });
    expect(Date.now() - t1).toBeLessThan(100);
    expect(billingCalls()).toBe(n0 + 1);
    // Clover back after the pause: asked again, the fresh answer clears the failure marker.
    billingHang = false;
    expect(await voiceAiEntitled(MID, 'call', { now: later + 3 * 60_000 })).toMatchObject({ ok: true, reason: 'active', cached: false });
    expect((await readCloverBillingState(MID, 'phone')).checkFailedAt).toBeNull();
    await new Promise((r) => setTimeout(r, 200)); // let the aborted read finish
  });

  it('a hung token refresh answers within the budget; the refresh is never cut short by the budget', async () => {
    process.env.CONNECTOR_NETWORK_TIMEOUT_MS = '400';
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    refreshHang = true;
    const nearExpiry = Date.now() + (1800 - 60) * 1000; // token within the 5-minute refresh margin
    const t0 = Date.now();
    expect(await voiceAiEntitled(MID, 'call', { now: nearExpiry, budgetMs: 150 })).toMatchObject({ ok: true, reason: 'clover_unreachable_grace' });
    expect(Date.now() - t0).toBeLessThan(380); // returned before the refresh's own network timeout
    await new Promise((r) => setTimeout(r, 600)); // the refresh times out on its own, in the background
    expect((await readCloverBillingState(MID, 'phone')).checkFailedAt).toBeTruthy();
  });

  it('a refused refresh is logged once per window, not on every call', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    refreshStatus = 400;
    const nearExpiry = Date.now() + (1800 - 60) * 1000;
    for (let i = 0; i < 4; i++) await voiceAiEntitled(MID, 'call', { now: nearExpiry + i * 3 * 60_000 }); // past the 2-minute pause each time
    expect(calls.filter((c) => c.url.endsWith('/oauth/v2/refresh')).length).toBeGreaterThanOrEqual(2);
    const rows = (await getRepo().listActivity({ limit: 500 })).filter((a) => a.action === 'clover_refresh_failed');
    expect(rows).toHaveLength(1);
  });
});

describe('phone token map: no lost update between merchants', () => {
  beforeEach(setPhoneEnv);

  it('the per-call check writes its own per-merchant key, never the token map', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const repo = getRepo();
    const writes: string[] = [];
    const orig = repo.setKv.bind(repo);
    const spy = vi.spyOn(repo, 'setKv').mockImplementation(async (k: string, v: unknown) => { writes.push(k); return orig(k, v); });
    try {
      await voiceAiEntitled(MID, 'call', { now: Date.now() + 16 * 60_000 }); // saved answer too old: asks Clover
      await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    } finally { spy.mockRestore(); }
    expect(writes).toContain(`clover_phone_billing:${MID}`);
    expect(writes).not.toContain('clover_oauth_merchants:phone');
  });

  it('a refresh for merchant A interleaved with writes for merchant B keeps A’s new refresh token', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID2, app: 'phone' });
    const repo = getRepo();
    const orig = repo.getKv.bind(repo);
    // Every read of the token map takes a while and returns its own copy (as the database does), so the
    // read-modify-writes overlap.
    const spy = vi.spyOn(repo, 'getKv').mockImplementation(async (k: string) => {
      const v = structuredClone(await orig(k));
      if (k === 'clover_oauth_merchants:phone') await new Promise((r) => setTimeout(r, 20));
      return v as any;
    });
    try {
      const later = Math.floor(Date.now() / 1000) + 1800 - 60;
      const [tokenA] = await Promise.all([
        cloverAppToken('phone', MID, later),
        patchCloverConnection(MID2, { name: 'Bistro B renamed' }, 'phone'),
        new Promise((r) => setTimeout(r, 5)).then(() => patchCloverConnection(MID2, { connectedBy: 'Owner' }, 'phone')),
      ]);
      expect(tokenA).toMatch(/^PAT-R/);
    } finally { spy.mockRestore(); }
    const saved = await getRepo().getKv<Record<string, any>>('clover_oauth_merchants:phone');
    const refreshed = calls.filter((c) => c.url.endsWith('/oauth/v2/refresh'));
    expect(refreshed).toHaveLength(1);
    expect(saved?.[MID].accessToken).toMatch(/^PAT-R/);
    expect(saved?.[MID].refreshToken).not.toBe(refreshed[0].body.refresh_token); // the new one, not the used one
    expect(saved?.[MID2]).toMatchObject({ name: 'Bistro B renamed', connectedBy: 'Owner' });
  });

  it('billing state writes for two merchants at once all land', async () => {
    await Promise.all([
      patchCloverBillingState(MID, { billingStale: true }, 'phone'),
      patchCloverBillingState(MID, { checkFailedAt: '2026-10-16T00:00:00.000Z' }, 'phone'),
      patchCloverBillingState(MID2, { billingStale: true }, 'phone'),
    ]);
    expect(await readCloverBillingState(MID, 'phone')).toMatchObject({ billingStale: true, checkFailedAt: '2026-10-16T00:00:00.000Z' });
    expect(await readCloverBillingState(MID2, 'phone')).toMatchObject({ billingStale: true });
  });
});

describe('TAKATAK Phone: per-minute metering (CAD 0.25 per AI minute)', () => {
  beforeEach(() => { setPhoneEnv(); process.env.FOODHUB_PHONE_METERED_ENABLED = 'true'; });
  const metered = () => calls.filter((c) => c.url.includes('/metereds/'));
  const connect = (mid = MID) => finishCloverConnect({ code: 'GOOD-CODE', merchantId: mid, app: 'phone' });
  const end = (callSid: string, aiSeconds: number, opts: { now?: number; merchantId?: string } = {}) =>
    recordCallMinutes({ callSid, merchantId: opts.merchantId ?? MID, aiSeconds, endedAt: opts.now ? new Date(opts.now).toISOString() : undefined }, { now: opts.now });

  it('rounds the AI time up to the minute; under 1 s is nothing', () => {
    expect([0, 0.4, 0.99, 1, 59, 60, 60.2, 61, 125, 3600].map(billableMinutes)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 3, 60]);
    expect(billableMinutes(Number.NaN)).toBe(0);
    expect(billableMinutes(-5)).toBe(0);
  });

  it('counts only the part the AI handled: never the hold or the person after a transfer', () => {
    const at = (s: number) => new Date(Date.parse('2026-10-17T15:00:00.000Z') + s * 1000).toISOString();
    // Straight to a person (AI off or paused): the AI never answered.
    expect(aiHandledSeconds({ startedAt: at(0), endedAt: at(300), durationSec: 300 })).toBe(0);
    // The AI took the whole call: Twilio's duration is the end.
    expect(aiHandledSeconds({ startedAt: at(0), aiStartedAt: at(0), endedAt: at(97), durationSec: 95 })).toBe(95);
    // Handed to a person after 40 s; the caller then waited and talked for 4 more minutes.
    expect(aiHandledSeconds({ startedAt: at(0), aiStartedAt: at(0), aiEndedAt: at(40), endedAt: at(300), durationSec: 300 })).toBe(40);
    // No Twilio duration (lost callback): our own end time.
    expect(aiHandledSeconds({ startedAt: at(0), aiStartedAt: at(2), endedAt: at(32) })).toBe(30);
    // The caller hung up before the transfer mark was saved: the earlier end wins.
    expect(aiHandledSeconds({ startedAt: at(0), aiStartedAt: at(0), aiEndedAt: at(90), durationSec: 50 })).toBe(50);
    expect(billableMinutes(aiHandledSeconds({ startedAt: at(0), aiStartedAt: at(0), aiEndedAt: at(61), durationSec: 400 }))).toBe(2);
  });

  it('an ACTIVE merchant: the minutes go to Clover once per call SID, with the minute ID and the count', async () => {
    await connect();
    expect(await end('CA100', 61)).toMatchObject({ outcome: 'reported', minutes: 2 });
    expect(metered()).toHaveLength(1);
    expect(metered()[0]).toMatchObject({ method: 'POST', auth: 'Bearer PAT-1' });
    expect(metered()[0].url).toBe(`https://api.clover.com/v3/apps/${PH_APP}/merchants/${MID}/metereds/METERED01?count=2`);
    // The same call again (a repeated status callback, another server): never sent twice.
    expect(await end('CA100', 61)).toMatchObject({ outcome: 'duplicate' });
    const [x, y] = await Promise.all([end('CA101', 30), end('CA101', 30)]);
    expect([x.outcome, y.outcome].sort()).toEqual(['duplicate', 'reported']);
    expect(metered()).toHaveLength(2);
    expect(await getMinuteRecord('CA100')).toMatchObject({ state: 'reported', minutes: 2, aiSeconds: 61, merchantId: MID });
    expect((await phoneMinutesSummary()).total).toMatchObject({ calls: 2, aiMinutes: 3, reportedMinutes: 3, estimateCad: 0.75 });
  });

  it('never bills the free trial, our restaurants, an exempt merchant, a lapsed or inactive one, or under 1 s', async () => {
    await connect();
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: true };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    expect(await end('CA200', 120)).toMatchObject({ outcome: 'not_billable', reason: 'trial' });
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: false };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    process.env.PHONE_OWN_MERCHANTS = MID;
    expect(await end('CA201', 120)).toMatchObject({ outcome: 'not_billable', reason: 'exempt' });
    delete process.env.PHONE_OWN_MERCHANTS;
    process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS = `OTHER0000001, ${MID}`;
    expect(await end('CA202', 120)).toMatchObject({ outcome: 'not_billable', reason: 'exempt' });
    delete process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS;
    billing[`${PH_APP}:${MID}`] = { status: 'LAPSED', daysLapsed: 2 };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    expect(await end('CA203', 120)).toMatchObject({ outcome: 'not_billable', reason: 'lapsed_grace' });
    billing[`${PH_APP}:${MID}`] = { status: 'INACTIVE' };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    expect(await end('CA204', 120)).toMatchObject({ outcome: 'not_billable', reason: 'inactive' });
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: false };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    expect(await end('CA205', 0.5)).toMatchObject({ outcome: 'zero', minutes: 0 });
    expect(await recordCallMinutes({ callSid: 'sim-1', merchantId: MID, aiSeconds: 300, test: true })).toMatchObject({ outcome: 'test_call' });
    delete process.env.CLOVER_PHONE_METERED_MINUTE_ID;
    expect(await end('CA206', 60)).toMatchObject({ outcome: 'no_metered_id' });
    expect(metered()).toHaveLength(0);
    expect(await recordCallMinutes({ callSid: 'bad sid!', merchantId: MID, aiSeconds: 60 })).toMatchObject({ outcome: 'bad_input' });
  });

  it('off unless FOODHUB_PHONE_METERED_ENABLED=true: nothing sent, Clover not asked, the dry run shows what would be billed', async () => {
    billing[`${PH_APP}:${MID2}`] = { status: 'ACTIVE', isInTrial: true };
    await connect();
    await connect(MID2);
    for (const v of [undefined, 'false', 'yes', '1']) {
      if (v === undefined) delete process.env.FOODHUB_PHONE_METERED_ENABLED; else process.env.FOODHUB_PHONE_METERED_ENABLED = v;
      calls = [];
      const sid = `CA300${v ?? 'unset'}`;
      expect(await end(sid, 150)).toMatchObject({ outcome: 'preview', minutes: 3 });
      expect(calls).toHaveLength(0); // no Clover request at all
      expect(await getMinuteRecord(sid)).toMatchObject({ state: 'preview', wouldBill: true });
    }
    expect(await end('CA301', 45, { merchantId: MID2 })).toMatchObject({ outcome: 'preview' });
    expect(await getMinuteRecord('CA301')).toMatchObject({ wouldBill: false }); // in its free trial
    expect(await settlePhoneMinutes()).toMatchObject({ reported: 0 });
    expect(calls).toHaveLength(0);
    const sum = await phoneMinutesSummary();
    expect(sum).toMatchObject({ enabled: false, meteredIdSet: true, price: { monthlyCad: 50, perMinuteCad: 0.25, trialDays: 14 } });
    expect(sum.total).toMatchObject({ calls: 5, aiMinutes: 13, wouldBillMinutes: 12, reportedMinutes: 0, notBilledMinutes: 1, estimateCad: 3 });
    // Settings → Clover app: the phone section carries the dry run, per merchant.
    const phone = (await cloverAppsOverview()).find((a) => a.key === 'phone')!;
    expect(phone.metering).toMatchObject({ enabled: false, env: { enabled: 'FOODHUB_PHONE_METERED_ENABLED', meteredId: 'CLOVER_PHONE_METERED_MINUTE_ID' } });
    expect(phone.installs.find((i) => i.merchantId === MID)?.minutes).toMatchObject({ wouldBillMinutes: 12 });
    expect(phone.installs.find((i) => i.merchantId === MID2)?.minutes).toMatchObject({ wouldBillMinutes: 0, notBilledMinutes: 1 });
    expect(metered()).toHaveLength(0);
  });

  it('an uncertain answer (timeout, Clover 5xx, connection lost) is never sent again; the owner sees it', async () => {
    await connect();
    meteredTimeout = true;
    expect(await end('CA400', 60)).toMatchObject({ outcome: 'uncertain' });
    meteredTimeout = false;
    meteredStatus = 503;
    expect(await end('CA401', 60)).toMatchObject({ outcome: 'uncertain' });
    meteredStatus = 200;
    meteredNetwork = 'ECONNRESET';
    expect(await end('CA402', 60)).toMatchObject({ outcome: 'uncertain' });
    meteredNetwork = '';
    expect(metered()).toHaveLength(3);
    await settlePhoneMinutes();
    await settlePhoneMinutes();
    expect(await end('CA400', 60)).toMatchObject({ outcome: 'duplicate' });
    expect(metered()).toHaveLength(3);
    expect((await phoneMinutesSummary()).total).toMatchObject({ uncertainCalls: 3, uncertainMinutes: 3, reportedMinutes: 0 });
    const logged = (await getRepo().listActivity()).filter((a) => a.action === 'clover_phone_minutes_uncertain');
    expect(logged).toHaveLength(3);
  });

  it('a definite failure before Clover processed anything is retried (3 attempts in all), then given up', async () => {
    await connect();
    meteredStatus = 400; // Clover refused: nothing charged
    expect(await end('CA500', 60)).toMatchObject({ outcome: 'pending' });
    meteredStatus = 200;
    expect(await settlePhoneMinutes()).toMatchObject({ reported: 1 });
    expect(metered()).toHaveLength(2);
    meteredNetwork = 'ECONNREFUSED'; // the connection never opened
    expect(await end('CA501', 60)).toMatchObject({ outcome: 'pending' });
    expect(await settlePhoneMinutes()).toMatchObject({ pending: 1 });
    expect(await settlePhoneMinutes()).toMatchObject({ failed: 1 });
    expect(await settlePhoneMinutes()).toMatchObject({ reported: 0, pending: 0, failed: 0 });
    meteredNetwork = '';
    expect(metered()).toHaveLength(5); // CA500 twice, CA501 three times, then never again
    expect(await getMinuteRecord('CA501')).toMatchObject({ state: 'failed', attempts: 3 });
  });

  it('saved before the charge: a database error after Clover answered never charges twice', async () => {
    await connect();
    const repo = getRepo();
    const orig = repo.putDocs.bind(repo);
    const spy = vi.spyOn(repo, 'putDocs').mockImplementation(async (col: string, docs: any[]) => {
      if (col === 'phone_minutes' && metered().length > 0) throw new Error('database down');
      return orig(col, docs);
    });
    try {
      await expect(end('CA600', 60)).rejects.toThrow('database down');
    } finally { spy.mockRestore(); }
    expect(metered()).toHaveLength(1);
    expect(await getMinuteRecord('CA600')).toMatchObject({ state: 'sending' });
    expect(await end('CA600', 60)).toMatchObject({ outcome: 'duplicate' });
    await settlePhoneMinutes();
    expect(metered()).toHaveLength(1);
    expect((await phoneMinutesSummary()).total).toMatchObject({ uncertainCalls: 1 });
  });

  it('Clover unreachable: minutes of a merchant last seen ACTIVE wait, then go once Clover answers ACTIVE; a trial never', async () => {
    await connect();
    billing[`${PH_APP}:${MID2}`] = { status: 'ACTIVE', isInTrial: true };
    await connect(MID2);
    const now = Date.now();
    billingDown = true;
    const outage = now + 20 * 60_000;
    expect(await end('CA700', 75, { now: outage })).toMatchObject({ outcome: 'pending', reason: 'clover_unreachable_grace' });
    expect(await end('CA701', 75, { now: outage, merchantId: MID2 })).toMatchObject({ outcome: 'not_billable', reason: 'clover_unreachable_grace' });
    expect(metered()).toHaveLength(0);
    // Still down a minute later: it keeps waiting, nothing sent.
    expect(await settlePhoneMinutes({ now: outage + 60_000 })).toMatchObject({ pending: 1, reported: 0 });
    billingDown = false;
    expect(await settlePhoneMinutes({ now: outage + 5 * 60_000 })).toMatchObject({ reported: 1 });
    expect(metered()).toHaveLength(1);
    expect(metered()[0].url).toContain('?count=2');
  });

  it('two settles on one out-of-date record: only one sees Clover answering; Clover gets exactly one POST', async () => {
    await connect();
    const base = Date.now();
    meteredStatus = 400; // attempt 0 refused: pending on attempt 1
    expect(await end('CA800', 60, { now: base })).toMatchObject({ outcome: 'pending' });
    meteredStatus = 200;
    const stale = (await getMinuteRecord('CA800'))!;
    expect(stale).toMatchObject({ state: 'pending', attempts: 1 });
    // Server A sends it.
    expect(await settlePhoneMinutes({ now: base + 60_000 })).toMatchObject({ reported: 1 });
    expect(metered()).toHaveLength(2);
    // Server B works from its earlier read, and its own Clover check fails (grace: last answer ACTIVE).
    const repo = getRepo();
    const orig = repo.listDocs.bind(repo);
    const spy = vi.spyOn(repo, 'listDocs').mockImplementation(async (col: string, f?: any) => (col === 'phone_minutes' ? [{ id: stale.callSid, key: stale.merchantId, at: stale.at, data: stale }] : orig(col, f)) as any);
    billingDown = true;
    try {
      expect(await settlePhoneMinutes({ now: base + 20 * 60_000 })).toMatchObject({ pending: 1, reported: 0 });
      // The same stale copy, Clover now saying INACTIVE: closing it needs the attempt's claim, already used by A.
      billingDown = false;
      billing[`${PH_APP}:${MID}`] = { status: 'INACTIVE' };
      await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
      await settlePhoneMinutes({ now: base + 21 * 60_000 });
    } finally { spy.mockRestore(); }
    expect(await getMinuteRecord('CA800')).toMatchObject({ state: 'reported', attempts: 1 });
    // Later runs (past the 10-minute stuck rule) never send it again.
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: false };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    for (const m of [32, 43, 54]) await settlePhoneMinutes({ now: base + m * 60_000 });
    expect(metered()).toHaveLength(2);
    expect(await getMinuteRecord('CA800')).toMatchObject({ state: 'reported', attempts: 1 });
  });

  it('an attempt whose server stopped: given up only when its POST never started, else uncertain (never sent twice)', async () => {
    await connect();
    const base = Date.now();
    meteredStatus = 400;
    await end('CA810', 60, { now: base });
    await end('CA811', 60, { now: base });
    meteredStatus = 200;
    const repo = getRepo();
    // CA810: attempt 1 claimed by a server that stopped before its POST claim. CA811: stopped after its POST claim.
    await repo.claimKv('clover_phone_minutes_send:CA810:1', { at: new Date(base).toISOString() });
    await repo.claimKv('clover_phone_minutes_send:CA811:1', { at: new Date(base).toISOString() });
    await repo.claimKv('clover_phone_minutes_post:CA811:1', { at: new Date(base).toISOString() });
    expect(await settlePhoneMinutes({ now: base + 5 * 60_000 })).toMatchObject({ pending: 2 }); // too early to tell
    await settlePhoneMinutes({ now: base + 11 * 60_000 });
    expect(await getMinuteRecord('CA810')).toMatchObject({ state: 'pending', attempts: 2 });
    expect(await getMinuteRecord('CA811')).toMatchObject({ state: 'uncertain' });
    await settlePhoneMinutes({ now: base + 12 * 60_000 });
    expect(await getMinuteRecord('CA810')).toMatchObject({ state: 'reported', attempts: 2 });
    expect(metered()).toHaveLength(3); // CA810 and CA811 refused once each, CA810 sent once; CA811 never again
    expect((await getRepo().listActivity()).filter((a) => a.action === 'clover_phone_minutes_uncertain' && a.summary.includes('CA811'))).toHaveLength(1);
  });

  it('a "sending" left behind becomes "uncertain" and is logged for the owner once', async () => {
    await connect();
    const repo = getRepo();
    const orig = repo.putDocs.bind(repo);
    const spy = vi.spyOn(repo, 'putDocs').mockImplementation(async (col: string, docs: any[]) => {
      if (col === 'phone_minutes' && metered().length > 0) throw new Error('database down');
      return orig(col, docs);
    });
    const base = Date.now();
    try {
      await expect(end('CA820', 60, { now: base })).rejects.toThrow('database down');
    } finally { spy.mockRestore(); }
    const logged = async () => (await getRepo().listActivity()).filter((a) => a.action === 'clover_phone_minutes_uncertain' && a.summary.includes('CA820'));
    expect(await getMinuteRecord('CA820')).toMatchObject({ state: 'sending' });
    expect(await logged()).toHaveLength(1); // told right away, even though the record could not be saved
    expect(await settlePhoneMinutes({ now: Date.now() + 11 * 60_000 })).toMatchObject({ uncertain: 1 });
    expect(await getMinuteRecord('CA820')).toMatchObject({ state: 'uncertain' });
    await settlePhoneMinutes({ now: Date.now() + 22 * 60_000 });
    expect(await logged()).toHaveLength(1);
    expect(metered()).toHaveLength(1);
  });

  it('one merchant waiting on Clover never holds up another merchant\'s minutes', async () => {
    await connect();
    await connect(MID2);
    const base = Date.now();
    meteredStatus = 400;
    expect(await end('CA900', 60, { now: base + 1000 })).toMatchObject({ outcome: 'pending' });
    meteredStatus = 200;
    billingDownFor.add(MID2);
    for (let i = 0; i < 30; i++) {
      expect(await end(`CA91${String(i).padStart(2, '0')}`, 60, { now: base + 20 * 60_000 + i * 1000, merchantId: MID2 })).toMatchObject({ outcome: 'pending' });
    }
    expect(await settlePhoneMinutes({ now: base + 21 * 60_000 })).toMatchObject({ reported: 1, pending: 30 });
    expect(await getMinuteRecord('CA900')).toMatchObject({ state: 'reported' });
    expect(metered()).toHaveLength(2);
  });

  it('minutes ended before CLOVER_PHONE_METERED_MINUTE_ID was set are a warning in the summary', async () => {
    await connect();
    delete process.env.CLOVER_PHONE_METERED_MINUTE_ID;
    expect(await end('CA950', 130)).toMatchObject({ outcome: 'no_metered_id' });
    expect((await phoneMinutesSummary()).total).toMatchObject({ noMeteredIdCalls: 1, noMeteredIdMinutes: 3, notBilledMinutes: 0 });
    expect(metered()).toHaveLength(0);
  });
});

describe('merchants API per app', () => {
  const owner = { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' };
  const url = 'http://hub.local/api/foodhub/clover-connect/merchants';
  const ctx = { params: Promise.resolve({}) } as any;
  const call = (method: 'POST' | 'DELETE', body: unknown) => (method === 'POST' ? merchantsPost : merchantsDelete)(new Request(url, { method, headers: owner, body: JSON.stringify(body) }) as any, ctx);
  beforeEach(() => { setPhoneEnv(); process.env.DASHBOARD_PASSWORD = 'Owner-pass-123'; delete process.env.CLOVER_ALLOWED_MERCHANTS; });

  it('GET lists one app at a time; an unknown app is refused', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: new URL(await startCloverConnect('Owner')).searchParams.get('state') });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID2, app: 'phone' });
    const get = async (q: string) => merchantsGet(new Request(`${url}${q}`, { headers: owner }) as any, ctx);
    const fh = await (await get('')).json();
    expect(fh.merchants.map((m: any) => m.merchantId)).toEqual([MID]);
    expect(fh.app.appId).toBe(FH_APP);
    expect((await (await get('?app=foodhub')).json()).merchants.map((m: any) => m.merchantId)).toEqual([MID]);
    const ph = await (await get('?app=phone')).json();
    expect(ph.merchants.map((m: any) => m.merchantId)).toEqual([MID2]);
    expect(JSON.stringify(ph)).not.toMatch(/PAT-|RT-|phone-secret/);
    expect((await get('?app=bogus')).status).toBe(400);
    expect((await merchantsGet(new Request(`${url}?app=phone`) as any, ctx)).status).toBe(401);
  });

  it('POST approves a waiting phone install without touching Food Hub; missing app = Food Hub; unknown app = 400', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' }); // from Clover: waits
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID }); // Food Hub from Clover: waits too
    expect((await call('POST', { merchantId: MID, app: 'bogus' })).status).toBe(400);
    const r = await call('POST', { merchantId: MID, app: 'phone' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ approved: MID, app: 'phone' });
    expect((await listCloverConnections('phone'))[0].status).toBe('active');
    expect((await listCloverConnections())[0].status).toBe('pending');
    expect((await call('POST', { merchantId: MID })).status).toBe(200);
    expect((await listCloverConnections())[0].status).toBe('active');
    expect((await call('POST', { merchantId: MID2, app: 'phone' })).status).toBe(404);
    expect((await call('POST', { app: 'phone' })).status).toBe(400);
  });

  it('DELETE disconnects one app only', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: new URL(await startCloverConnect('Owner')).searchParams.get('state') });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: new URL(await startCloverConnect('Owner', 'phone')).searchParams.get('state'), app: 'phone' });
    expect((await call('DELETE', { merchantId: MID, app: 'bogus' })).status).toBe(400);
    expect((await call('DELETE', { merchantId: MID, app: 'phone' })).status).toBe(200);
    expect(await listCloverConnections('phone')).toHaveLength(0);
    expect(await listCloverConnections()).toHaveLength(1);
    expect((await readCloverBillingState(MID, 'phone')).billing).toBeNull(); // its saved subscription is forgotten too
    expect((await call('DELETE', { merchantId: MID, app: 'phone' })).status).toBe(404);
    expect((await call('DELETE', { merchantId: MID })).status).toBe(200); // no app = Food Hub
    expect(await listCloverConnections()).toHaveLength(0);
  });
});

describe('Food Hub keys are read exactly as before (no trimming)', () => {
  it('the same raw CLOVER_CLIENT_ID drives the authorize URL, the code exchange, the wrong-app check and the App-event filter', async () => {
    process.env.CLOVER_CLIENT_ID = ` ${FH_APP}\n`;
    const raw = process.env.CLOVER_CLIENT_ID;
    expect(cloverApp('foodhub').appId).toBe(raw);
    expect(new URL(await startCloverConnect('Owner')).searchParams.get('client_id')).toBe(raw);
    expect(await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: FH_APP })).toMatchObject({ ok: false, code: 'wrong_app' });
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: raw });
    expect(calls.find((c) => c.url.endsWith('/oauth/v2/token'))?.body.client_id).toBe(raw);
    // App events are filtered with that very value (an event for the trimmed ID is not this app's), as before.
    expect(await handleCloverAppEvents(appEvent(FH_APP, MID, 'DELETE'))).toEqual({ uninstalled: [], installed: [] });
    // The phone app (new) trims its own keys.
    process.env.CLOVER_PHONE_APP_ID = ` ${PH_APP} `;
    expect(cloverApp('phone').appId).toBe(PH_APP);
  });
});
