// Uber Eats Marketplace endpoints beyond the order/menu basics of uber-eats.ts, from Uber's API reference
// (developer.uber.com/docs/eats/references/api/*_suite, read 2026-10-09). Coverage table: docs/UBER_API_COVERAGE.md.
//
// Reads (GET) run as soon as the Uber keys exist; every write needs the live switch (uberSend → 'blocked' otherwise).
// Never touched: stores another integration still runs (prep time only goes to stores where Uber confirmed Food Hub is
// the order manager) and, for promotions, stores whose menu is locked or marked "Do not touch".
import { logActivity, type Actor } from '../activity';
import { result, toCents } from '../config';
import { isMenuLocked } from '../menu/lock';
import { getRepo } from '../repo';
import type { ChannelResult, ChannelStore, OrderLine, StoredOrder } from '../types';
import { isRelayStore } from './relay';
import { uberBlockedResult, uberCanSend, uberGetJson, uberSend, type UberPosState } from './uber-eats';

const KEY = 'uber_eats' as const;
const enc = encodeURIComponent;

// ---------- Store API suite ----------

/** Update Prep Time: POST /v1/delivery/store/{id}/update-store-prep-time { default_prep_time (seconds, max 10,800) }. */
export function setUberStorePrepTime(storeId: string, minutes: number): Promise<ChannelResult> {
  const seconds = Math.max(60, Math.min(10_800, Math.round(Number(minutes) * 60) || 900));
  return uberSend('POST', `/v1/delivery/store/${enc(storeId)}/update-store-prep-time`, { default_prep_time: seconds });
}

/** Uber stores where Food Hub takes the orders (Uber said so in pos_data): the only ones Food Hub sets a prep time on. */
async function managedStores(locationCode?: string): Promise<ChannelStore[]> {
  return (await getRepo().listStores('uber_eats')).filter((s) => !isRelayStore(s) && (!locationCode || s.locationCode === locationCode)
    && (s.meta?.uberPos as UberPosState | undefined)?.orderManager === 'foodhub');
}

/**
 * After a prep-time change (Settings → prep time, busy mode): the location's current prep time goes to each of its Uber
 * stores. Quiet when Uber Eats is not live (nothing to send) or UBER_PREP_TIME_SYNC=off. Never throws.
 */
export async function pushPrepTimeToUber(locationCode: string, minutes: number, actor?: Actor): Promise<Array<{ storeId: string; result: ChannelResult }>> {
  if (process.env.UBER_PREP_TIME_SYNC === 'off' || !uberCanSend()) return [];
  const stores = await managedStores(locationCode).catch(() => []);
  const out: Array<{ storeId: string; result: ChannelResult }> = [];
  for (const s of stores) {
    const r = await setUberStorePrepTime(s.channelStoreId, minutes);
    out.push({ storeId: s.id, result: r });
    await logActivity({ actor: actor?.name ?? 'TAKATAK automation', source: actor?.source ?? 'automation', kind: 'store_status', action: 'uber_prep_time', status: r.ok ? 'success' : 'failed', channel: KEY,
      brandName: s.brandName, locationCode: s.locationCode, storeId: s.id, summary: `Uber Eats prep time ${s.brandName} · ${s.locationCode}: ${Math.round(minutes)} min${r.ok ? '' : ` — not sent: ${r.message}`}` }).catch(() => undefined);
  }
  return out;
}

export interface UberStoreInfo {
  name?: string; timezone?: string; pickupInstructions?: string; prepTimeMinutes?: number | null;
  status?: string; offlineReason?: string; isOrderable?: boolean | null; nextOpen?: string; nextClose?: string;
  fulfillment?: Record<string, boolean>; priceAdjustment?: { enabled: boolean; maxDollars: number | null; requiresTaxRate: boolean } | null;
  outOfItem?: { removeItem: boolean; cancelOrder: boolean } | null;
}

