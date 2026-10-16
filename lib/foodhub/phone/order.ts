// A confirmed phone cart → a direct order (Clover ticket, confirmation text, courier rules) — or, with a payment link,
// a HELD order that goes to the kitchen only once paid (delivery/paylink.ts). The checks here are the last word,
// whatever the AI said: the hours set in Food Hub (never set = no order: a person takes it), a complete delivery
// address inside the kitchen's area, alcohol with food when the permit requires it, and the caller's explicit
// confirmation of the total.
import { getCatalog } from '../catalog';
import { featureOn } from '../expansion/features';
import { brandHoursState, describeHours, getHours, type HoursFacts } from '../hours';
import { addressProblems, parseAddressText, serviceAreaProblem } from '../delivery/address';
import { createDirectOrder, totalsFor } from '../delivery/orders';
import { cancelHeldOrder, PAYLINK_SMS, paylinkReadiness, payTotal, payUrl, startPayLink } from '../delivery/paylink';
import { getDeliverySettings, ruleFor } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { normalizePhone } from '../notify';
import { localTimeLabel, startOfLocalDayMs } from '../time';
import { cartToLines, type CartLine, type PhoneMenu } from './cart';
import type { PhoneCall } from './calls';
import type { PhoneLine, PhoneSettings } from './settings';
import { orderConfirmation } from './style';

/** Open now for at least one brand of the line (unset hours count as open here — only for wording; orders use kitchenHoursState). */
export async function openNow(line: Pick<PhoneLine, 'brands' | 'locationCode'>, now = Date.now()): Promise<boolean> {
  return (await kitchenHours(line, now)).state === 'open';
}

/** The kitchen's hours as the assistant is told (today, tomorrow, open now) — from Food Hub's hours only. */
export async function kitchenHours(line: Pick<PhoneLine, 'brands' | 'locationCode'>, now = Date.now()): Promise<HoursFacts> {
  return describeHours(await getHours(), line.brands, line.locationCode, now);
}

/** Is THIS brand open at the kitchen at `ms`: open, closed, or hours never set (unknown → the order is refused). */
export async function kitchenHoursState(locationCode: string, brand: string, ms: number): Promise<'open' | 'closed' | 'unknown'> {
  return brandHoursState(await getHours(), brand, locationCode, ms);
}

/** Delivery by phone on this line right now: the line allows it, the feature is on, the kitchen's rule is on. */
export async function phoneDeliveryAvailable(line: PhoneLine): Promise<{ available: boolean; fee: number; reason?: string }> {
  const s = await getDeliverySettings();
  if (!line.delivery) return { available: false, fee: 0, reason: 'Delivery is not offered on this phone line.' };
  if (!(await featureOn('delivery'))) return { available: false, fee: 0, reason: 'Own delivery is turned off.' };
  if (!ruleFor(s, line.locationCode).enabled) return { available: false, fee: 0, reason: 'Delivery is not turned on for this kitchen.' };
  return { available: true, fee: s.customerFee };
}

/** How a phone order of this kitchen can be paid (Settings → AI phone → payment, and whether the payment link works here). */
export interface PhonePaymentPlan { link: boolean; counter: boolean; mode: PhoneSettings['payment']['mode']; reason?: string }

export async function phonePaymentPlan(line: Pick<PhoneLine, 'brands' | 'locationCode'>, settings: Pick<PhoneSettings, 'payment'>): Promise<PhonePaymentPlan> {
  const mode = settings.payment.mode;
  if (mode === 'counter') return { link: false, counter: true, mode };
  const ready = await paylinkReadiness(line.brands[0] ?? '', line.locationCode);
  if (!ready.ok) return { link: false, counter: true, mode, reason: ready.reason };
  return { link: true, counter: mode === 'choose', mode };
}

