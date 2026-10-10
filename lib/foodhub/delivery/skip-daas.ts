// Skip "Delivery as a Service" (DaaS) — Skip's own couriers for OUR orders (phone, Clover delivery, website), the third
// fleet next to DoorDash Drive and Uber Direct. Published in Just Eat Takeaway's OpenAPI specification
// (https://uk.api.just-eat.io/docs/openapi.yaml, tag "Delivery as a Service"); some calls are marked "only available in the CA market".
//
//   POST {auth}/auth/realms/daas/protocol/openid-connect/token   Basic client id:secret, grant_type=client_credentials → JWT
//   GET  {daas}/v1/delivery/collect-points                       the kitchens Skip knows (the pick-up id of every estimate)
//   POST {daas}/v1/delivery/estimate                             price, ETA and a requestId valid 5 minutes
//   POST {daas}/v1/delivery                                      book with that requestId (202)
//   GET  {daas}/v1/delivery/status/{requestId}                   status, courier, tracking page (CA)
//   PUT  {daas}/v1/delivery/cancellation-request                 only while unassigned or not yet seen by the courier
//   POST {daas}/v1/delivery/request-assistance                   ask Skip for help on a running delivery (CA only)
//   POST {daas}/v1/delivery/simulate                             walk a test delivery through its steps (staging only)
//   /v1/delivery/notification-config  GET POST PATCH DELETE      where Skip sends the delivery events (one per client id)
// Webhook (Skip → us), 9 event types: COURIERJOBSTATUS CANCELJOBSTATUS COURIERCOLLECTIONTIME DELIVERYCREATED COURIERLOCATION
//   DELIVERYREJECTED COURIERDELIVERYTIME PROOFOFDELIVERY PROOFOFDELIVERY_PICTURE — authenticated with the secret we registered
//   (header x-api-key for TOKEN, Authorization: Basic for BASIC). Failed webhooks are not retried; 10 s time-out.
// Every request needs a User-Agent. Staging is the default: production needs SKIP_DAAS_ENV=production and the live switch.
//
// Env: SKIP_DAAS_CLIENT_ID, SKIP_DAAS_CLIENT_SECRET (issued by Skip), SKIP_DAAS_WEBHOOK_SECRET (we choose it),
//      SKIP_DAAS_COLLECT_POINTS ("NDG_MAIN=<collect point id>,HOCHELAGA=…"; empty = match the list Skip returns),
//      SKIP_DAAS_CONTACT_EMAIL (who Skip writes to when the webhook fails), SKIP_DAAS_DEFAULT_EMAIL (recipient e-mail when the
//      customer gave none — Skip requires one).
import { fromCents, liveConnectorsGloballyEnabled, missingEnv, nowIso, publicBaseUrl, result, safeEqual, stripSlash, timedFetch, toCents } from '../config';
import { normalizeEmail, normalizePhone } from '../notify';
import { blocked, type CourierFleet, type DeliveryRequest, type FleetEvent, type FleetResult } from './fleet';
import type { CourierPosition, DeliveryQuote, DeliveryStatus } from './types';
import type { ChannelResult } from '../types';

const REQUIRED = ['SKIP_DAAS_CLIENT_ID', 'SKIP_DAAS_CLIENT_SECRET'];
export const SKIP_DAAS_WEBHOOK_PATH = '/api/foodhub/webhooks/skip-daas';
const USER_AGENT = 'TAKATAK-FoodHub/1.0 (+https://takatak.ca)';

export function skipDaasEnvironment(): 'sandbox' | 'production' { return process.env.SKIP_DAAS_ENV === 'production' ? 'production' : 'sandbox'; }
function apiBase() { return stripSlash(process.env.SKIP_DAAS_BASE_URL || (skipDaasEnvironment() === 'production' ? 'https://api-daas.skipthedishes.com' : 'https://api-daas-staging.skipthedishes.com')); }
function authBase() { return stripSlash(process.env.SKIP_DAAS_AUTH_URL || (skipDaasEnvironment() === 'production' ? 'https://api.skipthedishes.com' : 'https://api-staging.skipthedishes.com')); }

