// Signed cookies (HMAC-SHA256, Web Crypto) — usable from proxy.ts and route handlers. No database here,
// so the sign-in gate stays fast (proxy.ts runs on the Node runtime, so node:crypto is fine).
//   takatak_session  who is signed in (14 days; 14 hours for a staff PIN session on a kitchen tablet)
//   takatak_device   this browser is an enrolled kitchen tablet (1 year) — survives sign-out, so the
//                    tablet comes back to its PIN screen instead of the email sign-in.
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from './types';

export const SESSION_COOKIE = 'takatak_session';
export const DEVICE_COOKIE = 'takatak_device';
export const SESSION_DAYS = 14;
export const STAFF_SESSION_HOURS = 14;
export const DEVICE_DAYS = 365;

export interface SessionPayload {
  /** username */
  u: string;
  /** display name */
  n: string;
  r: Role;
  /** location scope ([] = all) */
  l: string[];
  /** expiry, epoch seconds */
  exp: number;
  /** true for the built-in owner recovery login (DASHBOARD_PASSWORD) */
  b?: boolean;
  /** session version: changes when the credential behind the session changes (see sessionVersion) */
  v?: string;
  /** kitchen device id when the session was opened with a PIN on an enrolled tablet */
  d?: string;
  /** how the person signed in */
  k?: 'otp' | 'link' | 'pin' | 'password';
}

