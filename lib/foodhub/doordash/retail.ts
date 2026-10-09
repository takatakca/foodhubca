// DoorDash Marketplace for Retailers (grocery / retail): every endpoint of the "Marketplace for Retailers" API, behind the
// retail switch. The payload builders (what each product becomes) live in retail/platforms.ts; this file sends them.
//   Item Management        POST/PATCH /api/v2/items                                  catalogue (no prices)  — batches of 1000
//   Store Management       PATCH /api/v2/stores/{id}                                 hours + special hours
//                          PATCH /api/v2/stores/{id}/fulfillment_capacity            OVER_CAPACITY / AVAILABLE
//   Inventory / Pricing    POST/PATCH /api/v2/stores/{id}/items                      price + availability + stock per store — batches of 1000
//                          PATCH /api/v2/businesses/{id}/items                       price update across every store of a business
//   Job Management         POST /api/v2/jobs                                         PULL_STORE_ITEMS[_WITH_PAGINATION]: DoorDash pulls our inventory
//   Promotion Management   POST/PATCH /api/v2/promotions/stores/{id}
//   Checkout Management    POST …/stores/{id}/checkout/transactions/auth , …/checkout/transactions  (Dasher Shop & Deliver checkout)
// Specs: https://developer.doordash.com/en-US/api/marketplace_v2/ and /docs/marketplace/retail/. Access is by approval
// ("Marketplace for Retailers"): nothing is sent until the owner sets DOORDASH_RETAIL_ENABLED=true (and the usual credentials +
// LIVE_CONNECTORS_GLOBAL_ENABLED). Alcohol follows the alcohol rules (retailForPlatform), the retail feature switch must be on.
import { logActivity, type Actor } from '../activity';
import { decideAlcohol } from '../alcohol/rules';
import { chunk } from '../adapters/common';
import { result } from '../config';
import { featureOn } from '../expansion/features';
import { effectiveHours, getHours, holidaysFor, localDate } from '../hours';
import { toDoorDashStoreHours } from '../menu/translate';
import { listProducts, sellableAt, type RetailProduct } from '../retail/catalog';
import { retailForPlatform, toDoorDashRetailItemsRequest, toDoorDashRetailStoreItems } from '../retail/platforms';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { ddRequest, type DdResult } from './api';
import { bodyRefusal, doorDashStoreRefusal } from './guard';

const KEY = 'doordash' as const;
const enc = encodeURIComponent;
const v2 = (path: string) => `/api/v2${path}`;
const blocked = (message: string): ChannelResult => result(KEY, 'blocked', message);

export const doorDashRetailEnabled = () => process.env.DOORDASH_RETAIL_ENABLED === 'true';
/** The DoorDash business (parent merchant) id every catalogue call is scoped to. */
export const doorDashRetailBusinessId = () => (process.env.DOORDASH_RETAIL_BUSINESS_ID || '').trim();
export const RETAIL_BATCH = 1000;

/** Everything a retail call needs, in one honest line each (shown on the Retail screen). */
export function doorDashRetailReadiness() {
  const missing = [...(doorDashRetailEnabled() ? [] : ['DOORDASH_RETAIL_ENABLED=true (after DoorDash approves "Marketplace for Retailers")']), ...(doorDashRetailBusinessId() ? [] : ['DOORDASH_RETAIL_BUSINESS_ID'])];
  return { enabled: doorDashRetailEnabled(), businessId: doorDashRetailBusinessId() || null, ready: missing.length === 0, missing };
}

async function gate(storeLocationId?: string): Promise<string | null> {
  if (!doorDashRetailEnabled()) return 'DoorDash Marketplace for Retailers is not switched on: it needs DoorDash’s approval first. Then set DOORDASH_RETAIL_ENABLED=true.';
  if (!(await featureOn('retail'))) return 'The Grocery / retail feature is off (Settings → Expansion).';
  if (storeLocationId) return doorDashStoreRefusal({ channelStoreId: storeLocationId, meta: {} }, 'menu');
  return null;
}

// ---------------------------------------------------------------------------------------------- Item Management

