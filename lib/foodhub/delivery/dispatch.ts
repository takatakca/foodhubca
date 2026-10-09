// "Call a courier" for our own delivery orders: checks, quotes (DoorDash Drive first, Uber Direct as comparison /
// fallback), booking, cancelling, courier status from the fleets' webhooks, the customer's tracking text, and the
// auto-dispatch rule (per location: ask for the courier at "ready time − N minutes").
//
// Safety rules:
//   - nothing is sent unless the own-delivery switch is on and the location's delivery rule is on;
//   - couriers never collect money: an unpaid order waits for "Payment taken" (unless the owner allowed unpaid dispatch);
//   - alcohol only where the alcohol rules allow third-party delivery right now (permit, agreement, legal hours), with
//     food in the order when the permit requires it — the courier then checks ID (18+);
//   - auto-dispatch never pays more than the location's limit without a person; after 3 failed tries it stops and asks;
//   - AI never dispatches by itself: auto-dispatch is the owner's rule, and every booking is logged with who asked.
import { logActivity, type Actor } from '../activity';
import { decideAlcohol } from '../alcohol/rules';
import { getCatalog } from '../catalog';
import { nowIso, round2 } from '../config';
import { featureOn } from '../expansion/features';
import { normalizePhone, postToChat, sendSms } from '../notify';
import { addressProblems, formatAddress, serviceAreaProblem } from './address';
import { doorDashDrive } from './doordash-drive';
import { skipDaas } from './skip-daas';
import { FLEET_LABELS, type CourierFleet, type DeliveryRequest, type FleetEvent } from './fleet';
import {
  addDirectEvent, deliveriesForOrder, findDelivery, getDelivery, getDeliverySettings, getDirectOrder, listDirectOrders, newId, ruleFor, saveDelivery,
} from './store';
import { DELIVERY_RANK, TERMINAL, type Delivery, type DeliveryQuote, type DeliverySettings, type DirectOrder, type FleetKey } from './types';
import { uberDirect } from './uber-direct';

export const FLEETS: Record<FleetKey, CourierFleet> = { doordash_drive: doorDashDrive, uber_direct: uberDirect, skip_daas: skipDaas };
export const AUTO_ACTOR: Actor = { username: 'auto-dispatch', name: 'Auto-dispatch', source: 'automation' };
const MAX_AUTO_ATTEMPTS = 3;
const AUTO_RETRY_MS = 2 * 60_000;

export function fleetReadiness() {
  return (Object.keys(FLEETS) as FleetKey[]).map((k) => FLEETS[k].readiness());
}

/** The delivery currently attached to the order, if it is still running. */
export async function activeDelivery(order: DirectOrder): Promise<Delivery | null> {
  if (!order.deliveryId) return null;
  const d = await getDelivery(order.deliveryId);
  return d && !TERMINAL.includes(d.status) ? d : null;
}

