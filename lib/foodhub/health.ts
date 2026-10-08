// /api/health — is Food Hub able to take orders right now? For an outside uptime monitor (it texts the owner when
// the answer is not 200) and for the Overview's "Connections" strip.
//   database   — can read and write within 4 s (memory mode: a demo; in production it is "down" — orders, users and
//                secrets would vanish at the next restart)
//   sync       — the platform sync is on time (timed re-opens, 86s, Clover sales, orders via Clover): see syncMaxAgeMin
//   watchtower — the supervisor ran in the last 5 minutes (it is what texts and calls when something is wrong)
//   recovery   — the order recovery runner (Clover retries, webhook inbox) is alive
//   inbox      — no webhook stuck or failing
//   clover     — Clover configured, its merchants answered the last sync, no order Clover still does not have
//   console    — the screens open: proxy.ts locks them all when live without DASHBOARD_PASSWORD, or with no session secret
// Status: "down" (HTTP 503) when an order could be missed or nobody would be alerted; "degraded" (200) for a warning.
// The public answer (anyone can call it) is computed at most once per HEALTH_CACHE_MS on Supabase, callers in flight
// share it, and every database read is time-bounded — a burst of requests never becomes a burst of reads.
import { CHANNEL_KEYS, getAdapter } from './adapters';
import { CHANNEL_LABELS } from './config';
import { liveConnectorsGloballyEnabled } from './env-utils';
import { inboxSummary } from './inbox';
import { lastOrderTimes } from './order-retry';
import { cloverReadiness } from './pos/clover';
import { lastRecoveryRun } from './recovery';
import { getRepo } from './repo';
import { sessionSecretSource } from './session';
import { lastSyncAt } from './sync';
import type { ChannelKey } from './types';

export type CheckStatus = 'ok' | 'warn' | 'down';
export interface HealthCheck { status: CheckStatus; detail: string; detailFr: string; at?: string | null; ageS?: number | null }
export interface PlatformHealth { channel: ChannelKey; label: string; mode: 'direct' | 'via_clover' | 'inbound' | 'not_connected'; live: boolean; stores: number; lastOrderAt: string | null }
export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  at: string;
  checks: Record<'database' | 'sync' | 'watchtower' | 'recovery' | 'inbox' | 'clover' | 'console', HealthCheck>;
  platforms: PlatformHealth[];
  version?: string;
}

