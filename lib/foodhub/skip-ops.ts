// SkipTheDishes (JET Connect): what Food Hub does with the notifications and calls that are not the order itself.
//  - final picked order (the order after out-of-stock changes) → real total, event on the order
//  - modification callback (success / failure of an out-of-stock change) → event + alert on failure
//  - order-time notification → expected preparation window kept on the store
//  - onboarding notifications and the three onboarding calls → sessions kept, next step said in words
//  - opening hours → JET service times for every mapped Skip store
import { AUTOMATION, logActivity, type Actor } from './activity';
import { isRelayStore } from './adapters/relay';
import {
  goLiveSkipLocation, onboardSkipLocation, parseSkipModificationCallback, skipMarket, skipOnboardingNextStep, setSkipServiceTimes, submitSkipOnboardingConfiguration,
  type SkipOnboardingConfig, type SkipOnboardingNotice,
} from './adapters/skip-api';
import { nowIso, result } from './config';
import { effectiveHours, getHours } from './hours';
import { isMenuLocked } from './menu/lock';
import { getRepo } from './repo';
import { foodhubTimeZone } from './time';
import type { ChannelResult, ChannelStore, NormalizedOrder } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Final picked order

/** Quantity per item id (PLU) of an order's lines. */
function quantities(lines: Array<{ externalId?: string; name: string; quantity: number }>): Map<string, { name: string; quantity: number }> {
  const map = new Map<string, { name: string; quantity: number }>();
  for (const l of lines) {
    const key = l.externalId || l.name;
    const prev = map.get(key);
    map.set(key, { name: l.name, quantity: (prev?.quantity ?? 0) + (Number(l.quantity) || 0) });
  }
  return map;
}

export function finalOrderDifference(before: Array<{ externalId?: string; name: string; quantity: number }>, after: Array<{ externalId?: string; name: string; quantity: number }>): Array<{ name: string; ordered: number; final: number }> {
  const b = quantities(before);
  const a = quantities(after);
  const out: Array<{ name: string; ordered: number; final: number }> = [];
  for (const [key, row] of b) {
    const final = a.get(key)?.quantity ?? 0;
    if (final !== row.quantity) out.push({ name: row.name, ordered: row.quantity, final });
  }
  return out;
}

/**
 * JET "Final Picked Order": the order in its last state, after items were marked out of stock. The money of the stored
 * order follows it (payouts are paid on what the customer finally got); the original lines stay as they were cooked.
 */
export async function handleSkipFinalOrder(final: NormalizedOrder): Promise<{ applied: boolean; message: string; keep?: string }> {
  const repo = getRepo();
  const order = await repo.findOrder('skip', final.externalOrderId);
  if (!order) return { applied: false, message: 'No such order yet', keep: 'Skip final picked order for an order Food Hub does not have (yet)' };
  const removed = finalOrderDifference(order.lines, final.lines);
  const moneyChanged = [['total', order.total, final.total], ['subtotal', order.subtotal, final.subtotal], ['tax', order.tax, final.tax]].some(([, a, b]) => Math.abs(Number(a) - Number(b)) > 0.004);
  const summary = moneyChanged || removed.length
    ? `Final order from Skip: total ${order.total.toFixed(2)} → ${final.total.toFixed(2)}${removed.length ? `; ${removed.map((x) => `${x.name} ${x.ordered}→${x.final}`).join(', ')}` : ''}.`
    : 'Final order from Skip: nothing changed.';
  await repo.addEvent(order.id, 'skip_final_picked', { message: summary, previousTotal: order.total, finalTotal: final.total, changes: removed });
  if (moneyChanged) {
    await repo.updateOrder(order.id, { subtotal: final.subtotal, tax: final.tax, deliveryFee: final.deliveryFee, tip: final.tip, discount: final.discount, total: final.total });
    await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'order', action: 'skip_final_picked', status: 'info', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Skip #${order.displayId || order.externalOrderId.slice(0, 8)}: ${summary}` });
  }
  return { applied: moneyChanged, message: summary };
}

// ---------------------------------------------------------------------------------------------------------------------
// Modification callback

