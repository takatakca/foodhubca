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
import { cancelHeldOrder, payLinkState, paylinkReadiness, startPayLink } from '../delivery/paylink';
import { findDirectOrderBySource, getDirectOrder, listDirectOrders } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { getRepo } from '../repo';
import { SRC_RE, cartSchema, type Cart } from './cart';
import { sfLang, sfText } from './i18n';
import { reserveCheckout, withKeyLock } from './rate-limit';
import { prepareStorefrontCart, quoteFor, type StorefrontFailure } from './quote';
export { PICKUP_MAX_ITEMS } from './quote';
import { brandForSlug, getStorefrontSettings, seedBrandOf } from './settings';

export const STOREFRONT_ACTOR: Actor = { username: 'storefront', name: 'Commander direct', source: 'api' };
export const ORDER_NOTE = 'Commande en ligne (Commander direct)';
/** A tracking link works this long after the order. */
export const TRACK_TTL_MS = 7 * 86400_000;
const trackKey = (t: string) => `sf_track:${t}`;
export const TRACK_RE = /^[A-Za-z0-9_-]{20,64}$/;

type TrackRecord = { orderId: string; at: number; slug?: string };

export type CheckoutResult =
  | { ok: true; status: 200; number: string; track: string; trackUrl: string; payUrl?: string; total: number }
  | StorefrontFailure;

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

export async function newTrack(orderId: string, now: number, slug?: string): Promise<string> {
  const token = crypto.randomBytes(18).toString('base64url');
  await getRepo().setKv(trackKey(token), { orderId, at: now, ...(slug ? { slug } : {}) } satisfies TrackRecord);
  return token;
}

/** The tracking path of a brand's order (its ordering page slug), or null when the brand has no page. */
export async function trackPathFor(brandName: string, token: string): Promise<string | null> {
  const slug = (await getStorefrontSettings()).brands[brandName]?.slug;
  return slug ? `/commander/${slug}/suivi/${token}` : null;
}

type Attempt = { sourceRef: string; creationStarted: boolean };
type AttemptRecord = { fingerprint: string; sourceRef: string; at: number; result?: CheckoutResult };
const ATTEMPT_SETTLE_MS = 120_000;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function pendingAttempt(lang: Cart['lang'], review = false): StorefrontFailure {
  return {
    ok: false, status: 409, reason: review ? 'review_required' : 'in_progress', ...(!review ? { retryAfterSec: 2 } : {}),
    error: lang === 'fr'
      ? review ? 'Le résultat de cette tentative doit être vérifié avec le restaurant. Ne passez pas une deuxième commande.' : 'Votre commande est encore en cours de vérification. Réessayez la même demande.'
      : review ? 'Check this attempt with the restaurant before placing another order.' : 'Your order is still being checked. Retry the same request.',
  };
}

/**
 * A successful retry returns the original receipt before checking current opening
 * hours, pricing or rate limits. Atomic durable claims also protect separate
 * server processes. An interrupted, unresolved attempt fails closed; it never
 * silently starts a second order/payment. Random client keys are bearer secrets.
 */
export async function placeStorefrontOrder(body: unknown, ip: string, now = Date.now()): Promise<CheckoutResult> {
  const parsed = cartSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: sfText(sfLang((body as { lang?: unknown } | null)?.lang)).errors.invalid };
  const cart = parsed.data;
  if (!cart.idempotencyKey) return placeFreshStorefrontOrder(cart, ip, now);
  const hash = digest(`${cart.slug}|${cart.idempotencyKey}`);
  const key = `sf_checkout:${hash}`;
  const { idempotencyKey: _key, ...intent } = cart;
  const fingerprint = digest(JSON.stringify(intent));
  return withKeyLock(key, async () => {
    const repo = getRepo();
    const replay = async (prior: AttemptRecord | null): Promise<CheckoutResult> => {
      if (!prior || prior.fingerprint !== fingerprint) return {
        ok: false, status: 409, reason: 'idempotency_conflict',
        error: cart.lang === 'fr' ? 'Cette tentative correspond à une autre demande. Vérifiez la commande initiale.' : 'This attempt belongs to a different request. Check the original order.',
      };
      if (prior.result) return prior.result;
      if (now - prior.at < ATTEMPT_SETTLE_MS) return pendingAttempt(cart.lang);
      const order = await findDirectOrderBySource('website', prior.sourceRef);
      if (!order || order.status === 'cancelled') return pendingAttempt(cart.lang, true);
      let payUrl: string | undefined;
      if (cart.pay === 'online' && order.status === 'awaiting_payment') {
        if (payLinkState(order, now) !== 'pending') return pendingAttempt(cart.lang, true);
        payUrl = `/p/${order.paylink!.token}`;
      }
      const track = await newTrack(order.id, Date.now(), cart.slug);
      const result: CheckoutResult = { ok: true, status: 200, number: order.number, track, trackUrl: `/commander/${cart.slug}/suivi/${track}`, total: order.total, ...(payUrl ? { payUrl } : {}) };
      await repo.setKv(key, { ...prior, result });
      return result;
    };
    const previous = await repo.getKv<AttemptRecord>(key);
    if (previous) return replay(previous);
    const record: AttemptRecord = { fingerprint, sourceRef: `sf_${hash.slice(0, 32)}`, at: now };
    if (!await repo.claimKv(key, record)) return replay(await repo.getKv<AttemptRecord>(key));
    const attempt: Attempt = { sourceRef: record.sourceRef, creationStarted: false };
    try {
      const result = await placeFreshStorefrontOrder(cart, ip, now, attempt);
      if (result.ok || attempt.creationStarted) await repo.setKv(key, { ...record, result });
      else await repo.releaseKv(key); // a definitive refusal before any order side effect
      return result;
    } catch (error) {
      if (!attempt.creationStarted) await repo.releaseKv(key);
      // Once creation began, a missing response cannot prove that no order exists.
      throw error;
    }
  });
}

