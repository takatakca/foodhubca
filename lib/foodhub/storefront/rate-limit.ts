// Limits on the public checkout of the ordering page:
//   - 5 orders per 10 minutes per address (in memory, this process);
//   - 3 orders per 30 minutes per phone number (fh_docs 'sf_rl_phone', so a restart does not reset it). The document id
//     is a hash of the number, never the number itself; documents untouched for a day are pruned;
//   - 40 pay-at-the-counter orders per hour per page (in memory): a ceiling on unpaid orders reaching a kitchen.
// Without a trusted proxy (FOODHUB_TRUST_PROXY / Vercel) every visitor shares the address "local": that shared bucket
// gets a wider limit so real customers are never blocked by each other; the phone limit still applies. The settings
// screen warns about it (trustProxy false).
//
// Race-free by construction: reserveCheckout() takes the address and page slots in the same tick it checks them (no
// await in between), and the phone slot under an in-process lock per phone. Parallel requests therefore cannot all pass
// the check before any of them is counted. A reservation is released when the order is not placed in the end.
import crypto from 'node:crypto';
import { getRepo } from '../repo';

export const IP_LIMIT = { max: 5, windowMs: 10 * 60_000 };
export const SHARED_IP_LIMIT = { max: 60, windowMs: 10 * 60_000 };
export const PHONE_LIMIT = { max: 3, windowMs: 30 * 60_000 };
export const PICKUP_PAGE_LIMIT = { max: 40, windowMs: 60 * 60_000 };
export const PHONE_COL = 'sf_rl_phone';
const PHONE_KEEP_MS = 24 * 3600_000;

type Mem = { ip: Map<string, number[]>; pickup: Map<string, number[]>; locks: Map<string, Promise<void>>; prunedAt: number };
const mem = (): Mem => {
  const g = globalThis as unknown as { __fhStorefrontRl?: Mem };
  g.__fhStorefrontRl ??= { ip: new Map(), pickup: new Map(), locks: new Map(), prunedAt: 0 };
  return g.__fhStorefrontRl;
};

export function resetStorefrontRateLimits(): void {
  const m = mem();
  m.ip.clear(); m.pickup.clear(); m.prunedAt = 0;
}

/** Runs fn alone for this key in this process (a chain of promises: each caller waits for the previous one). */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = mem().locks;
  const prev = locks.get(key) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => { done = r; });
  const tail = prev.then(() => mine);
  locks.set(key, tail);
  await prev;
  try { return await fn(); } finally {
    done();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export const phoneHash = (phone: string) => crypto.createHash('sha256').update(`storefront|${phone}`).digest('hex').slice(0, 32);
const limitFor = (ip: string) => (ip === 'local' ? SHARED_IP_LIMIT : IP_LIMIT);

function recent(list: number[] | null | undefined, now: number, windowMs: number): number[] {
  return (Array.isArray(list) ? list : []).filter((t) => typeof t === 'number' && t > now - windowMs && t <= now + 60_000);
}
const retryAfter = (oldest: number, windowMs: number, now: number) => Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

/** Takes one slot in an in-memory bucket if there is room (synchronous: check and take in the same tick). */
function take(map: Map<string, number[]>, key: string, lim: { max: number; windowMs: number }, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const list = recent(map.get(key), now, lim.windowMs);
  if (list.length >= lim.max) { map.set(key, list); return { ok: false, retryAfterSec: retryAfter(list[0], lim.windowMs, now) }; }
  map.set(key, [...list, now]);
  if (map.size > 5000) map.delete(map.keys().next().value as string);
  return { ok: true };
}
function give(map: Map<string, number[]>, key: string, at: number): void {
  const list = map.get(key);
  const i = list?.indexOf(at) ?? -1;
  if (list && i >= 0) list.splice(i, 1);
}

type PhoneDoc = { hits: number[] };

async function prunePhones(now: number): Promise<void> {
  const m = mem();
  if (now - m.prunedAt < 10 * 60_000 && m.prunedAt <= now) return;
  m.prunedAt = now;
  const repo = getRepo();
  const old = await repo.listDocs<PhoneDoc>(PHONE_COL, { until: new Date(now - PHONE_KEEP_MS).toISOString(), limit: 500 }).catch(() => []);
  if (old.length) await repo.deleteDocs(PHONE_COL, old.map((d) => d.id)).catch(() => undefined);
}

export type Reservation = { release: () => Promise<void> };
export type ReserveResult = ({ ok: true } & Reservation) | { ok: false; retryAfterSec: number; by: 'ip' | 'phone' | 'page' };

/**
 * Reserves one order for this address, phone (and page, when paid at the counter). MUST be called before the caller's
 * first await: the address and page slots are taken synchronously. Refused → nothing stays reserved.
 */
export function reserveCheckout(ip: string, phone: string, opts: { slug: string; payAtPickup: boolean }, now = Date.now()): Promise<ReserveResult> {
  const m = mem();
  const lim = limitFor(ip);
  const byIp = take(m.ip, ip, lim, now);
  if (!byIp.ok) return Promise.resolve({ ok: false, by: 'ip', retryAfterSec: byIp.retryAfterSec });
  if (opts.payAtPickup) {
    const byPage = take(m.pickup, opts.slug, PICKUP_PAGE_LIMIT, now);
    if (!byPage.ok) { give(m.ip, ip, now); return Promise.resolve({ ok: false, by: 'page', retryAfterSec: byPage.retryAfterSec }); }
  }
  const releaseMem = () => { give(m.ip, ip, now); if (opts.payAtPickup) give(m.pickup, opts.slug, now); };
  const id = phoneHash(phone);
  return (async (): Promise<ReserveResult> => {
    const phoneOk = await withKeyLock(`sf_phone:${id}`, async () => {
      const repo = getRepo();
      const doc = await repo.getDoc<PhoneDoc>(PHONE_COL, id).catch(() => null);
      const hits = recent(doc?.data.hits, now, PHONE_LIMIT.windowMs);
      if (hits.length >= PHONE_LIMIT.max) return { ok: false as const, retryAfterSec: retryAfter(hits[0], PHONE_LIMIT.windowMs, now) };
      await repo.putDocs<PhoneDoc>(PHONE_COL, [{ id, at: new Date(now).toISOString(), data: { hits: [...hits, now] } }]);
      return { ok: true as const };
    }).catch(() => ({ ok: true as const })); // the store being down never blocks an order (the address limit still holds)
    if (!phoneOk.ok) { releaseMem(); return { ok: false, by: 'phone', retryAfterSec: phoneOk.retryAfterSec }; }
    void prunePhones(now).catch(() => undefined);
    let released = false;
    return {
      ok: true,
      release: async () => {
        if (released) return;
        released = true;
        releaseMem();
        await withKeyLock(`sf_phone:${id}`, async () => {
          const repo = getRepo();
          const doc = await repo.getDoc<PhoneDoc>(PHONE_COL, id);
          const hits = [...(doc?.data.hits ?? [])];
          const i = hits.indexOf(now);
          if (i < 0) return;
          hits.splice(i, 1);
          if (hits.length) await repo.putDocs<PhoneDoc>(PHONE_COL, [{ id, at: doc!.at ?? new Date(now).toISOString(), data: { hits } }]);
          else await repo.deleteDocs(PHONE_COL, [id]);
        }).catch(() => undefined);
      },
    };
  })();
}
