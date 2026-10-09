// Uber Direct — Uber's on-demand couriers for our own orders. Second fleet: a comparison quote and the fallback when
// DoorDash Drive cannot take a delivery.
// Docs: https://developer.uber.com/docs/deliveries — every endpoint is here (table: docs/UBER_API_COVERAGE.md):
//   POST https://auth.uber.com/oauth/v2/token            client_credentials, scope eats.deliveries or direct.organizations
//   POST /v1/customers/{customer_id}/delivery_quotes      fee + ETA, quote id (dqt_…)
//   POST /v1/customers/{customer_id}/deliveries           book (quote_id, idempotency_key, proof, CPP pick_pack_pay)
//   GET  /v1/customers/{customer_id}/deliveries[/{id}]    list / one
//   POST /v1/customers/{customer_id}/deliveries/{id}      update (notes, tip, times)
//   POST /v1/customers/{customer_id}/deliveries/{id}/cancel | /proof-of-delivery
//   POST /v1/direct/{customer_id}/submit_refund            Refund Submission API (Uber agreement)
//   /v1/direct/organizations[/{id}[/memberships/invite | /business_locations[/{id}] | /stores]]  (direct.organizations)
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

// One token per scope: eats.deliveries (Direct API, refunds) and direct.organizations (Organizations, Business
// Locations, Find Stores). Same client id / secret; a token lives 30 days.
type DirectScope = 'eats.deliveries' | 'direct.organizations';
const tokens = new Map<DirectScope, { value: string; until: number }>();
async function accessToken(scope: DirectScope = 'eats.deliveries'): Promise<string | null> {
  const t = tokens.get(scope);
  if (t && t.until > Date.now() + 60_000) return t.value;
  const form = new URLSearchParams({ client_id: process.env.UBER_DIRECT_CLIENT_ID || '', client_secret: process.env.UBER_DIRECT_CLIENT_SECRET || '', grant_type: 'client_credentials', scope });
  const res = await timedFetch(`${authBase()}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!res.ok) return null;
  const b = await res.json().catch(() => ({}));
  if (!b?.access_token) return null;
  tokens.set(scope, { value: String(b.access_token), until: Date.now() + Math.max(60, Number(b.expires_in) || 3600) * 1000 });
  return tokens.get(scope)!.value;
}

/** For tests: forget the cached tokens. */
export function resetUberDirectToken() { tokens.clear(); }

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

/**
 * Proof and hand-off options (Settings → Delivery → Uber Direct). Alcohol: always meet at the door with an ID check
 * (identification.min_age). Uber refuses "leave at door" with a signature, a PIN or an ID check.
 */
function uberHandoff(req: DeliveryRequest) {
  const o = req.uber;
  const proof = o?.proof ?? 'none';
  const verification = {
    ...(proof === 'picture' ? { picture: true } : proof === 'signature' ? { signature: true } : proof === 'pincode' ? { pincode: { enabled: true } } : {}),
    ...(req.containsAlcohol ? { identification: { min_age: req.minAge ?? 18 } } : {}),
  };
  const leave = !req.containsAlcohol && o?.deliverableAction === 'leave_at_door' && (proof === 'none' || proof === 'picture');
  return {
    ...(o ? { deliverable_action: leave ? 'deliverable_action_leave_at_door' : 'deliverable_action_meet_at_door' } : {}),
    ...(Object.keys(verification).length ? { dropoff_verification: verification } : {}),
    strict: req.containsAlcohol || proof === 'signature' || proof === 'pincode',
  };
}

/** manifest_items: name, quantity, size (small for a meal bag), price in cents. */
function uberManifest(req: DeliveryRequest) {
  return req.items.map((i) => ({ name: i.name.slice(0, 120), quantity: Math.max(1, Math.round(i.quantity)), size: 'small', ...(i.price !== undefined ? { price: toCents(i.price) } : {}) }));
}

export function uberDeliveryBody(req: DeliveryRequest, quoteId?: string) {
  const { strict, ...handoff } = uberHandoff(req);
  return {
    ...(quoteId ? { quote_id: quoteId } : {}),
    external_id: req.id,
    // Retrying the same delivery never books two couriers (Uber keeps the key ~60 minutes).
    idempotency_key: req.id,
    external_store_id: req.pickup.locationCode,
    pickup_name: req.pickup.businessName,
    pickup_business_name: req.pickup.businessName,
    pickup_address: uberAddress(req.pickup.parts, req.pickup.address),
    pickup_phone_number: normalizePhone(req.pickup.phone) ?? req.pickup.phone,
    ...(req.pickup.instructions ? { pickup_notes: `${req.reference} — ${req.pickup.instructions}`.slice(0, 280) } : { pickup_notes: req.reference }),
    dropoff_name: req.dropoff.name,
    dropoff_address: uberAddress(req.dropoff.parts, req.dropoff.address),
    dropoff_phone_number: normalizePhone(req.dropoff.phone) ?? req.dropoff.phone,
    ...(req.dropoff.instructions ? { dropoff_notes: req.dropoff.instructions.slice(0, 280) } : {}),
    ...(req.dropoff.lat !== undefined && req.dropoff.lng !== undefined ? { dropoff_latitude: req.dropoff.lat, dropoff_longitude: req.dropoff.lng } : {}),
    manifest_items: uberManifest(req),
    manifest_total_value: toCents(req.orderValue),
    manifest_reference: req.reference,
    tip: toCents(req.tip),
    undeliverable_action: strict || req.undeliverable === 'return_to_pickup' ? 'return' : 'leave_at_door',
    ...handoff,
    ...(req.uber?.pickPackPay ? { pickup_action: 'pick_pack_pay' } : {}),
    ...(req.pickupAt ? { pickup_ready_dt: new Date(req.pickupAt).toISOString() } : {}),
  };
}

/** The organization (customer id) deliveries are booked under. A sub-organization (Organizations API) has its own. */
export function uberDirectCustomerId(): string { return process.env.UBER_DIRECT_CUSTOMER_ID || ''; }

/**
 * One Direct API call. `path` is under /v1/customers/{customer_id} unless `opts.root` (then under /v1, e.g. the
 * Organizations API at /v1/direct/organizations). `opts.scope` picks the token (direct.organizations for org calls).
 */
async function call(method: string, path: string, body?: unknown, opts: { scope?: DirectScope; root?: boolean; customerId?: string } = {}): Promise<{ ok: boolean; status: number; json: any; why: string }> {
  const t = await accessToken(opts.scope).catch(() => null);
  if (!t) return { ok: false, status: 401, json: null, why: `Uber Direct refused the client id / secret (no access token${opts.scope === 'direct.organizations' ? ' with the direct.organizations scope' : ''}).` };
  try {
    const url = opts.root ? `${apiBase()}/v1${path}` : `${apiBase()}/v1/customers/${encodeURIComponent(opts.customerId || uberDirectCustomerId())}${path}`;
    const res = await timedFetch(url, {
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
    pickupEta: b.pickup_eta || undefined, dropoffEta: b.dropoff_eta || undefined, courier: courierOf(b.courier), dropoffPin: pinOf(b), raw: b,
  };
}

/** The dropoff PIN Uber generated (dropoff.verification_requirements.pincode.value), when PIN proof is on. */
function pinOf(d: any): string | undefined {
  const v = d?.dropoff?.verification_requirements?.pincode?.value ?? d?.verification_requirements?.pincode?.value;
  return v ? String(v) : undefined;
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

// ---------- Refund Submission API (needs a separate Uber agreement) ----------

export const UBER_DIRECT_REFUND_REASONS = ['uber_never_received_order', 'uber_entire_order_wrong', 'uber_missing_items', 'uber_damaged_item', 'uber_order_delivered_late', 'uber_delayed_pick_up',
  'uber_had_to_prepare_order_again', 'uber_never_pick_up', 'uber_courier_cancelled', 'uber_safety_issue', 'uber_return_trip_issue'] as const;
export type UberDirectRefundReason = (typeof UBER_DIRECT_REFUND_REASONS)[number];

/**
 * Submit Refund body (POST /v1/direct/{customer_id}/submit_refund). Amount in E5 (1/100000 of the currency unit);
 * requester_email_id = a Direct dashboard admin (UBER_DIRECT_REFUND_EMAIL), who gets Uber's answers by email.
 */
export function uberDirectRefundBody(p: { fleetDeliveryId: string; reason: UberDirectRefundReason; amount: number; currency?: string; notes?: string; itemsMissing?: string[]; requesterEmail: string }) {
  return {
    delivery_id: p.fleetDeliveryId, requester_email_id: p.requesterEmail, refund_reason: p.reason,
    ...(p.notes ? { notes: p.notes.slice(0, 1000) } : {}),
    ...(p.reason === 'uber_missing_items' && p.itemsMissing?.length ? { items_missing: p.itemsMissing.map((x) => x.slice(0, 120)) } : {}),
    total_refund_amount: { amount: Math.round(p.amount * 100_000), currency_code: (p.currency || 'CAD').toUpperCase() },
  };
}

/** Ask Uber to refund a delivery it got wrong (missing items, late, never picked up…). */
export async function submitUberDirectRefund(p: Omit<Parameters<typeof uberDirectRefundBody>[0], 'requesterEmail'> & { requesterEmail?: string }): Promise<{ ok: boolean; message: string; httpStatus?: number }> {
  const r = readiness();
  if (!r.canSend) return { ok: false, message: r.note };
  const email = p.requesterEmail || process.env.UBER_DIRECT_REFUND_EMAIL || '';
  if (!email) return { ok: false, message: 'Set UBER_DIRECT_REFUND_EMAIL (a Direct dashboard admin) first.' };
  if (!UBER_DIRECT_REFUND_REASONS.includes(p.reason)) return { ok: false, message: 'Choose one of Uber’s refund reasons.' };
  if (!(p.amount > 0)) return { ok: false, message: 'Enter the amount to refund.' };
  const res = await call('POST', `/direct/${encodeURIComponent(uberDirectCustomerId())}/submit_refund`, uberDirectRefundBody({ ...p, requesterEmail: email }), { root: true });
  return res.ok ? { ok: true, message: 'Refund request sent to Uber Direct — Uber answers by email.', httpStatus: res.status }
    : { ok: false, message: res.status === 409 ? 'Uber already has a refund request for this delivery.' : res.why, httpStatus: res.status };
}

// ---------- Organizations, Business Locations, Find Stores (scope direct.organizations) ----------

export interface UberDirectOrgInput {
  name: string;
  merchantType?: string;
  billingType?: 'BILLING_TYPE_CENTRALIZED' | 'BILLING_TYPE_DECENTRALIZED';
  contact: { email: string; firstName: string; lastName: string; phone?: string };
  address: { street1: string; street2?: string; city: string; province: string; postalCode: string; country?: string };
  parentId?: string;
  /** false = no onboarding email from Uber (ONBOARDING_INVITE_TYPE_INVALID, as in Uber's example). */
  invite?: boolean;
}

/** Uber's phone_details for a North American number: { phone_number: "1XXXXXXXXXX", country_code: "1", subscriber_number }. */
function phoneDetails(phone?: string) {
  const digits = String(phone ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length === 10 ? { phone_number: `1${digits}`, country_code: '1', subscriber_number: digits } : undefined;
}

export function uberDirectOrgBody(o: UberDirectOrgInput) {
  const phone = phoneDetails(o.contact.phone);
  return {
    info: {
      name: o.name.slice(0, 100), billing_type: o.billingType ?? 'BILLING_TYPE_CENTRALIZED', merchant_type: o.merchantType ?? 'MERCHANT_TYPE_RESTAURANT',
      point_of_contact: { email: o.contact.email, first_name: o.contact.firstName, last_name: o.contact.lastName, ...(phone ? { phone_details: phone } : {}) },
      address: { street1: o.address.street1, street2: o.address.street2 ?? '', city: o.address.city, state: o.address.province, zipcode: o.address.postalCode, country_iso2: o.address.country ?? 'CA' },
    },
    hierarchy_info: { parent_organization_id: o.parentId || uberDirectCustomerId() },
    ...(o.invite === false ? { options: { onboarding_invite_type: 'ONBOARDING_INVITE_TYPE_INVALID' } } : {}),
  };
}

/** Create Direct Organization (POST /v1/direct/organizations): a sub-organization, e.g. one per ON2GO merchant. Only Uber deletes one. */
export async function createUberDirectOrganization(o: UberDirectOrgInput): Promise<{ ok: boolean; organizationId?: string; message: string }> {
  const r = readiness();
  if (!r.canSend) return { ok: false, message: r.note };
  if (!o.name?.trim() || !o.contact?.email || !o.address?.street1) return { ok: false, message: 'Name, contact email and address are required.' };
  const res = await call('POST', '/direct/organizations', uberDirectOrgBody(o), { scope: 'direct.organizations', root: true });
  return res.ok ? { ok: true, organizationId: res.json?.organization_id ? String(res.json.organization_id) : undefined, message: 'Organization created on Uber Direct.' } : { ok: false, message: res.why };
}

/** Get Direct Organization Details (GET /v1/direct/organizations/{id}). */
export async function getUberDirectOrganization(organizationId = uberDirectCustomerId()): Promise<{ ok: boolean; organization?: any; error?: string }> {
  if (!readiness().configured) return { ok: false, error: readiness().note };
  const res = await call('GET', `/direct/organizations/${encodeURIComponent(organizationId)}`, undefined, { scope: 'direct.organizations', root: true });
  return res.ok ? { ok: true, organization: res.json } : { ok: false, error: res.why };
}

/** Invite New User to Organization (POST /v1/direct/organizations/{id}/memberships/invite): Uber emails the invitation. */
export async function inviteUberDirectMember(organizationId: string, u: { email: string; firstName: string; lastName: string; phone?: string; role: 'ROLE_ADMIN' | 'ROLE_EMPLOYEE' | 'ROLE_SUPPORT'; externalStoreId?: string }): Promise<{ ok: boolean; membershipId?: string; message: string }> {
  const r = readiness();
  if (!r.canSend) return { ok: false, message: r.note };
  const phone = phoneDetails(u.phone);
  const body = {
    user_details: { email: u.email, first_name: u.firstName, last_name: u.lastName, ...(phone ? { phone_details: phone } : {}) },
    roles: [u.role],
    ...(u.externalStoreId ? { role_assignments: { role: u.role, role_scope: { organization_id: organizationId, store_identifier: { organization_id: organizationId, external_store_id: u.externalStoreId } } } } : {}),
  };
  const res = await call('POST', `/direct/organizations/${encodeURIComponent(organizationId)}/memberships/invite`, body, { scope: 'direct.organizations', root: true });
  return res.ok ? { ok: true, membershipId: res.json?.membership_id ? String(res.json.membership_id) : undefined, message: `Invitation sent to ${u.email}.` } : { ok: false, message: res.why };
}

export interface UberBusinessLocation { id: string; name: string; phone?: string; address?: string; externalId?: string; organizationId?: string }
const toLocation = (b: any): UberBusinessLocation => ({
  id: String(b?.business_location_id ?? ''), name: String(b?.name ?? ''), phone: b?.phone_number || undefined, address: b?.address || undefined,
  externalId: b?.external_business_location_id || undefined, organizationId: b?.organization_id || undefined,
});

/** List Business Locations (GET /v1/direct/organizations/{id}/business_locations, 100 a page). */
export async function listUberDirectBusinessLocations(organizationId = uberDirectCustomerId(), pageToken?: string): Promise<{ ok: boolean; locations: UberBusinessLocation[]; nextPageToken?: string; error?: string }> {
  if (!readiness().configured) return { ok: false, locations: [], error: readiness().note };
  const res = await call('GET', `/direct/organizations/${encodeURIComponent(organizationId)}/business_locations?limit=100${pageToken ? `&pagetoken=${encodeURIComponent(pageToken)}` : ''}`, undefined, { scope: 'direct.organizations', root: true });
  if (!res.ok) return { ok: false, locations: [], error: res.why };
  return { ok: true, locations: (Array.isArray(res.json?.business_locations) ? res.json.business_locations : []).map(toLocation), nextPageToken: res.json?.next_page_token || undefined };
}

/** Get Business Location (GET …/business_locations/{id}). */
export async function getUberDirectBusinessLocation(businessLocationId: string, organizationId = uberDirectCustomerId()): Promise<{ ok: boolean; location?: UberBusinessLocation; error?: string }> {
  if (!readiness().configured) return { ok: false, error: readiness().note };
  const res = await call('GET', `/direct/organizations/${encodeURIComponent(organizationId)}/business_locations/${encodeURIComponent(businessLocationId)}`, undefined, { scope: 'direct.organizations', root: true });
  return res.ok ? { ok: true, location: toLocation(res.json?.business_location ?? res.json) } : { ok: false, error: res.why };
}

/**
 * Update Business Location (PATCH …/business_locations/{id}): name, phone, address (+ lat/lng) and the external id.
 * Set the external id to the Food Hub kitchen code: quotes and deliveries carry it as external_store_id.
 */
export async function updateUberDirectBusinessLocation(businessLocationId: string, patch: { name?: string; phone?: string; externalId?: string; address?: { street1: string; street2?: string; city: string; province: string; postalCode: string; country?: string }; lat?: number; lng?: number }, organizationId = uberDirectCustomerId()): Promise<{ ok: boolean; location?: UberBusinessLocation; message: string }> {
  const r = readiness();
  if (!r.canSend) return { ok: false, message: r.note };
  const body = {
    ...(patch.name ? { name: patch.name.slice(0, 100) } : {}),
    ...(patch.phone ? { phone_number: patch.phone } : {}),
    ...(patch.externalId ? { external_business_location_id: patch.externalId.slice(0, 150) } : {}),
    ...(patch.address ? { detailed_address: { street_address_1: patch.address.street1, street_address_2: patch.address.street2 ?? '', city: patch.address.city, state: patch.address.province, zip_code: patch.address.postalCode, country: patch.address.country ?? 'CA' } } : {}),
    ...(patch.address && patch.lat !== undefined && patch.lng !== undefined ? { location: { lat: patch.lat, lng: patch.lng } } : {}),
  };
  if (!Object.keys(body).length) return { ok: false, message: 'Nothing to change.' };
  const res = await call('PATCH', `/direct/organizations/${encodeURIComponent(organizationId)}/business_locations/${encodeURIComponent(businessLocationId)}`, body, { scope: 'direct.organizations', root: true });
  return res.ok ? { ok: true, location: toLocation(res.json?.business_location ?? res.json), message: 'Store updated on Uber Direct.' } : { ok: false, message: res.why };
}

/** Find Stores (GET /v1/direct/organizations/{customer_id}/stores?latitude&longitude): this account's stores that deliver there. */
export async function findUberDirectStores(lat: number, lng: number): Promise<{ ok: boolean; stores: any[]; error?: string }> {
  if (!readiness().configured) return { ok: false, stores: [], error: readiness().note };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, stores: [], error: 'Latitude and longitude are required.' };
  const res = await call('GET', `/direct/organizations/${encodeURIComponent(uberDirectCustomerId())}/stores?latitude=${lat}&longitude=${lng}`, undefined, { scope: 'direct.organizations', root: true });
  const list = res.json?.stores ?? res.json?.data ?? res.json;
  return res.ok ? { ok: true, stores: Array.isArray(list) ? list : [] } : { ok: false, stores: [], error: res.why };
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
      // Courier Pick & Pack: the quote must carry the items and the pickup action too.
      ...(req.uber?.pickPackPay ? { pickup_action: 'pick_pack_pay', manifest_items: uberManifest(req) } : {}),
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
      dropoffPin: pinOf(d),
    };
  },
};
