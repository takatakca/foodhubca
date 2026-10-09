// Direct orders: taking an order ourselves (phone agent, a person, our website, a Clover "Delivery" order), sending it
// to Clover, confirming it to the customer, and moving it along (ready, picked up, completed, cancelled, paid).
// Money rule (locked): nothing here refunds, discounts or settles money. Cancelling a direct order only stops the
// courier and marks it cancelled in Food Hub; a payment already taken is refunded by a person in Clover.
import { logActivity, type Actor } from '../activity';
import { getCatalog } from '../catalog';
import { nowIso, round2 } from '../config';
import { sendSms } from '../notify';
import { prepFor } from '../prep';
import { localTimeLabel } from '../time';
import { cloverOnlineBlockedReason } from '../pos/clover-website-orders';
import { createDirectOrderInClover } from './clover-direct';
import { addDirectEvent, getDirectOrder, newId, nextOrderNumber, saveDirectOrder } from './store';
import type { DirectLine, DirectOrder, DirectSource, DropoffAddress, PaymentState } from './types';

/** Québec sales taxes on prepared food: GST 5 % + QST 9.975 %. */
export const QC_TAX_RATE = 0.14975;

export function totalsFor(lines: DirectLine[], deliveryFee: number, tip: number, taxable = true) {
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const tax = taxable ? round2((subtotal + deliveryFee) * QC_TAX_RATE) : 0;
  return { subtotal, tax, total: round2(subtotal + deliveryFee + tax + tip) };
}

export function lineTotal(unitPrice: number, quantity: number, modifiers: DirectLine['modifiers']): number {
  return round2((unitPrice + modifiers.reduce((s, m) => s + m.unitPrice * (m.quantity || 1), 0)) * quantity);
}

export interface NewDirectOrder {
  source: DirectSource;
  sourceRef?: string;
  brandName: string;
  locationCode: string;
  customer: DirectOrder['customer'];
  fulfillment: 'pickup' | 'delivery';
  dropoff?: DropoffAddress;
  lines: DirectLine[];
  notes?: string;
  payment: PaymentState;
  tip?: number;
  deliveryFee?: number;
  /** Customer wants it at (scheduled). */
  wantedAt?: string;
  /** Amounts from the source when it computed them itself (a Clover order): kept as they are. */
  totals?: { subtotal: number; tax: number; total: number };
  /** Already in Clover (a Clover order read back): never sent again. */
  posOrderId?: string;
  /** Text the customer a confirmation. */
  confirmBySms?: boolean;
  attention?: string;
}