function readiness() {
  const missing = missingEnv(REQUIRED);
  const environment = skipDaasEnvironment();
  const configured = missing.length === 0;
  const live = liveConnectorsGloballyEnabled();
  const canSend = configured && (environment === 'sandbox' || live);
  const note = !configured ? `Missing: ${missing.join(', ')} (asked from your Skip account manager: Delivery as a Service).`
    : environment === 'sandbox' ? 'Staging: estimates and test deliveries work, no real courier. Use the simulate call to move a delivery along.'
      : live ? 'Production: real Skip couriers are dispatched.' : 'Production credentials, but LIVE_CONNECTORS_GLOBAL_ENABLED is off — nothing is sent.';
  const noteFr = !configured ? `Manquant : ${missing.join(', ')} (à demander à votre responsable Skip : livraison en tant que service).`
    : environment === 'sandbox' ? 'Préproduction : les estimations et livraisons d’essai fonctionnent, aucun vrai livreur. Utilisez la simulation pour faire avancer une livraison.'
      : live ? 'Production : de vrais livreurs Skip sont envoyés.' : 'Clés de production, mais LIVE_CONNECTORS_GLOBAL_ENABLED est désactivé — rien n’est envoyé.';
  return { fleet: 'skip_daas' as const, label: 'Skip Delivery', configured, canSend, environment, missing, note, noteFr, webhookPath: SKIP_DAAS_WEBHOOK_PATH };
}

// --- token -----------------------------------------------------------------------------------------------------------

let token: { value: string; until: number } | null = null;
let tokenInFlight: Promise<string | null> | null = null;
/** For tests: forget the cached token. */
export function resetSkipDaasToken() { token = null; tokenInFlight = null; }

export async function skipDaasToken(): Promise<string | null> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  tokenInFlight ??= (async () => {
    try {
      const basic = Buffer.from(`${process.env.SKIP_DAAS_CLIENT_ID || ''}:${process.env.SKIP_DAAS_CLIENT_SECRET || ''}`).toString('base64');
      const res = await timedFetch(`${authBase()}/auth/realms/daas/protocol/openid-connect/token`, {
        method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      });
      if (!res.ok) return null;
      const b = await res.json().catch(() => ({}));
      if (!b?.access_token) return null;
      token = { value: String(b.access_token), until: Date.now() + Math.max(60, Number(b.expires_in) || 300) * 1000 };
      return token.value;
    } catch { return null; } finally { tokenInFlight = null; }
  })();
  return tokenInFlight;
}

interface Called { ok: boolean; status: number; json: any; why: string }