/** Why a courier cannot be sent for this order right now (empty = it can) — in English (logs, flags) or French (screens). */
export async function dispatchProblems(order: DirectOrder, settings?: DeliverySettings, now = Date.now(), lang: 'en' | 'fr' = 'en'): Promise<string[]> {
  const t = (en: string, fr: string) => (lang === 'fr' ? fr : en);
  const s = settings ?? (await getDeliverySettings());
  const out: string[] = [];
  if (!(await featureOn('delivery'))) out.push(t('Own delivery is turned off (Settings → Expansion).', 'La livraison par nos coursiers est désactivée (Réglages → Expansion).'));
  if (order.source === 'clover_online') out.push(t('Clover online order: Clover handles it (Food Hub never sends a courier for it).', 'Commande Clover en ligne : Clover s’en occupe (Food Hub n’envoie jamais de livreur pour elle).'));
  if (order.fulfillment !== 'delivery') out.push(t('This is a pickup order.', 'C’est une commande pour emporter.'));
  if (order.status === 'cancelled' || order.status === 'completed') out.push(t(`The order is ${order.status}.`, order.status === 'cancelled' ? 'La commande est annulée.' : 'La commande est terminée.'));
  const rule = ruleFor(s, order.locationCode);
  if (!rule.enabled) out.push(t(`Own delivery is not turned on for ${order.locationCode} (Settings → Expansion → Delivery).`, `La livraison n’est pas activée pour ${order.locationCode} (Réglages → Expansion → Livraison).`));
  out.push(...addressProblems(order.dropoff, lang));
  if (order.dropoff) { const area = serviceAreaProblem(rule, order.dropoff, lang); if (area) out.push(area); }
  if (!normalizePhone(order.customer.phone)) out.push(t('The customer’s phone number is missing (the courier needs it).', 'Le téléphone du client manque (le livreur en a besoin).'));
  if (order.payment !== 'paid' && !s.allowUnpaidDispatch) out.push(t('Not paid yet — couriers do not collect money. Take the payment, then tap "Payment taken".', 'Pas encore payée — les livreurs n’encaissent jamais. Prenez le paiement, puis touchez « Paiement encaissé ».'));
  if (order.containsAlcohol) {
    const d = await decideAlcohol(order.locationCode, 'own_delivery', { now });
    if (!d.allowed) out.push(t(`Alcohol: ${d.reason}`, `Alcool : ${d.reasonFr}`));
    else if (d.requireFood && order.lines.every((l) => l.alcohol)) out.push(t('Alcohol: this permit allows alcohol only with food prepared by the kitchen.', 'Alcool : ce permis exige des aliments préparés par la cuisine avec l’alcool.'));
  }
  const loc = (await getCatalog()).locations.find((l) => l.code === order.locationCode);
  if (!loc?.address) out.push(t(`The kitchen address for ${order.locationCode} is missing (Settings → Business).`, `L’adresse de la cuisine ${order.locationCode} manque (Réglages → Entreprise).`));
  if (!normalizePhone(loc?.phone)) out.push(t(`The kitchen phone for ${order.locationCode} is missing (Settings → Business) — the courier calls it.`, `Le téléphone de la cuisine ${order.locationCode} manque (Réglages → Entreprise) — le livreur l’appelle.`));
  return out;
}

export async function buildRequest(order: DirectOrder, deliveryId: string, s: DeliverySettings): Promise<DeliveryRequest> {
  const loc = (await getCatalog()).locations.find((l) => l.code === order.locationCode)!;
  const rule = ruleFor(s, order.locationCode);
  const pickupParts = { street: loc.address, city: loc.city || 'Montréal', province: 'QC', postalCode: loc.postalCode || '', country: 'CA' };
  const d = order.dropoff!;
  const [given, ...rest] = String(order.customer.name || 'Client').trim().split(/\s+/);
  const tip = order.tip > 0 ? order.tip : s.defaultTip;
  const alcohol = order.containsAlcohol ? await decideAlcohol(order.locationCode, 'own_delivery') : null;
  return {
    id: deliveryId,
    reference: order.number,
    pickup: { businessName: order.brandName, address: formatAddress(pickupParts), parts: pickupParts, phone: loc.phone || '', locationCode: order.locationCode, instructions: rule.pickupInstructions },
    dropoff: {
      name: order.customer.name || 'Client', givenName: given, familyName: rest.join(' ') || undefined, address: formatAddress(d), parts: d,
      phone: order.customer.phone || '', email: order.customer.email, instructions: [d.unit ? `Unit / app. ${d.unit}` : '', d.instructions ?? ''].filter(Boolean).join(' — ') || undefined, lat: d.lat, lng: d.lng,
    },
    orderValue: round2(order.subtotal + order.tax),
    tip,
    currency: order.currency,
    items: order.lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unitPrice, externalId: l.externalId ?? l.posItemRef, description: l.modifiers.map((m) => m.name).join(', ') || undefined })),
    pickupAt: order.readyAt && Date.parse(order.readyAt) > Date.now() + 5 * 60_000 ? order.readyAt : undefined,
    containsAlcohol: order.containsAlcohol,
    minAge: alcohol?.minAge ?? 18,
    undeliverable: s.undeliverable,
    fleetSms: s.smsTracking,
  };
}

