// Clover orders that WE must deliver: an order whose Clover order type says "Delivery" / "Livraison" (Clover online
// ordering, a phone order typed at the register…) and that is NOT a platform's order (DoorDash, Uber Eats, Skip, TGTG —
// those bring their own couriers). Each one becomes a direct order on the own-delivery board, ready for "Call a courier"
// or the location's auto-dispatch. Orders Food Hub created itself are never read back.
// The customer's name, phone and address come from the Clover customer on the order, else from the order note.
import { fromCents, timedFetch } from '../config';
import { locationsForMerchant } from '../clover-sync';
import { getCatalog } from '../catalog';
import { cloverBaseUrl, cloverToken } from '../pos/clover';
import { platformFromLabel } from '../pos/clover-platform-orders';
import { getRepo } from '../repo';
import { normalizePhone } from '../notify';
import { addressProblems, normalizePostal, parseAddressText } from './address';
import { createDirectOrder } from './orders';
import { findDirectOrderBySource, getDeliverySettings, listDirectOrders } from './store';
import type { DirectLine, DropoffAddress } from './types';

const SINCE_KEY = (mid: string) => `clover_delivery_orders_since:${mid}`;
const MIN_AGE_MS = 60_000;
const FIRST_LOOKBACK_MS = 6 * 3600_000;
const DELIVERY_TYPE = /livraison|delivery/i;

const actor = { username: 'clover', name: 'Clover', source: 'platform' as const };

export function isOwnDeliveryOrder(co: any, orderTypes: Map<string, string>): boolean {
  const label = String(co?.orderType?.label ?? orderTypes.get(String(co?.orderType?.id ?? '')) ?? '');
  if (!DELIVERY_TYPE.test(label) || platformFromLabel(label)) return false;
  const tenders: any[] = co?.payments?.elements ?? [];
  if (tenders.some((p) => platformFromLabel(p?.tender?.label))) return false;
  // Food Hub's own tickets: platform orders ("DoorDash #…") and direct orders ("📞 IA-1043 · …").
  const title = String(co?.title ?? '');
  if (platformFromLabel(title, true) || /^\S+\s+(T|IA|C|W|M)-\d+\s·/.test(title)) return false;
  return true;
}

/** Customer, phone and address from the Clover customer on the order, falling back to the order note. */
export function customerFromClover(co: any, city?: string): { name?: string; phone?: string; dropoff?: DropoffAddress } {
  const c = co?.customers?.elements?.[0];
  const name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || undefined : undefined;
  const phone = normalizePhone(c?.phoneNumbers?.elements?.[0]?.phoneNumber) ?? normalizePhone(String(co?.note ?? '').match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/)?.[1]) ?? undefined;
  const a = c?.addresses?.elements?.[0];
  let dropoff: DropoffAddress | undefined;
  if (a?.address1) {
    dropoff = { street: String(a.address1), unit: a.address2 ? String(a.address2) : undefined, city: String(a.city || city || ''), province: String(a.state || 'QC'), postalCode: normalizePostal(a.zip) ?? String(a.zip ?? ''), country: String(a.country || 'CA').slice(0, 2).toUpperCase() };
  } else {
    dropoff = parseAddressText(String(co?.note ?? '').replace(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/, ''), { city }) ?? undefined;
  }
  return { name, phone, dropoff };
}

function linesOf(co: any): DirectLine[] {
  return (co?.lineItems?.elements ?? []).filter((li: any) => !li?.refunded).map((li: any) => {
    const modifiers = (li?.modifications?.elements ?? []).map((m: any) => ({ name: String(m?.name ?? 'Option'), quantity: 1, unitPrice: fromCents(Number(m?.amount) || 0) }));
    const unitPrice = fromCents(Number(li?.price) || 0);
    return {
      externalId: li?.id ? String(li.id) : undefined, posItemRef: li?.item?.id ? String(li.item.id) : undefined, name: String(li?.name ?? 'Item'), quantity: 1, unitPrice,
      total: Math.round((unitPrice + modifiers.reduce((s: number, m: { unitPrice: number }) => s + m.unitPrice, 0)) * 100) / 100, notes: li?.note ? String(li.note) : undefined, modifiers,
    } satisfies DirectLine;
  });
}

