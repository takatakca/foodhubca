// Payment link by text: a phone (or staff) order is HELD until the customer pays it on Clover's secure page; once paid
// it is released EXACTLY ONCE — pickup: the kitchen ticket prints; delivery: then the courier is sent (tickDispatch).
//
//   order placed → status 'awaiting_payment' (not on the kitchen screen, not in Clover, no courier)
//   → our link https://<public>/p/<token> texted (valid FOODHUB phone setting "expiryMin", default 30 min; Clover's own
//     page lives 15 min, so the page makes a fresh Clover session when needed)
//   → paid: the Hosted Checkout webhook (signature checked) or the poller (every 20 s, our "Réf. IA-1043" mark on the
//     first Clover line) or the customer's return to our page → releasePaidOrder():
//       one release (in-process lock + claim written and re-read), the Clover order made by the payment IS the ticket:
//       its id is saved on the order FIRST (so the website mirror and the Clover "Delivery" importer treat it as ours),
//       then titled "📞 IA-1043 · Brand", noted, given our order type, printed once (print claim written before the
//       print request), status 'in_kitchen', "paiement reçu" text.
//   → never paid: one reminder, then cancelled with a courtesy text ("aucun montant n'a été prélevé").
// A payment after the cancel, or a second payment: never printed, flagged for a person to refund in Clover (Food Hub
// never refunds by itself). Without a Clover ecommerce key nothing here is used: orders work exactly as before.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { getCatalog } from '../catalog';
import { publicBaseUrl } from '../config';
import { brandHoursState, getHours } from '../hours';
import { postToChat, sendSms, smsConfigured } from '../notify';
import { money as textMoney, textTime } from '../phone/style';
import { cloverAutoPrintEnabled, cloverToken } from '../pos/clover';
import {
  buildCheckoutRequest, checkoutTotalCents, createHostedCheckout, ecommConfigured, ecommKeyFor, findPaidByMarker, merchantQcTaxRates, payMarker, paymentWithOrder, updateCloverOrder,
} from '../pos/clover-checkout';
import { printKitchenTicket } from '../pos/clover-order';
import { prepFor } from '../prep';
import { getRepo } from '../repo';
import { createDirectOrderInClover, explicitMerchantFor, kitchenHasNoRegister, orderTypeId } from './clover-direct';
import { confirmToCustomer } from './orders';
import { addDirectEvent, getDeliverySettings, getDirectOrder, listDirectOrders, ruleFor, saveDirectOrder } from './store';
import type { DirectOrder, PayLink } from './types';

type Lang = PayLink['lang'];
const CLOVER_SESSION_MS = 15 * 60_000;
const REUSE_SESSION_MS = 13 * 60_000;
const POLL_MS = 20_000;
const CLAIM_STALE_MS = 2 * 60_000;
const SYSTEM = 'Payment link';

const tokenKey = (t: string) => `paylink:${t}`;
const sessionKey = (s: string) => `hco_session:${s}`;
export const LAST_WEBHOOK_KEY = 'hco_last_webhook';

export const payUrl = (token: string) => `${publicBaseUrl()}/p/${token}`;

// ---------------------------------------------------------------------------------------------------------------
// Availability

export interface PaylinkReady { ok: boolean; merchantId?: string; reason?: string }

/**
 * Can this kitchen take a payment by link right now? A Hosted Checkout key for the kitchen's OWN Clover merchant (no
 * default fallback), a REST token for that merchant, texts configured and an https public address.
 */
