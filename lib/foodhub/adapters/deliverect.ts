// Deliverect → Food Hub: Too Good To Go Surprise Bag orders (and anything else Deliverect sends a POS) become Food Hub
// orders on the "tgtg" channel. This is the inbound half; deliverect-api.ts is the outbound half.
//
//   Order notification   POST …/webhooks/deliverect/orders      one payload for a new order AND for a channel cancel
//                        (status 100 = CANCEL: void it, then confirm with status 110 on the original _id)
//   Answer 200 first, then update the status: ACCEPTED 20 → PICKUP_READY 70 → FINALIZED 90 (CANCELED 110 / FAILED 120).
//   Amounts are integers in 10^-decimalDigits of the currency (decimalDigits 2: 1050 = $10.50).
//   discountTotal is negative and holds only the restaurant-funded part; taxes come as taxTotal (tax-exclusive regions).
//
// Which Deliverect channel is Too Good To Go: DELIVERECT_TGTG_CHANNEL_IDS (the ids "Get Integrated Channels" returns,
// or the order's `channel` field), DELIVERECT_TGTG_CHANNEL_LINKS (Deliverect channel link ids). With neither set, an
// order is taken as Too Good To Go only when its items are Surprise Bags.
//
// Webhook signature: x-server-authorization-hmac-sha256 = hex HMAC-SHA256 of the raw body (an empty string for GET) with
// DELIVERECT_HMAC_SECRET. Before certification Deliverect signs with the channelLink / locationId (staging only). The URLs
// Food Hub hands back at registration also carry ?token=DELIVERECT_WEBHOOK_SECRET.
import crypto from 'node:crypto';
import { result, safeEqual } from '../config';
import type { ChannelResult, Fulfillment, NormalizedOrder, OrderLine, OrderModifier, StoredOrder } from '../types';
import { DELIVERECT_STATUS, deliverectEnvironment, deliverectOrderStatus, deliverectReadiness } from './deliverect-api';
import { isViaClover } from './via-clover';

