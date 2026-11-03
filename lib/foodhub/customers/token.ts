// The customer token the brand website keeps in its httpOnly cookie and forwards as X-Customer-Token:
//   cust.<customerId>.<tenant>.<expUnix>.<tokenVersion>.<hmac-sha256 base64url>
// Signed with Food Hub's session secret (session.ts sessionKey — the same HMAC key as the console cookies, no second
// crypto scheme), valid 30 days. The version is checked against the record on every call, so logout / delete void
// every token at once. A token of another brand website is refused (403).
import { timingSafeEqual } from 'node:crypto';
import { sessionKey } from '../session';
import { getCustomer } from './store';
import { allowedCustomerTenants, type MasterCustomer } from './types';

export const CUSTOMER_TOKEN_DAYS = 30;
const PREFIX = 'cust';
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function hmac(data: string): Promise<string> {
  const k = await sessionKey();
  if (!k) throw new Error('Set SESSION_SECRET (npm run setup) to enable customer tokens.');
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data))));
}

export interface CustomerTokenPayload { id: string; tenant: string; exp: number; version: number }

/** Signs a token for this customer on this brand website; `ttlS` only for tests (an already expired token). */
export async function signCustomerToken(customer: Pick<MasterCustomer, 'id' | 'tokenVersion'>, tenant: string, ttlS = CUSTOMER_TOKEN_DAYS * 86400): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  const body = [PREFIX, customer.id, tenant, String(exp), String(customer.tokenVersion)].join('.');
  return { token: `${body}.${await hmac(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export type TokenCheck = { ok: true; payload: CustomerTokenPayload } | { ok: false; status: 401 | 403; error: string };

const BAD = { ok: false as const, status: 401 as const, error: 'Jeton client invalide ou expiré. / Customer token invalid or expired.' };

/** Signature, shape, expiry and tenant of a token — nothing about the record yet (see resolveCustomerToken). */
export async function verifyCustomerToken(token: string | null | undefined, expected: { tenant?: string | null } = {}): Promise<TokenCheck> {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length !== 6 || parts[0] !== PREFIX) return BAD;
  const [, id, tenant, expRaw, verRaw, sig] = parts;
  const exp = Number(expRaw);
  const version = Number(verRaw);
  if (!id || !tenant || !Number.isInteger(exp) || !Number.isInteger(version) || !sig) return BAD;
  let expectedSig: string;
  try { expectedSig = await hmac(parts.slice(0, 5).join('.')); } catch { return BAD; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return BAD;
  if (exp * 1000 < Date.now()) return BAD;
  if (!allowedCustomerTenants().includes(tenant)) return { ok: false, status: 403, error: `Brand website "${tenant}" is not allowed here.` };
  if (expected.tenant && expected.tenant !== tenant) return { ok: false, status: 403, error: 'This token belongs to another brand website.' };
  return { ok: true, payload: { id, tenant, exp, version } };
}

export type CustomerResolve = { ok: true; customer: MasterCustomer; tenant: string } | { ok: false; status: 401 | 403; error: string };

/**
 * The live customer behind a token: signature + expiry + tenant, then the record (exists, not deleted, same token
 * version). This is what every /me route and the website-order intake (`customerToken`) use.
 */
export async function resolveCustomerToken(token: string | null | undefined, expected: { tenant?: string | null } = {}): Promise<CustomerResolve> {
  const v = await verifyCustomerToken(token, expected);
  if (!v.ok) return { ok: false, status: v.status, error: v.error };
  const customer = await getCustomer(v.payload.id);
  if (!customer || customer.deletedAt || customer.tokenVersion !== v.payload.version || !customer.phone) return BAD;
  return { ok: true, customer, tenant: v.payload.tenant };
}
