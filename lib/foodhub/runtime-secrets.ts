// Internal secrets Food Hub creates for itself (webhook signing keys, the cron key) when the host did not set them —
// e.g. on Coolify, Render or Railway, where there is no `npm run setup`. They are made once, kept in the database
// (key/value store) so they survive redeploys, and loaded into process.env when the server starts. A value set in the
// environment always wins. Keys the owner must bring (Supabase, Clover, Uber…) are never generated here.
// SESSION_SECRET (signs sign-in and kitchen-tablet cookies) is generated the same way, in production only: without it
// a Coolify/Docker install signed sessions with a key derived from DASHBOARD_PASSWORD, or refused every request (503)
// when there was no password. Local development keeps its open dev mode. Changing it signs everyone out, so it is
// made once and kept.
import crypto from 'node:crypto';
import { getRepo } from './repo';

export const GENERATED_SECRET_KEYS = [
  'UBER_WEBHOOK_SIGNING_KEY',
  'DOORDASH_WEBHOOK_SECRET',
  'SKIP_WEBHOOK_HMAC_SECRET',
  'SKIP_WEBHOOK_API_KEY',
  'TGTG_WEBHOOK_SECRET',
  'FOODHUB_RELAY_SECRET',
  'CRON_SECRET',
] as const;

/** Generated only when NODE_ENV=production (development stays open without a secret). */
export const PRODUCTION_SECRET_KEYS = ['SESSION_SECRET'] as const;

const KV_KEY = 'generated_secrets_v1';

/** Fills the missing generated secrets. Returns the names that came from the store or were created. */
export async function ensureGeneratedSecrets(): Promise<{ loaded: string[]; created: string[] }> {
  const keys: string[] = [...GENERATED_SECRET_KEYS, ...(process.env.NODE_ENV === 'production' ? PRODUCTION_SECRET_KEYS : [])];
  const missing = keys.filter((k) => !process.env[k]);
  if (!missing.length) return { loaded: [], created: [] };
  const repo = getRepo();
  const stored = (await repo.getKv<Record<string, string>>(KV_KEY)) ?? {};
  const loaded: string[] = [];
  const created: string[] = [];
  for (const k of missing) {
    if (typeof stored[k] === 'string' && stored[k].length >= 32) {
      process.env[k] = stored[k];
      loaded.push(k);
    } else {
      stored[k] = crypto.randomBytes(k === 'SESSION_SECRET' ? 32 : 24).toString('hex');
      process.env[k] = stored[k];
      created.push(k);
    }
  }
  if (created.length) await repo.setKv(KV_KEY, stored);
  return { loaded, created };
}
