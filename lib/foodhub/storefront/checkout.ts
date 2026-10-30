// Checkout of the ordering page ("Commander direct"): a pickup order placed by the customer on /commander/<slug>.
//
// It enters the existing direct-order pipeline as a WEBSITE order (source 'website', sourceRef 'sf_<random>'), so it
// gets the Clover ticket and the kitchen screen exactly like the website orders already do — no new order source.
//   pay at the counter → createDirectOrder(…, payment 'pay_at_pickup', confirmBySms) → Clover + kitchen now;
//   pay online        → createDirectOrder(…, holdForPayment) → startPayLink(notify 'none') → the browser opens
//                       /p/<token> (Clover Hosted Checkout); the order reaches the kitchen once Clover confirms the
//                       payment (delivery/paylink.ts). A link that cannot be made cancels the held order (no text)
//                       and, when the brand allows it, asks the customer to retry with "pay at the counter" — never a
//                       silent switch.
// Refused: switch or brand off (404), closed, paused or too close to closing time (409), an unpaid order above the
// brand's cap (422), too many orders (429). Unpaid orders are capped (PICKUP_MAX_ITEMS items, the brand's
// pickupMaxTotal $) because the phone is not verified and the ticket prints right away.
// Tracking is a random token (fh_kv sf_track:<token> → { orderId, at }) valid TRACK_TTL_MS, shown only under the
// brand's own page; it shows the order number, status, brand and ready time — never the customer.
import crypto from 'node:crypto';
import type { Actor } from '../activity';
import { createDirectOrder } from '../delivery/orders';
import { cancelHeldOrder, paylinkReadiness, startPayLink } from '../delivery/paylink';
import { getDirectOrder, listDirectOrders } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { prepFor } from '../prep';
import { getRepo } from '../repo';
import { SRC_RE, cartSchema, cleanCustomer, priceCart } from './cart';
import { loadSellableMenu } from './catalog';
import { priceLabel, sfLang, sfText } from './i18n';
import { reserveCheckout } from './rate-limit';
import { brandForSlug, getStorefrontSettings, seedBrandOf } from './settings';

export const STOREFRONT_ACTOR: Actor = { username: 'storefront', name: 'Commander direct', source: 'api' };
export const ORDER_NOTE = 'Commande en ligne (Commander direct)';
/** Most items (sum of quantities) in one unpaid ("pay at the counter") order. */
export const PICKUP_MAX_ITEMS = 25;
/** A tracking link works this long after the order. */
export const TRACK_TTL_MS = 7 * 86400_000;
const trackKey = (t: string) => `sf_track:${t}`;
export const TRACK_RE = /^[A-Za-z0-9_-]{20,64}$/;

type TrackRecord = { orderId: string; at: number };

export type CheckoutResult =
  | { ok: true; status: 200; number: string; track: string; trackUrl: string; payUrl?: string; total: number }
  | { ok: false; status: number; error: string; reason?: 'closed' | 'paused' | 'rate_limited' | 'pay' | 'pickup_limit'; fallback?: 'pay_at_pickup'; retryAfterSec?: number; line?: number };

/** The ?src= tag kept in the order note by placeStorefrontOrder ("… · instagram"), else 'direct'. */
function srcOf(notes: string | undefined): string {
  if (!notes?.startsWith(ORDER_NOTE)) return 'direct';
  const tag = notes.slice(ORDER_NOTE.length).replace(/^\s*·\s*/, '').trim();
  return SRC_RE.test(tag) ? tag : 'direct';
}

/**
 * Orders by brand and source over the last `days` days, read from the orders themselves (no separate counter): an
 * ordering-page order counts once it is real — paid at the counter, or paid online (released). Held, unpaid or
 * cancelled orders never count.
 */
