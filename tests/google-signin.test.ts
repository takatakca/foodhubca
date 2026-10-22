// "Continue with Google": start URL + state cookie, id_token checks against a fake JWKS, team-only sign-in.
import crypto from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginView } from '@/app/login/login-view';
import {
  beginGoogleSignIn, decodeState, encodeState, finishGoogleSignIn, GOOGLE_JWKS_URL, GOOGLE_STATE_COOKIE, GOOGLE_TOKEN_URL, googleRedirectUri, googleSignInEnabled,
  resetGoogleJwksCache, verifyGoogleIdToken,
} from '@/lib/foodhub/identity/google';
import { getRepo } from '@/lib/foodhub/repo';
import { readCookie, resetThrottle, SESSION_COOKIE, verifySession } from '@/lib/foodhub/session';
import type { FoodHubUser } from '@/lib/foodhub/types';

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function idToken(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: crypto.KeyObject } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '10769150350006150715113082367', iat: now, exp: now + 3600, email_verified: true, ...claims });
  const head = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'kid-1', typ: 'JWT' });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** Fake Google: the JWKS, and a token endpoint that answers with the id_token the test chose. */
let tokenCalls: URLSearchParams[] = [];
function fakeGoogle(answer: () => { status?: number; body: Record<string, unknown> }) {
  tokenCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [JWK] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u === GOOGLE_TOKEN_URL) {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      const a = answer();
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
}

async function seedTeam() {
  await getRepo().saveUser({ username: 'sara', name: 'Sara T', role: 'manager', locations: ['NDG_MAIN'], email: 'Sara@Example.com', active: true, prefs: { lang: 'en' } } as unknown as FoodHubUser);
  await getRepo().saveUser({ username: 'gone', name: 'Gone', role: 'operator', locations: [], email: 'gone@example.com', active: false } as unknown as FoodHubUser);
}

/** The refusal reason, or "ok" when the person was signed in (narrows the union for one-line expects). */
const reasonOf = (r: Awaited<ReturnType<typeof finishGoogleSignIn>>) => (r.ok ? 'ok' : r.reason);