export async function handleSkipModificationCallback(body: unknown): Promise<{ applied: boolean; message: string; keep?: string }> {
  const cb = parseSkipModificationCallback(body);
  if (!cb) return { applied: false, message: 'Unreadable', keep: 'Skip modification callback without an order id or a success / failure type' };
  const repo = getRepo();
  const order = await repo.findOrder('skip', cb.orderId);
  if (!order) return { applied: false, message: 'No such order', keep: `Skip modification callback for an order Food Hub does not have (${cb.orderId})` };
  await repo.addEvent(order.id, cb.success ? 'skip_modification_succeeded' : 'skip_modification_failed', { message: cb.text, errors: cb.errors });
  if (!cb.success) {
    await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'order', action: 'skip_modification_failed', status: 'failed', channel: 'skip', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Skip #${order.displayId || order.externalOrderId.slice(0, 8)}: ${cb.text} Tell the customer or fix it on the Skip tablet.` });
  }
  return { applied: true, message: cb.text };
}

// ---------------------------------------------------------------------------------------------------------------------
// Order times

export async function handleSkipOrderTime(n: { restaurantId: string; serviceType: string; dayOfWeek: string; lowerBoundMinutes: number; upperBoundMinutes: number }): Promise<boolean> {
  const repo = getRepo();
  const store = await repo.findStore('skip', n.restaurantId);
  if (!store) return false;
  const prev = (store.meta as { skipOrderTimes?: Record<string, Record<string, unknown>> }).skipOrderTimes ?? {};
  const service = n.serviceType.toLowerCase();
  await repo.updateStore(store.id, { meta: { ...store.meta, skipOrderTimes: { ...prev, [service]: { ...(prev[service] ?? {}), [n.dayOfWeek.toLowerCase()]: { from: n.lowerBoundMinutes, to: n.upperBoundMinutes, at: nowIso() } } } } });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Partner onboarding

export const SKIP_ONBOARDING = 'skip_onboarding';
const PENDING_KEY = 'skip_onboarding_pending';

export interface SkipOnboardingSession {
  sessionId: string;
  stage: SkipOnboardingNotice['stage'];
  lastEvent: SkipOnboardingNotice['eventType'];
  nextStep: string;
  /** Our POS location id (set when the session could be tied to a start made here). */
  posLocationId?: string;
  market?: string;
  jetLocationId?: string;
  restaurant?: SkipOnboardingNotice['restaurant'];
  history: Array<{ at: string; eventType: string; stage: string; referenceId?: string }>;
  updatedAt: string;
}

interface PendingStart { market: string; jetLocationId: string; posLocationId?: string; at: string }

export async function listSkipOnboarding(): Promise<{ sessions: SkipOnboardingSession[]; pending: PendingStart[] }> {
  const repo = getRepo();
  const sessions = (await repo.listDocs<SkipOnboardingSession>(SKIP_ONBOARDING, {})).map((d) => d.data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pending = (await repo.getKv<PendingStart[]>(PENDING_KEY)) ?? [];
  return { sessions, pending };
}

/** Start onboarding of one JET location. The call is remembered so the session id that comes back can be tied to it. */
export async function startSkipOnboarding(input: { market: string; jetLocationId: string; posLocationId?: string }, actor: Actor): Promise<ChannelResult> {
  const res = await onboardSkipLocation(input.market, input.jetLocationId);
  if (res.ok) {
    const repo = getRepo();
    const pending = ((await repo.getKv<PendingStart[]>(PENDING_KEY)) ?? []).filter((p) => p.jetLocationId !== input.jetLocationId);
    pending.push({ market: skipMarket(input.market) ?? input.market, jetLocationId: input.jetLocationId, posLocationId: input.posLocationId, at: nowIso() });
    await repo.setKv(PENDING_KEY, pending.slice(-20));
  }
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'skip_onboarding_start', status: res.ok ? 'success' : 'failed', channel: 'skip', summary: `Skip onboarding of JET location ${input.jetLocationId}: ${res.message}` });
  return res;
}

export async function configureSkipOnboarding(sessionId: string, cfg: SkipOnboardingConfig, actor: Actor): Promise<ChannelResult> {
  const res = await submitSkipOnboardingConfiguration(sessionId, cfg);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'skip_onboarding_configure', status: res.ok ? 'success' : 'failed', channel: 'skip', summary: `Skip onboarding session ${sessionId.slice(0, 8)}: configuration — ${res.message}` });
  return res;
}

