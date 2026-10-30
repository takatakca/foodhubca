// on2go.ca's browser-safe customer API (/api/public/on2go/*, lib/foodhub/customers/on2go-public.ts): texted code
// sign-in with the brand website fixed to "on2go", the account read with an on2go-signed token only, logout, delete,
// CORS for the ON2GO sites only, per-IP windows, and the proxy letting the routes through. Twilio is a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as logoutPost } from '../app/api/public/on2go/logout/route';
import { DELETE as meDelete, GET as meGet, OPTIONS as meOptions, PATCH as mePatch } from '../app/api/public/on2go/me/route';
import { POST as checkPost } from '../app/api/public/on2go/verify/check/route';
import { POST as startPost } from '../app/api/public/on2go/verify/start/route';
import { allowOn2go, ON2GO_PUBLIC_LIMITS, resetOn2goPublicLimits } from '../lib/foodhub/customers/on2go-public';
import { findCustomerByPhone, upsertVerifiedCustomer } from '../lib/foodhub/customers/store';
import { signCustomerToken } from '../lib/foodhub/customers/token';
import { resetCustomerVerifyLimits } from '../lib/foodhub/customers/verify';
import { resetThrottle } from '../lib/foodhub/session';

const PHONE = '+15145559900';
const ON2GO = 'https://on2go.ca';
const realFetch = globalThis.fetch;
let texts: string[] = [];

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('SESSION_SECRET', 'on2go-public-test-secret-0123456789-abcdefgh');
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1');
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tw-token');
  vi.stubEnv('TWILIO_FROM', '+15145550000');
  vi.stubEnv('TWILIO_MESSAGING_SERVICE_SID', '');
  vi.stubEnv('TWILIO_VERIFY_SERVICE_SID', '');
  vi.stubEnv('FOODHUB_CUSTOMER_TENANTS', '');
  vi.stubEnv('FOODHUB_LOYALTY_URL', '');
  vi.stubEnv('FOODHUB_GIFTCARDS_URL', '');
  vi.stubEnv('FOODHUB_TRUST_PROXY', '');
  vi.stubEnv('FOODHUB_WEBSITE_ORDER_SECRET', 'never-sent-by-the-browser');
  resetThrottle();
  resetCustomerVerifyLimits();
  resetOn2goPublicLimits();
  texts = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    if (String(url).includes('/Messages.json')) {
      texts.push(new URLSearchParams(String(init.body ?? '')).get('Body') ?? '');
      return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

type Init = { method?: string; body?: unknown; token?: string; origin?: string | null };
const req = (path: string, init: Init = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.origin !== null) headers.origin = init.origin ?? ON2GO;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return new Request(`https://hub.example.test/api/public/on2go${path}`, { method: init.method ?? 'POST', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
};
const read = async (r: Response | Promise<Response>) => { const res = await r; return { status: res.status, cors: res.headers.get('access-control-allow-origin'), ...(await res.json()) } as { status: number; cors: string | null; ok: boolean; [k: string]: any }; };
const lastCode = () => texts.at(-1)!.match(/\d{6}/)![0];

async function signIn() {
  const s = await read(startPost(req('/verify/start', { body: { phone: '514 555 9900', lang: 'fr' } })));
  expect(s.status, s.error).toBe(200);
  const c = await read(checkPost(req('/verify/check', { body: { phone: '514 555 9900', code: lastCode() } })));
  expect(c.status, c.error).toBe(200);
  return c;
}

describe('texted-code sign-in from on2go.ca', () => {
  it('texts an ON2GO code, then creates the customer and signs an on2go token, with CORS for on2go.ca', async () => {
    const s = await read(startPost(req('/verify/start', { body: { phone: '514 555 9900', lang: 'fr' } })));
    expect(s).toMatchObject({ status: 200, ok: true, channel: 'sms', cors: ON2GO });
    expect(texts[0]).toMatch(/ON2GO/);
    const c = await read(checkPost(req('/verify/check', { body: { phone: '514 555 9900', code: lastCode() } })));
    expect(c).toMatchObject({ status: 200, ok: true, created: true, cors: ON2GO, customer: { phone: PHONE } });
    expect(String(c.token)).toMatch(/^cust\.[^.]+\.on2go\./);
    expect((await findCustomerByPhone(PHONE))?.tenants).toEqual(['on2go']);
  });

  it('ignores a tenant in the body: the brand website is always on2go', async () => {
    await read(startPost(req('/verify/start', { body: { phone: '514 555 9900', tenant: 'pppmtl' } })));
    const c = await read(checkPost(req('/verify/check', { body: { phone: '514 555 9900', tenant: 'pppmtl', code: lastCode() } })));
    expect(String(c.token)).toMatch(/\.on2go\./);
  });

  it('refuses a page on another site, a bad number, a wrong code, and a stream of texts from one IP', async () => {
    const evil = await read(startPost(req('/verify/start', { body: { phone: '514 555 9900' }, origin: 'https://evil.example' })));
    expect(evil).toMatchObject({ status: 403, cors: null });
    expect(texts).toHaveLength(0);
    expect((await read(startPost(req('/verify/start', { body: { phone: '123' } })))).status).toBe(422);
    await read(startPost(req('/verify/start', { body: { phone: '514 555 9900' } })));
    const wrong = await read(checkPost(req('/verify/check', { body: { phone: '514 555 9900', code: lastCode() === '000000' ? '111111' : '000000' } })));
    expect(wrong).toMatchObject({ status: 401, ok: false });
    expect(wrong.attemptsLeft).toBeGreaterThan(0);
    resetOn2goPublicLimits();
    for (let i = 0; i < ON2GO_PUBLIC_LIMITS.start.max; i++) expect(allowOn2go('start', '7.7.7.7', 1000).ok).toBe(true);
    expect(allowOn2go('start', '7.7.7.7', 1000).ok).toBe(false);
    expect(allowOn2go('check', '7.7.7.7', 1000).ok).toBe(true);
  });
});

describe('Mon compte from on2go.ca', () => {
  it('reads, updates and signs out with the on2go token in Authorization', async () => {
    const { token } = await signIn();
    const me = await read(meGet(req('/me', { method: 'GET', token })));
    expect(me).toMatchObject({ status: 200, ok: true, cors: ON2GO, customer: { phone: PHONE }, addresses: [], favourites: [], orders: [] });
    const patched = await read(mePatch(req('/me', { method: 'PATCH', token, body: { name: 'Léa Roy', marketingConsent: true } })));
    expect(patched).toMatchObject({ status: 200, customer: { name: 'Léa Roy', marketingConsent: true } });
    expect((await read(logoutPost(req('/logout', { token })))).status).toBe(200);
    expect((await read(meGet(req('/me', { method: 'GET', token })))).status).toBe(401);
  });

  it('refuses no token, a token of another brand website, and another site’s page; DELETE anonymises', async () => {
    expect((await read(meGet(req('/me', { method: 'GET' })))).status).toBe(401);
    const { customer } = await upsertVerifiedCustomer({ phone: PHONE, tenant: 'pppmtl' });
    const ppp = await signCustomerToken(customer, 'pppmtl');
    expect((await read(meGet(req('/me', { method: 'GET', token: ppp.token })))).status).toBe(403);
    const { token } = await signIn();
    expect((await read(meGet(req('/me', { method: 'GET', token, origin: 'https://evil.example' })))).status).toBe(403);
    const gone = await read(meDelete(req('/me', { method: 'DELETE', token })));
    expect(gone).toMatchObject({ status: 200, deleted: true });
    expect(await findCustomerByPhone(PHONE)).toBeNull();
  });

  it('the preflight names only the ON2GO sites and allows the Authorization header', async () => {
    const ok = await meOptions(new Request('https://hub.example.test/api/public/on2go/me', { method: 'OPTIONS', headers: { origin: 'https://www.on2go.ca' } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://www.on2go.ca');
    expect(ok.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    const evil = await meOptions(new Request('https://hub.example.test/api/public/on2go/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the proxy lets the four routes through without a console session', async () => {
    const { proxy } = await import('../proxy');
    const { NextRequest } = await import('next/server');
    vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-123');
    for (const p of ['/verify/start', '/verify/check', '/me', '/logout']) {
      const res = await proxy(new NextRequest(`https://hub.example.test/api/public/on2go${p}`, { method: 'POST' }));
      expect(res.headers.get('x-middleware-next'), p).toBe('1');
    }
  });
});
