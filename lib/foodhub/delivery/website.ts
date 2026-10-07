// Our own website → Food Hub. The site POSTs each paid (or pay-at-pickup) order; Food Hub sends it to Clover, texts the
// customer and, for a delivery, books the courier by the location's rules. Same shape for any future own channel.
//   POST /api/foodhub/webhooks/website-order   Authorization: Bearer <FOODHUB_WEBSITE_ORDER_SECRET>
//   { id, brand, location, customer: { name, phone, email?, lang? }, fulfillment: "pickup" | "delivery",
//     address?: { street, unit?, city, province?, postalCode, instructions?, lat?, lng? } | "one line",
//     items: [{ ref?, name, quantity, price, notes?, options?: [{ name, price, quantity? }] }],
//     tip?, deliveryFee?, paid: boolean, wantedAt? }
// The same order id twice is answered with the first order (no duplicate). Alcohol is refused unless the alcohol rules
// allow it on the website (and, for a delivery, through our couriers) — the site should never have sold it.
import { decideAlcohol, isAlcoholItem } from '../alcohol/rules';
import { getCatalog } from '../catalog';
import { round2, safeEqual } from '../config';
import { getBrandMenu } from '../menu/shared';
import { normalizePhone } from '../notify';
import { normalizePostal, parseAddressText } from './address';
import { createDirectOrder, lineTotal } from './orders';
import { findDirectOrderBySource } from './store';
import type { DirectLine, DirectOrder, DropoffAddress } from './types';

export function verifyWebsiteOrder(headers: Headers): boolean {
  const expected = process.env.FOODHUB_WEBSITE_ORDER_SECRET;
  const got = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() || headers.get('x-takatak-token') || '';
  return Boolean(expected) && safeEqual(got, expected);
}

export async function receiveWebsiteOrder(body: any): Promise<{ ok: true; order: DirectOrder; duplicate: boolean } | { ok: false; status: number; error: string }> {
  const id = String(body?.id ?? '').trim();
  if (!id) return { ok: false, status: 400, error: 'id is required.' };
  const existing = await findDirectOrderBySource('website', id);
  if (existing) return { ok: true, order: existing, duplicate: true };
  const catalog = await getCatalog();
  const location = catalog.locations.find((l) => l.code === String(body?.location ?? '').toUpperCase() && l.active);
  if (!location) return { ok: false, status: 422, error: `Unknown location "${body?.location ?? ''}".` };
  const brand = catalog.brands.find((b) => b.name.toLowerCase() === String(body?.brand ?? '').toLowerCase() && b.active);
  if (!brand) return { ok: false, status: 422, error: `Unknown brand "${body?.brand ?? ''}".` };
  const fulfillment = body?.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  const menu = await getBrandMenu(brand.name);
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return { ok: false, status: 422, error: 'items is empty.' };
  const lines: DirectLine[] = items.map((it) => {
    const m = menu?.items.find((x) => x.ref === String(it?.ref ?? '') || x.posItemRef === String(it?.ref ?? ''));
    const modifiers = (Array.isArray(it?.options) ? it.options : []).map((o: any) => ({ name: String(o?.name ?? 'Option').slice(0, 80), quantity: Math.max(1, Math.round(Number(o?.quantity) || 1)), unitPrice: round2(Number(o?.price) || 0) }));
    const quantity = Math.max(1, Math.min(99, Math.round(Number(it?.quantity) || 1)));
    const unitPrice = round2(Number(it?.price) || 0);
    return {
      externalId: it?.ref ? String(it.ref) : undefined, ...(m?.posItemRef ? { posItemRef: m.posItemRef } : {}), name: String(it?.name ?? m?.name ?? 'Item').slice(0, 120),
      quantity, unitPrice, total: lineTotal(unitPrice, quantity, modifiers), notes: it?.notes ? String(it.notes).slice(0, 200) : undefined, modifiers,
      ...(it?.alcohol === true || (m && isAlcoholItem(m)) ? { alcohol: true } : {}),
    };
  });
  if (lines.some((l) => l.alcohol)) {
    for (const ch of fulfillment === 'delivery' ? (['website', 'own_delivery'] as const) : (['website'] as const)) {
      const d = await decideAlcohol(location.code, ch);
      if (!d.allowed) return { ok: false, status: 422, error: `Alcohol refused: ${d.reason}` };
    }
  }
  let dropoff: DropoffAddress | undefined;
  if (fulfillment === 'delivery') {
    const a = body?.address;
    dropoff = typeof a === 'string'
      ? parseAddressText(a, { city: location.city }) ?? undefined
      : a?.street ? { street: String(a.street), unit: a.unit ? String(a.unit) : undefined, city: String(a.city || location.city || ''), province: String(a.province || 'QC'), postalCode: normalizePostal(a.postalCode) ?? String(a.postalCode ?? ''), country: 'CA', instructions: a.instructions ? String(a.instructions).slice(0, 200) : undefined, lat: Number.isFinite(Number(a.lat)) ? Number(a.lat) : undefined, lng: Number.isFinite(Number(a.lng)) ? Number(a.lng) : undefined } : undefined;
  }
  const order = await createDirectOrder({
    source: 'website', sourceRef: id, brandName: brand.name, locationCode: location.code,
    customer: { name: body?.customer?.name ? String(body.customer.name).slice(0, 80) : undefined, phone: normalizePhone(body?.customer?.phone) ?? undefined, email: body?.customer?.email ? String(body.customer.email).slice(0, 120) : undefined, lang: body?.customer?.lang === 'en' ? 'en' : 'fr' },
    fulfillment, dropoff, lines, payment: body?.paid === true ? 'paid' : fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid',
    tip: Number(body?.tip) || 0, deliveryFee: Number(body?.deliveryFee) || 0, wantedAt: body?.wantedAt ? String(body.wantedAt) : undefined, confirmBySms: true,
  }, { username: 'website', name: 'Website', source: 'api' });
  return { ok: true, order, duplicate: false };
}