/** Plays the browser: /start gives the cookie, Google would come back with ?code&state. */
function startAndCookie(next = '/orders') {
  const { url, cookie } = beginGoogleSignIn({ next, lang: 'fr' });
  const u = new URL(url);
  const raw = readCookie(cookie.split(';')[0], GOOGLE_STATE_COOKIE);
  return { u, raw: raw!, state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!, saved: decodeState(raw)! };
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubEnv('FOODHUB_PUBLIC_URL', 'https://foodhub.example');
  vi.stubEnv('SESSION_SECRET', 'google-test-secret-0123456789-abcdefghijklmnop');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'not-a-real-secret');
  vi.stubEnv('FOODHUB_TRUST_PROXY', '');
  resetThrottle();
  resetGoogleJwksCache();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('start: Google authorization URL + one-shot cookie', () => {
  it('is off until GOOGLE_OAUTH_CLIENT_ID is set, and the button follows', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '  ');
    expect(googleSignInEnabled()).toBe(false);
    expect(() => beginGoogleSignIn()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    const off = renderToStaticMarkup(createElement(LoginView, { next: '/', error: null, firstRun: false, recovery: true, needsKey: false, googleEnabled: false }));
    expect(off).not.toContain('/api/auth/google/start');
    expect(off).toContain('Recevoir mon code');
    expect(off).toContain('Connexion de secours');
    const on = renderToStaticMarkup(createElement(LoginView, { next: '/orders', error: null, firstRun: false, recovery: true, needsKey: false, googleEnabled: true }));
    expect(on).toContain('href="/api/auth/google/start?next=%2Forders&amp;lang=fr"');
    expect(on).toContain('Continuer avec Google');
    const refused = renderToStaticMarkup(createElement(LoginView, { next: '/', error: null, firstRun: false, recovery: false, needsKey: false, googleEnabled: true, google: 'not_on_team' }));
    expect(refused).toContain('n’est pas encore dans une équipe Food Hub');
  });

  it('asks Google for openid email profile with state, nonce and S256 PKCE, and keeps them in an httpOnly Lax cookie', () => {
    const { u, saved, state, nonce, raw } = startAndCookie('/orders?tab=live');
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('https://foodhub.example/api/auth/google/callback');
    expect(googleRedirectUri()).toBe('https://foodhub.example/api/auth/google/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(saved.verifier).digest('base64url'));
    expect(saved.state).toBe(state);
    expect(saved.nonce).toBe(nonce);
    expect(saved.next).toBe('/orders?tab=live');
    expect(saved.verifier.length).toBeGreaterThanOrEqual(43);
    const { cookie } = beginGoogleSignIn();
    expect(cookie).toMatch(/^takatak_google=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/api/auth/google');
    expect(cookie).toMatch(/Max-Age=600/);
    expect(decodeState(raw)).not.toBeNull();
    expect(decodeState('not-base64-json')).toBeNull();
    expect(decodeState(encodeState({ ...saved, exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull(); // expired
    expect(decodeState(encodeState({ ...saved, next: 'https://evil.example' }))!.next).toBe('/'); // next stays on this site
  });
});

describe('id_token verification against the (fake) JWKS', () => {
  beforeEach(() => fakeGoogle(() => ({ body: {} })));

  it('accepts a well-signed token for this client with the expected nonce', async () => {
    const r = await verifyGoogleIdToken(idToken({ nonce: 'n1', email: 'sara@example.com' }), { clientId: CLIENT_ID, nonce: 'n1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.email).toBe('sara@example.com');
    // the JWKS is cached: a second token costs no second fetch
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect((await verifyGoogleIdToken(idToken({ nonce: 'n2' }), { clientId: CLIENT_ID, nonce: 'n2' })).ok).toBe(true);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it('refuses a bad signature, another issuer, another audience, an expired token, a nonce mismatch and "alg: none"', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const cases: Array<[string, RegExp]> = [
      [idToken({ nonce: 'n' }, { key: other }), /signature/],
      [idToken({ nonce: 'n' }, { kid: 'kid-9' }), /unknown key/],
      [idToken({ nonce: 'n', iss: 'https://accounts.example.com' }), /issuer/],
      [idToken({ nonce: 'n', aud: 'someone-else.apps.googleusercontent.com' }), /audience/],
      [idToken({ nonce: 'n', exp: Math.floor(Date.now() / 1000) - 3600 }), /expired/],
      [idToken({ nonce: 'other' }), /nonce/],
      [idToken({}), /nonce/],
      [`${b64({ alg: 'none', kid: 'kid-1' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', exp: 9999999999, nonce: 'n' })}.`, /alg none/],
      ['garbage', /malformed/],
    ];
    for (const [tok, why] of cases) {
      const r = await verifyGoogleIdToken(tok, { clientId: CLIENT_ID, nonce: 'n' });
      expect(r.ok, String(why)).toBe(false);
      if (!r.ok) expect(r.error, String(why)).toMatch(why);
    }
  });
});

describe('callback: only a known, verified team email signs in', () => {
  beforeEach(seedTeam);

  it('signs in a team member (same session cookie, role and locations as the code sign-in) and sends the PKCE verifier to Google', async () => {
    const { raw, state, nonce, saved } = startAndCookie('/orders');
    fakeGoogle(() => ({ body: { id_token: idToken({ nonce, email: 'sara@example.com', name: 'Sara' }), access_token: 'x', token_type: 'Bearer' } }));
    const r = await finishGoogleSignIn({ code: 'code-1', state, cookie: raw, ip: '203.0.113.5' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.username).toBe('sara');
    expect(r.next).toBe('/orders');
    expect(r.lang).toBe('en'); // her own preference wins over the page language
    expect(tokenCalls[0].get('code_verifier')).toBe(saved.verifier);
    expect(tokenCalls[0].get('code')).toBe('code-1');
    expect(tokenCalls[0].get('redirect_uri')).toBe('https://foodhub.example/api/auth/google/callback');
    expect(tokenCalls[0].get('client_secret')).toBe('not-a-real-secret');
    const { sessionCookieFor } = await import('@/lib/foodhub/auth');
    const cookie = await sessionCookieFor(r.user, 'google');
    const payload = await verifySession(readCookie(cookie.split(';')[0], SESSION_COOKIE));
    expect(payload).toMatchObject({ u: 'sara', r: 'manager', l: ['NDG_MAIN'], k: 'google' });
    expect(cookie).toContain('HttpOnly');
    const log = await getRepo().listActivity({ limit: 5 });
    expect(log.some((e) => e.action === 'sign_in_google' && e.status === 'success' && e.actor === 'Sara T')).toBe(true);
    expect((await getRepo().getUser('sara'))?.lastLoginAt).toBeTruthy();
  });

  it('refuses an email that is not on the team, a deactivated member and an unverified email — never creates anyone', async () => {
    const before = (await getRepo().listUsers()).length;
    for (const [claims, why] of [
      [{ email: 'stranger@gmail.com' }, 'unknown'],
      [{ email: 'gone@example.com' }, 'deactivated'],
      [{ email: 'sara@example.com', email_verified: false }, 'unverified'],
      [{ email: 'sara@example.com', email_verified: undefined }, 'unverified'],
      [{}, 'unverified'],
    ] as Array<[Record<string, unknown>, string]>) {
      const { raw, state, nonce } = startAndCookie();
      fakeGoogle(() => ({ body: { id_token: idToken({ nonce, ...claims }) } }));
      const r = await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.6' });
      expect(r.ok, why).toBe(false);
      if (!r.ok) expect(r.reason, why).toBe(why === 'unverified' ? 'unverified' : 'not_on_team'); // and the page says why, in FR or EN
    }
    expect((await getRepo().listUsers()).length).toBe(before);
    const log = await getRepo().listActivity({ limit: 10 });
    expect(log.filter((e) => e.action === 'sign_in_google' && e.status === 'failed').length).toBeGreaterThanOrEqual(5);
    expect(log.some((e) => e.summary.includes('stranger@gmail.com'))).toBe(false); // masked in the log
  });

  it('refuses a state mismatch, a missing cookie, a forged cookie and a nonce mismatch, without ever calling Google for the first three', async () => {
    const { raw, state, nonce } = startAndCookie();
    fakeGoogle(() => ({ body: { id_token: idToken({ nonce, email: 'sara@example.com' }) } }));
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state: 'another-state', cookie: raw, ip: '203.0.113.7' }))).toBe('state');
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: null, ip: '203.0.113.7' }))).toBe('state');
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: 'forged', ip: '203.0.113.7' }))).toBe('state');
    expect(reasonOf(await finishGoogleSignIn({ code: '', state, cookie: raw, ip: '203.0.113.7' }))).toBe('state');
    expect(tokenCalls.length).toBe(0);
    // Google answers a token whose nonce is not the one this browser started with (replayed from another session)
    fakeGoogle(() => ({ body: { id_token: idToken({ nonce: 'someone-elses-nonce', email: 'sara@example.com' }) } }));
    const r = await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.7' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('state');
    expect(tokenCalls.length).toBe(1);
    // Google itself refusing (user cancelled) or the exchange failing is a soft "try again", never a sign-in
    expect(reasonOf(await finishGoogleSignIn({ code: '', state: '', cookie: raw, ip: '203.0.113.8', googleError: 'access_denied' }))).toBe('google');
    fakeGoogle(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.8' }))).toBe('google');
  });

  it('locks the client address after repeated bad callbacks, like the other sign-ins', async () => {
    const { raw, state, nonce } = startAndCookie();
    fakeGoogle(() => ({ body: { id_token: idToken({ nonce, email: 'nobody@example.com' }) } }));
    for (let i = 0; i < 5; i++) expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.9' }))).toBe('not_on_team');
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.9' }))).toBe('locked');
    fakeGoogle(() => ({ body: { id_token: idToken({ nonce, email: 'sara@example.com' }) } }));
    expect((await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.9' })).ok).toBe(false); // still locked
    expect((await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.10' })).ok).toBe(true); // another address is fine
  });

  it('is fully off without the client secret', async () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    const { raw, state } = startAndCookie();
    expect(reasonOf(await finishGoogleSignIn({ code: 'c', state, cookie: raw, ip: '203.0.113.11' }))).toBe('disabled');
  });
});
