// Too Good To Go adapter.
// TGTG has no public merchant API (its developer portal is sign-in only): Surprise Bags are created and sized in TGTG
// MyStore. Its one official order feed to a point of sale is Deliverect (one-way: orders go to the POS; editing or
// cancelling stays in MyStore) — see adapters/deliverect*.ts and docs/TGTG_API_COVERAGE.md. Food Hub therefore:
//   - receives bag orders from Deliverect (webhooks/deliverect/…), or on a token-protected feed (webhooks/tgtg, relay),
//   - tells Deliverect what the kitchen did (accepted, ready, picked up) for Deliverect orders,
//   - keeps every other outbound action blocked with a clear reason (never fakes success);
//     for a feed order accept/ready are 'skipped' (nothing to send — TGTG confirms reservations itself).
import { checkSharedSecret, fromCents, result } from '../config';
import type { ChannelAdapter, ChannelKey, Marketplace, NormalizedOrder, OrderLine } from '../types';
import { buildReadiness } from './common';
import { deliverectActions, deliverectRef } from './deliverect';
import { deliverectReadiness } from './deliverect-api';

export const tgtgAdapter: ChannelAdapter = (() => {
  const key = 'tgtg' as const;
  const readiness = () => {
    // Deliverect credentials make the channel usable on their own: the feed token is then optional.
    const viaDeliverect = deliverectReadiness().configured;
    return buildReadiness(key, viaDeliverect ? [] : ['TGTG_WEBHOOK_SECRET'], {
      specConfirmed: process.env.TGTG_SPEC_CONFIRMED === 'true' || viaDeliverect,
      note: viaDeliverect
        ? 'Bag orders arrive from Deliverect (Too Good To Go’s POS partner); accepted / ready / picked up go back to Deliverect. Bag quantities stay in TGTG MyStore.'
        : 'Bag orders are received on the webhook when TGTG enables a partner feed or Deliverect. Bag quantities stay in TGTG MyStore.',
      noteFr: viaDeliverect
        ? 'Les paniers arrivent de Deliverect (partenaire caisse de Too Good To Go) ; accepté / prêt / ramassé repartent vers Deliverect. Les quantités de paniers restent dans TGTG MyStore.'
        : 'Les paniers arrivent par le webhook quand TGTG active un flux partenaire ou Deliverect. Les quantités de paniers restent dans TGTG MyStore.',
      extraWebhooks: [
        { label: 'Deliverect — Register POS URL', path: '/api/foodhub/webhooks/deliverect/register' },
        { label: 'Deliverect — orders (given back at registration)', path: '/api/foodhub/webhooks/deliverect/orders' },
      ],
      handoff: [
        { label: 'Webhook token (Authorization or X-Api-Key header)', envKey: 'TGTG_WEBHOOK_SECRET' },
        { label: 'Deliverect HMAC secret (x-server-authorization-hmac-sha256)', envKey: 'DELIVERECT_HMAC_SECRET' },
        { label: 'Deliverect URL token (?token=)', envKey: 'DELIVERECT_WEBHOOK_SECRET' },
      ],
    });
  };
  const blocked = async () => result(key, 'blocked', 'Too Good To Go has no public merchant API — manage bags in TGTG MyStore.');
  return {
    key,
    label: 'Too Good To Go',
    readiness,
    verifyWebhook: (h) => checkSharedSecret(h, 'TGTG_WEBHOOK_SECRET', ['authorization', 'x-takatak-token', 'x-api-key']),
    // Nothing to send: a TGTG reservation is already confirmed in the TGTG app. 'skipped' (not 'done')
    // so the log shows nothing was sent to TGTG; the order moves on in the kitchen flow.
    acceptOrder: async (order) => (deliverectRef(order) ? deliverectActions.accept(order) : result(key, 'skipped', 'Nothing sent — TGTG reservations are confirmed in the TGTG app.')),
    denyOrder: async (order, reason) => (deliverectRef(order) ? deliverectActions.deny(order, reason) : blocked()),
    cancelOrder: async (order) => (deliverectRef(order) ? deliverectActions.deny(order, '') : blocked()),
    markReady: async (order) => (deliverectRef(order) ? deliverectActions.ready(order) : result(key, 'skipped', 'Nothing sent — the customer shows the TGTG app at pickup.')),
    completeOrder: async (order) => (deliverectRef(order) ? deliverectActions.complete(order) : result(key, 'skipped', 'Nothing sent — the customer swipes the reservation in the TGTG app at pickup.')),
    publishMenu: blocked,
    setItemAvailability: blocked,
    setStoreOnline: blocked,
  };
})();

