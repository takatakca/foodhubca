// Several Clover App Market apps on one backend: TAKATAK Food Hub (unchanged) + the AI phone app (sold separately).
// Per-app registry, OAuth start/callback, token stores keyed by (app, merchant) with old single-app tokens still read,
// per-app webhook verification + dispatch, uninstall of one app only, refresh locks per app, the phone entitlement
// (billing_info cached, grace periods) and per-order usage. Clover is never called: fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

import { cloverApp, cloverAppByAppId, cloverApps, cloverPhoneAppEnabled } from '../lib/foodhub/pos/clover-apps';
import { cloverAppsOverview } from '../lib/foodhub/pos/clover-apps-status';
import {
  appInstalled, phoneAllowance, phoneCloverToken, phoneEntitled, phoneUsage, recordPhoneOrder, voiceAiEntitled,
} from '../lib/foodhub/pos/clover-entitlement';
import {
  approveCloverMerchant, cloverAppReadiness, cloverAppToken, cloverOAuthToken, cloverWelcome, cloverWelcomeQuery, finishCloverConnect,
  handleCloverAppEvents, listCloverConnections, startCloverConnect, startCloverLaunch,
} from '../lib/foodhub/pos/clover-oauth';
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
let meteredStatus = 200;

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
      seq++;
      return json(200, { access_token: `${prefix(body?.client_id)}-R${seq}`, access_token_expiration: now + 1800, refresh_token: `RT-${body?.client_id}-${seq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    const bi = p.match(/^\/v3\/apps\/([^/]+)\/merchants\/([^/]+)\/billing_info$/);
    if (bi) {
      if (billingDown) return json(503, {});
      return json(200, billing[`${bi[1]}:${bi[2]}`] ?? { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Essentiel' } });
    }
    if (/\/metereds\//.test(p)) return json(meteredStatus, { id: 'MTR-1' });
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
  process.env.CLOVER_PHONE_METERED_ORDER_ID = 'METERED01';
}
const PHONE_ENV = ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'CLOVER_PHONE_WEBHOOK_AUTH', 'CLOVER_PHONE_METERED_ORDER_ID', 'CLOVER_PHONE_APP_NAME', 'PHONE_OWN_MERCHANTS'];

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
  calls = []; seq = 0; billing = {}; billingDown = false; meteredStatus = 200;
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
    expect(cloverApp('phone')).toMatchObject({ name: 'TAKATAK Phone', appId: null, events: ['app'] });
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
    const r = await recordPhoneOrder(MID, 'ORDER1');
    expect(r).toMatchObject({ counted: true, reported: false, outcome: 'not_billable', reason: 'gate_off' });
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
    expect(await recordPhoneOrder(MID, 'ORDER9')).toMatchObject({ reported: false, outcome: 'not_billable', reason: 'not_installed' });
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

describe('phone orders: allowance, per-order charge, once per order', () => {
  beforeEach(setPhoneEnv);
  const metered = () => calls.filter((c) => c.url.includes('/metereds/'));

  it('allowance per tier', () => {
    expect(phoneAllowance('Essentiel')).toBe(150);
    expect(phoneAllowance('TAKATAK Phone Pro')).toBe(500);
    expect(phoneAllowance(null)).toBe(150);
  });

  it('reports to Clover only beyond the allowance of an ACTIVE subscription, each order once', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const now = Date.now();
    const month = (await phoneUsage(MID, now)).month;
    await getRepo().setKv(`clover_phone_usage:${MID}:${month}`, { orders: Array.from({ length: 149 }, (_, i) => `PRE${i}`), reported: [], failed: [] });
    expect(await recordPhoneOrder(MID, 'ORDER150', { now })).toMatchObject({ counted: true, reported: false, outcome: 'within_allowance', used: 150, allowance: 150 });
    expect(metered()).toHaveLength(0);
    const r = await recordPhoneOrder(MID, 'ORDER151', { now });
    expect(r).toMatchObject({ counted: true, reported: true, outcome: 'reported', used: 151 });
    expect(metered()).toHaveLength(1);
    expect(metered()[0]).toMatchObject({ method: 'POST', auth: 'Bearer PAT-1' });
    expect(metered()[0].url).toBe(`https://api.clover.com/v3/apps/${PH_APP}/merchants/${MID}/metereds/METERED01?count=1`);
    expect(await recordPhoneOrder(MID, 'ORDER151', { now })).toMatchObject({ counted: false, reported: false, outcome: 'duplicate' });
    expect(metered()).toHaveLength(1);
    expect(await phoneUsage(MID, now)).toMatchObject({ orders: 151, reported: 1, failed: 0 });
    // Concurrent records of the same order count once.
    const [x, y] = await Promise.all([recordPhoneOrder(MID, 'ORDER152', { now }), recordPhoneOrder(MID, 'ORDER152', { now })]);
    expect([x.outcome, y.outcome].sort()).toEqual(['duplicate', 'reported']);
    expect(metered()).toHaveLength(2);
  });

  it('never bills a trial, our own restaurant, a missing metered ID; a Clover refusal is counted, not billed', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, app: 'phone' });
    const now = Date.now();
    const month = (await phoneUsage(MID, now)).month;
    const full = { orders: Array.from({ length: 600 }, (_, i) => `PRE${i}`), reported: [], failed: [] };
    await getRepo().setKv(`clover_phone_usage:${MID}:${month}`, full);
    delete process.env.CLOVER_PHONE_METERED_ORDER_ID;
    expect(await recordPhoneOrder(MID, 'A1', { now })).toMatchObject({ outcome: 'no_metered_id', reported: false });
    process.env.CLOVER_PHONE_METERED_ORDER_ID = 'METERED01';
    meteredStatus = 400;
    expect(await recordPhoneOrder(MID, 'A2', { now })).toMatchObject({ outcome: 'clover_refused', reported: false, counted: true });
    meteredStatus = 200;
    billing[`${PH_APP}:${MID}`] = { status: 'ACTIVE', isInTrial: true };
    await handleCloverAppEvents(appEvent(PH_APP, MID, 'UPDATE'), 'phone');
    expect(await recordPhoneOrder(MID, 'A3', { now })).toMatchObject({ outcome: 'not_billable', reason: 'trial' });
    process.env.PHONE_OWN_MERCHANTS = MID;
    expect(await recordPhoneOrder(MID, 'A4', { now })).toMatchObject({ outcome: 'not_billable', reason: 'own_merchant' });
    expect(metered()).toHaveLength(1); // only the refused attempt reached Clover
    expect(await recordPhoneOrder('bad id!', 'A5')).toMatchObject({ outcome: 'bad_input', counted: false });
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