/** The PAYMENT part of the assistant's instructions for a kitchen. */
export function paymentText(p: PhonePaymentPlan): string {
  if (!p.link) return 'PAYMENT: pickup is paid at the counter (place_order payment="counter"). Delivery: a team member calls the customer back to take the payment before the courier leaves. Never take card numbers.';
  return [
    'PAYMENT: a secure Clover payment link sent by text message (place_order payment="link"). The order is held and goes to the kitchen as soon as it is paid; for a delivery the courier is sent after the payment. Confirm the cell number that will receive the text first (callback_phone if it is not the number they call from). Never read the link aloud and never take card numbers.',
    p.counter
      ? 'For pickup the caller may choose: the link by text, or paying at the counter (payment="counter"). Offer both in one short sentence.'
      : 'Pay at the counter (payment="counter") only for a pickup when the caller cannot receive texts.',
    'A delivery is always paid by the link.',
  ].join(' ');
}

export interface OrderDetailsInput { customer_name: string; fulfillment: 'pickup' | 'delivery'; address: string; address_details: string; callback_phone: string; wanted_time: string }

/**
 * "HH:MM" → when: today, or tomorrow when that time already passed and is less than 12 hours away (NDG takes orders
 * until 3 in the morning: at 23:30, "00:30" is in an hour). Null when it does not parse.
 */
