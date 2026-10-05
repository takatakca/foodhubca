// Final — sign-in gate, sessions, brute-force protection (auth-gate fix group).
import { beforeEach, describe, expect, it } from 'vitest';
import { errorResponse, getActor, hashPassword, isSystemError, signIn, UserError, withPerm } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import {
  basicOwner, clearFailures, clientIp, decodeBasic, isLocked, ownerSessionVersion, readCookie, recordFailure, resetThrottle, safeEqual,
  SESSION_COOKIE, sessionKey, sessionVersion, signSession, throttleKey, verifySession,
} from '../lib/foodhub/session';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const req = (headers: Record<string, string> = {}) => new Request('http://hub.local/api/foodhub/x', { headers });
const cookieFor = (token: string) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` });

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  delete process.env.SESSION_SECRET;
  resetThrottle();
});

describe('session key and versions', () => {
  it('derives the HMAC key from DASHBOARD_PASSWORD with scrypt (never the raw password) and caches it', async () => {
    const t0 = Date.now();
    const key1 = await sessionKey();
    const first = Date.now() - t0;
    const t1 = Date.now();
    const key2 = await sessionKey();
    const second = Date.now() - t1;
    expect(key1).not.toBeNull();
    expect(key2).not.toBeNull();
    expect(second).toBeLessThanOrEqual(Math.max(first, 5)); // cached: no second scrypt
    // A token signed with the raw password as HMAC key must NOT verify.
    const enc = new TextEncoder();
    const raw = await crypto.subtle.importKey('raw', enc.encode(`takatak-session|${process.env.DASHBOARD_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const body = Buffer.from(JSON.stringify({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + 60, b: true })).toString('base64url');
    const sig = Buffer.from(await crypto.subtle.sign('HMAC', raw, enc.encode(body))).toString('base64url');
    expect(await verifySession(`${body}.${sig}`)).toBeNull();
  });
  it('SESSION_SECRET wins over the password-derived key', async () => {
    const t = await signSession({ u: 'x', n: 'x', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + 60, v: 'abc' });
    process.env.SESSION_SECRET = 'a-real-secret';
    expect(await verifySession(t)).toBeNull();
    expect((await verifySession(await signSession({ u: 'y', n: 'y', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + 60 })))?.u).toBe('y');
  });
  it('session versions follow the secret behind them', () => {
    expect(sessionVersion('scrypt$a$b')).toMatch(/^[0-9a-f]{12}$/);
    expect(sessionVersion('scrypt$a$b')).not.toBe(sessionVersion('scrypt$a$c'));
    expect(ownerSessionVersion()).toBe(sessionVersion('Owner-pass-123'));
    process.env.DASHBOARD_PASSWORD = '';
    expect(ownerSessionVersion()).toBe('');
  });
});

describe('readCookie / decodeBasic / safeEqual', () => {
  it('returns null for a malformed percent-encoded cookie instead of throwing', () => {
    expect(readCookie(`${SESSION_COOKIE}=%E0%A4%A`)).toBeNull();
    expect(readCookie(`a=1; ${SESSION_COOKIE}=abc%2Edef; b=2`)).toBe('abc.def');
    expect(readCookie(null)).toBeNull();
  });
  it('decodes Basic headers and compares passwords in constant time', () => {
    expect(decodeBasic(basic('sara', 'p:w'))).toEqual({ username: 'sara', password: 'p:w' });
    expect(decodeBasic('Bearer x')).toBeNull();
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual('x', undefined)).toBe(false);
  });
  it('clientIp takes the first x-forwarded-for value, else "local"', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBe('local');
  });
});

