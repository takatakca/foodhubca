// A confirmed phone cart → a direct order (Clover ticket, confirmation text, courier rules). The checks here are the
// last word, whatever the AI said: open hours, a complete delivery address inside the kitchen's area, alcohol with food
// when the permit requires it, and the caller's explicit confirmation of the total.
import { getCatalog } from '../catalog';
import { featureOn } from '../expansion/features';
import { effectiveHours, getHours, holidaysFor, isOpenAt, localDate } from '../hours';
import { addressProblems, parseAddressText, serviceAreaProblem } from '../delivery/address';
import { createDirectOrder, totalsFor } from '../delivery/orders';
import { getDeliverySettings, ruleFor } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { normalizePhone } from '../notify';
import { localTimeLabel, startOfLocalDayMs } from '../time';
import { cartToLines, type CartLine, type PhoneMenu } from './cart';
import type { PhoneCall } from './calls';
import type { PhoneLine } from './settings';

export async function openNow(line: Pick<PhoneLine, 'brands' | 'locationCode'>, now = Date.now()): Promise<boolean> {
  const cfg = await getHours();
  const holidays = holidaysFor(cfg, line.locationCode, localDate(now));
  return line.brands.some((b) => isOpenAt(effectiveHours(cfg, b, line.locationCode), holidays, now));
}

/** Delivery by phone on this line right now: the line allows it, the feature is on, the kitchen's rule is on. */
export async function phoneDeliveryAvailable(line: PhoneLine): Promise<{ available: boolean; fee: number; reason?: string }> {
  const s = await getDeliverySettings();
  if (!line.delivery) return { available: false, fee: 0, reason: 'Delivery is not offered on this phone line.' };
  if (!(await featureOn('delivery'))) return { available: false, fee: 0, reason: 'Own delivery is turned off.' };
  if (!ruleFor(s, line.locationCode).enabled) return { available: false, fee: 0, reason: 'Delivery is not turned on for this kitchen.' };
  return { available: true, fee: s.customerFee };
}

export interface OrderDetailsInput { customer_name: string; fulfillment: 'pickup' | 'delivery'; address: string; address_details: string; callback_phone: string; wanted_time: string }