/** Normalizes Get Store Details (GET /v1/delivery/store/{id}) — the fields the owner and the kitchen care about. */
export function normalizeUberStoreInfo(s: any): UberStoreInfo {
  const o = s?.orderability ?? {};
  const prep = Number(s?.prep_times?.default_value);
  const adj = s?.adjustment_config;
  const ooi = s?.ooi_config;
  return {
    name: s?.name ? String(s.name) : undefined, timezone: s?.timezone || undefined, pickupInstructions: s?.pickup_instructions || undefined,
    prepTimeMinutes: Number.isFinite(prep) && prep > 0 ? Math.round(prep / 60) : null,
    status: o.status || undefined, offlineReason: o.offline_reason || undefined, isOrderable: typeof o.is_orderable === 'boolean' ? o.is_orderable : null,
    nextOpen: o.next_open_time || undefined, nextClose: o.next_close_time || undefined,
    fulfillment: s?.fulfillment_type_availability && typeof s.fulfillment_type_availability === 'object' ? s.fulfillment_type_availability : undefined,
    priceAdjustment: adj ? { enabled: adj.is_price_adjustment_enabled === true, maxDollars: Number.isFinite(Number(adj.maximum_price_adjustment)) ? Number(adj.maximum_price_adjustment) : null, requiresTaxRate: adj.requires_tax_rate_for_adjustment === true } : null,
    outOfItem: ooi ? { removeItem: ooi.is_remove_item_enabled === true, cancelOrder: ooi.is_cancel_order_enabled === true } : null,
  };
}

/** Get Store Details (Store API suite). Read-only. */
export async function fetchUberStoreInfo(storeId: string): Promise<{ ok: boolean; info?: UberStoreInfo; error?: string }> {
  const r = await uberGetJson(`/v1/delivery/store/${enc(storeId)}?expand=holiday_hours`);
  return r.ok ? { ok: true, info: normalizeUberStoreInfo(r.json) } : { ok: false, error: r.error };
}

/** Update Store Information: POST /v1/delivery/store/{id} — only the pickup instructions the courier reads (≤ 500 chars). */
export function setUberPickupInstructions(storeId: string, text: string): Promise<ChannelResult> {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) return Promise.resolve(result(KEY, 'error', 'Write the pickup instructions first.'));
  return uberSend('POST', `/v1/delivery/store/${enc(storeId)}`, { pickup_instructions: clean });
}

/** Get Holiday Hours (GET /v1/eats/stores/{id}/holiday-hours): the closed / special dates Uber has. Read-only. */
export async function fetchUberHolidayDates(storeId: string): Promise<{ ok: boolean; dates: string[]; error?: string }> {
  const r = await uberGetJson(`/v1/eats/stores/${enc(storeId)}/holiday-hours`);
  if (!r.ok) return { ok: false, dates: [], error: r.error };
  const map = r.json?.holiday_hours ?? r.json ?? {};
  return { ok: true, dates: Object.keys(map && typeof map === 'object' ? map : {}).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() };
}

/** Retrieve Menu (GET /v2/eats/stores/{id}/menus): what Uber shows today, summed up (to compare with Food Hub). */
export async function fetchUberMenuSummary(storeId: string): Promise<{ ok: boolean; menus?: number; categories?: number; items?: number; soldOut?: string[]; error?: string }> {
  const r = await uberGetJson(`/v2/eats/stores/${enc(storeId)}/menus`);
  if (!r.ok) return { ok: false, error: r.error };
  const items: any[] = Array.isArray(r.json?.items) ? r.json.items : [];
  const now = Date.now() / 1000;
  const soldOut = items.filter((i) => Number(i?.suspension_info?.suspension?.suspend_until) > now).map((i) => String(i.id));
  return { ok: true, menus: Array.isArray(r.json?.menus) ? r.json.menus.length : 0, categories: Array.isArray(r.json?.categories) ? r.json.categories.length : 0, items: items.length, soldOut };
}

