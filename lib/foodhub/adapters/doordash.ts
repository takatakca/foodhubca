// DoorDash direct adapter (Marketplace API, JWT auth).
// Spec: https://developer.doordash.com/en-US/api/marketplace/
// DoorDash Marketplace access is limited and granted per partner; DOORDASH_PROVIDER_TYPE
// only exists once DoorDash provisions your integration, so it is required before sending.
import crypto from 'node:crypto';
import { callApi, checkSharedSecret, fromCents, missingEnv, result, stripSlash, timedFetch } from '../config';
import { toDoorDashMenu } from '../menu/translate';
import type { CancelReason, ChannelAdapter, NormalizedOrder, OrderLine, PlatformState } from '../types';
import { blockedResult, buildReadiness, chunk } from './common';

const KEY = 'doordash' as const;

/** Merchant-initiated cancellation is allowlisted per integration by DoorDash: on only when the owner says so. */
export function doorDashMerchantCancelEnabled() {
  return process.env.DOORDASH_MERCHANT_CANCEL === 'true';
}

const DD_CANCEL: Partial<Record<CancelReason, string>> = { out_of_stock: 'ITEM_OUT_OF_STOCK', store_closed: 'STORE_CLOSED', too_busy: 'KITCHEN_BUSY' };

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
  return callApi(KEY, `${base()}${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) }, okStatus);
}

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
  denyOrder: (order, reason) => send('PATCH', `/api/v1/orders/${encodeURIComponent(order.externalOrderId)}`, {
    merchant_supplied_id: order.posOrderId || order.id,
    order_status: 'fail',
    failure_reason: reason || 'Store unable to fulfill',
  }),
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
/** Merchant-funded discount on the order (DoorDash sends it in cents under a few names); 0 when absent. */
function doorDashDiscount(o: any): number {
  const direct = cents(o?.merchant_funded_discount ?? o?.merchant_discount ?? o?.merchant_funded_discount_amount ?? o?.discount_amount ?? o?.discount);
  if (direct) return Math.abs(direct);
  const list: any[] = Array.isArray(o?.discounts) ? o.discounts : Array.isArray(o?.promotions) ? o.promotions : [];
  return Math.round(list.filter((d) => d && (d.merchant_funded === true || /merchant/i.test(String(d.funded_by ?? d.funding_source ?? 'merchant')))).reduce((s, d) => s + Math.abs(cents(d.amount ?? d.discount_amount ?? d.value)), 0) * 100) / 100;
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
        name: String(op.name ?? ''),
        quantity: Number(op.quantity || 1),
        unitPrice: cents(op.price),
      }));
    const unit = cents(it.price);
    return {
      externalId: it.merchant_supplied_id ? String(it.merchant_supplied_id) : undefined,
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
  return {
    channel: KEY,
    marketplace: 'doordash',
    externalOrderId: String(o.id),
    displayId: o.delivery_short_code ? String(o.delivery_short_code) : undefined,
    channelStoreId: String(o.store?.merchant_supplied_id ?? ''),
    customerName: `${first} ${last}`.trim() || undefined,
    fulfillment: o.is_pickup ? 'pickup' : 'delivery',
    placedAt: o.created_at || new Date().toISOString(),
    readyBy: o.estimated_pickup_time || undefined,
    currency: process.env.FOODHUB_CURRENCY || 'CAD',
    subtotal: cents(o.subtotal),
    tax: cents(o.tax),
    deliveryFee: 0,
    tip: cents(o.tip_amount ?? o.tip),
    discount: doorDashDiscount(o),
    total: cents(o.subtotal) + cents(o.tax),
    notes: o.order_special_instructions || undefined,
    lines,
    raw: body,
  };
}
