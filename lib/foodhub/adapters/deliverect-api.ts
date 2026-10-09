// Deliverect — the only official way Too Good To Go sends Surprise Bag orders to a point of sale (a one-way
// integration: orders go to the POS; editing or cancelling happens in TGTG MyStore). Too Good To Go itself publishes no
// public store, order or POS API (its developer portal is sign-in only), so Food Hub joins the Deliverect POS ecosystem:
// Deliverect's published APIs ARE the Too Good To Go integration surface a restaurant group or retailer can use.
//   Docs: https://developers.deliverect.com  (Restaurant POS API, Store API, KDS API, Retail API)
//   Coverage table: docs/TGTG_API_COVERAGE.md
//
// This file is the outbound half (Food Hub → Deliverect): OAuth client credentials, then
//   POS API     POST /orderStatus/{orderId} · POST /updatePreparationTime · POST /updateBill/{locationId}
//               PUT /locations/{locationId}/readiness/pos (health, every 10 min) · POST /orderValidation/{validationId}
//               POST /productAndCategories (insert / update products)
//   Store API   accounts · brands · locations · channel links · channels · allergens & tags · POS products · snoozed products
//               snooze by PLU / by tag · request product sync · opening hours (set, account, location) · holiday hours (location,
//               channel link; set and read) · busy mode · orders
//   KDS API     POST /kds/orderStatus/{orderId}
//   Retail API  POST /catalog/accounts/{accountId}/itemsUploadUrl · POST …/inventoryUploadUrl (+ the signed CSV upload)
// The inbound half (Deliverect → Food Hub: orders, register, sync, tax, validation, store status, reporting events, KDS and
// retail channel webhooks) is deliverect.ts and app/api/foodhub/webhooks/deliverect/[...kind].
//
// Env: DELIVERECT_CLIENT_ID, DELIVERECT_CLIENT_SECRET (issued when Deliverect certifies the POS partner),
//      DELIVERECT_BASE_URL (staging https://api.staging.deliverect.com · production https://api.deliverect.com — set by you,
//      never guessed), DELIVERECT_RETAIL_BASE_URL (https://api.staging.deliverect.io / https://api.deliverect.io),
//      DELIVERECT_RETAIL_VERSION (the X-Deliverect-Version header the retail upload calls require).
// Nothing is sent without the keys, the base URL and the live switch (staging base URLs run without the live switch).
import { callApi, liveConnectorsGloballyEnabled, missingEnv, nowIso, result, stripSlash, timedFetch } from '../config';
import type { ChannelResult } from '../types';

const KEY = 'tgtg' as const;

/** Order status codes (Deliverect "Order and Courier Statuses"). */
export const DELIVERECT_STATUS = {
  PARSED: 1, RECEIVED_BY_POS: 2, NEW: 10, ACCEPTED: 20, DUPLICATE: 30, DENIED: 35, PRINTED: 40, PREPARING: 50, PREPARED: 60, PICKUP_READY: 70,
  IN_DELIVERY: 80, FINALIZED: 90, AUTO_FINALIZED: 95, CANCEL: 100, CANCELED: 110, FAILED: 120, POS_FAILED: 121, RETRY_FAILED: 122, MANUAL_RETRY: 123,
  PARSE_FAILED: 124, ORDER_IGNORED: 125, CANCEL_FAILED: 126, RESOLVED: 129,
} as const;
/** Courier statuses of the reporting "courier update" event. */
export const DELIVERECT_COURIER_STATUS = { EN_ROUTE_TO_PICKUP: 83, ARRIVED_AT_PICKUP: 85, EN_ROUTE_TO_DROPOFF: 87, ARRIVED_AT_DROPOFF: 89, DELIVERED: 90 } as const;
/** Statuses a POS may send for an order (the others belong to Deliverect itself). */
export const DELIVERECT_POS_STATUSES: number[] = [10, 20, 40, 50, 60, 70, 90, 95, 110, 120];
/** KDS statuses. */
export const DELIVERECT_KDS_STATUSES: number[] = [50, 60, 70, 80];

