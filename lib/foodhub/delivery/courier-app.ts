// The courier's page (/courier) for our own couriers: what he sees and the taps that move a delivery.
// Each tap goes through applyFleetEvent, exactly like a DoorDash Drive or Uber Direct webhook: statuses only move
// forward, "picked up" puts the order on the road, "delivered" completes it, a decline or a problem flags the order for a
// person and posts to the team chat. A courier only ever sees and touches the deliveries assigned to him, and only
// while they run (the customer's address and phone disappear from his page once the delivery is over).
import { getCatalog } from '../catalog';
import { nowIso } from '../config';
import { normalizePhone, postToChat } from '../notify';
import { applyFleetEvent } from './dispatch';
import { courierFromToken, runningFor, setShift, touchCourier, type OwnCourier } from './own-fleet';
import { addDirectEvent, getDelivery, getDirectOrder } from './store';
import { TERMINAL, type DeliveryStatus } from './types';

export interface CourierStop {
  deliveryId: string;
  status: DeliveryStatus;
  number: string;
  brand: string;
  pickup: { name: string; address: string; phone: string };
  dropoff: { name: string; address: string; unit?: string; instructions?: string; phone: string };
  items: number;
  containsAlcohol: boolean;
  paid: boolean;
  tip: number;
  readyAt?: string;
  notes?: string;
}

export interface CourierBoard {
  /** locations = kitchen names (as people say them), not codes. */
  courier: { name: string; onShift: boolean; locations: string[] };
  stops: CourierStop[];
}

/** Bearer token from the courier page (the personal link's #t=…). */
export function courierToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export async function courierBoard(courier: OwnCourier): Promise<CourierBoard> {
  // Seen at most every 5 minutes (one settings write, not one per refresh).
  if (!courier.lastSeenAt || Date.now() - Date.parse(courier.lastSeenAt) > 5 * 60_000) await touchCourier(courier.id);
  const locations = (await getCatalog()).locations;
  const stops: CourierStop[] = [];
  for (const d of await runningFor(courier.id)) {
    const o = await getDirectOrder(d.orderId);
    if (!o || !o.dropoff) continue;
    const loc = locations.find((l) => l.code === o.locationCode);
    stops.push({
      deliveryId: d.id, status: d.status, number: o.number, brand: o.brandName,
      pickup: { name: `${o.brandName} — ${loc?.name ?? o.locationCode}`, address: [loc?.address, loc?.city].filter(Boolean).join(', '), phone: normalizePhone(loc?.phone) ?? loc?.phone ?? '' },
      dropoff: { name: o.customer.name || 'Client', address: `${o.dropoff.street}, ${o.dropoff.city} ${o.dropoff.postalCode}`, unit: o.dropoff.unit, instructions: o.dropoff.instructions, phone: normalizePhone(o.customer.phone) ?? o.customer.phone ?? '' },
      items: o.lines.reduce((s, l) => s + l.quantity, 0), containsAlcohol: o.containsAlcohol, paid: o.payment === 'paid', tip: d.tip,
      readyAt: o.readyAt, notes: o.notes,
    });
  }
  return { courier: { name: courier.name, onShift: courier.onShift, locations: courier.locations.map((c) => locations.find((l) => l.code === c)?.name ?? c) }, stops };
}

export type CourierAction = 'at_pickup' | 'picked_up' | 'at_dropoff' | 'delivered' | 'decline' | 'problem';
const MOVES: Partial<Record<CourierAction, DeliveryStatus>> = { at_pickup: 'at_pickup', picked_up: 'picked_up', at_dropoff: 'at_dropoff', delivered: 'delivered' };

export async function courierAction(courier: OwnCourier, deliveryId: string, action: CourierAction, note = ''): Promise<{ ok: boolean; message: string }> {
  const d = await getDelivery(deliveryId);
  if (!d || d.fleet !== 'own_fleet' || d.ownCourierId !== courier.id) return { ok: false, message: 'This delivery is not yours.' };
  if (TERMINAL.includes(d.status)) return { ok: false, message: `This delivery is already ${d.status}.` };
  const text = note.trim().slice(0, 200);
  const who = { name: courier.name, phone: courier.phone, updatedAt: nowIso() };

  if (action === 'problem') {
    if (!text) return { ok: false, message: 'Say what the problem is.' };
    const order = await getDirectOrder(d.orderId);
    if (order) {
      await addDirectEvent(order, 'courier_problem', `${courier.name}: ${text}`, courier.name, { attention: `Courier ${courier.name}: ${text}` });
      await postToChat({ title: `${order.number} (${order.brandName}) — courier problem`, text: `${courier.name}: ${text}`, severity: 'warning' }, { purpose: 'own_delivery', orderId: order.id });
    }
    return { ok: true, message: 'The team was told.' };
  }
  if (action === 'decline') {
    // Only before the food is in his hands; after that, "problem".
    if (d.status === 'picked_up' || d.status === 'at_dropoff') return { ok: false, message: 'You already have the food: use "Problem" instead.' };
    const r = await applyFleetEvent({ fleet: 'own_fleet', ref: d.id, status: 'cancelled', event: 'declined', at: nowIso(), courier: who, cancelReason: `Declined by ${courier.name}${text ? ` — ${text}` : ''}` });
    return r.applied ? { ok: true, message: 'Declined: the team will send someone else.' } : { ok: false, message: r.reason ?? 'Not changed.' };
  }
  const status = MOVES[action];
  if (!status) return { ok: false, message: 'Unknown action.' };
  const r = await applyFleetEvent({ fleet: 'own_fleet', ref: d.id, status, event: action, at: nowIso(), courier: who });
  return r.applied ? { ok: true, message: 'Saved.' } : { ok: false, message: 'Already done (statuses only move forward).' };
}

/** The whole courier API behind one bearer token: board, shift on/off, delivery taps. */
export async function handleCourierRequest(token: string | null, body?: { action?: string; deliveryId?: string; note?: string; onShift?: boolean }): Promise<{ status: number; data: Record<string, unknown> }> {
  const courier = await courierFromToken(token);
  if (!courier) return { status: 401, data: { ok: false, error: 'This link no longer works. Ask the kitchen for a new one.' } };
  if (body?.action === 'shift') {
    const next = await setShift(courier.id, Boolean(body.onShift));
    return { status: 200, data: { ok: true, board: await courierBoard(next ?? courier) } };
  }
  if (body?.action) {
    const r = await courierAction(courier, String(body.deliveryId ?? ''), body.action as CourierAction, String(body.note ?? ''));
    return { status: r.ok ? 200 : 409, data: { ok: r.ok, message: r.message, board: await courierBoard(courier) } };
  }
  return { status: 200, data: { ok: true, board: await courierBoard(courier) } };
}
