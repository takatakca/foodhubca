// Health check for an outside uptime monitor (UptimeRobot, Better Stack…): GET /api/health, every 1–5 min.
// The Watchtower runs inside this same server, so it cannot text anyone about its own death — something outside
// has to watch the server. The route is public (proxy.ts, exact path), so the answer carries only what a monitor
// needs: up or down, why (fixed codes), and ages in seconds. Never a secret, an error message (it could name the
// database host), a store, brand or order, or any count. Cheap and time-bounded: two small key/value reads in
// parallel, no platform call, at most HEALTH_DB_TIMEOUT_MS.
import pkg from '../../package.json';
import { liveConnectorsGloballyEnabled } from './env-utils';
import { getRepo } from './repo';
import { sessionSecretSource } from './session';

/** Why the server is not healthy — fixed codes only, safe to show to anyone. */
export type HealthProblem =
  | 'database_unreachable'       // the key/value read failed or did not answer in time
  | 'memory_mode_in_production'  // no database: orders, users and secrets vanish at the next restart
  | 'sync_stale'                 // the scheduler (in-server timer or cron) stopped: re-opens, scheduled orders and statuses wait
  | 'console_locked';            // proxy.ts answers "Locked" to every screen (live without DASHBOARD_PASSWORD, or no session secret)

export interface HealthReport {
  ok: boolean;
  /** package.json version. */
  version: string;
  db: 'supabase' | 'memory' | 'error';
  dbOk: boolean;
  /** Seconds since the last platform sync was saved (null: never, or the database did not answer). */
  lastSyncAgeSec: number | null;
  /** Seconds since the Watchtower last ran (null: never, turned off in Settings → Alerts, or the database did not answer). */
  watchAgeSec: number | null;
  /** LIVE_CONNECTORS_GLOBAL_ENABLED: whether anything may be sent to the platforms. */
  liveConnectors: boolean;
  problems: HealthProblem[];
}

const HEALTH_DB_TIMEOUT_MS = 4_000;
const DEFAULT_SYNC_MAX_MIN = 20;

/**
 * Minutes after which a silent sync means the scheduler died, or 0 when nothing promises a regular sync.
 * FOODHUB_HEALTH_SYNC_MAX_MIN wins (0 = never fail on sync age). Otherwise a regular sync is expected on a long-running
 * server: the in-server timer (FOODHUB_INTERNAL_SYNC_MIN, which the Docker image sets to 5) or, on any other production
 * server, the VPS installer's cron (every 5 min). Vercel has neither (its built-in cron runs once a day): set the
 * variable there once a pinger calls /api/foodhub/cron/sync.
 */
export function syncMaxAgeMin(): number {
  const set = process.env.FOODHUB_HEALTH_SYNC_MAX_MIN?.trim();
  if (set && Number.isFinite(Number(set))) return Math.max(0, Number(set));
  if (process.env.VERCEL) return 0; // instrumentation.ts runs no timer there either
  const every = Number(process.env.FOODHUB_INTERNAL_SYNC_MIN ?? 0);
  if (Number.isFinite(every) && every > 0) return Math.max(DEFAULT_SYNC_MAX_MIN, every * 2);
  return process.env.NODE_ENV === 'production' ? DEFAULT_SYNC_MAX_MIN : 0;
}

function ageSec(at: unknown, now: number): number | null {
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Never throws: a broken database is an answer ("database_unreachable"), not a crash. */
export async function checkHealth(opts: { now?: number; uptimeSec?: number } = {}): Promise<HealthReport> {
  const now = opts.now ?? Date.now();
  const problems: HealthProblem[] = [];
  let mode: 'supabase' | 'memory' | null = null;
  let sync: { at?: unknown } | null = null;
  let watch: { at?: unknown } | null = null;
  try {
    const repo = getRepo(); // a malformed Supabase URL throws here
    mode = repo.mode;
    // sync:last is written by runSync, watch:last by runWatch (lib/foodhub/sync.ts, watch/engine.ts). Only `at` is read.
    [sync, watch] = await within(Promise.all([repo.getKv<{ at?: unknown }>('sync:last'), repo.getKv<{ at?: unknown }>('watch:last')]), HEALTH_DB_TIMEOUT_MS);
  } catch (e) {
    mode = null;
    problems.push('database_unreachable');
    // The reason stays in the server log: the public answer only says the database is unreachable.
    console.error('[foodhub] health: database check failed —', e instanceof Error ? e.message : e);
  }
  const dbOk = mode !== null;
  if (mode === 'memory' && process.env.NODE_ENV === 'production') problems.push('memory_mode_in_production');

  const lastSyncAgeSec = ageSec(sync?.at, now);
  const maxMin = syncMaxAgeMin();
  if (dbOk && maxMin > 0) {
    // Never synced: a server that just started gets the time to run its first sync before it is called stale.
    const stale = lastSyncAgeSec === null ? (opts.uptimeSec ?? process.uptime()) > maxMin * 60 : lastSyncAgeSec > maxMin * 60;
    if (stale) problems.push('sync_stale');
  }

  const live = liveConnectorsGloballyEnabled();
  if ((live && !process.env.DASHBOARD_PASSWORD) || !sessionSecretSource()) problems.push('console_locked');

  return { ok: problems.length === 0, version: pkg.version, db: mode ?? 'error', dbOk, lastSyncAgeSec, watchAgeSec: ageSec(watch?.at, now), liveConnectors: live, problems };
}
