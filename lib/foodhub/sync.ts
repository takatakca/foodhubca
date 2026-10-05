// TAKATAK Food Hub — automatic sync engine.
//
// Every run (dashboard auto-trigger every 2 min, Vercel cron, or "Sync now"):
//   1. Re-opens stores whose timed pause has ended.
//   2. Reads the LIVE status of every mapped store from its platform
//      (Uber Eats store status, DoorDash store_details). Skip and Too Good To Go
//      push their status to us by webhook, so their last pushed state is kept.
//   3. Reads today's in-store sales from every Clover merchant (payments since local
//      midnight, minus refunds, excluding delivery orders Food Hub injected).
//   4. Saves one report the Command Center reads.
// Read-only status checks never change anything on a platform.
import { fetchDoorDashStoreStatus } from './adapters/doordash';
import { fetchUberStoreStatus } from './adapters/uber-eats';
import { nowIso } from './config';
import { logActivity } from './activity';
import { CHANNEL_LABELS } from './config';
import { pollCloverInventory } from './clover-sync';
import { settleInClover } from './clover-settle';
import { dailyReconciliation } from './recon/automation';
import { runDuePublishes } from './menu/schedule';
import { fireDueScheduled } from './scheduling';
import { applyHolidayClosures, reenableExpiredItems, reopenExpiredPauses } from './ops';
import { sendDueReports } from './reports';
import { cloverReadiness, cloverSalesSince, allCloverMerchants, type CloverSales } from './pos/clover';
import { importCloverPlatformOrders } from './pos/clover-platform-orders';
import { getRepo } from './repo';
import { startOfLocalDayMs } from './time';
import { runWatch, type WatchReport } from './watch/engine';
import type { ChannelKey, ChannelStore, PlatformState, PlatformStatus, StoredOrder } from './types';

export interface StoreSyncRow {
  storeId: string;
  channel: ChannelStore['channel'];
  brandName: string;
  locationCode: string;
  channelStoreId: string;
  polled: boolean;
  ok: boolean;
  state: PlatformState;
  detail?: string;
  error?: string;
  changed: boolean;
}

export interface SyncReport {
  at: string;
  durationMs: number;
  trigger: string;
  businessDayStart: string;
  reopened: number;
  /** Orders accepted/ready/dispatched for longer than FOODHUB_AUTO_COMPLETE_MIN (default 90) and closed automatically. */
  autoCompleted: number;
  /** Timed 86s that ended and were switched back on. */
  itemsReenabled: number;
  /** Skip stores taken offline for a closed holiday. */
  holidayClosures: number;
  /** Scheduled menu publishes that ran. */
  scheduledPublishes: number;
  /** Scheduled report emails sent. */
  reportsSent: number;
  /** Scheduled (advance) orders whose kitchen ticket went out this run. */
  scheduledFired: number;
  /** Clover inventory sync: items switched off / back on everywhere because of Clover, price changes seen. */
  cloverInventory: { turnedOff: number; turnedOn: number; priceChanges: number; errors: string[] };
  /** Once a day: reconciliation cases opened / closed. */
  recon: { opened: number; closed: number } | null;
  stores: StoreSyncRow[];
  clover: Array<CloverSales & { locationCodes: string[]; platformOrders?: number; platformOrdersError?: string }>;
  cloverConfigured: boolean;
  /** Per-platform problems of this run (a platform that stopped answering, Clover sales failures…). Partial reports are still saved. */
  platformErrors?: Partial<Record<ChannelKey | 'clover', string>>;
  /** Watchtower run that followed the sync. */
  watch?: WatchReport | null;
}

const LAST_KEY = 'sync:last';
const LOCK_KEY = '__foodhubSyncRunning';
/** KV claim so two dashboards / cron on separate serverless instances never run the housekeeping twice. */
const KV_LOCK_KEY = 'sync:lock';
const KV_LOCK_TTL_MS = 90_000;
/** Status reads are cheap: a platform that does not answer in this time is treated as unreadable, not waited for. */
const STATUS_READ_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_TIMEOUTS = 3;
type SyncLock = { at: string; id: string; done?: boolean };

