// Our own orders (phone, website, typed in) → Clover, so the kitchen gets the ticket and the register has the sale.
// Same atomic-order call as platform orders, but titled with our order number ("📞 IA-1043 · Po Poulet"), left OPEN
// (the customer pays at the counter, or the payment was taken separately) and given a "Phone" / "Delivery" order type
// only when the merchant already has one — Food Hub never creates order types for direct orders.
//   - Options linked to Clover (a Clover modifier id on the menu option, e.g. Duo / Trio / Combo with the drink) go as
//     real Clover modifications on an inventory item; other options stay in the line price and its note.
//   - The ticket prints on that kitchen's printer (CLOVER_PRINT_DEVICES "MID|LOCATION"), else the merchant's default.
//   - A kitchen with no Clover register (FOODHUB_CLOVER_NO_REGISTER=HOCHELAGA,...) never gets a Clover order: the order
//     stays on Food Hub's kitchen screen (never printed on another kitchen's register).
import { timedFetch, toCents } from '../config';
import { cloverAutoPrintEnabled, cloverBaseUrl, cloverInjectionEnabled, cloverToken, defaultCloverMerchant } from '../pos/clover';
import { printKitchenTicket } from '../pos/clover-order';
import { getRepo } from '../repo';
import type { DirectOrder } from './types';

const ICON: Record<DirectOrder['source'], string> = { phone: '📞', phone_ai: '📞', clover: '🧾', website: '🌐', manual: '✍️', clover_online: '🌐' };

/** Kitchens without a Clover register (FOODHUB_CLOVER_NO_REGISTER, location codes, comma separated). Unset = none. */
export function kitchenHasNoRegister(locationCode: string): boolean {
  const list = String(process.env.FOODHUB_CLOVER_NO_REGISTER ?? '').split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  return list.includes(String(locationCode ?? '').trim().toUpperCase());
}

/**
 * The Clover merchant for a brand at a location: a mapped store of that brand there, else any store there, else the
 * default. Null for a kitchen without a register.
 */
export async function merchantFor(brandName: string, locationCode: string): Promise<string | null> {
  if (kitchenHasNoRegister(locationCode)) return null;
  const stores = await getRepo().listStores();
  const here = stores.filter((s) => s.locationCode === locationCode && s.cloverMerchantId);
  return here.find((s) => s.brandName === brandName)?.cloverMerchantId ?? here[0]?.cloverMerchantId ?? (await defaultCloverMerchant());
}

/**
 * The kitchen's OWN Clover merchant (a store of that brand there, else any store there) — never the default merchant.
 * A payment link is offered only with it: a Saint-Léonard order must never be paid and printed on the NDG register.
 */
export async function explicitMerchantFor(brandName: string, locationCode: string): Promise<string | null> {
  if (kitchenHasNoRegister(locationCode)) return null;
  const stores = await getRepo().listStores();
  const here = stores.filter((s) => s.locationCode === locationCode && s.cloverMerchantId);
  return here.find((s) => s.brandName === brandName)?.cloverMerchantId ?? here[0]?.cloverMerchantId ?? null;
}