const KEY = 'tgtg' as const;
export const DELIVERECT_STORE_PREFIX = 'dlv:';
export const DELIVERECT_ID_PREFIX = 'dlv-';

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (raw: string | undefined) => String(raw ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

export function deliverectTgtgChannelIds(): number[] { return list(process.env.DELIVERECT_TGTG_CHANNEL_IDS).map(Number).filter(Number.isFinite); }
export function deliverectTgtgChannelLinks(): string[] { return list(process.env.DELIVERECT_TGTG_CHANNEL_LINKS); }

const BAG = /surprise|magic\s*bag|panier|sac\s+surprise|too\s*good\s*to\s*go|tgtg/i;

/** Is this Deliverect order a Too Good To Go order? */
export function isDeliverectTgtgOrder(o: any): boolean {
  const ids = deliverectTgtgChannelIds();
  const links = deliverectTgtgChannelLinks();
  if (ids.length || links.length) return ids.includes(Number(o?.channel)) || links.includes(String(o?.channelLink ?? ''));
  const items: any[] = Array.isArray(o?.items) ? o.items : [];
  return items.length > 0 && items.every((i) => BAG.test(String(i?.name ?? '')));
}

// --- signature ------------------------------------------------------------------------------------------------------

export function deliverectSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * HMAC (hex, header x-server-authorization-hmac-sha256) with the production secret — or, on staging before
 * certification, with the channelLink / location / locationId Deliverect uses as the temporary secret — or the shared
 * token Food Hub put in the URLs it returned at registration.
 */
export function verifyDeliverectWebhook(headers: Headers, rawBody: string, url: URL, body?: any): boolean {
  const given = (headers.get('x-server-authorization-hmac-sha256') || '').trim().toLowerCase();
  if (given) {
    const secrets: string[] = [];
    if (process.env.DELIVERECT_HMAC_SECRET) secrets.push(process.env.DELIVERECT_HMAC_SECRET);
    if (deliverectEnvironment() === 'staging' && isObj(body)) for (const k of ['channelLink', 'location', 'locationId']) if (typeof body[k] === 'string' && body[k]) secrets.push(body[k]);
    if (deliverectEnvironment() === 'staging') for (const k of ['locationID', 'locationId', 'channelLink']) { const q = url.searchParams.get(k); if (q) secrets.push(q); }
    if (secrets.some((s) => safeEqual(deliverectSignature(rawBody, s), given))) return true;
  }
  const expected = process.env.DELIVERECT_WEBHOOK_SECRET;
  if (!expected) return false;
  const candidates = [url.searchParams.get('token'), headers.get('x-takatak-token'), headers.get('x-api-key'), (headers.get('authorization') || '').replace(/^(Bearer|Token)\s+/i, '')];
  return candidates.some((c) => typeof c === 'string' && c.length > 0 && safeEqual(c.trim(), expected));
}

// --- order parsing --------------------------------------------------------------------------------------------------

const ORDER_TYPES: Record<number, Fulfillment> = { 1: 'pickup', 2: 'delivery', 3: 'dine_in', 4: 'pickup' };

function flattenModifiers(subItems: any[], mult: number, div: number, out: OrderModifier[], prefix = ''): void {
  for (const s of Array.isArray(subItems) ? subItems : []) {
    if (!isObj(s)) continue;
    const q = Math.max(1, Number(s.quantity) || 1);
    out.push({ externalId: s.plu ? String(s.plu) : undefined, name: `${prefix}${String(s.name ?? '')}`, quantity: q * mult, unitPrice: Math.round(((Number(s.price) || 0) / div) * 100) / 100 });
    flattenModifiers(s.subItems, mult * q, div, out, `${prefix}${String(s.name ?? '')} › `);
  }
}

function isoOr(v: unknown): string | undefined {
  const ms = Date.parse(String(v ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** A Deliverect order notification → a Food Hub order on the Too Good To Go channel, or why it is not one. */
export function parseDeliverectOrder(o: any): { order: NormalizedOrder; deliverectOrderId: string } | { ignored: string; cancel?: boolean } {
  if (!isObj(o) || !o._id) return { ignored: 'Not a Deliverect order (no _id).' };
  if (!Array.isArray(o.items) || !o.items.length) return { ignored: 'The Deliverect order has no items.' };
  if (isViaClover(KEY)) return { ignored: 'Too Good To Go is linked through Clover (FOODHUB_VIA_CLOVER): Clover already has its orders, so Deliverect orders are not taken twice.' };
  if (!isDeliverectTgtgOrder(o)) return { ignored: `Channel ${o.channel ?? '?'} is not Too Good To Go (DELIVERECT_TGTG_CHANNEL_IDS): its platform is connected directly, so Food Hub does not take the order from Deliverect.` };
  const digits = Number.isInteger(o.decimalDigits) ? Math.min(4, Math.max(0, o.decimalDigits)) : 2;
  const div = 10 ** digits;
  const money = (v: unknown) => Math.round(((Number(v) || 0) / div) * 100) / 100;
  const lines: OrderLine[] = o.items.filter(isObj).map((it: any) => {
    const qty = Math.max(1, Number(it.quantity) || 1);
    const modifiers: OrderModifier[] = [];
    flattenModifiers(it.subItems, 1, div, modifiers);
    const unit = money(it.price);
    const mods = modifiers.reduce((s, m) => s + m.unitPrice * m.quantity, 0);
    return { externalId: it.plu ? String(it.plu) : undefined, name: String(it.name ?? 'Surprise Bag'), quantity: qty, unitPrice: unit, total: Math.round((unit + mods) * qty * 100) / 100, notes: it.remark ? String(it.remark) : undefined, modifiers };
  });
  const itemsSum = lines.reduce((s, l) => s + l.total, 0);
  const taxes: any[] = Array.isArray(o.taxes) ? o.taxes : [];
  const tax = money(o.taxTotal ?? taxes.reduce((s, t) => s + (Number(t?.total) || 0), 0));
  // discountTotal is negative (only the restaurant-funded part is subtracted from the order).
  const discount = Math.abs(money(o.discountTotal));
  const deliveryFee = money(o.deliveryCost);
  const tip = money((Number(o.tip) || 0) + (Number(o.driverTip) || 0));
  const paid = Number(o.payment?.amount);
  const fees = money((Number(o.serviceCharge) || 0) + (Number(o.bagFee) || 0) + (Number(o.smallOrderFee) || 0));
  const total = Number.isFinite(paid) && paid > 0 ? money(paid) : Math.round((itemsSum + tax + deliveryFee + fees + tip - discount) * 100) / 100;
  const store = String(o.posLocationId || o.location || '').trim();
  const customer = isObj(o.customer) ? o.customer : {};
  const deliverectOrderId = String(o._id);
  const order: NormalizedOrder = {
    channel: KEY,
    marketplace: 'tgtg',
    externalOrderId: `${DELIVERECT_ID_PREFIX}${deliverectOrderId}`,
    displayId: o.channelOrderDisplayId ? String(o.channelOrderDisplayId) : o.channelOrderId ? String(o.channelOrderId).slice(-8) : undefined,
    channelStoreId: store ? `${DELIVERECT_STORE_PREFIX}${store}` : '',
    customerName: customer.name ? String(customer.name).split(' ')[0] : undefined,
    fulfillment: ORDER_TYPES[Number(o.orderType)] ?? 'pickup',
    placedAt: isoOr(o._created) ?? new Date().toISOString(),
    readyBy: isoOr(o.pickupTime) ?? isoOr(o.deliveryTime),
    currency: process.env.FOODHUB_CURRENCY || 'CAD',
    subtotal: Math.round(itemsSum * 100) / 100,
    tax,
    deliveryFee,
    tip,
    discount,
    total,
    notes: [o.note, customer.note].filter(Boolean).join(' · ') || undefined,
    lines,
    // The Deliverect ids are what the status updates need; kept out of the order text, inside raw.
    raw: { source: 'deliverect', deliverectOrderId, channelOrderId: o.channelOrderId, channelLink: o.channelLink, location: o.location, account: o.account, channel: o.channel, order: o },
  };
  return { order, deliverectOrderId };
}

export interface DeliverectRef { deliverectOrderId: string; receiptId: string }

/** The Deliverect ids of a stored order, or null when it did not come through Deliverect. */
export function deliverectRef(order: Pick<StoredOrder, 'raw' | 'posOrderId' | 'displayId' | 'id'>): DeliverectRef | null {
  const raw = order.raw as { source?: string; deliverectOrderId?: string } | undefined;
  if (raw?.source !== 'deliverect' || !raw.deliverectOrderId) return null;
  return { deliverectOrderId: raw.deliverectOrderId, receiptId: String(order.posOrderId || order.displayId || order.id) };
}

// --- the order's actions towards Deliverect -----------------------------------------------------------------------

function notSent(order: StoredOrder, what: string): ChannelResult {
  const r = deliverectReadiness();
  return result(KEY, 'skipped', `Nothing sent to Deliverect (${what}): ${r.note} The bag is confirmed in the Too Good To Go app.`);
}

async function send(order: StoredOrder, status: number, ok: string, reason?: string): Promise<ChannelResult> {
  const ref = deliverectRef(order);
  if (!ref) return result(KEY, 'skipped', 'Not a Deliverect order: nothing sent.');
  if (!deliverectReadiness().canSend) return notSent(order, ok);
  const res = await deliverectOrderStatus(ref.deliverectOrderId, ref.receiptId, status, { reason });
  return res.ok ? { ...res, message: ok } : res;
}

/** The platform actions for a Too Good To Go order that came through Deliverect. Cancelling is not possible from a POS. */
export const deliverectActions = {
  accept: (order: StoredOrder) => send(order, DELIVERECT_STATUS.ACCEPTED, 'Accepted — sent to Deliverect (ACCEPTED 20).'),
  ready: (order: StoredOrder) => send(order, DELIVERECT_STATUS.PICKUP_READY, 'Bag ready — sent to Deliverect (PICKUP_READY 70).'),
  /** Picked up / handed over: the POS workflow is complete. */
  complete: (order: StoredOrder) => send(order, DELIVERECT_STATUS.FINALIZED, 'Picked up — sent to Deliverect (FINALIZED 90).'),
  /** The channel asked for the cancel (status 100): confirm that it was voided. */
  confirmCancel: (order: StoredOrder, reason = 'cancellation') => send(order, DELIVERECT_STATUS.CANCELED, 'Cancellation confirmed to Deliverect (CANCELED 110).', reason),
  deny: async (_order: StoredOrder, _reason: string): Promise<ChannelResult> => result(KEY, 'blocked', 'Too Good To Go cannot be cancelled from a POS (Deliverect’s link is one-way) — cancel the bag order in TGTG MyStore; the cancellation then comes back here.'),
};