/** Checks and stores the caller's details on the call. Returns what to tell the caller (or what is wrong). */
export async function setOrderDetails(call: PhoneCall, line: PhoneLine, input: OrderDetailsInput, otherKitchens: string[] = []): Promise<{ ok: boolean; call: PhoneCall; message: string }> {
  const customer: PhoneCall['customer'] = { ...call.customer };
  if (input.customer_name.trim()) customer.name = input.customer_name.trim().slice(0, 80);
  const phone = normalizePhone(input.callback_phone) ?? normalizePhone(call.from);
  if (phone) customer.phone = phone;
  if (input.wanted_time.trim()) {
    const m = input.wanted_time.trim().match(/^(\d{1,2})[:h](\d{2})$/);
    if (!m) return { ok: false, call, message: 'wanted_time must be HH:MM (24 h, today) or empty for as soon as possible.' };
    // Today, local wall time (from local midnight).
    const guess = startOfLocalDayMs() + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
    if (Number(m[1]) > 23 || Number(m[2]) > 59 || guess < Date.now()) return { ok: false, call, message: 'That time has already passed today — ask for another time, or as soon as possible.' };
    customer.wantedAt = new Date(guess).toISOString();
  } else delete customer.wantedAt;
  customer.fulfillment = input.fulfillment;
  if (input.fulfillment === 'delivery') {
    const avail = await phoneDeliveryAvailable(line);
    if (!avail.available) return { ok: false, call: { ...call, customer: { ...customer, fulfillment: undefined } }, message: `Delivery is not possible: ${avail.reason} Offer pickup instead.` };
    const loc = (await getCatalog()).locations.find((l) => l.code === line.locationCode);
    const dropoff = parseAddressText(input.address, { city: loc?.city || 'Montréal' });
    const problems = addressProblems(dropoff);
    if (!dropoff || problems.length) return { ok: false, call: { ...call, customer }, message: `Address not usable: ${problems.join(' ') || 'say the street number, street, city and postal code.'} Ask the caller again (postal code letter by letter if needed).` };
    if (input.address_details.trim()) dropoff.instructions = input.address_details.trim().slice(0, 200);
    const ds = await getDeliverySettings();
    const area = serviceAreaProblem(ruleFor(ds, line.locationCode), dropoff);
    if (area) {
      // A line with several kitchens: another kitchen of the line may deliver there.
      const other = otherKitchens.find((code) => ruleFor(ds, code).enabled && !serviceAreaProblem(ruleFor(ds, code), dropoff));
      return { ok: false, call: { ...call, customer }, message: `${area} ${other ? `That address is in the delivery area of kitchen location_code=${other}: offer to order from that kitchen instead (choose_kitchen), or pickup.` : 'Offer pickup instead.'}` };
    }
    if (!customer.phone) return { ok: false, call: { ...call, customer }, message: 'The caller ID is hidden: ask for a phone number for the courier (callback_phone).' };
    customer.dropoff = dropoff;
    return { ok: true, call: { ...call, customer }, message: `Delivery to ${dropoff.street}${dropoff.unit ? ` #${dropoff.unit}` : ''}, ${dropoff.postalCode}. Delivery fee ${avail.fee.toFixed(2)} $.` };
  }
  delete customer.dropoff;
  return { ok: true, call: { ...call, customer }, message: `Pickup${customer.wantedAt ? ` at ${localTimeLabel(customer.wantedAt)}` : ', as soon as possible'}.` };
}

export interface PlaceResult { ok: boolean; message: string; order?: DirectOrder; call: PhoneCall }

export async function placePhoneOrder(call: PhoneCall, line: PhoneLine, menu: PhoneMenu, opts: { confirmed: boolean; simulate: boolean; smsConfirmation: boolean }): Promise<PlaceResult> {
  if (call.orderId) return { ok: false, call, message: `Order ${call.orderNumber} was already placed on this call. Do not place it twice.` };
  if (!opts.confirmed) return { ok: false, call, message: 'Read back the items and the total, and get a clear yes first.' };
  if (!call.cart.length) return { ok: false, call, message: 'The cart is empty.' };
  const c = call.customer;
  if (!c.fulfillment) return { ok: false, call, message: 'Call set_order_details first (name, pickup or delivery).' };
  if (!c.name) return { ok: false, call, message: 'Ask for the customer’s name first (set_order_details).' };
  const wanted = c.wantedAt ? Date.parse(c.wantedAt) : Date.now();
  if (!(await openNow(line, wanted))) return { ok: false, call, message: 'The kitchen is closed at that time. Offer a time when it is open, or apologise.' };
  const lines = cartToLines(call.cart);
  if (lines.some((l) => l.alcohol)) {
    if (!menu.alcohol.allowed) return { ok: false, call, message: `Alcohol cannot be sold right now: ${menu.alcohol.reason} Remove it from the cart.` };
    if (menu.alcohol.requireFood && lines.every((l) => l.alcohol)) return { ok: false, call, message: 'With this permit, alcohol is sold only with food. Offer to add food, or remove the alcohol.' };
  }
  const delivery = c.fulfillment === 'delivery' ? await phoneDeliveryAvailable(line) : { available: false, fee: 0 };
  const totals = totalsFor(lines, delivery.fee, 0);
  if (opts.simulate) {
    return { ok: true, call: { ...call, orderNumber: 'TEST' }, message: `SIMULATION — nothing was sent to the kitchen or Clover. Total ${totals.total.toFixed(2)} $. Say the order is confirmed (test), then end the call.` };
  }
  const brand = call.cart[0].brand;
  const order = await createDirectOrder({
    source: 'phone_ai', sourceRef: call.id, brandName: brand, locationCode: line.locationCode,
    customer: { name: c.name, phone: c.phone, lang: call.lang === 'es' ? 'en' : call.lang /* texts exist in fr / en */ }, fulfillment: c.fulfillment, dropoff: c.dropoff, lines,
    payment: c.fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid', deliveryFee: delivery.fee, wantedAt: c.wantedAt,
    notes: `Phone order (AI) — call ${call.id.slice(-6)}`, confirmBySms: opts.smsConfirmation,
    // Couriers never collect money: a person calls back for the payment before the courier is sent.
    attention: c.fulfillment === 'delivery' ? 'Phone delivery: call the customer back to take the payment, then tap "Payment taken".' : undefined,
  }, { username: 'phone-ai', name: 'AI phone agent', source: 'automation' });
  const ready = order.readyAt ? localTimeLabel(order.readyAt) : '';
  return {
    ok: true, order,
    call: { ...call, orderId: order.id, orderNumber: order.number, status: 'ordered' },
    message: `Order placed: number ${order.number}, total ${order.total.toFixed(2)} $. ${c.fulfillment === 'pickup' ? `Ready around ${ready}; pay at the counter.` : 'A team member will call back to take the payment before the courier leaves; delivery about 45 minutes after that.'}${order.containsAlcohol ? ' Remind them: photo ID (18+).' : ''}${opts.smsConfirmation && c.phone ? ' A confirmation text is on its way.' : ''}${order.posError ? ' (Kitchen note: Clover did not receive it — the team sees it in Food Hub.)' : ''}`,
  };
}

export type { CartLine };
