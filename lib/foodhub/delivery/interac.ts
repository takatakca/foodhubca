// Interac e-Transfer for website orders: the order is HELD until a PERSON confirms the transfer arrived; then it is
// released EXACTLY ONCE — one Clover order (= the kitchen ticket, printed once), status 'in_kitchen', and for a delivery
// the courier is booked by the usual dispatch tick (dispatch.ts) like every paid order.
//
//   order placed (website.ts, payment "interac", fee declared and checked) → status 'awaiting_payment', payment 'unpaid',
//     `interac` block: recipient e-mail, exact amount, short reference ("PPP-7K3Q") for the transfer's message field,
//     question + answer when auto-deposit is off, expiry (setting "holdMinutes", default 45)
//   → instructions texted to the customer (the same text is returned to the website)
//   → "Virement reçu / Transfer received" pressed in the Direct orders drawer → markInteracReceived():
//       one release (in-process lock + claim written and re-read, lock.ts), payment 'paid' + who confirmed it FIRST, then
//       the Clover order (clover-direct.ts prints it once), 'in_kitchen', "virement reçu" text, ready time from now.
//   → never confirmed: one reminder, then cancelled with a courtesy text (a transfer already sent is returned by a person).
//   → "Received" after the cancel / expiry: NOT released — flagged for a person (send to the kitchen anyway, or note
//     that the money was returned by hand). Food Hub never reads a bank account and never refunds by itself.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { getCatalog } from '../catalog';
import { round2 } from '../config';
import { postToChat, sendSms } from '../notify';
import { money as textMoney, textTime } from '../phone/style';
import { prepFor } from '../prep';
import { createDirectOrderInClover } from './clover-direct';
import { claimFresh, withOrderLock } from './lock';
import { confirmToCustomer, QC_TAX_RATE } from './orders';
import { addDirectEvent, getDeliverySettings, getDirectOrder, listDirectOrders, ruleFor, saveDirectOrder } from './store';
import type { DeliverySettings, DirectOrder, InteracSettings, InteracTransfer } from './types';

type Lang = InteracTransfer['lang'];
const SYSTEM = 'Interac e-Transfer';
/** Reference characters: no 0 / O / 1 / I (read over the phone, typed in a bank app). */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------------------------------------------
// Settings

/** The fee the website must show before checkout: fee + GST + QST (5.00 → 5.75). */
export function interacFeeAllIn(fee: number): number {
  return round2(fee * (1 + QC_TAX_RATE));
}

export function recipientFor(s: InteracSettings, locationCode: string): string {
  return s.recipients[locationCode] || s.recipientEmail || '';
}

export interface InteracReady { ok: boolean; recipient?: string; fee: number; reason?: string }

/** Can this kitchen take an Interac e-Transfer right now? Switch on, a recipient e-mail, and the question + answer when auto-deposit is off. */
export function interacReadiness(s: DeliverySettings, locationCode: string): InteracReady {
  const i = s.interac;
  if (!i.enabled) return { ok: false, fee: i.fee, reason: 'Interac e-Transfer is turned off in Food Hub (Settings → Expansion → Delivery → Paiements).' };
  const recipient = recipientFor(i, locationCode);
  if (!recipient) return { ok: false, fee: i.fee, reason: `No Interac e-mail for ${locationCode} (Settings → Expansion → Delivery → Paiements, or FOODHUB_INTERAC_EMAIL).` };
  if (!i.autoDeposit && (!i.question || !i.answer)) return { ok: false, fee: i.fee, recipient, reason: 'Auto-deposit is off but the security question or its answer is missing (Settings → Expansion → Delivery → Paiements).' };
  return { ok: true, recipient, fee: i.fee };
}