async function callApi(url: string, init: RequestInit): Promise<Called> {
  try {
    const res = await timedFetch(url, init);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    const why = res.ok ? '' : `Skip HTTP ${res.status}${json?.error ? ` ${json.error}` : ''}${json?.message ? `: ${json.message}` : ''}`.slice(0, 400);
    return { ok: res.ok, status: res.status, json, why };
  } catch (e) {
    return { ok: false, status: 0, json: null, why: `Skip network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Called> {
  const t = await skipDaasToken();
  if (!t) return { ok: false, status: 401, json: null, why: 'Skip refused the client id / secret (no access token).' };
  return callApi(`${apiBase()}${path}`, { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT }, body: body === undefined ? undefined : JSON.stringify(body) });
}

// --- mapping ---------------------------------------------------------------------------------------------------------

/** Skip's delivery status → ours. CANCELLATION_FAILURE changes nothing (the courier keeps the delivery). */
export function skipDaasStatus(s: unknown): DeliveryStatus | null {
  const map: Record<string, DeliveryStatus> = {
    UNASSIGNED: 'created', ASSIGNED: 'assigned', IN_TRANSIT_TO_COLLECT: 'assigned', ARRIVED_TO_COLLECT: 'at_pickup', COLLECTED: 'picked_up',
    IN_TRANSIT_TO_DELIVER: 'picked_up', ARRIVED_TO_DELIVER: 'at_dropoff', DELIVERED: 'delivered', RETURN_INITIATED: 'returning', IN_TRANSIT_TO_RETURN: 'returning',
    ARRIVED_TO_RETURN: 'returning', RETURNED: 'returned', CANCELLED: 'cancelled',
  };
  return map[String(s ?? '').toUpperCase()] ?? null;
}

/** "NDG_MAIN=abc,HOCHELAGA=def" → map. */
export function parseCollectPoints(raw = process.env.SKIP_DAAS_COLLECT_POINTS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(raw ?? '').split(/[,;\n]/)) {
    const [code, id] = part.split('=').map((x) => x?.trim());
    if (code && id) out[code.toUpperCase()] = id;
  }
  return out;
}

export interface SkipCollectPoint { id: string; name?: string; address?: string; city?: string; postalCode?: string; phoneNumber?: string; timeZone?: string; countryCode?: string }

let pointsCache: { at: number; list: SkipCollectPoint[] } | null = null;
export function resetSkipDaasCache() { pointsCache = null; }

/** GET /v1/delivery/collect-points — every page. */
export async function listSkipCollectPoints(opts: { fresh?: boolean } = {}): Promise<{ ok: boolean; points: SkipCollectPoint[]; message: string }> {
  if (!opts.fresh && pointsCache && Date.now() - pointsCache.at < 10 * 60_000) return { ok: true, points: pointsCache.list, message: 'OK' };
  const all: SkipCollectPoint[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await call('GET', `/v1/delivery/collect-points?limit=100&offset=${offset}`);
    if (!r.ok) return { ok: false, points: all, message: r.why };
    const page: any[] = Array.isArray(r.json?.collectPoints) ? r.json.collectPoints : [];
    all.push(...page.map((p) => ({ id: String(p.id), name: p.name, address: p.address, city: p.city, postalCode: p.postalCode, phoneNumber: p.phoneNumber, timeZone: p.timeZone, countryCode: p.countryCode })));
    if (page.length < 100) break;
  }
  pointsCache = { at: Date.now(), list: all };
  return { ok: true, points: all, message: 'OK' };
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The Skip collect point of a kitchen: the env mapping first, then the list Skip returns (a single one, or the one matching the name / street). */
export async function resolveCollectPoint(pickup: DeliveryRequest['pickup']): Promise<{ id?: string; error?: string }> {
  const mapped = parseCollectPoints()[pickup.locationCode.toUpperCase()];
  if (mapped) return { id: mapped };
  const list = await listSkipCollectPoints();
  if (!list.ok) return { error: list.message };
  if (list.points.length === 1) return { id: list.points[0].id };
  const street = norm(pickup.parts?.street ?? pickup.address.split(',')[0]);
  const byAddress = list.points.filter((p) => street && norm(p.address).includes(street));
  if (byAddress.length === 1) return { id: byAddress[0].id };
  const byName = list.points.filter((p) => norm(p.name) === norm(pickup.businessName));
  if (byName.length === 1) return { id: byName[0].id };
  return { error: `Skip knows ${list.points.length} collect points and none matches ${pickup.locationCode}: set SKIP_DAAS_COLLECT_POINTS (${pickup.locationCode}=<collect point id>).` };
}

export interface SkipEstimateBody {
  collect: { id: string };
  delivery: { name: string; emailAddress: string; phoneNumber: string; address: string; city: string; province?: string; postalCode?: string; geolocation?: { type: 'Point'; coordinates: [number, number] } };
  deliveryDetails?: { weightGrams?: number; preparationDuration?: number; hasAlcohol?: boolean; ageRestriction?: number; ageVerificationWithId?: boolean };
  deliveryOptions?: { proofOfDelivery?: { pinCode: { type: 'DSP_GENERATED' } }; unreachablePreference?: 'DROP_OFF' | 'RETURN'; dropoffAction?: 'CONTACTLESS' | 'MEET_AT_DOOR' };
  targetDeliverTime?: string;
  targetCollectTime?: string;
  itemList?: Array<{ itemId?: string; name?: string; quantity?: number; weight?: number; price?: number; category?: 'FOOD' | 'GROCERY' }>;
}

/** The estimate body for one delivery request. Returns an error text when Skip's required fields are missing. */
export function skipEstimateBody(req: DeliveryRequest, collectId: string, now = Date.now()): { body: SkipEstimateBody } | { error: string } {
  const email = normalizeEmail(req.dropoff.email) ?? normalizeEmail(process.env.SKIP_DAAS_DEFAULT_EMAIL);
  if (!email) return { error: 'Skip needs the recipient’s e-mail address: the customer gave none and SKIP_DAAS_DEFAULT_EMAIL is not set.' };
  const phone = normalizePhone(req.dropoff.phone);
  if (!phone) return { error: 'Skip needs the recipient’s phone number.' };
  const parts = req.dropoff.parts;
  if (!parts?.street || !parts.city) return { error: 'Skip needs the delivery address with street and city.' };
  const advance = req.pickupAt && Date.parse(req.pickupAt) > now + 5 * 60_000;
  const body: SkipEstimateBody = {
    collect: { id: collectId },
    delivery: {
      name: req.dropoff.name, emailAddress: email, phoneNumber: phone,
      address: [parts.street, parts.unit ? `#${parts.unit}` : ''].filter(Boolean).join(' '), city: parts.city, province: parts.province, postalCode: parts.postalCode,
      ...(req.dropoff.lat !== undefined && req.dropoff.lng !== undefined ? { geolocation: { type: 'Point' as const, coordinates: [req.dropoff.lat, req.dropoff.lng] as [number, number] } } : {}),
    },
    deliveryDetails: {
      ...(advance ? {} : { preparationDuration: 15 }),
      hasAlcohol: req.containsAlcohol,
      ...(req.containsAlcohol ? { ageRestriction: req.minAge ?? 18, ageVerificationWithId: true } : {}),
    },
    deliveryOptions: { unreachablePreference: req.undeliverable === 'return_to_pickup' || req.containsAlcohol ? 'RETURN' : 'DROP_OFF' },
    ...(advance ? { targetCollectTime: new Date(req.pickupAt!).toISOString() } : {}),
    itemList: req.items.slice(0, 50).map((i, n) => ({ itemId: String(i.externalId ?? `item-${n + 1}`).slice(0, 40), name: i.name.slice(0, 100), quantity: Math.max(1, Math.round(i.quantity)), ...(i.price !== undefined ? { price: toCents(i.price) } : {}), category: 'FOOD' as const })),
  };
  return { body };
}

