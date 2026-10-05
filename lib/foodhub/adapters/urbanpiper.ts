// SkipTheDishes / DoorDash orders received through UrbanPiper (the owner's existing order hub) — no platform API needed.
// UrbanPiper already holds the platform integrations; its "Order Placed" webhook (Atlas → Webhooks) posts each order to
// Food Hub, which then runs the normal pipeline: Clover ticket, kitchen screen, alerts, money checks.
// Status changes go back to the platform through UrbanPiper (PUT /external/api/v1/orders/:id/status/) when the
// UrbanPiper POS API key is set; without it nothing is sent and Food Hub says so (never shown as sent when it was not).
// Docs: api-docs.urbanpiper.com/downstream (Order Relay, Order Status Update, Authentication).
//   FOODHUB_VIA_URBANPIPER   channels accepted from UrbanPiper (default "skip,doordash"; uber_eats if no direct Uber API)
//   URBANPIPER_WEBHOOK_SECRET token in the webhook URL (?token=) or header — generated automatically
//   URBANPIPER_USERNAME + URBANPIPER_API_KEY   POS API key from pos.support@urbanpiper.com (optional: status updates)
//   URBANPIPER_POS_API_URL   default https://pos-int.urbanpiper.com
import { timedFetch, result, safeEqual } from '../config';
import type { ChannelAdapter, ChannelKey, ChannelResult, Fulfillment, Marketplace, NormalizedOrder, OrderLine, StoredOrder } from '../types';

export const URBANPIPER_ID_PREFIX = 'up-';

/** Platform name as UrbanPiper writes it (channel, ext_platforms[].name, external_channel.name) → Food Hub channel. */
export function upChannel(name: unknown): ChannelKey | null {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.includes('skip') || s.includes('justeat')) return 'skip';
  if (s.includes('doordash')) return 'doordash';
  if (s.includes('uber')) return 'uber_eats';
  if (s.includes('toogoodtogo') || s === 'tgtg') return 'tgtg';
  return null;
}

export function viaUrbanPiperChannels(): ChannelKey[] {
  const raw = process.env.FOODHUB_VIA_URBANPIPER ?? 'skip,doordash';
  return raw.split(',').map((x) => upChannel(x)).filter((x): x is ChannelKey => Boolean(x));
}