const AMOUNT_KEYS = ['unitPrice', 'unit_price', 'price', 'total', 'totalPrice', 'subtotal', 'subTotal', 'tax'];
/** Every plain-number amount in the payload (items + order level). Objects like { amount } are cents by contract. */
function plainAmounts(o: any): number[] {
  const rows: any[] = [o, ...(Array.isArray(o?.items ?? o?.lines ?? o?.lineItems ?? o?.basket?.items) ? (o.items ?? o.lines ?? o.lineItems ?? o.basket.items) : [])];
  return rows.flatMap((r) => AMOUNT_KEYS.map((k) => r?.[k])).filter((v) => v != null && typeof v !== 'object').map(Number).filter(Number.isFinite);
}
/**
 * TGTG has no published feed spec, so the unit is decided ONCE per payload, never per value: any fractional
 * amount anywhere → dollars; an all-integer payload follows TGTG_AMOUNTS_IN_CENTS (default true). The same
 * divisor is then applied to every amount so $5.99 and $11.98 never land in different units.
 */
export function amountDivisor(o: any): 1 | 100 {
  const nums = plainAmounts(o);
  if (nums.some((n) => !Number.isInteger(n))) return 1;
  return process.env.TGTG_AMOUNTS_IN_CENTS === 'false' ? 1 : 100;
}
const amountWith = (divisor: 1 | 100) => (v: any) => {
  if (v == null) return 0;
  if (typeof v === 'object') return typeof v.amount === 'number' ? fromCents(v.amount) : Number(v.value || 0);
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n / divisor) * 100) / 100 : 0;
};

/** Best-effort parser for a partner payload without a published spec. Returns null when the shape is unknown. */
export function parseGenericOrder(channel: ChannelKey, marketplace: Marketplace, body: any): NormalizedOrder | null {
  const o = body?.order ?? body?.data ?? body;
  const id = o?.id ?? o?.orderId ?? o?.order_id ?? o?.reference;
  const rawItems: any[] = o?.items ?? o?.lines ?? o?.lineItems ?? o?.basket?.items ?? [];
  if (!id || !Array.isArray(rawItems) || rawItems.length === 0) return null;
  const amount = amountWith(amountDivisor(o));
  const lines: OrderLine[] = rawItems.map((it) => {
    const qty = Number(it.quantity ?? it.qty ?? 1);
    const unit = amount(it.unitPrice ?? it.unit_price ?? it.price);
    return {
      externalId: it.reference ?? it.ref ?? it.id ?? it.sku ? String(it.reference ?? it.ref ?? it.id ?? it.sku) : undefined,
      name: String(it.name ?? it.title ?? 'Surprise Bag'),
      quantity: qty,
      unitPrice: unit,
      total: amount(it.total ?? it.totalPrice) || unit * qty,
      notes: it.notes ?? it.instructions ?? undefined,
      modifiers: [],
    };
  });
  const subtotal = amount(o.subtotal ?? o.subTotal) || lines.reduce((s, l) => s + l.total, 0);
  return {
    channel,
    marketplace,
    externalOrderId: String(id),
    displayId: o.displayId ?? o.pickupCode ?? o.short_code ?? undefined,
    channelStoreId: String(o.storeId ?? o.store_id ?? o.store?.id ?? o.restaurantId ?? ''),
    customerName: o.customer?.firstName ?? o.customer?.name ?? undefined,
    fulfillment: 'pickup',
    placedAt: o.placedAt ?? o.createdAt ?? o.created_at ?? new Date().toISOString(),
    readyBy: o.pickupStart ?? o.pickup_start ?? undefined,
    currency: o.currency ?? process.env.FOODHUB_CURRENCY ?? 'CAD',
    subtotal,
    tax: amount(o.tax),
    deliveryFee: 0,
    tip: 0,
    discount: 0,
    total: amount(o.total ?? o.totalPrice) || subtotal,
    notes: o.notes ?? undefined,
    lines,
    raw: body,
  };
}
