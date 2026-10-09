// Internal secrets Food Hub creates for itself (webhook signing keys, the cron key) when the host did not set them —
// e.g. on Coolify, Render or Railway, where there is no `npm run setup`. They are made once, kept in the database
// (key/value store) so they survive redeploys, and loaded into process.env when the server starts. A value set in the
// environment always wins. Keys the owner must bring (Supabase, Clover, Uber…) are never generated here.
// SESSION_SECRET (signs sign-in and kitchen-tablet cookies) is NEVER generated here. A key made at boot is not stable:
// with the database down at boot the process falls back to another key and the next healthy boot signs everyone out;
// two instances booting together each keep their own random key and refuse each other's cookies; in memory mode every
// restart signs everyone out. It comes from the host (npm run setup writes one), else lib/foodhub/session.ts derives
// it from DASHBOARD_PASSWORD, else production refuses to serve the console (503) — see Settings → Go-live.
import crypto from 'node:crypto';
import { getRepo } from './repo';

export const GENERATED_SECRET_KEYS = [
  'UBER_WEBHOOK_SIGNING_KEY',
  'DOORDASH_WEBHOOK_SECRET',
  'SKIP_WEBHOOK_HMAC_SECRET',
  'SKIP_WEBHOOK_API_KEY',
  'TGTG_WEBHOOK_SECRET',
  'FOODHUB_RELAY_SECRET',
  'DOORDASH_DRIVE_WEBHOOK_SECRET',
  'FOODHUB_WEBSITE_ORDER_SECRET',
  'CRON_SECRET',
] as const;

const KV_KEY = 'generated_secrets_v1';

/** Fills the missing generated secrets. Returns the names that came from the store or were created. */
export async function ensureGeneratedSecrets(): Promise<{ loaded: string[]; created: string[] }> {
  const missing = GENERATED_SECRET_KEYS.filter((k) => !process.env[k]);
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
      stored[k] = crypto.randomBytes(24).toString('hex');
      process.env[k] = stored[k];
      created.push(k);
    }
  }
  if (created.length) await repo.setKv(KV_KEY, stored);
  return { loaded, created };
}