export function wantedTimeMs(raw: string, now = Date.now()): number | null {
  const m = raw.trim().match(/^(\d{1,2})\s*[:h]\s*(\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const today = startOfLocalDayMs(now) + (h * 60 + min) * 60_000;
  if (today >= now) return today;
  const tomorrow = startOfLocalDayMs(startOfLocalDayMs(now) + 30 * 3600_000) + (h * 60 + min) * 60_000;
  return tomorrow - now < 12 * 3600_000 ? tomorrow : null;
}

/** Checks and stores the caller's details on the call. Returns what to tell the caller (or what is wrong). */
export async function setOrderDetails(call: PhoneCall, line: PhoneLine, input: OrderDetailsInput, otherKitchens: string[] = []): Promise<{ ok: boolean; call: PhoneCall; message: string }> {
  const customer: PhoneCall['customer'] = { ...call.customer };
  if (input.customer_name.trim()) customer.name = input.customer_name.trim().slice(0, 80);
  const phone = normalizePhone(input.callback_phone) ?? normalizePhone(call.from);
  if (phone) customer.phone = phone;
  if (input.wanted_time.trim()) {
    const when = wantedTimeMs(input.wanted_time);
    if (!when) return { ok: false, call, message: 'wanted_time must be HH:MM on a 0–23 hour clock (for example 19:30), within the next 12 hours, or empty for as soon as possible. Ask for another time.' };
    const brand = call.cart[0]?.brand ?? line.brands[0];
    const st = brand ? await kitchenHoursState(line.locationCode, brand, when) : 'unknown';
    if (st === 'closed') return { ok: false, call, message: `The kitchen is closed at ${localTimeLabel(when)}. Offer a time inside the HOURS, or as soon as possible.` };
    customer.wantedAt = new Date(when).toISOString();
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
    return { ok: true, call: { ...call, customer }, message: `Delivery to ${dropoff.street}${dropoff.unit ? ` #${dropoff.unit}` : ''}, ${dropoff.postalCode}. Delivery fee ${avail.fee.toFixed(2)} $. Texts go to the number ending in ${customer.phone.slice(-4)}.` };
  }
  delete customer.dropoff;
  return { ok: true, call: { ...call, customer }, message: `Pickup${customer.wantedAt ? ` at ${localTimeLabel(customer.wantedAt)}` : ', as soon as possible'}.${customer.phone ? ` Texts go to the number ending in ${customer.phone.slice(-4)}.` : ' No number for texts (caller ID hidden).'}` };
}

export interface PlaceResult {
  ok: boolean;
  message: string;
  order?: DirectOrder;
  call: PhoneCall;
  /** Said by the code itself right after the order is placed: the number, the time and how to pay. */
  confirm?: string;
}

export interface PlaceOptions {
  confirmed: boolean;
  simulate: boolean;
  smsConfirmation: boolean;
  /** "link" = held until paid by the texted Clover link; "counter" = pay at the counter (pickup) / a call back (delivery). */
  payment?: 'link' | 'counter';
  settings?: Pick<PhoneSettings, 'payment'>;
}

export async function placePhoneOrder(call: PhoneCall, line: PhoneLine, menu: PhoneMenu, opts: PlaceOptions): Promise<PlaceResult> {
  if (call.orderId) return { ok: false, call, message: `Order ${call.orderNumber} was already placed on this call. Do not place it twice.` };
  if (!opts.confirmed) return { ok: false, call, message: 'Read back the items and the total, and get a clear yes first.' };
  if (!call.cart.length) return { ok: false, call, message: 'The cart is empty.' };
  const c = call.customer;
  if (!c.fulfillment) return { ok: false, call, message: 'Call set_order_details first (name, pickup or delivery).' };
  if (!c.name) return { ok: false, call, message: 'Ask for the customer’s name first (set_order_details).' };
  const wanted = c.wantedAt ? Date.parse(c.wantedAt) : Date.now();
  // The hours of the brand ordered, at this kitchen (a line may sell a brand that is closed while another is open).
  for (const brand of [...new Set(call.cart.map((l) => l.brand))]) {
    const st = await kitchenHoursState(line.locationCode, brand, wanted);
    if (st === 'unknown') return { ok: false, call, message: `The hours of ${brand} are not set in Food Hub for this kitchen: no order can be taken by the assistant. Apologise and call transfer_to_human.` };
    if (st === 'closed') return { ok: false, call, message: `${brand} is closed at that time. Offer a time inside the HOURS, or apologise.` };
  }
  const lines = cartToLines(call.cart);
  if (lines.some((l) => l.alcohol)) {
    if (!menu.alcohol.allowed) return { ok: false, call, message: `Alcohol cannot be sold right now: ${menu.alcohol.reason} Remove it from the cart.` };
    if (menu.alcohol.requireFood && lines.every((l) => l.alcohol)) return { ok: false, call, message: 'With this permit, alcohol is sold only with food. Offer to add food, or remove the alcohol.' };
  }
  const delivery = c.fulfillment === 'delivery' ? await phoneDeliveryAvailable(line) : { available: false, fee: 0 };
  const totals = totalsFor(lines, delivery.fee, 0);
  const lang = call.lang;
  const plan0 = opts.settings ? await phonePaymentPlan(line, opts.settings) : { link: false, counter: true, mode: 'counter' as const };
  // The link already failed on this call: a pickup may be paid at the counter (never left stuck on a refused link).
  const plan = call.linkFailed && c.fulfillment === 'pickup' ? { ...plan0, counter: true } : plan0;
  const hasCell = Boolean(normalizePhone(c.phone));
  if (opts.payment === 'counter' && plan.link && c.fulfillment === 'pickup' && !plan.counter && hasCell) {
    return { ok: false, call, message: 'On this line pickup is paid by the texted link (the caller can receive texts). Offer the link; pay at the counter only if they cannot receive texts.' };
  }
  // A delivery is always paid by the link when the link works here; a pickup by the link unless the counter was chosen
  // (allowed when the caller chooses, or when they cannot receive texts).
  const byLink = plan.link && (c.fulfillment === 'delivery' || !(opts.payment === 'counter' && (plan.counter || !hasCell)));
  if (byLink && !hasCell) return { ok: false, call, message: 'No cell number to text the payment link to: ask for one (set_order_details callback_phone).' };
  const cellEnd = c.phone ? c.phone.slice(-4) : undefined;
  if (opts.simulate) {
    const fake = { number: 'TEST', readyAt: new Date(Date.now() + 20 * 60_000).toISOString(), fulfillment: c.fulfillment, total: totals.total, brandName: call.cart[0].brand } as DirectOrder;
    const sms = byLink ? ` The payment link text would read: "${PAYLINK_SMS.link(fake, `${payUrl('TEST-LINK')}`, opts.settings?.payment.expiryMin ?? 30, lang)}".` : '';
    return {
      ok: true, call: { ...call, orderNumber: 'TEST' },
      confirm: orderConfirmation({ number: 'TEST', fulfillment: c.fulfillment, payment: byLink ? 'link' : c.fulfillment === 'pickup' ? 'counter' : 'callback', readyAt: fake.readyAt, cellEnd }, lang),
      message: `SIMULATION — nothing was sent to the kitchen, Clover or the customer. Total ${totals.total.toFixed(2)} $.${sms} The confirmation was already said to the caller; say a short goodbye, then end the call.`,
    };
  }
  const brand = call.cart[0].brand;
  const order = await createDirectOrder({
    source: 'phone_ai', sourceRef: call.id, brandName: brand, locationCode: line.locationCode,
    customer: { name: c.name, phone: c.phone, lang }, fulfillment: c.fulfillment, dropoff: c.dropoff, lines,
    payment: c.fulfillment === 'pickup' ? 'pay_at_pickup' : 'unpaid', deliveryFee: delivery.fee, wantedAt: c.wantedAt,
    notes: `Phone order (AI) — call ${call.id.slice(-6)}`, confirmBySms: byLink ? false : opts.smsConfirmation, holdForPayment: byLink,
    // Couriers never collect money: without a link, a person calls back for the payment before the courier is sent.
    attention: !byLink && c.fulfillment === 'delivery' ? 'Phone delivery: call the customer back to take the payment, then tap "Payment taken".' : undefined,
  }, { username: 'phone-ai', name: 'AI phone agent', source: 'automation' });
  if (byLink) {
    const r = await startPayLink(order, { lang, smsFrom: normalizePhone(call.to) ?? undefined, expiryMin: opts.settings!.payment.expiryMin, reminderMin: opts.settings!.payment.reminderMin, by: 'AI phone agent' });
    if (!r.ok) {
      // The link could not be made: the held order never reached the kitchen — cancel it quietly and say so.
      await cancelHeldOrder(order.id, `Payment link not created: ${r.error}`, 'AI phone agent', { text: false });
      return { ok: false, call: { ...call, linkFailed: true }, message: `The payment link could not be created (${r.error.slice(0, 160)}). Nothing was ordered. ${c.fulfillment === 'pickup' ? 'Offer to pay at the counter instead (place_order payment="counter").' : 'Apologise and call transfer_to_human.'}` };
    }
    const held = r.order;
    return {
      ok: true, order: held,
      call: { ...call, orderId: held.id, orderNumber: held.number, status: 'ordered' },
      confirm: orderConfirmation({ number: held.number, fulfillment: c.fulfillment, payment: 'link', readyAt: held.readyAt, cellEnd }, lang),
      message: `Order ${held.number} is HELD until paid: total ${payTotal(held).toFixed(2)} $. ${r.smsOk ? `The payment link was texted to the number ending in ${cellEnd}.` : 'The text with the link could NOT be sent: apologise, and offer to transfer to a person (transfer_to_human).'} The confirmation was already said to the caller (number, link by text, kitchen after payment). Ask if they received the text; you may check_payment once if they say they paid. Then a short goodbye and end_call.${held.containsAlcohol ? ' Remind them: photo ID (18+).' : ''}`,
    };
  }
  return {
    ok: true, order,
    call: { ...call, orderId: order.id, orderNumber: order.number, status: 'ordered' },
    confirm: orderConfirmation({ number: order.number, fulfillment: c.fulfillment, payment: c.fulfillment === 'pickup' ? 'counter' : 'callback', readyAt: order.readyAt }, lang),
    message: `Order placed: number ${order.number}, total ${order.total.toFixed(2)} $. ${c.fulfillment === 'pickup' ? `Ready around ${order.readyAt ? localTimeLabel(order.readyAt) : ''}; pay at the counter.` : 'A team member will call back to take the payment before the courier leaves; delivery about 45 minutes after that.'} The confirmation (number, time, payment) was already said to the caller.${order.containsAlcohol ? ' Remind them: photo ID (18+).' : ''}${opts.smsConfirmation && c.phone ? ' A confirmation text is on its way.' : ''}${order.posError ? ' (Kitchen note: Clover did not receive it — the team sees it in Food Hub.)' : ''} Say a short goodbye, then end_call.`,
  };
}

export type { CartLine };
