// Limits on the public checkout of the ordering page:
//   - 5 orders per 10 minutes per address (in memory, this process);
//   - 3 orders per 30 minutes per phone number (fh_kv, so a restart does not reset it). The key holds a hash of the
//     number, never the number itself.
// Without a trusted proxy (FOODHUB_TRUST_PROXY / Vercel) every visitor shares the address "local": that shared bucket
// gets a wider limit so real customers are never blocked by each other; the phone limit still applies.
import crypto from 'node:crypto';
import { getRepo } from '../repo';

export const IP_LIMIT = { max: 5, windowMs: 10 * 60_000 };
export const SHARED_IP_LIMIT = { max: 60, windowMs: 10 * 60_000 };
export const PHONE_LIMIT = { max: 3, windowMs: 30 * 60_000 };

const ipHits = (): Map<string, number[]> => {
  const g = globalThis as unknown as { __fhStorefrontIpHits?: Map<string, number[]> };
  g.__fhStorefrontIpHits ??= new Map();
  return g.__fhStorefrontIpHits;
};

export function resetStorefrontRateLimits(): void { ipHits().clear(); }

const phoneKey = (phone: string) => `sf_rl_phone:${crypto.createHash('sha256').update(`storefront|${phone}`).digest('hex').slice(0, 32)}`;
const limitFor = (ip: string) => (ip === 'local' ? SHARED_IP_LIMIT : IP_LIMIT);

function recent(list: number[] | null | undefined, now: number, windowMs: number): number[] {
  return (Array.isArray(list) ? list : []).filter((t) => typeof t === 'number' && t > now - windowMs && t <= now + 60_000);
}

/** May this address and phone place one more order now? (Nothing is counted here.) */
export async function checkoutAllowed(ip: string, phone: string, now = Date.now()): Promise<{ ok: true } | { ok: false; retryAfterSec: number; by: 'ip' | 'phone' }> {
  const lim = limitFor(ip);
  const byIp = recent(ipHits().get(ip), now, lim.windowMs);
  if (byIp.length >= lim.max) return { ok: false, by: 'ip', retryAfterSec: Math.max(1, Math.ceil((byIp[0] + lim.windowMs - now) / 1000)) };
  const byPhone = recent(await getRepo().getKv<number[]>(phoneKey(phone)).catch(() => null), now, PHONE_LIMIT.windowMs);
  if (byPhone.length >= PHONE_LIMIT.max) return { ok: false, by: 'phone', retryAfterSec: Math.max(1, Math.ceil((byPhone[0] + PHONE_LIMIT.windowMs - now) / 1000)) };
  return { ok: true };
}

/** Counts one order attempt for this address and phone. */
export async function noteCheckout(ip: string, phone: string, now = Date.now()): Promise<void> {
  const lim = limitFor(ip);
  ipHits().set(ip, [...recent(ipHits().get(ip), now, lim.windowMs), now]);
  if (ipHits().size > 5000) ipHits().delete(ipHits().keys().next().value as string);
  const key = phoneKey(phone);
  const list = recent(await getRepo().getKv<number[]>(key).catch(() => null), now, PHONE_LIMIT.windowMs);
  await getRepo().setKv(key, [...list, now]).catch(() => undefined);
}