export function skipCreateBody(req: DeliveryRequest, requestId: string, nowMs = Date.now()) {
  const advance = req.pickupAt && Date.parse(req.pickupAt) > nowMs + 5 * 60_000;
  return {
    requestId,
    vendorOrderId: req.reference,
    orderValue: toCents(req.orderValue),
    tip: toCents(req.tip),
    paymentType: 'PREPAID',
    specialInstructions: [req.dropoff.instructions, req.pickup.instructions].filter(Boolean).join(' — ').slice(0, 255) || undefined,
    ...(advance ? { targetCollectTime: new Date(req.pickupAt!).toISOString() } : {}),
    // Echoed in every webhook: how an event finds our delivery.
    metadata: { deliveryId: req.id },
  };
}

function courierOf(c: any): CourierPosition | undefined {
  if (!c || (!c.name && !c.latitude)) return undefined;
  return { name: c.name ? String(c.name) : undefined, lat: Number.isFinite(Number(c.latitude)) ? Number(c.latitude) : undefined, lng: Number.isFinite(Number(c.longitude)) ? Number(c.longitude) : undefined, updatedAt: nowIso() };
}

function dollars(cents: unknown) { return typeof cents === 'number' ? fromCents(cents) : undefined; }

// --- the fleet -------------------------------------------------------------------------------------------------------

