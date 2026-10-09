// DoorDash direct adapter (Marketplace API, JWT auth).
// Spec: https://developer.doordash.com/en-US/api/marketplace/
// DoorDash Marketplace access is limited and granted per partner; DOORDASH_PROVIDER_TYPE
// only exists once DoorDash provisions your integration, so it is required before sending.
import crypto from 'node:crypto';
import { callApi, checkSharedSecret, fromCents, missingEnv, result, stripSlash, timedFetch } from '../config';
import { withDoorDashRetry } from '../doordash/retry';
import { getBrandMenu } from '../menu/shared';
import { toDoorDashMenu } from '../menu/translate';
import { localTimeLabel } from '../time';
import { CANCEL_REASON_LABELS } from '../types';
import type { CancelReason, ChannelAdapter, DoorDashOrderDetails, NormalizedOrder, OrderLine, PlatformState, StoredOrder } from '../types';
import { blockedResult, buildReadiness, chunk } from './common';

const KEY = 'doordash' as const;

/** Merchant-initiated cancellation is allowlisted per integration by DoorDash: on only when the owner says so. */
export function doorDashMerchantCancelEnabled() {
  return process.env.DOORDASH_MERCHANT_CANCEL === 'true';
}

const DD_CANCEL: Partial<Record<CancelReason, string>> = { out_of_stock: 'ITEM_OUT_OF_STOCK', store_closed: 'STORE_CLOSED', too_busy: 'KITCHEN_BUSY' };

/** Error codes DoorDash accepts in errors[].code (order integration guide, "Supported error codes"). */
export const DOORDASH_ERROR_CODES = ['INVALID_ORDER', 'ITEM_OUT_OF_STOCK', 'STORE_HOURS_ISSUE', 'INTERNAL_ERROR', 'OTHER', 'CONNECTIVITY_ISSUE', 'TIME_OUT',
  'STORE_CLOSED', 'STORE_CLOSED_EARLY', 'POS_OFFLINE', 'CAPACITY_THROTTLING', 'STALE_PICKUP_TIME', 'ORDER_ONLINE_DISABLED', 'INVALID_ADDRESS',
  'STORE_RENOVATION', 'STORE_TEMP_CLOSED', 'WEATHER_ISSUES'] as const;
export type DoorDashErrorCode = (typeof DOORDASH_ERROR_CODES)[number];
export interface DoorDashItemError { code: DoorDashErrorCode; merchant_supplied_id: string; message: string }

/**
 * The Food Hub reject reason behind a reject text. The reject pop-up sends "<CANCEL_REASON_LABELS[code]> — details";
 * other callers send free text, read like the Order Relay does.
 */
export function rejectReasonOf(text: string): { reason: CancelReason; details: string } {
  const t = (text || '').trim();
  for (const [code, label] of Object.entries(CANCEL_REASON_LABELS) as Array<[CancelReason, string]>) {
    if (t === label || t.startsWith(`${label} — `)) return { reason: code, details: t.slice(label.length).replace(/^ — /, '').trim() };
  }
  const reason: CancelReason = /stock|rupture|86|unavailable|indisponible/i.test(t) ? 'out_of_stock'
    : /busy|occup|volume|rush/i.test(t) ? 'too_busy'
      : /closed|ferm/i.test(t) ? 'store_closed'
        : /clover|\bpos\b|offline|hors ligne|connect/i.test(t) ? 'pos_issue' : 'other';
  return { reason, details: t };
}

/**
 * failure_reason + errors[] for a DoorDash reject, using the strings of DoorDash's detailed error spec:
 * - out of stock: "Item Unavailable - [Item Name] - [Item ID] - Out of stock" + one ITEM_OUT_OF_STOCK error per item.
 *   The items are the order lines/options named in the details, or 86'd at the location, or the only line;
 * - store closed, kitchen busy (capacity), POS problem: the documented store-level string (no errors[]: each error
 *   needs an item or option id);
 * - anything else: the staff's own words (never an empty or generic reason).
 */
