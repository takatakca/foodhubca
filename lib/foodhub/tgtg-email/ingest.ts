// One Too Good To Go e-mail → Food Hub. Same pipeline as every platform order (lib/foodhub/pipeline.ts):
//   reservation  → order on the "tgtg" channel: kitchen screen, Clover (order type "Too Good To Go", kitchen ticket with
//                  the customer, the bags, the pickup window and the TGTG code), paid with the "Too Good To Go" tender
//                  when it leaves the kitchen (picked up / completed), exactly like the other platforms;
//   cancellation → the order is cancelled; its Clover copy is FLAGGED "CANCELLED" (never deleted — TGTG e-mail orders
//                  keep their Clover record), or the cancel waits for the order if the reservation e-mail is late.
// Idempotent twice over: the e-mail (Message-ID) is read once, and the order id is the TGTG code — a second e-mail for
// the same reservation (IMAP + forwarding webhook, a resend) never creates or prints a second ticket.
// Anything that cannot be read with confidence goes to the attention list (Settings → Platforms), never dropped.
import { logActivity, type Actor } from '../activity';
import { round2 } from '../config';
import { applyExternalStatus, processIncomingOrder, resendToClover } from '../pipeline';
import { getRepo } from '../repo';
import type { NormalizedOrder } from '../types';
import { ORDER_ID_PREFIX, isTgtgEmailOrder, tgtgMailOrderId } from './ids';
import { parseTgtgMail, senderAllowed, type TgtgMail, type TgtgMailParse } from './parse';
import {
  findMapping, getMailRecord, getTgtgEmailSettings, listMailRecords, mailId, saveMailRecord, storeKey, tgtgEmailStoreId,
  type MailStatus, type TgtgMailRecord, type TgtgStoreMapping,
} from './settings';

export { ORDER_ID_PREFIX, isTgtgEmailOrder, tgtgMailOrderId };
const ACTOR = 'Too Good To Go (e-mail)';

/** Minutes after the end of the pickup window during which a reservation still goes to the kitchen. */
function lateGraceMin(): number {
  const v = Number(process.env.TGTG_EMAIL_LATE_GRACE_MIN);
  return Number.isFinite(v) && v >= 0 ? v : 15;
}

export interface IngestResult {
  id: string;
  status: MailStatus;
  reason?: string;
  orderId?: string | null;
  code?: string;
}

