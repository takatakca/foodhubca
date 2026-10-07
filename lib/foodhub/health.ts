// /api/health — is Food Hub able to take orders right now? For an outside uptime monitor (it texts the owner when
// the answer is not 200) and for the Overview's "Connections" strip.
//   database   — can read and write (memory mode = demo: nothing survives a restart)
//   sync       — the platform sync ran in the last 15 minutes (timed re-opens, 86s, Clover sales, orders via Clover)
//   watchtower — the supervisor ran in the last 5 minutes (it is what texts and calls when something is wrong)
//   recovery   — the order recovery runner (Clover retries, webhook inbox) is alive
//   inbox      — no webhook stuck or failing
//   clover     — Clover configured, its merchants answered the last sync, no order Clover still does not have
// Status: "down" (HTTP 503) when an order could be missed or nobody would be alerted; "degraded" (200) for a warning.
import { CHANNEL_KEYS, getAdapter } from './adapters';
import { CHANNEL_LABELS } from './config';
import { inboxSummary } from './inbox';
import { lastOrderTimes } from './order-retry';
import { cloverReadiness } from './pos/clover';
import { lastRecoveryRun } from './recovery';
import { getRepo } from './repo';
import { lastSyncReport } from './sync';
import type { ChannelKey } from './types';

export type CheckStatus = 'ok' | 'warn' | 'down';
export interface HealthCheck { status: CheckStatus; detail: string; detailFr: string; at?: string | null; ageS?: number | null }
export interface PlatformHealth { channel: ChannelKey; label: string; mode: 'direct' | 'via_clover' | 'inbound' | 'not_connected'; live: boolean; stores: number; lastOrderAt: string | null }
export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  at: string;
  checks: Record<'database' | 'sync' | 'watchtower' | 'recovery' | 'inbox' | 'clover', HealthCheck>;
  platforms: PlatformHealth[];
  version?: string;
}

const age = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);
const mins = (s: number | null) => (s === null ? '—' : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

export async function buildHealth(opts: { now?: number } = {}): Promise<HealthReport> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const checks = {} as HealthReport['checks'];

  // Database: a real write and read-back.
  try {
    const stamp = new Date(now).toISOString();
    await repo.setKv('health:ping', { at: stamp });
    const back = await repo.getKv<{ at: string }>('health:ping');
    checks.database = back?.at === stamp
      ? repo.mode === 'memory'
        ? { status: 'warn', detail: 'Demo memory mode: nothing is kept across a restart — connect Supabase.', detailFr: 'Mode démo (mémoire) : rien n’est gardé au redémarrage — branchez Supabase.' }
        : { status: 'ok', detail: 'Database reads and writes.', detailFr: 'La base de données lit et écrit.' }
      : { status: 'down', detail: 'Database write could not be read back.', detailFr: 'Écriture dans la base de données non relue.' };
  } catch (error) {
    checks.database = { status: 'down', detail: `Database error: ${error instanceof Error ? error.message : String(error)}`, detailFr: 'Erreur de base de données.' };
  }

  const [sync, watch, recovery, stores, last] = await Promise.all([
    lastSyncReport().catch(() => null),
    repo.getKv<{ at: string }>('watch:last').catch(() => null),
    lastRecoveryRun().catch(() => null),
    repo.listStores().catch(() => []),
    lastOrderTimes().catch(() => ({} as Partial<Record<ChannelKey, string>>)),
  ]);

  const syncAge = age(sync?.at, now);
  checks.sync = syncAge === null
    ? { status: 'warn', detail: 'The platform sync never ran.', detailFr: 'La synchronisation n’a jamais roulé.', at: null, ageS: null }
    : { status: syncAge <= 15 * 60 ? 'ok' : syncAge <= 45 * 60 ? 'warn' : 'down', detail: `Last sync ${mins(syncAge)} ago.`, detailFr: `Dernière synchronisation il y a ${mins(syncAge)}.`, at: sync!.at, ageS: syncAge };

  const watchAge = age(watch?.at, now);
  checks.watchtower = watchAge === null
    ? { status: 'down', detail: 'The Watchtower never ran: nobody would be alerted.', detailFr: 'Le Watchtower n’a jamais roulé : personne ne serait alerté.', at: null, ageS: null }
    : { status: watchAge <= 5 * 60 ? 'ok' : watchAge <= 15 * 60 ? 'warn' : 'down', detail: `Watchtower ran ${mins(watchAge)} ago.`, detailFr: `Le Watchtower a roulé il y a ${mins(watchAge)}.`, at: watch!.at, ageS: watchAge };

  const recAge = age(recovery?.at, now);
  checks.recovery = recAge === null
    ? { status: 'warn', detail: 'Order recovery (Clover retries, webhook inbox) has not run yet.', detailFr: 'La reprise des commandes (essais Clover, boîte de réception) n’a pas encore roulé.', at: null, ageS: null }
    : { status: recAge <= 5 * 60 ? 'ok' : recAge <= 15 * 60 ? 'warn' : 'down', detail: `Order recovery ran ${mins(recAge)} ago.`, detailFr: `Reprise des commandes il y a ${mins(recAge)}.`, at: recovery!.at, ageS: recAge };

  const inbox = await inboxSummary({ now }).catch(() => null);
  checks.inbox = !inbox
    ? { status: 'warn', detail: 'Webhook inbox unreadable.', detailFr: 'Boîte de réception illisible.' }
    : inbox.stuck || inbox.failed
      ? { status: inbox.stuck ? 'down' : 'warn', detail: `${inbox.stuck} webhook(s) stuck, ${inbox.failed} failing — Settings → Platforms → Webhook inbox.`, detailFr: `${inbox.stuck} message(s) bloqué(s), ${inbox.failed} en échec — Réglages → Plateformes → Boîte de réception.`, at: inbox.lastAt }
      : { status: 'ok', detail: `Every webhook processed${inbox.waiting ? ` (${inbox.waiting} retry scheduled)` : ''}.`, detailFr: `Tous les messages traités${inbox.waiting ? ` (${inbox.waiting} nouvel essai prévu)` : ''}.`, at: inbox.lastAt };

  const clover = cloverReadiness();
  const open = await repo.listOrders({ statuses: ['new', 'accepted'], limit: 500 }).catch(() => []);
  const notInClover = open.filter((o) => o.posError && !o.posOrderId && !o.viaPos);
  const gaveUp = notInClover.filter((o) => !o.timeline?.posRetry?.nextAt);
  const merchantsDown = (sync?.clover ?? []).filter((c) => !c.ok);
  checks.clover = !clover.configured
    ? { status: 'warn', detail: 'Clover is not connected: orders do not reach the kitchen register.', detailFr: 'Clover n’est pas branché : les commandes n’arrivent pas à la caisse.' }
    : gaveUp.length
      ? { status: 'down', detail: `${gaveUp.length} open order(s) Clover did not receive.`, detailFr: `${gaveUp.length} commande(s) ouverte(s) que Clover n’a pas reçue(s).` }
      : notInClover.length || merchantsDown.length
        ? { status: 'warn', detail: `${notInClover.length} order(s) being retried in Clover; ${merchantsDown.length} merchant(s) did not answer the last sync.`, detailFr: `${notInClover.length} commande(s) en nouvel essai Clover ; ${merchantsDown.length} marchand(s) sans réponse à la dernière synchro.` }
        : { status: 'ok', detail: 'Clover receives the orders.', detailFr: 'Clover reçoit les commandes.' };

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