describe('throttle', () => {
  it('locks after 5 failures for 60 s, doubles up to 15 min, keyed by IP + username', () => {
    const k = throttleKey('1.1.1.1', 'Owner ');
    expect(k).toBe('1.1.1.1|owner');
    for (let i = 0; i < 4; i++) recordFailure(k);
    expect(isLocked(k)).toBe(false);
    recordFailure(k);
    expect(isLocked(k)).toBe(true);
    expect(isLocked(throttleKey('2.2.2.2', 'owner'))).toBe(false); // another IP is not locked out
    clearFailures(k);
    expect(isLocked(k)).toBe(false);
  });
  it('prunes the map above 1000 entries (expired first)', () => {
    for (let i = 0; i < 1200; i++) recordFailure(`ip${i}|u`);
    recordFailure('fresh|u');
    // the map never holds more than ~1000 keys; the newest key survives
    expect(isLocked('fresh|u')).toBe(false);
    for (let i = 0; i < 5; i++) recordFailure('fresh|u');
    expect(isLocked('fresh|u')).toBe(true);
  });
});

describe('basicOwner', () => {
  it('accepts the owner password, refuses others, and throttles per IP when given one', () => {
    expect(basicOwner(basic('owner', 'Owner-pass-123'))).toBe(true);
    expect(basicOwner(basic('owner', 'nope'))).toBe(false);
    expect(basicOwner('Basic Og==')).toBe(false);
    for (let i = 0; i < 5; i++) expect(basicOwner(basic('owner', 'nope'), '9.9.9.9')).toBe(false);
    expect(basicOwner(basic('owner', 'Owner-pass-123'), '9.9.9.9')).toBe(false); // locked: the right password is not even compared
    expect(basicOwner(basic('owner', 'Owner-pass-123'), '8.8.8.8')).toBe(true); // other clients unaffected
    expect(basicOwner(basic('owner', 'Owner-pass-123'))).toBe(true);
  });
  it('is always false without a password', () => {
    process.env.DASHBOARD_PASSWORD = '';
    expect(basicOwner(basic('owner', ''))).toBe(false);
  });
});

describe('signIn', () => {
  it('owner signs in with a versioned cookie; wrong passwords count per IP, not per username', async () => {
    const ok = await signIn('owner', 'Owner-pass-123', '1.2.3.4');
    expect('cookie' in ok && ok.cookie).toMatch(/^takatak_session=.*HttpOnly/);
    const payload = await verifySession(decodeURIComponent(('cookie' in ok ? ok.cookie : '').split(';')[0].split('=')[1]));
    expect(payload?.b).toBe(true);
    expect(payload?.v).toBe(ownerSessionVersion());
    for (let i = 0; i < 5; i++) expect((await signIn('owner', 'wrong', '6.6.6.6') as { status: number }).status).toBe(401);
    expect((await signIn('owner', 'Owner-pass-123', '6.6.6.6') as { status: number }).status).toBe(429);
    expect('user' in (await signIn('owner', 'Owner-pass-123', '1.2.3.4'))).toBe(true); // the owner is not locked out from elsewhere
  });
});