function minIntervalMs() {
  return Math.max(10, Number(process.env.FOODHUB_SYNC_MIN_INTERVAL_S) || 60) * 1000;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function lastSyncReport(): Promise<SyncReport | null> {
  return getRepo().getKv<SyncReport>(LAST_KEY);
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

type Fetched = { ok: boolean; state: PlatformState; detail?: string; until?: string | null; error?: string };

/** Polls one store; `timedOut` reports back so the caller can stop hammering a platform that stopped answering. */
async function pollStore(store: ChannelStore, opts: { skipReason?: string; timedOut?: (v: boolean) => void } = {}): Promise<StoreSyncRow> {
  const base = { storeId: store.id, channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, channelStoreId: store.channelStoreId };
  const previous = (store.meta?.platformStatus ?? null) as PlatformStatus | null;
  let fetched: Fetched | null = null;
  const polled = store.channel === 'uber_eats' || store.channel === 'doordash';
  if (polled && opts.skipReason) {
    return { ...base, polled: true, ok: false, state: previous?.state ?? 'unknown', detail: previous?.detail, error: opts.skipReason, changed: false };
  }
  if (polled) {
    const read = store.channel === 'uber_eats' ? fetchUberStoreStatus(store.channelStoreId) : fetchDoorDashStoreStatus(store.channelStoreId);
    try {
      fetched = await withTimeout(read, STATUS_READ_TIMEOUT_MS, `${CHANNEL_LABELS[store.channel]} status read`);
      opts.timedOut?.(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      opts.timedOut?.(/timed out/.test(msg));
      fetched = { ok: false, state: 'unknown', error: msg };
    }
  }

  if (!fetched) {
    // Pushed by webhook (Skip offline notification) or set by us; keep the last known state.
    const state: PlatformState = previous?.state ?? (store.online ? 'online' : 'paused');
    return { ...base, polled: false, ok: true, state, detail: previous?.detail, changed: false };
  }

  if (!fetched.ok && fetched.state === 'unknown') {
    // Keep the last good state but record the error so the dashboard can flag it.
    const status: PlatformStatus = { ...(previous ?? { state: 'unknown', source: 'sync' }), checkedAt: nowIso(), source: 'sync', error: fetched.error } as PlatformStatus;
    await getRepo().updateStore(store.id, { meta: { ...store.meta, platformStatus: status } });
    return { ...base, polled: true, ok: false, state: previous?.state ?? 'unknown', detail: previous?.detail, error: fetched.error, changed: false };
  }

  // A pause made from TAKATAK stays "from TAKATAK" (with its reason and re-open time) as long as the platform agrees on the state.
  const keepDashboard = previous?.source === 'dashboard' && previous.state === fetched.state;
  const status: PlatformStatus = keepDashboard
    ? { ...previous, checkedAt: nowIso(), error: fetched.ok ? undefined : fetched.error }
    : { state: fetched.state, detail: fetched.detail, until: fetched.until ?? null, checkedAt: nowIso(), source: 'sync', error: fetched.ok ? undefined : fetched.error };
  const patch: Partial<ChannelStore> = { meta: { ...store.meta, platformStatus: status } };
  // The platform is the source of truth for whether the store takes orders.
  if (fetched.state === 'online' && !store.online) { patch.online = true; patch.pausedUntil = null; patch.lastStatusSource = `${store.channel}:platform`; }
  if ((fetched.state === 'paused' || fetched.state === 'deactivated') && store.online) {
    patch.online = false;
    patch.pausedUntil = fetched.state === 'paused' ? fetched.until ?? null : null;
    patch.lastStatusSource = `${store.channel}:platform`;
  }
  await getRepo().updateStore(store.id, patch);
  const changed = previous?.state !== fetched.state;
  if (changed && previous) {
    await logActivity({ actor: CHANNEL_LABELS[store.channel], source: 'platform', kind: 'store_status', action: `platform_${fetched.state}`, status: fetched.state === 'online' ? 'success' : 'info',
      channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
      summary: `${store.brandName} · ${store.locationCode} on ${CHANNEL_LABELS[store.channel]} is now ${fetched.state}${fetched.detail ? ` (${fetched.detail})` : ''}`, detail: { from: previous.state, to: fetched.state } });
  }
  return { ...base, polled: true, ok: fetched.ok, state: fetched.state, detail: fetched.detail, error: fetched.error, changed };
}

/** When the kitchen was expected to be done with an order: the later of arrival, fire time and ready target. */
export function autoCompleteBaseMs(o: Pick<StoredOrder, 'createdAt' | 'timeline'>): number {
  const created = new Date(o.createdAt).getTime();
  const expected = Date.parse(o.timeline?.fireAt ?? o.timeline?.readyTarget ?? o.createdAt);
  return Math.max(created, Number.isFinite(expected) ? expected : created);
}

/** Keeps "Orders to handle" clean: in-kitchen/ready orders older than the threshold are closed (logged). */
export async function autoCompleteOldOrders(now = Date.now()): Promise<number> {
  const minutes = Number(process.env.FOODHUB_AUTO_COMPLETE_MIN ?? 90);
  if (!(minutes > 0)) return 0;
  const repo = getRepo();
  // Scheduled (advance) orders wait for their fire time: their age only starts counting from fireAt, never before.
  const stale = (await repo.listOrders({ statuses: ['accepted', 'ready', 'dispatched'], limit: 1000 }))
    .filter((o) => !(o.timeline?.fireAt && Date.parse(o.timeline.fireAt) > now))
    .filter((o) => now - autoCompleteBaseMs(o) > minutes * 60_000)
    // Never sweep up ancient open orders (an upgrade, a long outage): only those expected done in the last 48 h.
    .filter((o) => now - autoCompleteBaseMs(o) < 48 * 3600_000);
  for (const o of stale) {
    const done = await repo.patchOrder(o.id, { completedAt: o.timeline?.completedAt ?? new Date(now).toISOString() }, { status: 'completed' });
    await repo.addEvent(o.id, 'auto_completed', { afterMinutes: minutes });
    await settleInClover(done); // closes the Clover order as paid
  }
  return stale.length;
}

export async function runSync(opts: { trigger?: string; force?: boolean } = {}): Promise<{ ran: boolean; reason?: string; report: SyncReport | null }> {
  const repo = getRepo();
  const last = await lastSyncReport();
  if (!opts.force && last && Date.now() - new Date(last.at).getTime() < minIntervalMs()) {
    return { ran: false, reason: `Last sync ${Math.round((Date.now() - new Date(last.at).getTime()) / 1000)} s ago`, report: last };
  }
  const g = globalThis as unknown as Record<string, boolean>;
  if (g[LOCK_KEY]) return { ran: false, reason: 'A sync is already running', report: last };
  // Claim the run in the KV store (serverless instances do not share memory); a fresh claim by another run wins.
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const held = await repo.getKv<SyncLock>(KV_LOCK_KEY).catch(() => null);
  if (held && !held.done && Date.now() - new Date(held.at).getTime() < KV_LOCK_TTL_MS) return { ran: false, reason: 'A sync is already running (another instance)', report: last };
  await repo.setKv(KV_LOCK_KEY, { at: nowIso(), id: runId } satisfies SyncLock).catch(() => undefined);
  const confirm = await repo.getKv<SyncLock>(KV_LOCK_KEY).catch(() => null);
  if (confirm && confirm.id !== runId) return { ran: false, reason: 'A sync is already running (another instance)', report: last };
  g[LOCK_KEY] = true;
  const started = Date.now();
  const platformErrors: NonNullable<SyncReport['platformErrors']> = {};
  try {
    const reopened = await reopenExpiredPauses().catch(() => []);
    const autoCompleted = await autoCompleteOldOrders().catch(() => 0);
    const itemsReenabled = await reenableExpiredItems().catch(() => 0);
    const holidayClosures = await applyHolidayClosures().catch(() => 0);
    const scheduledPublishes = await runDuePublishes().catch(() => 0);
    const reportsSent = await sendDueReports().catch(() => 0);
    const scheduledFired = await fireDueScheduled().catch(() => 0);
    const inv = await pollCloverInventory().catch((e) => ({ turnedOff: 0, turnedOn: 0, priceChanges: 0, errors: [String(e?.message ?? e)] }));
    const recon = await dailyReconciliation().catch(() => null);
    const stores = await repo.listStores();
    const dayStart = startOfLocalDayMs();
    const todays = await repo.listOrders({ since: new Date(dayStart).toISOString(), limit: 2000 });
    const injected = new Set(todays.map((o) => o.posOrderId).filter(Boolean) as string[]);
    const merchants = await allCloverMerchants(stores.map((s) => s.cloverMerchantId));

    // Each platform polls with its own pool, so one platform that hangs never starves the others; after
    // MAX_CONSECUTIVE_TIMEOUTS in a row the rest of that platform is skipped for this run (reported, not hidden).
    const errorRow = (s: ChannelStore, e: unknown): StoreSyncRow => ({
      storeId: s.id, channel: s.channel, brandName: s.brandName, locationCode: s.locationCode, channelStoreId: s.channelStoreId,
      polled: true, ok: false, state: 'unknown' as PlatformState, error: e instanceof Error ? e.message : String(e), changed: false,
    });
    const pollPlatform = (channel: ChannelKey) => {
      let streak = 0;
      return pool(stores.filter((s) => s.channel === channel), 4, (s) => {
        const skipReason = streak >= MAX_CONSECUTIVE_TIMEOUTS ? `${CHANNEL_LABELS[channel]} stopped answering (${streak} status reads timed out) — skipped for this run` : undefined;
        if (skipReason) platformErrors[channel] = skipReason;
        return pollStore(s, { skipReason, timedOut: (t) => { streak = t ? streak + 1 : 0; } }).catch((e) => errorRow(s, e));
      });
    };
    const groups: Array<[string, Promise<StoreSyncRow[]>]> = [
      ['uber_eats', pollPlatform('uber_eats')],
      ['doordash', pollPlatform('doordash')],
      ['push-only', pool(stores.filter((s) => s.channel !== 'uber_eats' && s.channel !== 'doordash'), 8, (s) => pollStore(s).catch((e) => errorRow(s, e)))],
    ];
    const cloverRun = pool(merchants, 3, async (mid) => {
      // Delivery orders that reached Clover through Clover's own platform integration: added to Food Hub
      // (read-only) and kept out of the in-store sales.
      const viaClover = await importCloverPlatformOrders(mid).catch((e) => ({ imported: 0, posOrderIds: [] as string[], error: String(e?.message ?? e) }));
      const excluded = new Set([...injected, ...viaClover.posOrderIds]);
      const sales = await cloverSalesSince(mid, dayStart, excluded);
      const locationCodes = [...new Set(stores.filter((s) => (s.cloverMerchantId || process.env.CLOVER_MERCHANT_ID) === mid).map((s) => s.locationCode))];
      return { ...sales, locationCodes, platformOrders: viaClover.imported, ...(viaClover.error ? { platformOrdersError: viaClover.error } : {}) };
    });
    const settled = await Promise.allSettled([...groups.map(([, p]) => p), cloverRun]);
    const storeRows: StoreSyncRow[] = [];
    groups.forEach(([name, _p], i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') storeRows.push(...(r.value as StoreSyncRow[]));
      else platformErrors[name as ChannelKey] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    });
    const cloverRes = settled[groups.length];
    const clover: SyncReport['clover'] = cloverRes.status === 'fulfilled' ? (cloverRes.value as SyncReport['clover']) : [];
    if (cloverRes.status === 'rejected') platformErrors.clover = cloverRes.reason instanceof Error ? cloverRes.reason.message : String(cloverRes.reason);
    storeRows.sort((a, b) => (a.brandName + a.locationCode + a.channel).localeCompare(b.brandName + b.locationCode + b.channel));

    const report: SyncReport = {
      at: nowIso(),
      durationMs: Date.now() - started,
      trigger: opts.trigger || 'manual',
      businessDayStart: new Date(dayStart).toISOString(),
      reopened: reopened.length,
      autoCompleted,
      itemsReenabled,
      holidayClosures,
      scheduledPublishes,
      reportsSent,
      scheduledFired,
      cloverInventory: { turnedOff: inv.turnedOff, turnedOn: inv.turnedOn, priceChanges: inv.priceChanges, errors: inv.errors },
      recon,
      stores: storeRows,
      clover,
      cloverConfigured: cloverReadiness().configured,
      ...(Object.keys(platformErrors).length ? { platformErrors } : {}),
    };
    await repo.setKv(LAST_KEY, report);
    // The Watchtower looks at the fresh statuses right away (tablets, late orders, stores…).
    report.watch = await runWatch({ trigger: `sync:${report.trigger}`, force: true }).catch(() => null);
    return { ran: true, report };
  } finally {
    g[LOCK_KEY] = false;
    // Release the claim (only ours); a run killed by the platform leaves it to expire after KV_LOCK_TTL_MS.
    const cur = await repo.getKv<SyncLock>(KV_LOCK_KEY).catch(() => null);
    if (!cur || cur.id === runId) await repo.setKv(KV_LOCK_KEY, { at: nowIso(), id: runId, done: true } satisfies SyncLock).catch(() => undefined);
  }
}