export async function paylinkReadiness(brand: string, locationCode: string): Promise<PaylinkReady> {
  if (!ecommConfigured()) return { ok: false, reason: 'No Clover Hosted Checkout key on this server (CLOVER_ECOMM_PRIVATE_KEY).' };
  if (kitchenHasNoRegister(locationCode)) return { ok: false, reason: `${locationCode} has no Clover register (FOODHUB_CLOVER_NO_REGISTER): a paid order could not be printed there.` };
  const mid = await explicitMerchantFor(brand, locationCode).catch(() => null);
  if (!mid) return { ok: false, reason: `No Clover merchant mapped to ${locationCode} (Stores): a payment link would be paid on another kitchen's register.` };
  if (!ecommKeyFor(mid)) return { ok: false, merchantId: mid, reason: `No Hosted Checkout key for merchant ${mid} (CLOVER_ECOMM_KEYS).` };
  if (!(await cloverToken(mid).catch(() => null))) return { ok: false, merchantId: mid, reason: `No Clover REST token for merchant ${mid}: the paid order could not be read or printed.` };
  if (!smsConfigured()) return { ok: false, merchantId: mid, reason: 'Texts are not set up (Twilio): the link cannot be sent.' };
  if (!/^https:\/\//.test(publicBaseUrl())) return { ok: false, merchantId: mid, reason: 'FOODHUB_PUBLIC_URL is not an https address: the link would not open.' };
  return { ok: true, merchantId: mid };
}

// ---------------------------------------------------------------------------------------------------------------
// Texts (Québec French, English, Spanish with "usted"). No platform names, no round-the-clock wording.

async function pickupAddress(locationCode: string): Promise<string> {
  const loc = (await getCatalog()).locations.find((l) => l.code === locationCode);
  return loc?.address ?? '';
}

export const PAYLINK_SMS = {
  link: (o: DirectOrder, url: string, min: number, lang: Lang) => {
    const t = textMoney(o.total, lang);
    if (lang === 'en') return `${o.brandName}: order ${o.number}, total ${t}. Pay securely with Clover: ${url} As soon as it is paid, we start preparing it${o.fulfillment === 'delivery' ? ' and send the courier' : ' for pickup'}. Link valid ${min} min.`;
    if (lang === 'es') return `${o.brandName}: pedido ${o.number}, total ${t}. Pague de forma segura con Clover: ${url} En cuanto recibamos el pago, lo preparamos${o.fulfillment === 'delivery' ? ' y enviamos al repartidor' : ' para recoger'}. Enlace válido ${min} min.`;
    return `${o.brandName} : commande ${o.number}, total ${t}. Payez en toute sécurité avec Clover : ${url} Dès le paiement reçu, on prépare votre commande${o.fulfillment === 'delivery' ? ' et on envoie le livreur' : ' pour emporter'}. Lien valide ${min} min.`;
  },
  reminder: (o: DirectOrder, url: string, left: number, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: your order ${o.number} is waiting for your payment: ${url} Without payment within ${left} min, it will be cancelled.`;
    if (lang === 'es') return `${o.brandName}: su pedido ${o.number} espera su pago: ${url} Si no se paga en ${left} min, se cancelará.`;
    return `${o.brandName} : votre commande ${o.number} attend votre paiement : ${url} Sans paiement d'ici ${left} min, elle sera annulée.`;
  },
  paid: (o: DirectOrder, address: string, lang: Lang) => {
    const at = o.readyAt ? textTime(o.readyAt, lang) : '';
    if (lang === 'en') return o.fulfillment === 'delivery' ? `${o.brandName}: payment received, thank you! Order ${o.number} is being prepared; delivery in about 45 minutes. The courier tracking link will follow by text.` : `${o.brandName}: payment received, thank you! Order ${o.number} ready for pickup around ${at}${address ? ` at ${address}` : ''}.`;
    if (lang === 'es') return o.fulfillment === 'delivery' ? `${o.brandName}: ¡pago recibido, gracias! Su pedido ${o.number} está en preparación; entrega en unos 45 minutos. El enlace de seguimiento del repartidor llegará por mensaje.` : `${o.brandName}: ¡pago recibido, gracias! Su pedido ${o.number} estará listo para recoger hacia las ${at}${address ? ` en ${address}` : ''}.`;
    return o.fulfillment === 'delivery' ? `${o.brandName} : paiement reçu, merci! Commande ${o.number} en préparation, livraison dans environ 45 minutes. Le lien de suivi du livreur suivra par texto.` : `${o.brandName} : paiement reçu, merci! Commande ${o.number} prête pour emporter vers ${at}${address ? `, au ${address}` : ''}.`;
  },
  paidClosed: (o: DirectOrder, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: payment received, thank you! A team member will call you to confirm the time of your order ${o.number}.`;
    if (lang === 'es') return `${o.brandName}: ¡pago recibido, gracias! Un miembro de nuestro equipo le llamará para confirmar la hora de su pedido ${o.number}.`;
    return `${o.brandName} : paiement reçu, merci! Un membre de notre équipe vous appelle pour confirmer l'heure de votre commande ${o.number}.`;
  },
  expired: (o: DirectOrder, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: the payment link for order ${o.number} has expired and the order is cancelled. Nothing was charged.`;
    if (lang === 'es') return `${o.brandName}: el enlace de pago del pedido ${o.number} venció y el pedido fue cancelado. No se le cobró nada.`;
    return `${o.brandName} : le lien de paiement de la commande ${o.number} a expiré et la commande est annulée. Aucun montant n'a été prélevé.`;
  },
  cancelled: (o: DirectOrder, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: order ${o.number} is cancelled. Nothing was charged.`;
    if (lang === 'es') return `${o.brandName}: el pedido ${o.number} fue cancelado. No se le cobró nada.`;
    return `${o.brandName} : la commande ${o.number} est annulée. Aucun montant n'a été prélevé.`;
  },
};

/** Outbox preview of a text that holds the link: the token never lands in the outbox. */
const redact = (body: string, token: string) => body.split(token).join('••••');

async function textCustomer(o: DirectOrder, body: string, purpose: string): Promise<{ ok: boolean; message: string }> {
  if (!o.customer.phone) return { ok: false, message: 'No phone number on the order.' };
  const token = o.paylink?.token ?? '';
  const r = await sendSms({ to: o.customer.phone, body, ...(o.paylink?.smsFrom ? { from: o.paylink.smsFrom } : {}) }, { purpose, orderId: o.id, by: SYSTEM, ...(token ? { preview: redact(body, token) } : {}) });
  return { ok: r.ok, message: r.message };
}

// ---------------------------------------------------------------------------------------------------------------
// Creating a link

async function newSession(o: DirectOrder, token: string, mid: string): Promise<{ ok: true; session: PayLink['sessions'][number]; expectedCents: number } | { ok: false; error: string }> {
  const rates = await merchantQcTaxRates(mid);
  if (!rates) return { ok: false, error: `Clover merchant ${mid}: GST (5 %) and QST (9.975 %) tax rates not found — the payment page would charge the wrong total.` };
  const back = (r: string) => `${payUrl(token)}?r=${r}`;
  const req = buildCheckoutRequest(o, rates, { success: back('ok'), failure: back('fail'), cancel: back('cancel') });
  const s = await createHostedCheckout(mid, req);
  if (!s.ok) return { ok: false, error: s.error };
  const at = Date.now();
  await getRepo().setKv(sessionKey(s.sessionId), o.id).catch(() => undefined);
  return { ok: true, expectedCents: checkoutTotalCents(req), session: { id: s.sessionId, href: s.href, createdAt: new Date(at).toISOString(), expiresAt: new Date(s.expiresAt ?? at + CLOVER_SESSION_MS).toISOString() } };
}

export interface StartPayLinkOptions { lang: Lang; smsFrom?: string; expiryMin: number; reminderMin: number; by?: string }

/**
 * Creates the link of a held order (a first Clover session right away, so a problem is known while the caller is still
 * on the line) and texts it. On failure the order stays held and the caller of this function decides (cancel it).
 */
export async function startPayLink(order: DirectOrder, opts: StartPayLinkOptions): Promise<{ ok: true; order: DirectOrder; smsOk: boolean } | { ok: false; error: string }> {
  if (order.status !== 'awaiting_payment') return { ok: false, error: 'The order is not waiting for a payment.' };
  const ready = await paylinkReadiness(order.brandName, order.locationCode);
  if (!ready.ok || !ready.merchantId) return { ok: false, error: ready.reason ?? 'Payment link not available.' };
  const token = crypto.randomBytes(18).toString('base64url');
  const first = await newSession(order, token, ready.merchantId);
  if (!first.ok) return { ok: false, error: first.error };
  const now = Date.now();
  const paylink: PayLink = {
    token, merchantId: ready.merchantId, marker: payMarker(order.number), lang: opts.lang, ...(opts.smsFrom ? { smsFrom: opts.smsFrom } : {}),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + opts.expiryMin * 60_000).toISOString(), reminderMin: opts.reminderMin,
    sessions: [first.session], expectedCents: first.expectedCents,
  };
  await getRepo().setKv(tokenKey(token), order.id);
  let o = await addDirectEvent(order, 'paylink_created', `Payment link created (Clover merchant ${ready.merchantId}), valid ${opts.expiryMin} min`, opts.by ?? SYSTEM, { paylink });
  const sms = await textCustomer(o, PAYLINK_SMS.link(o, payUrl(token), opts.expiryMin, opts.lang), 'paylink_link');
  o = await addDirectEvent(o, sms.ok ? 'paylink_sent' : 'sms_failed', sms.ok ? 'Payment link texted to the customer' : `Payment link not texted: ${sms.message}`, SYSTEM, { paylink: { ...o.paylink!, ...(sms.ok ? { smsAt: new Date().toISOString() } : { smsError: sms.message }) } });
  return { ok: true, order: o, smsOk: sms.ok };
}