export const skipDaas: CourierFleet = {
  key: 'skip_daas',
  label: 'Skip Delivery',
  readiness,
  async quote(req) {
    const at = nowIso();
    const r = readiness();
    if (!r.canSend) return { fleet: 'skip_daas', ok: false, blocked: true, error: r.note, at };
    const collect = await resolveCollectPoint(req.pickup);
    if (!collect.id) return { fleet: 'skip_daas', ok: false, error: collect.error, at };
    const built = skipEstimateBody(req, collect.id);
    if ('error' in built) return { fleet: 'skip_daas', ok: false, error: built.error, at };
    const res = await call('POST', '/v1/delivery/estimate', built.body);
    if (!res.ok) return { fleet: 'skip_daas', ok: false, error: res.why, at };
    const b = res.json ?? {};
    return {
      fleet: 'skip_daas', ok: true, fee: dollars(b.dynamicDeliveryFee) ?? 0, currency: 'CAD', quoteId: b.requestId ? String(b.requestId) : undefined,
      // Skip: the requestId "must be used within five minutes".
      expiresAt: new Date(Date.parse(at) + 5 * 60_000).toISOString(), pickupEta: b.estimatedEarliestCollectTime || b.targetCollectTime || undefined, dropoffEta: b.estimatedEarliestDeliverTime || b.targetDeliverTime || undefined, at,
    } satisfies DeliveryQuote;
  },
  async create(req, quote) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    let requestId = quote?.ok && quote.fleet === 'skip_daas' && quote.quoteId && quote.expiresAt && Date.parse(quote.expiresAt) > Date.now() + 10_000 ? quote.quoteId : undefined;
    let fee = quote?.fee;
    if (!requestId) {
      const q = await skipDaas.quote(req);
      if (!q.ok || !q.quoteId) return { ok: false, status: q.blocked ? 'blocked' : 'error', message: q.error ?? 'Skip gave no estimate.' };
      requestId = q.quoteId; fee = q.fee;
    }
    const res = await call('POST', '/v1/delivery', skipCreateBody(req, requestId));
    if (!res.ok) return { ok: false, status: 'error', message: res.why, httpStatus: res.status, raw: res.json };
    const b = res.json ?? {};
    return { ok: true, status: 'done', message: 'Booked on Skip Delivery — a courier is being assigned.', httpStatus: res.status, fleetDeliveryId: String(b.requestId ?? requestId), deliveryStatus: 'created', fee, raw: b } satisfies FleetResult;
  },
  async get(_id, fleetDeliveryId) {
    const r = readiness();
    if (!r.configured) return blocked(r.note);
    if (!fleetDeliveryId) return { ok: false, status: 'error', message: 'No Skip delivery request id yet.' };
    const res = await call('GET', `/v1/delivery/status/${encodeURIComponent(fleetDeliveryId)}`);
    if (!res.ok) return { ok: false, status: 'error', message: res.why, httpStatus: res.status, raw: res.json };
    const b = res.json ?? {};
    const tracking = typeof b.orderTrackerURL === 'string' && /^https?:/i.test(b.orderTrackerURL) ? b.orderTrackerURL : undefined;
    return { ok: true, status: 'done', message: 'OK', httpStatus: res.status, fleetDeliveryId, deliveryStatus: skipDaasStatus(b.status) ?? undefined, trackingUrl: tracking, supportReference: b.orderId ? String(b.orderId) : undefined, courier: courierOf(b.courier), raw: b };
  },
  async cancel(_id, fleetDeliveryId) {
    const r = readiness();
    if (!r.canSend) return blocked(r.note);
    if (!fleetDeliveryId) return { ok: false, status: 'error', message: 'No Skip delivery request id yet.' };
    const res = await call('PUT', '/v1/delivery/cancellation-request', { requestId: fleetDeliveryId });
    if (!res.ok) return { ok: false, status: 'error', message: `${res.why} (Skip cancels only while no courier has seen the delivery.)`, httpStatus: res.status, raw: res.json };
    return { ok: true, status: 'done', message: String(res.json?.message || 'Cancellation requested on Skip — the cancel notification confirms it.'), httpStatus: res.status, raw: res.json };
  },
  verifyWebhook(h) {
    const secret = process.env.SKIP_DAAS_WEBHOOK_SECRET;
    if (!secret) return false;
    const key = h.get('x-api-key');
    if (key && safeEqual(key.trim(), secret)) return true;
    const auth = (h.get('authorization') || '').trim();
    if (/^Basic\s+/i.test(auth)) {
      const decoded = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
      const user = process.env.SKIP_DAAS_WEBHOOK_USERNAME;
      return safeEqual(pass, secret) && (!user || decoded.startsWith(`${user}:`));
    }
    return Boolean(auth) && (safeEqual(auth.replace(/^(Bearer|Token)\s+/i, ''), secret));
  },
  parseWebhook: parseSkipDaasWebhook,
};