/** The Food Hub order a reservation becomes. Pure. */
export function buildTgtgMailOrder(p: TgtgMailParse, mail: Pick<TgtgMail, 'messageId' | 'date'>, mapping: TgtgStoreMapping | null, now = Date.now()): NormalizedOrder {
  const code = p.code!;
  const qty = Math.max(1, p.quantity ?? 1);
  const price = p.pricePaid ?? 0;
  const who = (p.firstName ?? (p.lang === 'fr' ? 'Client' : 'Customer')).toUpperCase();
  const window = p.pickupLabel ?? (p.lang === 'fr' ? 'voir l’app TGTG' : 'see the TGTG app');
  const bags = `${qty} ${qty > 1 ? 'SACS / BAGS' : 'SAC / BAG'}`;
  return {
    channel: 'tgtg',
    marketplace: 'tgtg',
    externalOrderId: tgtgMailOrderId(code),
    displayId: code,
    channelStoreId: tgtgEmailStoreId(p.storeName ?? 'unknown'),
    brandName: mapping?.brandName,
    customerName: p.firstName,
    fulfillment: 'pickup',
    placedAt: mail.date && Number.isFinite(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : new Date(now).toISOString(),
    // The pickup window opens: the kitchen ticket prints at (opening − prep time) when it is far enough ahead.
    readyBy: p.pickupStart,
    currency: 'CAD',
    // What the customer paid in the TGTG app, taxes included (like the daily bag log).
    subtotal: round2(price), tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: round2(price),
    // Big and clear on the Clover ticket and the kitchen screen: who, how many bags, when, which code.
    notes: `TGTG ${code} | ${who} | ${bags} | RAMASSAGE / PICKUP ${window}`,
    lines: [{
      name: (p.bagName || 'Surprise Bag').slice(0, 80),
      quantity: qty,
      unitPrice: round2(price / qty),
      total: round2(price),
      // Clover prints one line per bag: each line carries the label to stick on that bag.
      notes: `${who} · ${window} · ${code}`,
      modifiers: [],
    }],
    raw: {
      source: 'tgtg_email',
      tgtg: {
        code, firstName: p.firstName ?? null, quantity: qty, bagName: p.bagName ?? null, pricePaid: p.pricePaid ?? null,
        pickupStart: p.pickupStart ?? null, pickupEnd: p.pickupEnd ?? null, pickupLabel: p.pickupLabel ?? null,
        storeName: p.storeName ?? null, messageId: mail.messageId ?? null, warnings: p.warnings,
      },
    },
  };
}

function inFlight(): Set<string> {
  const g = globalThis as unknown as { __foodhubTgtgMail?: Set<string> };
  return (g.__foodhubTgtgMail ??= new Set<string>());
}

/**
 * Reads one e-mail and does what it says. Never throws for a bad e-mail (it is kept with its reason); a database failure
 * does throw, so the caller (IMAP poller, webhook) leaves the e-mail to be read again.
 * opts.retry = a person asked to read again an e-mail kept in the attention list (after a mapping or a reader fix).
 */
export async function ingestTgtgMail(mail: TgtgMail, source: 'imap' | 'webhook', opts: { now?: number; retry?: boolean } = {}): Promise<IngestResult> {
  const now = opts.now ?? Date.now();
  const id = mailId(mail);
  const previous = await getMailRecord(id);
  if (previous && !(opts.retry && ['attention', 'too_late', 'error'].includes(previous.status))) {
    return { id, status: 'duplicate', reason: `already read (${previous.status})`, orderId: previous.orderId ?? null, code: previous.parse?.code };
  }
  const base: Omit<TgtgMailRecord, 'status'> = {
    id, source: opts.retry ? 'retry' : source, receivedAt: previous?.receivedAt ?? new Date(now).toISOString(), messageId: mail.messageId, from: mail.from, subject: String(mail.subject ?? '').slice(0, 300), date: mail.date,
    mail: { from: mail.from, senders: mail.senders, subject: mail.subject, text: mail.text, html: mail.html, messageId: mail.messageId, date: mail.date },
  };
  const keep = async (status: MailStatus, extra: Partial<TgtgMailRecord> = {}): Promise<IngestResult> => {
    const rec: TgtgMailRecord = { ...base, ...extra, status };
    await saveMailRecord(rec);
    return { id, status, reason: rec.reason, orderId: rec.orderId ?? null, code: rec.parse?.code };
  };

  if (!senderAllowed(mail)) {
    // Not from Too Good To Go: nothing of it is kept but the sender and subject.
    return keep('ignored', { reason: 'sender not allowed (TGTG_EMAIL_FROM_ALLOW)', mail: { from: mail.from, subject: mail.subject } });
  }

  const parse = parseTgtgMail(mail, { now });
  if (parse.kind === 'unknown') {
    const notOrder = parse.problems.includes('not an order e-mail');
    return keep(notOrder ? 'ignored' : 'attention', { parse, reason: parse.problems.join('; '), ...(notOrder ? { mail: { from: mail.from, subject: mail.subject } } : {}) });
  }
  if (parse.problems.length) {
    const rec = await keep('attention', { parse, reason: parse.problems.join('; ') });
    await logActivity({ actor: ACTOR, source: 'platform', kind: 'order', action: 'tgtg_email_attention', status: 'failed', channel: 'tgtg',
      summary: `Too Good To Go e-mail "${base.subject}" could not be read (${rec.reason}) — Settings → Platforms → Too Good To Go e-mails` });
    return rec;
  }

  const code = parse.code!;
  const extId = tgtgMailOrderId(code);
  const lock = `${parse.kind}:${code}`;
  if (inFlight().has(lock)) return { id, status: 'duplicate', reason: 'the same reservation is being handled right now', code };
  inFlight().add(lock);
  try {
    const repo = getRepo();
    if (parse.kind === 'cancel') {
      const order = await repo.findOrder('tgtg', extId);
      if (order?.status === 'cancelled') return keep('duplicate', { parse, orderId: order.id, reason: 'already cancelled' });
      const who = parse.firstName ? ` (${parse.firstName})` : '';
      const updated = await applyExternalStatus('tgtg', extId, 'cancelled', { reason: `Cancelled by the customer${who} — Too Good To Go e-mail`, event: 'customer_cancel', source: 'tgtg_email', code });
      if (!updated) {
        // The reservation e-mail is not here yet: the cancel waits for it (the order is then cancelled on arrival).
        return keep('cancel_pending', { parse, reason: 'reservation not received yet — it will be cancelled on arrival' });
      }
      return keep('cancel_applied', { parse, orderId: updated.id, brandName: updated.brandName, locationCode: updated.locationCode });
    }

    // A reservation.
    const existing = await repo.findOrder('tgtg', extId);
    if (existing) return keep('duplicate', { parse, orderId: existing.id, brandName: existing.brandName, locationCode: existing.locationCode, reason: 'same TGTG code already received' });
    const endMs = Date.parse(parse.pickupEnd ?? '') || (Date.parse(parse.pickupStart ?? '') + 2 * 3600_000);
    if (Number.isFinite(endMs) && endMs + lateGraceMin() * 60_000 < now) {
      const rec = await keep('too_late', { parse, reason: `read after the pickup window (${parse.pickupLabel ?? '—'}) — not sent to the kitchen; check the TGTG app` });
      await logActivity({ actor: ACTOR, source: 'platform', kind: 'order', action: 'tgtg_email_too_late', status: 'failed', channel: 'tgtg',
        summary: `Too Good To Go ${code}: e-mail read after its pickup window (${parse.pickupLabel ?? '—'}) — not sent to the kitchen` });
      return rec;
    }
    const mapping = findMapping(await getTgtgEmailSettings(), parse.storeName);
    const out = await processIncomingOrder(buildTgtgMailOrder(parse, mail, mapping, now));
    const order = out.order;
    await repo.addEvent(order.id, 'tgtg_email', { message: `Read from a Too Good To Go e-mail (${source})${parse.warnings.length ? ` — ${parse.warnings.join('; ')}` : ''}`, code, subject: base.subject });
    if (out.duplicate) return keep('duplicate', { parse, orderId: order.id, reason: 'same TGTG code already received' });
    await logActivity({ actor: ACTOR, source: 'platform', kind: 'order', action: 'tgtg_email_order', status: out.pos?.ok || out.pos?.skipped ? 'success' : 'failed', channel: 'tgtg', brandName: order.brandName, locationCode: order.locationCode, orderId: order.id,
      summary: `Too Good To Go ${code}: ${parse.quantity ?? 1} bag(s) for ${parse.firstName ?? 'a customer'}, pickup ${parse.pickupLabel ?? '—'}${mapping ? '' : ` — store "${parse.storeName}" not mapped`}${out.pos?.ok ? ', in Clover' : out.pos?.error ? `, Clover: ${out.pos.error}` : ''}` });
    if (!mapping) {
      return keep('attention', { parse, orderId: order.id, reason: `store "${parse.storeName}" is not mapped to a brand and kitchen — map it here; the order waits on the Command Center` });
    }
    return keep('order_created', { parse, orderId: order.id, brandName: order.brandName, locationCode: order.locationCode });
  } finally {
    inFlight().delete(lock);
  }
}

/** Reads again an e-mail kept in the attention list (after a mapping or a reader fix). */
export async function retryTgtgMail(id: string, actor: Actor): Promise<IngestResult> {
  const rec = await getMailRecord(id);
  if (!rec) throw new Error('E-mail not found.');
  if (rec.orderId) {
    // The order exists (store was not mapped): link it to its kitchen now and send it to Clover if it is still waiting.
    const r = await finishUnmappedOrder(rec);
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'tgtg_email_retry', status: r.status === 'order_created' ? 'success' : 'failed', channel: 'tgtg', summary: `Too Good To Go e-mail ${rec.parse?.code ?? id}: ${r.reason ?? r.status}` });
    return r;
  }
  const r = await ingestTgtgMail({ ...rec.mail, from: rec.mail.from, subject: rec.mail.subject } as TgtgMail, rec.source === 'webhook' ? 'webhook' : 'imap', { retry: true });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'tgtg_email_retry', status: r.status === 'attention' || r.status === 'error' ? 'failed' : 'success', channel: 'tgtg', summary: `Too Good To Go e-mail read again: ${r.status}${r.reason ? ` (${r.reason})` : ''}` });
  return r;
}

