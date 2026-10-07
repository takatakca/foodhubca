// DoorDash Drive (v2) — on-demand Dashers for OUR orders (phone, Clover delivery, website).
// Spec: https://developer.doordash.com/en-US/api/drive/
//   POST /drive/v2/quotes                              price + ETA (valid about 5 minutes)
//   POST /drive/v2/quotes/{external_delivery_id}/accept book the quoted delivery (tip may be set here)
//   POST /drive/v2/deliveries                          book without a quote
//   GET  /drive/v2/deliveries/{external_delivery_id}
//   PUT  /drive/v2/deliveries/{external_delivery_id}/cancel
// Auth: the same DD-JWT-V1 token as the Marketplace API, but with the Drive org's own access key
// (DOORDASH_DRIVE_DEVELOPER_ID / _KEY_ID / _SIGNING_SECRET — the owner's Drive org has build access in sandbox).
// Sandbox vs production is the credential, not the URL: DOORDASH_DRIVE_ENV says which one this is. Sandbox sends no
// real Dasher, so it runs without the live switch (to complete DoorDash's required test deliveries); production needs
// LIVE_CONNECTORS_GLOBAL_ENABLED=true like every other platform call that changes something.
// Webhooks: Developer Portal → Webhooks → endpoint .../api/foodhub/webhooks/doordash-drive with Authentication type
// "Basic", header "Authorization", token = DOORDASH_DRIVE_WEBHOOK_SECRET (or paste the token DoorDash generates there).
// Alcohol: order_contains.alcohol=true, return_to_pickup, no contactless drop-off — the Dasher scans the customer's ID.
import { doorDashJwt } from '../adapters/doordash';
import { checkSharedSecret, fromCents, liveConnectorsGloballyEnabled, missingEnv, nowIso, stripSlash, timedFetch, toCents } from '../config';
import { normalizePhone } from '../notify';
import { blocked, type CourierFleet, type DeliveryRequest, type FleetEvent, type FleetResult } from './fleet';
import type { CourierPosition, DeliveryQuote, DeliveryStatus } from './types';

const REQUIRED = ['DOORDASH_DRIVE_DEVELOPER_ID', 'DOORDASH_DRIVE_KEY_ID', 'DOORDASH_DRIVE_SIGNING_SECRET'];
export const DRIVE_WEBHOOK_PATH = '/api/foodhub/webhooks/doordash-drive';

function base() { return stripSlash(process.env.DOORDASH_DRIVE_BASE_URL || 'https://openapi.doordash.com'); }
export function driveEnvironment(): 'sandbox' | 'production' { return process.env.DOORDASH_DRIVE_ENV === 'production' ? 'production' : 'sandbox'; }