/** One DaaS notification ({ id, type, timestamp, data }) → a fleet event. Unknown shapes return null (kept, not guessed). */
export function parseSkipDaasWebhook(body: any): FleetEvent | null {
  const type = String(body?.type ?? '').toUpperCase();
  const d = body?.data;
  if (!type || !d || typeof d !== 'object') return null;
  const requestId = d.requestId ? String(d.requestId) : undefined;
  if (!requestId) return null;
  const at = typeof body.timestamp === 'string' ? body.timestamp : nowIso();
  const ref = String(d.metadata?.deliveryId ?? requestId);
  const base = { fleet: 'skip_daas' as const, ref, fleetDeliveryId: requestId, event: type, at };
  switch (type) {
    case 'COURIERJOBSTATUS': {
      const status = skipDaasStatus(d.status);
      const tracking = typeof d.orderTrackerURL === 'string' && /^https?:/i.test(d.orderTrackerURL) ? d.orderTrackerURL : undefined;
      return { ...base, status, trackingUrl: tracking, supportReference: d.orderId ? String(d.orderId) : undefined, courier: courierOf(d.courier), cancelReason: d.deliveryProperties?.reasonForReturn || undefined };
    }
    case 'CANCELJOBSTATUS':
      // status = whether the cancellation request worked; false leaves the delivery as it is.
      return { ...base, status: d.status === true ? 'cancelled' : null, cancelReason: d.status === true ? undefined : d.message ? String(d.message) : undefined };
    case 'DELIVERYREJECTED':
      return { ...base, status: 'failed', cancelReason: d.message ? String(d.message) : 'Skip could not take the delivery' };
    case 'DELIVERYCREATED':
      return { ...base, status: 'created' };
    case 'COURIERCOLLECTIONTIME':
      return { ...base, status: null, pickupEta: d.courierETA ? String(d.courierETA) : undefined };
    case 'COURIERDELIVERYTIME':
      return { ...base, status: null, dropoffEta: d.postPurchaseDeliveryEta ? String(d.postPurchaseDeliveryEta) : undefined };
    case 'COURIERLOCATION':
      return { ...base, status: null, courier: Number.isFinite(Number(d.latitude)) ? { lat: Number(d.latitude), lng: Number(d.longitude), updatedAt: at } : undefined };
    case 'PROOFOFDELIVERY': case 'PROOFOFDELIVERY_PICTURE':
      // Informative: the PIN / photo links are temporary (5 minutes) and not stored here.
      return { ...base, status: null };
    default:
      return null;
  }
}

// --- the rest of the API (not part of the fleet contract) -------------------------------------------------------------

function toChannel(r: Called, okMessage: string): ChannelResult {
  return r.ok ? { ...result('skip', 'done', okMessage, { httpStatus: r.status }), response: r.json } : result('skip', 'error', r.why, { httpStatus: r.status, response: r.json });
}

function gate(): ChannelResult | null {
  const r = readiness();
  return r.canSend ? null : result('skip', 'blocked', r.note);
}

/** POST /v1/delivery/estimate with a ready body (the fleet builds it from a DeliveryRequest). */
export async function skipDaasEstimate(body: SkipEstimateBody): Promise<ChannelResult> {
  return gate() ?? toChannel(await call('POST', '/v1/delivery/estimate', body), 'Estimate received (valid 5 minutes).');
}

/** POST /v1/delivery/request-assistance — CA market only. */
export const SKIP_ASSISTANCE_REASONS = ['COLLECTION_TIME_UPDATE', 'REPORT_COURIER_DELAY', 'REPORT_BAD_COURIER_BEHAVIOUR', 'OTHER_CUSTOMER_CONCERNS', 'SPECIAL_INSTRUCTIONS_INQUIRY', 'OTHER_ORDER_ISSUES'] as const;
export async function skipDaasRequestAssistance(requestId: string, collectPointId: string, reason: (typeof SKIP_ASSISTANCE_REASONS)[number]): Promise<ChannelResult> {
  if (!requestId || !collectPointId) return result('skip', 'error', 'requestId and the collect point id are required.');
  if (!SKIP_ASSISTANCE_REASONS.includes(reason)) return result('skip', 'error', `reason must be one of ${SKIP_ASSISTANCE_REASONS.join(', ')}.`);
  return gate() ?? toChannel(await call('POST', '/v1/delivery/request-assistance', { requestId, collect: { id: collectPointId }, reason }), 'Skip was asked for assistance.');
}

/** POST /v1/delivery/simulate — staging and dev only: walks a test delivery through its steps. */
export const SKIP_SIMULATION_STEPS = ['ASSIGNED', 'IN_TRANSIT_TO_COLLECT', 'ARRIVED_TO_COLLECT', 'COLLECTED', 'IN_TRANSIT_TO_DELIVER', 'ARRIVED_TO_DELIVER', 'DELIVERED', 'CANCELLED', 'RETURN_INITIATED', 'IN_TRANSIT_TO_RETURN', 'RETURNED'] as const;
export async function skipDaasSimulate(requestId: string, opts: { deliveryStep?: (typeof SKIP_SIMULATION_STEPS)[number]; stepWaitDuration?: number } = {}): Promise<ChannelResult> {
  if (skipDaasEnvironment() === 'production') return result('skip', 'blocked', 'Simulation exists only on staging.');
  if (!requestId) return result('skip', 'error', 'requestId is required.');
  if (opts.deliveryStep && !SKIP_SIMULATION_STEPS.includes(opts.deliveryStep)) return result('skip', 'error', `deliveryStep must be one of ${SKIP_SIMULATION_STEPS.join(', ')}.`);
  return gate() ?? toChannel(await call('POST', '/v1/delivery/simulate', { requestId, ...(opts.deliveryStep ? { deliveryStep: opts.deliveryStep } : {}), ...(opts.stepWaitDuration ? { stepWaitDuration: opts.stepWaitDuration } : {}) }), 'Simulation started.');
}