export function verifyUrbanPiperWebhook(headers: Headers, url: URL): boolean {
  const expected = process.env.URBANPIPER_WEBHOOK_SECRET;
  if (!expected) return false;
  const candidates = [url.searchParams.get('token'), headers.get('x-takatak-token'), headers.get('x-api-key'), (headers.get('authorization') || '').replace(/^(Bearer|Token|apikey)\s+/i, '')];
  return candidates.some((c) => typeof c === 'string' && c.length > 0 && safeEqual(c.trim(), expected));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(String(v ?? '')) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "Order Placed" payload → normalized order, or why it is ignored. */
export function parseUrbanPiperOrder(body: any): { order: NormalizedOrder; hubOrderId: string } | { ignored: string } {
  const d = body?.order?.details;
  if (!d || d.id === undefined) return { ignored: 'Not an UrbanPiper order payload.' };
  const ext = Array.isArray(d.ext_platforms) ? d.ext_platforms[0] : undefined;
  const channel = upChannel(d.channel) ?? upChannel(ext?.name);
  if (!channel) return { ignored: `Platform "${d.channel ?? ext?.name ?? '?'}" is not handled by Food Hub.` };
  if (!viaUrbanPiperChannels().includes(channel)) return { ignored: `${channel} orders are not taken from UrbanPiper (FOODHUB_VIA_URBANPIPER).` };
  const hubOrderId = String(d.id);
  const store = body.order.store ?? {};
  const items: any[] = Array.isArray(body.order.items) ? body.order.items : [];
  const lines: OrderLine[] = items.map((it) => {
    const quantity = Math.max(1, Math.round(num(it.quantity) || 1));
    const total = r2(num(it.total) || num(it.price) * quantity);
    const removed = (Array.isArray(it.options_to_remove) ? it.options_to_remove : []).map((o: any) => `Sans ${o.title}`);
    const notes = [it.instructions, ...removed].filter(Boolean).join(' · ') || undefined;
    return {
      externalId: it.merchant_id ? String(it.merchant_id) : it.id !== undefined ? String(it.id) : undefined,
      name: String(it.title ?? 'Item'),
      quantity,
      unitPrice: r2(total / quantity),
      total,
      notes,
      modifiers: (Array.isArray(it.options_to_add) ? it.options_to_add : []).map((o: any) => ({
        externalId: o.merchant_id ? String(o.merchant_id) : undefined,
        name: String(o.title ?? ''),
        quantity: Math.max(1, Math.round(num(o.quantity) || 1)),
        unitPrice: r2(num(o.price)),
      })),
    };
  });
  const type = String(d.order_type ?? '').toLowerCase();
  const fulfillment: Fulfillment = type.includes('pick') || type.includes('takeaway') ? 'pickup' : type.includes('dine') ? 'dine_in' : 'delivery';
  const customer = body.customer ?? {};
  const placed = num(d.created) ? new Date(num(d.created)).toISOString() : new Date().toISOString();
  const readyMs = num(d.expected_pickup_time) || num(d.delivery_datetime);
  const discount = num(d.discount) + num(d.total_external_discount);
  const order: NormalizedOrder = {
    channel,
    marketplace: channel as Marketplace,
    externalOrderId: `${URBANPIPER_ID_PREFIX}${hubOrderId}`,
    displayId: ext?.id ? (String(ext.id).length <= 12 ? String(ext.id) : String(ext.id).slice(-8)) : hubOrderId,
    channelStoreId: String(store.merchant_ref_id ?? store.id ?? ''),
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
    viaHub: 'urbanpiper',
    hubOrderId,
  };
  return { order, hubOrderId };
}

/** "Order status change" payload (UrbanPiper → POS) → channel, Food Hub order id and the new state. */
export function parseUrbanPiperStatus(body: any): { channel: ChannelKey; externalOrderId: string; state: string; message?: string } | null {
  if (!body || body.order_id === undefined || !body.new_state) return null;
  const channel = upChannel(body.additional_info?.external_channel?.name) ?? null;
  if (!channel) return null;
  return { channel, externalOrderId: `${URBANPIPER_ID_PREFIX}${body.order_id}`, state: String(body.new_state), message: body.message ? String(body.message) : undefined };
}

function apiReady() {
  return Boolean(process.env.URBANPIPER_USERNAME && process.env.URBANPIPER_API_KEY);
}

async function pushStatus(order: StoredOrder, newStatus: string, message: string, extra: Record<string, unknown> = {}, reasonCode = 'unspecified'): Promise<ChannelResult> {
  const label = order.channel === 'skip' ? 'Skip' : order.channel === 'doordash' ? 'DoorDash' : order.channel === 'uber_eats' ? 'Uber Eats' : 'the platform';
  const hubId = order.hubOrderId || order.externalOrderId.replace(URBANPIPER_ID_PREFIX, '');
  if (!apiReady()) {
    return result(order.channel, 'skipped', `Not sent to ${label}: this order came through UrbanPiper and no UrbanPiper POS API key is set — confirm it on the ${label} tablet or in UrbanPiper.`);
  }
  const base = (process.env.URBANPIPER_POS_API_URL || 'https://pos-int.urbanpiper.com').replace(/\/+$/, '');
  try {
    const res = await timedFetch(`${base}/external/api/v1/orders/${encodeURIComponent(hubId)}/status/`, {
      method: 'PUT',
      headers: { Authorization: `apikey ${process.env.URBANPIPER_USERNAME}:${process.env.URBANPIPER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ new_status: newStatus, message, reason_code: reasonCode, ...(Object.keys(extra).length ? { extra } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) return result(order.channel, 'error', `UrbanPiper refused "${newStatus}" (HTTP ${res.status}) — ${text.slice(0, 200)}`, { httpStatus: res.status });
    return result(order.channel, 'done', `"${newStatus}" sent to ${label} through UrbanPiper.`, { httpStatus: res.status });
  } catch (error) {
    return result(order.channel, 'error', `UrbanPiper not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The platform actions for an order received through UrbanPiper. */
export const urbanPiperActions: Pick<ChannelAdapter, 'acceptOrder' | 'denyOrder' | 'markReady' | 'cancelOrder'> = {
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

export function urbanPiperReadiness() {
  return {
    webhookReady: Boolean(process.env.URBANPIPER_WEBHOOK_SECRET),
    statusApiReady: apiReady(),
    channels: viaUrbanPiperChannels(),
  };
}