/** POST (add) or PATCH (update) the catalogue. Products without a usable image are left out and listed in `leftOut`. */
export async function pushRetailCatalog(products: RetailProduct[], mode: 'add' | 'update' = 'add', actor?: Actor): Promise<{ result: ChannelResult; sent: number; leftOut: Array<{ sku: string; name: string; problem: string }> }> {
  const g = await gate();
  const business = doorDashRetailBusinessId();
  if (g || !business) return { result: blocked(g ?? 'DOORDASH_RETAIL_BUSINESS_ID is missing (DoorDash gives you the business id).'), sent: 0, leftOut: [] };
  // Alcohol only where the permit and the alcohol rules open DoorDash (any location is enough to publish the catalogue entry).
  const allowed = await Promise.all((await getRepo().listStores('doordash')).map((s) => decideAlcohol(s.locationCode, 'doordash', { ignoreHours: true })));
  const list = retailForPlatform(products, { alcoholAllowed: allowed.length > 0 && allowed.every((a) => a.allowed) });
  const built = toDoorDashRetailItemsRequest(list, business);
  let sent = 0;
  let last: DdResult = blocked('Nothing to send.');
  for (const part of chunk(built.request.items, RETAIL_BATCH)) {
    last = await ddRequest({ method: mode === 'add' ? 'POST' : 'PATCH', path: v2('/items'), body: { scope: built.request.scope, items: part }, kind: 'menu' });
    if (!last.ok) return { result: last, sent, leftOut: built.leftOut };
    sent += part.length;
  }
  if (actor) await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'retail_catalog_push', status: sent ? 'success' : 'info', channel: 'doordash', summary: `DoorDash retail catalogue ${mode}: ${sent} item(s) sent, ${built.leftOut.length} left out (image)` });
  return { result: sent ? { ...last, message: `${sent} catalogue item(s) sent to DoorDash.` } : blocked(built.leftOut.length ? `No product has a usable image (${built.leftOut[0].problem})` : 'Nothing to send.'), sent, leftOut: built.leftOut };
}

// ---------------------------------------------------------------------------------------------- Inventory / Pricing

/** The store items (price + availability + stock) of one location. */
export function storeItemsFor(products: RetailProduct[], locationCode: string, alcoholAllowed: boolean) {
  return toDoorDashRetailStoreItems(retailForPlatform(products, { alcoholAllowed }), locationCode);
}

/** POST (first menu: at least 50 items) or PATCH (changes) the inventory and prices of one store, in batches of 1000. */
export async function pushRetailStoreItems(storeLocationId: string, locationCode: string, mode: 'add' | 'update' = 'update', products?: RetailProduct[]): Promise<{ result: ChannelResult; sent: number }> {
  const g = await gate(storeLocationId);
  if (g) return { result: blocked(g), sent: 0 };
  const alcohol = await decideAlcohol(locationCode, 'doordash', { ignoreHours: true });
  const items = storeItemsFor(products ?? await listProducts(), locationCode, alcohol.allowed);
  if (!items.length) return { result: blocked('No product to send for this location.'), sent: 0 };
  if (mode === 'add' && items.length < 50) return { result: blocked('DoorDash wants at least 50 items for a brand new menu (POST). Use update for fewer.'), sent: 0 };
  let sent = 0;
  let last: DdResult = blocked('Nothing to send.');
  for (const part of chunk(items, RETAIL_BATCH)) {
    last = await ddRequest({ method: mode === 'add' ? 'POST' : 'PATCH', path: v2(`/stores/${enc(storeLocationId)}/items`), body: { items: part }, storeId: storeLocationId, kind: 'menu', okStatus: 'queued' });
    if (!last.ok) return { result: last, sent };
    sent += part.length;
  }
  return { result: { ...last, message: `${sent} store item(s) queued at DoorDash (${(last.response as any)?.operation_status ?? 'QUEUED'}).` }, sent };
}

/** One product's stock / availability change at a store (the real-time path: a sale, a count, an out-of-stock). */
export async function pushRetailStockChange(storeLocationId: string, locationCode: string, product: RetailProduct): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  const alcohol = await decideAlcohol(locationCode, 'doordash', { ignoreHours: true });
  if (product.alcohol && !alcohol.allowed) return blocked('Alcohol is not allowed on DoorDash at this location (alcohol rules).');
  return ddRequest({ method: 'PATCH', path: v2(`/stores/${enc(storeLocationId)}/items`), body: { items: toDoorDashRetailStoreItems([product], locationCode) }, storeId: storeLocationId, kind: 'menu', okStatus: 'queued' });
}