export async function orderIdForToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return getRepo().getKv<string>(tokenKey(token)).catch(() => null);
}

export async function orderForToken(token: string): Promise<DirectOrder | null> {
  const id = await orderIdForToken(token);
  const o = id ? await getDirectOrder(id) : null;
  return o?.paylink && o.paylink.token === token ? o : null;
}

export async function orderIdForSession(sessionId: string): Promise<string | null> {
  return getRepo().getKv<string>(sessionKey(sessionId)).catch(() => null);
}

export type PayLinkState = 'pending' | 'paid' | 'expired' | 'cancelled';

export function payLinkState(o: DirectOrder, now = Date.now()): PayLinkState {
  const pl = o.paylink;
  if (!pl) return 'cancelled';
  if (pl.releasedAt || (o.payment === 'paid' && o.status !== 'awaiting_payment')) return 'paid';
  if (o.status === 'cancelled' || pl.cancelledAt) return 'cancelled';
  if (o.status !== 'awaiting_payment') return 'cancelled';
  return now >= Date.parse(pl.expiresAt) ? 'expired' : 'pending';
}

/** The customer opened the link and tapped "Pay": a Clover session young enough to finish, or a fresh one. */
export async function openPayLink(token: string, now = Date.now()): Promise<{ ok: true; href: string } | { ok: false; state: PayLinkState | 'unknown' | 'error'; message: string }> {
  const o = await orderForToken(token);
  if (!o?.paylink) return { ok: false, state: 'unknown', message: 'Unknown link.' };
  const state = payLinkState(o, now);
  if (state !== 'pending') return { ok: false, state, message: state };
  const pl = o.paylink;
  const young = [...pl.sessions].reverse().find((s) => now - Date.parse(s.createdAt) < REUSE_SESSION_MS);
  if (young) {
    if (!pl.openedAt) await addDirectEvent(o, 'paylink_opened', 'The customer opened the payment page', SYSTEM, { paylink: { ...pl, openedAt: new Date(now).toISOString() } });
    return { ok: true, href: young.href };
  }
  // A new Clover session must not outlive our link (the order is cancelled at most 16 minutes after the last one).
  if (Date.parse(pl.expiresAt) - now < 60_000) return { ok: false, state: 'expired', message: 'expired' };
  const s = await newSession(o, token, pl.merchantId);
  if (!s.ok) return { ok: false, state: 'error', message: s.error };
  const cur = (await getDirectOrder(o.id)) ?? o;
  await addDirectEvent(cur, 'paylink_session', 'New Clover payment page opened', SYSTEM, { paylink: { ...cur.paylink!, sessions: [...cur.paylink!.sessions, s.session].slice(-10), openedAt: cur.paylink!.openedAt ?? new Date(now).toISOString() } });
  return { ok: true, href: s.session.href };
}