export async function importCloverDeliveryOrders(mid: string, now = Date.now()): Promise<{ imported: number; error?: string }> {
  const s = await getDeliverySettings();
  if (!s.readCloverDeliveryOrders) return { imported: 0 };
  const token = await cloverToken(mid);
  if (!token) return { imported: 0, error: `No Clover API token for merchant ${mid}` };
  const repo = getRepo();
  const until = now - MIN_AGE_MS;
  const since = Math.max((await repo.getKv<number>(SINCE_KEY(mid))) ?? 0, now - FIRST_LOOKBACK_MS);
  if (since >= until) return { imported: 0 };
  const get = async (path: string, qs: Record<string, string>) => {
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/${path}?${new URLSearchParams(qs)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Clover ${path} HTTP ${res.status}`);
    return res.json();
  };
  try {
    const typesJson = await get('order_types', { limit: '200' }).catch(() => ({ elements: [] }));
    const orderTypes = new Map<string, string>((typesJson?.elements ?? []).map((t: any) => [String(t.id), String(t.label ?? '')]));
    const locations = await locationsForMerchant(mid);
    const catalog = await getCatalog();
    const locationCode = locations[0] ?? catalog.locations.find((l) => l.active)?.code;
    if (!locationCode) return { imported: 0, error: 'No location for this Clover merchant.' };
    const loc = catalog.locations.find((l) => l.code === locationCode);
    const brands = [...new Set((await repo.listStores()).filter((st) => st.locationCode === locationCode).map((st) => st.brandName))];
    const ours = new Set((await listDirectOrders({ since: new Date(since - 86400_000).toISOString(), limit: 2000 })).map((o) => o.posOrderId).filter(Boolean) as string[]);
    let imported = 0;
    for (let page = 0; page < 5; page++) {
      const json = await get('orders', { filter: `createdTime>=${since}`, expand: 'lineItems,lineItems.modifications,payments,orderType,customers,customers.addresses,customers.phoneNumbers', limit: '100', offset: String(page * 100) });
      const rows: any[] = json?.elements ?? [];
      for (const co of rows) {
        const id = String(co?.id ?? '');
        if (!id || ours.has(id) || Number(co?.createdTime) > until || !isOwnDeliveryOrder(co, orderTypes)) continue;
        if (await findDirectOrderBySource('clover', id)) continue;
        const lines = linesOf(co);
        if (!lines.length) continue;
        const who = customerFromClover(co, loc?.city || 'Montréal');
        const paid = (co?.payments?.elements ?? []).reduce((sum: number, p: any) => sum + (Number(p?.amount) || 0), 0) >= (Number(co?.total) || 1);
        const brand = brands.find((b) => String(co?.title ?? '').toLowerCase().includes(b.toLowerCase())) ?? brands[0] ?? 'Clover';
        const problems = addressProblems(who.dropoff);
        await createDirectOrder({
          source: 'clover', sourceRef: id, posOrderId: id, brandName: brand, locationCode, customer: { name: who.name, phone: who.phone }, fulfillment: 'delivery', dropoff: who.dropoff,
          lines, notes: co?.note ? String(co.note).slice(0, 300) : undefined, payment: paid ? 'paid' : 'unpaid',
          // Clover's own amounts (its tax rates, discounts) — never recomputed.
          totals: co?.total != null ? { subtotal: lines.reduce((sum, l) => sum + l.total, 0), tax: fromCents((co?.payments?.elements ?? []).reduce((sum: number, p: any) => sum + (Number(p?.taxAmount) || 0), 0)), total: fromCents(Number(co.total)) } : undefined,
          attention: problems.length ? `${problems[0]} Add it on the order, then call a courier.` : !who.phone ? 'Customer phone missing — add it on the order.' : undefined,
        }, actor);
        imported++;
      }
      if (rows.length < 100) break;
    }
    await repo.setKv(SINCE_KEY(mid), until);
    return { imported };
  } catch (e) {
    return { imported: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