export async function ordersBySource(days = 7, now = Date.now()): Promise<Array<{ brand: string; src: string; orders: number }>> {
  const since = new Date(now - days * 86400_000).toISOString();
  const orders = await listDirectOrders({ since, limit: 5000 }).catch(() => [] as DirectOrder[]);
  const totals = new Map<string, number>();
  for (const o of orders) {
    if (o.source !== 'website' || !o.sourceRef?.startsWith('sf_')) continue;
    if (o.status === 'cancelled' || o.status === 'awaiting_payment') continue;
    const k = `${o.brandName}|${srcOf(o.notes)}`;
    totals.set(k, (totals.get(k) ?? 0) + 1);
  }
  return [...totals.entries()].map(([k, n]) => { const i = k.lastIndexOf('|'); return { brand: k.slice(0, i), src: k.slice(i + 1), orders: n }; })
    .sort((a, b) => b.orders - a.orders || a.brand.localeCompare(b.brand));
}

export async function newTrack(orderId: string, now: number): Promise<string> {
  const token = crypto.randomBytes(18).toString('base64url');
  await getRepo().setKv(trackKey(token), { orderId, at: now } satisfies TrackRecord);
  return token;
}

/** The tracking path of a brand's order (its ordering page slug), or null when the brand has no page. */
export async function trackPathFor(brandName: string, token: string): Promise<string | null> {
  const slug = (await getStorefrontSettings()).brands[brandName]?.slug;
  return slug ? `/commander/${slug}/suivi/${token}` : null;
}

/** Places a pickup order from the ordering page. `ip` = clientIp(headers). */
export async function placeStorefrontOrder(body: unknown, ip: string, now = Date.now()): Promise<CheckoutResult> {
  const lang = sfLang((body as { lang?: unknown } | null)?.lang);
  const t = sfText(lang);
  const parsed = cartSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: t.errors.invalid };
  const cart = parsed.data;
  const menu = await loadSellableMenu(cart.slug, now);
  if (!menu?.live) return { ok: false, status: 404, error: t.errors.notFound };
  if (menu.menu.state.paused) return { ok: false, status: 409, reason: 'paused', error: t.errors.paused };
  if (!menu.menu.state.open) return { ok: false, status: 409, reason: 'closed', error: t.errors.closed };
  // Last order: the kitchen must have its prep time before closing (closesAt is shown one minute before the close).
  if (menu.menu.state.closesAt) {
    const prep = await prepFor(menu.locationCode);
    if (Date.parse(menu.menu.state.closesAt) + 60_000 - now < prep.minutes * 60_000) return { ok: false, status: 409, reason: 'closed', error: t.errors.lastOrder };
  }
  const online = cart.pay === 'online';
  if (online && !menu.cfg.payOnline) return { ok: false, status: 409, reason: 'pay', error: t.errors.payOnlineOff, ...(menu.cfg.payAtPickup ? { fallback: 'pay_at_pickup' as const } : {}) };
  if (!online && !menu.cfg.payAtPickup) return { ok: false, status: 409, reason: 'pay', error: t.errors.payAtPickupOff };
  const who = cleanCustomer(cart.customer, cart.lang);
  if (!who.ok) return { ok: false, status: 400, error: who.error };
  const priced = priceCart(menu, cart);
  if (!priced.ok) return { ok: false, status: 422, error: priced.error, ...(priced.line !== undefined ? { line: priced.line } : {}) };
  if (!online) {
    const items = priced.lines.reduce((s, l) => s + l.quantity, 0);
    if (items > PICKUP_MAX_ITEMS) return { ok: false, status: 422, reason: 'pickup_limit', error: t.errors.pickupTooMany(PICKUP_MAX_ITEMS, menu.cfg.payOnline) };
    if (priced.total > menu.cfg.pickupMaxTotal) return { ok: false, status: 422, reason: 'pickup_limit', error: t.errors.pickupTooBig(priceLabel(menu.cfg.pickupMaxTotal, cart.lang), menu.cfg.payOnline) };
  }
  // Check and take the slots in one step (parallel requests cannot all pass); given back if no order is placed.
  const slot = await reserveCheckout(ip, who.customer.phone, { slug: cart.slug, payAtPickup: !online }, now);
  if (!slot.ok) return { ok: false, status: 429, reason: 'rate_limited', error: t.errors.tooMany, retryAfterSec: slot.retryAfterSec };
  const payFailed = (): CheckoutResult => (menu.cfg.payAtPickup
    ? { ok: false, status: 409, reason: 'pay', fallback: 'pay_at_pickup', error: t.fallbackPayAtPickup }
    : { ok: false, status: 503, reason: 'pay', error: t.errors.generic });

  let order: DirectOrder;
  let payUrl: string | undefined;
  try {
    if (online) {
      const ready = await paylinkReadiness(menu.brandName, menu.locationCode, { needSms: false }).catch(() => ({ ok: false }));
      if (!ready.ok) { await slot.release(); return payFailed(); }
    }
    order = await createDirectOrder({
      source: 'website', sourceRef: `sf_${crypto.randomBytes(9).toString('base64url')}`, brandName: menu.brandName, locationCode: menu.locationCode,
      customer: who.customer, fulfillment: 'pickup', lines: priced.lines, payment: online ? 'paid' : 'pay_at_pickup',
      notes: `${ORDER_NOTE}${cart.src ? ` · ${cart.src}` : ''}`, holdForPayment: online, confirmBySms: !online,
    }, STOREFRONT_ACTOR);
  } catch (e) {
    await slot.release();
    throw e;
  }

  if (online) {
    const link = await startPayLink(order, { lang: cart.lang, expiryMin: 20, reminderMin: 0, notify: 'none', by: STOREFRONT_ACTOR.name }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!link.ok) {
      await cancelHeldOrder(order.id, `Payment link not created — ${link.error}`, STOREFRONT_ACTOR.name, { text: false }).catch(() => undefined);
      await slot.release(); // nothing reached the kitchen and nothing was texted: the retry is not counted twice
      return payFailed();
    }
    payUrl = `/p/${link.order.paylink!.token}`;
  }
  const track = await newTrack(order.id, Date.now()); // real time: the link expiry runs on the clock, not on the menu instant
  return { ok: true, status: 200, number: order.number, track, trackUrl: `/commander/${cart.slug}/suivi/${track}`, ...(payUrl ? { payUrl } : {}), total: order.total };
}