// ---------------------------------------------------------------------------------------------------------------
// Release — exactly once

const locks = (): Map<string, Promise<unknown>> => {
  const g = globalThis as unknown as { __fhPaylinkLocks?: Map<string, Promise<unknown>> };
  g.__fhPaylinkLocks ??= new Map();
  return g.__fhPaylinkLocks;
};

/** One release at a time per order in this process (the claim below covers other processes). */
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks().get(id) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks().set(id, run);
  try { return await run; } finally { if (locks().get(id) === run) locks().delete(id); }
}

export interface PaymentEvidence { paymentId: string; cloverOrderId?: string; amountCents?: number; via: 'webhook' | 'poller' | 'page' | 'phone' | 'clover_event' }
export type ReleaseResult = { state: 'released' | 'already' | 'pending' | 'late' | 'extra' | 'declined' | 'retry' | 'unknown'; message: string; order?: DirectOrder };

const ICON: Record<DirectOrder['source'], string> = { phone: '📞', phone_ai: '📞', clover: '🧾', website: '🌐', manual: '✍️', clover_online: '🌐' };

/** A payment Food Hub cannot use (late or second): flagged for a refund by a person, never printed. */
async function flagExtraPayment(o: DirectOrder, ev: PaymentEvidence, why: 'late' | 'extra'): Promise<ReleaseResult> {
  const pl = o.paylink!;
  if (pl.extraPayments?.includes(ev.paymentId)) return { state: why, message: 'Already flagged.', order: o };
  const paid = ev.cloverOrderId ? ev : await paymentWithOrder(pl.merchantId, ev.paymentId).then((p) => (p ? { ...ev, cloverOrderId: p.cloverOrderId, amountCents: p.amountCents } : ev));
  if (paid.cloverOrderId) await updateCloverOrder(pl.merchantId, paid.cloverOrderId, { title: `⚠ PAIEMENT EN TROP ${o.number} — rembourser`, note: `Paiement reçu ${why === 'late' ? 'après l’annulation' : 'en double'} de la commande Food Hub ${o.number}. NE PAS PRÉPARER — rembourser dans Clover.` });
  const msg = why === 'late' ? `Payment ${ev.paymentId} arrived after the order was cancelled — refund it in Clover (not printed).` : `Second payment ${ev.paymentId} for an order already paid — refund it in Clover (not printed).`;
  const next = await addDirectEvent(o, 'paylink_extra_payment', msg, SYSTEM, { paylink: { ...pl, extraPayments: [...(pl.extraPayments ?? []), ev.paymentId] }, attention: `${why === 'late' ? 'Paiement reçu après l’annulation' : 'Paiement en double'} — remboursez-le dans Clover (${((paid.amountCents ?? 0) / 100).toFixed(2)} $).` });
  await postToChat({ title: `💳 ${o.number}: ${why === 'late' ? 'payment after cancel' : 'double payment'} — refund in Clover`, text: msg, severity: 'critical' }, { purpose: 'paylink_extra_payment', orderId: o.id }).catch(() => undefined);
  return { state: why, message: msg, order: next };
}