export function deliverectBase() { return stripSlash(process.env.DELIVERECT_BASE_URL || ''); }
function retailBase() { return stripSlash(process.env.DELIVERECT_RETAIL_BASE_URL || ''); }
export function deliverectEnvironment(): 'staging' | 'production' { return /staging|sandbox/i.test(deliverectBase()) ? 'staging' : 'production'; }

export function deliverectReadiness() {
  const missing = missingEnv(['DELIVERECT_CLIENT_ID', 'DELIVERECT_CLIENT_SECRET', 'DELIVERECT_BASE_URL']);
  const configured = missing.length === 0;
  const env = deliverectEnvironment();
  // Staging only exchanges test orders: it runs without the live switch. Production needs it like every platform call.
  const canSend = configured && (env === 'staging' || liveConnectorsGloballyEnabled());
  const note = !configured ? `Missing: ${missing.join(', ')} (Deliverect POS partner credentials).`
    : env === 'staging' ? 'Deliverect staging: test orders only.'
      : canSend ? 'Live.' : 'Credentials present. Set LIVE_CONNECTORS_GLOBAL_ENABLED=true to allow outbound calls.';
  return { configured, canSend, environment: env, missing, note };
}

// --- token -----------------------------------------------------------------------------------------------------------

let token: { value: string; until: number; base: string } | null = null;
let inFlight: Promise<string | null> | null = null;
/** For tests: forget the cached token. */
export function resetDeliverectToken() { token = null; inFlight = null; }