/** Prices from the primary fleet and, when comparing, every other fleet that is set up. Cheapest working quote first (primary wins ties). */
export async function quoteFleets(req: DeliveryRequest, s: DeliverySettings, only?: FleetKey): Promise<DeliveryQuote[]> {
  // Comparing: the primary fleet plus every other fleet that is set up (a fleet with no credentials is never asked).
  const others = (Object.keys(FLEETS) as FleetKey[]).filter((k) => k !== s.primaryFleet);
  const keys: FleetKey[] = only ? [only] : s.compareQuotes ? [s.primaryFleet, ...others] : [s.primaryFleet];
  const usable = keys.filter((k) => FLEETS[k].readiness().configured);
  const quotes = await Promise.all((usable.length ? usable : keys.slice(0, 1)).map((k) => FLEETS[k].quote(req)));
  return quotes.sort((a, b) => (a.ok === b.ok ? (a.fee ?? 999) - (b.fee ?? 999) || (a.fleet === s.primaryFleet ? -1 : 1) : a.ok ? -1 : 1));
}

export interface DispatchOutcome { ok: boolean; message: string; order: DirectOrder; delivery?: Delivery; quotes?: DeliveryQuote[]; problems?: string[] }

/** Books a courier for the order. `auto` = the location's auto-dispatch rule (fee limit applies). */
export async function dispatchOrder(orderId: string, actor: Actor, opts: { fleet?: FleetKey; auto?: boolean; now?: number } = {}): Promise<DispatchOutcome> {
  let order = await getDirectOrder(orderId);
  if (!order) throw new Error('Order not found.');
  const running = await activeDelivery(order);
  if (running) return { ok: false, message: `A courier is already booked (${FLEET_LABELS[running.fleet]}, ${running.status}).`, order, delivery: running };
  const s = await getDeliverySettings();
  const problems = await dispatchProblems(order, s, opts.now);
  if (problems.length) {
    if (opts.auto) order = await addDirectEvent(order, 'dispatch_waiting', `Courier not requested: ${problems[0]}`, actor.name, { attention: problems[0] });
    return { ok: false, message: problems[0], order, problems };
  }
  const id = newId('fhd').replace('_', '-');
  const req = await buildRequest(order, id, s);
  const quotes = await quoteFleets(req, s, opts.fleet);
  const best = quotes.find((q) => q.ok);
  if (!best) {
    const why = quotes.map((q) => `${FLEET_LABELS[q.fleet]}: ${q.error ?? 'no price'}`).join(' · ');
    order = await addDirectEvent(order, 'quote_failed', `No courier price — ${why}`, actor.name, { attention: `No courier price — ${why}` });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'courier_quote', status: 'failed', brandName: order.brandName, locationCode: order.locationCode, summary: `${order.number}: no courier price — ${why}` });
    return { ok: false, message: `No courier price — ${why}`, order, quotes };
  }
  const rule = ruleFor(s, order.locationCode);
  if (opts.auto && rule.maxAutoFee > 0 && (best.fee ?? 0) > rule.maxAutoFee) {
    const msg = `Courier costs ${best.fee?.toFixed(2)} $ (${FLEET_LABELS[best.fleet]}) — above the ${rule.maxAutoFee.toFixed(2)} $ auto limit. A person decides: "Call a courier".`;
    order = await addDirectEvent(order, 'dispatch_waiting', msg, actor.name, { attention: msg, autoDispatch: { attempts: MAX_AUTO_ATTEMPTS, lastAt: nowIso(), stoppedReason: 'fee_limit' } });
    return { ok: false, message: msg, order, quotes };
  }
  // Book on the cheapest fleet; if it refuses, try the next priced one.
  const at = nowIso();
  for (const q of quotes.filter((x) => x.ok)) {
    const res = await FLEETS[q.fleet].create(req, q);
    if (!res.ok) {
      order = await addDirectEvent(order, 'courier_failed', `${FLEET_LABELS[q.fleet]} refused: ${res.message}`, actor.name);
      continue;
    }
    const fleet = FLEETS[q.fleet].readiness();
    let delivery: Delivery = {
      id, orderId: order.id, fleet: q.fleet, environment: fleet.environment, fleetDeliveryId: res.fleetDeliveryId, status: res.deliveryStatus && res.deliveryStatus !== 'quoted' ? res.deliveryStatus : 'created',
      quote: q, comparedQuotes: quotes, fee: res.fee ?? q.fee, tip: req.tip, orderValue: req.orderValue, containsAlcohol: req.containsAlcohol,
      trackingUrl: res.trackingUrl, supportReference: res.supportReference, courier: res.courier, pickupEta: res.pickupEta ?? q.pickupEta, dropoffEta: res.dropoffEta ?? q.dropoffEta,
      requestedBy: actor.name, timeline: [{ at, status: 'created', message: `${res.message}${fleet.environment === 'sandbox' ? ' (sandbox — no real courier)' : ''}` }], createdAt: at, updatedAt: at,
    };
    delivery = await saveDelivery(delivery);
    order = await addDirectEvent(order, 'courier_booked', `${FLEET_LABELS[q.fleet]} booked — ${(delivery.fee ?? 0).toFixed(2)} $ + ${req.tip.toFixed(2)} $ tip${quotes.length > 1 ? ` (${quotes.map((x) => `${FLEET_LABELS[x.fleet]} ${x.ok ? `${x.fee?.toFixed(2)} $` : 'n/a'}`).join(' vs ')})` : ''}`, actor.name, { deliveryId: delivery.id, attention: undefined });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'courier_booked', status: 'success', brandName: order.brandName, locationCode: order.locationCode,
      summary: `${order.number}: courier booked on ${FLEET_LABELS[q.fleet]}${fleet.environment === 'sandbox' ? ' (sandbox)' : ''} — ${(delivery.fee ?? 0).toFixed(2)} $${opts.auto ? ' (auto-dispatch)' : ''}` });
    return { ok: true, message: `${FLEET_LABELS[q.fleet]} booked.`, order, delivery, quotes };
  }
  const msg = 'Every courier service refused this delivery — see the order history.';
  order = await addDirectEvent(order, 'courier_failed', msg, actor.name, { attention: msg });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'courier_booked', status: 'failed', brandName: order.brandName, locationCode: order.locationCode, summary: `${order.number}: ${msg}` });
  return { ok: false, message: msg, order, quotes };
}