/** PATCH /businesses/{id}/items — a price change across every live store of the business (basic pricing only). */
export async function updateRetailBusinessItems(items: Array<{ merchant_supplied_item_id: string; price_info: Record<string, number> }>): Promise<DdResult> {
  const g = await gate();
  const business = doorDashRetailBusinessId();
  if (g || !business) return blocked(g ?? 'DOORDASH_RETAIL_BUSINESS_ID is missing.');
  if (!items.length) return blocked('Nothing to update.');
  return ddRequest({ method: 'PATCH', path: v2(`/businesses/${enc(business)}/items`), body: { items }, kind: 'menu', okStatus: 'queued' });
}

// ---------------------------------------------------------------------------------------------- Store Management

/** PATCH /stores/{id} — regular and special (holiday) hours of a retail store, from the hours Food Hub publishes. */
export async function pushRetailStoreHours(storeLocationId: string, brandName: string, locationCode: string): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  const cfg = await getHours();
  const hours = toDoorDashStoreHours(effectiveHours(cfg, brandName, locationCode), holidaysFor(cfg, locationCode, localDate(Date.now())));
  if (!hours.open_hours.length) return blocked('No store hours are set for this location (Stores → Hours).');
  return ddRequest({ method: 'PATCH', path: v2(`/stores/${enc(storeLocationId)}`), body: { merchant_supplied_store_id: storeLocationId, ...hours }, storeId: storeLocationId, kind: 'menu' });
}

/** PATCH /stores/{id}/fulfillment_capacity — tell DoorDash the store is over capacity (it stops sending orders) or available again. */
export async function setRetailFulfillmentCapacity(storeLocationId: string, status: 'OVER_CAPACITY' | 'AVAILABLE', at: Date = new Date()): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  if (status !== 'OVER_CAPACITY' && status !== 'AVAILABLE') return blocked('Status must be OVER_CAPACITY or AVAILABLE.');
  return ddRequest({ method: 'PATCH', path: v2(`/stores/${enc(storeLocationId)}/fulfillment_capacity`), body: { status, status_timestamp: at.toISOString() }, storeId: storeLocationId, kind: 'write', okStatus: 'queued' });
}

// ---------------------------------------------------------------------------------------------- Job Management (pull)

/**
 * POST /jobs — ask DoorDash to pull the inventory of one store from our pull endpoint
 * (GET /api/foodhub/webhooks/doordash/retail/inventory/{store_location_id}). It REPLACES the store's inventory with our answer.
 * One store per request, one running job per store.
 */
export async function createRetailPullJob(storeLocationId: string, paginated = false): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  return ddRequest({ method: 'POST', path: v2('/jobs'), body: { job_type: paginated ? 'PULL_STORE_ITEMS_WITH_PAGINATION' : 'PULL_STORE_ITEMS', job_parameters: { store_location_id: storeLocationId, pull_mode: 'REPLACE' } }, storeId: storeLocationId, kind: 'menu' });
}

// ---------------------------------------------------------------------------------------------- Promotion Management

export type PromotionType = 'BUY_X_FOR_Y' | 'BUY_X_SAVE_Y' | 'BUY_X_GET_Y_Z_PERCENT_OFF';
export interface RetailPromotion {
  promotion_id: string;
  promotion_type: PromotionType;
  funding_source: 'MERCHANT' | 'CPG';
  purchase_criteria: { purchase_items: string[]; purchase_quantity: number };
  redemption_limit?: { limit_per_order?: number };
  discount_options: { discount_total_price?: number; discount_price_off?: number; discount_percentage?: number; discount_quantity?: number };
  promotion_options?: { promotion_conditions?: string[] };
  /** yyyy-MM-ddTHH:mm:ssXXX */
  start_time: string;
  end_time: string;
}

export function promotionProblems(p: RetailPromotion): string[] {
  const out: string[] = [];
  if (!p.promotion_id?.trim()) out.push('promotion_id is required (unique for the merchant).');
  if (!['BUY_X_FOR_Y', 'BUY_X_SAVE_Y', 'BUY_X_GET_Y_Z_PERCENT_OFF'].includes(p.promotion_type)) out.push('Unknown promotion type.');
  if (!p.purchase_criteria?.purchase_items?.length || !(p.purchase_criteria.purchase_quantity >= 1)) out.push('Choose the items and the quantity to buy.');
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
  if (!ISO.test(p.start_time ?? '') || !ISO.test(p.end_time ?? '') || p.end_time <= p.start_time) out.push('start_time and end_time must be ISO dates with an offset (yyyy-MM-ddTHH:mm:ssXXX), the end after the start.');
  return out;
}