export async function goLiveSkipOnboarding(posLocationId: string, actor: Actor): Promise<ChannelResult> {
  const res = await goLiveSkipLocation(posLocationId);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'skip_onboarding_go_live', status: res.ok ? 'success' : 'failed', channel: 'skip', summary: `Skip go-live for ${posLocationId}: ${res.message}` });
  return res;
}

/** Keeps a signed onboarding notification: the session, where it stands, and what to do next. Best-effort ones are not retried by JET, so nothing is dropped. */
export async function recordSkipOnboarding(n: SkipOnboardingNotice): Promise<SkipOnboardingSession> {
  const repo = getRepo();
  const prev = (await repo.getDoc<SkipOnboardingSession>(SKIP_ONBOARDING, n.sessionId))?.data;
  const at = nowIso();
  let tie: Pick<SkipOnboardingSession, 'posLocationId' | 'market' | 'jetLocationId'> = prev ? { posLocationId: prev.posLocationId, market: prev.market, jetLocationId: prev.jetLocationId } : {};
  if (!prev) {
    // A new session while exactly one start from here is waiting (last 48 h): it is that one.
    const pending = ((await repo.getKv<PendingStart[]>(PENDING_KEY)) ?? []).filter((p) => Date.now() - Date.parse(p.at) < 48 * 3600_000);
    if (pending.length === 1) tie = { posLocationId: pending[0].posLocationId, market: pending[0].market, jetLocationId: pending[0].jetLocationId };
    if (pending.length === 1) await repo.setKv(PENDING_KEY, []);
  }
  const session: SkipOnboardingSession = {
    sessionId: n.sessionId, stage: n.stage, lastEvent: n.eventType, nextStep: skipOnboardingNextStep(n), ...tie, restaurant: n.restaurant ?? prev?.restaurant,
    history: [...(prev?.history ?? []), { at, eventType: n.eventType, stage: n.stage, referenceId: n.referenceId }].slice(-20), updatedAt: at,
  };
  await repo.putDocs(SKIP_ONBOARDING, [{ id: n.sessionId, key: n.sessionId, at, data: session }]);
  await logActivity({ actor: 'SkipTheDishes', source: 'platform', kind: 'settings', action: `skip_${n.eventType}`, status: n.eventType === 'onboardingLocationLive' ? 'success' : n.eventType === 'onboardingActionRequired' ? 'info' : 'failed', channel: 'skip',
    summary: `Skip onboarding${n.restaurant?.name ? ` of ${n.restaurant.name}` : ''} (${n.sessionId.slice(0, 8)}): ${session.nextStep}` });
  return session;
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening hours → JET service times

export interface SkipServiceTimesRow { storeId: string; brandName: string; locationCode: string; channelStoreId: string; result: ChannelResult }

/**
 * Sends the Food Hub opening hours to Skip as service times, for every mapped Skip store (or the chosen ones). Stores
 * whose menu is locked are never touched, and a store with no hours is skipped, not emptied.
 */
export async function pushSkipServiceTimes(opts: { storeIds?: string[]; inScope?: (locationCode: string) => boolean } = {}): Promise<SkipServiceTimesRow[]> {
  const repo = getRepo();
  const hours = await getHours();
  const stores: ChannelStore[] = (await repo.listStores('skip')).filter((s) => !isRelayStore(s) && (!opts.storeIds?.length || opts.storeIds.includes(s.id)) && (!opts.inScope || opts.inScope(s.locationCode)));
  const rows: SkipServiceTimesRow[] = [];
  for (const store of stores) {
    const week = effectiveHours(hours, store.brandName, store.locationCode);
    const res = isMenuLocked(store)
      ? result('skip', 'skipped', 'This store is locked: nothing is sent to it.')
      : await setSkipServiceTimes(store, week, foodhubTimeZone());
    rows.push({ storeId: store.id, brandName: store.brandName, locationCode: store.locationCode, channelStoreId: store.channelStoreId, result: res });
    await logActivity({ actor: AUTOMATION, source: 'automation', kind: 'hours', action: 'skip_service_times', status: res.ok ? (res.status === 'skipped' ? 'info' : 'success') : 'failed', channel: 'skip', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
      summary: `Skip service times for ${store.brandName} · ${store.locationCode}: ${res.message}` }).catch(() => undefined);
  }
  return rows;
}
