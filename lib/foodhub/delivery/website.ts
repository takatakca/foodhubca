// Our own website → Food Hub. The site POSTs each order; Food Hub sends it to Clover, texts the customer and, for a
// delivery, books the courier by the location's rules. Same shape for any future own channel.
//   POST /api/foodhub/webhooks/website-order   Authorization: Bearer <FOODHUB_WEBSITE_ORDER_SECRET>
//   { id, brand, location, customer: { name, phone, email?, lang? }, fulfillment: "pickup" | "delivery",
//     address?: { street, unit?, city, province?, postalCode, instructions?, lat?, lng? } | "one line",
//     items: [{ ref?, name, quantity, price, notes?, options?: [{ ref?, name, price, quantity? }] }],
//     tip?, deliveryFee?, wantedAt?,
//     payment: "paid" | "pay_at_pickup" | "interac",   // or the older `paid: boolean` (kept as it was)
//     fees?: [{ code: "interac", name, amount }],       // REQUIRED with payment "interac": the fee the site showed
//     total?: <what the customer saw, all included>,    // REQUIRED with payment "interac"; checked when given
//     customerToken?: "cust.…", tenant?: "pppmtl" }     // links the order to the Food Hub customer account (customers/token.ts)
// The same order id twice is answered with the first order (no duplicate). Alcohol is refused unless the alcohol rules
// allow it on the website (and, for a delivery, through our couriers) — the site should never have sold it.
//
// Price rule (Québec: the price the customer commits to is all-inclusive and shown BEFORE checkout). With `payment`
// (the 2026-10-29 contract) Food Hub re-prices every line from the brand menu — a line, or an option with any non-zero
// price (paid or negative), it cannot find on the menu, or whose price differs from the menu, is refused (422); the
// line keeps the menu item's own name — adds the declared fees and GST + QST, and refuses
// the order when its total differs from the site's `total` by more than $0.02. The older `paid: boolean` payloads are
// taken as before (no re-pricing), so today's site keeps working unchanged.
import { decideAlcohol, isAlcoholItem } from '../alcohol/rules';
import { getCatalog } from '../catalog';
import { round2, safeEqual } from '../config';
import { resolveCustomerToken } from '../customers/token';
import { customerTenant } from '../customers/types';
import { getBrandMenu } from '../menu/shared';
import { normalizePhone } from '../notify';
import { newTrack, trackPathFor } from '../storefront/checkout';
import { locationProvince } from '../taxes';
import type { MasterMenu, MenuItem, MenuModifier } from '../types';
import { normalizePostal, parseAddressText } from './address';
import { interacReadiness, newInteracReference, startInterac } from './interac';
import { createDirectOrder, lineTotal, totalsFor } from './orders';
import { findDirectOrderBySource, getDeliverySettings } from './store';
import type { DirectLine, DirectOrder, DropoffAddress, OrderFee, PaymentState } from './types';

/** Tolerance between the site's total and ours (rounding of taxes line by line). */
export const TOTAL_TOLERANCE = 0.02;
const INTERAC_FEE_NAME = 'Frais Interac e-Transfer';

export function verifyWebsiteOrder(headers: Headers): boolean {
  const expected = process.env.FOODHUB_WEBSITE_ORDER_SECRET;
  const got = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() || headers.get('x-takatak-token') || '';
  return Boolean(expected) && safeEqual(got, expected);
}

