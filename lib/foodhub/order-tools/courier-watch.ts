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
import type { CourierInfo, OrderEvent, StoredOrder } from '../types';

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

type OrderLike = Pick<StoredOrder, 'status' | 'fulfillment'> & { id?: string; timeline?: StoredOrder['timeline'] };
type EventLike = Pick<OrderEvent, 'type' | 'detail' | 'at'>;

const isReady = (o: OrderLike) => ['ready', 'dispatched', 'completed'].includes(o.status) || Boolean(o.timeline?.readyAt);

/**
 * "<order id>#<courier name>" → first time this screen saw that courier at the counter (ms). Survives a re-sent at_store
 * update; a new courier (another name) starts a new entry, and leaving at_store forgets the order (forgetAtStore).
 */
const atStoreSeen = new Map<string, number>();

const memoryKey = (orderId: string, name?: string) => `${orderId}#${name ?? ''}`;

/** Forgets what this screen remembered of the order's courier at the counter (status left at_store: reassigned…). */
export function forgetAtStore(orderId: string, memory: Map<string, number> = atStoreSeen): void {
  for (const k of [...memory.keys()]) if (k === orderId || k.startsWith(`${orderId}#`)) memory.delete(k);
}

/**
 * When the CURRENT courier really reached the counter. courier.updatedAt moves on EVERY courier update (a repeated
 * at_store webhook, an ETA refresh, a name change), so it is only the fallback: the earliest of the "courier" at_store
 * events of this courier's run, the first time this screen saw this courier at_store, and updatedAt.
 *
 * A run starts at the latest "courier" event that is NOT at_store (assigned, arriving, unassigned): when the platform
 * reassigns the order, the first courier's arrival no longer counts. An at_store event naming another courier does not
 * count either.
 */
export function atStoreSince(orderId: string | undefined, updatedAt: string, events: EventLike[] = [], memory: Map<string, number> = atStoreSeen, courierName?: string): string {
  const courierEvents = events.filter((e) => e.type === 'courier').map((e) => ({ ...e, ms: Date.parse(e.at) })).filter((e) => Number.isFinite(e.ms));
  const runStart = Math.max(-Infinity, ...courierEvents.filter((e) => e.detail?.status !== 'at_store').map((e) => e.ms));
  const sameCourier = (e: EventLike) => !courierName || !e.detail?.name || String(e.detail.name) === courierName;
  const times = [Date.parse(updatedAt), ...courierEvents.filter((e) => e.detail?.status === 'at_store' && e.ms >= runStart && sameCourier(e)).map((e) => e.ms)]
    .filter(Number.isFinite);
  const key = orderId ? memoryKey(orderId, courierName) : null;
  const seen = key ? memory.get(key) : undefined;
  if (seen !== undefined && seen >= runStart) times.push(seen);
  if (!times.length) return updatedAt;
  const first = Math.min(...times);
  if (key && seen !== first) {
    memory.set(key, first);
    if (memory.size > 500) memory.delete(memory.keys().next().value as string);
  }
  return new Date(first).toISOString();
}

export function courierWatchState(order: OrderLike, now = Date.now(), opts: { events?: EventLike[]; memory?: Map<string, number> } = {}): CourierWatch {
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
  // Not at the counter (any more): a later arrival is a new wait, never the old one continued.
  if (order.id && c?.status !== 'at_store') forgetAtStore(order.id, opts.memory);
  if (!c || c.status === 'unassigned') return { kind: 'none', chime: false };
  if (c.status === 'at_store') {
    const since = atStoreSince(order.id, c.updatedAt, opts.events, opts.memory, c.name);
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

/**
 * True the first time an order reaches a chiming state; false afterwards. Pass your own Set in tests.
 * late = the screen first showed this order when its courier ETA had already passed (an old order opened later): the
 * order is marked as chimed WITHOUT a sound, so opening it never beeps long after the 5-minute moment.
 */
export function chimeOnce(orderId: string, state: Pick<CourierWatch, 'chime'>, memory: Set<string> = chimed, late = false): boolean {
  if (!state.chime || memory.has(orderId)) return false;
  memory.add(orderId);
  if (memory.size > 500) memory.delete(memory.values().next().value as string);
  return !late;
}

/** The ETA is already behind us: "arriving" with 0 minutes left from a known ETA. */
export function etaPassed(state: Pick<CourierWatch, 'kind' | 'minutes' | 'etaAt'>): boolean {
  return state.kind === 'arriving' && Boolean(state.etaAt) && state.minutes === 0;
}

/** "mm:ss" (or "h:mm:ss" past an hour) for the waiting timer. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${String(m).padStart(2, '0')}:${r}`;
}