/**
 * The customer paid: release the held order once, whatever the path (webhook, poller, page return, phone check).
 * `retry` = Clover could not be read (the webhook answers 503 so Clover sends it again).
 */
export async function releasePaidOrder(orderId: string, ev: PaymentEvidence, now = Date.now()): Promise<ReleaseResult> {
  return withLock(orderId, async () => {
    let o = await getDirectOrder(orderId);
    if (!o?.paylink) return { state: 'unknown', message: 'No payment link on this order.' };
    const pl0 = o.paylink;
    if (pl0.releasedAt || (o.payment === 'paid' && o.status !== 'awaiting_payment')) {
      if (pl0.paymentId && pl0.paymentId !== ev.paymentId) return flagExtraPayment(o, ev, 'extra');
      return { state: 'already', message: 'Already released.', order: o };
    }
    if (o.status === 'cancelled' || pl0.cancelledAt) return flagExtraPayment(o, ev, 'late');
    if (o.status !== 'awaiting_payment') return { state: 'already', message: `Order is ${o.status}.`, order: o };
    if (pl0.releaseClaim && pl0.releaseClaimAt && now - Date.parse(pl0.releaseClaimAt) < CLAIM_STALE_MS) return { state: 'pending', message: 'Another request is releasing it.', order: o };

    // Claim, then re-read: if another server wrote its own claim in between, it releases and this one stops.
    const claim = crypto.randomUUID();
    await saveDirectOrder({ ...o, paylink: { ...pl0, releaseClaim: claim, releaseClaimAt: new Date(now).toISOString() } });
    o = (await getDirectOrder(orderId))!;
    if (o.paylink?.releaseClaim !== claim) return { state: 'pending', message: 'Another request is releasing it.', order: o };
    const unclaim = async () => { const c = await getDirectOrder(orderId); if (c?.paylink?.releaseClaim === claim) await saveDirectOrder({ ...c, paylink: { ...c.paylink, releaseClaim: undefined, releaseClaimAt: undefined } }); };

    const pl = o.paylink;
    const mid = pl.merchantId;
    let cloverOrderId = ev.cloverOrderId;
    let amountCents = ev.amountCents;
    if (!cloverOrderId || amountCents === undefined) {
      const p = await paymentWithOrder(mid, ev.paymentId);
      if (!p) { await unclaim(); return { state: 'retry', message: 'Clover payment not readable yet.', order: o }; }
      if (p.result && p.result.toUpperCase() !== 'SUCCESS') { await unclaim(); return { state: 'declined', message: `Clover payment result ${p.result}.`, order: o }; }
      cloverOrderId = p.cloverOrderId;
      amountCents = p.amountCents;
    }
    const paidAt = new Date(now).toISOString();
    const off = Math.abs((amountCents ?? 0) - pl.expectedCents);
    // 1) The Clover order id FIRST: from here the website mirror and the "Delivery" importer know it is ours.
    o = await addDirectEvent(o, 'paid', `Paid online by the payment link — ${((amountCents ?? 0) / 100).toFixed(2)} $ (Clover payment ${ev.paymentId}, via ${ev.via})`, 'Clover', {
      payment: 'paid', posOrderId: cloverOrderId, posMerchantId: mid, posError: undefined,
      paylink: { ...pl, paymentId: ev.paymentId, paidAt, paidCents: amountCents, cloverOrderId },
      ...(off > 2 ? { attention: `Montant payé ${((amountCents ?? 0) / 100).toFixed(2)} $ ≠ total ${(pl.expectedCents / 100).toFixed(2)} $ — vérifiez dans Clover.` } : {}),
    });
    // 2) Title, note, order type (the register and the ticket read like every Food Hub order).
    const token = await cloverToken(mid);
    const typeId = token ? await orderTypeId(mid, token, o.fulfillment, o.source).catch(() => null) : null;
    const who = [o.customer.name, o.customer.phone].filter(Boolean).join(' · ');
    const where = o.fulfillment === 'delivery' && o.dropoff ? `LIVRAISON: ${o.dropoff.street}${o.dropoff.unit ? ` #${o.dropoff.unit}` : ''}, ${o.dropoff.postalCode}` : 'POUR EMPORTER / PICKUP';
    const titled = await updateCloverOrder(mid, cloverOrderId!, {
      title: `${ICON[o.source]} ${o.number} · ${o.brandName}`,
      note: [where, who, o.containsAlcohol ? '🔞 ID 18+' : '', 'PAYÉ EN LIGNE / PAID ONLINE (Clover)', o.notes ?? ''].filter(Boolean).join(' | '),
      orderTypeId: typeId,
    });
    if (!titled) o = await addDirectEvent(o, 'pos_failed', 'Clover did not take the title / note of the paid order (the ticket may read without our number).', SYSTEM);
    // 3) The kitchen: open now (or a later time asked for) → print once; closed → a person calls the customer.
    const cfg = await getHours();
    const wanted = o.wantedAt ? Date.parse(o.wantedAt) : NaN;
    const closed = !(Number.isFinite(wanted) && wanted > now) && brandHoursState(cfg, o.brandName, o.locationCode, now) === 'closed';
    let printed: string | undefined;
    if (closed) {
      o = await addDirectEvent(o, 'paylink_kitchen_closed', 'Paid while the kitchen is closed — not printed; call the customer.', SYSTEM, { attention: 'Payée pendant que la cuisine est fermée — appelez le client (rien n’a été imprimé).' });
    } else if (!o.paylink?.printClaimAt) {
      o = await saveDirectOrder({ ...o, paylink: { ...o.paylink!, printClaimAt: new Date().toISOString() } });
      if (process.env.FOODHUB_PAYLINK_PRINT === 'off' || !cloverAutoPrintEnabled()) printed = 'printing off (FOODHUB_PAYLINK_PRINT / FOODHUB_CLOVER_AUTOPRINT)';
      else {
        const p = await printKitchenTicket(cloverOrderId!, mid, o.locationCode).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
        printed = p.message;
        o = p.ok
          ? await saveDirectOrder({ ...o, paylink: { ...o.paylink!, printedAt: new Date().toISOString() } })
          : await addDirectEvent(o, 'print_failed', `Ticket not printed: ${p.message}`, SYSTEM, { paylink: { ...o.paylink!, printError: p.message }, attention: 'Ticket non imprimé — réimprimez-le dans Clover (la commande est payée).' });
      }
    }
    // 4) In the kitchen, ready time from now.
    const prep = await prepFor(o.locationCode);
    const readyMs = Number.isFinite(wanted) && wanted > now + prep.minutes * 60_000 ? wanted - (o.fulfillment === 'delivery' ? 20 : 0) * 60_000 : now + prep.minutes * 60_000;
    const rule = ruleFor(await getDeliverySettings(), o.locationCode);
    const needCourier = o.fulfillment === 'delivery' && !rule.autoDispatch && !o.attention;
    o = await addDirectEvent(o, 'paylink_released', `Released to the kitchen${printed ? ` — ${printed}` : ''}`, SYSTEM, {
      status: 'in_kitchen', readyAt: new Date(readyMs).toISOString(),
      paylink: { ...o.paylink!, releasedAt: new Date().toISOString(), releaseClaim: undefined, releaseClaimAt: undefined },
      ...(needCourier ? { attention: 'Payée — appelez un livreur (envoi automatique éteint pour cette cuisine).' } : {}),
    });
    // 5) The customer.
    const sms = await textCustomer(o, closed ? PAYLINK_SMS.paidClosed(o, pl.lang) : PAYLINK_SMS.paid(o, await pickupAddress(o.locationCode), pl.lang), 'paylink_paid');
    o = await addDirectEvent(o, sms.ok ? 'sms_confirmation' : 'sms_failed', sms.ok ? 'Payment confirmation texted' : `Payment confirmation not texted: ${sms.message}`, SYSTEM);
    await logActivity({ actor: SYSTEM, source: 'automation', kind: 'order', action: 'paylink_paid', status: 'success', brandName: o.brandName, locationCode: o.locationCode,
      summary: `${o.number} paid by link (${((amountCents ?? 0) / 100).toFixed(2)} $, via ${ev.via}) — ${o.fulfillment === 'delivery' ? 'courier next' : 'kitchen ticket'}` });
    return { state: 'released', message: 'Released.', order: o };
  });
}

