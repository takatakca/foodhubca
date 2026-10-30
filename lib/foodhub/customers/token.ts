// TEMPORARY STAND-IN — verify-only. The real customer identity module (sign, tokenVersion against the customer record,
// verify/start, verify/check, /customers/me) is built on branch `feature/customer-identity`; its `token.ts` REPLACES this
// file at merge time (keep theirs). Until then, website orders (delivery/website.ts) only need to VERIFY a customer token.
//
// Token format (shared contract, 2026-10-29):
//   cust.<customerId>.<tenant>.<expUnix>.<tokenVersion>.<hmac-sha256 base64url>
// signed with Food Hub's session secret (lib/foodhub/session.ts sessionKey: SESSION_SECRET, else derived from
// DASHBOARD_PASSWORD, else the dev secret) over "cust.<customerId>.<tenant>.<expUnix>.<tokenVersion>". 30 days.
import { sessionKey } from '../session';

export interface CustomerTokenClaims { customerId: string; tenant: string; exp: number; version: number }

const PART = /^[A-Za-z0-9_-]{1,64}$/;

/** The claims of a valid, unexpired customer token; null for anything else. Never throws. */
export async function verifyCustomerToken(token: string | null | undefined, now = Date.now()): Promise<CustomerTokenClaims | null> {
  if (!token || typeof token !== 'string' || token.length > 400) return null;
  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== 'cust') return null;
  const [, customerId, tenant, expRaw, versionRaw, sig] = parts;
  if (!PART.test(customerId) || !PART.test(tenant) || !/^\d{1,12}$/.test(expRaw) || !/^\d{1,9}$/.test(versionRaw) || !/^[A-Za-z0-9_-]{40,50}$/.test(sig)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
  try {
    const key = await sessionKey();
    if (!key) return null;
    const body = `cust.${customerId}.${tenant}.${expRaw}.${versionRaw}`;
    const ok = await crypto.subtle.verify('HMAC', key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(body));
    return ok ? { customerId, tenant, exp, version: Number(versionRaw) } : null;
  } catch {
    return null;
  }
}
