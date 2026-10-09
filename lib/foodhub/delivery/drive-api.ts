// DoorDash Drive: every endpoint beyond quote / accept / create / get / cancel (those are the CourierFleet contract in
// doordash-drive.ts). Spec: https://developer.doordash.com/en-US/api/drive
//   PATCH /drive/v2/deliveries/{id}                     change a delivery after it was booked (tip, instructions, order_ready_time…)
//   PUT   /drive/v2/deliveries/{id}/cancel              with reason_code and should_create_return_delivery
//   POST  /drive/v2/serviceability                      can Drive deliver from here to there? (no price, no delivery created)
//   POST  /drive/v2/address/auto_complete               address suggestions
//   POST  /drive/v2/items_substitution_recommendation   Dasher Shop & Deliver: substitutes for items
//   POST  /drive/v2/checkout_audit_signal               Dasher Shop & Deliver: result of the checkout audit
//   /developer/v1/businesses[/{id}[/stores[/{id}]]]     Business + Store APIs: create, get, update, list (continuation token)
//   Drive (classic) /drive/v1/…                         the older estimate / validation / delivery API and the same Business + Store API
//   POST https://api.doordash.com/drive/v1/checkout     DoorDash Checkout API: DoorDash takes payment and runs checkout in a webview
// Same JWT as the other Drive calls (the Drive org's own access key). Sandbox calls run without the live switch (they dispatch
// no real Dasher); production needs LIVE_CONNECTORS_GLOBAL_ENABLED=true — exactly like the fleet calls.
import { logActivity, type Actor } from '../activity';
import { stripSlash, timedFetch } from '../config';
import { bodyRefusal, pathRefusal } from '../doordash/guard';
import { withDoorDashRetry } from '../doordash/retry';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { driveCall, driveReadiness } from './doordash-drive';

const enc = encodeURIComponent;

export interface DriveResult<T = any> { ok: boolean; status: number; message: string; data?: T }

/** One Drive call with the checks every Drive endpoint shares: configured, sandbox-or-live, no protected store id in the body. */
async function drive<T = any>(method: string, path: string, body?: unknown, opts: { read?: boolean } = {}): Promise<DriveResult<T>> {
  const r = driveReadiness();
  if (!r.configured) return { ok: false, status: 0, message: r.note };
  if (!opts.read && !r.canSend) return { ok: false, status: 0, message: r.note };
  const refused = bodyRefusal(body) ?? pathRefusal(path);
  if (refused) return { ok: false, status: 0, message: refused };
  const out = await driveCall(method, path, body);
  return { ok: out.ok, status: out.status, message: out.ok ? 'OK' : out.why, data: out.ok ? (out.json as T) : undefined };
}

// ---------------------------------------------------------------------------------------------- delivery

/** The fields Update Delivery accepts (the reference lists these; anything else is refused before it is sent). */
export const DRIVE_UPDATABLE = ['pickup_address', 'pickup_business_name', 'pickup_phone_number', 'pickup_instructions', 'pickup_reference_tag', 'pickup_external_business_id', 'pickup_external_store_id', 'pickup_time', 'pickup_window',
  'dropoff_address', 'dropoff_address_components', 'dropoff_business_name', 'dropoff_phone_number', 'dropoff_instructions', 'dropoff_contact_given_name', 'dropoff_contact_family_name', 'dropoff_contact_send_notifications',
  'dropoff_location', 'dropoff_time', 'dropoff_window', 'dropoff_options', 'dropoff_requires_signature', 'dropoff_cash_on_delivery', 'dropoff_email_address', 'contactless_dropoff', 'action_if_undeliverable',
  'tip', 'items', 'order_value', 'order_contains', 'dasher_allowed_vehicles', 'promotion_id', 'order_route_type', 'order_route_items', 'customer_expected_sla', 'expires_by', 'order_ready_time', 'shipping_label_metadata', 'shipping_label_config'] as const;

/** PATCH /drive/v2/deliveries/{id} — a delivery that is already booked (limited fields; a Dasher already assigned limits what may change). */
export async function updateDriveDelivery(externalDeliveryId: string, patch: Record<string, unknown>): Promise<DriveResult> {
  const bad = Object.keys(patch).filter((k) => !(DRIVE_UPDATABLE as readonly string[]).includes(k));
  if (bad.length) return { ok: false, status: 0, message: `Update Delivery does not accept: ${bad.join(', ')}.` };
  if (!Object.keys(patch).length) return { ok: false, status: 0, message: 'Nothing to change.' };
  return drive('PATCH', `/drive/v2/deliveries/${enc(externalDeliveryId)}`, patch);
}