/** Validates/reprices before placing a new order. Idempotent replay happens outside this path. */
async function placeFreshStorefrontOrder(body: unknown, ip: string, now: number, attempt?: Attempt): Promise<CheckoutResult> {
  const prepared = await prepareStorefrontCart(body, now);
  if (!prepared.ok) return prepared;
  const { cart, menu, priced, customer } = prepared;
  const t = sfText(cart.lang);
  const online = cart.pay === 'online';
  const quote = quoteFor(prepared);
  if (cart.quoteId && cart.quoteId !== quote.quoteId) return {
    ok: false, status: 409, reason: 'quote_changed', quote,
    error: cart.lang === 'fr' ? 'Le menu ou les prix ont changé. Vérifiez le nouveau total avant de confirmer.' : 'The menu or prices changed. Review the new total before confirming.',
  };
  // Check and take the slots in one step (parallel requests cannot all pass); given back if no order is placed.
  const slot = await reserveCheckout(ip, customer.phone, { slug: cart.slug, payAtPickup: !online }, now);
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
    if (attempt) attempt.creationStarted = true;
    order = await createDirectOrder({
      source: 'website', sourceRef: attempt?.sourceRef ?? `sf_${crypto.randomBytes(9).toString('base64url')}`, brandName: menu.brandName, locationCode: menu.locationCode,
      customer, fulfillment: 'pickup', lines: priced.lines, payment: online ? 'paid' : 'pay_at_pickup',
      totals: { subtotal: priced.subtotal, tax: priced.tax, total: priced.total },
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
    order = link.order;
    payUrl = `/p/${link.order.paylink!.token}`;
  }
  const track = await newTrack(order.id, Date.now(), cart.slug); // real time: the link expiry runs on the clock, not on the menu instant
  return { ok: true, status: 200, number: order.number, track, trackUrl: `/commander/${cart.slug}/suivi/${track}`, ...(payUrl ? { payUrl } : {}), total: order.total };
}

export interface TrackView {
  number: string; status: DirectOrder['status']; brand: string; readyAt: string | null;
  /** Held for an Interac e-Transfer: what to send (never the security answer — it was texted). */
  interac?: { recipient: string; amount: number; reference: string; question?: string; autoDeposit: boolean; expiresAt: string } | null;
  /** Resume the existing unpaid order; never create a second order to retry payment. */
  payUrl?: string;
  paymentReview?: boolean;
  paymentReceived?: boolean;
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
  if (opts.slug !== undefined && opts.slug !== rec.slug) {
    const hit = await brandForSlug(opts.slug);
    if (!hit || hit.brandName !== o.brandName) return null;
  }
  // What to send, only while the transfer is still expected (not once a person confirmed it arrived).
  const paymentState = o.paylink ? payLinkState(o, now) : null;
  const paymentReview = paymentState === 'review' || Boolean(o.paylink?.extraPayments?.length);
  const paymentReceived = paymentState === 'paid';
  const i = !paymentReview && !paymentReceived && o.status === 'awaiting_payment' && o.interac && !o.interac.receivedAt ? o.interac : null;
  return {
    number: o.number, status: o.status, brand: seedBrandOf(o.brandName)?.name ?? o.brandName, readyAt: paymentReview || o.status === 'cancelled' || o.status === 'awaiting_payment' ? null : o.readyAt ?? null,
    ...(!paymentReview && o.status === 'awaiting_payment' && paymentState === 'pending' ? { payUrl: `/p/${o.paylink!.token}` } : {}),
    ...(paymentReview ? { paymentReview: true } : {}),
    ...(paymentReceived ? { paymentReceived: true } : {}),
    ...(i ? { interac: { recipient: i.recipient, amount: i.amount, reference: i.reference, ...(i.autoDeposit || !i.question ? {} : { question: i.question }), autoDeposit: i.autoDeposit, expiresAt: i.expiresAt } } : {}),
  };
}
