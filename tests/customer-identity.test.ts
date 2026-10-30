// Customer identity for the brand websites (docs/CUSTOMER_IDENTITY.md): phone verification by text (Food Hub code and
// Twilio Verify), account created on the right code, limits, the signed customer token, the /me projection with website
// orders, profile / addresses / favourites validation, logout, and the Loi 25 delete (anonymised). Twilio is a fake
// fetch: nothing leaves the test, and the code the "customer" types is read from the fake text, like a phone would.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as adminGet } from '../app/api/foodhub/customers/admin/route';
import { PUT as addressesPut } from '../app/api/foodhub/customers/me/addresses/route';
import { PUT as favouritesPut } from '../app/api/foodhub/customers/me/favourites/route';
import { POST as logoutPost } from '../app/api/foodhub/customers/me/logout/route';
import { DELETE as meDelete, GET as meGet, PATCH as mePatch } from '../app/api/foodhub/customers/me/route';
import { POST as checkPost } from '../app/api/foodhub/customers/verify/check/route';
import { POST as startPost } from '../app/api/foodhub/customers/verify/start/route';
import { countCustomers, findCustomerByPhone, getCustomer } from '../lib/foodhub/customers/store';
import { resolveCustomerToken, signCustomerToken, verifyCustomerToken } from '../lib/foodhub/customers/token';
import { allowedCustomerTenants, customerTenant, tenantDisplayName } from '../lib/foodhub/customers/types';
import { checkVerification, resetCustomerVerifyLimits, startVerification, verifyReadiness, verifySmsText } from '../lib/foodhub/customers/verify';
import { saveDirectOrder } from '../lib/foodhub/delivery/store';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import { listOutbox } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import { resetThrottle } from '../lib/foodhub/session';