async function finishUnmappedOrder(rec: TgtgMailRecord): Promise<IngestResult> {
  const repo = getRepo();
  const order = rec.orderId ? await repo.getOrder(rec.orderId) : null;
  if (!order) return { id: rec.id, status: rec.status, reason: 'order not found' };
  const mapping = findMapping(await getTgtgEmailSettings(), rec.parse?.storeName);
  if (!mapping) return { id: rec.id, status: 'attention', reason: `store "${rec.parse?.storeName ?? '?'}" is still not mapped`, orderId: order.id };
  let current = order;
  if (!current.locationCode) current = (await repo.updateOrder(order.id, { locationCode: mapping.locationCode, brandName: mapping.brandName })) ?? current;
  let reason = 'linked to its kitchen';
  if (!current.posOrderId && ['new', 'accepted'].includes(current.status)) {
    const sent = await resendToClover(current, { by: 'Too Good To Go e-mail mapping' });
    reason = sent.pos.ok ? `in Clover (${sent.pos.posOrderId})` : `Clover: ${sent.pos.error}`;
  }
  const next: TgtgMailRecord = { ...rec, status: 'order_created', reason, brandName: mapping.brandName, locationCode: mapping.locationCode };
  await saveMailRecord(next);
  return { id: rec.id, status: 'order_created', reason, orderId: order.id, code: rec.parse?.code };
}

/** After a store mapping is saved: orders that waited for it are linked to their kitchen (and sent to Clover). */
export async function resolveWaitingForStore(storeName: string): Promise<number> {
  const k = storeKey(storeName);
  let n = 0;
  for (const rec of await listMailRecords(200)) {
    if (rec.status !== 'attention' || !rec.orderId || rec.dismissedAt || storeKey(rec.parse?.storeName ?? '') !== k) continue;
    const r = await finishUnmappedOrder(rec);
    if (r.status === 'order_created') n++;
  }
  return n;
}

