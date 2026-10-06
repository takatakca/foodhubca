// Food Hub Order Relay — Food Hub's own order intake for partners that send orders instead of Food Hub fetching them
// (a Too Good To Go partner feed, a delivery partner…). It replaces the UrbanPiper hub: the
// partner POSTs each order to Food Hub, which runs the normal pipeline (Clover ticket, kitchen screen, alerts, money
// checks), and Accept / Ready / Reject go back to the partner's callback URL — never shown as sent when they were not.
// Stores reached through the relay are mapped with the id "relay:<partner store id>": they receive orders only —
// menu publishes, 86s, pauses and status reads never go to the platform's own API for them.
//
// Payload: the UrbanPiper-compatible "Order Relay" shape ({ order: { details, items, store }, customer }) and its
// "order status change" shape ({ order_id, new_state, additional_info.external_channel }), so a partner that already
// speaks that format plugs in unchanged.
//   FOODHUB_RELAY_CHANNELS      platforms accepted through the relay (default "tgtg"). Add a platform only when it is
//                               NOT also connected directly, or every order arrives twice. A platform linked through
//                               Clover (FOODHUB_VIA_CLOVER) is always refused: Clover already has its orders.
//   FOODHUB_RELAY_SECRET        token in the relay address (?token=) or an Authorization / X-Api-Key header — generated
//   FOODHUB_RELAY_CALLBACK_URL  where status changes are POSTed (optional; without it nothing is sent back)
//   FOODHUB_RELAY_CALLBACK_TOKEN  sent as "Authorization: Bearer <token>" on each callback (optional)
import { liveConnectorsGloballyEnabled, timedFetch, result, safeEqual } from '../config';
import type { ChannelAdapter, ChannelKey, ChannelResult, ChannelStore, Fulfillment, Marketplace, NormalizedOrder, OrderLine, OrderStatus, StoredOrder } from '../types';
import { isViaClover } from './via-clover';

export const RELAY_ID_PREFIX = 'relay-';
/** Store ids of relay-mapped stores: "relay:<partner store id>" (orders only, never a platform API store). */
export const RELAY_STORE_PREFIX = 'relay:';

export function isRelayStore(store: Pick<ChannelStore, 'channelStoreId'>): boolean {
  return String(store.channelStoreId ?? '').startsWith(RELAY_STORE_PREFIX);
}

/** Platform name as the partner writes it (channel, ext_platforms[].name, external_channel.name) → Food Hub channel. */
export function relayChannel(name: unknown): ChannelKey | null {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.includes('skip') || s.includes('justeat')) return 'skip';
  if (s.includes('doordash')) return 'doordash';
  if (s.includes('uber')) return 'uber_eats';
  if (s.includes('toogoodtogo') || s === 'tgtg') return 'tgtg';
  return null;
}

export function relayChannels(): ChannelKey[] {
  // An empty value (as copied from .env.example) means the default, not "nothing".
  const raw = (process.env.FOODHUB_RELAY_CHANNELS || '').trim() || 'tgtg';
  const list = raw.split(',').map((x) => relayChannel(x)).filter((x): x is ChannelKey => Boolean(x));
  // Linked through Clover: Clover already creates those orders — taking them here too would make two.
  return [...new Set(list)].filter((ch) => !isViaClover(ch));
}