export async function orderTypeId(mid: string, token: string, fulfillment: DirectOrder['fulfillment'], source: DirectOrder['source']): Promise<string | null> {
  try {
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/order_types?limit=200`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const types: Array<{ id: string; label?: string }> = (await res.json())?.elements ?? [];
    const want = fulfillment === 'delivery' ? /livraison|delivery/i : source.startsWith('phone') ? /t[ée]l[ée]phone|phone/i : /emporter|take\s*-?out|pick\s*-?up/i;
    // Never a platform's order type (that would put the sale under DoorDash / Uber in the closeout).
    return types.find((t) => want.test(t.label ?? '') && !/door\s*dash|uber|skip|too good/i.test(t.label ?? ''))?.id ?? null;
  } catch {
    return null;
  }
}

export type CloverDirectResult = { ok: true; posOrderId: string; merchantId: string; printed?: string } | { ok: false; skipped?: boolean; error: string };

type DirectCartOrder = Pick<DirectOrder, 'source' | 'number' | 'brandName' | 'lines' | 'deliveryFee' | 'customer' | 'fulfillment' | 'dropoff' | 'containsAlcohol' | 'payment' | 'notes'> & Partial<Pick<DirectOrder, 'fees' | 'interac'>>;

/**
 * The atomic-order body of a direct order. One Clover line per unit: an inventory item carries its linked options as
 * Clover modifications (each with its own amount; Clover adds them to the line), unlinked options stay in the line
 * price and are listed in the note. `cents` = what the Clover lines add up to (the order's subtotal + delivery fee).
 */
export function buildDirectCloverCart(order: DirectCartOrder, typeId: string | null): { orderCart: Record<string, unknown>; cents: number } {
  const lineItems: Record<string, unknown>[] = [];
  let cents = 0;
  for (const line of order.lines) {
    const linked = Boolean(line.posItemRef);
    const asModification = (m: DirectOrder['lines'][number]['modifiers'][number]) => linked && Boolean(m.posModifierRef);
    const qtyOf = (m: { quantity: number }) => Math.max(1, Math.round(m.quantity || 1));
    const loose = line.modifiers.filter((m) => !asModification(m));
    const modifications = line.modifiers.filter(asModification).flatMap((m) => Array.from({ length: qtyOf(m) }, () => ({ modifier: { id: m.posModifierRef }, name: m.name.slice(0, 127), amount: toCents(m.unitPrice) })));
    const price = toCents(line.unitPrice) + loose.reduce((s, m) => s + toCents(m.unitPrice) * qtyOf(m), 0);
    const note = [...loose.map((m) => `${qtyOf(m) > 1 ? `${qtyOf(m)}x ` : ''}${m.name}`), line.notes ? `Note: ${line.notes}` : '', line.alcohol ? '🔞 ALCOOL — pièce d’identité' : ''].filter(Boolean).join(', ');
    const base: Record<string, unknown> = { name: line.name.slice(0, 127), price, ...(linked ? { item: { id: line.posItemRef } } : {}), ...(note ? { note: note.slice(0, 255) } : {}) };
    for (let i = 0; i < Math.max(1, Math.min(99, Math.round(line.quantity || 1))); i++) {
      lineItems.push(modifications.length ? { ...base, modifications: modifications.map((x) => ({ ...x })) } : { ...base });
      cents += price + modifications.reduce((s, x) => s + x.amount, 0);
    }
  }
  // A delivery fee charged to the customer is a line of its own, so the Clover total matches what we said on the phone.
  if (order.deliveryFee > 0) { lineItems.push({ name: 'Livraison / Delivery', price: toCents(order.deliveryFee) }); cents += toCents(order.deliveryFee); }
  // A declared fee (Interac) is a line of its own too, so the Clover total is the all-in price the customer saw.
  for (const f of order.fees ?? []) if (f.amount > 0) { lineItems.push({ name: f.name.slice(0, 127), price: toCents(f.amount) }); cents += toCents(f.amount); }
  const who = [order.customer.name, order.customer.phone].filter(Boolean).join(' · ');
  const where = order.fulfillment === 'delivery' && order.dropoff ? `LIVRAISON: ${order.dropoff.street}${order.dropoff.unit ? ` #${order.dropoff.unit}` : ''}, ${order.dropoff.postalCode}` : 'POUR EMPORTER / PICKUP';
  const paidHow = order.payment !== 'paid' ? 'À PAYER / TO PAY' : order.interac?.receivedAt ? `PAYÉ — VIREMENT INTERAC ${order.interac.reference} / PAID — INTERAC E-TRANSFER` : 'PAYÉ / PAID';
  return {
    cents,
    orderCart: {
      title: `${ICON[order.source]} ${order.number} · ${order.brandName}`.slice(0, 127),
      note: [where, who, order.containsAlcohol ? '🔞 ID 18+' : '', paidHow, order.notes ?? ''].filter(Boolean).join(' | ').slice(0, 255),
      lineItems,
      ...(typeId ? { orderType: { id: typeId } } : {}),
    },
  };
}

export async function createDirectOrderInClover(order: DirectOrder, opts: { print?: boolean } = {}): Promise<CloverDirectResult> {
  // A Clover online order is already in Clover (Clover printed it and sent it to its KDS): never sent a second time.
  if (order.source === 'clover_online') return { ok: false, skipped: true, error: 'Clover online order: it is already in Clover — never sent again.' };
  if (!cloverInjectionEnabled()) return { ok: false, skipped: true, error: 'Clover injection is turned off (FOODHUB_POS_INJECTION=off).' };
  if (!order.lines.length) return { ok: false, error: 'The order has no items.' };
  if (kitchenHasNoRegister(order.locationCode)) return { ok: false, skipped: true, error: `${order.locationCode} has no Clover register (FOODHUB_CLOVER_NO_REGISTER): the order stays on Food Hub's kitchen screen.` };
  const mid = await merchantFor(order.brandName, order.locationCode);
  if (!mid) return { ok: false, skipped: true, error: 'No Clover merchant for this location — the order stays in Food Hub only.' };
  const token = await cloverToken(mid);
  if (!token) return { ok: false, error: `No Clover API token for merchant ${mid}.` };

  const typeId = await orderTypeId(mid, token, order.fulfillment, order.source);
  const body = { orderCart: buildDirectCloverCart(order, typeId).orderCart };
  try {
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/atomic_order/orders`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Clover returned HTTP ${res.status}: ${text.slice(0, 300)}` };
    const id = text ? JSON.parse(text)?.id : null;
    if (!id) return { ok: false, error: 'Clover response did not include an order id.' };
    let printed: string | undefined;
    if (opts.print !== false && cloverAutoPrintEnabled()) {
      // That kitchen's printer (CLOVER_PRINT_DEVICES "MID|LOCATION"), else the merchant's default.
      const p = await printKitchenTicket(String(id), mid, order.locationCode);
      printed = p.message;
    }
    return { ok: true, posOrderId: String(id), merchantId: mid, printed };
  } catch (e) {
    return { ok: false, error: `Clover network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
