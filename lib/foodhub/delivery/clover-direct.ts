// Our own orders (phone, website, typed in) → Clover, so the kitchen gets the ticket and the register has the sale.
// Same atomic-order call as platform orders, but titled with our order number ("📞 IA-1043 · Po Poulet"), left OPEN
// (the customer pays at the counter, or the payment was taken separately) and given a "Phone" / "Delivery" order type
// only when the merchant already has one — Food Hub never creates order types for direct orders.
import { timedFetch, toCents } from '../config';
import { cloverAutoPrintEnabled, cloverBaseUrl, cloverInjectionEnabled, cloverToken, defaultCloverMerchant, printCloverOrder } from '../pos/clover';
import { getRepo } from '../repo';
import type { DirectOrder } from './types';

const ICON: Record<DirectOrder['source'], string> = { phone: '📞', phone_ai: '📞', clover: '🧾', website: '🌐', manual: '✍️', clover_online: '🌐' };

/** The Clover merchant for a brand at a location: a mapped store of that brand there, else any store there, else the default. */
export async function merchantFor(brandName: string, locationCode: string): Promise<string | null> {
  const stores = await getRepo().listStores();
  const here = stores.filter((s) => s.locationCode === locationCode && s.cloverMerchantId);
  return here.find((s) => s.brandName === brandName)?.cloverMerchantId ?? here[0]?.cloverMerchantId ?? (await defaultCloverMerchant());
}

async function orderTypeId(mid: string, token: string, fulfillment: DirectOrder['fulfillment'], source: DirectOrder['source']): Promise<string | null> {
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

export async function createDirectOrderInClover(order: DirectOrder, opts: { print?: boolean } = {}): Promise<CloverDirectResult> {
  // A Clover online order is already in Clover (Clover printed it and sent it to its KDS): never sent a second time.
  if (order.source === 'clover_online') return { ok: false, skipped: true, error: 'Clover online order: it is already in Clover — never sent again.' };
  if (!cloverInjectionEnabled()) return { ok: false, skipped: true, error: 'Clover injection is turned off (FOODHUB_POS_INJECTION=off).' };
  const mid = await merchantFor(order.brandName, order.locationCode);
  if (!mid) return { ok: false, skipped: true, error: 'No Clover merchant for this location — the order stays in Food Hub only.' };
  const token = await cloverToken(mid);
  if (!token) return { ok: false, error: `No Clover API token for merchant ${mid}.` };

  const lineItems: Record<string, unknown>[] = [];
  for (const line of order.lines) {
    const mods = line.modifiers.reduce((s, m) => s + m.unitPrice * (m.quantity || 1), 0);
    const note = [...line.modifiers.map((m) => `${(m.quantity || 1) > 1 ? `${m.quantity}x ` : ''}${m.name}`), line.notes ? `Note: ${line.notes}` : '', line.alcohol ? '🔞 ALCOOL — pièce d’identité' : ''].filter(Boolean).join(', ');
    const base: Record<string, unknown> = { name: line.name, price: toCents(line.unitPrice + mods), ...(line.posItemRef ? { item: { id: line.posItemRef } } : {}), ...(note ? { note: note.slice(0, 255) } : {}) };
    for (let i = 0; i < Math.max(1, Math.min(99, Math.round(line.quantity || 1))); i++) lineItems.push({ ...base });
  }
  if (!lineItems.length) return { ok: false, error: 'The order has no items.' };
  // A delivery fee charged to the customer is a line of its own, so the Clover total matches what we said on the phone.
  if (order.deliveryFee > 0) lineItems.push({ name: 'Livraison / Delivery', price: toCents(order.deliveryFee) });

  const who = [order.customer.name, order.customer.phone].filter(Boolean).join(' · ');
  const where = order.fulfillment === 'delivery' && order.dropoff ? `LIVRAISON: ${order.dropoff.street}${order.dropoff.unit ? ` #${order.dropoff.unit}` : ''}, ${order.dropoff.postalCode}` : 'POUR EMPORTER / PICKUP';
  const typeId = await orderTypeId(mid, token, order.fulfillment, order.source);
  const body = {
    orderCart: {
      title: `${ICON[order.source]} ${order.number} · ${order.brandName}`.slice(0, 127),
      note: [where, who, order.containsAlcohol ? '🔞 ID 18+' : '', order.payment === 'paid' ? 'PAYÉ / PAID' : 'À PAYER / TO PAY', order.notes ?? ''].filter(Boolean).join(' | ').slice(0, 255),
      lineItems,
      ...(typeId ? { orderType: { id: typeId } } : {}),
    },
  };
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
      const p = await printCloverOrder(String(id), mid);
      printed = p.message;
    }
    return { ok: true, posOrderId: String(id), merchantId: mid, printed };
  } catch (e) {
    return { ok: false, error: `Clover network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