/** Asks Clover once whether the link was paid (poller, page return, the phone assistant). */
export async function checkPayLink(orderId: string, via: PaymentEvidence['via'], now = Date.now()): Promise<{ state: PayLinkState | 'unknown'; order?: DirectOrder }> {
  let o = await getDirectOrder(orderId);
  if (!o?.paylink) return { state: 'unknown' };
  if (payLinkState(o, now) === 'paid') return { state: 'paid', order: o };
  if (o.status !== 'awaiting_payment') return { state: payLinkState(o, now), order: o };
  const found = await findPaidByMarker(o.paylink.merchantId, o.paylink.marker, Date.parse(o.paylink.createdAt) - 60_000);
  // Under the order's lock: never write over a release that finished in between.
  o = await withLock(orderId, async () => {
    const cur = await getDirectOrder(orderId);
    if (!cur?.paylink || cur.status !== 'awaiting_payment') return cur ?? o!;
    return saveDirectOrder({ ...cur, paylink: { ...cur.paylink, lastCheckAt: new Date(now).toISOString() } });
  });
  if (!found?.length) return { state: payLinkState(o, now), order: o };
  let last: ReleaseResult | null = null;
  for (const p of found) last = await releasePaidOrder(orderId, { paymentId: p.paymentId, cloverOrderId: p.cloverOrderId, amountCents: p.amountCents, via }, now);
  const after = (await getDirectOrder(orderId)) ?? last?.order ?? o;
  return { state: payLinkState(after, now), order: after };
}