/** Cancels the running courier (the fleet may charge a fee once a courier is on the way). */
export async function cancelCourier(orderId: string, actor: Actor, reason: string): Promise<DispatchOutcome> {
  let order = await getDirectOrder(orderId);
  if (!order) throw new Error('Order not found.');
  const d = await activeDelivery(order);
  if (!d) return { ok: false, message: 'No courier is booked for this order.', order };
  const res = await FLEETS[d.fleet].cancel(d.id, d.fleetDeliveryId);
  if (!res.ok) {
    order = await addDirectEvent(order, 'courier_cancel_failed', `${FLEET_LABELS[d.fleet]} did not cancel: ${res.message}`, actor.name);
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'courier_cancel', status: 'failed', brandName: order.brandName, locationCode: order.locationCode, summary: `${order.number}: courier NOT cancelled — ${res.message}` });
    return { ok: false, message: res.message, order, delivery: d };
  }
  const at = nowIso();
  const delivery = await saveDelivery({ ...d, status: 'cancelled', cancelReason: reason, timeline: [...d.timeline, { at, status: 'cancelled', message: `Cancelled by ${actor.name}${reason ? ` — ${reason}` : ''}` }] });
  order = await addDirectEvent(order, 'courier_cancelled', `Courier cancelled${reason ? ` — ${reason}` : ''}`, actor.name);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'courier_cancel', status: 'success', brandName: order.brandName, locationCode: order.locationCode, summary: `${order.number}: courier cancelled on ${FLEET_LABELS[d.fleet]}${reason ? ` — ${reason}` : ''}` });
  return { ok: true, message: 'Courier cancelled.', order, delivery };
}

