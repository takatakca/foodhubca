// "Never lose an order" — the small pieces the pipeline needs without importing the runners (recovery.ts):
//  - the automatic Clover retry schedule: when Clover does not take an order, Food Hub tries again by itself after
//    30 s and 2 min (FOODHUB_CLOVER_RETRY_S="30,120"; "off" = manual "Send to Clover" only) before the Watchtower
//    wakes a manager. Nothing is accepted on the platform until Clover has the order.
//  - the time of the last order per platform (silence alarm, /api/health, Overview).
import { nowIso } from './config';
import { getRepo } from './repo';
import type { ChannelKey, StoredOrder } from './types';

/** Seconds between automatic Clover attempts after the first failure. */
export function cloverRetryDelaysS(): number[] {
  const raw = String(process.env.FOODHUB_CLOVER_RETRY_S ?? '30,120').trim();
  if (/^(off|0|none|false)$/i.test(raw)) return [];
  const list = raw.split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.min(Math.round(n), 3600));
  return list.length ? list.slice(0, 5) : [30, 120];
}

export interface PosRetryState {
  /** Automatic attempts already made after the first failure. */
  attempts: number;
  /** When the next automatic attempt is due (null = none left / done). */
  nextAt: string | null;
  lastError?: string;
  /** The last failure may have created the order anyway (time-out, 5xx): look in Clover before sending again. */
  uncertain?: boolean;
  gaveUpAt?: string;
  doneAt?: string;
  /** Claim held by the runner working on it (several servers / timers never retry the same order twice at once). */
  claim?: string;
  claimedAt?: string;
}

/** Automatic Clover tries stop this long after the order arrived (a manager is alerted; "Send to Clover" still works). */
export const CLOVER_RETRY_WINDOW_MS = 30 * 60_000;

/**
 * Is this order still one Food Hub may send to Clover by itself? Waiting ("new"), or accepted on the platform's side
 * (the kitchen still needs it) — never one a person accepted here ("Accept without Clover" = entered in Clover by hand:
 * a retry would ring it up twice), nor one followed through Clover's own integration, cancelled or closed.
 */
export function cloverRetryOpen(o: Pick<StoredOrder, 'status' | 'posOrderId' | 'viaPos' | 'timeline'>): boolean {
  if (o.posOrderId || o.viaPos) return false;
  return o.status === 'new' || (o.status === 'accepted' && !o.timeline?.acceptedBy);
}

/**
 * Arms the automatic Clover retry for an order Clover did not take (cloverRetryOpen). Returns false when automatic
 * retries are off or the order is no longer one to send by itself.
 */
export async function scheduleCloverRetry(order: StoredOrder, pos: { error: string; uncertain?: boolean }): Promise<boolean> {
  const delays = cloverRetryDelaysS();
  if (!delays.length || !cloverRetryOpen(order)) return false;
  const nextAt = new Date(Date.now() + delays[0] * 1000).toISOString();
  const posRetry: PosRetryState = { attempts: 0, nextAt, lastError: pos.error, ...(pos.uncertain ? { uncertain: true } : {}) };
  await getRepo().patchOrder(order.id, { posRetry });
  await getRepo().addEvent(order.id, 'pos_retry_scheduled', { message: `Clover will be tried again at ${nextAt} (then ${delays.slice(1).map((s) => `+${s} s`).join(', ') || 'no more'}).`, nextAt });
  armRetryTimer(delays[0] * 1000);
  return true;
}

/**
 * Best effort on a long-running server: run the retries right when they are due. The Watchtower timer, the cron and
 * every open screen also run them (recovery.ts), so a restart or a serverless host loses nothing.
 */
export function armRetryTimer(ms: number) {
  if (process.env.VERCEL || process.env.FOODHUB_RETRY_TIMER === 'off') return;
  const t = setTimeout(() => {
    import('./recovery').then((m) => m.runCloverRetries({ trigger: 'timer' })).catch((e) => console.error('[foodhub] Clover retry timer failed', e instanceof Error ? e.message : e));
  }, Math.max(1000, ms + 500));
  t.unref?.();
}

const LAST_ORDER_KEY = 'orders:last_at';

/** Remembers when each platform last sent an order (any order, from any path). */
export async function noteLastOrder(channel: ChannelKey, at: string = nowIso()) {
  const repo = getRepo();
  const cur = (await repo.getKv<Partial<Record<ChannelKey, string>>>(LAST_ORDER_KEY).catch(() => null)) ?? {};
  if (cur[channel] && cur[channel]! >= at) return;
  await repo.setKv(LAST_ORDER_KEY, { ...cur, [channel]: at }).catch(() => undefined);
}

export async function lastOrderTimes(): Promise<Partial<Record<ChannelKey, string>>> {
  return (await getRepo().getKv<Partial<Record<ChannelKey, string>>>(LAST_ORDER_KEY).catch(() => null)) ?? {};
}