/** Clover said the card was declined (the customer is on Clover's page and can try again). */
export async function notePaymentDeclined(orderId: string, paymentId: string | null): Promise<void> {
  const o = await getDirectOrder(orderId);
  if (!o?.paylink || o.status !== 'awaiting_payment') return;
  await addDirectEvent(o, 'paylink_declined', `Card declined on the Clover page${paymentId ? ` (${paymentId})` : ''} — the customer can try again.`, 'Clover', { paylink: { ...o.paylink, declinedAt: new Date().toISOString() } });
}

// ---------------------------------------------------------------------------------------------------------------
// Staff actions, expiry

/** Cancels a held order (expired link, or a person): the link stops working, the customer is told nothing was charged. */
export async function cancelHeldOrder(orderId: string, reason: string, by = SYSTEM, opts: { expired?: boolean; text?: boolean } = {}): Promise<DirectOrder> {
  const r = await withLock(orderId, async () => {
    const o = await getDirectOrder(orderId);
    if (!o) throw new Error('Order not found.');
    // A release that just finished wins: a paid order is never cancelled here.
    if (o.status !== 'awaiting_payment' || o.paylink?.releaseClaim) return { o, done: false };
    return { o: await addDirectEvent(o, 'cancelled', reason, by, { status: 'cancelled', attention: undefined, ...(o.paylink ? { paylink: { ...o.paylink, cancelledAt: new Date().toISOString(), cancelReason: reason } } : {}) }), done: true, before: o };
  });
  if (!r.done) return r.o;
  const o = r.before!;
  let next = r.o;
  if (opts.text !== false && o.paylink) {
    const sms = await textCustomer(next, opts.expired ? PAYLINK_SMS.expired(next, o.paylink.lang) : PAYLINK_SMS.cancelled(next, o.paylink.lang), 'paylink_cancelled');
    next = await addDirectEvent(next, sms.ok ? 'sms_cancelled' : 'sms_failed', sms.ok ? 'Customer told: cancelled, nothing charged' : `Cancel text not sent: ${sms.message}`, SYSTEM);
  }
  return next;
}

export async function resendPayLink(orderId: string, actor: Actor): Promise<DirectOrder> {
  const o = await getDirectOrder(orderId);
  if (!o?.paylink || o.status !== 'awaiting_payment') throw new Error('This order has no payment link waiting.');
  const left = Math.max(1, Math.round((Date.parse(o.paylink.expiresAt) - Date.now()) / 60_000));
  const sms = await textCustomer(o, PAYLINK_SMS.link(o, payUrl(o.paylink.token), left, o.paylink.lang), 'paylink_resend');
  if (!sms.ok) throw new Error(`The text was not sent: ${sms.message}`);
  return addDirectEvent(o, 'paylink_sent', 'Payment link texted again', actor.name);
}