/** POST (new) / PATCH (update) a promotion at one store. Promotions are also configured in DoorDash Campaign Manager. */
export async function pushRetailPromotion(storeLocationId: string, promo: RetailPromotion, mode: 'add' | 'update' = 'add'): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  const problems = promotionProblems(promo);
  if (problems.length) return blocked(problems.join(' '));
  return ddRequest({ method: mode === 'add' ? 'POST' : 'PATCH', path: v2(`/promotions/stores/${enc(storeLocationId)}`), body: promo, storeId: storeLocationId, kind: 'menu', okStatus: 'queued' });
}

// ---------------------------------------------------------------------------------------------- Checkout Management (Dasher Shop & Deliver)

export interface CheckoutContent { total: number; currency_code: string; summary?: Record<string, number>; items?: unknown[]; discounts?: unknown[]; taxes?: unknown[]; fees?: unknown[]; loyalty?: Record<string, unknown>; tenders?: unknown[]; [k: string]: unknown }

/** POST …/checkout/transactions/auth — authorise a DoorDash Direct checkout from the scan code the Dasher shows at the register. */
export async function authorizeCheckoutTransaction(storeLocationId: string, req: { dd_direct_scan_code: string; transaction_contents: CheckoutContent; checkout_id?: string; client_txn_context_id?: string; client_request_time?: string }): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  if (!req.dd_direct_scan_code?.trim()) return blocked('The DoorDash Direct scan code is required.');
  const res = await ddRequest({ method: 'POST', path: v2(`/stores/${enc(storeLocationId)}/checkout/transactions/auth`), body: req, storeId: storeLocationId, kind: 'write' });
  return res.httpStatus === 409 ? { ...res, message: 'This checkout was already authorised.' } : res;
}

export interface CheckoutTransaction { merchant_supplied_transaction_id: string; in_store_transaction_contents: CheckoutContent; marketplace_transaction_contents?: CheckoutContent; transaction_timestamp?: string }

/** POST …/checkout/transactions — report in-store and marketplace transactions (receipts) of a store. */
export async function addCheckoutTransactions(storeLocationId: string, transactions: CheckoutTransaction[]): Promise<DdResult> {
  const g = await gate(storeLocationId);
  if (g) return blocked(g);
  if (!transactions.length) return blocked('No transaction to send.');
  const refused = bodyRefusal(transactions);
  if (refused) return blocked(refused);
  return ddRequest({ method: 'POST', path: v2(`/stores/${enc(storeLocationId)}/checkout/transactions`), body: { transactions }, storeId: storeLocationId, kind: 'write' });
}

// ---------------------------------------------------------------------------------------------- the pull answers we host

export const PULL_PAGE_SIZE = 500;

/**
 * What DoorDash gets when it pulls a store's inventory (GET {pull endpoint}/{store_location_id}[?page_num=n]): every active and
 * inactive product of the store, `item_availability` and `price_info.base_price` (+ `sale_price`) in cents. A full replace on
 * DoorDash's side, so it lists everything the store sells. Paginated when page_num is given.
 */
export function inventoryPullAnswer(products: RetailProduct[], locationCode: string, alcoholAllowed: boolean, pageNum?: number) {
  // Active and inactive alike (a pull replaces the whole inventory); alcohol only where the alcohol rules allow DoorDash.
  const items = products.filter((p) => !p.alcohol || alcoholAllowed).map((p) => {
    const s = toDoorDashRetailStoreItems([p], locationCode)[0];
    return { merchant_supplied_item_id: s.merchant_supplied_item_id, item_availability: sellableAt(p, locationCode) ? 'ACTIVE' : 'INACTIVE', price_info: s.price_info };
  });
  if (pageNum === undefined) return { items };
  const totalPage = Math.max(1, Math.ceil(items.length / PULL_PAGE_SIZE));
  const page = Math.min(Math.max(1, pageNum), totalPage);
  const slice = items.slice((page - 1) * PULL_PAGE_SIZE, page * PULL_PAGE_SIZE);
  return { items: slice, meta: { current_page: String(page), page_size: String(slice.length), total_page: String(totalPage) } };
}

/** What DoorDash gets on a Store Hours Pull: the Store model — every regular and special hour (a full replace on their side). */
export async function storeHoursPullAnswer(storeLocationId: string, brandName: string, locationCode: string) {
  const cfg = await getHours();
  return { merchant_supplied_store_id: storeLocationId, ...toDoorDashStoreHours(effectiveHours(cfg, brandName, locationCode), holidaysFor(cfg, locationCode, localDate(Date.now()))) };
}