/** The kitchen finished the food: tell Drive (order_ready_time) so the Dasher is sent / hurried. Silent when no Drive delivery runs. */
export async function tellDriveOrderReady(orderId: string, at = new Date()): Promise<{ sent: boolean; message: string }> {
  const { deliveriesForOrder } = await import('./store');
  const running = (await deliveriesForOrder(orderId)).find((d) => d.fleet === 'doordash_drive' && ['created', 'assigned', 'at_pickup'].includes(d.status));
  if (!running) return { sent: false, message: 'No DoorDash Drive delivery is waiting for this order.' };
  const res = await updateDriveDelivery(running.id, { order_ready_time: at.toISOString() });
  await logActivity({ actor: 'Food Hub', source: 'automation', kind: 'order', action: 'drive_order_ready', status: res.ok ? 'success' : 'failed', summary: `DoorDash Drive told the order is ready (${running.id})${res.ok ? '' : `: ${res.message}`}` });
  return { sent: res.ok, message: res.ok ? 'DoorDash Drive knows the order is ready.' : res.message };
}

/** Raise (or lower) the Dasher's tip on a booked delivery. Dollars in, cents on the wire. */
export async function setDriveTip(externalDeliveryId: string, tipDollars: number): Promise<DriveResult> {
  if (!(tipDollars >= 0) || tipDollars > 500) return { ok: false, status: 0, message: 'The tip must be between 0 and 500 dollars.' };
  return updateDriveDelivery(externalDeliveryId, { tip: Math.round(tipDollars * 100) });
}

/** PUT …/cancel with DoorDash's body: reason_code and, for a delivery that is already on the way, should_create_return_delivery. */
export async function cancelDriveDelivery(externalDeliveryId: string, opts: { reasonCode?: string; shouldCreateReturnDelivery?: boolean } = {}): Promise<DriveResult> {
  return drive('PUT', `/drive/v2/deliveries/${enc(externalDeliveryId)}/cancel`, {
    ...(opts.reasonCode ? { reason_code: opts.reasonCode } : {}),
    ...(opts.shouldCreateReturnDelivery !== undefined ? { should_create_return_delivery: opts.shouldCreateReturnDelivery } : {}),
  });
}

// ---------------------------------------------------------------------------------------------- serviceability and addresses

export interface ServiceabilityRequest {
  pickup_address?: string; dropoff_address: string; pickup_external_business_id?: string; pickup_external_store_id?: string;
  dropoff_address_components?: Record<string, unknown>; order_value?: number; external_delivery_id?: string; dropoff_phone_number?: string;
  dropoff_options?: unknown; contactless_dropoff?: boolean; action_if_undeliverable?: string; order_contains?: Record<string, unknown>;
  dropoff_requires_signature?: boolean; pickup_time?: string; dropoff_time?: string; pickup_window?: unknown; dropoff_window?: unknown;
}

/** POST /drive/v2/serviceability → { is_serviceable, reasons_not_serviceable }: ask before quoting (and before the customer pays). */
export async function checkDriveServiceability(req: ServiceabilityRequest): Promise<DriveResult<{ is_serviceable: boolean; reasons_not_serviceable?: string[] }>> {
  if (!req.dropoff_address?.trim()) return { ok: false, status: 0, message: 'The delivery address is required.' };
  if (!req.pickup_address?.trim() && !req.pickup_external_store_id) return { ok: false, status: 0, message: 'Give the pickup address or the Drive store.' };
  return drive('POST', '/drive/v2/serviceability', req, { read: true });
}

/** POST /drive/v2/address/auto_complete — suggestions while a person types an address. */
export async function autocompleteDriveAddress(req: { input_address: string; location?: { lat: number; lng: number }; search_radius_meter?: number; max_results?: number; country?: string }): Promise<DriveResult<{ results?: Array<{ address?: Record<string, unknown> }> }>> {
  if ((req.input_address ?? '').trim().length < 3) return { ok: true, status: 200, message: 'OK', data: { results: [] } };
  return drive('POST', '/drive/v2/address/auto_complete', { max_results: 5, country: 'CA', ...req }, { read: true });
}

// ---------------------------------------------------------------------------------------------- Dasher Shop & Deliver

/** POST /drive/v2/items_substitution_recommendation — which items DoorDash suggests when one is not found. */
export const itemsSubstitutionRecommendation = (body: { pickup_external_business_id: string; pickup_external_store_id: string; items: Array<{ external_id: string }>; customer?: { dropoff_contact_loyalty_number?: string } }) =>
  drive('POST', '/drive/v2/items_substitution_recommendation', body, { read: true });

