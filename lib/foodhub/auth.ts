// Who is calling, what they may do, and manager approvals — for every route handler.
//   - People sign in with a one-time code / link (identity/otp.ts) or, on a kitchen tablet, with their PIN.
//   - "owner" + DASHBOARD_PASSWORD stays as the recovery login and for scripts (Authorization: Basic). It cannot
//     be locked out by username alone: the sign-in throttle is keyed by client IP + username.
//   - Every request is re-checked against the user record, so deactivating someone signs them out at once,
//     and against the device record, so removing a tablet signs it out too. The cookie carries a session
//     version, so resetting a password (or rotating DASHBOARD_PASSWORD) signs those devices out as well.
//   - Gated actions (policy.ts) answer HTTP 428 until a manager PIN comes with the retry (x-approval-pin).
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { logActivity, type Actor } from './activity';
import { fail } from './http';
import { getDevice } from './identity/devices';
import { clientKey, findApprover, lockedFor, noteFailure, noteSuccess } from './identity/pin';
import { ACTIONS, APPROVER_ROLES, getPolicy, needsApproval, type PolicyAction } from './policy';
import { getRepo } from './repo';
import {
  basicOwner, can, clearFailures, clientIp, cookieFlags, decodeBasic, isLocked, ownerSessionVersion, readCookie, recordFailure, safeEqual,
  SESSION_COOKIE, SESSION_DAYS, signSession, STAFF_SESSION_HOURS, throttleKey, userSessionVersion, verifySession, type Permission, type SessionPayload,
} from './session';
import type { FoodHubUser, Role } from './types';

export interface AuthUser extends Actor {
  role: Role;
  /** [] = all locations */
  locations: string[];
  /** Kitchen tablet the session was opened on (PIN session). */
  deviceId?: string;
  /** Built-in owner recovery login. */
  builtin?: boolean;
  /** Set by approvalGate when a manager PIN approved the current action. */
  approvedBy?: string;
}

export const OWNER: AuthUser = { username: 'owner', name: 'Owner', role: 'owner', locations: [], source: 'dashboard', builtin: true };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
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

export function toAuthUser(u: FoodHubUser): AuthUser {
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
  const auth = req.headers.get('authorization');
  const basic = decodeBasic(auth);
  if (basic) {
    const ip = clientIp(req.headers);
    const key = throttleKey(ip, basic.username);
    if (isLocked(key)) return null;
    if (basicOwner(auth)) { clearFailures(key); return { ...OWNER }; }
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
  if (session.d) {
    const device = await getDevice(session.d);
    if (!device || device.revoked) return null;
  }
  const user = await getRepo().getUser(session.u);
  if (!user?.active || session.v !== userSessionVersion(user)) return null;
  return { ...toAuthUser(user), ...(session.d ? { deviceId: session.d } : {}) };
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

/** "Sara (approved by Marc)" — what the activity log and the order timeline show. */
export function actorLabel(actor: AuthUser): string {
  return actor.approvedBy ? `${actor.name} (approved by ${actor.approvedBy})` : actor.name;
}

/**
 * Manager approval for a gated action. Returns null when the action may go ahead (and sets
 * actor.approvedBy when a PIN approved it), or a JSON response:
 *   428 { needsApproval: true }            — ask for a manager PIN and retry with header x-approval-pin
 *   403 { needsApproval: true, wrongPin }  — that PIN is not a manager's (5 tries, then 5 minutes locked)
 */
export async function approvalGate(req: Request, actor: AuthUser, action: PolicyAction, locationCode?: string | null, what?: string): Promise<Response | null> {
  // The owner recovery login (DASHBOARD_PASSWORD) is the master key: scripts and recovery are never blocked.
  if (actor.builtin) return null;
  const rule = (await getPolicy())[action];
  if (!needsApproval(rule, actor.role)) return null;
  const label = ACTIONS[action];
  const pin = req.headers.get('x-approval-pin')?.trim();
  if (!pin) return NextResponse.json({ ok: false, needsApproval: true, action, rule, label: label.en, labelFr: label.fr, error: `Manager approval needed: ${label.en}.` }, { status: 428 });
  const who = clientKey(req, actor.deviceId, actor.username);
  const wait = lockedFor(who);
  if (wait) return NextResponse.json({ ok: false, needsApproval: true, locked: wait, action, error: `Too many wrong PINs. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429 });
  const approver = await findApprover(pin, APPROVER_ROLES, locationCode);
  if (!approver) {
    noteFailure(who);
    await logActivity({ actor: actor.name, source: actor.source, kind: 'approval', action, status: 'failed', locationCode: locationCode ?? null, summary: `Wrong manager PIN for "${label.en}"${what ? ` — ${what}` : ''}` });
    return NextResponse.json({ ok: false, needsApproval: true, wrongPin: true, action, error: 'PIN not recognised for a manager here.' }, { status: 403 });
  }
  noteSuccess(who);
  actor.approvedBy = approver.username === actor.username ? undefined : approver.name;
  await logActivity({ actor: approver.name, source: actor.source, kind: 'approval', action, status: 'success', locationCode: locationCode ?? null,
    summary: approver.username === actor.username ? `${approver.name} confirmed "${label.en}" with their PIN${what ? ` — ${what}` : ''}` : `${approver.name} approved "${label.en}" for ${actor.name}${what ? ` — ${what}` : ''}` });
  return null;
}

// ---------- Session cookies ----------

/** Signed session cookie. The version (`v`) ties it to the credential behind it: see getActor(). */
export async function sessionCookieFor(user: FoodHubUser | null, kind: NonNullable<SessionPayload['k']>, deviceId?: string): Promise<string> {
  const staff = Boolean(deviceId);
  const seconds = staff ? STAFF_SESSION_HOURS * 3600 : SESSION_DAYS * 86400;
  const payload: SessionPayload = user
    ? { u: user.username, n: user.name, r: user.role, l: user.locations ?? [], exp: Math.floor(Date.now() / 1000) + seconds, k: kind, v: userSessionVersion(user), ...(deviceId ? { d: deviceId } : {}) }
    : { u: 'owner', n: 'Owner', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + seconds, b: true, k: kind, v: ownerSessionVersion() };
  return `${SESSION_COOKIE}=${encodeURIComponent(await signSession(payload))}; ${cookieFlags(seconds)}`;
}

export function signOutCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieFlags(0)}`;
}

// ---------- Owner recovery login (DASHBOARD_PASSWORD) and legacy passwords ----------

/** `ip` = clientIp(req.headers): failures are throttled per IP + username (see session.ts). */
export async function signIn(username: string, password: string, ip = 'local'): Promise<{ user: AuthUser; cookie: string } | { error: string; status: number }> {
  const name = (username || 'owner').toLowerCase().trim();
  const key = throttleKey(ip, name);
  if (isLocked(key)) return { error: 'Too many attempts. Wait a minute and try again.', status: 429 };
  let user: AuthUser | null = null;
  let stored: FoodHubUser | null = null;
  if (name === 'owner' && safeEqual(password, process.env.DASHBOARD_PASSWORD)) {
    user = { ...OWNER };
  } else {
    stored = await getRepo().getUser(name);
    if (stored?.active && verifyPassword(password, stored.passwordHash)) {
      user = toAuthUser(stored);
      await getRepo().saveUser({ ...stored, lastLoginAt: new Date().toISOString() });
    } else {
      stored = null;
    }
  }
  if (!user) {
    recordFailure(key);
    return { error: 'Wrong username or password.', status: 401 };
  }
  clearFailures(key);
  return { user, cookie: await sessionCookieFor(stored, 'password') };
}

export function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