/** Text the tracking link once, when a courier is on it. */
async function textTracking(order: DirectOrder, d: Delivery): Promise<Delivery> {
  const s = await getDeliverySettings();
  if (!s.smsTracking || d.trackingSmsAt || !d.trackingUrl || !normalizePhone(order.customer.phone)) return d;
  const fr = (order.customer.lang ?? 'fr') === 'fr';
  const body = fr
    ? `${order.brandName} : votre commande ${order.number} est prise en charge par un livreur. Suivi : ${d.trackingUrl}${d.containsAlcohol ? ' — Alcool : pièce d’identité avec photo exigée.' : ''}`
    : `${order.brandName}: a courier has your order ${order.number}. Track it: ${d.trackingUrl}${d.containsAlcohol ? ' — Alcohol: photo ID required.' : ''}`;
  const r = await sendSms({ to: order.customer.phone!, body }, { purpose: 'delivery_tracking', by: 'Food Hub' });
  await addDirectEvent(order, r.ok ? 'sms_tracking' : 'sms_failed', r.ok ? 'Tracking link texted to the customer' : `Tracking link not texted: ${r.message}`);
  return r.ok ? saveDelivery({ ...d, trackingSmsAt: nowIso() }) : d;
}

const STATUS_TEXT: Record<string, string> = {
  created: 'Delivery created', assigned: 'Courier assigned', at_pickup: 'Courier at the kitchen', picked_up: 'Picked up — on the way', at_dropoff: 'Courier at the customer',
  delivered: 'Delivered', returning: 'Coming back to the kitchen', returned: 'Returned to the kitchen', cancelled: 'Cancelled by the courier service', failed: 'Failed',
};

/** A fleet webhook: move the delivery forward (never backwards) and the order with it. */
export async function applyFleetEvent(ev: FleetEvent): Promise<{ applied: boolean; delivery?: Delivery; reason?: string }> {
  const found = (await findDelivery(ev.ref)) ?? (ev.fleetDeliveryId ? await findDelivery(ev.fleetDeliveryId) : null);
  if (!found || found.fleet !== ev.fleet) return { applied: false, reason: 'Unknown delivery' };
  let d: Delivery = {
    ...found,
    fee: ev.fee ?? found.fee, trackingUrl: ev.trackingUrl ?? found.trackingUrl, supportReference: ev.supportReference ?? found.supportReference,
    pickupEta: ev.pickupEta ?? found.pickupEta, dropoffEta: ev.dropoffEta ?? found.dropoffEta,
    courier: ev.courier ? { ...(found.courier ?? {}), ...Object.fromEntries(Object.entries(ev.courier).filter(([, v]) => v !== undefined)), updatedAt: ev.courier.updatedAt } : found.courier,
    fleetDeliveryId: found.fleetDeliveryId ?? ev.fleetDeliveryId,
  };
  const moves = ev.status && !TERMINAL.includes(found.status) && ev.status !== found.status && (TERMINAL.includes(ev.status) || DELIVERY_RANK[ev.status] > DELIVERY_RANK[found.status]);
  if (moves) {
    d = { ...d, status: ev.status!, ...(ev.status === 'cancelled' && ev.cancelReason ? { cancelReason: ev.cancelReason } : {}), timeline: [...d.timeline, { at: ev.at, status: ev.status!, message: `${STATUS_TEXT[ev.status!] ?? ev.status}${ev.cancelReason ? ` — ${ev.cancelReason}` : ''}${d.courier?.name ? ` (${d.courier.name})` : ''}` }] };
  }
  d = await saveDelivery(d);
  let order = await getDirectOrder(d.orderId);
  if (!order || !moves) return { applied: Boolean(moves), delivery: d };
  // A webhook for a delivery that is no longer the order's current one only updates its own record.
  if (order.deliveryId && order.deliveryId !== d.id) return { applied: true, delivery: d };
  const st = d.status;
  if (st === 'assigned' || st === 'at_pickup' || st === 'picked_up') d = await textTracking(order, d);
  if (st === 'picked_up') order = await addDirectEvent(order, 'courier_picked_up', STATUS_TEXT.picked_up, d.courier?.name, { status: 'out_for_delivery' });
  else if (st === 'delivered') order = await addDirectEvent(order, 'delivered', STATUS_TEXT.delivered, d.courier?.name, { status: 'completed', attention: undefined });
  else if (st === 'cancelled' || st === 'returned' || st === 'failed') {
    const msg = `${STATUS_TEXT[st]}${d.cancelReason ? ` — ${d.cancelReason}` : ''}. ${st === 'returned' ? 'The food is back at the kitchen.' : 'Call another courier or call the customer.'}`;
    order = await addDirectEvent(order, `courier_${st}`, msg, FLEET_LABELS[d.fleet], { attention: msg });
    await logActivity({ actor: FLEET_LABELS[d.fleet], source: 'platform', kind: 'order', action: `courier_${st}`, status: 'failed', brandName: order.brandName, locationCode: order.locationCode, summary: `${order.number}: ${msg}` });
    await postToChat({ title: `${order.number} (${order.brandName}) — ${STATUS_TEXT[st]}`, text: msg, severity: 'warning' }, { purpose: 'own_delivery', orderId: order.id });
  } else {
    order = await addDirectEvent(order, `courier_${st}`, `${STATUS_TEXT[st] ?? st}${d.courier?.name ? ` — ${d.courier.name}` : ''}`, FLEET_LABELS[d.fleet]);
  }
  return { applied: true, delivery: d };
}