export type WebsiteOrderResult = { ok: true; order: DirectOrder; duplicate: boolean; trackPath?: string } | { ok: false; status: number; error: string };
type Refused = { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Refused => ({ ok: false, status, error });

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

function findItem(menu: MasterMenu | null, ref: string, name: string): MenuItem | undefined {
  if (!menu) return undefined;
  if (ref) { const byRef = menu.items.find((x) => x.ref === ref || x.posItemRef === ref); if (byRef) return byRef; }
  const n = norm(name);
  return n ? menu.items.find((x) => norm(x.name) === n || norm(x.nameFr) === n) : undefined;
}

function findModifier(menu: MasterMenu, item: MenuItem, ref: string, name: string): MenuModifier | undefined {
  const groups = menu.modifierGroups.filter((g) => item.modifierGroupRefs.includes(g.ref));
  const all = groups.flatMap((g) => g.modifiers);
  if (ref) { const byRef = all.find((m) => m.ref === ref || m.posModifierRef === ref); if (byRef) return byRef; }
  const n = norm(name);
  return n ? all.find((m) => norm(m.name) === n || norm(m.nameFr) === n) : undefined;
}

/**
 * The order lines. `strict` (payment given): every line and every paid option is priced from the menu and must match
 * what the site charged; otherwise the site's prices are kept (older payloads).
 */
function buildLines(items: any[], menu: MasterMenu | null, brandName: string, strict: boolean): { ok: true; lines: DirectLine[] } | Refused {
  const lines: DirectLine[] = [];
  for (const it of items) {
    const ref = String(it?.ref ?? '').trim();
    const name = String(it?.name ?? '').trim();
    const m = findItem(menu, ref, name);
    const quantity = Math.max(1, Math.min(99, Math.round(Number(it?.quantity) || 1)));
    const sitePrice = round2(Number(it?.price) || 0);
    if (strict) {
      if (!m) return refuse(422, `Item "${name || ref || '?'}"${ref ? ` (ref ${ref})` : ''} is not on the ${brandName} menu: its price cannot be confirmed.`);
      if (!same(sitePrice, round2(m.price))) return refuse(422, `Item "${m.name}": the site charged ${sitePrice.toFixed(2)} but the menu price is ${round2(m.price).toFixed(2)} — show the menu price before checkout.`);
    }
    const unitPrice = strict ? round2(m!.price) : sitePrice;
    const modifiers: DirectLine['modifiers'] = [];
    for (const o of Array.isArray(it?.options) ? it.options : []) {
      const oRef = String(o?.ref ?? '').trim();
      const oName = String(o?.name ?? 'Option').slice(0, 80);
      const oQty = Math.max(1, Math.round(Number(o?.quantity) || 1));
      const oPrice = round2(Number(o?.price) || 0);
      const mod = strict && menu && m ? findModifier(menu, m, oRef, oName) : undefined;
      if (strict) {
        if (mod && !same(oPrice, round2(mod.price))) return refuse(422, `Option "${mod.name}" of "${m!.name}": the site charged ${oPrice.toFixed(2)} but the menu price is ${round2(mod.price).toFixed(2)}.`);
        // A free option that is not on the menu is a note ("no onions"); any other price — paid, or negative (a
        // "discount" the menu does not know) — must be confirmed by the menu.
        if (!mod && oPrice !== 0) return refuse(422, `Option "${oName}" of "${m!.name}" is not on the menu: its price (${oPrice.toFixed(2)}) cannot be confirmed.`);
      }
      modifiers.push({ name: mod?.name ? String(mod.nameFr || mod.name).slice(0, 80) : oName, quantity: oQty, unitPrice: mod ? round2(mod.price) : oPrice, ...(mod?.posModifierRef ? { posModifierRef: mod.posModifierRef } : {}) });
    }
    // Strict: the line is the menu item that set its price — its own name on the kitchen ticket and in Clover, never the
    // site's text (a cheap item's ref carrying an expensive dish's name would be cooked at the cheap price).
    const lineName = strict ? String(m!.nameFr || m!.name) : name || m?.name || 'Item';
    lines.push({
      externalId: ref || undefined, ...(m?.posItemRef ? { posItemRef: m.posItemRef } : {}), name: lineName.slice(0, 120),
      quantity, unitPrice, total: lineTotal(unitPrice, quantity, modifiers), notes: it?.notes ? String(it.notes).slice(0, 200) : undefined, modifiers,
      ...(it?.alcohol === true || (m && isAlcoholItem(m)) ? { alcohol: true } : {}),
    });
  }
  return { ok: true, lines };
}

/** The declared fees: only the Interac fee exists; it must be Food Hub's own amount, and only with payment "interac". */
function checkFees(raw: unknown, payment: string, interacFee: number): { ok: true; fees: OrderFee[] } | Refused {
  const list: any[] = Array.isArray(raw) ? raw : [];
  const fees: OrderFee[] = [];
  for (const f of list) {
    const code = norm(f?.code);
    const amount = round2(Number(f?.amount) || 0);
    if (code !== 'interac') return refuse(422, `Unknown fee "${String(f?.code ?? '')}": Food Hub only knows the Interac e-Transfer fee.`);
    if (payment !== 'interac') return refuse(422, 'An Interac fee is declared but the payment is not "interac".');
    if (!same(amount, interacFee)) return refuse(422, `Interac fee ${amount.toFixed(2)} differs from the Food Hub setting ${interacFee.toFixed(2)}: the site must show the fee Food Hub charges before checkout.`);
    fees.push({ code: 'interac', name: String(f?.name || INTERAC_FEE_NAME).slice(0, 80), amount });
  }
  if (payment === 'interac' && !fees.length) return refuse(422, `payment "interac" needs the fee line: fees: [{ code: "interac", name: "${INTERAC_FEE_NAME}", amount: ${interacFee.toFixed(2)} }] — the customer must see it before checkout.`);
  if (fees.length > 1) return refuse(422, 'The Interac fee is declared more than once.');
  return { ok: true, fees };
}

export async function receiveWebsiteOrder(body: any): Promise<WebsiteOrderResult> {
  const id = String(body?.id ?? '').trim();
  if (!id) return refuse(400, 'id is required.');
  const existing = await findDirectOrderBySource('website', id);
  if (existing) return { ok: true, order: existing, duplicate: true };
  const catalog = await getCatalog();
  const location = catalog.locations.find((l) => l.code === String(body?.location ?? '').toUpperCase() && l.active);
  if (!location) return refuse(422, `Unknown location "${body?.location ?? ''}".`);
  const brand = catalog.brands.find((b) => b.name.toLowerCase() === String(body?.brand ?? '').toLowerCase() && b.active);
  if (!brand) return refuse(422, `Unknown brand "${body?.brand ?? ''}".`);
  const fulfillment = body?.fulfillment === 'delivery' ? 'delivery' : 'pickup';

  // Payment: the contract's `payment`, or the older `paid: boolean`.
  const strict = typeof body?.payment === 'string';
  const paymentRaw = strict ? norm(body.payment) : body?.paid === true ? 'paid' : 'pay_at_pickup';
  if (!['paid', 'pay_at_pickup', 'interac'].includes(paymentRaw)) return refuse(422, `Unknown payment "${body.payment}": use "paid", "pay_at_pickup" or "interac".`);
  const settings = await getDeliverySettings();
  const interac = paymentRaw === 'interac' ? interacReadiness(settings, location.code) : null;
  if (interac && !interac.ok) return refuse(422, interac.reason ?? 'Interac e-Transfer is not available.');

  // The customer's account (optional): the token's signature, expiry, version and brand website are checked by task 72's
  // module. A bad token is refused (401) so the site notices; a token of another brand website too (403).
  let account: { id: string; name?: string; email?: string; lang: 'fr' | 'en' } | undefined;
  if (body?.customerToken !== undefined && body?.customerToken !== null && body?.customerToken !== '') {
    const tenant = body?.tenant === undefined || body?.tenant === null || body?.tenant === '' ? null : customerTenant(body.tenant);
    if (body?.tenant && !tenant) return refuse(403, `Brand website "${String(body.tenant)}" is not allowed here.`);
    const r = await resolveCustomerToken(String(body.customerToken), { tenant });
    if (!r.ok) return refuse(r.status, `customerToken: ${r.error}`);
    account = { id: r.customer.id, name: r.customer.name, email: r.customer.email, lang: r.customer.lang };
  }

  const menu = await getBrandMenu(brand.name);
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return refuse(422, 'items is empty.');
  if (strict && !menu) return refuse(422, `No menu saved for ${brand.name} in Food Hub: prices cannot be confirmed.`);
  const built = buildLines(items, menu, brand.name, strict);
  if (!built.ok) return built;
  const lines = built.lines;
  if (lines.some((l) => l.alcohol)) {
    for (const ch of fulfillment === 'delivery' ? (['website', 'own_delivery'] as const) : (['website'] as const)) {
      const d = await decideAlcohol(location.code, ch);
      if (!d.allowed) return refuse(422, `Alcohol refused: ${d.reason}`);
    }
  }
  const tip = round2(Math.max(0, Number(body?.tip) || 0));
  const deliveryFee = fulfillment === 'delivery' ? round2(Math.max(0, Number(body?.deliveryFee) || 0)) : 0;
  const feesChecked = checkFees(body?.fees, paymentRaw, interac?.fee ?? settings.interac.fee);
  if (!feesChecked.ok) return feesChecked;
  const fees = feesChecked.fees;
  // The all-in total the customer saw must be ours.
  const ours = totalsFor(lines, deliveryFee, tip, true, locationProvince(location), fees).total;
  const siteTotal = body?.total === undefined || body?.total === null || body?.total === '' ? null : Number(body.total);
  if (paymentRaw === 'interac' && (siteTotal === null || !Number.isFinite(siteTotal))) return refuse(422, 'total is required with payment "interac": the all-in amount the customer saw before checkout.');
  if (siteTotal !== null && strict) {
    if (!Number.isFinite(siteTotal)) return refuse(422, 'total must be a number.');
    if (Math.round(Math.abs(siteTotal - ours) * 100) > Math.round(TOTAL_TOLERANCE * 100)) return refuse(422, `Total ${siteTotal.toFixed(2)} differs from Food Hub's ${ours.toFixed(2)} (menu prices + delivery fee + fees + GST/QST + tip): the customer must see the real price before checkout.`);
  }

  let dropoff: DropoffAddress | undefined;
  if (fulfillment === 'delivery') {
    const a = body?.address;
    dropoff = typeof a === 'string'
      ? parseAddressText(a, { city: location.city }) ?? undefined
      : a?.street ? { street: String(a.street), unit: a.unit ? String(a.unit) : undefined, city: String(a.city || location.city || ''), province: String(a.province || 'QC'), postalCode: normalizePostal(a.postalCode) ?? String(a.postalCode ?? ''), country: 'CA', instructions: a.instructions ? String(a.instructions).slice(0, 200) : undefined, lat: Number.isFinite(Number(a.lat)) ? Number(a.lat) : undefined, lng: Number.isFinite(Number(a.lng)) ? Number(a.lng) : undefined } : undefined;
  }
  const lang: 'fr' | 'en' = body?.customer?.lang === 'en' ? 'en' : body?.customer?.lang === 'fr' ? 'fr' : account?.lang ?? 'fr';
  const payment: PaymentState = paymentRaw === 'paid' ? 'paid' : fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid';
  const now = Date.now();
  const held = interac?.ok
    ? {
        reference: await newInteracReference(brand.name, now), recipient: interac.recipient!, autoDeposit: settings.interac.autoDeposit,
        ...(settings.interac.autoDeposit ? {} : { question: settings.interac.question, answer: settings.interac.answer }),
        lang, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + settings.interac.holdMinutes * 60_000).toISOString(), reminderMin: settings.interac.reminderMinutes,
      }
    : undefined;
  let order = await createDirectOrder({
    source: 'website', sourceRef: id, brandName: brand.name, locationCode: location.code,
    customer: {
      name: body?.customer?.name ? String(body.customer.name).slice(0, 80) : account?.name || undefined, phone: normalizePhone(body?.customer?.phone) ?? undefined,
      email: body?.customer?.email ? String(body.customer.email).slice(0, 120) : account?.email || undefined, lang, ...(account ? { id: account.id } : {}),
    },
    fulfillment, dropoff, lines, payment, tip, deliveryFee, fees, wantedAt: body?.wantedAt ? String(body.wantedAt) : undefined, confirmBySms: true,
    ...(held ? { interac: held } : {}),
  }, { username: 'website', name: 'Website', source: 'api' });
  if (!held) return { ok: true, order, duplicate: false };
  order = (await startInterac(order, { by: 'Website' })).order;
  // The customer can follow the held order (and re-read the instructions) on the brand's tracking page, when it has one.
  const trackPath = await trackPathFor(brand.name, await newTrack(order.id, now)).catch(() => null);
  return { ok: true, order, duplicate: false, ...(trackPath ? { trackPath } : {}) };
}