export const SKIP_NOTIFICATION_EVENTS = ['ALL', 'COURIERJOBSTATUS', 'CANCELJOBSTATUS', 'COURIERCOLLECTIONTIME', 'COURIERLOCATION', 'DELIVERYREJECTED', 'COURIERDELIVERYTIME', 'PROOFOFDELIVERY', 'PROOFOFDELIVERY_PICTURE'] as const;
export type SkipNotificationEvent = (typeof SKIP_NOTIFICATION_EVENTS)[number];

export interface SkipNotificationConfig { email: string; endpoint: string; secret: string; type: 'BASIC' | 'TOKEN'; username?: string; subscriptions?: SkipNotificationEvent[] }

export function skipNotificationConfigError(c: Partial<SkipNotificationConfig>, partial = false): string | null {
  if (!partial || c.endpoint !== undefined) { if (!/^https:\/\//i.test(String(c.endpoint ?? ''))) return 'The webhook address must start with https:// (Skip only calls HTTPS).'; }
  if (!partial || c.email !== undefined) { if (!normalizeEmail(c.email)) return 'A contact e-mail is required (Skip writes to it when the webhook fails).'; }
  if (!partial && !String(c.secret ?? '').trim()) return 'A secret (token or password) is required.';
  if (!partial && c.type !== 'BASIC' && c.type !== 'TOKEN') return 'type must be BASIC or TOKEN.';
  if (c.type === 'BASIC' && !String(c.username ?? '').trim() && !partial) return 'BASIC needs a username.';
  if (c.subscriptions && c.subscriptions.some((e) => !SKIP_NOTIFICATION_EVENTS.includes(e))) return `subscriptions can only hold ${SKIP_NOTIFICATION_EVENTS.join(', ')}.`;
  return null;
}

export const skipDaasNotificationConfig = {
  /** The address Skip should call: ours. */
  defaultEndpoint: () => `${publicBaseUrl()}${SKIP_DAAS_WEBHOOK_PATH}`,
  get: async (): Promise<ChannelResult> => gate() ?? toChannel(await call('GET', '/v1/delivery/notification-config'), 'Webhook configuration read.'),
  /** One configuration per client credential. 204 = saved. */
  create: async (c: SkipNotificationConfig): Promise<ChannelResult> => {
    const bad = skipNotificationConfigError(c);
    if (bad) return result('skip', 'error', bad);
    return gate() ?? toChannel(await call('POST', '/v1/delivery/notification-config', c), 'Webhook configuration saved on Skip.');
  },
  patch: async (c: Partial<SkipNotificationConfig>): Promise<ChannelResult> => {
    const bad = skipNotificationConfigError(c, true);
    if (bad) return result('skip', 'error', bad);
    return gate() ?? toChannel(await call('PATCH', '/v1/delivery/notification-config', c), 'Webhook configuration updated on Skip.');
  },
  delete: async (): Promise<ChannelResult> => gate() ?? toChannel(await call('DELETE', '/v1/delivery/notification-config'), 'Webhook configuration deleted on Skip.'),
};

/** Registers Food Hub's address with the secret from SKIP_DAAS_WEBHOOK_SECRET (token type, every event). */
export async function registerSkipDaasWebhook(): Promise<ChannelResult> {
  const secret = process.env.SKIP_DAAS_WEBHOOK_SECRET;
  if (!secret) return result('skip', 'blocked', 'Set SKIP_DAAS_WEBHOOK_SECRET first (a long random value — it is what Skip sends back as x-api-key).');
  return skipDaasNotificationConfig.create({ email: process.env.SKIP_DAAS_CONTACT_EMAIL || '', endpoint: skipDaasNotificationConfig.defaultEndpoint(), secret, type: 'TOKEN', subscriptions: ['ALL'] });
}
