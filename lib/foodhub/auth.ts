// Sign-in, users and permissions for route handlers.
//  - Built-in owner: username "owner" + DASHBOARD_PASSWORD (cannot be locked out by username alone:
//    the throttle is keyed by client IP + username).
//  - Team members: Food Hub → Users (scrypt-hashed passwords, roles, location scope).
//  - Every request is re-checked against the user record, so deactivating someone takes effect at once;
//    the cookie carries a session version, so resetting a password signs that person's devices out too.
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { logActivity, type Actor } from './activity';
import { fail } from './http';
import { getRepo } from './repo';
import {
  basicOwner, can, clearFailures, clientIp, decodeBasic, isLocked, ownerSessionVersion, readCookie, recordFailure, safeEqual,
  SESSION_COOKIE, SESSION_DAYS, sessionVersion, signSession, throttleKey, verifySession, type Permission,
} from './session';
import type { FoodHubUser, Role } from './types';

export interface AuthUser extends Actor {
  role: Role;
  /** [] = all locations */
  locations: string[];
}

const OWNER: AuthUser = { username: 'owner', name: 'Owner', role: 'owner', locations: [], source: 'dashboard' };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export function passwordProblem(password: string): string | null {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

function toAuthUser(u: FoodHubUser): AuthUser {
  return { username: u.username, name: u.name, role: u.role, locations: u.locations ?? [], source: 'dashboard' };
}

// Failed Basic attempts go to the activity log at most once per minute per IP (never the password).
const basicLogged = new Map<string, number>();
async function logBasicFailure(ip: string, username: string): Promise<void> {
  const now = Date.now();
  const last = basicLogged.get(ip) ?? 0;
  if (now - last < 60_000) return;
  if (basicLogged.size > 1000) for (const [k, t] of basicLogged) if (now - t >= 60_000) basicLogged.delete(k);
  basicLogged.set(ip, now);
  await logActivity({ actor: username || 'owner', source: 'api', kind: 'login', action: 'sign_in', status: 'failed', summary: `Failed Basic-auth sign-in for ${username || 'owner'} from ${ip}` });
}

/** Who is calling. Null = not signed in (also when the IP+username is locked after repeated failures). */
export async function getActor(req: Request): Promise<AuthUser | null> {
  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) {
    // Open local/dev mode (proxy.ts refuses live mode without a password).
    return OWNER;
  }
  const auth = req.headers.get('authorization');
  const basic = decodeBasic(auth);
  if (basic) {
    const ip = clientIp(req.headers);
    const key = throttleKey(ip, basic.username);
    if (isLocked(key)) return null;
    if (basicOwner(auth)) { clearFailures(key); return OWNER; }
    try {
      const user = await getRepo().getUser(basic.username);
      if (user?.active && verifyPassword(basic.password, user.passwordHash)) { clearFailures(key); return { ...toAuthUser(user), source: 'api' }; }
    } catch { /* fall through */ }
    recordFailure(key);
    await logBasicFailure(ip, basic.username);
    return null;
  }
  const session = await verifySession(readCookie(req.headers.get('cookie')));
  if (!session?.v) return null; // cookies from before session versions are signed out once
  if (session.b) return session.v === ownerSessionVersion() ? { ...OWNER, name: session.n || OWNER.name } : null;
  const user = await getRepo().getUser(session.u);
  return user?.active && session.v === sessionVersion(user.passwordHash) ? toAuthUser(user) : null;
}

/**
 * Server-rendered pages: resolve the signed-in person (DB check for active + session version) or send them
 * to /login?next=…; a signed-in person without the permission gets a 404 (the nav hides the page from them).
 */
export async function requirePage(perm?: Permission, path = '/'): Promise<AuthUser> {
  const h = await headers();
  await cookies(); // marks the page per-request, like the layout
  const actor = await getActor(new Request('http://foodhub.local/', { headers: h }));
  if (!actor) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (perm && !can(actor.role, perm)) notFound();
  return actor;
}

/** An error whose message is safe and useful to show the person (validation, missing input). */
export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError'; }
}

// Infrastructure failures (Supabase/Postgres, network, programming errors) must not reach the browser verbatim.
const SYSTEM_MESSAGE = /^(Supabase\b|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|getaddrinfo|connect )|PGRST|relation "|column "|JWT/i;
export function isSystemError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error instanceof UserError) return false;
  return error.name !== 'Error' || SYSTEM_MESSAGE.test(error.message);
}

/** Turns a thrown error into JSON: validation messages keep their text (400), anything else is a generic 500 (detail in the server log). */
export function errorResponse(error: unknown, where = 'api'): Response {
  if (!isSystemError(error)) return fail((error as Error).message, 400);
  console.error(`[foodhub] ${where} error:`, error);
  return fail('Something went wrong — see the server log.', 500);
}

/** Route wrapper: checks the permission, passes the actor, turns errors into clean JSON. */
export function withPerm<C = unknown>(perm: Permission, handler: (req: Request, ctx: C, actor: AuthUser) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const actor = await getActor(req);
      if (!actor) return fail('Please sign in.', 401);
      if (!can(actor.role, perm)) return fail(`Your role (${actor.role}) cannot do this.`, 403);
      return await handler(req, ctx, actor);
    } catch (error) {
      return errorResponse(error, `${req.method} ${new URL(req.url).pathname}`);
    }
  };
}

/** Location scope: [] = everything. */
export function inScope(actor: AuthUser, locationCode?: string | null): boolean {
  return actor.locations.length === 0 || (!!locationCode && actor.locations.includes(locationCode));
}

export function scopeFilter(actor: AuthUser, requested?: string[]): string[] | undefined {
  if (actor.locations.length === 0) return requested?.length ? requested : undefined;
  const allowed = requested?.length ? requested.filter((c) => actor.locations.includes(c)) : actor.locations;
  return allowed.length ? allowed : ['__none__'];
}

// ---------- Sign-in ----------

/** `ip` = clientIp(req.headers): failures are throttled per IP + username (see session.ts). */
export async function signIn(username: string, password: string, ip = 'local'): Promise<{ user: AuthUser; cookie: string } | { error: string; status: number }> {
  const name = (username || 'owner').toLowerCase().trim();
  const key = throttleKey(ip, name);
  if (isLocked(key)) return { error: 'Too many attempts. Wait a minute and try again.', status: 429 };
  let user: AuthUser | null = null;
  let version = '';
  if (name === 'owner' && safeEqual(password, process.env.DASHBOARD_PASSWORD)) {
    user = OWNER; version = ownerSessionVersion();
  } else {
    const stored = await getRepo().getUser(name);
    if (stored?.active && verifyPassword(password, stored.passwordHash)) {
      user = toAuthUser(stored); version = sessionVersion(stored.passwordHash);
      await getRepo().saveUser({ ...stored, lastLoginAt: new Date().toISOString() });
    }
  }
  if (!user) {
    recordFailure(key);
    return { error: 'Wrong username or password.', status: 401 };
  }
  clearFailures(key);
  const builtin = user === OWNER;
  const token = await signSession({ u: user.username, n: user.name, r: user.role, l: user.locations, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400, v: version, ...(builtin ? { b: true } : {}) });
  const secure = (process.env.FOODHUB_PUBLIC_URL || '').startsWith('https://') || Boolean(process.env.VERCEL_URL);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  return { user, cookie };
}

export function signOutCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