/** Update Integration Config (PATCH pos_data { integration_enabled }): order webhooks on or off for one store. */
export function setUberIntegrationEnabled(storeId: string, enabled: boolean): Promise<ChannelResult> {
  return uberSend('PATCH', `/v1/eats/stores/${enc(storeId)}/pos_data`, { integration_enabled: enabled });
}

// ---------- Order Fulfillment API suite ----------

/** Order reads: the eats.store.orders.read token first, the eats.order one when that scope is not granted. */
async function readOrders(path: string) {
  const r = await uberGetJson(path, 'poll');
  return r.ok || ![0, 401, 403].includes(r.status) ? r : uberGetJson(path, 'orders');
}

/** List Orders Details (GET /v1/delivery/store/{id}/orders): the last 60 days, 50 a page. Read-only (eats.store.orders.read). */
export async function listUberOrders(storeId: string, q: { states?: string[]; statuses?: string[]; startTime?: string; endTime?: string; pageToken?: string; pageSize?: number } = {}): Promise<{ ok: boolean; orders: any[]; nextPageToken?: string; error?: string }> {
  const qs = new URLSearchParams();
  if (q.states?.length) qs.set('state', q.states.join(','));
  if (q.statuses?.length) qs.set('status', q.statuses.join(','));
  if (q.startTime) qs.set('start_time', q.startTime);
  if (q.endTime) qs.set('end_time', q.endTime);
  if (q.pageToken) qs.set('next_page_token', q.pageToken);
  qs.set('page_size', String(Math.max(1, Math.min(50, q.pageSize ?? 50))));
  const r = await readOrders(`/v1/delivery/store/${enc(storeId)}/orders?${qs}`);
  if (!r.ok) return { ok: false, orders: [], error: r.error };
  return { ok: true, orders: Array.isArray(r.json?.data) ? r.json.data : [], nextPageToken: r.json?.pagination_data?.next_page_token || undefined };
}

/** Get Canceled Orders (GET /v1/eats/stores/{id}/canceled-orders): ids Uber cancelled, to catch a lost cancel webhook. */
export async function listUberCanceledOrders(storeId: string): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  const r = await readOrders(`/v1/eats/stores/${enc(storeId)}/canceled-orders?limit=50`);
  if (!r.ok) return { ok: false, ids: [], error: r.error };
  const rows: any[] = Array.isArray(r.json?.orders) ? r.json.orders : Array.isArray(r.json?.data) ? r.json.data : [];
  return { ok: true, ids: rows.map((o) => String(o?.id ?? '')).filter(Boolean) };
}

/** Get Order Details, current suite (GET /v1/delivery/order/{id}?expand=carts): has the cart_item_id of every line. */
export async function fetchUberOrderCarts(orderId: string): Promise<{ ok: boolean; items: Array<{ cartItemId: string; title: string; externalData?: string; quantity: number }>; error?: string }> {
  const r = await readOrders(`/v1/delivery/order/${enc(orderId)}?expand=carts`);
  if (!r.ok) return { ok: false, items: [], error: r.error };
  const order = r.json?.order ?? r.json;
  const items = (Array.isArray(order?.carts) ? order.carts : []).flatMap((c: any) => (Array.isArray(c?.items) ? c.items : []))
    .filter((i: any) => i?.cart_item_id)
    .map((i: any) => ({ cartItemId: String(i.cart_item_id), title: String(i.title ?? i.name ?? ''), externalData: i.external_data ? String(i.external_data) : undefined, quantity: Number(i.quantity?.amount ?? i.quantity ?? 1) || 1 }));
  return { ok: true, items };
}

/** The Uber cart line for one of our order lines: by the menu reference first, then by the name. */
export function matchCartItem(line: Pick<OrderLine, 'externalId' | 'name'>, items: Array<{ cartItemId: string; title: string; externalData?: string }>): string | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return items.find((i) => line.externalId && i.externalData === line.externalId)?.cartItemId
    ?? items.find((i) => norm(i.title) === norm(line.name))?.cartItemId ?? null;
}