export interface CheckoutAuditSignal {
  external_delivery_id: string; is_audit_successful: boolean; audit_period?: string; requested_audit_item_count?: number; audited_item_count?: number;
  successful_audit_items?: unknown[]; failed_audit_items?: unknown[]; checkout_audit_status?: string;
}
/** POST /drive/v2/checkout_audit_signal → { signal_received } — the store's checkout audit result for a shopped delivery. */
export const sendCheckoutAuditSignal = (body: CheckoutAuditSignal) => drive('POST', '/drive/v2/checkout_audit_signal', body);

// ---------------------------------------------------------------------------------------------- Business + Store

export interface DriveList<T> { result: T[]; continuationToken: string | null; resultCount: number }
const listOf = <T>(j: any): DriveList<T> => ({ result: Array.isArray(j?.result) ? j.result : [], continuationToken: j?.continuation_token ?? null, resultCount: Number(j?.result_count ?? (Array.isArray(j?.result) ? j.result.length : 0)) });

const qs = (o: Record<string, string | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v!)}`);
  return p.length ? `?${p.join('&')}` : '';
};

export async function listDriveBusinesses(opts: { activationStatus?: string; continuationToken?: string } = {}): Promise<DriveResult<DriveList<any>>> {
  const r = await drive('GET', `/developer/v1/businesses${qs({ activationStatus: opts.activationStatus, continuationToken: opts.continuationToken })}`, undefined, { read: true });
  return r.ok ? { ...r, data: listOf(r.data) } : r;
}
export const getDriveBusiness = (id: string) => drive('GET', `/developer/v1/businesses/${enc(id)}`, undefined, { read: true });
export const createDriveBusiness = (body: { external_business_id: string; name: string; description?: string; activation_status?: string }) => drive('POST', '/developer/v1/businesses', body);
export const updateDriveBusiness = (id: string, body: { name: string; description?: string; activation_status?: string }) => drive('PATCH', `/developer/v1/businesses/${enc(id)}`, body);

export async function listDriveStoresOf(businessId: string, opts: { activationStatus?: string; continuationToken?: string } = {}): Promise<DriveResult<DriveList<any>>> {
  const r = await drive('GET', `/developer/v1/businesses/${enc(businessId)}/stores${qs({ activationStatus: opts.activationStatus, continuationToken: opts.continuationToken })}`, undefined, { read: true });
  return r.ok ? { ...r, data: listOf(r.data) } : r;
}
export const getDriveStore = (businessId: string, storeId: string) => drive('GET', `/developer/v1/businesses/${enc(businessId)}/stores/${enc(storeId)}`, undefined, { read: true });
export const createDriveStore = (businessId: string, body: { external_store_id: string; name: string; phone_number?: string; address: string }) => drive('POST', `/developer/v1/businesses/${enc(businessId)}/stores`, body);
export const updateDriveStore = (businessId: string, storeId: string, body: { name?: string; phone_number?: string; address?: string }) => drive('PATCH', `/developer/v1/businesses/${enc(businessId)}/stores/${enc(storeId)}`, body);

/** Every page of a Drive list (follows the continuation token, at most 20 pages). */
export async function allDrivePages(first: (token?: string) => Promise<DriveResult<DriveList<any>>>): Promise<DriveResult<any[]>> {
  const out: any[] = [];
  let token: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await first(token);
    if (!page.ok || !page.data) return { ok: false, status: page.status, message: page.message };
    out.push(...page.data.result);
    if (!page.data.continuationToken) break;
    token = page.data.continuationToken;
  }
  return { ok: true, status: 200, message: 'OK', data: out };
}

/**
 * What DoorDash Drive holds versus what Food Hub registered: the kitchens in the registry (drive-stores) against GET stores of the
 * business, so a store deleted or edited on DoorDash's side is seen.
 */
export async function compareDriveStores(businessId: string, registry: Record<string, { storeId: string }> | undefined): Promise<DriveResult<{ onDoorDash: number; missing: string[]; unregistered: string[] }>> {
  const all = await allDrivePages((token) => listDriveStoresOf(businessId, { continuationToken: token }));
  if (!all.ok || !all.data) return { ok: false, status: all.status, message: all.message };
  const remote = new Set(all.data.map((s) => String(s.external_store_id)));
  const local = Object.entries(registry ?? {});
  return { ok: true, status: 200, message: 'OK', data: {
    onDoorDash: remote.size,
    missing: local.filter(([, v]) => !remote.has(v.storeId)).map(([code]) => code),
    unregistered: [...remote].filter((id) => !local.some(([, v]) => v.storeId === id)),
  } };
}

// ---------------------------------------------------------------------------------------------- Drive (classic) v1

/** Drive (classic): the older API, same credentials. estimates, validations, deliveries (create / get / update / cancel). */
export const driveClassic = {
  estimate: (body: Record<string, unknown>) => drive('POST', '/drive/v1/estimates', body, { read: true }),
  validate: (body: Record<string, unknown>) => drive('POST', '/drive/v1/validations', body, { read: true }),
  create: (body: Record<string, unknown>) => drive('POST', '/drive/v1/deliveries', body),
  get: (deliveryId: string) => drive('GET', `/drive/v1/deliveries/${enc(deliveryId)}`, undefined, { read: true }),
  update: (deliveryId: string, body: Record<string, unknown>) => drive('PATCH', `/drive/v1/deliveries/${enc(deliveryId)}`, body),
  cancel: (deliveryId: string) => drive('PUT', `/drive/v1/deliveries/${enc(deliveryId)}/cancel`),
};

// ---------------------------------------------------------------------------------------------- DoorDash Checkout API

export const checkoutApiBase = () => stripSlash(process.env.DOORDASH_CHECKOUT_API_BASE || 'https://api.doordash.com');
export const CHECKOUT_WEBVIEW = 'https://order.online/embed/v1/checkout/';

export interface CheckoutSession {
  cart: { category_name?: string; items: Array<{ merchant_supplied_id: string; quantity: number; tax_excluded_price?: number; special_instructions?: string; extras?: unknown[] }> };
  currency: 'USD' | 'AUD' | 'CAD' | 'JPY';
  consumer: { external_consumer_id?: string; email: string; phone_number?: string; address?: string; first_name?: string; last_name?: string };
  delivery_address: { street: string; unit?: string; city: string; state: string; zip_code: string; country: string };
  external_store_id: string;
  external_order_id?: string;
  dropoff_preference?: { option?: string; dasher_instructions?: string };
}

/** The webview URL for an order session. */
export const checkoutWebviewUrl = (orderSessionId: string) => `${CHECKOUT_WEBVIEW}?order_session_id=${enc(orderSessionId)}`;

/**
 * POST /drive/v1/checkout (DoorDash Checkout API): create an order session; DoorDash then takes the payment and creates the Drive
 * delivery. The store must already exist on DoorDash Marketplace and the items must match its menu. Authentication is the Drive API
 * key as a Bearer token (DOORDASH_CHECKOUT_API_KEY, from the Drive support address) — not the JWT. 5xx are retried up to 3 times.
 */
export async function createCheckoutSession(body: CheckoutSession): Promise<ChannelResult & { orderSessionId?: string; webviewUrl?: string }> {
  const key = process.env.DOORDASH_CHECKOUT_API_KEY;
  if (!key) return { channel: 'doordash', ok: false, status: 'blocked', message: 'DOORDASH_CHECKOUT_API_KEY is missing (ask DoorDash Drive support for the API key of the Checkout API).' };
  if (!body.consumer?.email) return { channel: 'doordash', ok: false, status: 'blocked', message: 'The customer’s email is required.' };
  const refused = bodyRefusal(body);
  if (refused) return { channel: 'doordash', ok: false, status: 'blocked', message: refused };
  const res = await withDoorDashRetry(async () => {
    try {
      const r = await timedFetch(`${checkoutApiBase()}/drive/v1/checkout`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      return r.ok
        ? { channel: 'doordash' as const, ok: true, status: 'done' as const, message: 'OK', httpStatus: r.status, response: json }
        : { channel: 'doordash' as const, ok: false, status: 'error' as const, message: `Checkout API HTTP ${r.status}${json?.message ? `: ${json.message}` : ''}`, httpStatus: r.status, response: json };
    } catch (e) {
      return { channel: 'doordash' as const, ok: false, status: 'error' as const, message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }, { method: 'POST', retryPost: true });
  const id = res.ok ? String((res.response as any)?.order_session_id ?? '') : '';
  return id ? { ...res, orderSessionId: id, webviewUrl: checkoutWebviewUrl(id) } : res;
}

/** Checkout API webhook `delivery_created` (Bearer = the same key): { external_order_id, event_category, tracking_url, created_at }. */
export function verifyCheckoutWebhook(headers: Headers): boolean {
  const key = process.env.DOORDASH_CHECKOUT_API_KEY;
  const got = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(key) && got.length === key!.length && got === key;
}

export async function recordCheckoutDelivery(body: any, actor: Actor = { username: 'doordash', name: 'DoorDash Checkout', source: 'platform' }): Promise<string> {
  const id = String(body?.external_order_id ?? '');
  if (!id) return 'no external_order_id';
  await getRepo().setKv(`doordash_checkout:${id}`, { trackingUrl: body?.tracking_url ?? null, category: body?.event_category ?? null, at: body?.created_at ?? new Date().toISOString() });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'doordash_checkout_delivery', status: 'info', summary: `DoorDash Checkout created the delivery for ${id}${body?.tracking_url ? ` — ${body.tracking_url}` : ''}` });
  return 'recorded';
}