export function doorDashFailure(order: Pick<StoredOrder, 'lines' | 'brandName' | 'placedAt'>, reasonText: string, unavailable: Set<string> = new Set()): { failure_reason: string; errors?: DoorDashItemError[] } {
  const { reason, details } = rejectReasonOf(reasonText);
  if (reason === 'out_of_stock') {
    const said = details.toLowerCase();
    const candidates = order.lines.flatMap((l) => [{ id: l.externalId, name: l.name }, ...l.modifiers.map((m) => ({ id: m.externalId, name: m.name }))])
      .filter((c): c is { id: string; name: string } => Boolean(c.id));
    let hit = candidates.filter((c) => (c.name.trim() && said.includes(c.name.trim().toLowerCase())) || unavailable.has(c.id));
    if (!hit.length && order.lines.length === 1 && order.lines[0].externalId) hit = [{ id: order.lines[0].externalId, name: order.lines[0].name }];
    const unique = [...new Map(hit.map((c) => [c.id, c])).values()];
    if (unique.length) {
      return {
        failure_reason: unique.map((c) => `Item Unavailable - ${c.name} - ${c.id} - Out of stock`).join('; ').slice(0, 1000),
        errors: unique.map((c) => ({ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: c.id, message: `Item Unavailable - ${c.name} - Out of stock` })),
      };
    }
    return { failure_reason: `Item Unavailable - Out of stock${details ? ` - ${details}` : ''}`.slice(0, 1000) };
  }
  if (reason === 'store_closed') return { failure_reason: 'Store is either currently closed or your order cannot be prepared prior to close.' };
  if (reason === 'too_busy') {
    return { failure_reason: `${order.brandName || 'The store'} is experiencing high order volume and cannot prepare your order for ${localTimeLabel(order.placedAt)}` };
  }
  if (reason === 'pos_issue') return { failure_reason: 'POS Exception - Store is offline' };
  const words = details && !/^(other|autre|rejected by (the )?restaurant)$/i.test(details) ? details : '';
  const head = reason === 'customer_request' ? 'Customer asked to cancel' : 'Rejected by the restaurant';
  return { failure_reason: (words ? `${head}: ${words}` : reason === 'customer_request' ? head : `${head} (reason not given)`).slice(0, 1000) };
}

function base() { return stripSlash(process.env.DOORDASH_BASE_URL || 'https://openapi.doordash.com/marketplace'); }

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * DoorDash JWT: HS256, header dd-ver DD-JWT-V1, aud "doordash", signed with the base64-decoded signing secret.
 * Marketplace credentials by default; DoorDash Drive passes its own (another developer org / access key).
 */