/** "PP" for "Po Poulet", "PPP" for "PPP Pizzeria", the first letters of a one-word brand. */
export function brandInitials(brandName: string): string {
  const words = brandName.split(/[\s'’-]+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  const initials = words.map((w) => w[0]).join('').toUpperCase().slice(0, 3);
  if (initials.length >= 2) return initials;
  return (words[0] ?? 'FH').toUpperCase().slice(0, 3) || 'FH';
}

/** A short reference the customer types in the transfer's message field, unused by any order of the last 2 days. */
export async function newInteracReference(brandName: string, now = Date.now()): Promise<string> {
  const recent = new Set((await listDirectOrders({ since: iso(now - 2 * 86400_000), limit: 2000 }).catch(() => [] as DirectOrder[])).map((o) => o.interac?.reference).filter(Boolean));
  const prefix = brandInitials(brandName);
  for (let i = 0; i < 20; i++) {
    const ref = `${prefix}-${Array.from(crypto.randomBytes(4), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
    if (!recent.has(ref)) return ref;
  }
  return `${prefix}-${now.toString(36).toUpperCase().slice(-5)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Texts (Québec French, English). No platform names, no round-the-clock wording, never the answer in a log.

const amountOf = (o: DirectOrder, lang: Lang) => textMoney(o.interac?.amount ?? o.total, lang);

/** The question / answer sentence, only when auto-deposit is off. */
function qa(i: InteracTransfer, lang: Lang): string {
  if (i.autoDeposit || !i.question) return '';
  return lang === 'en' ? ` Security question: ${i.question} — answer: ${i.answer ?? ''}.` : ` Question de sécurité : ${i.question} — réponse : ${i.answer ?? ''}.`;
}

export const INTERAC_SMS = {
  instructions: (o: DirectOrder, i: InteracTransfer, lang: Lang) => {
    const amt = amountOf(o, lang);
    const by = textTime(i.expiresAt, lang);
    if (lang === 'en') return `${o.brandName}: order ${o.number}, total ${amt}. Pay by Interac e-Transfer to ${i.recipient} — exact amount ${amt}, message: ${i.reference}.${qa(i, lang)} Send it before ${by}. As soon as a team member confirms it arrived, we start preparing your order${o.fulfillment === 'delivery' ? ' and send the courier' : ' for pickup'}.`;
    return `${o.brandName} : commande ${o.number}, total ${amt}. Payez par virement Interac à ${i.recipient} — montant exact ${amt}, message : ${i.reference}.${qa(i, lang)} À envoyer avant ${by}. Dès qu’une personne de notre équipe confirme la réception, on prépare votre commande${o.fulfillment === 'delivery' ? ' et on envoie le livreur' : ' pour emporter'}.`;
  },
  reminder: (o: DirectOrder, i: InteracTransfer, left: number, lang: Lang) => {
    const amt = amountOf(o, lang);
    if (lang === 'en') return `${o.brandName}: your order ${o.number} is waiting for your Interac e-Transfer (${amt} to ${i.recipient}, message ${i.reference}). Without it within ${left} min, the order will be cancelled.`;
    return `${o.brandName} : votre commande ${o.number} attend votre virement Interac (${amt} à ${i.recipient}, message ${i.reference}). Sans virement d’ici ${left} min, elle sera annulée.`;
  },
  received: (o: DirectOrder, address: string, lang: Lang) => {
    const at = o.readyAt ? textTime(o.readyAt, lang) : '';
    if (lang === 'en') return o.fulfillment === 'delivery' ? `${o.brandName}: Interac e-Transfer received, thank you! Order ${o.number} is being prepared; delivery in about 45 minutes. The courier tracking link will follow by text.` : `${o.brandName}: Interac e-Transfer received, thank you! Order ${o.number} ready for pickup around ${at}${address ? ` at ${address}` : ''}.`;
    return o.fulfillment === 'delivery' ? `${o.brandName} : virement Interac reçu, merci! Commande ${o.number} en préparation, livraison dans environ 45 minutes. Le lien de suivi du livreur suivra par texto.` : `${o.brandName} : virement Interac reçu, merci! Commande ${o.number} prête pour emporter vers ${at}${address ? `, au ${address}` : ''}.`;
  },
  expired: (o: DirectOrder, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: we could not confirm your Interac e-Transfer in time, so order ${o.number} is cancelled. If you did send it, a team member will return it to you.`;
    return `${o.brandName} : nous n’avons pas pu confirmer votre virement Interac à temps : la commande ${o.number} est annulée. Si vous l’avez envoyé, une personne de notre équipe vous le retourne.`;
  },
  cancelled: (o: DirectOrder, lang: Lang) => {
    if (lang === 'en') return `${o.brandName}: order ${o.number} is cancelled. If you already sent the Interac e-Transfer, a team member will return it to you.`;
    return `${o.brandName} : la commande ${o.number} est annulée. Si vous avez déjà envoyé le virement Interac, une personne de notre équipe vous le retourne.`;
  },
};

/** The instructions the website shows on its confirmation page (one line per step). */
export function interacInstructions(o: DirectOrder, lang: Lang): string {
  const i = o.interac!;
  const amt = amountOf(o, lang);
  const by = textTime(i.expiresAt, lang);
  if (lang === 'en') {
    return [
      `Pay order ${o.number} by Interac e-Transfer:`,
      `• Recipient: ${i.recipient}`,
      `• Exact amount: ${amt}`,
      `• Message: ${i.reference}`,
      ...(!i.autoDeposit && i.question ? [`• Security question: ${i.question} — answer: ${i.answer ?? ''}`] : []),
      `Send it before ${by}. As soon as a team member confirms it arrived, your order goes to the kitchen${o.fulfillment === 'delivery' ? ' and the courier is sent' : ''}.`,
    ].join('\n');
  }
  return [
    `Payez la commande ${o.number} par virement Interac :`,
    `• Destinataire : ${i.recipient}`,
    `• Montant exact : ${amt}`,
    `• Message : ${i.reference}`,
    ...(!i.autoDeposit && i.question ? [`• Question de sécurité : ${i.question} — réponse : ${i.answer ?? ''}`] : []),
    `À envoyer avant ${by}. Dès qu’une personne de notre équipe confirme la réception, votre commande part en cuisine${o.fulfillment === 'delivery' ? ' et le livreur est envoyé' : ''}.`,
  ].join('\n');
}

/** What the website gets back (contract section B): never the bare answer — only inside the instructions text. */
export function interacSummary(o: DirectOrder) {
  const i = o.interac!;
  return {
    recipient: i.recipient, amount: i.amount, reference: i.reference, ...(i.autoDeposit || !i.question ? {} : { question: i.question }), autoDeposit: i.autoDeposit, expiresAt: i.expiresAt,
    instructionsFr: interacInstructions(o, 'fr'), instructionsEn: interacInstructions(o, 'en'),
  };
}

/** Outbox preview: the answer never lands in the outbox. */
const redact = (body: string, answer: string | undefined) => (answer ? body.split(answer).join('••••') : undefined);

async function textCustomer(o: DirectOrder, body: string, purpose: string): Promise<{ ok: boolean; message: string }> {
  if (!o.customer.phone) return { ok: false, message: 'No phone number on the order.' };
  const preview = redact(body, o.interac?.answer);
  const r = await sendSms({ to: o.customer.phone, body }, { purpose, orderId: o.id, by: SYSTEM, ...(preview ? { preview } : {}) });
  return { ok: r.ok, message: r.message };
}

async function pickupAddress(locationCode: string): Promise<string> {
  const loc = (await getCatalog()).locations.find((l) => l.code === locationCode);
  return loc?.address ?? '';
}

// ---------------------------------------------------------------------------------------------------------------
// Start (the order was just saved held by createDirectOrder with its `interac` block)

export async function startInterac(order: DirectOrder, opts: { by?: string } = {}): Promise<{ order: DirectOrder; smsOk: boolean }> {
  const i = order.interac;
  if (!i || order.status !== 'awaiting_payment') throw new Error('The order is not waiting for an Interac e-Transfer.');
  const min = Math.max(1, Math.round((Date.parse(i.expiresAt) - Date.parse(i.createdAt)) / 60_000));
  let o = await addDirectEvent(order, 'interac_created', `Interac e-Transfer: ${i.amount.toFixed(2)} $ to ${i.recipient}, reference ${i.reference}, valid ${min} min${i.autoDeposit ? '' : ' (security question)'}`, opts.by ?? SYSTEM);
  const sms = await textCustomer(o, INTERAC_SMS.instructions(o, i, i.lang), 'interac_instructions');
  o = await addDirectEvent(o, sms.ok ? 'interac_sent' : 'sms_failed', sms.ok ? 'Interac instructions texted to the customer' : `Interac instructions not texted: ${sms.message}`, SYSTEM, { interac: { ...o.interac!, ...(sms.ok ? { smsAt: new Date().toISOString() } : { smsError: sms.message }) } });
  return { order: o, smsOk: sms.ok };
}

export async function resendInterac(orderId: string, actor: Actor): Promise<DirectOrder> {
  const o = await getDirectOrder(orderId);
  if (!o?.interac || o.status !== 'awaiting_payment') throw new Error('This order is not waiting for an Interac e-Transfer.');
  const sms = await textCustomer(o, INTERAC_SMS.instructions(o, o.interac, o.interac.lang), 'interac_resend');
  if (!sms.ok) throw new Error(`The text was not sent: ${sms.message}`);
  return addDirectEvent(o, 'interac_sent', 'Interac instructions texted again', actor.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Release — exactly once, by a person

export type InteracReceivedResult = { state: 'released' | 'already' | 'pending' | 'late'; message: string; order: DirectOrder };

/**
 * A person pressed "Transfer received". Held → released once. Cancelled / expired → flagged as a late transfer (a
 * person decides: releaseLateInterac or markLateInteracRefunded), never released here. Already released → nothing.
 */
export async function markInteracReceived(orderId: string, actor: Actor, now = Date.now()): Promise<InteracReceivedResult> {
  return withOrderLock(orderId, async () => {
    let o = await getDirectOrder(orderId);
    if (!o?.interac) throw new Error('This order is not paid by Interac e-Transfer.');
    const i0 = o.interac;
    if (i0.releasedAt || (o.payment === 'paid' && o.status !== 'awaiting_payment')) return { state: 'already', message: 'Already received and sent to the kitchen.', order: o };
    if (o.status === 'cancelled') return flagLateTransfer(o, actor, now);
    if (o.status !== 'awaiting_payment') return { state: 'already', message: `Order is ${o.status}${i0.cancelReason === 'pay at the counter' ? ' (the customer pays at the counter)' : ''}.`, order: o };
    if (claimFresh(i0, now)) return { state: 'pending', message: 'Another request is releasing it.', order: o };
    // Claim, then re-read: if another server wrote its own claim in between, it releases and this one stops.
    const claim = crypto.randomUUID();
    await saveDirectOrder({ ...o, interac: { ...i0, releaseClaim: claim, releaseClaimAt: iso(now) } });
    o = (await getDirectOrder(orderId))!;
    if (o.interac?.releaseClaim !== claim) return { state: 'pending', message: 'Another request is releasing it.', order: o };
    return releaseInteracOrder(o, actor, now, 'received');
  });
}

/** Under the lock, claim held. payment 'paid' + who confirmed it FIRST, then Clover (one order = the ticket), then the kitchen. */
async function releaseInteracOrder(o: DirectOrder, actor: Actor, now: number, how: 'received' | 'late'): Promise<InteracReceivedResult> {
  const i = o.interac!;
  const amount = (i.amount ?? o.total).toFixed(2);
  // 1) Paid, by whom: from here a crash leaves a paid order with "Send to Clover", never a second "received".
  o = await addDirectEvent(o, 'paid', `Interac e-Transfer ${i.reference} received — ${amount} $ (confirmed by ${actor.name}${how === 'late' ? ', after the cancel' : ''})`, actor.name, {
    payment: 'paid', interac: { ...i, receivedAt: iso(now), receivedBy: actor.name },
  });
  // 2) One Clover order: the kitchen ticket (printed once by clover-direct). An order already in Clover is never sent again.
  if (!o.posOrderId) {
    const pos = await createDirectOrderInClover(o);
    o = pos.ok
      ? await addDirectEvent(o, 'pos_injected', `Created in Clover (${pos.posOrderId})${pos.printed ? ` — ${pos.printed}` : ''}`, undefined, { posOrderId: pos.posOrderId, posError: undefined })
      : await addDirectEvent(o, pos.skipped ? 'pos_skipped' : 'pos_failed', pos.error, undefined, { posError: pos.skipped ? undefined : pos.error });
  }
  // 3) In the kitchen (Clover refused → 'new' with the "Send to Clover" button, like every direct order); ready time from now.
  const prep = await prepFor(o.locationCode);
  const wanted = o.wantedAt ? Date.parse(o.wantedAt) : NaN;
  const readyMs = Number.isFinite(wanted) && wanted > now + prep.minutes * 60_000 ? wanted - (o.fulfillment === 'delivery' ? 20 : 0) * 60_000 : now + prep.minutes * 60_000;
  const rule = ruleFor(await getDeliverySettings(), o.locationCode);
  const needCourier = o.fulfillment === 'delivery' && !rule.autoDispatch;
  const late = (o.interac!.lateTransfers ?? []).map((l) => (!l.releasedAt && !l.refundedAt ? { ...l, releasedAt: iso(now), releasedBy: actor.name } : l));
  o = await addDirectEvent(o, 'interac_released', `Released to the kitchen${how === 'late' ? ' by a person, after the cancel' : ''}${o.posError ? ' — Clover refused the order (send it again)' : ''}`, actor.name, {
    status: o.posError || !o.posOrderId ? 'new' : 'in_kitchen', readyAt: iso(readyMs),
    attention: needCourier ? 'Virement reçu — appelez un livreur (envoi automatique éteint pour cette cuisine).' : undefined,
    interac: { ...o.interac!, releasedAt: iso(now), releaseClaim: undefined, releaseClaimAt: undefined, ...(late.length ? { lateTransfers: late } : {}) },
  });
  // 4) The customer.
  if (o.customer.phone) {
    const sms = await textCustomer(o, INTERAC_SMS.received(o, await pickupAddress(o.locationCode), i.lang), 'interac_received');
    o = await addDirectEvent(o, sms.ok ? 'sms_confirmation' : 'sms_failed', sms.ok ? 'Transfer confirmation texted' : `Transfer confirmation not texted: ${sms.message}`, SYSTEM);
  }
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'interac_received', status: 'success', brandName: o.brandName, locationCode: o.locationCode,
    summary: `${o.number} Interac e-Transfer ${i.reference} received (${amount} $) confirmed by ${actor.name}${how === 'late' ? ' after the cancel' : ''} — ${o.fulfillment === 'delivery' ? 'courier next' : 'kitchen ticket'}` });
  return { state: 'released', message: 'Transfer received — sent to the kitchen.', order: o };
}

/** "Received" on a cancelled / expired order: flagged once; a person decides. Never printed, never refunded here. */
async function flagLateTransfer(o: DirectOrder, actor: Actor, now: number): Promise<InteracReceivedResult> {
  const i = o.interac!;
  const amount = (i.amount ?? o.total).toFixed(2);
  if ((i.lateTransfers ?? []).some((l) => !l.releasedAt && !l.refundedAt)) return { state: 'late', message: 'Already flagged: a person decides (send to the kitchen anyway, or return the money by hand).', order: o };
  const flag = `Virement Interac ${i.reference} reçu après l’annulation (${amount} $) — une personne décide : envoyer en cuisine quand même, ou retourner l’argent à la main. Food Hub ne rembourse jamais tout seul.`;
  const msg = `Transfer ${i.reference} received after the order was cancelled (${amount} $) — a person decides: send it to the kitchen anyway, or return the money by hand (not printed).`;
  const next = await addDirectEvent(o, 'interac_late', msg, actor.name, { attention: flag, interac: { ...i, lateTransfers: [...(i.lateTransfers ?? []), { at: iso(now), by: actor.name }] } });
  await postToChat({ title: `💸 ${o.number}: Interac transfer after the cancel — a person decides`, text: msg, severity: 'warning' }, { purpose: 'interac_late', orderId: o.id }).catch(() => undefined);
  return { state: 'late', message: msg, order: next };
}

/** The late transfer is accepted: a person sends the cancelled order to the kitchen after all (release, once). */
export async function releaseLateInterac(orderId: string, actor: Actor, now = Date.now()): Promise<DirectOrder> {
  return withOrderLock(orderId, async () => {
    let o = await getDirectOrder(orderId);
    if (!o?.interac) throw new Error('This order is not paid by Interac e-Transfer.');
    if (o.interac.releasedAt) throw new Error('This order was already sent to the kitchen.');
    if (o.status !== 'cancelled') throw new Error('Only a cancelled order with a late transfer can be sent to the kitchen this way.');
    if (!(o.interac.lateTransfers ?? []).some((l) => !l.releasedAt && !l.refundedAt)) throw new Error('No late transfer is flagged on this order.');
    if (claimFresh(o.interac, now)) throw new Error('Another request is releasing it.');
    const claim = crypto.randomUUID();
    await saveDirectOrder({ ...o, interac: { ...o.interac, releaseClaim: claim, releaseClaimAt: iso(now) } });
    o = (await getDirectOrder(orderId))!;
    if (o.interac?.releaseClaim !== claim) throw new Error('Another request is releasing it.');
    return (await releaseInteracOrder(o, actor, now, 'late')).order;
  });
}

/** The late transfer was returned to the customer by hand (in the bank app): noted, the flag is cleared. */
export async function markLateInteracRefunded(orderId: string, actor: Actor, now = Date.now()): Promise<DirectOrder> {
  return withOrderLock(orderId, async () => {
    const o = await getDirectOrder(orderId);
    if (!o?.interac) throw new Error('This order is not paid by Interac e-Transfer.');
    const late = o.interac.lateTransfers ?? [];
    if (!late.some((l) => !l.releasedAt && !l.refundedAt)) throw new Error('No late transfer is flagged on this order.');
    const next = await addDirectEvent(o, 'interac_refunded', `Late transfer ${o.interac.reference} returned to the customer by hand (noted by ${actor.name})`, actor.name, {
      attention: undefined, interac: { ...o.interac, lateTransfers: late.map((l) => (!l.releasedAt && !l.refundedAt ? { ...l, refundedAt: iso(now), refundedBy: actor.name } : l)) },
    });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'interac_refunded', status: 'success', brandName: o.brandName, locationCode: o.locationCode, summary: `${o.number}: late Interac transfer ${o.interac.reference} returned by hand (noted by ${actor.name})` });
    return next;
  });
}

/** True when a cancelled order holds a late transfer nobody has dealt with yet. */
export function interacLatePending(o: Pick<DirectOrder, 'interac'>): boolean {
  return (o.interac?.lateTransfers ?? []).some((l) => !l.releasedAt && !l.refundedAt);
}

// ---------------------------------------------------------------------------------------------------------------
// Staff actions, expiry

/** Cancels a held Interac order (expired, or a person): the customer is told a transfer already sent is returned by a person. */
export async function cancelHeldInterac(orderId: string, reason: string, by = SYSTEM, opts: { expired?: boolean; text?: boolean } = {}): Promise<DirectOrder> {
  const r = await withOrderLock(orderId, async () => {
    const o = await getDirectOrder(orderId);
    if (!o) throw new Error('Order not found.');
    // A release that just finished (or is running) wins: a received order is never cancelled here.
    if (o.status !== 'awaiting_payment' || !o.interac || claimFresh(o.interac)) return { o, done: false };
    return { o: await addDirectEvent(o, 'cancelled', reason, by, { status: 'cancelled', attention: undefined, interac: { ...o.interac, cancelledAt: new Date().toISOString(), cancelReason: reason } }), done: true };
  });
  if (!r.done) return r.o;
  let next = r.o;
  if (opts.text !== false && next.interac) {
    const sms = await textCustomer(next, opts.expired ? INTERAC_SMS.expired(next, next.interac.lang) : INTERAC_SMS.cancelled(next, next.interac.lang), 'interac_cancelled');
    next = await addDirectEvent(next, sms.ok ? 'sms_cancelled' : 'sms_failed', sms.ok ? 'Customer told: cancelled; a transfer already sent is returned by a person' : `Cancel text not sent: ${sms.message}`, SYSTEM);
  }
  return next;
}

/** Pickup only: the customer pays at the counter instead. The transfer is not expected any more; the order goes to Clover and the kitchen now. */
export async function interacPayAtCounter(orderId: string, actor: Actor): Promise<DirectOrder> {
  const converted = await withOrderLock(orderId, async () => {
    const cur = await getDirectOrder(orderId);
    if (!cur?.interac || cur.status !== 'awaiting_payment') throw new Error('This order is not waiting for an Interac e-Transfer.');
    if (cur.fulfillment !== 'pickup') throw new Error('A delivery is paid before the courier leaves: text the instructions again, or cancel.');
    if (claimFresh(cur.interac)) return null;
    return addDirectEvent(cur, 'pay_at_counter', 'The customer pays at the counter (Interac e-Transfer no longer expected)', actor.name, {
      status: 'new', payment: 'pay_at_pickup', interac: { ...cur.interac, cancelledAt: new Date().toISOString(), cancelReason: 'pay at the counter' },
    });
  });
  if (!converted) return (await getDirectOrder(orderId))!;
  let next = converted;
  const pos = await createDirectOrderInClover(next);
  next = pos.ok
    ? await addDirectEvent(next, 'pos_injected', `Created in Clover (${pos.posOrderId})${pos.printed ? ` — ${pos.printed}` : ''}`, undefined, { posOrderId: pos.posOrderId, posError: undefined, status: 'in_kitchen' })
    : await addDirectEvent(next, pos.skipped ? 'pos_skipped' : 'pos_failed', pos.error, undefined, { posError: pos.skipped ? undefined : pos.error });
  if (next.customer.phone) await confirmToCustomer(next);
  return (await getDirectOrder(next.id)) ?? next;
}

/** Background (expansion tick, with own delivery on): the one reminder, then the expiry of held Interac orders. */
export async function tickInterac(now = Date.now()): Promise<{ checked: number; cancelled: number; reminded: number }> {
  const out = { checked: 0, cancelled: 0, reminded: 0 };
  const held = (await listDirectOrders({ since: iso(now - 2 * 86400_000), limit: 1000 })).filter((o) => o.status === 'awaiting_payment' && o.interac);
  for (const o of held) {
    try {
      out.checked++;
      const i = o.interac!;
      if (now >= Date.parse(i.expiresAt)) {
        await cancelHeldInterac(o.id, 'Interac e-Transfer not confirmed in time — cancelled', SYSTEM, { expired: true });
        out.cancelled++;
        continue;
      }
      if (i.reminderMin > 0 && !i.remindedAt && now >= Date.parse(i.createdAt) + i.reminderMin * 60_000) {
        const left = Math.max(1, Math.round((Date.parse(i.expiresAt) - now) / 60_000));
        const sms = await textCustomer(o, INTERAC_SMS.reminder(o, i, left, i.lang), 'interac_reminder');
        await withOrderLock(o.id, async () => {
          const cur = await getDirectOrder(o.id);
          if (cur?.interac && cur.status === 'awaiting_payment') await addDirectEvent(cur, sms.ok ? 'interac_reminder' : 'sms_failed', sms.ok ? 'Interac reminder texted' : `Reminder not texted: ${sms.message}`, SYSTEM, { interac: { ...cur.interac, remindedAt: iso(now) } });
        });
        if (sms.ok) out.reminded++;
      }
    } catch (e) {
      console.error('[foodhub] interac tick', o.number, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