export async function createDirectOrder(input: NewDirectOrder, actor: Actor): Promise<DirectOrder> {
  if (!input.lines.length) throw new Error('An order needs at least one item.');
  const catalog = await getCatalog();
  if (!catalog.locations.some((l) => l.code === input.locationCode)) throw new Error(`Unknown location ${input.locationCode}.`);
  const deliveryFee = input.fulfillment === 'delivery' ? round2(input.deliveryFee ?? 0) : 0;
  const tip = round2(Math.max(0, input.tip ?? 0));
  const totals = input.totals ? { subtotal: round2(input.totals.subtotal), tax: round2(input.totals.tax), total: round2(input.totals.total) } : totalsFor(input.lines, deliveryFee, tip);
  const prep = await prepFor(input.locationCode);
  const now = Date.now();
  // A scheduled delivery leaves the kitchen about 20 minutes before the time the customer asked for.
  const wanted = input.wantedAt ? Date.parse(input.wantedAt) : NaN;
  const readyMs = Number.isFinite(wanted) && wanted > now + prep.minutes * 60_000
    ? wanted - (input.fulfillment === 'delivery' ? 20 : 0) * 60_000
    : now + prep.minutes * 60_000;
  const at = nowIso();
  let order: DirectOrder = {
    id: newId('dir'),
    number: await nextOrderNumber(input.source),
    source: input.source,
    sourceRef: input.sourceRef,
    brandName: input.brandName,
    locationCode: input.locationCode,
    customer: input.customer,
    fulfillment: input.fulfillment,
    dropoff: input.fulfillment === 'delivery' ? input.dropoff : undefined,
    lines: input.lines,
    ...totals,
    deliveryFee,
    tip,
    currency: process.env.FOODHUB_CURRENCY || 'CAD',
    payment: input.payment,
    status: 'new',
    notes: input.notes,
    containsAlcohol: input.lines.some((l) => l.alcohol),
    placedAt: at,
    readyAt: new Date(readyMs).toISOString(),
    ...(input.wantedAt ? { wantedAt: input.wantedAt } : {}),
    ...(input.posOrderId ? { posOrderId: input.posOrderId } : {}),
    ...(input.attention ? { attention: input.attention } : {}),
    events: [{ at, type: 'received', message: `${SOURCE_LABEL[input.source]} — ${input.fulfillment === 'delivery' ? 'delivery' : 'pickup'}, ${totals.total.toFixed(2)} $`, by: actor.name }],
    createdAt: at,
    updatedAt: at,
  };
  order = await saveDirectOrder(order);

  // Kitchen ticket + register: Clover (a Clover order read back is already there).
  if (!order.posOrderId) {
    const pos = await createDirectOrderInClover(order);
    order = pos.ok
      ? await addDirectEvent(order, 'pos_injected', `Created in Clover (${pos.posOrderId})${pos.printed ? ` — ${pos.printed}` : ''}`, undefined, { posOrderId: pos.posOrderId, posError: undefined, status: 'in_kitchen' })
      : await addDirectEvent(order, pos.skipped ? 'pos_skipped' : 'pos_failed', pos.error, undefined, { posError: pos.skipped ? undefined : pos.error });
  } else {
    order = await addDirectEvent(order, 'pos_injected', `Already in Clover (${order.posOrderId})`, undefined, { status: 'in_kitchen' });
  }

  if (input.confirmBySms && order.customer.phone) await confirmToCustomer(order);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: 'direct_order', status: order.posError ? 'failed' : 'success', brandName: order.brandName, locationCode: order.locationCode,
    summary: `${SOURCE_LABEL[order.source]} order ${order.number} (${order.brandName}) — ${order.fulfillment}, ${order.total.toFixed(2)} $${order.posError ? ` — Clover: ${order.posError}` : ''}` });
  return order;
}

export const SOURCE_LABEL: Record<DirectSource, string> = { phone: 'Phone', phone_ai: 'AI phone', clover: 'Clover', website: 'Website', manual: 'Manual', clover_online: 'Website / Clover Online' };

const money = (n: number, lang: 'fr' | 'en') => (lang === 'fr' ? `${n.toFixed(2).replace('.', ',')} $` : `$${n.toFixed(2)}`);

export function confirmationText(o: DirectOrder): string {
  const lang = o.customer.lang ?? 'fr';
  const when = o.readyAt ? localTimeLabel(o.readyAt) : '';
  if (lang === 'en') {
    return `${o.brandName}: order ${o.number} received — total ${money(o.total, 'en')}. ${o.fulfillment === 'delivery' ? `Delivery planned around ${o.wantedAt ? localTimeLabel(o.wantedAt) : 'the next 45 min'}.` : `Ready for pickup around ${when}.`}${o.payment === 'paid' ? '' : o.fulfillment === 'pickup' ? ' Pay at the counter.' : ' We will call you to take the payment before the courier leaves.'}${o.containsAlcohol ? ' Alcohol: photo ID (18+) required.' : ''}`;
  }
  return `${o.brandName} : commande ${o.number} reçue — total ${money(o.total, 'fr')}. ${o.fulfillment === 'delivery' ? `Livraison prévue vers ${o.wantedAt ? localTimeLabel(o.wantedAt) : 'les 45 prochaines minutes'}.` : `Prête pour emporter vers ${when}.`}${o.payment === 'paid' ? '' : o.fulfillment === 'pickup' ? ' Paiement au comptoir.' : ' Nous vous rappelons pour le paiement avant le départ du livreur.'}${o.containsAlcohol ? ' Alcool : pièce d’identité avec photo (18+) exigée.' : ''}`;
}

export async function confirmToCustomer(order: DirectOrder): Promise<void> {
  const r = await sendSms({ to: order.customer.phone!, body: confirmationText(order) }, { purpose: 'direct_order_confirmation', by: 'Food Hub' });
  await addDirectEvent(order, r.ok ? 'sms_confirmation' : 'sms_failed', r.ok ? 'Confirmation texted to the customer' : `Confirmation not texted: ${r.message}`);
}