/** Pickup only: the customer will pay at the counter. The link stops; the order goes to Clover and the kitchen now. */
export async function payAtCounter(orderId: string, actor: Actor): Promise<DirectOrder> {
  const o = await getDirectOrder(orderId);
  if (!o || o.status !== 'awaiting_payment') throw new Error('This order is not waiting for a payment.');
  if (o.fulfillment !== 'pickup') throw new Error('A delivery is paid before the courier leaves: send the link again, or cancel.');
  // Clover may already hold a payment (paid this very second): check once before converting.
  const check = await checkPayLink(o.id, 'phone');
  if (check.state === 'paid') return check.order!;
  const converted = await withLock(o.id, async () => {
    const cur = await getDirectOrder(o.id);
    if (!cur || cur.status !== 'awaiting_payment' || cur.paylink?.releaseClaim) return null;
    return addDirectEvent(cur, 'pay_at_counter', 'The customer pays at the counter (payment link stopped)', actor.name, {
      status: 'new', payment: 'pay_at_pickup', ...(cur.paylink ? { paylink: { ...cur.paylink, cancelledAt: new Date().toISOString(), cancelReason: 'pay at the counter' } } : {}),
    });
  });
  if (!converted) return (await getDirectOrder(o.id)) ?? o;
  let next = converted;
  const pos = await createDirectOrderInClover(next);
  next = pos.ok
    ? await addDirectEvent(next, 'pos_injected', `Created in Clover (${pos.posOrderId})${pos.printed ? ` — ${pos.printed}` : ''}`, undefined, { posOrderId: pos.posOrderId, posError: undefined, status: 'in_kitchen' })
    : await addDirectEvent(next, pos.skipped ? 'pos_skipped' : 'pos_failed', pos.error, undefined, { posError: pos.skipped ? undefined : pos.error });
  if (next.customer.phone) await confirmToCustomer(next);
  return (await getDirectOrder(next.id)) ?? next;
}

/**
 * Background (expansion tick): every 20 s, ask Clover about each held order (a webhook can be lost), send the one
 * reminder, and cancel what was never paid once Clover's last page has closed (16 min after it opened).
 */
export async function tickPaylinks(now = Date.now()): Promise<{ checked: number; released: number; cancelled: number; reminded: number }> {
  const out = { checked: 0, released: 0, cancelled: 0, reminded: 0 };
  if (!ecommConfigured()) return out;
  const held = (await listDirectOrders({ since: new Date(now - 2 * 86400_000).toISOString(), limit: 1000 })).filter((o) => o.status === 'awaiting_payment' && o.paylink);
  for (const h of held) {
    try {
      let o = h;
      const pl = o.paylink!;
      if (!pl.lastCheckAt || now - Date.parse(pl.lastCheckAt) >= POLL_MS) {
        out.checked++;
        const r = await checkPayLink(o.id, 'poller', now);
        if (r.state === 'paid') { out.released++; continue; }
        o = r.order ?? o;
      }
      const p = o.paylink!;
      const lastSession = Math.max(0, ...p.sessions.map((s) => Date.parse(s.createdAt)));
      const cancelAt = Math.max(Date.parse(p.expiresAt), lastSession + CLOVER_SESSION_MS + 60_000);
      if (now >= cancelAt) {
        // One last look before cancelling: a payment may have just gone through.
        const last = await checkPayLink(o.id, 'poller', now);
        if (last.state === 'paid') { out.released++; continue; }
        await cancelHeldOrder(o.id, 'Payment link expired — not paid', SYSTEM, { expired: true });
        out.cancelled++;
        continue;
      }
      if (p.reminderMin > 0 && !p.remindedAt && now >= Date.parse(p.createdAt) + p.reminderMin * 60_000 && now < Date.parse(p.expiresAt)) {
        const left = Math.max(1, Math.round((Date.parse(p.expiresAt) - now) / 60_000));
        const sms = await textCustomer(o, PAYLINK_SMS.reminder(o, payUrl(p.token), left, p.lang), 'paylink_reminder');
        await withLock(o.id, async () => {
          const cur = await getDirectOrder(o.id);
          if (cur?.paylink && cur.status === 'awaiting_payment') await addDirectEvent(cur, sms.ok ? 'paylink_reminder' : 'sms_failed', sms.ok ? 'Payment reminder texted' : `Reminder not texted: ${sms.message}`, SYSTEM, { paylink: { ...cur.paylink, remindedAt: new Date(now).toISOString() } });
        });
        if (sms.ok) out.reminded++;
      }
    } catch (e) {
      console.error('[foodhub] paylink tick', h.number, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