describe('getActor', () => {
  beforeEach(async () => {
    await getRepo().saveUser({ username: 'sara', name: 'Sara', role: 'operator', locations: ['HOCHELAGA'], passwordHash: hashPassword('operator-pass-1'), active: true });
  });
  it('rejects cookies without a version, with a stale owner version, or a stale staff version', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const legacy = await signSession({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp, b: true });
    expect(await getActor(req(cookieFor(legacy)))).toBeNull();
    const owner = await signSession({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp, b: true, v: ownerSessionVersion() });
    expect((await getActor(req(cookieFor(owner))))?.role).toBe('owner');
    const forged = await signSession({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp, b: true, v: 'deadbeef0000' });
    expect(await getActor(req(cookieFor(forged)))).toBeNull();
    const sara = await signIn('sara', 'operator-pass-1', '1.1.1.1');
    const saraCookie = 'cookie' in sara ? decodeURIComponent(sara.cookie.split(';')[0].split('=')[1]) : '';
    expect((await getActor(req(cookieFor(saraCookie))))?.username).toBe('sara');
    // password reset → old cookie dies at once
    const stored = (await getRepo().getUser('sara'))!;
    await getRepo().saveUser({ ...stored, passwordHash: hashPassword('new-pass-999') });
    expect(await getActor(req(cookieFor(saraCookie)))).toBeNull();
    expect('user' in (await signIn('sara', 'new-pass-999', '1.1.1.1'))).toBe(true);
  });
  it('rotating DASHBOARD_PASSWORD with SESSION_SECRET set signs the owner out', async () => {
    process.env.SESSION_SECRET = 'stable-secret';
    const ok = await signIn('owner', 'Owner-pass-123', '1.1.1.1');
    const token = 'cookie' in ok ? decodeURIComponent(ok.cookie.split(';')[0].split('=')[1]) : '';
    expect((await getActor(req(cookieFor(token))))?.role).toBe('owner');
    process.env.DASHBOARD_PASSWORD = 'Rotated-pass-456';
    expect(await verifySession(token)).not.toBeNull(); // signature still fine…
    expect(await getActor(req(cookieFor(token)))).toBeNull(); // …but the version no longer matches
  });
  it('Basic auth: owner, team member, throttle and one activity-log line per minute per IP', async () => {
    expect((await getActor(req({ authorization: basic('owner', 'Owner-pass-123') })))?.role).toBe('owner');
    const sara = await getActor(req({ authorization: basic('sara', 'operator-pass-1') }));
    expect(sara?.username).toBe('sara');
    expect(sara?.source).toBe('api');
    const before = (await getRepo().listActivity({ limit: 500 })).filter((e) => e.kind === 'login' && e.status === 'failed').length;
    const h = { authorization: basic('sara', 'bad-pass'), 'x-forwarded-for': '7.7.7.7' };
    for (let i = 0; i < 5; i++) expect(await getActor(req(h))).toBeNull();
    expect(await getActor(req({ ...h, authorization: basic('sara', 'operator-pass-1') }))).toBeNull(); // locked for that IP + user
    expect((await getActor(req({ authorization: basic('sara', 'operator-pass-1'), 'x-forwarded-for': '7.7.7.8' })))?.username).toBe('sara');
    const failed = (await getRepo().listActivity({ limit: 500 })).filter((e) => e.kind === 'login' && e.status === 'failed');
    expect(failed.length - before).toBe(1);
    expect(JSON.stringify(failed)).not.toContain('bad-pass');
    expect(failed[failed.length - 1].source).toBe('api');
    // the Basic path also refuses a locked IP+username before comparing the owner password
    const ownerHeaders = { authorization: basic('owner', 'nope'), 'x-forwarded-for': '5.5.5.5' };
    for (let i = 0; i < 5; i++) await getActor(req(ownerHeaders));
    expect(await getActor(req({ authorization: basic('owner', 'Owner-pass-123'), 'x-forwarded-for': '5.5.5.5' }))).toBeNull();
    expect((await getActor(req({ authorization: basic('owner', 'Owner-pass-123') })))?.role).toBe('owner');
  });
  it('open dev mode (no password, no secret) is the owner', async () => {
    process.env.DASHBOARD_PASSWORD = '';
    expect((await getActor(req()))?.role).toBe('owner');
  });
});

describe('withPerm error handling', () => {
  it('keeps validation messages (400) and hides infrastructure errors (500)', async () => {
    expect(isSystemError(new Error('Date must be YYYY-MM-DD.'))).toBe(false);
    expect(isSystemError(new UserError('Pick a brand.'))).toBe(false);
    expect(isSystemError(new Error('Supabase: relation "foodhub_orders" does not exist'))).toBe(true);
    expect(isSystemError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(true);
    expect(isSystemError(new Error('fetch failed'))).toBe(true);
    expect(isSystemError('boom')).toBe(true);
    const r400 = errorResponse(new Error('Enter the amount that reached the bank.'));
    expect(r400.status).toBe(400);
    expect((await r400.json()).error).toBe('Enter the amount that reached the bank.');
    const r500 = errorResponse(new Error('Supabase: permission denied for table x'));
    expect(r500.status).toBe(500);
    expect((await r500.json()).error).toBe('Something went wrong — see the server log.');
    const route = withPerm('view', async () => { throw new Error('Supabase: PGRST301 JWT expired'); });
    const res = await route(req({ authorization: basic('owner', 'Owner-pass-123') }), {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('PGRST');
    const denied = await withPerm('admin', async () => new Response('x'))(req(), {});
    expect(denied.status).toBe(401);
  });
});
