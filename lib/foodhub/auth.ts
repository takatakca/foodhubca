// Who is calling, what they may do, and manager approvals — for every route handler.
//   - People sign in with a one-time code / link (identity/otp.ts) or, on a kitchen tablet, with their PIN.
//   - "owner" + DASHBOARD_PASSWORD stays as the recovery login and for scripts (Authorization: Basic).
//   - Every request is re-checked against the user record, so deactivating someone signs them out at once,
//     and against the device record, so removing a tablet signs it out too.
//   - Gated actions (policy.ts) answer HTTP 428 until a manager PIN comes with the retry (x-approval-pin).
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { logActivity, type Actor } from './activity';
import { fail } from './http';
import { getDevice } from './identity/devices';
import { clientKey, findApprover, lockedFor, noteFailure, noteSuccess } from './identity/pin';
import { ACTIONS, APPROVER_ROLES, getPolicy, needsApproval, type PolicyAction } from './policy';
import { getRepo } from './repo';
import { basicOwner, can, cookieFlags, readCookie, SESSION_COOKIE, SESSION_DAYS, signSession, STAFF_SESSION_HOURS, verifySession, type Permission, type SessionPayload } from './session';
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

/** Who is calling. Null = not signed in. */
export async function getActor(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get('authorization');
  if (basicOwner(auth)) return { ...OWNER };
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
  if (session.d) {
    const device = await getDevice(session.d);
    if (!device || device.revoked) return null;
  }
  const user = await getRepo().getUser(session.u);
  if (!user?.active) return null;
  return { ...toAuthUser(user), ...(session.d ? { deviceId: session.d } : {}) };
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
  const who = clientKey(req, actor.deviceId);
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

export async function sessionCookieFor(user: FoodHubUser | null, kind: NonNullable<SessionPayload['k']>, deviceId?: string): Promise<string> {
  const staff = Boolean(deviceId);
  const seconds = staff ? STAFF_SESSION_HOURS * 3600 : SESSION_DAYS * 86400;
  const payload: SessionPayload = user
    ? { u: user.username, n: user.name, r: user.role, l: user.locations ?? [], exp: Math.floor(Date.now() / 1000) + seconds, k: kind, ...(deviceId ? { d: deviceId } : {}) }
    : { u: 'owner', n: 'Owner', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + seconds, b: true, k: kind };
  return `${SESSION_COOKIE}=${encodeURIComponent(await signSession(payload))}; ${cookieFlags(seconds)}`;
}

export function signOutCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieFlags(0)}`;
}

// ---------- Owner recovery login (DASHBOARD_PASSWORD) and legacy passwords ----------

const attempts = new Map<string, { count: number; until: number }>();

export async function signIn(username: string, password: string): Promise<{ user: AuthUser; cookie: string } | { error: string; status: number }> {
  const key = (username || 'owner').toLowerCase().trim();
  const a = attempts.get(key);
  if (a && a.count >= 5 && a.until > Date.now()) return { error: 'Too many attempts. Wait a minute and try again.', status: 429 };
  let user: AuthUser | null = null;
  let stored: FoodHubUser | null = null;
  if (key === 'owner' && process.env.DASHBOARD_PASSWORD && password.length === process.env.DASHBOARD_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(process.env.DASHBOARD_PASSWORD))) {
    user = { ...OWNER };
  } else {
    stored = await getRepo().getUser(key);
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
  return { user, cookie: await sessionCookieFor(stored, 'password') };
}

export function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