export type DirectAction = 'ready' | 'picked_up' | 'complete' | 'cancel' | 'mark_paid' | 'retry_clover' | 'clear_attention';

/** Moves a direct order along. Courier side effects (cancel the courier) are in dispatch.ts. */
export async function runDirectAction(orderId: string, action: DirectAction, actor: Actor, opts: { reason?: string } = {}): Promise<DirectOrder> {
  const order = await getDirectOrder(orderId);
  if (!order) throw new Error('Order not found.');
  // Clover online orders: Clover is the source of truth. Only the kitchen screen's own steps are allowed here.
  const blocked = cloverOnlineBlockedReason(order, action);
  if (blocked) throw new Error(blocked);
  const closed = order.status === 'completed' || order.status === 'cancelled';
  if (closed && action !== 'clear_attention') throw new Error(`Order ${order.number} is already ${order.status}.`);
  let next: DirectOrder;
  switch (action) {
    case 'ready':
      next = await addDirectEvent(order, 'ready', 'Ready', actor.name, { status: order.status === 'out_for_delivery' ? order.status : 'ready' });
      break;
    case 'picked_up':
      if (order.fulfillment !== 'pickup') throw new Error('A delivery order is picked up by the courier.');
      next = await addDirectEvent(order, 'picked_up', 'Picked up by the customer', actor.name, { status: 'completed' });
      break;
    case 'complete':
      next = await addDirectEvent(order, 'completed', 'Completed', actor.name, { status: 'completed', attention: undefined });
      break;
    case 'cancel':
      next = await addDirectEvent(order, 'cancelled', `Cancelled${opts.reason ? ` — ${opts.reason}` : ''}${order.payment === 'paid' ? ' (already paid: refund it in Clover if needed)' : ''}`, actor.name, { status: 'cancelled', attention: undefined });
      break;
    case 'mark_paid':
      next = await addDirectEvent(order, 'paid', 'Payment taken', actor.name, { payment: 'paid', attention: order.attention && /pay|paie/i.test(order.attention) ? undefined : order.attention });
      break;
    case 'retry_clover': {
      if (order.posOrderId) throw new Error('This order is already in Clover.');
      const pos = await createDirectOrderInClover(order);
      next = pos.ok
        ? await addDirectEvent(order, 'pos_injected', `Created in Clover (${pos.posOrderId})`, actor.name, { posOrderId: pos.posOrderId, posError: undefined, status: order.status === 'new' ? 'in_kitchen' : order.status })
        : await addDirectEvent(order, 'pos_failed', pos.error, actor.name, { posError: pos.error });
      break;
    }
    case 'clear_attention':
      next = await addDirectEvent(order, 'attention_cleared', 'Checked by a person', actor.name, { attention: undefined });
      break;
  }
  await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: `direct_${action}`, status: 'success', brandName: order.brandName, locationCode: order.locationCode,
    summary: `${order.number} (${order.brandName}): ${action.replace('_', ' ')}${opts.reason ? ` — ${opts.reason}` : ''}` });
  return next;
}

/** Fix the delivery address or the customer's contact on an order (an address missing from Clover, a typo on the phone). */
export async function updateDirectOrder(orderId: string, patch: { dropoff?: DropoffAddress; customer?: Partial<DirectOrder['customer']>; notes?: string }, actor: Actor): Promise<DirectOrder> {
  const order = await getDirectOrder(orderId);
  if (!order) throw new Error('Order not found.');
  if (order.status === 'completed' || order.status === 'cancelled') throw new Error(`Order ${order.number} is already ${order.status}.`);
  const customer = patch.customer ? { ...order.customer, ...Object.fromEntries(Object.entries(patch.customer).filter(([, v]) => v !== undefined && v !== '')) } : order.customer;
  const changed = [patch.dropoff ? 'address' : '', patch.customer ? 'customer' : '', patch.notes !== undefined ? 'notes' : ''].filter(Boolean).join(', ');
  return addDirectEvent(order, 'updated', `Updated: ${changed}`, actor.name, {
    ...(patch.dropoff ? { dropoff: patch.dropoff } : {}), customer, ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    // Fixing what was missing clears the flag; the next dispatch check says if anything else is wrong.
    attention: undefined, autoDispatch: undefined,
  });
}
