// Kitchen order tools — courier watch: where the platform's courier is, in kitchen words.
//
//   assigned  "Livreur assigné, arrive vers HH:MM"
//   arriving  ETA 5 min or less (or the platform says "arriving"): highlighted, one discreet chime per order
//   waiting   courier at the counter and the order is NOT ready: red "Livreur attend depuis mm:ss"
//   here      courier at the counter and the order is ready: hand it over
//   gone      picked up: "Parti à HH:MM", planned vs actual
//   none      no courier info (pickup order, not assigned yet, cancelled order…)
//
// Pure (no server import): the screen and the tests both use it.
import type { CourierInfo, StoredOrder } from '../types';

export type CourierWatchKind = 'none' | 'assigned' | 'arriving' | 'waiting' | 'here' | 'gone';

export interface CourierWatch {
  kind: CourierWatchKind;
  /** assigned / arriving: whole minutes until the courier's ETA (0 = any moment now). waiting: whole minutes waited. */
  minutes?: number;
  /** waiting / here: since when the courier is at the counter; gone: when the order left. */
  since?: string;
  /** waiting: seconds the courier has been waiting (for the mm:ss timer). */
  seconds?: number;
  /** When the platform expects the courier at the counter. */
  etaAt?: string;
  /** gone: planned pick-up time (courier ETA, else the kitchen's ready target) and the real one. */
  plannedAt?: string;
  actualAt?: string;
  /** True for the state that deserves the single "arriving" chime (see chimeOnce). */
  chime: boolean;
  courierName?: string;
}

/** ETA at or under this many minutes = "arriving". */
export const ARRIVING_MINUTES = 5;

type OrderLike = Pick<StoredOrder, 'status' | 'fulfillment'> & { timeline?: StoredOrder['timeline'] };

const isReady = (o: OrderLike) => ['ready', 'dispatched', 'completed'].includes(o.status) || Boolean(o.timeline?.readyAt);

export function courierWatchState(order: OrderLike, now = Date.now()): CourierWatch {
  const tl = order.timeline ?? {};
  const c: CourierInfo | undefined = tl.courier;
  if (order.status === 'cancelled' || order.status === 'failed') return { kind: 'none', chime: false };
  const name = c?.name ? { courierName: c.name } : {};
  const left = tl.dispatchedAt ?? (c && (c.status === 'picked_up' || c.status === 'delivered') ? c.updatedAt : undefined);
  if (left || order.status === 'dispatched' || order.status === 'completed') {
    // A pickup order the customer took is not a courier story.
    if (!c && (!left || order.fulfillment !== 'delivery')) return { kind: 'none', chime: false };
    const planned = c?.etaAt ?? tl.readyTarget;
    return { kind: 'gone', since: left, actualAt: left, ...(planned ? { plannedAt: planned } : {}), chime: false, ...name };
  }
  if (!c || c.status === 'unassigned') return { kind: 'none', chime: false };
  if (c.status === 'at_store') {
    const since = c.updatedAt;
    const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
    if (!isReady(order)) return { kind: 'waiting', since, seconds, minutes: Math.floor(seconds / 60), chime: false, ...name, ...(c.etaAt ? { etaAt: c.etaAt } : {}) };
    return { kind: 'here', since, seconds, chime: false, ...name };
  }
  // assigned / arriving
  const eta = c.etaAt ? Date.parse(c.etaAt) : NaN;
  const minutes = Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - now) / 60_000)) : undefined;
  const near = c.status === 'arriving' || (minutes !== undefined && minutes <= ARRIVING_MINUTES);
  return {
    kind: near ? 'arriving' : 'assigned',
    ...(minutes !== undefined ? { minutes } : {}),
    ...(c.etaAt ? { etaAt: c.etaAt } : {}),
    chime: near,
    ...name,
  };
}

/** Order ids that already chimed on this screen (one chime per order, ever — never a loop). */
const chimed = new Set<string>();

/** True the first time an order reaches a chiming state; false afterwards. Pass your own Set in tests. */
export function chimeOnce(orderId: string, state: Pick<CourierWatch, 'chime'>, memory: Set<string> = chimed): boolean {
  if (!state.chime || memory.has(orderId)) return false;
  memory.add(orderId);
  if (memory.size > 500) memory.delete(memory.values().next().value as string);
  return true;
}

/** "mm:ss" (or "h:mm:ss" past an hour) for the waiting timer. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${String(m).padStart(2, '0')}:${r}`;
}
