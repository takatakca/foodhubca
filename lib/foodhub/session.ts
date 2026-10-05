// Signed session cookie (HMAC-SHA256, Web Crypto) — usable from proxy.ts and route handlers.
// No database access here, so the proxy stays fast (proxy.ts runs on the Node runtime, so node:crypto is fine).
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from './types';

export const SESSION_COOKIE = 'takatak_session';
export const SESSION_DAYS = 14;

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
  /** true for the built-in owner login (DASHBOARD_PASSWORD) */
  b?: boolean;
  /** session version: changes when the password behind the session changes (see sessionVersion) */
  v?: string;
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

// Without SESSION_SECRET the signing key is derived from DASHBOARD_PASSWORD with scrypt (never the raw
// password: a leaked cookie must not be an offline oracle for the owner password). Cached per password value.
const derived = new Map<string, Uint8Array>();
function keyMaterial(): Uint8Array | null {
  if (process.env.SESSION_SECRET) return enc.encode(process.env.SESSION_SECRET);
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return null;
  let key = derived.get(password);
  if (!key) {
    key = new Uint8Array(scryptSync(password, 'takatak-session-v1', 32));
    derived.clear(); // only the current password matters
    derived.set(password, key);
  }
  return key;
}

/** SESSION_SECRET, or a key derived from DASHBOARD_PASSWORD. Null = no password set (open dev mode). */
export async function sessionKey(): Promise<CryptoKey | null> {
  const material = keyMaterial();
  if (!material) return null;
  return crypto.subtle.importKey('raw', material as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Short fingerprint of the secret behind a session: a cookie is only valid while its version matches. */
export function sessionVersion(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

/** Version of the built-in owner's sessions (changes when DASHBOARD_PASSWORD changes). '' = no password. */
export function ownerSessionVersion(): string {
  return process.env.DASHBOARD_PASSWORD ? sessionVersion(process.env.DASHBOARD_PASSWORD) : '';
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const key = await sessionKey();
  if (!key) throw new Error('Set DASHBOARD_PASSWORD (or SESSION_SECRET) to enable sign-in.');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null;
  const key = await sessionKey();
  if (!key) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

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

// ---------- Brute-force throttle (per process, keyed by client IP + username) ----------
// 5 failures lock the key for 60 s; every further failure doubles the lock, up to 15 min.
// Keyed by IP so nobody can lock the owner out for everyone by hammering the username alone.
const LOCK_AFTER = 5;
const LOCK_MS = 60_000;
const LOCK_MAX_MS = 15 * 60_000;
const MAX_KEYS = 1000;
const attempts = new Map<string, { count: number; until: number }>();

/** First x-forwarded-for value (Vercel / reverse proxies), else "local". */
/** x-forwarded-for is only trustworthy behind a proxy that sets it: Vercel always, others with FOODHUB_TRUST_PROXY=true. */
export function trustProxy(): boolean {
  return Boolean(process.env.VERCEL) || process.env.FOODHUB_TRUST_PROXY === 'true';
}
export function clientIp(headers: Headers): string {
  if (!trustProxy()) return 'local'; // no proxy: the header is client-supplied, so every client shares one bucket
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

/** Test hook. */
/** Number of throttle buckets held in memory (tests). */
export function throttleSize(): number { return attempts.size; }
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
 * Owner password check for "Authorization: Basic …" (scripts, older bookmarks).
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

// ---------- Roles (Atlas standard roles, simplified to what a multi-brand restaurant group needs) ----------

export type Permission =
  | 'view'            // Command Center, order board
  | 'orders:act'      // accept / reject / ready / cancel / print
  | 'stores:toggle'   // pause / resume, busy mode
  | 'items:toggle'    // 86 items and modifiers
  | 'menu:edit'       // menus, prices, hours, publish
  | 'stores:map'      // store mappings, Uber store activation
  | 'analytics:view'  // analytics, reports, activity log, payouts & reconciliation (read)
  | 'finance:edit'    // statement imports, commission settings, disputes, deposits, ledger approval
  | 'admin';          // users, brands/locations, secrets, report schedules

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['view', 'orders:act', 'stores:toggle', 'items:toggle', 'menu:edit', 'stores:map', 'analytics:view', 'finance:edit', 'admin'],
  manager: ['view', 'orders:act', 'stores:toggle', 'items:toggle', 'menu:edit', 'stores:map', 'analytics:view', 'finance:edit'],
  operator: ['view', 'orders:act', 'stores:toggle', 'items:toggle'],
  menu: ['view', 'items:toggle', 'menu:edit'],
  analyst: ['view', 'analytics:view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner — everything',
  manager: 'Manager — operations, menus, stores, analytics',
  operator: 'Store operator — orders, 86, pause (own locations)',
  menu: 'Menu editor — menus, prices, hours, 86',
  analyst: 'Analyst — analytics and reports (read-only)',
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
