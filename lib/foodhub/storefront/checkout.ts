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
// Refused: switch or brand off (404), closed or paused (409), too many orders (429). Tracking is a random token
// (fh_kv sf_track:<token> → order id) that shows the order number, status, brand and ready time — never the customer.
import crypto from 'node:crypto';
import type { Actor } from '../activity';
import { createDirectOrder } from '../delivery/orders';
import { cancelHeldOrder, paylinkReadiness, startPayLink } from '../delivery/paylink';
import { getDirectOrder } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { localDate } from '../hours';
import { getRepo } from '../repo';
import { cartSchema, cleanCustomer, priceCart } from './cart';
import { loadSellableMenu } from './catalog';
import { sfLang, sfText } from './i18n';
import { checkoutAllowed, noteCheckout } from './rate-limit';
import { seedBrandOf } from './settings';

export const STOREFRONT_ACTOR: Actor = { username: 'storefront', name: 'Commander direct', source: 'api' };
export const ORDER_NOTE = 'Commande en ligne (Commander direct)';
const trackKey = (t: string) => `sf_track:${t}`;
export const srcKey = (date: string) => `sf_src:${date}`;
export const TRACK_RE = /^[A-Za-z0-9_-]{20,64}$/;

export type CheckoutResult =
  | { ok: true; status: 200; number: string; track: string; trackUrl: string; payUrl?: string; total: number }
  | { ok: false; status: number; error: string; reason?: 'closed' | 'paused' | 'rate_limited' | 'pay'; fallback?: 'pay_at_pickup'; retryAfterSec?: number; line?: number };

/** Adds one order to the day's attribution counters (brand|src). */
async function countSource(brandName: string, src: string | undefined, now: number): Promise<void> {
  const key = srcKey(localDate(now));
  const repo = getRepo();
  const cur = (await repo.getKv<Record<string, number>>(key).catch(() => null)) ?? {};
  const k = `${brandName}|${src ?? 'direct'}`;
  await repo.setKv(key, { ...cur, [k]: (cur[k] ?? 0) + 1 }).catch(() => undefined);
}

/** Orders by brand and source over the last `days` days (attribution counters). */
export async function ordersBySource(days = 7, now = Date.now()): Promise<Array<{ brand: string; src: string; orders: number }>> {
  const totals = new Map<string, number>();
  for (let d = 0; d < days; d++) {
    const day = (await getRepo().getKv<Record<string, number>>(srcKey(localDate(now - d * 86400_000))).catch(() => null)) ?? {};
    for (const [k, v] of Object.entries(day)) totals.set(k, (totals.get(k) ?? 0) + (Number(v) || 0));
  }
  return [...totals.entries()].map(([k, orders]) => { const i = k.lastIndexOf('|'); return { brand: k.slice(0, i), src: k.slice(i + 1), orders }; })
    .sort((a, b) => b.orders - a.orders || a.brand.localeCompare(b.brand));
}

async function newTrack(orderId: string): Promise<string> {
  const token = crypto.randomBytes(18).toString('base64url');
  await getRepo().setKv(trackKey(token), orderId);
  return token;
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
  const online = cart.pay === 'online';
  if (online && !menu.cfg.payOnline) return { ok: false, status: 409, reason: 'pay', error: t.errors.payOnlineOff, ...(menu.cfg.payAtPickup ? { fallback: 'pay_at_pickup' as const } : {}) };
  if (!online && !menu.cfg.payAtPickup) return { ok: false, status: 409, reason: 'pay', error: t.errors.payAtPickupOff };
  const who = cleanCustomer(cart.customer, cart.lang);
  if (!who.ok) return { ok: false, status: 400, error: who.error };
  const priced = priceCart(menu, cart);
  if (!priced.ok) return { ok: false, status: 422, error: priced.error, ...(priced.line !== undefined ? { line: priced.line } : {}) };
  const allowed = await checkoutAllowed(ip, who.customer.phone, now);
  if (!allowed.ok) return { ok: false, status: 429, reason: 'rate_limited', error: t.errors.tooMany, retryAfterSec: allowed.retryAfterSec };
  if (online) {
    const ready = await paylinkReadiness(menu.brandName, menu.locationCode, { needSms: false }).catch(() => ({ ok: false }));
    if (!ready.ok) {
      return menu.cfg.payAtPickup
        ? { ok: false, status: 409, reason: 'pay', fallback: 'pay_at_pickup', error: t.fallbackPayAtPickup }
        : { ok: false, status: 503, reason: 'pay', error: t.errors.generic };
    }
  }
  await noteCheckout(ip, who.customer.phone, now);

  const order = await createDirectOrder({
    source: 'website', sourceRef: `sf_${crypto.randomBytes(9).toString('base64url')}`, brandName: menu.brandName, locationCode: menu.locationCode,
    customer: who.customer, fulfillment: 'pickup', lines: priced.lines, payment: online ? 'paid' : 'pay_at_pickup',
    notes: `${ORDER_NOTE}${cart.src ? ` · ${cart.src}` : ''}`, holdForPayment: online, confirmBySms: !online,
  }, STOREFRONT_ACTOR);

  let payUrl: string | undefined;
  if (online) {
    const link = await startPayLink(order, { lang: cart.lang, expiryMin: 20, reminderMin: 0, notify: 'none', by: STOREFRONT_ACTOR.name }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!link.ok) {
      await cancelHeldOrder(order.id, `Payment link not created — ${link.error}`, STOREFRONT_ACTOR.name, { text: false }).catch(() => undefined);
      return menu.cfg.payAtPickup
        ? { ok: false, status: 409, reason: 'pay', fallback: 'pay_at_pickup', error: t.fallbackPayAtPickup }
        : { ok: false, status: 503, reason: 'pay', error: t.errors.generic };
    }
    payUrl = `/p/${link.order.paylink!.token}`;
  }
  await countSource(menu.brandName, cart.src, now);
  const track = await newTrack(order.id);
  return { ok: true, status: 200, number: order.number, track, trackUrl: `/commander/${cart.slug}/suivi/${track}`, ...(payUrl ? { payUrl } : {}), total: order.total };
}

export interface TrackView { number: string; status: DirectOrder['status']; brand: string; readyAt: string | null }

/** What the tracking page shows: order number, status, brand, ready time. Never the customer, the lines or the money. */
export async function trackOrder(token: string): Promise<TrackView | null> {
  if (!TRACK_RE.test(token)) return null;
  const id = await getRepo().getKv<string>(trackKey(token)).catch(() => null);
  const o = typeof id === 'string' ? await getDirectOrder(id) : null;
  if (!o) return null;
  return { number: o.number, status: o.status, brand: seedBrandOf(o.brandName)?.name ?? o.brandName, readyAt: o.status === 'cancelled' || o.status === 'awaiting_payment' ? null : o.readyAt ?? null };
}