const age = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);
const mins = (s: number | null) => (s === null ? '—' : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

export const HEALTH_DB_TIMEOUT_MS = 4_000;
export const HEALTH_CACHE_MS = 10_000;
const DEFAULT_SYNC_MAX_MIN = 20;

/**
 * Minutes after which a silent sync means the scheduler died ("down"), or 0 when nothing promises a regular sync
 * (then a late sync is only a warning). FOODHUB_HEALTH_SYNC_MAX_MIN wins (0 = never down on sync age). Otherwise a
 * regular sync is expected on a long-running server: the in-server timer (FOODHUB_INTERNAL_SYNC_MIN, which the Docker
 * image sets to 5) or, on any other production server, the installer's cron (every 5 min). Vercel has neither (its
 * built-in cron runs once a day): set the variable there once a pinger calls /api/foodhub/cron/sync.
 */
export function syncMaxAgeMin(): number {
  const set = process.env.FOODHUB_HEALTH_SYNC_MAX_MIN?.trim();
  if (set && Number.isFinite(Number(set))) return Math.max(0, Number(set));
  if (process.env.VERCEL) return 0;
  const every = Number(process.env.FOODHUB_INTERNAL_SYNC_MIN ?? 0);
  if (Number.isFinite(every) && every > 0) return Math.max(DEFAULT_SYNC_MAX_MIN, every * 2);
  return process.env.NODE_ENV === 'production' ? DEFAULT_SYNC_MAX_MIN : 0;
}

/** Rejects when the database does not answer in time (a hung connection must not hang the monitor too). */
function within<T>(p: Promise<T>, ms = HEALTH_DB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

let shared: { at: number; p: Promise<HealthReport> } | null = null;

/**
 * The public answer: one computation shared by every caller in flight, reused for HEALTH_CACHE_MS on Supabase. Memory
 * mode reads nothing remote, so it is computed fresh; a failed computation is never reused.
 */
export function cachedHealth(): Promise<HealthReport> {
  if (shared && Date.now() - shared.at < HEALTH_CACHE_MS) return shared.p;
  const p = buildHealth();
  const mine = { at: Date.now(), p };
  shared = mine;
  const drop = () => { if (shared === mine) shared = null; };
  p.then(() => { if (getRepo().mode === 'memory') drop(); }, drop);
  return p;
}

export async function buildHealth(opts: { now?: number; uptimeSec?: number } = {}): Promise<HealthReport> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const checks = {} as HealthReport['checks'];

  // Database: a real write and read-back, within HEALTH_DB_TIMEOUT_MS.
  try {
    const stamp = new Date(now).toISOString();
    const back = await within((async () => { await repo.setKv('health:ping', { at: stamp }); return repo.getKv<{ at: string }>('health:ping'); })());
    checks.database = back?.at !== stamp
      ? { status: 'down', detail: 'Database write could not be read back.', detailFr: 'Écriture dans la base de données non relue.' }
      : repo.mode !== 'memory'
        ? { status: 'ok', detail: 'Database reads and writes.', detailFr: 'La base de données lit et écrit.' }
        : process.env.NODE_ENV === 'production'
          ? { status: 'down', detail: 'No database (memory mode) on a production server: orders, users and secrets vanish at the next restart — connect Supabase.', detailFr: 'Pas de base de données (mode mémoire) en production : commandes, utilisateurs et secrets disparaissent au prochain redémarrage — branchez Supabase.' }
          : { status: 'warn', detail: 'Demo memory mode: nothing is kept across a restart — connect Supabase.', detailFr: 'Mode démo (mémoire) : rien n’est gardé au redémarrage — branchez Supabase.' };
  } catch (error) {
    // The reason stays in the server log (it could name the database host); the answer only says the database failed.
    console.error('[foodhub] health: database check failed —', error instanceof Error ? error.message : error);
    checks.database = { status: 'down', detail: 'The database did not answer (details in the server log).', detailFr: 'La base de données n’a pas répondu (détails dans le journal du serveur).' };
  }
  const dbDown = checks.database.status === 'down' && repo.mode !== 'memory';

  // A database that did not answer is not asked again for each check below.
  const read = <T,>(p: () => Promise<T>, fallback: T): Promise<T> => (dbDown ? Promise.resolve(fallback) : within(p()).catch(() => fallback));
  const [sync, watch, recovery, stores, last] = await Promise.all([
    read(() => lastSyncAt(), null),
    read(() => repo.getKv<{ at: string }>('watch:last'), null),
    read(() => lastRecoveryRun(), null),
    read(() => repo.listStores(), []),
    read(() => lastOrderTimes(), {} as Partial<Record<ChannelKey, string>>),
  ]);

  const syncAge = age(sync?.at, now);
  const maxMin = syncMaxAgeMin();
  if (syncAge === null) {
    // Never synced: a server that just started gets the time to run its first sync before it is called stale.
    const stale = maxMin > 0 && (opts.uptimeSec ?? process.uptime()) > maxMin * 60;
    checks.sync = { status: stale ? 'down' : 'warn', detail: stale ? `The platform sync never ran (server up for over ${maxMin} min): the scheduler is not running.` : 'The platform sync has not run yet.', detailFr: stale ? `La synchronisation n’a jamais roulé (serveur actif depuis plus de ${maxMin} min) : le planificateur ne tourne pas.` : 'La synchronisation n’a pas encore roulé.', at: null, ageS: null };
  } else {
    // With a promised schedule: on time, then late, then down (the scheduler died). Without one: never down.
    const status: CheckStatus = maxMin > 0 ? (syncAge <= (maxMin * 60) / 2 ? 'ok' : syncAge <= maxMin * 60 ? 'warn' : 'down') : syncAge <= 15 * 60 ? 'ok' : 'warn';
    checks.sync = { status, detail: `Last sync ${mins(syncAge)} ago.`, detailFr: `Dernière synchronisation il y a ${mins(syncAge)}.`, at: sync!.at, ageS: syncAge };
  }

  const watchAge = age(watch?.at, now);
  checks.watchtower = watchAge === null
    ? { status: 'down', detail: 'The Watchtower never ran: nobody would be alerted.', detailFr: 'Le Watchtower n’a jamais roulé : personne ne serait alerté.', at: null, ageS: null }
    : { status: watchAge <= 5 * 60 ? 'ok' : watchAge <= 15 * 60 ? 'warn' : 'down', detail: `Watchtower ran ${mins(watchAge)} ago.`, detailFr: `Le Watchtower a roulé il y a ${mins(watchAge)}.`, at: watch!.at, ageS: watchAge };

  const recAge = age(recovery?.at, now);
  checks.recovery = recAge === null
    ? { status: 'warn', detail: 'Order recovery (Clover retries, webhook inbox) has not run yet.', detailFr: 'La reprise des commandes (essais Clover, boîte de réception) n’a pas encore roulé.', at: null, ageS: null }
    : { status: recAge <= 5 * 60 ? 'ok' : recAge <= 15 * 60 ? 'warn' : 'down', detail: `Order recovery ran ${mins(recAge)} ago.`, detailFr: `Reprise des commandes il y a ${mins(recAge)}.`, at: recovery!.at, ageS: recAge };

  const inbox = await read(() => inboxSummary({ now }), null);
  checks.inbox = !inbox
    ? { status: 'warn', detail: 'Webhook inbox unreadable.', detailFr: 'Boîte de réception illisible.' }
    : inbox.stuck || inbox.failed
      ? { status: inbox.stuck ? 'down' : 'warn', detail: `${inbox.stuck} webhook(s) stuck, ${inbox.failed} failing — Settings → Platforms → Webhook inbox.`, detailFr: `${inbox.stuck} message(s) bloqué(s), ${inbox.failed} en échec — Réglages → Plateformes → Boîte de réception.`, at: inbox.lastAt }
      : { status: 'ok', detail: `Every webhook processed${inbox.waiting ? ` (${inbox.waiting} retry scheduled)` : ''}.`, detailFr: `Tous les messages traités${inbox.waiting ? ` (${inbox.waiting} nouvel essai prévu)` : ''}.`, at: inbox.lastAt };

  const clover = cloverReadiness();
  const open = await read(() => repo.listOrders({ statuses: ['new', 'accepted'], limit: 500 }), []);
  const notInClover = open.filter((o) => o.posError && !o.posOrderId && !o.viaPos);
  const gaveUp = notInClover.filter((o) => !o.timeline?.posRetry?.nextAt);
  const merchantsDown = sync?.cloverDown ?? 0;
  checks.clover = !clover.configured
    ? { status: 'warn', detail: 'Clover is not connected: orders do not reach the kitchen register.', detailFr: 'Clover n’est pas branché : les commandes n’arrivent pas à la caisse.' }
    : gaveUp.length
      ? { status: 'down', detail: `${gaveUp.length} open order(s) Clover did not receive.`, detailFr: `${gaveUp.length} commande(s) ouverte(s) que Clover n’a pas reçue(s).` }
      : notInClover.length || merchantsDown
        ? { status: 'warn', detail: `${notInClover.length} order(s) being retried in Clover; ${merchantsDown} merchant(s) did not answer the last sync.`, detailFr: `${notInClover.length} commande(s) en nouvel essai Clover ; ${merchantsDown} marchand(s) sans réponse à la dernière synchro.` }
        : { status: 'ok', detail: 'Clover receives the orders.', detailFr: 'Clover reçoit les commandes.' };

  // The same two conditions proxy.ts answers "Locked" for: then no screen opens, nobody can accept or pause anything.
  const noPassword = liveConnectorsGloballyEnabled() && !process.env.DASHBOARD_PASSWORD;
  checks.console = noPassword || !sessionSecretSource()
    ? { status: 'down', detail: noPassword ? 'Every screen is locked: live connectors are on without DASHBOARD_PASSWORD.' : 'Every screen is locked: no session secret (SESSION_SECRET) — sign-in cannot work.', detailFr: noPassword ? 'Tous les écrans sont verrouillés : connecteurs en direct sans DASHBOARD_PASSWORD.' : 'Tous les écrans sont verrouillés : pas de secret de session (SESSION_SECRET) — la connexion ne peut pas marcher.' }
    : { status: 'ok', detail: 'The screens open (sign-in works).', detailFr: 'Les écrans s’ouvrent (la connexion marche).' };

  const platforms: PlatformHealth[] = CHANNEL_KEYS.map((ch) => {
    const r = getAdapter(ch).readiness();
    const mode: PlatformHealth['mode'] = r.viaClover ? 'via_clover' : ch === 'tgtg' ? (r.configured ? 'inbound' : 'not_connected') : r.configured ? 'direct' : 'not_connected';
    return { channel: ch, label: CHANNEL_LABELS[ch], mode, live: r.canSend, stores: stores.filter((s) => s.channel === ch).length, lastOrderAt: last[ch] ?? null };
  });

  const all = Object.values(checks).map((c) => c.status);
  return {
    status: all.includes('down') ? 'down' : all.includes('warn') ? 'degraded' : 'ok',
    at: new Date(now).toISOString(),
    checks,
    platforms,
    version: process.env.npm_package_version,
  };
}