export function doorDashJwt(nowSec = Math.floor(Date.now() / 1000), creds = { developerId: process.env.DOORDASH_DEVELOPER_ID, keyId: process.env.DOORDASH_KEY_ID, signingSecret: process.env.DOORDASH_SIGNING_SECRET }): string {
  const header = { alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' };
  const payload = { aud: 'doordash', iss: creds.developerId, kid: creds.keyId, exp: nowSec + 300, iat: nowSec };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const secret = Buffer.from((creds.signingSecret || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest();
  return `${unsigned}.${b64url(sig)}`;
}

/**
 * DoorDash's User-Agent: the provider_type in CamelCase + "/1.0" (documented example: merchant_sandbox →
 * MerchantSandbox/1.0). https://developer.doordash.com/en-US/docs/marketplace/how_to/JWTs and the Marketplace FAQ.
 * DOORDASH_USER_AGENT overrides it when DoorDash gives an exact spelling (their FAQ writes doordash_pizza as
 * DoorDashPizza/1.0). Null while no provider type exists yet (the header is then left out).
 */
export function doorDashUserAgent(providerType = process.env.DOORDASH_PROVIDER_TYPE || '', override = process.env.DOORDASH_USER_AGENT || ''): string | null {
  if (override.trim()) return override.trim();
  const camel = providerType.trim().split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return camel ? `${camel}/1.0` : null;
}

function headers(): Record<string, string> {
  const userAgent = doorDashUserAgent();
  return { Authorization: `Bearer ${doorDashJwt()}`, 'auth-version': 'v2', 'Content-Type': 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) };
}

function readiness() {
  return buildReadiness(KEY, ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET'], {
    note: 'Direct mode. DOORDASH_PROVIDER_TYPE is issued by DoorDash when your Marketplace integration is approved.',
    noteFr: 'Mode direct. DoorDash fournit DOORDASH_PROVIDER_TYPE quand votre intégration Marketplace est approuvée.',
    handoff: [{ label: 'Webhook Authorization header value', envKey: 'DOORDASH_WEBHOOK_SECRET' }],
  });
}

function send(method: string, path: string, body?: unknown, okStatus: 'done' | 'queued' = 'done') {
  const r = readiness();
  if (!r.canSend) return Promise.resolve(blockedResult(KEY, r));
  // DoorDash's documented retry rules (doordash/retry.ts): 400 never, 429 reported with "try again in 1 minute",
  // 5xx backed off (twice) except POST, which is never repeated blindly (a second menu POST is a duplicate menu).
  return withDoorDashRetry(() => callApi(KEY, `${base()}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) }, okStatus), { method });
}

/** Marketplace base URL, JWT headers and readiness, shared with the other DoorDash modules (lib/foodhub/doordash/). */
export const doorDashBase = () => base();
export const doorDashHeaders = () => headers();
export const doorDashReadiness = () => readiness();

export const doorDashAdapter: ChannelAdapter = {
  key: KEY,
  label: 'DoorDash (direct)',
  readiness,
  verifyWebhook(h) {
    // Configure the webhook subscription in the DoorDash Developer Portal with an
    // Authorization header equal to DOORDASH_WEBHOOK_SECRET.
    return checkSharedSecret(h, 'DOORDASH_WEBHOOK_SECRET', ['authorization', 'x-takatak-token']);
  },
  // prep_time = when the order will be ready (UTC), from the location's normal/busy prep time.
  acceptOrder: (order, posRef) => send('PATCH', `/api/v1/orders/${encodeURIComponent(order.externalOrderId)}`, {
    merchant_supplied_id: posRef || order.id,
    order_status: 'success',
    ...(order.timeline?.readyTarget ? { prep_time: new Date(order.timeline.readyTarget).toISOString() } : {}),
  }),
  // Reject: DoorDash's documented failure_reason strings + item-level errors[] (codes from the order integration
  // guide), so fewer than 15% of failures land in DoorDash's "Other / vague" bucket (detailed error spec).
  async denyOrder(order, reason) {
    let unavailable = new Set<string>();
    try {
      const menu = order.brandName ? await getBrandMenu(order.brandName) : null;
      unavailable = new Set(order.locationCode ? menu?.unavailableByLocation?.[order.locationCode] ?? [] : []);
    } catch { /* no menu: items are matched by name only */ }
    return send('PATCH', `/api/v1/orders/${encodeURIComponent(order.externalOrderId)}`, {
      merchant_supplied_id: order.posOrderId || order.id,
      order_status: 'fail',
      ...doorDashFailure(order, reason, unavailable),
    });
  },
  markReady: (order, posRef) => send('PATCH', `/api/v1/orders/${encodeURIComponent(order.externalOrderId)}/events/order_ready_for_pickup`, {
    merchant_supplied_id: posRef || order.posOrderId || order.id,
  }),
  // Merchant order cancellation: PATCH /api/v1/orders/{id}/cancellation — only for integrations DoorDash allowlisted
  // (ask your DoorDash technical account manager), so it is offered only with DOORDASH_MERCHANT_CANCEL=true.
  // DoorDash then deactivates the store for STORE_CLOSED (12 h) or KITCHEN_BUSY (15 min).
  async cancelOrder(order, reason, details) {
    if (!doorDashMerchantCancelEnabled()) {
      return result(KEY, 'blocked', 'DoorDash cancellations after accepting need DoorDash’s approval (allowlist) — cancel it on the DoorDash tablet / Order Manager, or ask your DoorDash account manager and set DOORDASH_MERCHANT_CANCEL=true.');
    }
    const code = DD_CANCEL[reason] ?? 'OTHER';
    const res = await send('PATCH', `/api/v1/orders/${encodeURIComponent(order.externalOrderId)}/cancellation`, {
      cancel_reason: code,
      ...(details?.trim() ? { cancel_details: details.trim().slice(0, 200) } : {}),
    });
    if (!res.ok && (res.httpStatus === 401 || res.httpStatus === 403)) {
      return result(KEY, 'blocked', 'DoorDash refused the cancellation: this integration is not allowlisted for merchant cancellations yet — cancel it on the DoorDash tablet, and ask your DoorDash technical account manager.', { httpStatus: res.httpStatus });
    }
    if (res.ok && (code === 'STORE_CLOSED' || code === 'KITCHEN_BUSY')) {
      return { ...res, message: `Cancelled on DoorDash — DoorDash pauses the store for ${code === 'STORE_CLOSED' ? '12 hours' : '15 minutes'} (${code}).` };
    }
    return res;
  },
  async publishMenu(store, menu, ctx) {
    const menuId = typeof store.meta?.doordashMenuId === 'string' ? store.meta.doordashMenuId : null;
    const reference = `takatak-${store.channelStoreId}-${Date.now()}`;
    const payload = toDoorDashMenu(menu, store.channelStoreId, process.env.DOORDASH_PROVIDER_TYPE || '', reference, ctx);
    // Result arrives later on the Menu Status webhook (it carries the menu id for future PATCH updates).
    const res = await (menuId
      ? send('PATCH', `/api/v1/menus/${encodeURIComponent(menuId)}`, payload, 'queued')
      : send('POST', '/api/v1/menus', payload, 'queued'));
    // Our own reference identifies the job when DoorDash's Menu Status webhook comes back.
    return res.ok ? { ...res, reference: res.reference || reference } : res;
  },
  // PUT /api/v1/stores/{msid}/items/status  or  /item_options/status — max 40 per request.
  async setItemAvailability(store, refs, available, _untilMs, kind = 'item') {
    if (refs.length === 0) return result(KEY, 'skipped', 'No items to update.');
    const path = `/api/v1/stores/${encodeURIComponent(store.channelStoreId)}/${kind === 'modifier' ? 'item_options' : 'items'}/status`;
    let last = result(KEY, 'skipped', 'No items to update.');
    for (const batch of chunk(refs, 40)) {
      last = await send('PUT', path, batch.map((ref) => ({ merchant_supplied_id: ref, is_active: available })));
      if (!last.ok) return last;
    }
    return last;
  },
  setStoreOnline: (store, online, untilMs, reason) => send('PUT', `/api/v1/stores/${encodeURIComponent(store.channelStoreId)}/status`, online
    ? { is_active: true }
    : { is_active: false, reason: 'operational_issues', notes: reason || 'Paused from TAKATAK Food Hub', ...(untilMs ? { end_time: new Date(untilMs).toISOString() } : {}) }),
};

/** Merchant-controllable pause: the reason Food Hub itself sends (operational_issues) or our own pause note. */
const MERCHANT_PAUSE = (d: any) => /operational[\s_-]?issues|merchant[\s_-]?pause|paused?[\s_-]?by[\s_-]?merchant/i.test(String(d?.reason ?? '')) || /takatak|food hub/i.test(String(d?.notes ?? ''));

/** Normalizes GET /api/v1/stores/{msid}/store_details (current_deactivations[] / is_active). */
export function normalizeDoorDashDetails(body: any): { state: PlatformState; detail?: string; until?: string | null } {
  const list: any[] = Array.isArray(body?.current_deactivations) ? body.current_deactivations : [];
  if (body?.is_active === false || list.length) {
    const first = list[0] ?? {};
    const detail = [first.reason, first.notes].filter(Boolean).join(' — ') || 'Deactivated on DoorDash';
    // A pause (timed or "until resumed") is 'paused'; 'deactivated' is reserved for DoorDash-initiated reasons
    // (out_of_business, policy/fraud, …) so an untimed Food Hub pause never raises a DEACTIVATED alert.
    if (first.end_time || MERCHANT_PAUSE(first)) return { state: 'paused', detail, until: first.end_time ? String(first.end_time) : null };
    return { state: 'deactivated', detail };
  }
  return { state: 'online' };
}

/** Read-only status check. Runs whenever credentials exist (it changes nothing on DoorDash). */
export async function fetchDoorDashStoreStatus(msid: string): Promise<{ ok: boolean; state: PlatformState; detail?: string; until?: string | null; error?: string }> {
  if (missingEnv(['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET']).length) return { ok: false, state: 'unknown', error: 'DoorDash credentials missing' };
  try {
    const res = await timedFetch(`${base()}/api/v1/stores/${encodeURIComponent(msid)}/store_details`, { headers: headers() });
    if (!res.ok) return { ok: false, state: res.status === 404 ? 'deactivated' : 'unknown', error: `DoorDash store_details HTTP ${res.status}` };
    return { ok: true, ...normalizeDoorDashDetails(await res.json()) };
  } catch (error) {
    return { ok: false, state: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

const cents = (n: unknown) => fromCents(Number(n) || 0);

/** A promotion entry of the order: applied_discounts_details[] (order) or applied_item_discount_details[] (item). All amounts in cents. */
function doorDashPromo(d: any, itemId?: string): NonNullable<DoorDashOrderDetails['promotions']>[number] {
  const merchant = cents(d?.merchant_funded_discount_amount);
  const dd = cents(d?.doordash_funded_discount_amount);
  const total = d?.total_discount_amount != null ? cents(d.total_discount_amount) : Math.round((merchant + dd) * 100) / 100;
  return {
    ...(d?.promo_id ? { id: String(d.promo_id) } : {}),
    ...(d?.promo_code ? { code: String(d.promo_code) } : {}),
    ...(d?.external_campaign_id ? { campaignId: String(d.external_campaign_id) } : {}),
    total, merchantFunded: merchant, doordashFunded: dd,
    ...(itemId ? { itemId } : {}),
  };
}

/**
 * Promotions on the order (integrated promotions guide). Funding is explicit: merchant_funded_discount_amount +
 * doordash_funded_discount_amount = total_discount_amount, per entry; stacked promos are several entries; promos funded
 * entirely by DoorDash are not sent at all. The older discount_amount / applied_discount fields are deprecated since
 * 2026-04-30 and are read only when the new ones are absent.
 */
export function doorDashPromotions(o: any, items: any[] = []): NonNullable<DoorDashOrderDetails['promotions']> {
  const orderLevel: any[] = Array.isArray(o?.applied_discounts_details) ? o.applied_discounts_details : [];
  const itemLevel = items.flatMap((it) => (Array.isArray(it?.applied_item_discount_details) ? it.applied_item_discount_details.map((d: any) => doorDashPromo(d, it.merchant_supplied_id ? String(it.merchant_supplied_id) : undefined)) : []));
  return [...orderLevel.map((d) => doorDashPromo(d)), ...itemLevel];
}

/** Merchant-funded discount on the order, in dollars; 0 when absent. */
function doorDashDiscount(o: any, promos: ReturnType<typeof doorDashPromotions>): number {
  // The documented order-level total of what the restaurant pays for promotions (stacked promos already summed).
  if (o?.total_merchant_funded_discount_amount != null) return Math.abs(cents(o.total_merchant_funded_discount_amount));
  if (promos.length) return Math.round(promos.reduce((s, p) => s + Math.abs(p.merchantFunded), 0) * 100) / 100;
  // Deprecated names, still accepted from older payloads.
  const direct = cents(o?.merchant_funded_discount ?? o?.merchant_discount ?? o?.merchant_funded_discount_amount ?? o?.discount_amount ?? o?.discount);
  if (direct) return Math.abs(direct);
  const list: any[] = Array.isArray(o?.discounts) ? o.discounts : Array.isArray(o?.promotions) ? o.promotions : [];
  return Math.round(list.filter((d) => d && (d.merchant_funded === true || /merchant/i.test(String(d.funded_by ?? d.funding_source ?? 'merchant')))).reduce((s, d) => s + Math.abs(cents(d.amount ?? d.discount_amount ?? d.value)), 0) * 100) / 100;
}

/**
 * Tips the restaurant keeps, in dollars (Order Model, amounts in cents): merchant_tip_amount = "tip amount for
 * merchant staff" (pickup orders included) + tip_amount = "Delivery tip amount. This is only sent for Self Delivery
 * orders". A Dasher's tip is never in either. `tip` (undocumented) is read only when neither field is present.
 */
export function doorDashTip(o: any): number {
  if (o?.merchant_tip_amount == null && o?.tip_amount == null) return cents(o?.tip);
  return Math.round((cents(o.merchant_tip_amount) + cents(o.tip_amount)) * 100) / 100;
}

const CATERING_EXPERIENCES = /^(marketplace_catering|online_ordering_catering|meal_manager)$/i;

/** A self-delivery address as text, whatever shape DoorDash sends (string, or an object with street / city / zip parts). */
export function doorDashAddressText(a: any): string | undefined {
  if (!a) return undefined;
  if (typeof a === 'string') return a.trim() || undefined;
  const direct = a.formatted_address ?? a.full_address ?? a.printable_address ?? a.address;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const parts = [a.street ?? a.street_address ?? a.address_line_1 ?? a.line_1, a.unit ?? a.subpremise ?? a.address_line_2 ?? a.line_2, a.city, a.state, a.zip_code ?? a.zip ?? a.postal_code]
    .filter((x) => typeof x === 'string' && x.trim());
  return parts.length ? parts.join(', ') : undefined;
}

/** DoorDash-only facts of an order, kept next to the common fields (shown to staff, used by reconciliation). */
export function doorDashOrderDetails(o: any, promos: ReturnType<typeof doorDashPromotions>): DoorDashOrderDetails | undefined {
  const exp = String(o?.experience ?? '');
  const address = doorDashAddressText(o?.delivery_address);
  const details: DoorDashOrderDetails = {
    ...(typeof o?.is_tax_remitted_by_doordash === 'boolean' ? { taxRemittedByDoorDash: o.is_tax_remitted_by_doordash } : {}),
    ...(o?.tax_amount_remitted_by_doordash != null ? { taxRemittedAmount: cents(o.tax_amount_remitted_by_doordash) } : {}),
    ...(o?.commission_type ? { commissionType: String(o.commission_type).toLowerCase() } : {}),
    ...(o?.is_scheduled === true ? { scheduled: true } : {}),
    ...(CATERING_EXPERIENCES.test(exp) ? { catering: true } : {}),
    ...(typeof o?.is_plastic_ware_option_selected === 'boolean' ? { plasticware: o.is_plastic_ware_option_selected } : {}),
    ...(o?.consumer?.phone ? { customerPhone: String(o.consumer.phone) } : {}),
    ...(promos.length ? { promotions: promos } : {}),
    ...(promos.length ? { merchantFundedDiscount: Math.round(promos.reduce((s, p) => s + p.merchantFunded, 0) * 100) / 100, doordashFundedDiscount: Math.round(promos.reduce((s, p) => s + p.doordashFunded, 0) * 100) / 100 } : {}),
    ...(address ? { deliveryAddress: address } : {}),
    ...(o?.address_instructions ? { addressInstructions: String(o.address_instructions) } : {}),
    ...(o?.store_order_cart_id ? { storeOrderCartId: String(o.store_order_cart_id) } : {}),
  };
  return Object.keys(details).length ? details : undefined;
}

export function parseDoorDashOrder(body: any): NormalizedOrder | null {
  const o = body?.order ?? body;
  if (!o?.id) return null;
  const items: any[] = (Array.isArray(o.categories) ? o.categories : []).flatMap((c: any) => (Array.isArray(c.items) ? c.items : []));
  const lines: OrderLine[] = items.map((it) => {
    const qty = Number(it.quantity || 1);
    const modifiers = (Array.isArray(it.extras) ? it.extras : [])
      .flatMap((e: any) => (Array.isArray(e.options) ? e.options : []))
      .map((op: any) => ({
        externalId: op.merchant_supplied_id ? String(op.merchant_supplied_id) : undefined,
        ...(op.line_option_id ? { lineOptionId: String(op.line_option_id) } : {}),
        name: String(op.name ?? ''),
        quantity: Number(op.quantity || 1),
        unitPrice: cents(op.price),
      }));
    const unit = cents(it.price);
    return {
      externalId: it.merchant_supplied_id ? String(it.merchant_supplied_id) : undefined,
      ...(it.line_item_id ? { lineItemId: String(it.line_item_id) } : {}),
      name: String(it.name ?? 'Item'),
      quantity: qty,
      unitPrice: unit,
      total: unit * qty,
      notes: it.special_instructions || undefined,
      modifiers,
    };
  });
  const first = o.consumer?.first_name || '';
  const last = o.consumer?.last_name ? `${String(o.consumer.last_name).charAt(0)}.` : '';
  const promos = doorDashPromotions(o, items);
  const details = doorDashOrderDetails(o, promos);
  return {
    channel: KEY,
    marketplace: 'doordash',
    externalOrderId: String(o.id),
    displayId: o.delivery_short_code ? String(o.delivery_short_code) : undefined,
    channelStoreId: String(o.store?.merchant_supplied_id ?? ''),
    customerName: `${first} ${last}`.trim() || undefined,
    // Order Model fulfillment_type: dx_delivery (Dasher), pickup, mx_fleet_delivery (merchant delivery); is_pickup as fallback.
    fulfillment: o.fulfillment_type ? (String(o.fulfillment_type).toLowerCase() === 'pickup' ? 'pickup' : 'delivery') : o.is_pickup ? 'pickup' : 'delivery',
    placedAt: o.created_at || new Date().toISOString(),
    readyBy: o.estimated_pickup_time || undefined,
    currency: process.env.FOODHUB_CURRENCY || 'CAD',
    subtotal: cents(o.subtotal),
    tax: cents(o.tax),
    // delivery_fee is sent for self-delivery orders (Order Model); a Dasher delivery's fee is DoorDash's, not ours.
    deliveryFee: o.delivery_fee != null ? cents(o.delivery_fee) : 0,
    tip: doorDashTip(o),
    discount: doorDashDiscount(o, promos),
    total: cents(o.subtotal) + cents(o.tax),
    notes: o.order_special_instructions || undefined,
    // Order Model `experience`: DOORDASH, CAVIAR, STOREFRONT, … (shown to the staff on the card, ticket and Clover note).
    ...(o.experience ? { orderSource: String(o.experience).toUpperCase() } : {}),
    ...(details ? { doorDash: details } : {}),
    lines,
    raw: body,
  };
}