const SECRET = 'website-secret-for-tests';
const PHONE = '+15145551234';
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; form: URLSearchParams; headers: Record<string, string> }> = [];
let twilioCheck: (code: string) => 'approved' | 'pending' = () => 'pending';
let twilioStartStatus = 201;

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('SESSION_SECRET', 'customer-test-secret-0123456789-abcdefghijklmnop');
  vi.stubEnv('FOODHUB_WEBSITE_ORDER_SECRET', SECRET);
  vi.stubEnv('FOODHUB_PUBLIC_URL', 'https://hub.example.test');
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tw-token');
  vi.stubEnv('TWILIO_FROM', '+15145550000');
  vi.stubEnv('TWILIO_MESSAGING_SERVICE_SID', '');
  vi.stubEnv('TWILIO_VERIFY_SERVICE_SID', '');
  vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', '');
  vi.stubEnv('FOODHUB_LOYALTY_URL', '');
  vi.stubEnv('FOODHUB_GIFTCARDS_URL', '');
  vi.stubEnv('FOODHUB_TRUST_PROXY', '');
  vi.stubEnv('DASHBOARD_PASSWORD', '');
  resetThrottle();
  resetCustomerVerifyLimits();
  calls = [];
  twilioCheck = () => 'pending';
  twilioStartStatus = 201;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    const form = new URLSearchParams(String(init.body ?? ''));
    calls.push({ url: u, method: String(init.method ?? 'GET'), form, headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/Messages.json')) return json({ sid: 'SM1' }, 201);
    if (/\/v2\/Services\/VA1\/Verifications$/.test(u)) return twilioStartStatus === 201 ? json({ sid: 'VE1', status: 'pending' }, 201) : json({ code: 60203, message: 'Max send attempts reached' }, twilioStartStatus);
    if (/\/v2\/Services\/VA1\/VerificationCheck$/.test(u)) return json({ sid: 'VE1', status: twilioCheck(form.get('Code') ?? '') });
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

const BASE = 'https://hub.example.test/api/foodhub/customers';
type Init = { method?: string; body?: unknown; token?: string; auth?: string | null; headers?: Record<string, string> };
function req(path: string, init: Init = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (init.auth !== null) headers.authorization = `Bearer ${init.auth ?? SECRET}`;
  if (init.token) headers['x-customer-token'] = init.token;
  return new Request(`${BASE}${path}`, { method: init.method ?? 'POST', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const read = async (p: Response | Promise<Response>) => { const r = await p; return { status: r.status, ...(await r.json()) } as { status: number; ok: boolean; [k: string]: any }; };
const start = (body: unknown, init: Init = {}) => read(startPost(req('/verify/start', { body, ...init })) as Promise<Response>);
const check = (body: unknown, init: Init = {}) => read(checkPost(req('/verify/check', { body, ...init })) as Promise<Response>);
const me = (token: string, init: Init = {}) => read(meGet(req('/me', { method: 'GET', token, ...init })) as Promise<Response>);
const smsCalls = () => calls.filter((c) => c.url.includes('/Messages.json'));
/** The code from the fake text — what the customer reads on their phone. */
const lastCode = () => smsCalls().at(-1)!.form.get('Body')!.match(/\d{6}/)![0];
/** Everything Food Hub stored in this test, as text: the code must never be in it. */
const storedText = () => JSON.stringify((globalThis as unknown as { __foodhubMem: unknown }).__foodhubMem);

async function signIn(phone = '514 555 1234', tenant = 'pppmtl', lang = 'fr') {
  const s = await start({ tenant, phone, lang });
  expect(s.status, s.error).toBe(200);
  const c = await check({ tenant, phone, code: lastCode() });
  expect(c.status, c.error).toBe(200);
  return c as unknown as { token: string; expiresAt: string; customer: { id: string; phone: string; lang: string; name?: string; email?: string; marketingConsent: boolean }; created: boolean };
}

const websiteOrder = (over: Partial<DirectOrder>): DirectOrder => ({
  id: over.id ?? `dir_${Math.random().toString(36).slice(2, 10)}`, number: 'W-1001', source: 'website', sourceRef: over.id, brandName: 'PPP Pizzeria', locationCode: 'NDG',
  customer: { phone: PHONE, name: 'Ana' }, fulfillment: 'pickup', lines: [], subtotal: 20, tax: 3, deliveryFee: 0, tip: 0, total: 23, currency: 'CAD', payment: 'paid', status: 'completed',
  containsAlcohol: false, placedAt: '2026-10-01T12:00:00.000Z', events: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', ...over,
});

describe('verify start / check with Food Hub’s own texted code', () => {
  it('refuses every route without the website secret', async () => {
    expect((await start({ tenant: 'pppmtl', phone: '514 555 1234' }, { auth: null })).status).toBe(401);
    expect((await start({ tenant: 'pppmtl', phone: '514 555 1234' }, { auth: 'wrong' })).status).toBe(401);
    expect((await check({ tenant: 'pppmtl', phone: '514 555 1234', code: '123456' }, { auth: null })).status).toBe(401);
    expect((await me('x', { auth: null })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('texts a 6-digit brand code without a link, never keeps it in clear, and creates the account on the right code', async () => {
    const s = await start({ tenant: 'pppmtl', phone: '514 555 1234', lang: 'fr' });
    expect(s).toMatchObject({ status: 200, ok: true, expiresInS: 600, channel: 'sms' });
    expect(JSON.stringify(s)).not.toMatch(/code/);
    const sms = smsCalls();
    expect(sms).toHaveLength(1);
    expect(sms[0].form.get('To')).toBe(PHONE);
    const text = sms[0].form.get('Body')!;
    expect(text).toMatch(/^Votre code PPP Pizzeria : \d{6} \(valide 10 min\)\. Ne le partagez pas\.$/);
    expect(text).not.toMatch(/http/i);
    const code = lastCode();
    expect(storedText()).not.toContain(code);
    const out = await listOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ channel: 'sms', purpose: 'customer_verify', ok: true });
    expect(out[0].preview).toBeUndefined();

    const wrong = await check({ tenant: 'pppmtl', phone: '5145551234', code: code === '000000' ? '000001' : '000000' });
    expect(wrong).toMatchObject({ status: 401, ok: false, attemptsLeft: 4 });

    const c = await check({ tenant: 'pppmtl', phone: '(514) 555-1234', code });
    expect(c.status).toBe(200);
    expect(c.token).toMatch(/^cust\.cus_[a-z0-9]+\.pppmtl\.\d+\.1\.[A-Za-z0-9_-]+$/);
    expect(c.created).toBe(true);
    expect(c.customer).toMatchObject({ phone: PHONE, lang: 'fr', marketingConsent: false });
    expect(c.customer.id).toMatch(/^cus_/);
    expect(Object.keys(c.customer).sort()).toEqual(['createdAt', 'id', 'lang', 'marketingConsent', 'phone', 'verifiedAt']);
    const expMs = Date.parse(c.expiresAt) - Date.now();
    expect(expMs).toBeGreaterThan(29 * 86400_000);
    expect(expMs).toBeLessThanOrEqual(30 * 86400_000);
    expect(storedText()).not.toContain(code);

    const rec = await findCustomerByPhone(PHONE);
    expect(rec).toMatchObject({ id: c.customer.id, tenants: ['pppmtl'], tokenVersion: 1, addresses: [], favourites: [] });
    const log = await getRepo().listActivity({ kinds: ['customer'] });
    expect(log.map((a) => a.action)).toEqual(['customer_created']);
    expect(log[0].summary).not.toContain('5551234');
    expect(log[0].summary).toContain('1234');

    // The code is single-use.
    expect((await check({ tenant: 'pppmtl', phone: '514 555 1234', code })).status).toBe(410);

    // Same number again: the same account, not a second one.
    const again = await signIn();
    expect(again.customer.id).toBe(c.customer.id);
    expect(again.created).toBe(false);
    expect((await getRepo().listActivity({ kinds: ['customer'] })).map((a) => a.action)).toEqual(['customer_verified', 'customer_created']);
    expect((await countCustomers())).toEqual({ total: 1, deleted: 0 });
  });

  it('English text, display names of other websites, FOODHUB_CUSTOMER_TENANTS allow-list', async () => {
    expect(verifySmsText('123456', 'pppmtl', 'en')).toBe('Your PPP Pizzeria code: 123456 (valid 10 min). Do not share it.');
    expect(tenantDisplayName('gateau-montreal')).toBe('Gateau Montreal');
    expect(allowedCustomerTenants()).toEqual(['pppmtl', 'on2go']);
    expect(customerTenant('gateau')).toBeNull();
    expect((await start({ tenant: 'gateau', phone: '514 555 1234' })).status).toBe(403);
    vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', 'pppmtl, gateau,Bad Slug!');
    expect(allowedCustomerTenants()).toEqual(['pppmtl', 'gateau', 'on2go']);
    expect((await start({ tenant: 'gateau', phone: '514 555 1234', lang: 'en' })).status).toBe(200);
    expect(smsCalls()[0].form.get('Body')).toMatch(/^Your Gateau code: \d{6} \(valid 10 min\)\. Do not share it\.$/);
  });

  it('bad phone → 422, bad JSON → 400, texts not set up → 503 and nothing stored', async () => {
    expect((await start({ tenant: 'pppmtl', phone: '123' })).status).toBe(422);
    expect((await start({ tenant: 'pppmtl', phone: '+44 20 7946 0958' })).status).toBe(422);
    expect((await start({ tenant: 'pppmtl' })).status).toBe(422);
    const raw = await startPost(new Request(`${BASE}/verify/start`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: '{not json' }));
    expect(raw.status).toBe(400);
    vi.stubEnv('TWILIO_FROM', '');
    const r = await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    expect(r.status).toBe(503);
    expect(r.error).toMatch(/SMS is not set up/);
    expect(calls).toHaveLength(0);
    expect(await getRepo().listDocs('customer_verifications')).toHaveLength(0);
  });

  it('five wrong codes void the code; then a minute’s lock; a new code works again; an old code is expired', async () => {
    await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    const code = lastCode();
    const bad = code === '999999' ? '999998' : '999999';
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) {
      const r = await check({ tenant: 'pppmtl', phone: '514 555 1234', code: bad });
      seen.push([r.status, r.attemptsLeft]);
    }
    expect(seen).toEqual([[401, 4], [401, 3], [401, 2], [401, 1], [410, 0]]);
    // Void, and the address + number pair is locked for a minute (the console's throttle).
    expect((await check({ tenant: 'pppmtl', phone: '514 555 1234', code })).status).toBe(429);
    resetThrottle();
    expect((await check({ tenant: 'pppmtl', phone: '514 555 1234', code })).status).toBe(410);
    expect((await start({ tenant: 'pppmtl', phone: '514 555 1234' })).status).toBe(200);
    expect((await check({ tenant: 'pppmtl', phone: '514 555 1234', code: lastCode() })).status).toBe(200);
    // Expiry: 10 minutes.
    await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    const fresh = lastCode();
    const late = await checkVerification({ tenant: 'pppmtl', phone: '514 555 1234', code: fresh }, 'local', { now: Date.now() + 11 * 60_000 });
    expect(late).toMatchObject({ ok: false, status: 410, attemptsLeft: 0 });
    expect(await checkVerification({ tenant: 'pppmtl', phone: '514 555 1234', code: 'abc' }, 'local')).toMatchObject({ ok: false, status: 400 });
  });

  it('limits: 3 starts per number per 10 minutes, 60 per website per minute (with Retry-After)', async () => {
    for (let i = 0; i < 3; i++) expect((await start({ tenant: 'pppmtl', phone: '514 555 1234' })).status).toBe(200);
    const fourth = await startPost(req('/verify/start', { body: { tenant: 'pppmtl', phone: '514 555 1234' } }));
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get('retry-after'))).toBeGreaterThan(0);
    const j = await fourth.json();
    expect(j.retryAfterS).toBeGreaterThan(0);
    expect(j.retryAfterS).toBeLessThanOrEqual(600);
    expect((await start({ tenant: 'pppmtl', phone: '514 555 9876' })).status).toBe(200);
    expect(smsCalls()).toHaveLength(4);
    // The number's limit survives a process restart (it is in the store), the website's limit is per process.
    resetCustomerVerifyLimits();
    expect((await start({ tenant: 'pppmtl', phone: '514 555 1234' })).status).toBe(429);
    const r = await startVerification({ tenant: 'pppmtl', phone: '514 555 1234' }, { now: Date.now() + 10 * 60_000 + 1000 });
    expect(r.ok).toBe(true);

    (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
    resetCustomerVerifyLimits();
    calls = [];
    for (let i = 0; i < 60; i++) expect((await start({ tenant: 'pppmtl', phone: `514 555 ${String(1000 + i)}` })).status).toBe(200);
    const over = await start({ tenant: 'pppmtl', phone: '514 555 2000' });
    expect(over).toMatchObject({ status: 429, ok: false });
    expect(over.retryAfterS).toBeLessThanOrEqual(60);
    expect(smsCalls()).toHaveLength(60);
  });
});

describe('Twilio Verify provider', () => {
  beforeEach(() => { vi.stubEnv('TWILIO_VERIFY_SERVICE_SID', 'VA1'); vi.stubEnv('TWILIO_FROM', ''); });

  it('starts a verification at Twilio (Basic auth, To / Channel / Locale), never texts itself', async () => {
    const s = await start({ tenant: 'pppmtl', phone: '514 555 1234', lang: 'en' });
    expect(s).toMatchObject({ status: 200, expiresInS: 600, channel: 'sms' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://verify.twilio.com/v2/Services/VA1/Verifications', method: 'POST' });
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('AC1:tw-token').toString('base64')}`);
    expect(calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(calls[0].form)).toEqual({ To: PHONE, Channel: 'sms', Locale: 'en' });
    expect(smsCalls()).toHaveLength(0);
    expect(storedText()).not.toMatch(/codeHash/);
  });

  it('checks the code at Twilio: pending = wrong (attempts counted here too), approved = account + token', async () => {
    await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    twilioCheck = (c) => (c === '424242' ? 'approved' : 'pending');
    const wrong = await check({ tenant: 'pppmtl', phone: '514 555 1234', code: '111111' });
    expect(wrong).toMatchObject({ status: 401, attemptsLeft: 4 });
    expect(calls.at(-1)).toMatchObject({ url: 'https://verify.twilio.com/v2/Services/VA1/VerificationCheck' });
    expect(Object.fromEntries(calls.at(-1)!.form)).toEqual({ To: PHONE, Code: '111111' });
    const ok = await check({ tenant: 'pppmtl', phone: '514 555 1234', code: '424242' });
    expect(ok.status).toBe(200);
    expect(ok.customer.phone).toBe(PHONE);
    expect(storedText()).not.toContain('424242');
    expect((await resolveCustomerToken(ok.token)).ok).toBe(true);
    // Five wrong answers from Twilio void it locally as well.
    await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    resetThrottle();
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await check({ tenant: 'pppmtl', phone: '514 555 1234', code: '000000' })).status;
    expect(last).toBe(410);
  });

  it('uses the Twilio account of the Verify service when TWILIO_VERIFY_ACCOUNT_SID / _AUTH_TOKEN are set', async () => {
    vi.stubEnv('TWILIO_VERIFY_ACCOUNT_SID', 'AC2');
    vi.stubEnv('TWILIO_VERIFY_AUTH_TOKEN', 'other-token');
    try {
      expect(verifyReadiness()).toEqual({ ok: true, provider: 'twilio_verify' });
      const s = await start({ tenant: 'pppmtl', phone: '514 555 1234' });
      expect(s.status).toBe(200);
      expect(calls.at(-1)!.headers.authorization).toBe(`Basic ${Buffer.from('AC2:other-token').toString('base64')}`);
      // Only the Verify account is needed: the texting account may be absent.
      vi.stubEnv('TWILIO_ACCOUNT_SID', ''); vi.stubEnv('TWILIO_AUTH_TOKEN', '');
      expect(verifyReadiness()).toEqual({ ok: true, provider: 'twilio_verify' });
      vi.stubEnv('TWILIO_VERIFY_AUTH_TOKEN', '');
      expect(verifyReadiness().ok).toBe(false);
    } finally {
      vi.stubEnv('TWILIO_VERIFY_ACCOUNT_SID', ''); vi.stubEnv('TWILIO_VERIFY_AUTH_TOKEN', '');
      vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1'); vi.stubEnv('TWILIO_AUTH_TOKEN', 'tw-token');
    }
  });

  it('Twilio refusing to send more codes becomes a 429 for the website', async () => {
    twilioStartStatus = 429;
    const r = await start({ tenant: 'pppmtl', phone: '514 555 1234' });
    expect(r).toMatchObject({ status: 429, ok: false });
    expect(r.retryAfterS).toBeGreaterThan(0);
    expect(await getRepo().listDocs('customer_verifications')).toHaveLength(0);
  });
});

describe('customer token', () => {
  it('verifies, refuses a tampered or expired token, a token of another website, and an unknown website', async () => {
    const { token, customer } = await signIn();
    const v = await verifyCustomerToken(token);
    expect(v).toMatchObject({ ok: true, payload: { id: customer.id, tenant: 'pppmtl', version: 1 } });
    const tampered = `${token.slice(0, -3)}${token.endsWith('abc') ? 'xyz' : 'abc'}`;
    expect(await verifyCustomerToken(tampered)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyCustomerToken('cust.x.pppmtl.1.1')).toMatchObject({ ok: false, status: 401 });
    expect(await verifyCustomerToken('')).toMatchObject({ ok: false, status: 401 });
    const rec = (await getCustomer(customer.id))!;
    const expired = await signCustomerToken(rec, 'pppmtl', -1);
    expect(await verifyCustomerToken(expired.token)).toMatchObject({ ok: false, status: 401 });
    expect((await me(expired.token)).status).toBe(401);
    expect(await verifyCustomerToken(token, { tenant: 'gateau' })).toMatchObject({ ok: false, status: 403 });
    expect((await me(token, { headers: { 'x-customer-tenant': 'gateau' } })).status).toBe(403);
    expect((await me(token, { headers: { 'x-customer-tenant': 'pppmtl' } })).status).toBe(200);
    const other = await signCustomerToken(rec, 'gateau');
    expect(await verifyCustomerToken(other.token)).toMatchObject({ ok: false, status: 403 });
    vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', 'pppmtl,gateau');
    expect(await verifyCustomerToken(other.token)).toMatchObject({ ok: true });
    expect((await me(other.token, { headers: { 'x-customer-tenant': 'pppmtl' } })).status).toBe(403);
    // A token signed for a version the record does not have is dead too.
    const future = await signCustomerToken({ id: rec.id, tokenVersion: 7 }, 'pppmtl');
    expect(await resolveCustomerToken(future.token)).toMatchObject({ ok: false, status: 401 });
  });

  it('logout voids every token of the customer; the next sign-in gets a new version', async () => {
    const { token, customer } = await signIn();
    expect((await me(token)).status).toBe(200);
    expect((await read(logoutPost(req('/me/logout', { token })))).ok).toBe(true);
    expect((await me(token)).status).toBe(401);
    expect((await read(logoutPost(req('/me/logout', { token })))).status).toBe(401);
    const again = await signIn();
    expect(again.customer.id).toBe(customer.id);
    expect(again.token.split('.')[4]).toBe('2');
    expect((await me(again.token)).status).toBe(200);
  });
});

describe('GET /me', () => {
  it('projects the profile, that number’s website orders (newest first, max 20) and the truthful adapters', async () => {
    const { token } = await signIn();
    await saveDirectOrder(websiteOrder({ id: 'w1', number: 'W-1001', placedAt: '2026-10-01T12:00:00.000Z', createdAt: '2026-10-01T12:00:00.000Z' }));
    await saveDirectOrder(websiteOrder({ id: 'w2', number: 'W-1002', placedAt: '2026-10-03T12:00:00.000Z', createdAt: '2026-10-03T12:00:00.000Z', total: 41.5, status: 'in_kitchen', fulfillment: 'delivery' }));
    await saveDirectOrder(websiteOrder({ id: 'w3', number: 'W-1003', customer: { phone: '+15145559999' }, createdAt: '2026-10-04T12:00:00.000Z' }));
    await saveDirectOrder(websiteOrder({ id: 't1', number: 'T-1004', source: 'phone', createdAt: '2026-10-05T12:00:00.000Z' }));
    const r = await me(token);
    expect(r.status).toBe(200);
    expect(r.customer).toMatchObject({ phone: PHONE, lang: 'fr' });
    expect(r.addresses).toEqual([]);
    expect(r.favourites).toEqual([]);
    expect(r.loyalty).toEqual({ connected: false, reason: 'LOY4LTY not connected yet' });
    expect(r.giftCards).toEqual({ connected: false, reason: 'REW4RDS not connected yet' });
    expect(r.orders).toEqual([
      { id: 'w2', number: 'W-1002', at: '2026-10-03T12:00:00.000Z', total: 41.5, status: 'in_kitchen', brand: 'PPP Pizzeria', fulfillment: 'delivery' },
      { id: 'w1', number: 'W-1001', at: '2026-10-01T12:00:00.000Z', total: 23, status: 'completed', brand: 'PPP Pizzeria', fulfillment: 'pickup' },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/tokenVersion|tenants/);
    for (let i = 0; i < 25; i++) await saveDirectOrder(websiteOrder({ id: `m${i}`, number: `W-2${String(i).padStart(3, '0')}`, createdAt: `2026-11-01T12:${String(i).padStart(2, '0')}:00.000Z`, placedAt: `2026-11-01T12:${String(i).padStart(2, '0')}:00.000Z` }));
    const more = await me(token);
    expect(more.orders).toHaveLength(20);
    expect(more.orders[0].number).toBe('W-2024');
    vi.stubEnv('FOODHUB_LOYALTY_URL', 'https://loy4lty.example');
    expect((await me(token)).loyalty.reason).toMatch(/FOODHUB_LOYALTY_URL is set/);
  });
});

describe('PATCH /me, addresses, favourites', () => {
  it('validates the profile fields and saves clean values', async () => {
    const { token } = await signIn();
    const patch = (body: unknown) => read(mePatch(req('/me', { method: 'PATCH', token, body })) as Promise<Response>);
    expect((await patch({ email: 'not-an-email' })).status).toBe(422);
    expect((await patch({ name: 'x'.repeat(81) })).status).toBe(422);
    expect((await patch({ name: 42 })).status).toBe(422);
    expect((await patch({ lang: 'de' })).status).toBe(422);
    expect((await patch({ marketingConsent: 'yes' })).status).toBe(422);
    const ok = await patch({ name: '  Ana   Bel ', email: 'Ana@Example.com', lang: 'en', marketingConsent: true });
    expect(ok.status).toBe(200);
    expect(ok.customer).toMatchObject({ name: 'Ana Bel', email: 'ana@example.com', lang: 'en', marketingConsent: true, phone: PHONE });
    // A bad field saves nothing of the request.
    expect((await patch({ name: 'Zoe', email: 'bad' })).status).toBe(422);
    expect((await getCustomer(ok.customer.id))!.name).toBe('Ana Bel');
    const cleared = await patch({ name: null, email: '' });
    expect(cleared.customer.name).toBeUndefined();
    expect(cleared.customer.email).toBeUndefined();
    expect((await patch({})).status).toBe(200);
    expect((await read(mePatch(req('/me', { method: 'PATCH', body: { name: 'x' } })) as Promise<Response>)).status).toBe(401);
  });

  it('addresses: at most 5, street + city + a Canadian postal code; favourites: at most 50 refs, no duplicates', async () => {
    const { token } = await signIn();
    const put = (body: unknown) => read(addressesPut(req('/me/addresses', { method: 'PUT', token, body })) as Promise<Response>);
    const a = { street: '5555 Monkland Ave', city: 'Montréal', postalCode: 'h4a1e1' };
    expect((await put({ addresses: Array.from({ length: 6 }, () => a) })).status).toBe(422);
    expect((await put({ addresses: [{ ...a, postalCode: '12345' }] })).status).toBe(422);
    expect((await put({ addresses: [{ city: 'Montréal', postalCode: 'H4A 1E1' }] })).status).toBe(422);
    expect((await put({ addresses: 'nope' })).status).toBe(422);
    const ok = await put({ addresses: [{ ...a, label: 'Maison', unit: '3', instructions: 'Code 1234' }, { ...a, street: '1 Rue Test', province: 'Québec', postalCode: 'H2X 1Y4' }] });
    expect(ok.status).toBe(200);
    expect(ok.addresses).toEqual([
      { label: 'Maison', street: '5555 Monkland Ave', unit: '3', city: 'Montréal', province: 'QC', postalCode: 'H4A 1E1', instructions: 'Code 1234' },
      { street: '1 Rue Test', city: 'Montréal', province: 'QC', postalCode: 'H2X 1Y4' },
    ]);
    expect((await me(token)).addresses).toHaveLength(2);

    const fav = (body: unknown) => read(favouritesPut(req('/me/favourites', { method: 'PUT', token, body })) as Promise<Response>);
    expect((await fav({ favourites: Array.from({ length: 51 }, (_, i) => `item-${i}`) })).status).toBe(422);
    expect((await fav({ favourites: ['a', 1] })).status).toBe(422);
    expect((await fav({ favourites: [''] })).status).toBe(422);
    expect((await fav({ favourites: ['pizza-margherita', ' pizza-margherita ', 'poutine'] })).favourites).toEqual(['pizza-margherita', 'poutine']);
    expect((await me(token)).favourites).toEqual(['pizza-margherita', 'poutine']);
    expect((await fav({ favourites: [] })).favourites).toEqual([]);
  });
});

describe('DELETE /me (Loi 25)', () => {
  it('anonymises the record, kills every token, and a later verification of the same number starts a new account', async () => {
    const { token, customer } = await signIn();
    await read(mePatch(req('/me', { method: 'PATCH', token, body: { name: 'Ana Bel', email: 'ana@example.com', marketingConsent: true } })) as Promise<Response>);
    await read(addressesPut(req('/me/addresses', { method: 'PUT', token, body: { addresses: [{ street: '5555 Monkland Ave', city: 'Montréal', postalCode: 'H4A 1E1' }] } })) as Promise<Response>);
    const del = await read(meDelete(req('/me', { method: 'DELETE', token })) as Promise<Response>);
    expect(del).toMatchObject({ status: 200, ok: true, deleted: true, id: customer.id });
    const gone = (await getCustomer(customer.id))!;
    expect(gone).toMatchObject({ id: customer.id, phone: '', addresses: [], favourites: [], marketingConsent: false, tokenVersion: 2, createdAt: customer.id ? expect.any(String) : '' });
    expect(gone.deletedAt).toBeTruthy();
    expect(gone.name).toBeUndefined();
    expect(gone.email).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain('5551234');
    expect((await me(token)).status).toBe(401);
    expect((await read(meDelete(req('/me', { method: 'DELETE', token })) as Promise<Response>)).status).toBe(401);
    expect(await findCustomerByPhone(PHONE)).toBeNull();
    expect(await countCustomers()).toEqual({ total: 0, deleted: 1 });
    const log = await getRepo().listActivity({ kinds: ['customer'] });
    expect(log[0].action).toBe('customer_deleted');
    expect(log[0].summary).not.toContain('5551234');
    const fresh = await signIn();
    expect(fresh.created).toBe(true);
    expect(fresh.customer.id).not.toBe(customer.id);
    expect(fresh.customer.name).toBeUndefined();
    expect(await countCustomers()).toEqual({ total: 1, deleted: 1 });
  });
});

describe('console: Settings → Customers', () => {
  it('lists the count and the latest accounts with the number masked, never a token or a code', async () => {
    vi.stubEnv('DASHBOARD_PASSWORD', 'owner-recovery-password');
    const { customer, token } = await signIn();
    await read(mePatch(req('/me', { method: 'PATCH', token, body: { name: 'Ana Bel', email: 'ana@example.com' } })) as Promise<Response>);
    const basic = `Basic ${Buffer.from('owner:owner-recovery-password').toString('base64')}`;
    const r = await adminGet(new Request('https://hub.example.test/api/foodhub/customers/admin', { headers: { authorization: basic } }), {});
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.count).toEqual({ total: 1, deleted: 0 });
    expect(j.verify).toMatchObject({ ok: true, provider: 'Food Hub SMS code' });
    expect(j.tenants).toEqual([{ slug: 'pppmtl', name: 'PPP Pizzeria' }, { slug: 'on2go', name: 'ON2GO' }]);
    expect(j.recent).toHaveLength(1);
    expect(j.recent[0]).toMatchObject({ id: customer.id, name: 'Ana Bel', lang: 'fr', tenants: ['pppmtl'], addresses: 0, favourites: 0 });
    expect(j.recent[0].phone).toMatch(/^\+1•+1234$/);
    expect(j.recent[0].email).toBe('a…@example.com');
    const text = JSON.stringify(j);
    expect(text).not.toContain('5551234');
    expect(text).not.toContain(lastCode());
    expect(text).not.toContain(token);
    expect(j.activity.map((a: { action: string }) => a.action)).toEqual(['customer_created']);
    expect((await adminGet(new Request('https://hub.example.test/api/foodhub/customers/admin'), {})).status).toBe(401);
  });
});
