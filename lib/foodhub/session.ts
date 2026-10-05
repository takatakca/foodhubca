// Signed cookies (HMAC-SHA256, Web Crypto) — usable from proxy.ts and route handlers. No database here,
// so the sign-in gate stays fast.
//   takatak_session  who is signed in (14 days; 14 hours for a staff PIN session on a kitchen tablet)
//   takatak_device   this browser is an enrolled kitchen tablet (1 year) — survives sign-out, so the
//                    tablet comes back to its PIN screen instead of the email sign-in.
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

/**
 * The signing secret: SESSION_SECRET, else one derived from DASHBOARD_PASSWORD. In development a fixed
 * dev-only secret is used so sign-in works out of the box. In production with neither set → null
 * (the proxy then refuses every request with a clear message).
 */
export function sessionSecret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.DASHBOARD_PASSWORD) return `takatak-session|${process.env.DASHBOARD_PASSWORD}`;
  if (process.env.NODE_ENV !== 'production') return 'takatak-dev-only-session-secret';
  return null;
}

async function key(): Promise<CryptoKey | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(prefix: string, payload: object): Promise<string> {
  const k = await key();
  if (!k) throw new Error('Set SESSION_SECRET (npm run setup) to enable sign-in.');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${prefix}.${body}`)));
  return `${body}.${b64url(sig)}`;
}

async function verify<T extends { exp: number }>(prefix: string, token: string | null | undefined): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const k = await key();
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

export function readCookie(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
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

/** Owner recovery password for "Authorization: Basic …" (scripts, monitoring, the e2e suite). */
export function basicOwner(header: string | null): boolean {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || !header?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (given.length !== password.length) return false;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ password.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
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
