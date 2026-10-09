// DoorDash Order Cart Validation (OCV): before the customer can place an order, DoorDash asks the restaurant's system
// "can you make this cart?" and shows the customer a clear message if not. The check runs while the customer goes from the
// cart to checkout; no answer within 2-3 seconds means the check is skipped and the order is simply sent (DoorDash may
// switch OCV off for a store that times out often), so this answers from Food Hub's own data only, with no outbound call.
// Spec: https://developer.doordash.com/en-US/docs/marketplace/how_to/order_cart_validation/
//   POST (our endpoint) { cart_id, store:{merchant_supplied_id, provider_type}, fulfillment:{type, asap, requested_time},
//                         subtotal, tax, categories:[{items:[{merchant_supplied_id, line_item_id, extras:[{options:[…]}]}]}], experience }
//   → { valid, cart_id, expires_at, earliest_pickup_time }  or  { valid:false, cart_id, expires_at, errors:[{code, merchant_supplied_id, message}] }
import { NextResponse } from 'next/server';
import { menuWithAlcoholRules } from '../alcohol/rules';
import { getHours, effectiveHours, holidaysFor, isOpenAt, localDate } from '../hours';
import { menuForLocation, offRefsAt } from '../ops';
import { getBrandMenu } from '../menu/shared';
import { prepFor } from '../prep';
import { getRepo } from '../repo';
import { guardDoorDashStore } from './guard';

export interface CartError { code: string; merchant_supplied_id: string; message: string }
export interface CartValidation { valid: boolean; cart_id: string; expires_at: string; earliest_pickup_time?: string; errors?: CartError[] }
export type CartOutcome = { refused: string; status: 404 | 409 } | { answer: CartValidation };

const ITEM_MS = 5 * 60_000; // a validation stays good for five minutes

/** Every item and option id in the cart, with its name, for item-level errors. */
function cartRefs(categories: any[]): Array<{ id: string; name: string; kind: 'item' | 'option' }> {
  const out: Array<{ id: string; name: string; kind: 'item' | 'option' }> = [];
  const options = (extras: any) => {
    for (const ex of Array.isArray(extras) ? extras : []) {
      for (const op of Array.isArray(ex?.options) ? ex.options : []) {
        if (op?.merchant_supplied_id) out.push({ id: String(op.merchant_supplied_id), name: String(op.name ?? ''), kind: 'option' });
        options(op?.extras);
      }
    }
  };
  for (const cat of categories) {
    for (const it of Array.isArray(cat?.items) ? cat.items : []) {
      if (it?.merchant_supplied_id) out.push({ id: String(it.merchant_supplied_id), name: String(it.name ?? ''), kind: 'item' });
      options(it?.extras);
    }
  }
  return out;
}

/** Answers one Order Cart Validation request. Never calls DoorDash and never writes anything. */
export async function validateDoorDashCart(body: any, now = Date.now()): Promise<CartOutcome> {
  const cartId = String(body?.cart_id ?? '');
  const msid = String(body?.store?.merchant_supplied_id ?? '');
  // A protected store (Po Poulet NDG…) gets no answer at all: DoorDash then skips the check, exactly as for a timeout.
  const refused = await guardDoorDashStore(msid, 'read');
  if (refused) return { refused, status: 409 };
  const store = await getRepo().findStore('doordash', msid);
  if (!store) return { refused: `Unknown location_id ${msid} — map it under Food Hub → Stores → Mapping.`, status: 404 };

  const errors: CartError[] = [];
  const expires = new Date(now + ITEM_MS).toISOString();
  const wanted = body?.fulfillment?.asap === false && body?.fulfillment?.requested_time ? Date.parse(body.fulfillment.requested_time) : now;
  const at = Number.isFinite(wanted) ? wanted : now;
  const storeId = msid;

  // 1) Paused in Food Hub (tablet closed, busy pause, holiday pause).
  if (!store.online && at <= now + 60_000) {
    errors.push({ code: store.pausedUntil ? 'STORE_TEMP_CLOSED' : 'STORE_CLOSED', merchant_supplied_id: storeId, message: store.pausedUntil ? `Paused until ${store.pausedUntil}` : 'Store is paused in Food Hub' });
  }
  // 2) Hours (the hours Food Hub publishes: brand override, location, holidays).
  const cfg = await getHours();
  const week = effectiveHours(cfg, store.brandName, store.locationCode);
  if (week && !isOpenAt(week, holidaysFor(cfg, store.locationCode, localDate(at), 1), at)) {
    errors.push({ code: 'STORE_HOURS_ISSUE', merchant_supplied_id: storeId, message: 'Outside the store hours' });
  }
  // 3) Items and options that are 86'd at this location (or switched off in the menu).
  const menu = await getBrandMenu(store.brandName);
  if (menu) {
    const local = await menuWithAlcoholRules(menuForLocation(menu, store.locationCode, now), store.locationCode, 'doordash');
    const off = offRefsAt(menu, store.locationCode, now);
    const unavailable = new Set<string>([...off, ...local.items.filter((i) => !i.available).map((i) => i.ref), ...local.modifierGroups.flatMap((g) => g.modifiers.filter((m) => !m.available).map((m) => m.ref))]);
    for (const ref of cartRefs(Array.isArray(body?.categories) ? body.categories : [])) {
      if (unavailable.has(ref.id)) errors.push({ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: ref.id, message: `${ref.name || ref.id} is not available right now` });
    }
  }

  if (errors.length) return { answer: { valid: false, cart_id: cartId, expires_at: expires, errors } };
  const prep = await prepFor(store.locationCode);
  return { answer: { valid: true, cart_id: cartId, expires_at: expires, earliest_pickup_time: new Date(Math.max(at, now) + prep.minutes * 60_000).toISOString() } };
}

/** The HTTP answer for a cart validation: the validation itself (200), or 404 / 409 so DoorDash skips the check. */
export async function cartValidationResponse(body: any): Promise<NextResponse> {
  const out = await validateDoorDashCart(body);
  if ('refused' in out) return NextResponse.json({ error: out.refused }, { status: out.status });
  return NextResponse.json(out.answer);
}
