// Server-side facts for Settings → Go-live that the browser cannot see by itself (read from the environment and the
// store mappings; never a secret value, a token or a fingerprint).
//  - Clover: each mapped store is resolved to its register the way injectOrder does, so a store whose orders cannot
//    reach Clover (no merchant, no token, Clover app access expired) keeps the Clover row from turning green.
//  - SESSION_SECRET: set, long and stable. A short one-way fingerprint is kept to notice a host that makes a new one
//    at each deploy (everyone signed out each time, kitchen tablets included). How the secret is made is not decided
//    here (runtime-secrets.ts, the setup wizard).
import { createHash } from 'node:crypto';
import { isViaClover } from './adapters/via-clover';
import { inScope, type AuthUser } from './auth';
import { cloverInjectionEnabled, cloverTokenFor, defaultCloverMerchant } from './pos/clover';
import { listCloverConnections } from './pos/clover-oauth';
import { getRepo } from './repo';
import { sessionSecretSource, type SessionSecretSource } from './session';
import type { ChannelStore } from './types';

/** Shorter keys are flagged (npm run setup and `openssl rand -hex 32` give 64 characters). */
export const SESSION_SECRET_MIN_LENGTH = 32;
export const SESSION_SECRET_SEEN_KEY = 'golive:session-secret';

export interface SessionSecretCheck {
  /** Where the cookie key comes from: 'env' = SESSION_SECRET; 'password' = derived from DASHBOARD_PASSWORD; 'dev'; null = none (locked). */
  source: SessionSecretSource | null;
  set: boolean;
  strong: boolean;
  /** First time this SESSION_SECRET was seen (null: not set, too short, or the database did not answer). */
  since: string | null;
  /** When a different SESSION_SECRET than the one seen before was first seen (null: never changed). */
  changedAt: string | null;
}

type CloverStoreRoute = Pick<ChannelStore, 'channel' | 'brandName' | 'locationCode'>;

/** A mapped store whose orders cannot get into Clover, and why. */
export interface CloverStoreProblem extends CloverStoreRoute { merchantId: string | null; reason: 'no_merchant' | 'no_token' | 'reconnect' }

export interface GoLiveFacts {
  clover: { injectionEnabled: boolean; unreachableStores: CloverStoreProblem[]; defaultRoutedStores: CloverStoreRoute[] };
  sessionSecret: SessionSecretCheck;
}

/**
 * Resolve a mapped store as injectOrder does: its merchant, else the default. Check local credentials and describe
 * working fallback routes separately so the kitchen can verify the destination. Via-Clover stores already get orders.
 */
async function cloverRoutingFacts(actor: AuthUser, injectionEnabled: boolean): Promise<GoLiveFacts['clover']> {
  const unreachableStores: CloverStoreProblem[] = [];
  const defaultRoutedStores: CloverStoreRoute[] = [];
  const facts = { injectionEnabled, unreachableStores, defaultRoutedStores };
  if (!injectionEnabled) return facts;
  const [stores, connections, fallback] = await Promise.all([
    getRepo().listStores(), listCloverConnections().catch(() => []), defaultCloverMerchant().catch(() => null),
  ]);
  const app = new Map(connections.map((c) => [c.merchantId, c]));
  for (const s of stores) {
    if (!inScope(actor, s.locationCode) || isViaClover(s.channel)) continue;
    const mid = s.cloverMerchantId || fallback;
    const c = mid ? app.get(mid) : undefined;
    const reason = !mid ? 'no_merchant' : cloverTokenFor(mid) ? null : !c || c.status === 'pending' ? 'no_token' : c.needsReconnect ? 'reconnect' : null;
    const store = { channel: s.channel, brandName: s.brandName, locationCode: s.locationCode };
    if (reason) unreachableStores.push({ ...store, merchantId: mid ?? null, reason });
    else if (!s.cloverMerchantId) defaultRoutedStores.push(store);
  }
  return facts;
}

type Seen = { fp: string; since: string; changedAt?: string | null };

/** Is SESSION_SECRET set, long enough, and the same as before? Records its fingerprint the first time and on a change. */
export async function sessionSecretCheck(now = new Date()): Promise<SessionSecretCheck> {
  const secret = process.env.SESSION_SECRET || '';
  const out: SessionSecretCheck = { source: sessionSecretSource(), set: Boolean(secret), strong: secret.length >= SESSION_SECRET_MIN_LENGTH, since: null, changedAt: null };
  // A short key is flagged anyway; its fingerprint is not kept (it could be guessed offline from a database copy).
  if (!out.set || !out.strong) return out;
  const fp = createHash('sha256').update(`takatak-golive:${secret}`).digest('hex').slice(0, 16);
  try {
    const repo = getRepo();
    const seen = await repo.getKv<Seen>(SESSION_SECRET_SEEN_KEY);
    if (seen?.fp === fp) return { ...out, since: seen.since, changedAt: seen.changedAt ?? null };
    const at = now.toISOString();
    const next: Seen = { fp, since: at, changedAt: seen ? at : null };
    await repo.setKv(SESSION_SECRET_SEEN_KEY, next);
    return { ...out, since: at, changedAt: next.changedAt ?? null };
  } catch {
    return out; // database down: set and long is all that can be said
  }
}

export async function goLiveFacts(actor: AuthUser, now = new Date()): Promise<GoLiveFacts> {
  const injectionEnabled = cloverInjectionEnabled();
  const [clover, sessionSecret] = await Promise.all([
    cloverRoutingFacts(actor, injectionEnabled).catch(() => ({ injectionEnabled, unreachableStores: [], defaultRoutedStores: [] })),
    sessionSecretCheck(now),
  ]);
  return { clover, sessionSecret };
}
