// Sign-in, users and permissions for route handlers.
//  - Built-in owner: username "owner" + DASHBOARD_PASSWORD (cannot be locked out).
//  - Team members: Food Hub → Users (scrypt-hashed passwords, roles, location scope).
//  - Every request is re-checked against the user record, so deactivating someone takes effect at once.
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { Actor } from './activity';
import { fail } from './http';
import { getRepo } from './repo';
import { basicOwner, can, readCookie, SESSION_COOKIE, SESSION_DAYS, signSession, verifySession, type Permission } from './session';
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

/** Who is calling. Null = not signed in. */
export async function getActor(req: Request): Promise<AuthUser | null> {
  if (!process.env.DASHBOARD_PASSWORD && !process.env.SESSION_SECRET) {
    // Open local/dev mode (proxy.ts refuses live mode without a password).
    return OWNER;
  }
  const auth = req.headers.get('authorization');
  if (basicOwner(auth)) return OWNER;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const user = await getRepo().getUser(decoded.slice(0, i));
      if (user?.active && verifyPassword(decoded.slice(i + 1), user.passwordHash)) return { ...toAuthUser(user), source: 'api' };
    } catch { /* fall through */ }
    return null;
  }
  const session = await verifySession(readCookie(req.headers.get('cookie')));
  if (!session) return null;
  if (session.b) return { ...OWNER, name: session.n || OWNER.name };
  const user = await getRepo().getUser(session.u);
  return user?.active ? toAuthUser(user) : null;
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
      return fail(error instanceof Error ? error.message : String(error), 500);
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

const attempts = new Map<string, { count: number; until: number }>();

export async function signIn(username: string, password: string): Promise<{ user: AuthUser; cookie: string } | { error: string; status: number }> {
  const key = (username || 'owner').toLowerCase().trim();
  const a = attempts.get(key);
  if (a && a.count >= 5 && a.until > Date.now()) return { error: 'Too many attempts. Wait a minute and try again.', status: 429 };
  let user: AuthUser | null = null;
  let builtin = false;
  if (key === 'owner' && process.env.DASHBOARD_PASSWORD && password === process.env.DASHBOARD_PASSWORD) {
    user = OWNER; builtin = true;
  } else {
    const stored = await getRepo().getUser(key);
    if (stored?.active && verifyPassword(password, stored.passwordHash)) {
      user = toAuthUser(stored);
      await getRepo().saveUser({ ...stored, lastLoginAt: new Date().toISOString() });
    }
  }
  if (!user) {
    attempts.set(key, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 60_000 });
    return { error: 'Wrong username or password.', status: 401 };
  }
  attempts.delete(key);
  const token = await signSession({ u: user.username, n: user.name, r: user.role, l: user.locations, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400, ...(builtin ? { b: true } : {}) });
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