/**
 * Out of stock after accepting → Resolve Fulfillment Issues (restaurants: OUT_OF_ITEM + ASK_CUSTOMER): Uber asks the
 * customer to remove the item or cancel, then sends orders.fulfillment_issues.resolved. The item can be 86'd on Uber
 * until `suspendUntilMs` in the same call.
 */
export async function reportUberOutOfItems(order: StoredOrder, lines: Array<Pick<OrderLine, 'externalId' | 'name'>>, opts: { suspendUntilMs?: number; note?: string } = {}): Promise<ChannelResult> {
  if (!uberCanSend()) return uberBlockedResult();
  if (!lines.length) return result(KEY, 'error', 'Choose the missing item(s).');
  const carts = await fetchUberOrderCarts(order.externalOrderId);
  if (!carts.ok) return result(KEY, 'error', `Could not read the order's items on Uber (${carts.error}).`);
  const issues: any[] = [];
  const unmatched: string[] = [];
  for (const l of lines) {
    const id = matchCartItem(l, carts.items);
    if (!id) { unmatched.push(l.name); continue; }
    issues.push({
      issue_type: 'OUT_OF_ITEM', action_type: 'ASK_CUSTOMER', item: { cart_item_id: id },
      ...(opts.suspendUntilMs && opts.suspendUntilMs > Date.now() ? { suspend_until: new Date(opts.suspendUntilMs).toISOString() } : {}),
      store_response: (opts.note || 'The store ran out of this item.').slice(0, 200),
    });
  }
  if (!issues.length) return result(KEY, 'error', `Uber's order has no line matching ${unmatched.join(', ')} — use Uber Eats Orders.`);
  const r = await uberSend('POST', `/v1/delivery/order/${enc(order.externalOrderId)}/resolve-fulfillment-issues`, { fulfillment_issues: issues });
  if (!r.ok) return r;
  const wait = (r.response as any)?.should_wait_for_customer_response === true;
  return { ...r, message: `Sent to Uber Eats: ${issues.length} item(s) out of stock${wait ? ' — Uber is asking the customer; the answer comes back here' : ''}.${unmatched.length ? ` Not found on Uber's order: ${unmatched.join(', ')}.` : ''}` };
}

export const UBER_ADJUST_REASONS = ['REQUESTED_ADD_ONS', 'BIGGER_SIZE', 'NEW_ITEM_ADDED', 'ITEM_SOLD_OUT', 'REMOVED_ITEM', 'ADD_ON_UNAVAILABLE', 'OTHER'] as const;
export type UberAdjustReason = (typeof UBER_ADJUST_REASONS)[number];

/** The Adjust Order Price body; null + why when the request breaks Uber's documented rules. */
export function uberAdjustPriceBody(p: { amount: number; reason: UberAdjustReason; customReason?: string; taxRatePct?: number; maxDollars?: number }): { body: Record<string, unknown> | null; error?: string } {
  const amount = Math.round((Number(p.amount) || 0) * 100) / 100;
  const max = p.maxDollars ?? 50;
  if (!amount) return { body: null, error: 'Enter an amount (negative to lower the price).' };
  if (Math.abs(amount) > max) return { body: null, error: `Uber allows at most ${max} $ up or down per adjustment.` };
  if (!UBER_ADJUST_REASONS.includes(p.reason)) return { body: null, error: 'Choose a reason.' };
  if (p.reason === 'OTHER' && !p.customReason?.trim()) return { body: null, error: 'Write the reason (required with "Other").' };
  if (p.taxRatePct !== undefined && !(p.taxRatePct >= 0 && p.taxRatePct < 50)) return { body: null, error: 'Tax rate must be a percentage, e.g. 14.975.' };
  return { body: { amount_e5: Math.round(amount * 100_000), reason: p.reason, ...(p.reason === 'OTHER' ? { custom_reason: p.customReason!.trim().slice(0, 200) } : {}), ...(p.taxRatePct !== undefined ? { tax_rate: String(p.taxRatePct) } : {}) } };
}

/** Adjust Order Price (POST /v1/delivery/order/{id}/adjust-price): the customer confirms the new price in the Uber app. */
export async function adjustUberOrderPrice(order: StoredOrder, p: Parameters<typeof uberAdjustPriceBody>[0]): Promise<ChannelResult> {
  const { body, error } = uberAdjustPriceBody(p);
  if (!body) return result(KEY, 'error', error ?? 'Invalid adjustment.');
  const r = await uberSend('POST', `/v1/delivery/order/${enc(order.externalOrderId)}/adjust-price`, body);
  return r.ok ? { ...r, message: `Price change of ${(Number(p.amount) > 0 ? '+' : '')}${Number(p.amount).toFixed(2)} $ sent — the customer confirms it in the Uber Eats app.` } : r;
}

/** Get Order Details, current suite (GET /v1/delivery/order/{id}?expand=carts,deliveries,payment). Read-only, raw. */
export async function fetchUberOrderCurrent(orderId: string, expand: Array<'carts' | 'deliveries' | 'payment'> = ['carts', 'deliveries', 'payment']): Promise<{ ok: boolean; order?: any; error?: string }> {
  const r = await readOrders(`/v1/delivery/order/${enc(orderId)}${expand.length ? `?expand=${expand.join(',')}` : ''}`);
  return r.ok ? { ok: true, order: r.json?.order ?? r.json } : { ok: false, error: r.error };
}

/**
 * Update Restaurant Delivery Status (POST /v1/eats/orders/{id}/restaurantdelivery/status, scope
 * eats.store.orders.restaurantdelivery.status): for Uber Eats orders the restaurant delivers itself (own drivers).
 */
export function setUberRestaurantDeliveryStatus(orderId: string, status: 'started' | 'arriving' | 'delivered'): Promise<ChannelResult> {
  return uberSend('POST', `/v1/eats/orders/${enc(orderId)}/restaurantdelivery/status`, { status });
}

/** An Uber Eats order the restaurant delivers itself (DELIVERY_BY_RESTAURANT / DELIVERY_BY_MERCHANT). */
export function isUberMerchantDelivery(order: Pick<StoredOrder, 'channel' | 'raw'>): boolean {
  const raw = (order.raw ?? {}) as Record<string, any>;
  return order.channel === 'uber_eats' && /DELIVERY_BY_(RESTAURANT|MERCHANT)/i.test(String(raw.type ?? raw.fulfillment_type ?? ''));
}

/** Dispatch Multiple Courier (POST /v1/delivery/order/{id}/update-delivery-partner-count, scope delivery.multiple.courier): 1–5 couriers for a big order. */
export function setUberCourierCount(orderId: string, count: number): Promise<ChannelResult> {
  const n = Math.round(Number(count));
  if (!(n >= 1 && n <= 5)) return Promise.resolve(result(KEY, 'error', 'Uber allows 1 to 5 couriers per order.'));
  return uberSend('POST', `/v1/delivery/order/${enc(orderId)}/update-delivery-partner-count`, { delivery_partner_count: n });
}

// ---------- Retail / grocery (Order Fulfillment suite "For Retailers", previous-version Patch Cart) ----------

export type UberRetailIssue = {
  issueType: 'OUT_OF_ITEM' | 'PARTIAL_AVAILABILITY' | 'FOUND_ITEM';
  actionType?: 'SUBSTITUTE_ME' | 'REPLACE_FOR_ME' | 'REMOVE_ITEM' | 'ALTERNATIVE_ITEM';
  cartItemId: string;
  scannedBarcode?: string;
  /** Uber's item_availability / item_substitute objects, passed as documented for the store's catalogue. */
  itemAvailability?: Record<string, unknown>;
  itemSubstitute?: Record<string, unknown>;
};

function retailIssue(i: UberRetailIssue) {
  return {
    issue_type: i.issueType, ...(i.issueType === 'OUT_OF_ITEM' && i.actionType ? { action_type: i.actionType } : {}),
    item: { cart_item_id: i.cartItemId, ...(i.scannedBarcode ? { scanned_barcode: { value: i.scannedBarcode } } : {}) },
    ...(i.itemAvailability ? { item_availability: i.itemAvailability } : {}),
    ...(i.itemSubstitute ? { item_substitute: i.itemSubstitute } : {}),
  };
}

/** Resolve Fulfillment Issues, retail body (remove, substitute, replace, partial / found quantities). */
export function resolveUberRetailIssues(orderId: string, issues: UberRetailIssue[]): Promise<ChannelResult> {
  if (!issues.length) return Promise.resolve(result(KEY, 'error', 'No item to resolve.'));
  if (issues.some((i) => i.issueType === 'OUT_OF_ITEM' && !i.actionType)) return Promise.resolve(result(KEY, 'error', 'An out-of-stock item needs an action (remove, replace, substitute).'));
  return uberSend('POST', `/v1/delivery/order/${enc(orderId)}/resolve-fulfillment-issues`, { fulfillment_issues: issues.map(retailIssue) });
}

/** Validate Item Fulfillment (POST …/validate-item-fulfillment): dry run of one retail issue, barcode checks (ERROR / WARN / INFO). */
export async function validateUberItemFulfillment(orderId: string, issue: UberRetailIssue): Promise<{ ok: boolean; results: Array<{ level: string; [k: string]: unknown }>; blocking: boolean; error?: string }> {
  const r = await uberSend('POST', `/v1/delivery/order/${enc(orderId)}/validate-item-fulfillment`, retailIssue(issue));
  if (!r.ok) return { ok: false, results: [], blocking: true, error: r.message };
  const results = Array.isArray((r.response as any)?.results) ? (r.response as any).results : [];
  return { ok: true, results, blocking: results.some((x: any) => String(x?.level).toUpperCase() === 'ERROR') };
}

/** Get Replacement Recommendations (POST /v1/delivery/get-replacement-recommendations): up to 7 replacements for a retail item. */
export async function getUberReplacementRecommendations(orderId: string, storeId: string, itemId: string): Promise<{ ok: boolean; recommendations: any[]; error?: string }> {
  const r = await uberSend('POST', '/v1/delivery/get-replacement-recommendations', { id: itemId, order_id: orderId, store_id: storeId });
  return r.ok ? { ok: true, recommendations: Array.isArray((r.response as any)?.replacement_recommendations) ? (r.response as any).replacement_recommendations : [] } : { ok: false, recommendations: [], error: r.message };
}

/**
 * Patch Cart (PATCH /v2/eats/orders/{id}/cart, grocery stores only, scope eats.order): previous-version way to say an
 * item was removed (REMOVE_ITEM), replaced (REPLACE_FOR_ME + item_substitute) or found in another quantity (ADJUST_ITEM).
 */
export function patchUberGroceryCart(orderId: string, issues: Array<{ type: 'OUT_OF_ITEM' | 'PARTIAL_AVAILABILITY' | 'FOUND_ITEM'; action?: 'REMOVE_ITEM' | 'REPLACE_FOR_ME' | 'ADJUST_ITEM'; instanceId: string; substitute?: { id: string; quantity: number }; adjustment?: Record<string, unknown> }>): Promise<ChannelResult> {
  if (!issues.length) return Promise.resolve(result(KEY, 'error', 'No item to change.'));
  return uberSend('PATCH', `/v2/eats/orders/${enc(orderId)}/cart`, {
    fulfillment_issues: issues.map((i) => ({
      fulfillment_issue_type: i.type, ...(i.action ? { fulfillment_action_type: i.action } : {}), root_item: { instance_id: i.instanceId },
      ...(i.substitute ? { item_substitute: { id: i.substitute.id, quantity: Math.max(1, Math.round(i.substitute.quantity)) } } : {}),
      ...(i.adjustment ? { item_adjustment: i.adjustment } : {}),
    })),
  });
}

// ---------- Store suite (current version) and BYOC ----------

/** Get Stores, current suite (GET /v1/delivery/stores, 50 a page). */
export async function listUberStoresCurrent(pageToken?: string): Promise<{ ok: boolean; stores: any[]; nextPageToken?: string; error?: string }> {
  const r = await uberGetJson(`/v1/delivery/stores?page_size=50${pageToken ? `&next_page_token=${enc(pageToken)}` : ''}`);
  return r.ok ? { ok: true, stores: Array.isArray(r.json?.stores) ? r.json.stores : [], nextPageToken: r.json?.pagination_data?.next_page_token || undefined } : { ok: false, stores: [], error: r.error };
}

/** Retrieve Store Status, current suite (GET /v1/delivery/store/{id}/status). */
export async function fetchUberStoreStatusCurrent(storeId: string): Promise<{ ok: boolean; status?: string; offlineUntil?: string; reason?: string; error?: string }> {
  const r = await uberGetJson(`/v1/delivery/store/${enc(storeId)}/status`);
  return r.ok ? { ok: true, status: r.json?.status, offlineUntil: r.json?.is_offline_until || undefined, reason: r.json?.offline_reason || undefined } : { ok: false, error: r.error };
}

/** Set Store Status, current suite (POST /v1/delivery/store/{id}/update-store-status { status ONLINE|OFFLINE, is_offline_until, reason }). */
export function setUberStoreStatusCurrent(storeId: string, online: boolean, untilMs?: number, reason?: string): Promise<ChannelResult> {
  return uberSend('POST', `/v1/delivery/store/${enc(storeId)}/update-store-status`, online ? { status: 'ONLINE' }
    : { status: 'OFFLINE', ...(untilMs ? { is_offline_until: new Date(untilMs).toISOString() } : {}), reason: (reason || 'Paused from TAKATAK Food Hub').slice(0, 200) });
}

/** Update Fulfillment Configuration (BYOC stores; scope eats.byoc.fulfillment.config): e.g. the minimum delivery time. */
export function setUberByocFulfillment(storeId: string, overrideConfig: { custom_min_etd_minutes?: number } & Record<string, unknown>): Promise<ChannelResult> {
  return uberSend('POST', `/v1/delivery/store/${enc(storeId)}/update-fulfillment-configuration`, { override_config: overrideConfig });
}

/** Ingest Courier Live Location (BYOC: our own driver delivers an Uber Eats order; POST /v1/eats/byoc/restaurants/orders/event/location). */
export function sendUberByocCourierLocation(p: { orderWorkflowId: string; restaurantId: string; batched?: boolean; events: Array<Record<string, unknown>> }): Promise<ChannelResult> {
  if (!p.events.length) return Promise.resolve(result(KEY, 'error', 'No location to send.'));
  return uberSend('POST', '/v1/eats/byoc/restaurants/orders/event/location', { location_request: { order_workflow_uuid: p.orderWorkflowId, restaurant_uuid: p.restaurantId, is_batched_order: p.batched === true, location_events: p.events } });
}

/** Update Menu Item price (POST /v2/eats/stores/{id}/menus/items/{item_id} { price_info }), never on a locked store. */
export function setUberItemPrice(store: ChannelStore, itemId: string, price: number): Promise<ChannelResult> {
  if (store.meta?.doNotTouch === true || isMenuLocked(store)) return Promise.resolve(result(KEY, 'skipped', 'Not sent — this store’s menu is locked / "Do not touch".'));
  if (!(price >= 0)) return Promise.resolve(result(KEY, 'error', 'Enter a price.'));
  return uberSend('POST', `/v2/eats/stores/${enc(store.channelStoreId)}/menus/items/${enc(itemId)}`, { price_info: { price: toCents(price) } });
}

// ---------- Promotions API suite ----------

export const UBER_PROMO_STATES = ['active', 'pending', 'completed', 'revoked', 'expired', 'deleted'] as const;

/** Body of Create Promotion for a "$X off when the order is at least $Y" offer (FLATOFF, as in Uber's example). */
export function uberFlatOffPromotion(p: { startTime: string; endTime: string; discount: number; minSpend?: number; externalId?: string; firstTimeOnly?: boolean; currency?: string }) {
  return {
    start_time: p.startTime, end_time: p.endTime,
    ...(p.externalId ? { external_promotion_id: p.externalId.slice(0, 100) } : {}),
    user_group: p.firstTimeOnly ? 'FIRST_TIME_CUSTOMER' : 'ALL_CUSTOMERS',
    allow_unlimited_apply: !p.firstTimeOnly,
    currency_code: (p.currency || process.env.FOODHUB_CURRENCY || 'CAD').toUpperCase(),
    budget: { unlimited_budget: true },
    promo_type: 'FLATOFF',
    promotion_discount: { flat_off_discount: { ...(p.minSpend ? { min_basket_constraint: { min_spend: { amount: toCents(p.minSpend) } } } : {}), discount_value: { amount: toCents(p.discount) } } },
  };
}

function promoStoreGuard(store: ChannelStore): ChannelResult | null {
  if (isRelayStore(store)) return result(KEY, 'skipped', 'This store reaches Food Hub through the relay: promotions are set in Uber Eats Manager.');
  if (store.meta?.doNotTouch === true || isMenuLocked(store)) return result(KEY, 'skipped', 'Not sent — this store is marked "Do not touch" / its menu is locked, so Food Hub never changes its offers.');
  return null;
}

/** Create Promotion (POST /v1/delivery/stores/{id}/promotion) → promotion_id. A write: live switch. */
export async function createUberPromotion(store: ChannelStore, body: Record<string, unknown>): Promise<ChannelResult & { promotionId?: string }> {
  const guard = promoStoreGuard(store);
  if (guard) return guard;
  const start = Date.parse(String(body.start_time ?? ''));
  const end = Date.parse(String(body.end_time ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return result(KEY, 'error', 'The promotion needs a start and an end (end after start).');
  const r = await uberSend('POST', `/v1/delivery/stores/${enc(store.channelStoreId)}/promotion`, body);
  const id = (r.response as any)?.promotion_id;
  return r.ok ? { ...r, promotionId: id ? String(id) : undefined, message: `Promotion created on Uber Eats${id ? ` (${id})` : ''}.` } : r;
}

/** Revoke Promotion (POST /v1/delivery/promotions/{id}/revoke). */
export function revokeUberPromotion(promotionId: string): Promise<ChannelResult> {
  if (!promotionId) return Promise.resolve(result(KEY, 'error', 'Which promotion?'));
  return uberSend('POST', `/v1/delivery/promotions/${enc(promotionId)}/revoke`, {});
}

/** Get Promotions (GET /v1/delivery/stores/{id}/promotions[?state=]) — only the ones created by API (Uber says so). */
export async function listUberPromotions(storeId: string, state?: (typeof UBER_PROMO_STATES)[number]): Promise<{ ok: boolean; promotions: any[]; error?: string }> {
  const r = await uberGetJson(`/v1/delivery/stores/${enc(storeId)}/promotions${state ? `?state=${enc(state)}` : ''}`);
  return r.ok ? { ok: true, promotions: Array.isArray(r.json?.promotions) ? r.json.promotions : [] } : { ok: false, promotions: [], error: r.error };
}

/** Get Promotion (GET /v1/delivery/promotions/{id}). */
export async function getUberPromotion(promotionId: string): Promise<{ ok: boolean; promotion?: any; error?: string }> {
  const r = await uberGetJson(`/v1/delivery/promotions/${enc(promotionId)}`);
  return r.ok ? { ok: true, promotion: r.json?.promotion ?? r.json } : { ok: false, error: r.error };
}