export function verifyRelayWebhook(headers: Headers, url: URL): boolean {
  const expected = process.env.FOODHUB_RELAY_SECRET;
  if (!expected) return false;
  const candidates = [url.searchParams.get('token'), headers.get('x-takatak-token'), headers.get('x-api-key'), (headers.get('authorization') || '').replace(/^(Bearer|Token|apikey)\s+/i, '')];
  return candidates.some((c) => typeof c === 'string' && c.length > 0 && safeEqual(c.trim(), expected));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(String(v ?? '')) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A partner timestamp as epoch ms: ISO text, epoch seconds or epoch ms. Undefined when missing or invalid. */
export function relayTimeMs(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : /^\s*\d+(\.\d+)?\s*$/.test(String(v)) ? Number(v) : Date.parse(String(v));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n < 1e12 ? n * 1000 : n;
  // Keep only dates a Date can hold and that make sense for an order (2000 … 2100).
  return ms >= 946684800000 && ms <= 4102444800000 ? ms : undefined;
}

/** Relayed order → normalized order, or why it is ignored. */
export function parseRelayOrder(body: any): { order: NormalizedOrder; hubOrderId: string } | { ignored: string; channel?: ChannelKey } {
  const d = body?.order?.details;
  if (!isObj(d) || d.id === undefined || d.id === null || String(d.id).trim() === '') return { ignored: 'Not an Order Relay payload (order.details.id is missing).' };
  const ext = Array.isArray(d.ext_platforms) && isObj(d.ext_platforms[0]) ? d.ext_platforms[0] : undefined;
  const channel = relayChannel(d.channel) ?? relayChannel(ext?.name);
  if (!channel) return { ignored: `Platform "${d.channel ?? ext?.name ?? '?'}" is not handled by Food Hub.` };
  if (!relayChannels().includes(channel)) {
    return { channel, ignored: isViaClover(channel)
      ? `${channel} is linked through Clover (FOODHUB_VIA_CLOVER) — its orders already reach Clover, so the relay does not take them.`
      : `${channel} orders are not taken from the relay (FOODHUB_RELAY_CHANNELS).` };
  }
  const hubOrderId = String(d.id);
  const store = isObj(body.order.store) ? body.order.store : {};
  const storeRef = store.merchant_ref_id ?? store.id;
  const items: any[] = (Array.isArray(body.order.items) ? body.order.items : []).filter(isObj);
  const lines: OrderLine[] = items.map((it) => {
    const quantity = Math.max(1, Math.round(num(it.quantity) || 1));
    const total = r2(num(it.total) || num(it.price) * quantity);
    const removed = (Array.isArray(it.options_to_remove) ? it.options_to_remove : []).filter(isObj).map((o: any) => `Sans ${o.title}`);
    const notes = [it.instructions, ...removed].filter(Boolean).join(' · ') || undefined;
    return {
      externalId: it.merchant_id ? String(it.merchant_id) : it.id !== undefined ? String(it.id) : undefined,
      name: String(it.title ?? 'Item'),
      quantity,
      unitPrice: r2(total / quantity),
      total,
      notes,
      modifiers: (Array.isArray(it.options_to_add) ? it.options_to_add : []).filter(isObj).map((o: any) => ({
        externalId: o.merchant_id ? String(o.merchant_id) : undefined,
        name: String(o.title ?? ''),
        quantity: Math.max(1, Math.round(num(o.quantity) || 1)),
        unitPrice: r2(num(o.price)),
      })),
    };
  });
  const type = String(d.order_type ?? '').toLowerCase();
  const fulfillment: Fulfillment = type.includes('pick') || type.includes('takeaway') ? 'pickup' : type.includes('dine') ? 'dine_in' : 'delivery';
  const customer = isObj(body.customer) ? body.customer : {};
  const createdMs = relayTimeMs(d.created);
  const placed = createdMs ? new Date(createdMs).toISOString() : new Date().toISOString();
  const readyMs = relayTimeMs(d.expected_pickup_time) ?? relayTimeMs(d.delivery_datetime);
  const discount = num(d.discount) + num(d.total_external_discount);
  const order: NormalizedOrder = {
    channel,
    marketplace: channel as Marketplace,
    externalOrderId: `${RELAY_ID_PREFIX}${hubOrderId}`,
    displayId: ext?.id ? (String(ext.id).length <= 12 ? String(ext.id) : String(ext.id).slice(-8)) : hubOrderId,
    channelStoreId: storeRef !== undefined && storeRef !== null && String(storeRef).trim() ? `${RELAY_STORE_PREFIX}${String(storeRef).trim()}` : '',
    brandName: d.brand?.name ? String(d.brand.name) : undefined,
    customerName: customer.name ? String(customer.name) : undefined,
    fulfillment,
    placedAt: placed,
    readyBy: readyMs ? new Date(readyMs).toISOString() : undefined,
    currency: 'CAD',
    subtotal: r2(num(d.order_subtotal)),
    tax: r2(num(d.total_taxes)),
    deliveryFee: r2(num(d.total_charges)),
    tip: 0,
    discount: r2(discount),
    total: r2(num(d.order_total) || num(d.payable_amount)),
    notes: d.instructions ? String(d.instructions) : undefined,
    lines,
    raw: body,
    viaHub: 'relay',
    hubOrderId,
  };
  return { order, hubOrderId };
}

/** Relayed status change → channel, Food Hub order id and the new state. */
export function parseRelayStatus(body: any): { channel: ChannelKey; externalOrderId: string; state: string; message?: string } | null {
  if (!body || body.order_id === undefined || !body.new_state) return null;
  const channel = relayChannel(body.additional_info?.external_channel?.name) ?? null;
  if (!channel) return null;
  return { channel, externalOrderId: `${RELAY_ID_PREFIX}${body.order_id}`, state: String(body.new_state), message: body.message ? String(body.message) : undefined };
}

const RANK: Partial<Record<OrderStatus, number>> = { new: 0, accepted: 1, ready: 2, dispatched: 3, completed: 4 };

/** The Food Hub status a relayed partner state means (same words as applyExternalStatus), or null. */
export function relayTargetStatus(state: string): OrderStatus | null {
  const s = state.toLowerCase();
  return s.includes('cancel') || s.includes('fail') || s.includes('reject') ? 'cancelled'
    : s.includes('complete') || s.includes('deliver') ? 'completed'
      : s.includes('pick') || s.includes('dispatch') ? 'dispatched'
        : s.includes('ready') ? 'ready'
          : s.includes('ack') || s.includes('accept') ? 'accepted'
            : null;
}

/**
 * Whether a relayed status may change the order: statuses only move forward (deliveries can arrive late or out of
 * order), a closed order (cancelled / completed / failed) never reopens, and the partner can never accept for us an
 * order that Clover did not receive.
 */
export function relayStatusApplies(order: Pick<StoredOrder, 'status'>, state: string, opts: { needsClover?: boolean } = {}): boolean {
  const target = relayTargetStatus(state);
  if (!target || ['cancelled', 'completed', 'failed'].includes(order.status)) return false;
  if (target === 'cancelled') return true;
  if (target === 'accepted' && order.status === 'new' && opts.needsClover) return false;
  return (RANK[target] ?? -1) > (RANK[order.status] ?? 99);
}

function callbackUrl() {
  return (process.env.FOODHUB_RELAY_CALLBACK_URL || '').trim();
}

async function pushStatus(order: StoredOrder, newStatus: string, message: string, extra: Record<string, unknown> = {}, reasonCode = 'unspecified'): Promise<ChannelResult> {
  const label = order.channel === 'skip' ? 'Skip' : order.channel === 'doordash' ? 'DoorDash' : order.channel === 'uber_eats' ? 'Uber Eats' : order.channel === 'tgtg' ? 'Too Good To Go' : 'the platform';
  const hubId = order.hubOrderId || order.externalOrderId.replace(RELAY_ID_PREFIX, '');
  const url = callbackUrl();
  if (!url) {
    // Reject / cancel must reach the partner, or the customer's paid order stays live while the kitchen drops it:
    // refuse (never shown as done). Accept / ready are informational: Food Hub moves on and says nothing was sent.
    if (newStatus === 'Cancelled') {
      return result(order.channel, 'blocked', `Not cancelled: this order came through the Food Hub relay and no callback address is set (FOODHUB_RELAY_CALLBACK_URL) — cancel it on the ${label} side; the cancellation then comes back here.`);
    }
    return result(order.channel, 'skipped', `Not sent to ${label}: this order came through the Food Hub relay and no callback address is set (FOODHUB_RELAY_CALLBACK_URL) — confirm it on the ${label} side.`);
  }
  if (!liveConnectorsGloballyEnabled()) {
    return result(order.channel, 'blocked', `Not sent to ${label}: live connectors are off (LIVE_CONNECTORS_GLOBAL_ENABLED).`);
  }
  const token = process.env.FOODHUB_RELAY_CALLBACK_TOKEN;
  try {
    const res = await timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ order_id: hubId, external_order_id: order.displayId ?? null, channel: order.channel, new_status: newStatus, message, reason_code: reasonCode, ...(Object.keys(extra).length ? { extra } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) return result(order.channel, 'error', `Relay callback refused "${newStatus}" (HTTP ${res.status}) — ${text.slice(0, 200)}`, { httpStatus: res.status });
    return result(order.channel, 'done', `"${newStatus}" sent to ${label} through the relay callback.`, { httpStatus: res.status });
  } catch (error) {
    return result(order.channel, 'error', `Relay callback not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The platform actions for an order received through the relay. */
export const relayActions: Pick<ChannelAdapter, 'acceptOrder' | 'denyOrder' | 'markReady' | 'cancelOrder'> = {
  acceptOrder: (order: StoredOrder) => {
    const target = Date.parse(order.timeline?.readyTarget ?? '');
    const prep = Number.isFinite(target) ? Math.max(5, Math.round((target - Date.now()) / 60_000)) : undefined;
    return pushStatus(order, 'Acknowledged', 'Accepted by the restaurant (TAKATAK Food Hub)', prep ? { prep_time_mins: prep } : {});
  },
  markReady: (order: StoredOrder) => pushStatus(order, 'Food Ready', 'Food ready (TAKATAK Food Hub)'),
  denyOrder: (order: StoredOrder, reason: string) => pushStatus(order, 'Cancelled', reason || 'Rejected by the restaurant', {}, /stock|rupture|86/i.test(reason) ? 'item_out_of_stock' : /busy|occup/i.test(reason) ? 'store_busy' : /closed|ferm/i.test(reason) ? 'store_closed' : 'unspecified'),
  cancelOrder: (order, code, reason) => pushStatus(order, 'Cancelled', reason || 'Cancelled by the restaurant', {},
    code === 'out_of_stock' ? 'item_out_of_stock' : code === 'store_closed' ? 'store_closed' : code === 'too_busy' ? 'store_busy' : 'unspecified'),
};

export function relayReadiness() {
  return {
    webhookReady: Boolean(process.env.FOODHUB_RELAY_SECRET),
    callbackReady: Boolean(callbackUrl()),
    channels: relayChannels(),
  };
}