function headers() {
  const token = doorDashJwt(undefined, { developerId: process.env.DOORDASH_DRIVE_DEVELOPER_ID, keyId: process.env.DOORDASH_DRIVE_KEY_ID, signingSecret: process.env.DOORDASH_DRIVE_SIGNING_SECRET });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function readiness() {
  const missing = missingEnv(REQUIRED);
  const environment = driveEnvironment();
  const configured = missing.length === 0;
  const live = liveConnectorsGloballyEnabled();
  const canSend = configured && (environment === 'sandbox' || live);
  const note = !configured ? `Missing: ${missing.join(', ')} (Developer Portal → Drive → Credentials).`
    : environment === 'sandbox' ? 'Sandbox: quotes and test deliveries work, no real Dasher comes. Use the Developer Portal Simulator to move a delivery along.'
      : live ? 'Production: real Dashers are dispatched.' : 'Production credentials, but LIVE_CONNECTORS_GLOBAL_ENABLED is off — nothing is sent.';
  const noteFr = !configured ? `Manquant : ${missing.join(', ')} (Portail développeur → Drive → Credentials).`
    : environment === 'sandbox' ? 'Bac à sable : les prix et les livraisons d’essai fonctionnent, aucun vrai livreur ne vient. Utilisez le Simulator du portail pour faire avancer une livraison.'
      : live ? 'Production : de vrais livreurs DoorDash sont envoyés.' : 'Clés de production, mais LIVE_CONNECTORS_GLOBAL_ENABLED est désactivé — rien n’est envoyé.';
  return { fleet: 'doordash_drive' as const, label: 'DoorDash Drive', configured, canSend, environment, missing, note, noteFr, webhookPath: DRIVE_WEBHOOK_PATH };
}

/** DoorDash's delivery_status (both the current and the older wording) → our status. */
export function driveStatus(s: unknown): DeliveryStatus | null {
  const v = String(s ?? '').toLowerCase();
  const map: Record<string, DeliveryStatus> = {
    quote: 'quoted', created: 'created', accepted: 'created', confirmed: 'assigned', enroute_to_pickup: 'assigned',
    arrived_at_pickup: 'at_pickup', pickup_arrived: 'at_pickup', picked_up: 'picked_up', enroute_to_dropoff: 'picked_up',
    arrived_at_dropoff: 'at_dropoff', dropoff_arrived: 'at_dropoff', delivered: 'delivered', completed: 'delivered',
    enroute_to_return: 'returning', arrived_at_return: 'returning', returned: 'returned', cancelled: 'cancelled', canceled: 'cancelled',
  };
  return map[v] ?? null;
}

/** Webhook event_name → our status (null = informative only, e.g. DELIVERY_BATCHED). */
export function driveEventStatus(event: unknown): DeliveryStatus | null {
  const e = String(event ?? '').toUpperCase();
  const map: Record<string, DeliveryStatus> = {
    DELIVERY_CREATED: 'created', DASHER_CONFIRMED: 'assigned', DASHER_ENROUTE_TO_PICKUP: 'assigned', DASHER_CONFIRMED_PICKUP_ARRIVAL: 'at_pickup',
    DASHER_PICKED_UP: 'picked_up', DASHER_ENROUTE_TO_DROPOFF: 'picked_up', DASHER_CONFIRMED_DROPOFF_ARRIVAL: 'at_dropoff', DASHER_DROPPED_OFF: 'delivered',
    DELIVERY_CANCELLED: 'cancelled', DELIVERY_RETURN_INITIALIZED: 'returning', DASHER_ENROUTE_TO_RETURN: 'returning', DASHER_CONFIRMED_RETURN_ARRIVAL: 'returning',
    DELIVERY_RETURNED: 'returned',
  };
  return map[e] ?? null;
}

function courierOf(b: any): CourierPosition | undefined {
  if (!b?.dasher_name && !b?.dasher_location && !b?.dasher_id) return undefined;
  const vehicle = [b.dasher_vehicle_make, b.dasher_vehicle_model].filter(Boolean).join(' ') || undefined;
  return {
    name: b.dasher_name ? String(b.dasher_name) : undefined,
    phone: b.dasher_dropoff_phone_number || b.dasher_pickup_phone_number || undefined,
    vehicle,
    lat: Number.isFinite(Number(b.dasher_location?.lat)) ? Number(b.dasher_location.lat) : undefined,
    lng: Number.isFinite(Number(b.dasher_location?.lng)) ? Number(b.dasher_location.lng) : undefined,
    updatedAt: nowIso(),
  };
}

/** The Drive request body (quote and delivery share it). */
export function driveBody(req: DeliveryRequest) {
  const alcohol = req.containsAlcohol;
  return {
    external_delivery_id: req.id,
    locale: 'fr-CA',
    pickup_address: req.pickup.address,
    pickup_business_name: req.pickup.businessName,
    pickup_phone_number: normalizePhone(req.pickup.phone) ?? req.pickup.phone,
    ...(req.pickup.instructions ? { pickup_instructions: req.pickup.instructions.slice(0, 280) } : {}),
    pickup_reference_tag: req.reference,
    dropoff_address: req.dropoff.address,
    ...(req.dropoff.businessName ? { dropoff_business_name: req.dropoff.businessName } : {}),
    dropoff_phone_number: normalizePhone(req.dropoff.phone) ?? req.dropoff.phone,
    ...(req.dropoff.instructions ? { dropoff_instructions: req.dropoff.instructions.slice(0, 280) } : {}),
    dropoff_contact_given_name: req.dropoff.givenName || req.dropoff.name,
    ...(req.dropoff.familyName ? { dropoff_contact_family_name: req.dropoff.familyName } : {}),
    // Delivery status SMS from DoorDash itself (one of Drive's "customize" features), on top of our own text.
    dropoff_contact_send_notifications: req.fleetSms,
    ...(req.dropoff.lat !== undefined && req.dropoff.lng !== undefined ? { dropoff_location: { lat: req.dropoff.lat, lng: req.dropoff.lng } } : {}),
    order_value: toCents(req.orderValue),
    tip: toCents(req.tip),
    currency: req.currency || 'CAD',
    items: req.items.map((i) => ({
      name: i.name.slice(0, 120), quantity: Math.max(1, Math.round(i.quantity)),
      ...(i.description ? { description: i.description.slice(0, 200) } : {}),
      ...(i.externalId ? { external_id: i.externalId } : {}),
      ...(i.price !== undefined ? { price: toCents(i.price) } : {}),
    })),
    ...(req.pickupAt ? { pickup_time: new Date(req.pickupAt).toISOString() } : {}),
    // Alcohol: DoorDash requires return_to_pickup and no contactless drop-off; the Dasher scans the ID at the door.
    action_if_undeliverable: alcohol ? 'return_to_pickup' : req.undeliverable,
    contactless_dropoff: false,
    ...(alcohol ? { order_contains: { alcohol: true } } : {}),
  };
}

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any; why: string }> {
  try {
    const res = await timedFetch(`${base()}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    const fieldErr = Array.isArray(json?.field_errors) ? json.field_errors.map((f: any) => `${f.field}: ${f.error}`).join('; ') : '';
    const why = res.ok ? '' : `DoorDash Drive HTTP ${res.status}${json?.code ? ` ${json.code}` : ''}${json?.message ? `: ${json.message}` : ''}${fieldErr ? ` (${fieldErr})` : ''}`.slice(0, 400);
    return { ok: res.ok, status: res.status, json, why };
  } catch (e) {
    return { ok: false, status: 0, json: null, why: `DoorDash Drive network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function toResult(r: { ok: boolean; status: number; json: any; why: string }, okMessage: string): FleetResult {
  const b = r.json ?? {};
  if (!r.ok) return { ok: false, status: 'error', message: r.why, httpStatus: r.status, raw: b };
  return {
    ok: true, status: 'done', message: okMessage, httpStatus: r.status,
    fleetDeliveryId: b.external_delivery_id ? String(b.external_delivery_id) : undefined,
    deliveryStatus: driveStatus(b.delivery_status) ?? undefined,
    fee: typeof b.fee === 'number' ? fromCents(b.fee) : undefined,
    trackingUrl: b.tracking_url || undefined,
    supportReference: b.support_reference ? String(b.support_reference) : undefined,
    pickupEta: b.pickup_time_estimated || undefined,
    dropoffEta: b.dropoff_time_estimated || undefined,
    courier: courierOf(b),
    raw: b,
  };
}

export const doorDashDrive: CourierFleet = {
  key: 'doordash_drive',
  label: 'DoorDash Drive',
  readiness,
  async quote(req) {
    const at = nowIso();
    const r = readiness();
    if (!r.canSend) return { fleet: 'doordash_drive', ok: false, blocked: true, error: r.note, at };
    const res = await call('POST', '/drive/v2/quotes', driveBody(req));
    if (!res.ok) return { fleet: 'doordash_drive', ok: false, error: res.why, at };
    const b = res.json ?? {};
    return {
      fleet: 'doordash_drive', ok: true, fee: fromCents(Number(b.fee) || 0), currency: b.currency || 'CAD',
      // DoorDash keeps a quote for about five minutes.
      expiresAt: new Date(Date.parse(at) + 5 * 60_000).toISOString(),
      pickupEta: b.pickup_time_estimated || undefined, dropoffEta: b.dropoff_time_estimated || undefined, at,
    } satisfies DeliveryQuote;
  },
  async create(req, quote) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    // A fresh DoorDash quote is accepted by our delivery id (the tip can be set at acceptance); otherwise book directly.
    if (quote?.ok && quote.fleet === 'doordash_drive' && quote.expiresAt && Date.parse(quote.expiresAt) > Date.now() + 10_000) {
      const accepted = await call('POST', `/drive/v2/quotes/${encodeURIComponent(req.id)}/accept`, { tip: toCents(req.tip) });
      if (accepted.ok) return toResult(accepted, 'DoorDash accepted the quote — a Dasher is being assigned.');
      // Expired or unknown quote: fall through to a direct booking.
    }
    return toResult(await call('POST', '/drive/v2/deliveries', driveBody(req)), 'Booked on DoorDash Drive — a Dasher is being assigned.');
  },
  async get(id) {
    const r = readiness();
    if (!r.configured) return blocked(r.note);
    return toResult(await call('GET', `/drive/v2/deliveries/${encodeURIComponent(id)}`), 'OK');
  },
  async cancel(id) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    return toResult(await call('PUT', `/drive/v2/deliveries/${encodeURIComponent(id)}/cancel`), 'Cancelled on DoorDash Drive.');
  },
  verifyWebhook(h) {
    return checkSharedSecret(h, 'DOORDASH_DRIVE_WEBHOOK_SECRET', ['authorization', 'x-takatak-token']);
  },
  parseWebhook(body: any): FleetEvent | null {
    const id = body?.external_delivery_id;
    if (!id || !body?.event_name) return null;
    const status = driveEventStatus(body.event_name) ?? driveStatus(body.delivery_status);
    return {
      fleet: 'doordash_drive', ref: String(id), fleetDeliveryId: String(id), status, event: String(body.event_name), at: body.created_at || nowIso(),
      fee: typeof body.fee === 'number' ? fromCents(body.fee) : undefined,
      trackingUrl: body.tracking_url || undefined,
      supportReference: body.support_reference ? String(body.support_reference) : undefined,
      pickupEta: body.pickup_time_estimated || undefined,
      dropoffEta: body.dropoff_time_estimated || undefined,
      courier: courierOf(body),
      cancelReason: body.cancellation_reason_message || body.cancellation_reason || undefined,
    };
  },
};
