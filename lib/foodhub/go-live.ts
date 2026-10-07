// Server-side facts for Settings → Go-live that the browser cannot see by itself (read from the environment; never a
// secret value, a token or a fingerprint). The checklist itself is built in lib/ui/go-live-core.ts.
//  - Clover: merchants with a token in the environment (CLOVER_MERCHANT_ID + CLOVER_ACCESS_TOKEN, CLOVER_MERCHANT_TOKENS
//    entries) and whether injection is on. Merchants connected through the Clover app come from the app list. Each
//    mapped store is also resolved to its register the way injectOrder does, so a store whose orders cannot reach
//    Clover (no merchant, no token, app access expired) keeps the row from turning green.
//  - SESSION_SECRET: required, long and stable. It is never generated at runtime like the webhook secrets
//    (runtime-secrets.ts): a key kept in the database is lost for good when the database does not answer at boot
//    (every session and tablet refused until a restart), two instances starting together each make their own, and
//    memory mode makes a new one at each restart. So the key has to come from the host. A short one-way
//    fingerprint is kept to notice a host that makes a new one at each deploy (everyone signed out each time).
import { createHash } from 'node:crypto';
import { isViaClover } from './adapters/via-clover';
import { cloverInjectionEnabled, cloverTokenFor, defaultCloverMerchant, envCloverMerchants } from './pos/clover';
import { listCloverConnections } from './pos/clover-oauth';
import { getRepo } from './repo';
import { sessionSecretSource, type SessionSecretSource } from './session';

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

/** A mapped store whose orders cannot get into Clover, and why (no merchant, no token, Clover app access expired). */
export interface CloverStoreProblem { channel: string; brandName: string; locationCode: string; merchantId: string | null; reason: 'no_merchant' | 'no_token' | 'reconnect' }

export interface GoLiveFacts {
  /** Merchant ids are not secrets (store mappings and the Clover app list show them too); tokens never leave the server. */
  clover: { envMerchantIds: string[]; tokenMapInvalid: boolean; injectionEnabled: boolean; unreachableStores?: CloverStoreProblem[] };
  sessionSecret: SessionSecretCheck;
}

/**
 * Mapped stores whose orders go through Food Hub (direct or relay:<id>) but cannot reach Clover, resolved exactly as
 * injectOrder does: the store's merchant, else the default one; then an env token, else an approved app connection
 * that has not expired. Stores on a platform linked through Clover's own integration are skipped (Clover has them).
 */
export async function cloverUnreachableStores(): Promise<CloverStoreProblem[]> {
  if (!cloverInjectionEnabled()) return [];
  const [stores, connections, fallback] = await Promise.all([
    getRepo().listStores(), listCloverConnections().catch(() => []), defaultCloverMerchant().catch(() => null),
  ]);
  const app = new Map(connections.map((c) => [c.merchantId, c]));
  const out: CloverStoreProblem[] = [];
  for (const s of stores) {
    if (isViaClover(s.channel)) continue;
    const mid = s.cloverMerchantId || fallback;
    const c = mid ? app.get(mid) : undefined;
    const reason = !mid ? 'no_merchant' : cloverTokenFor(mid) ? null : !c || c.status === 'pending' ? 'no_token' : c.needsReconnect ? 'reconnect' : null;
    if (reason) out.push({ channel: s.channel, brandName: s.brandName, locationCode: s.locationCode, merchantId: mid ?? null, reason });
  }
  return out;
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

export async function goLiveFacts(now = new Date()): Promise<GoLiveFacts> {
  const env = envCloverMerchants();
  const unreachableStores = await cloverUnreachableStores().catch(() => []);
  return {
    clover: { envMerchantIds: env.merchants, tokenMapInvalid: env.tokenMapInvalid, injectionEnabled: cloverInjectionEnabled(), unreachableStores },
    sessionSecret: await sessionSecretCheck(now),
  };
}
