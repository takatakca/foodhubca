// Uber Direct — Uber's on-demand couriers for our own orders. Second fleet: a comparison quote and the fallback when
// DoorDash Drive cannot take a delivery.
// Docs: https://developer.uber.com/docs/deliveries
//   POST https://auth.uber.com/oauth/v2/token            client_credentials, scope eats.deliveries (token ~30 days)
//   POST /v1/customers/{customer_id}/delivery_quotes      fee + ETA, quote id (dqt_…)
//   POST /v1/customers/{customer_id}/deliveries           book (with quote_id)
//   GET  /v1/customers/{customer_id}/deliveries/{id}
//   POST /v1/customers/{customer_id}/deliveries/{id}/cancel
// Addresses are JSON strings ({"street_address":[…],"city":…,"state":…,"zip_code":…,"country":"CA"}).
// Webhooks (event.delivery_status, event.courier_update) are signed: HMAC-SHA256 of the raw body with the webhook
// signing key, hex, in x-uber-signature (older: x-postmates-signature).
// Sandbox vs production is the Uber Direct account (test customer); UBER_DIRECT_ENV says which one this is — production
// needs LIVE_CONNECTORS_GLOBAL_ENABLED=true. The alcohol / ID-check field (dropoff_verification.identification.min_age)
// must be confirmed with Uber in sandbox before alcohol goes through Uber Direct.
import crypto from 'node:crypto';
import { fromCents, liveConnectorsGloballyEnabled, missingEnv, nowIso, safeEqual, stripSlash, timedFetch, toCents } from '../config';
import { normalizePhone } from '../notify';
import { blocked, type AddressParts, type CourierFleet, type DeliveryRequest, type FleetEvent, type FleetResult } from './fleet';
import type { CourierPosition, DeliveryQuote, DeliveryStatus } from './types';

const REQUIRED = ['UBER_DIRECT_CUSTOMER_ID', 'UBER_DIRECT_CLIENT_ID', 'UBER_DIRECT_CLIENT_SECRET'];
export const UBER_DIRECT_WEBHOOK_PATH = '/api/foodhub/webhooks/uber-direct';

function apiBase() { return stripSlash(process.env.UBER_DIRECT_BASE_URL || 'https://api.uber.com'); }
function authBase() { return stripSlash(process.env.UBER_DIRECT_AUTH_URL || 'https://auth.uber.com'); }
export function uberDirectEnvironment(): 'sandbox' | 'production' { return process.env.UBER_DIRECT_ENV === 'production' ? 'production' : 'sandbox'; }

function readiness() {
  const missing = missingEnv(REQUIRED);
  const environment = uberDirectEnvironment();
  const configured = missing.length === 0;
  const live = liveConnectorsGloballyEnabled();
  const canSend = configured && (environment === 'sandbox' || live);
  const note = !configured ? `Missing: ${missing.join(', ')} (direct.uber.com → Developer).`
    : environment === 'sandbox' ? 'Sandbox (test account): quotes and robo-courier test deliveries, no real courier.'
      : live ? 'Production: real Uber couriers are dispatched.' : 'Production credentials, but LIVE_CONNECTORS_GLOBAL_ENABLED is off — nothing is sent.';
  const noteFr = !configured ? `Manquant : ${missing.join(', ')} (direct.uber.com → Developer).`
    : environment === 'sandbox' ? 'Bac à sable (compte de test) : prix et livraisons d’essai par robot, aucun vrai livreur.'
      : live ? 'Production : de vrais livreurs Uber sont envoyés.' : 'Clés de production, mais LIVE_CONNECTORS_GLOBAL_ENABLED est désactivé — rien n’est envoyé.';
  return { fleet: 'uber_direct' as const, label: 'Uber Direct', configured, canSend, environment, missing, note, noteFr, webhookPath: UBER_DIRECT_WEBHOOK_PATH };
}

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string | null> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const form = new URLSearchParams({ client_id: process.env.UBER_DIRECT_CLIENT_ID || '', client_secret: process.env.UBER_DIRECT_CLIENT_SECRET || '', grant_type: 'client_credentials', scope: 'eats.deliveries' });
  const res = await timedFetch(`${authBase()}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!res.ok) return null;
  const b = await res.json().catch(() => ({}));
  if (!b?.access_token) return null;
  token = { value: String(b.access_token), until: Date.now() + Math.max(60, Number(b.expires_in) || 3600) * 1000 };
  return token.value;
}

/** For tests: forget the cached token. */
export function resetUberDirectToken() { token = null; }

export function uberAddress(p: AddressParts | undefined, oneLine: string): string {
  if (!p) return oneLine;
  return JSON.stringify({ street_address: [p.street, ...(p.unit ? [`#${p.unit}`] : [])], city: p.city, state: p.province, zip_code: p.postalCode, country: p.country || 'CA' });
}

