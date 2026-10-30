// ON2GO sign-in through TAKATAK (lib/foodhub/customers/takatak-bridge.ts): the launch code is exchanged with
// takatak-v1 (a fake fetch here: nothing leaves the test), the customer is keyed on the verified phone, and the
// public route answers the ON2GO sites only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPTIONS, POST } from '../app/api/public/on2go/session/route';
import { findCustomerByPhone, getCustomer } from '../lib/foodhub/customers/store';
import {
  allowBridgeAttempt,
  BRIDGE_IP_LIMIT,
  exchangeLaunchCode,
  parseTakatakSession,
  resetBridgeLimits,
  signInWithTakatak,
  takatakBridgeConfig,
  TAKATAK_EXCHANGE_PATH,
} from '../lib/foodhub/customers/takatak-bridge';
import { resolveCustomerToken } from '../lib/foodhub/customers/token';

const CODE = 'a'.repeat(43);
const TOKEN = 'on2go-service-token-0123456789-abcdefghij';
const IDENTITY = '5f0c2a8e-1d2b-4c3d-8e9f-0a1b2c3d4e5f';
const PHONE = '+15145557788';
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; auth: string; body: string }> = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

const session = (over: Record<string, unknown> = {}) => ({
  ok: true,
  session: { active: true, identityId: IDENTITY, displayName: 'Marie Tremblay', phone: PHONE, email: 'marie@example.com', locale: 'fr-CA', product: 'on2go', entitlement: 'on2go_customer', expiresAt: '2026-10-30T12:10:00.000Z', ...over },
});

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('SESSION_SECRET', 'bridge-test-secret-0123456789-abcdefghijklmnop');
  vi.stubEnv('TAKATAK_API_URL', 'https://takatak.example.test/');
  vi.stubEnv('TAKATAK_ON2GO_SERVICE_TOKEN', TOKEN);
  vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', '');
  resetBridgeLimits();
  calls = [];
  answer = { status: 200, body: session() };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>)?.authorization ?? ''), body: String(init?.body ?? '') });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe('configuration', () => {
  it('needs an https TAKATAK URL and a 32+ character service token', () => {
    expect(takatakBridgeConfig({ TAKATAK_API_URL: 'https://t.example/', TAKATAK_ON2GO_SERVICE_TOKEN: TOKEN } as NodeJS.ProcessEnv)).toEqual({ ok: true, config: { baseUrl: 'https://t.example', serviceToken: TOKEN } });
    expect(takatakBridgeConfig({ TAKATAK_API_URL: 'http://t.example', TAKATAK_ON2GO_SERVICE_TOKEN: TOKEN } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(takatakBridgeConfig({ TAKATAK_API_URL: 'http://localhost:3000', TAKATAK_ON2GO_SERVICE_TOKEN: TOKEN, NODE_ENV: 'development' } as NodeJS.ProcessEnv).ok).toBe(true);
    expect(takatakBridgeConfig({ TAKATAK_API_URL: 'http://localhost:3000', TAKATAK_ON2GO_SERVICE_TOKEN: TOKEN, NODE_ENV: 'production' } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(takatakBridgeConfig({ TAKATAK_API_URL: 'https://t.example', TAKATAK_ON2GO_SERVICE_TOKEN: 'short' } as NodeJS.ProcessEnv).ok).toBe(false);
  });
});

describe('the TAKATAK session answer', () => {
  it('is checked field by field; a phone is normalised, anything odd is refused', () => {
    expect(parseTakatakSession(session())).toMatchObject({ identityId: IDENTITY, phone: PHONE, displayName: 'Marie Tremblay' });
    expect(parseTakatakSession(session({ phone: '(514) 555-7788' }))?.phone).toBe(PHONE);
    expect(parseTakatakSession(session({ phone: null }))?.phone).toBeNull();
    expect(parseTakatakSession(session({ product: 'ahmv' }))).toBeNull();
    expect(parseTakatakSession(session({ active: false }))).toBeNull();
    expect(parseTakatakSession(session({ identityId: 'not-a-uuid' }))).toBeNull();
    expect(parseTakatakSession({ ok: false })).toBeNull();
    expect(parseTakatakSession(null)).toBeNull();
  });

  it('the exchange sends the code with the service token; a refused code is 401, TAKATAK down is 503', async () => {
    const ok = await exchangeLaunchCode(CODE);
    expect(ok.ok).toBe(true);
    expect(calls[0]).toEqual({ url: `https://takatak.example.test${TAKATAK_EXCHANGE_PATH}`, auth: `Bearer ${TOKEN}`, body: JSON.stringify({ code: CODE }) });
    answer = { status: 403, body: { ok: false } };
    expect(await exchangeLaunchCode(CODE)).toMatchObject({ ok: false, status: 401 });
    answer = { status: 502, body: {} };
    expect(await exchangeLaunchCode(CODE)).toMatchObject({ ok: false, status: 503 });
    expect(await exchangeLaunchCode(CODE, { fetch: (async () => { throw new Error('down'); }) as typeof fetch })).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv('TAKATAK_ON2GO_SERVICE_TOKEN', '');
    expect(await exchangeLaunchCode(CODE)).toMatchObject({ ok: false, status: 503 });
  });
});

describe('signing in with TAKATAK', () => {
  it('creates the customer on the verified phone, links the TAKATAK identity, and signs an "on2go" token', async () => {
    const r = await signInWithTakatak({ code: CODE }, '1.1.1.1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.customer).toMatchObject({ phone: PHONE, name: 'Marie Tremblay', email: 'marie@example.com', lang: 'fr' });
    const stored = await findCustomerByPhone(PHONE);
    expect(stored?.takatakIdentityId).toBe(IDENTITY);
    expect(stored?.tenants).toEqual(['on2go']);
    const resolved = await resolveCustomerToken(r.token, { tenant: 'on2go' });
    expect(resolved.ok && resolved.customer.id).toBe(stored?.id);
  });

  it('reuses the record a texted-code sign-in made on the same phone (one customer per verified phone)', async () => {
    const first = await signInWithTakatak({ code: CODE }, '1.1.1.1');
    answer = { status: 200, body: session({ displayName: 'Autre Nom', email: 'autre@example.com' }) };
    const second = await signInWithTakatak({ code: 'b'.repeat(43) }, '1.1.1.1');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.created).toBe(false);
    expect(second.customer.id).toBe(first.customer.id);
    expect((await getCustomer(first.customer.id))?.name).toBe('Marie Tremblay'); // a name already there is never replaced
  });

  it('refuses a bad code shape, an account without a verified phone, and a stream of attempts', async () => {
    expect(await signInWithTakatak({ code: 'short' }, '2.2.2.2')).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
    answer = { status: 200, body: session({ phone: null }) };
    expect(await signInWithTakatak({ code: CODE }, '2.2.2.2')).toMatchObject({ ok: false, status: 409 });
    resetBridgeLimits();
    for (let i = 0; i < BRIDGE_IP_LIMIT.max; i++) expect(allowBridgeAttempt('3.3.3.3', 1000).ok).toBe(true);
    expect(allowBridgeAttempt('3.3.3.3', 1000)).toMatchObject({ ok: false });
    expect(allowBridgeAttempt('4.4.4.4', 1000).ok).toBe(true);
    expect(allowBridgeAttempt('3.3.3.3', 1000 + BRIDGE_IP_LIMIT.windowMs + 1).ok).toBe(true);
  });
});

describe('POST /api/public/on2go/session', () => {
  const req = (origin: string | null, body: unknown = { code: CODE }) => new Request('https://hub.example.test/api/public/on2go/session', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(body),
  });

  it('answers on2go.ca with CORS and the token; another site is refused; the preflight only names ON2GO', async () => {
    const ok = await POST(req('https://on2go.ca'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const json = await ok.json();
    expect(json).toMatchObject({ ok: true, customer: { phone: PHONE } });
    expect(String(json.token)).toMatch(/^cust\./);

    const evil = await POST(req('https://evil.example'));
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const pre = await OPTIONS(new Request('https://hub.example.test/api/public/on2go/session', { method: 'OPTIONS', headers: { origin: 'https://www.on2go.ca' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://www.on2go.ca');
    const preEvil = await OPTIONS(new Request('https://hub.example.test/api/public/on2go/session', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(preEvil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a refused code is 401 with a customer-readable message; the proxy lets the route through', async () => {
    answer = { status: 403, body: { ok: false } };
    const res = await POST(req('https://on2go.ca'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/expired|already used/);
    const { proxy } = await import('../proxy');
    const { NextRequest } = await import('next/server');
    vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-123');
    expect((await proxy(new NextRequest('https://hub.example.test/api/public/on2go/session', { method: 'POST' }))).headers.get('x-middleware-next')).toBe('1');
  });
});