export interface TrackView {
  number: string; status: DirectOrder['status']; brand: string; readyAt: string | null;
  /** Held for an Interac e-Transfer: what to send (never the security answer — it was texted). */
  interac?: { recipient: string; amount: number; reference: string; question?: string; autoDeposit: boolean; expiresAt: string } | null;
}

/**
 * What the tracking page shows: order number, status, brand and ready time. Never the customer, the lines or the money.
 * Null when the token is unknown, older than TRACK_TTL_MS, or (with `slug`) the order is not of that page's brand.
 */
export async function trackOrder(token: string, opts: { slug?: string; now?: number } = {}): Promise<TrackView | null> {
  if (!TRACK_RE.test(token)) return null;
  const rec = await getRepo().getKv<TrackRecord>(trackKey(token)).catch(() => null);
  if (!rec || typeof rec !== 'object' || typeof rec.orderId !== 'string' || !Number.isFinite(rec.at)) return null;
  const now = opts.now ?? Date.now();
  if (now - rec.at > TRACK_TTL_MS) return null;
  const o = await getDirectOrder(rec.orderId);
  if (!o) return null;
  if (opts.slug !== undefined) {
    const hit = await brandForSlug(opts.slug);
    if (!hit || hit.brandName !== o.brandName) return null;
  }
  const i = o.status === 'awaiting_payment' && o.interac ? o.interac : null;
  return {
    number: o.number, status: o.status, brand: seedBrandOf(o.brandName)?.name ?? o.brandName, readyAt: o.status === 'cancelled' || o.status === 'awaiting_payment' ? null : o.readyAt ?? null,
    ...(i ? { interac: { recipient: i.recipient, amount: i.amount, reference: i.reference, ...(i.autoDeposit || !i.question ? {} : { question: i.question }), autoDeposit: i.autoDeposit, expiresAt: i.expiresAt } } : {}),
  };
}