/** Uber Direct status → ours. "dropoff" = on the way to the customer. */
export function uberStatus(s: unknown): DeliveryStatus | null {
  const map: Record<string, DeliveryStatus> = { pending: 'created', pickup: 'assigned', pickup_complete: 'picked_up', dropoff: 'picked_up', delivered: 'delivered', canceled: 'cancelled', cancelled: 'cancelled', returned: 'returned' };
  return map[String(s ?? '').toLowerCase()] ?? null;
}

function courierOf(c: any): CourierPosition | undefined {
  if (!c) return undefined;
  return {
    name: c.name ? String(c.name) : undefined, phone: c.phone_number || undefined, vehicle: [c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || c.vehicle_type || undefined,
    lat: Number.isFinite(Number(c.location?.lat)) ? Number(c.location.lat) : undefined, lng: Number.isFinite(Number(c.location?.lng)) ? Number(c.location.lng) : undefined, updatedAt: nowIso(),
  };
}

export function uberDeliveryBody(req: DeliveryRequest, quoteId?: string) {
  return {
    ...(quoteId ? { quote_id: quoteId } : {}),
    external_id: req.id,
    pickup_name: req.pickup.businessName,
    pickup_address: uberAddress(req.pickup.parts, req.pickup.address),
    pickup_phone_number: normalizePhone(req.pickup.phone) ?? req.pickup.phone,
    ...(req.pickup.instructions ? { pickup_notes: `${req.reference} — ${req.pickup.instructions}`.slice(0, 280) } : { pickup_notes: req.reference }),
    dropoff_name: req.dropoff.name,
    dropoff_address: uberAddress(req.dropoff.parts, req.dropoff.address),
    dropoff_phone_number: normalizePhone(req.dropoff.phone) ?? req.dropoff.phone,
    ...(req.dropoff.instructions ? { dropoff_notes: req.dropoff.instructions.slice(0, 280) } : {}),
    ...(req.dropoff.lat !== undefined && req.dropoff.lng !== undefined ? { dropoff_latitude: req.dropoff.lat, dropoff_longitude: req.dropoff.lng } : {}),
    manifest_items: req.items.map((i) => ({ name: i.name.slice(0, 120), quantity: Math.max(1, Math.round(i.quantity)), size: 'small', ...(i.price !== undefined ? { price: toCents(i.price) } : {}) })),
    manifest_total_value: toCents(req.orderValue),
    manifest_reference: req.reference,
    tip: toCents(req.tip),
    undeliverable_action: req.containsAlcohol || req.undeliverable === 'return_to_pickup' ? 'return' : 'leave_at_door',
    ...(req.containsAlcohol ? { dropoff_verification: { identification: { min_age: req.minAge ?? 18 } } } : {}),
    ...(req.pickupAt ? { pickup_ready_dt: new Date(req.pickupAt).toISOString() } : {}),
  };
}

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any; why: string }> {
  const t = await accessToken().catch(() => null);
  if (!t) return { ok: false, status: 401, json: null, why: 'Uber Direct refused the client id / secret (no access token).' };
  try {
    const res = await timedFetch(`${apiBase()}/v1/customers/${encodeURIComponent(process.env.UBER_DIRECT_CUSTOMER_ID || '')}${path}`, {
      method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    const why = res.ok ? '' : `Uber Direct HTTP ${res.status}${json?.code ? ` ${json.code}` : ''}${json?.message ? `: ${json.message}` : ''}`.slice(0, 400);
    return { ok: res.ok, status: res.status, json, why };
  } catch (e) {
    return { ok: false, status: 0, json: null, why: `Uber Direct network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function toResult(r: { ok: boolean; status: number; json: any; why: string }, okMessage: string): FleetResult {
  const b = r.json ?? {};
  if (!r.ok) return { ok: false, status: 'error', message: r.why, httpStatus: r.status, raw: b };
  return {
    ok: true, status: 'done', message: okMessage, httpStatus: r.status,
    fleetDeliveryId: b.id ? String(b.id) : undefined, deliveryStatus: uberStatus(b.status) ?? undefined,
    fee: typeof b.fee === 'number' ? fromCents(b.fee) : undefined, trackingUrl: b.tracking_url || undefined,
    pickupEta: b.pickup_eta || undefined, dropoffEta: b.dropoff_eta || undefined, courier: courierOf(b.courier), raw: b,
  };
}

// ---------- The rest of the Direct API (developer.uber.com/docs/deliveries/api-reference/daas) ----------

/**
 * Update Delivery (POST /deliveries/{id}): notes for the courier, the customer's tip, a later pickup time. Uber takes
 * changes only until the courier reaches that step (its FAQ lists the timings). A write: live switch in production.
 */
export async function updateUberDirectDelivery(fleetDeliveryId: string, patch: { dropoffNotes?: string; pickupNotes?: string; tipByCustomer?: number; pickupReadyAt?: string }): Promise<FleetResult> {
  const r = readiness();
  if (!r.canSend) return blocked(r.note);
  if (!fleetDeliveryId) return { ok: false, status: 'error', message: 'No Uber Direct delivery id yet.' };
  const body = {
    ...(patch.dropoffNotes !== undefined ? { dropoff_notes: patch.dropoffNotes.slice(0, 280) } : {}),
    ...(patch.pickupNotes !== undefined ? { pickup_notes: patch.pickupNotes.slice(0, 280) } : {}),
    ...(patch.tipByCustomer !== undefined ? { tip_by_customer: toCents(patch.tipByCustomer) } : {}),
    ...(patch.pickupReadyAt ? { pickup_ready_dt: new Date(patch.pickupReadyAt).toISOString() } : {}),
  };
  if (!Object.keys(body).length) return { ok: false, status: 'error', message: 'Nothing to change.' };
  return toResult(await call('POST', `/deliveries/${encodeURIComponent(fleetDeliveryId)}`, body), 'Updated on Uber Direct.');
}

/** List Deliveries (GET /deliveries): this account's deliveries, newest first, for one kitchen (external_store_id) or all. */
export async function listUberDirectDeliveries(q: { filter?: 'pending' | 'pickup' | 'pickup_complete' | 'dropoff' | 'delivered' | 'canceled' | 'returned' | 'ongoing'; externalStoreId?: string; limit?: number; offset?: number } = {}): Promise<{ ok: boolean; deliveries: Array<{ id: string; status: DeliveryStatus | null; fee?: number; externalId?: string; created?: string; trackingUrl?: string }>; error?: string }> {
  const r = readiness();
  if (!r.configured) return { ok: false, deliveries: [], error: r.note };
  const qs = new URLSearchParams();
  if (q.filter) qs.set('filter', q.filter);
  if (q.externalStoreId) qs.set('external_store_id', q.externalStoreId);
  qs.set('limit', String(Math.max(1, Math.min(100, q.limit ?? 50))));
  if (q.offset) qs.set('offset', String(q.offset));
  const res = await call('GET', `/deliveries?${qs}`);
  if (!res.ok) return { ok: false, deliveries: [], error: res.why };
  const rows: any[] = Array.isArray(res.json?.data) ? res.json.data : [];
  return { ok: true, deliveries: rows.map((d) => ({ id: String(d.id ?? ''), status: uberStatus(d.status), fee: typeof d.fee === 'number' ? fromCents(d.fee) : undefined, externalId: d.external_id || undefined, created: d.created || undefined, trackingUrl: d.tracking_url || undefined })) };
}

/** Proof of Delivery (POST /deliveries/{id}/proof-of-delivery): the photo / signature / PIN proof as a base64 PNG. */
export async function uberDirectProofOfDelivery(fleetDeliveryId: string, waypoint: 'pickup' | 'dropoff' | 'return' = 'dropoff', type: 'picture' | 'signature' | 'pincode' = 'picture'): Promise<{ ok: boolean; document?: string; error?: string }> {
  const r = readiness();
  if (!r.configured) return { ok: false, error: r.note };
  if (!fleetDeliveryId) return { ok: false, error: 'No Uber Direct delivery id yet.' };
  const res = await call('POST', `/deliveries/${encodeURIComponent(fleetDeliveryId)}/proof-of-delivery`, { waypoint, type });
  if (!res.ok) return { ok: false, error: res.why };
  const doc = typeof res.json?.document === 'string' ? res.json.document : '';
  return doc ? { ok: true, document: doc } : { ok: false, error: 'Uber Direct has no proof for this delivery yet.' };
}

export const UBER_DIRECT_REFUND_KIND = 'event.refund_request';

export interface UberDirectRefund { fleetDeliveryId: string; ref: string | null; refundId: string | null; currency: string; partnerRefund: number; uberRefund: number; reasons: string[]; at: string }

/** event.refund_request → what the owner needs: who pays what (Uber adjusts its invoice; the partner refunds the customer). */
export function uberDirectRefund(body: any): UberDirectRefund | null {
  if (String(body?.kind ?? '') !== UBER_DIRECT_REFUND_KIND || !body?.delivery_id) return null;
  const d = body.data ?? {};
  const items: any[] = Array.isArray(d.refund_order_items) ? d.refund_order_items : [];
  return {
    fleetDeliveryId: String(body.delivery_id), ref: body.external_id ? String(body.external_id) : null, refundId: d.id ? String(d.id) : null,
    currency: String(d.currency_code ?? 'CAD').toUpperCase(), partnerRefund: fromCents(Number(d.total_partner_refund) || 0), uberRefund: fromCents(Number(d.total_uber_refund) || 0),
    reasons: items.map((i) => [i?.reason, i?.party_at_fault ? `(${i.party_at_fault})` : ''].filter(Boolean).join(' ')).filter(Boolean),
    at: body.created || nowIso(),
  };
}

export const uberDirect: CourierFleet = {
  key: 'uber_direct',
  label: 'Uber Direct',
  readiness,
  async quote(req) {
    const at = nowIso();
    const r = readiness();
    if (!r.canSend) return { fleet: 'uber_direct', ok: false, blocked: true, error: r.note, at };
    const res = await call('POST', '/delivery_quotes', {
      pickup_address: uberAddress(req.pickup.parts, req.pickup.address), dropoff_address: uberAddress(req.dropoff.parts, req.dropoff.address),
      pickup_phone_number: normalizePhone(req.pickup.phone) ?? req.pickup.phone, dropoff_phone_number: normalizePhone(req.dropoff.phone) ?? req.dropoff.phone,
      manifest_total_value: toCents(req.orderValue), external_store_id: req.pickup.locationCode,
      ...(req.pickupAt ? { pickup_ready_dt: new Date(req.pickupAt).toISOString() } : {}),
    });
    if (!res.ok) return { fleet: 'uber_direct', ok: false, error: res.why, at };
    const b = res.json ?? {};
    return {
      fleet: 'uber_direct', ok: true, fee: fromCents(Number(b.fee) || 0), currency: String(b.currency_type ?? b.currency ?? 'CAD').toUpperCase(), quoteId: b.id ? String(b.id) : undefined,
      expiresAt: b.expires || new Date(Date.parse(at) + 5 * 60_000).toISOString(), dropoffEta: b.dropoff_eta || undefined, at,
    } satisfies DeliveryQuote;
  },
  async create(req, quote) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    const fresh = quote?.ok && quote.fleet === 'uber_direct' && quote.quoteId && quote.expiresAt && Date.parse(quote.expiresAt) > Date.now() + 10_000;
    return toResult(await call('POST', '/deliveries', uberDeliveryBody(req, fresh ? quote!.quoteId : undefined)), 'Booked on Uber Direct — a courier is being assigned.');
  },
  async get(_id, fleetDeliveryId) {
    const r = readiness();
    if (!r.configured) return blocked(r.note);
    if (!fleetDeliveryId) return { ok: false, status: 'error', message: 'No Uber Direct delivery id yet.' };
    return toResult(await call('GET', `/deliveries/${encodeURIComponent(fleetDeliveryId)}`), 'OK');
  },
  async cancel(_id, fleetDeliveryId) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    if (!fleetDeliveryId) return { ok: false, status: 'error', message: 'No Uber Direct delivery id yet.' };
    return toResult(await call('POST', `/deliveries/${encodeURIComponent(fleetDeliveryId)}/cancel`, {}), 'Cancelled on Uber Direct.');
  },
  verifyWebhook(h, rawBody) {
    const key = process.env.UBER_DIRECT_WEBHOOK_SECRET;
    if (!key) return false;
    const got = (h.get('x-uber-signature') || h.get('x-postmates-signature') || '').trim().toLowerCase();
    const want = crypto.createHmac('sha256', key).update(rawBody).digest('hex');
    return safeEqual(got, want);
  },
  parseWebhook(body: any): FleetEvent | null {
    // A refund request is not a courier status (its data is the refund): handled by uberDirectRefund instead.
    if (String(body?.kind ?? '') === UBER_DIRECT_REFUND_KIND) return null;
    const d = body?.data ?? body;
    const fleetId = body?.delivery_id ?? d?.id;
    if (!fleetId) return null;
    const isCourier = String(body?.kind ?? '').includes('courier');
    return {
      fleet: 'uber_direct', ref: String(d?.external_id ?? fleetId), fleetDeliveryId: String(fleetId),
      status: isCourier ? null : uberStatus(body?.status ?? d?.status), event: String(body?.kind ?? 'event.delivery_status'), at: body?.created || nowIso(),
      fee: typeof d?.fee === 'number' ? fromCents(d.fee) : undefined, trackingUrl: d?.tracking_url || undefined,
      pickupEta: d?.pickup_eta || undefined, dropoffEta: d?.dropoff_eta || undefined,
      courier: courierOf(d?.courier ?? (isCourier ? { location: body?.location ?? d?.location } : undefined)),
      cancelReason: d?.undeliverable_reason || undefined,
    };
  },
};
