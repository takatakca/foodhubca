// Signed session cookie (HMAC-SHA256, Web Crypto) — usable from proxy.ts and route handlers.
// No database access here, so the proxy stays fast.
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

/** SESSION_SECRET, or a key derived from DASHBOARD_PASSWORD. Null = no password set (open dev mode). */
export async function sessionKey(): Promise<CryptoKey | null> {
  const secret = process.env.SESSION_SECRET || (process.env.DASHBOARD_PASSWORD ? `takatak-session|${process.env.DASHBOARD_PASSWORD}` : '');
  if (!secret) return null;
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
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
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Owner password check for "Authorization: Basic …" (scripts, older bookmarks). */
export function basicOwner(header: string | null): boolean {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || !header?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    return decoded.slice(decoded.indexOf(':') + 1) === password;
  } catch {
    return false;
  }
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
