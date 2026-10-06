// Courier / driver tracking across platforms (UrbanPiper "rider status").
//   SkipTheDishes (JET Connect "Driver Status Notification"): driverArrivingAtRestaurant, driverAtRestaurant, onItsWay, delivered
//   DoorDash (Dasher Status webhooks): dasher_assigned / dasher_confirmed, arriving_at_store (400 m away), picked up, dropped off
//   Uber Eats: courier details inside the order payload when Uber shares them
// Picked up → the order moves to "Picked up"; delivered → "Completed".
import { logActivity } from './activity';
import { CHANNEL_LABELS, nowIso } from './config';
import { settleInClover } from './clover-settle';
import { getRepo } from './repo';
import type { ChannelKey, CourierInfo, CourierStatus, OrderTimeline, StoredOrder } from './types';

/**
 * Platform events (cancel, courier) that arrive before the order itself is stored — Uber's order fetch can take
 * seconds, and webhook deliveries are not ordered. They wait in the KV store and the pipeline applies them
 * right after the insert (a pending cancel stops injection and acceptance).
 */
export interface PendingPlatformEvents {
  status?: { platformState: string; detail: Record<string, unknown>; at: string };
  courier?: Array<{ update: Partial<CourierInfo> & { status: CourierStatus }; source: string; at: string }>;
  consumedAt?: string;
}
export const pendingKey = (channel: ChannelKey, externalOrderId: string) => `pending:${channel}:${externalOrderId}`;
export async function readPending(channel: ChannelKey, externalOrderId: string): Promise<PendingPlatformEvents | null> {
  const p = await getRepo().getKv<PendingPlatformEvents>(pendingKey(channel, externalOrderId)).catch(() => null);
  return p && !p.consumedAt ? p : null;
}

export const COURIER_LABEL: Record<CourierStatus, string> = {
  assigned: 'Courier assigned', arriving: 'Courier arriving', at_store: 'Courier at the store', picked_up: 'Picked up', delivered: 'Delivered', unassigned: 'Courier unassigned',
};

const SKIP_CODES: Record<string, CourierStatus> = {
  driverarrivingatrestaurant: 'arriving', driveratrestaurant: 'at_store', onitsway: 'picked_up', delivered: 'delivered',
  driverassigned: 'assigned', driverunassigned: 'unassigned',
};

export function skipCourierStatus(code: unknown): CourierStatus | null {
  return SKIP_CODES[String(code ?? '').replace(/[^a-z]/gi, '').toLowerCase()] ?? null;
}

/** DoorDash dasher events (names vary by integration type, so match on meaning). */
export function doorDashCourierStatus(eventType: string): CourierStatus | null {
  const e = eventType.toLowerCase();
  if (!/dasher|arriving|arrived|courier|driver|picked|dropped|dropoff|out_for_delivery/.test(e)) return null;
  if (/unassign/.test(e)) return 'unassigned';
  if (/dropped|delivered|drop_off|dropoff/.test(e)) return 'delivered';
  // DoorDash's dasher_out_for_delivery = the Dasher left the store with the food.
  if (/picked|pick_up|pickup_complete|out_for_delivery/.test(e)) return 'picked_up';
  if (/arriving/.test(e)) return 'arriving';
  if (/arrived|at_store|at_merchant|at_restaurant/.test(e)) return 'at_store';
  if (/assign|confirm/.test(e)) return 'assigned';
  return null;
}

const str = (...v: unknown[]) => { for (const x of v) if (typeof x === 'string' && x.trim()) return x.trim(); return undefined; };
const iso = (v: unknown) => { const t = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v ?? '')); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : undefined; };

/** Courier details from a DoorDash dasher payload (field names differ between DoorDash products). */
export function doorDashCourierDetails(body: any): Partial<CourierInfo> {
  const d = body?.dasher ?? body?.courier ?? body?.order?.dasher ?? {};
  const v = d.vehicle ?? body?.dasher_vehicle ?? {};
  return {
    name: str(d.first_name && `${d.first_name}${d.last_name ? ` ${String(d.last_name).slice(0, 1)}.` : ''}`, d.name, body?.dasher_name),
    phone: str(d.phone_number, d.phone, body?.dasher_phone_number, body?.Phone_number, body?.phone_number),
    vehicle: str([v.color, v.make, v.model].filter(Boolean).join(' '), typeof v === 'string' ? v : undefined),
    etaAt: iso(body?.estimated_pickup_time ?? body?.dasher_estimated_arrival_time ?? d.estimated_arrival_time ?? body?.pickup_time_estimated),
  };
}