/**
 * Auto-dispatch: for each delivery order of a location whose rule says so, ask for the courier at
 * "ready time − lead minutes". Retries every 2 minutes, at most 3 times; then a person decides.
 */
export async function tickDispatch(now = Date.now()): Promise<{ checked: number; booked: number }> {
  const s = await getDeliverySettings();
  const since = new Date(now - 2 * 86400_000).toISOString();
  const orders = (await listDirectOrders({ since, limit: 1000 })).filter((o) => o.fulfillment === 'delivery' && o.source !== 'clover_online' && ['new', 'in_kitchen', 'ready'].includes(o.status));
  let booked = 0;
  for (const o of orders) {
    const rule = ruleFor(s, o.locationCode);
    if (!rule.enabled || !rule.autoDispatch) continue;
    if (await activeDelivery(o)) continue;
    const auto = o.autoDispatch ?? { attempts: 0 };
    if (auto.attempts >= MAX_AUTO_ATTEMPTS) continue;
    if (auto.lastAt && now - Date.parse(auto.lastAt) < AUTO_RETRY_MS) continue;
    // A courier that cancelled (or a delivery a person cancelled) is not re-booked automatically.
    if ((await deliveriesForOrder(o.id)).some((d) => d.status === 'cancelled' || d.status === 'returned')) continue;
    const due = Date.parse(o.readyAt ?? o.placedAt) - rule.leadMinutes * 60_000;
    if (now < due) continue;
    const marked = await addDirectEvent(o, 'auto_dispatch', `Auto-dispatch try ${auto.attempts + 1} of ${MAX_AUTO_ATTEMPTS}`, AUTO_ACTOR.name, { autoDispatch: { attempts: auto.attempts + 1, lastAt: new Date(now).toISOString() } });
    const r = await dispatchOrder(marked.id, AUTO_ACTOR, { auto: true, now });
    if (r.ok) booked++;
    else if (auto.attempts + 1 >= MAX_AUTO_ATTEMPTS) {
      await addDirectEvent(r.order, 'auto_dispatch_stopped', `Auto-dispatch stopped after ${MAX_AUTO_ATTEMPTS} tries — ${r.message}`, AUTO_ACTOR.name, { attention: `Auto-dispatch stopped — ${r.message}` });
    }
  }
  return { checked: orders.length, booked };
}

/** Refreshes running deliveries from the fleet (when webhooks are not set up yet, or one was missed). */
export async function refreshDelivery(deliveryId: string): Promise<Delivery | null> {
  const d = await getDelivery(deliveryId);
  if (!d || TERMINAL.includes(d.status)) return d;
  const res = await FLEETS[d.fleet].get(d.id, d.fleetDeliveryId);
  if (!res.ok) return d;
  await applyFleetEvent({
    fleet: d.fleet, ref: d.id, fleetDeliveryId: res.fleetDeliveryId ?? d.fleetDeliveryId, status: res.deliveryStatus ?? null, event: 'refresh', at: nowIso(),
    fee: res.fee, trackingUrl: res.trackingUrl, supportReference: res.supportReference, pickupEta: res.pickupEta, dropoffEta: res.dropoffEta, courier: res.courier,
  });
  return getDelivery(deliveryId);
}