export interface DevicePayload {
  /** device id */
  d: string;
  /** location code */
  l: string;
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Constant-time string comparison (never compare passwords with ===). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Where the signing secret comes from: SESSION_SECRET, else one derived from DASHBOARD_PASSWORD with scrypt
 * (never the raw password: a leaked cookie must not be an offline oracle for the owner password), else — in
 * development only — a fixed dev secret so sign-in works out of the box. In production with neither set → null
 * (the proxy then refuses every request with a clear message).
 */
export type SessionSecretSource = 'env' | 'password' | 'dev';
export function sessionSecretSource(): SessionSecretSource | null {
  if (process.env.SESSION_SECRET) return 'env';
  if (process.env.DASHBOARD_PASSWORD) return 'password';
  if (process.env.NODE_ENV !== 'production') return 'dev';
  return null;
}

const DEV_SECRET = 'takatak-dev-only-session-secret';
const derived = new Map<string, Uint8Array>();
function keyMaterial(): Uint8Array | null {
  switch (sessionSecretSource()) {
    case 'env': return enc.encode(process.env.SESSION_SECRET);
    case 'dev': return enc.encode(DEV_SECRET);
    case 'password': {
      const password = process.env.DASHBOARD_PASSWORD!;
      let key = derived.get(password);
      if (!key) {
        key = new Uint8Array(scryptSync(password, 'takatak-session-v1', 32));
        derived.clear(); // only the current password matters
        derived.set(password, key);
      }
      return key;
    }
    default: return null;
  }
}

/** The HMAC key behind every cookie. Null = no secret at all (production without SESSION_SECRET / DASHBOARD_PASSWORD). */
export async function sessionKey(): Promise<CryptoKey | null> {
  const material = keyMaterial();
  if (!material) return null;
  return crypto.subtle.importKey('raw', material as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Short fingerprint of the credential behind a session: a cookie is only valid while its version matches. */
export function sessionVersion(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

/** Version of the built-in owner's sessions (changes when DASHBOARD_PASSWORD changes). '' = no password. */
export function ownerSessionVersion(): string {
  return process.env.DASHBOARD_PASSWORD ? sessionVersion(process.env.DASHBOARD_PASSWORD) : '';
}

/** Version of a team member's sessions: resetting or removing their password signs their devices out. */
export function userSessionVersion(user: { passwordHash?: string | null }): string {
  return sessionVersion(user.passwordHash || '');
}

async function sign(prefix: string, payload: object): Promise<string> {
  const k = await sessionKey();
  if (!k) throw new Error('Set SESSION_SECRET (npm run setup) to enable sign-in.');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${prefix}.${body}`)));
  return `${body}.${b64url(sig)}`;
}

async function verify<T extends { exp: number }>(prefix: string, token: string | null | undefined): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const k = await sessionKey();
  if (!k) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', k, fromB64url(sig) as BufferSource, enc.encode(`${prefix}.${body}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const signSession = (p: SessionPayload) => sign('s', p);
export const verifySession = (t: string | null | undefined) => verify<SessionPayload>('s', t);
export const signDevice = (p: DevicePayload) => sign('d', p);
export const verifyDevice = (t: string | null | undefined) => verify<DevicePayload>('d', t);

/**
 * Welcome ticket: put in the /welcome/clover link after a merchant opens the app from Clover, so that public page
 * may show that merchant's own connection (name, approval, register check). Without a valid ticket the page shows
 * nothing about any merchant — a merchant ID typed in the address bar reveals nothing.
 */
export interface WelcomePayload { m: string; exp: number }
export const WELCOME_TICKET_TTL_S = 7 * 24 * 3600;
export async function signWelcome(merchantId: string, ttlS = WELCOME_TICKET_TTL_S): Promise<string | null> {
  try { return await sign('w', { m: merchantId, exp: Math.floor(Date.now() / 1000) + ttlS }); } catch { return null; }
}
export const verifyWelcome = (t: string | null | undefined) => verify<WelcomePayload>('w', t);

/**
 * Courier link: one of our own couriers opens his page (/courier) with it — no password. `v` is the courier's link
 * version: "New link" in the console bumps it, and every older link stops working.
 */
export interface CourierPayload { c: string; v: number; exp: number }
export const COURIER_LINK_TTL_S = 180 * 24 * 3600;
export const signCourier = (courierId: string, version: number, ttlS = COURIER_LINK_TTL_S) => sign('c', { c: courierId, v: version, exp: Math.floor(Date.now() / 1000) + ttlS });
export const verifyCourier = (t: string | null | undefined) => verify<CourierPayload>('c', t);

export function readCookie(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      // A corrupted cookie (bad % sequence) must mean "not signed in", not a 500 on every page.
      try { return decodeURIComponent(v.join('=')); } catch { return null; }
    }
  }
  return null;
}

/** Cookie attributes: Secure on https deployments. */
export function cookieFlags(maxAgeSeconds: number): string {
  const secure = (process.env.FOODHUB_PUBLIC_URL || '').startsWith('https://') || Boolean(process.env.VERCEL_URL);
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}${secure ? '; Secure' : ''}`;
}

// ---------- Brute-force throttle (per process, keyed by client IP + username) ----------
// 5 failures lock the key for 60 s; every further failure doubles the lock, up to 15 min.
// Keyed by IP so nobody can lock the owner out for everyone by hammering the username alone.
const LOCK_AFTER = 5;
const LOCK_MS = 60_000;
const LOCK_MAX_MS = 15 * 60_000;
const MAX_KEYS = 1000;
const attempts = new Map<string, { count: number; until: number }>();

/** x-forwarded-for is only trustworthy behind a proxy that sets it: Vercel always, others (nginx, Caddy, Traefik, Cloudflare) with FOODHUB_TRUST_PROXY=true. */
export function trustProxy(): boolean {
  return Boolean(process.env.VERCEL) || process.env.FOODHUB_TRUST_PROXY === 'true';
}

/** First x-forwarded-for value behind a trusted proxy, else "local" (every client shares one bucket). */
export function clientIp(headers: Headers): string {
  if (!trustProxy()) return 'local'; // no proxy: the header is client-supplied
  return (headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
}

export function throttleKey(ip: string, username: string): string {
  return `${ip}|${(username || 'owner').toLowerCase().trim()}`;
}

export function isLocked(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.count >= LOCK_AFTER && a.until > Date.now();
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  const count = a && a.until > now ? a.count + 1 : 1;
  const lock = count < LOCK_AFTER ? LOCK_MS : Math.min(LOCK_MAX_MS, LOCK_MS * 2 ** (count - LOCK_AFTER));
  attempts.set(key, { count, until: now + lock });
  if (attempts.size > MAX_KEYS) {
    for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    for (const k of attempts.keys()) { if (attempts.size <= MAX_KEYS) break; attempts.delete(k); } // oldest first
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Number of throttle buckets held in memory (tests). */
export function throttleSize(): number { return attempts.size; }
/** Test hook. */
export function resetThrottle(): void {
  attempts.clear();
}

/** Decodes "Authorization: Basic …" into its two parts (null when it is not a Basic header). */
export function decodeBasic(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    return i < 0 ? { username: '', password: decoded } : { username: decoded.slice(0, i), password: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

/**
 * Owner recovery password for "Authorization: Basic …" (scripts, monitoring, the e2e suite).
 * With `ip`, failures count against the IP+username throttle and a locked key is refused without comparing.
 */
export function basicOwner(header: string | null, ip?: string): boolean {
  const password = process.env.DASHBOARD_PASSWORD;
  const basic = decodeBasic(header);
  if (!password || !basic) return false;
  // The owner password only counts under the owner username (or none): otherwise rotating usernames would dodge the throttle.
  const u = basic.username.toLowerCase().trim();
  if (u && u !== 'owner') return false;
  const key = ip ? throttleKey(ip, 'owner') : null;
  if (key && isLocked(key)) return false;
  const ok = safeEqual(basic.password, password);
  if (key) { if (ok) clearFailures(key); else recordFailure(key); }
  return ok;
}

// ---------- Roles ----------

export type Permission =
  | 'view'            // overview, live orders, kitchen screen
  | 'orders:act'      // accept / ready / picked up / print / acknowledge alerts
  | 'stores:toggle'   // pause / resume, busy mode
  | 'items:toggle'    // 86 items and options
  | 'menu:edit'       // menus, prices, hours, publish
  | 'stores:map'      // store mappings, Uber store activation, kitchen tablets
  | 'analytics:view'  // insights, reports, activity, payouts (read)
  | 'finance:edit'    // statements, commission plans, disputes, deposits, ledger approval
  | 'admin';          // team, security rules, alert rules, brands & locations, secrets

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['view', 'orders:act', 'stores:toggle', 'items:toggle', 'menu:edit', 'stores:map', 'analytics:view', 'finance:edit', 'admin'],
  manager: ['view', 'orders:act', 'stores:toggle', 'items:toggle', 'menu:edit', 'stores:map', 'analytics:view', 'finance:edit'],
  operator: ['view', 'orders:act', 'stores:toggle', 'items:toggle'],
  menu: ['view', 'items:toggle', 'menu:edit'],
  analyst: ['view', 'analytics:view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  operator: 'Staff',
  menu: 'Menu editor',
  analyst: 'Accountant / analyst',
};

export const ROLE_LABELS_FR: Record<Role, string> = {
  owner: 'Propriétaire',
  manager: 'Gérant',
  operator: 'Employé',
  menu: 'Éditeur de menu',
  analyst: 'Comptable / analyste',
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