/** Uber courier state (delivery.state_changed meta.status, or an order's deliveries[].current_state) → courier status. */
export function uberCourierState(state: unknown): CourierStatus | null {
  const s = String(state ?? '').toLowerCase().replace(/[^a-z]+/g, '_');
  if (!s) return null;
  if (/unassign/.test(s)) return 'unassigned'; // before "assigned": "unassigned" contains it
  if (/complete|delivered|dropoff_complete/.test(s)) return 'delivered';
  if (/en_route_to_drop|picked_up|pickup_complete|left_pickup/.test(s)) return 'picked_up';
  if (/arrived_at_pick|at_pickup|at_store|at_restaurant/.test(s)) return 'at_store';
  if (/en_route_to_pick|assigned|accepted/.test(s)) return 'assigned';
  return null;
}

/**
 * Courier details inside an Uber Eats order payload, when Uber shares them. Uber's v2 order puts the courier
 * directly on deliveries[] (first_name, phone, vehicle, current_state); older shapes nest it under delivery_partner.
 */
export function uberCourierDetails(o: any): Partial<CourierInfo> | undefined {
  const del = Array.isArray(o?.deliveries) ? o.deliveries[0] : o?.delivery;
  const p = del?.delivery_partner ?? del?.courier ?? o?.courier ?? (del?.first_name || del?.name ? del : undefined);
  if (!p && !del) return undefined;
  const mapped = uberCourierState(del?.current_state ?? del?.status ?? del?.current_status) ?? undefined;
  const v = p?.vehicle;
  return {
    ...(mapped ? { status: mapped } : {}),
    name: str(p?.name, p?.first_name),
    phone: str(p?.phone_number, p?.phone, p?.phone_code && p?.phone ? `${p.phone} (${p.phone_code})` : undefined),
    vehicle: str(v && typeof v === 'object' ? [v.color, v.make, v.model, v.type].filter(Boolean).join(' ') : undefined, typeof v === 'string' ? v : undefined),
    etaAt: iso(del?.estimated_pick_up_time ?? del?.estimated_pickup_time ?? o?.estimated_courier_arrival),
  };
}

/** Saves a courier update on the order and moves the order forward when the courier picks it up / delivers it. */
export async function applyCourierUpdate(channel: ChannelKey, externalOrderId: string, update: Partial<CourierInfo> & { status: CourierStatus }, source: string): Promise<StoredOrder | null> {
  const repo = getRepo();
  let order = await repo.findOrder(channel, externalOrderId);
  if (!order) {
    // Not stored yet: keep the update for the pipeline instead of dropping it.
    const prev = (await readPending(channel, externalOrderId)) ?? {};
    const parked = { ...prev, courier: [...(prev.courier ?? []), { update, source, at: nowIso() }] };
    await repo.setKv(pendingKey(channel, externalOrderId), parked).catch(() => undefined);
    // Inserted while we parked it: apply now and mark the note consumed so the pipeline does not apply it twice.
    order = await repo.findOrder(channel, externalOrderId);
    if (!order) return null;
    await repo.setKv(pendingKey(channel, externalOrderId), { ...parked, consumedAt: nowIso() }).catch(() => undefined);
  }
  const now = nowIso();
  const clean = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined && v !== '')) as Partial<CourierInfo>;
  const courier: CourierInfo = { ...(order.timeline?.courier ?? {}), ...clean, status: update.status, updatedAt: now, source } as CourierInfo;
  const patch: OrderTimeline = { courier };
  let status = order.status;
  if (update.status === 'picked_up' && ['new', 'accepted', 'ready'].includes(order.status)) {
    status = 'dispatched';
    patch.dispatchedAt = order.timeline?.dispatchedAt ?? now;
    patch.readyAt = order.timeline?.readyAt ?? now;
  }
  if (update.status === 'delivered' && !['cancelled', 'completed'].includes(order.status)) {
    status = 'completed';
    patch.dispatchedAt = order.timeline?.dispatchedAt ?? now;
    patch.completedAt = order.timeline?.completedAt ?? now;
  }
  // Patch (not replace) the timeline so an operator click in flight does not lose the courier block, and vice versa.
  let saved = await repo.patchOrder(order.id, patch, { status });
  if (status !== order.status) saved = await settleInClover(saved); // picked up / delivered → paid in Clover
  await repo.addEvent(order.id, 'courier', { status: update.status, name: courier.name, etaAt: courier.etaAt, source, message: COURIER_LABEL[update.status] });
  if (status !== order.status) {
    await logActivity({ actor: CHANNEL_LABELS[channel], source: 'platform', kind: 'order', action: `courier_${update.status}`, status: 'info', channel, brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `${CHANNEL_LABELS[channel]} #${order.displayId || order.externalOrderId.slice(0, 8)}: ${COURIER_LABEL[update.status]}${courier.name ? ` (${courier.name})` : ''}` });
  }
  return saved;
}