/** POST /oauth/token {client_id, client_secret, audience, grant_type} — cached until it expires ("do not request one per call"). */
export async function deliverectToken(): Promise<string | null> {
  const base = deliverectBase();
  if (token && token.base === base && token.until > Date.now() + 60_000) return token.value;
  inFlight ??= (async () => {
    try {
      const res = await timedFetch(`${base}/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: process.env.DELIVERECT_CLIENT_ID, client_secret: process.env.DELIVERECT_CLIENT_SECRET, audience: base, grant_type: 'client_credentials' }),
      });
      if (!res.ok) return null;
      const b = await res.json().catch(() => ({}));
      if (!b?.access_token) return null;
      token = { value: String(b.access_token), until: b.expires_at ? Number(b.expires_at) * 1000 : Date.now() + Math.max(60, Number(b.expires_in) || 3600) * 1000, base };
      return token.value;
    } catch { return null; } finally { inFlight = null; }
  })();
  return inFlight;
}

// --- operation registry ----------------------------------------------------------------------------------------------

export type DeliverectApi = 'pos' | 'store' | 'kds' | 'retail';
export interface DeliverectOp {
  id: string;
  api: DeliverectApi;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  summary: string;
  params: string[];
  /** Allowed query parameters. */
  query?: string[];
  body: 'object' | 'none';
  retail?: boolean;
}

export const DELIVERECT_OPS: DeliverectOp[] = [
  { id: 'pos.insertProducts', api: 'pos', method: 'POST', path: '/productAndCategories', summary: 'Insert / update products and categories', params: [], query: ['previewSync', 'forceUpdate'], body: 'object' },
  { id: 'pos.orderStatus', api: 'pos', method: 'POST', path: '/orderStatus/{orderId}', summary: 'Update order status', params: ['orderId'], body: 'object' },
  { id: 'pos.preparationTime', api: 'pos', method: 'POST', path: '/updatePreparationTime', summary: 'Update order preparation time', params: [], body: 'object' },
  { id: 'pos.updateBill', api: 'pos', method: 'POST', path: '/updateBill/{locationId}', summary: 'Update bill', params: ['locationId'], body: 'object' },
  { id: 'pos.health', api: 'pos', method: 'PUT', path: '/locations/{locationId}/readiness/pos', summary: 'POS health check', params: ['locationId'], body: 'object' },
  { id: 'pos.validationResponse', api: 'pos', method: 'POST', path: '/orderValidation/{validationId}', summary: 'Validation response (async)', params: ['validationId'], body: 'object' },
  { id: 'store.accounts', api: 'store', method: 'GET', path: '/accounts', summary: 'Accounts', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'store.brands', api: 'store', method: 'GET', path: '/accounts/{accountId}/brands', summary: 'Account brands', params: ['accountId'], query: ['page', 'max_results'], body: 'none' },
  { id: 'store.locations', api: 'store', method: 'GET', path: '/locations', summary: 'Locations', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'store.channelLinks', api: 'store', method: 'GET', path: '/channelLinks', summary: 'Channel links', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'store.channels', api: 'store', method: 'GET', path: '/allChannels', summary: 'Channel integrators (integrated channels)', params: [], query: ['page', 'max_results'], body: 'none' },
  { id: 'store.allergens', api: 'store', method: 'GET', path: '/allAllergens', summary: 'Allergens and tags', params: [], body: 'none' },
  { id: 'store.products', api: 'store', method: 'GET', path: '/products', summary: 'Retrieve POS products', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'store.snoozed', api: 'store', method: 'GET', path: '/channelDisabledProducts', summary: 'Retrieve snoozed products', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'store.snoozeByPlu', api: 'store', method: 'POST', path: '/products/snoozeByPlus', summary: 'Snooze product by PLU', params: [], body: 'object' },
  { id: 'store.snoozeByTag', api: 'store', method: 'POST', path: '/products/snoozeByTags', summary: 'Snooze product by tag', params: [], body: 'object' },
  { id: 'store.syncProducts', api: 'store', method: 'POST', path: '/v2/locations/{locationId}/syncProducts', summary: 'Request product sync', params: ['locationId'], query: ['forceUpdate'], body: 'none' },
  { id: 'store.openingHoursSet', api: 'store', method: 'POST', path: '/locations/openingHours', summary: 'Update opening hours', params: [], body: 'object' },
  { id: 'store.openingHoursAccount', api: 'store', method: 'GET', path: '/account/{accountId}/openingHours', summary: 'Account opening hours', params: ['accountId'], query: ['page', 'max_results'], body: 'none' },
  { id: 'store.openingHoursLocation', api: 'store', method: 'GET', path: '/location/{locationId}/openingHours', summary: 'Location opening hours', params: ['locationId'], query: ['page', 'max_results'], body: 'none' },
  { id: 'store.holidaysSet', api: 'store', method: 'POST', path: '/locations/holidays', summary: 'Holiday hours for locations', params: [], body: 'object' },
  { id: 'store.holidaysLocation', api: 'store', method: 'GET', path: '/location/{locationId}/holidays', summary: 'Location holiday hours', params: ['locationId'], body: 'none' },
  { id: 'store.holidaysChannelSet', api: 'store', method: 'POST', path: '/locations/channels/holidays', summary: 'Holiday hours for locations and channel links', params: [], body: 'object' },
  { id: 'store.holidaysChannel', api: 'store', method: 'GET', path: '/locations/channels/{locationId}/holidays', summary: 'Channel holiday hours', params: ['locationId'], body: 'none' },
  { id: 'store.busyMode', api: 'store', method: 'POST', path: '/updateStoreStatus/{locationId}', summary: 'Busy mode (pause / resume online orders)', params: ['locationId'], body: 'object' },
  { id: 'store.orders', api: 'store', method: 'GET', path: '/my-orders', summary: 'Orders', params: [], query: ['where', 'page', 'max_results'], body: 'none' },
  { id: 'kds.orderStatus', api: 'kds', method: 'POST', path: '/kds/orderStatus/{orderId}', summary: 'KDS update order status', params: ['orderId'], body: 'object' },
  { id: 'retail.itemsUploadUrl', api: 'retail', method: 'POST', path: '/catalog/accounts/{accountId}/itemsUploadUrl', summary: 'Retail item upload (signed URL)', params: ['accountId'], body: 'object', retail: true },
  { id: 'retail.inventoryUploadUrl', api: 'retail', method: 'POST', path: '/catalog/accounts/{accountId}/inventoryUploadUrl', summary: 'Retail inventory update (signed URL)', params: ['accountId'], body: 'object', retail: true },
];

const OPS = new Map(DELIVERECT_OPS.map((o) => [o.id, o]));
export const deliverectOp = (id: string) => OPS.get(id);

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The documented required fields of each call; null = fine. */
export function validateDeliverectBody(id: string, body: unknown): string | null {
  switch (id) {
    case 'pos.insertProducts': {
      if (!isObj(body) || !String(body.accountId ?? '').trim() || !String(body.locationId ?? '').trim()) return 'accountId and locationId (from the Register POS call) are required.';
      if (!Array.isArray(body.products) || !body.products.length) return 'products: at least one product.';
      if (!Array.isArray(body.categories)) return 'categories is required (a list, empty if the products have none).';
      const bad = body.products.find((p: any) => !isObj(p) || !String(p.name ?? '').trim() || !String(p.plu ?? '').trim() || !Number.isInteger(p.price) || ![1, 2, 3, 4].includes(p.productType));
      return bad ? 'Each product needs name, plu, price (whole cents) and productType 1 (product), 2 (modifier), 3 (modifier group) or 4 (bundle).' : null;
    }
    case 'pos.orderStatus':
      return isObj(body) && String(body.orderId ?? '').trim() && String(body.receiptId ?? '').trim() && DELIVERECT_POS_STATUSES.includes(Number(body.status)) ? null : `orderId, receiptId and a status the POS may send (${DELIVERECT_POS_STATUSES.join(', ')}) are required.`;
    case 'kds.orderStatus':
      return isObj(body) && DELIVERECT_KDS_STATUSES.includes(Number(body.status)) ? null : `A KDS status is one of ${DELIVERECT_KDS_STATUSES.join(', ')}.`;
    case 'pos.preparationTime':
      return isObj(body) && String(body.order ?? '').trim() && Number.isInteger(body.minutes) && body.minutes >= 0 ? null : 'order (the Deliverect order id) and minutes (whole number) are required.';
    case 'pos.health':
      return isObj(body) && (body.status === undefined || body.status === 'online' || body.status === 'offline') ? null : 'status is "online" or "offline".';
    case 'pos.updateBill':
      return isObj(body) && String(body.id ?? '').trim() ? null : 'The bill needs an id.';
    case 'pos.validationResponse':
      return isObj(body) ? null : 'The validation result must be an object ({ isValid, errors, items, charges }).';
    case 'store.snoozeByPlu':
      return isObj(body) && String(body.account ?? '').trim() && String(body.location ?? '').trim() && Array.isArray(body.plus) && body.plus.length && body.plus.every((p: unknown) => String(p ?? '').trim()) && (body.snoozeEnd === undefined || Number.isFinite(Date.parse(String(body.snoozeEnd))))
        ? null : 'account, location and plus (a list of PLUs) are required; snoozeEnd is a date-time (now or past = un-snooze).';
    case 'store.snoozeByTag':
      return isObj(body) && String(body.account ?? '').trim() && String(body.location ?? '').trim() && Array.isArray(body.tag) && body.tag.length && body.snoozeStart && body.snoozeEnd ? null : 'account, location, tag (list of tag ids), snoozeStart and snoozeEnd are required.';
    case 'store.busyMode':
      return isObj(body) && typeof body.isActive === 'boolean' && (body.disableAt === undefined || Number.isFinite(Date.parse(String(body.disableAt)))) ? null : 'isActive (true / false) is required; disableAt is an optional date-time; channelLinks an optional list.';
    case 'store.openingHoursSet': {
      if (!isObj(body) || !Array.isArray(body.locations) || !body.locations.length) return 'locations: at least one location.';
      const slot = (s: any) => isObj(s) && Number.isInteger(s.dayOfWeek) && s.dayOfWeek >= 1 && s.dayOfWeek <= 7 && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.startTime)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.endTime));
      for (const l of body.locations) {
        if (!isObj(l) || !String(l.id ?? '').trim()) return 'Each location needs its id.';
        if ((l.openingHours ?? []).some((s: unknown) => !slot(s)) || (l.channels ?? []).some((c: any) => !String(c?.id ?? '').trim() || (c.openingHours ?? []).some((s: unknown) => !slot(s)))) return 'Opening hours: dayOfWeek 1 (Monday) to 7 (Sunday), startTime and endTime as HH:MM.';
      }
      return null;
    }
    case 'store.holidaysSet':
      return isObj(body) && Array.isArray(body.locations) && body.locations.length && body.locations.every((l: any) => isObj(l) && String(l.id ?? '').trim() && (l.holidays ?? []).every((h: any) => Number.isFinite(Date.parse(h?.startTime)) && Number.isFinite(Date.parse(h?.endTime)))) ? null : 'locations[] with id and holidays[] of { startTime, endTime } are required (an empty holidays list deletes them).';
    case 'store.holidaysChannelSet':
      return isObj(body) && Array.isArray(body.locations) && body.locations.length && body.locations.every((l: any) => isObj(l) && String(l.id ?? '').trim() && Array.isArray(l.channels) && l.channels.every((c: any) => String(c?.id ?? '').trim() && (c.holidays ?? []).every((h: any) => Number.isFinite(Date.parse(h?.startTime)) && Number.isFinite(Date.parse(h?.endTime))))) ? null : 'locations[].channels[] with id and holidays[] of { startTime, endTime } are required.';
    case 'retail.itemsUploadUrl': case 'retail.inventoryUploadUrl':
      return isObj(body) && (body.callbackUrl === undefined || /^https:\/\//i.test(String(body.callbackUrl))) ? null : 'callbackUrl must be an https:// address.';
    default: return null;
  }
}

export interface DeliverectInput { path?: Record<string, string>; query?: Record<string, string | number | boolean | undefined>; body?: unknown }

/** The request without sending it (tests, previews). */
export function buildDeliverectRequest(id: string, input: DeliverectInput = {}): { method: string; url: string; body?: string; retail: boolean } | { error: string } {
  const op = OPS.get(id);
  if (!op) return { error: `Unknown Deliverect operation "${id}".` };
  let path = op.path;
  for (const p of op.params) {
    const v = input.path?.[p];
    if (v === undefined || String(v).trim() === '') return { error: `${p} is required.` };
    path = path.replace(`{${p}}`, encodeURIComponent(String(v).trim()));
  }
  if (op.body === 'object') { const bad = validateDeliverectBody(id, input.body); if (bad) return { error: bad }; }
  const qs = new URLSearchParams();
  for (const q of op.query ?? []) {
    const v = input.query?.[q];
    if (v !== undefined && v !== '') qs.set(q, String(v));
  }
  const base = op.retail ? retailBase() : deliverectBase();
  return { method: op.method, url: `${base}${path}${qs.toString() ? `?${qs}` : ''}`, body: op.body === 'object' ? JSON.stringify(input.body) : undefined, retail: Boolean(op.retail) };
}

/** Runs one Deliverect operation with a bearer token. Never throws; blocked (not faked) without keys / base URL / live switch. */
export async function deliverectCall(id: string, input: DeliverectInput = {}): Promise<ChannelResult> {
  const op = OPS.get(id);
  const req = buildDeliverectRequest(id, input);
  if ('error' in req) return result(KEY, 'error', req.error);
  const r = deliverectReadiness();
  if (!r.canSend) return result(KEY, 'blocked', r.note);
  if (req.retail && !process.env.DELIVERECT_RETAIL_BASE_URL) return result(KEY, 'blocked', 'Set DELIVERECT_RETAIL_BASE_URL (api.staging.deliverect.io or api.deliverect.io) for the retail calls.');
  const t = await deliverectToken();
  if (!t) return result(KEY, 'error', 'Deliverect refused the client id / secret (no access token).');
  const headers: Record<string, string> = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (req.retail) headers['X-Deliverect-Version'] = process.env.DELIVERECT_RETAIL_VERSION || '2.0';
  const res = await callApi(KEY, req.url, { method: req.method, headers, body: req.body }, 'done');
  return res.ok ? { ...res, message: `${op!.summary}: OK` } : res;
}

// --- Eve-style queries: ?where={"account":"…"} and ?page= ---------------------------------------------------------

/** `where` filter as Deliverect expects it (a JSON string). */
export function deliverectWhere(filter: Record<string, unknown>): string { return JSON.stringify(filter); }

/** Every page of a list call (`_items`, `_meta.total`), up to a safety cap. */
export async function deliverectListAll(id: string, input: DeliverectInput = {}, cap = 20): Promise<{ ok: boolean; items: any[]; message: string }> {
  const items: any[] = [];
  for (let page = 1; page <= cap; page++) {
    const r = await deliverectCall(id, { ...input, query: { ...input.query, page, max_results: 100 } });
    if (!r.ok) return { ok: false, items, message: r.message };
    const body = r.response as { _items?: any[]; _meta?: { total?: number; max_results?: number } } | any[] | null;
    const batch: any[] = Array.isArray(body) ? body : Array.isArray(body?._items) ? body!._items : [];
    items.push(...batch);
    const meta = !Array.isArray(body) ? body?._meta : undefined;
    if (!batch.length || !meta?.total || items.length >= meta.total) break;
  }
  return { ok: true, items, message: 'OK' };
}

// --- Typed helpers ---------------------------------------------------------------------------------------------------

/** POST /orderStatus/{orderId}: the POS tells Deliverect (and through it the channel) where the order stands. */
export function deliverectOrderStatus(deliverectOrderId: string, receiptId: string, status: number, opts: { reason?: string; pickupTime?: string; at?: string } = {}) {
  return deliverectCall('pos.orderStatus', { path: { orderId: deliverectOrderId }, body: { orderId: deliverectOrderId, receiptId, status, ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.pickupTime ? { pickupTime: opts.pickupTime } : {}), timeStamp: opts.at ?? nowIso() } });
}

export const deliverect = {
  orderStatus: deliverectOrderStatus,
  preparationTime: (deliverectOrderId: string, minutes: number) => deliverectCall('pos.preparationTime', { body: { order: deliverectOrderId, minutes } }),
  updateBill: (locationId: string, bill: Record<string, unknown>) => deliverectCall('pos.updateBill', { path: { locationId }, body: bill }),
  health: (locationId: string, status: 'online' | 'offline' = 'online') => deliverectCall('pos.health', { path: { locationId }, body: { status } }),
  validationResponse: (validationId: string, resultBody: Record<string, unknown>) => deliverectCall('pos.validationResponse', { path: { validationId }, body: resultBody }),
  insertProducts: (body: Record<string, unknown>, opts: { previewSync?: boolean; forceUpdate?: boolean } = {}) => deliverectCall('pos.insertProducts', { body, query: { previewSync: opts.previewSync, forceUpdate: opts.forceUpdate } }),
  accounts: () => deliverectListAll('store.accounts'),
  brands: (accountId: string) => deliverectListAll('store.brands', { path: { accountId } }),
  locations: (accountId?: string) => deliverectListAll('store.locations', { query: accountId ? { where: deliverectWhere({ account: accountId }) } : {} }),
  channelLinks: (filter: Record<string, unknown> = {}) => deliverectListAll('store.channelLinks', { query: Object.keys(filter).length ? { where: deliverectWhere(filter) } : {} }),
  channels: () => deliverectListAll('store.channels'),
  allergens: () => deliverectCall('store.allergens'),
  products: (filter: Record<string, unknown> = {}) => deliverectListAll('store.products', { query: Object.keys(filter).length ? { where: deliverectWhere(filter) } : {} }),
  snoozed: (filter: Record<string, unknown> = {}) => deliverectListAll('store.snoozed', { query: Object.keys(filter).length ? { where: deliverectWhere(filter) } : {} }),
  /** Snooze (snoozeEnd in the future) or un-snooze (snoozeEnd now or earlier) products of one location. */
  snoozeByPlu: (account: string, location: string, plus: string[], snoozeEnd: string, snoozeStart?: string) => deliverectCall('store.snoozeByPlu', { body: { account, location, plus, snoozeEnd, ...(snoozeStart ? { snoozeStart } : {}) } }),
  snoozeByTag: (account: string, location: string, tag: number[], snoozeStart: string, snoozeEnd: string) => deliverectCall('store.snoozeByTag', { body: { account, location, tag, snoozeStart, snoozeEnd } }),
  requestSync: (locationId: string, forceUpdate = false) => deliverectCall('store.syncProducts', { path: { locationId }, query: { forceUpdate: forceUpdate || undefined } }),
  setOpeningHours: (body: Record<string, unknown>) => deliverectCall('store.openingHoursSet', { body }),
  accountOpeningHours: (accountId: string) => deliverectListAll('store.openingHoursAccount', { path: { accountId } }),
  locationOpeningHours: (locationId: string) => deliverectListAll('store.openingHoursLocation', { path: { locationId } }),
  setHolidays: (body: Record<string, unknown>) => deliverectCall('store.holidaysSet', { body }),
  locationHolidays: (locationId: string) => deliverectCall('store.holidaysLocation', { path: { locationId } }),
  setChannelHolidays: (body: Record<string, unknown>) => deliverectCall('store.holidaysChannelSet', { body }),
  channelHolidays: (locationId: string) => deliverectCall('store.holidaysChannel', { path: { locationId } }),
  /** Busy mode: isActive true pauses online orders (all channel links, or the listed ones), disableAt puts them back automatically. */
  busyMode: (locationId: string, isActive: boolean, opts: { channelLinks?: string[]; disableAt?: string } = {}) => deliverectCall('store.busyMode', { path: { locationId }, body: { isActive, ...(opts.channelLinks?.length ? { channelLinks: opts.channelLinks } : {}), ...(opts.disableAt ? { disableAt: opts.disableAt } : {}) } }),
  orders: (filter: Record<string, unknown>) => deliverectListAll('store.orders', { query: { where: deliverectWhere(filter) } }),
  kdsOrderStatus: (orderId: string, status: number) => deliverectCall('kds.orderStatus', { path: { orderId }, body: { orderId, status } }),
  retailItemsUploadUrl: (accountId: string, callbackUrl?: string, opts: { syncMode?: 'REPLACE_ALL_SOFT' | 'REPLACE_ALL_FORCE'; preview?: boolean } = {}) => deliverectCall('retail.itemsUploadUrl', { path: { accountId }, body: { ...(callbackUrl ? { callbackUrl } : {}), ...(opts.syncMode ? { syncMode: opts.syncMode } : {}), ...(opts.preview ? { preview: true } : {}) } }),
  retailInventoryUploadUrl: (accountId: string, callbackUrl?: string) => deliverectCall('retail.inventoryUploadUrl', { path: { accountId }, body: callbackUrl ? { callbackUrl } : {} }),
};

/**
 * Second step of the retail uploads: PUT the CSV to the signed URL Deliverect returned, with exactly the headers it gave.
 * The URL is valid for 15 minutes and points to Deliverect's storage, never anywhere else.
 */
export async function deliverectUploadCsv(signed: { signedUrl: string; headers?: Record<string, string> }, csv: string): Promise<ChannelResult> {
  let url: URL;
  try { url = new URL(signed.signedUrl); } catch { return result(KEY, 'error', 'The signed URL is not valid.'); }
  if (url.protocol !== 'https:' || !/(^|\.)googleapis\.com$/i.test(url.hostname)) return result(KEY, 'error', 'The signed upload address must be an https Google Cloud Storage URL, as Deliverect gives it.');
  if (!csv.trim()) return result(KEY, 'error', 'The CSV file is empty.');
  const headers: Record<string, string> = { 'Content-Type': 'text/csv', ...(signed.headers ?? {}) };
  delete headers.Host; delete headers.host;
  try {
    const res = await timedFetch(url.toString(), { method: 'PUT', headers, body: csv });
    return res.ok ? result(KEY, 'queued', 'CSV uploaded — Deliverect processes it and calls back.', { httpStatus: res.status }) : result(KEY, 'error', `Upload refused (HTTP ${res.status}).`, { httpStatus: res.status });
  } catch (e) {
    return result(KEY, 'error', `Upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
