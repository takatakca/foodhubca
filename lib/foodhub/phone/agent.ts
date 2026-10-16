// The AI phone agent: one caller sentence in → what to say back (and whether to keep listening, hand the call to a
// person, or hang up). Claude takes the order with tools that check everything against the real menu and rules; the
// tools — not the model — decide what is possible (open hours, required choices, alcohol, delivery area, totals).
//
// Locked rule: the AI never refunds, cancels, discounts or approves money. It has no tool that could: it can only add or
// remove items in the cart of THIS call, place the order the caller confirmed, check or re-send the payment link of
// THIS order, or transfer to a person. It never takes card numbers (a secure Clover link is texted, or the customer
// pays at the counter; without the link, a person calls back for a delivery's payment).
//
// What the caller hears after an order: the code itself says the order number, the time and how to pay
// (style.ts orderConfirmation), whatever the model writes — text written before a tool call can come back empty.
//
// Model: FOODHUB_PHONE_MODEL (default claude-opus-5-5) at low effort — a phone call needs quick answers. The rules and the
// line's menu are a cached prompt prefix; the conversation is append-only (thinking blocks are passed back unchanged).
// The top-level system prompt is FROZEN for the whole call (stored on the call at the first turn): Claude Opus 5.5 binds
// each thinking block to the exact prefix that produced it (system, tools, earlier messages), and accounts created since
// 2026-08-31 get a 400 when it changes. So a menu that changes during the call (an 86) is enforced by the tools, not by
// rewriting the prompt, and the kitchen a caller chooses on a multi-kitchen line arrives as an appended
// mid-conversation system message carrying that kitchen's menu, hours and payment.
import Anthropic from '@anthropic-ai/sdk';
import { getCatalog } from '../catalog';
import { checkPayLink, resendPayLink } from '../delivery/paylink';
import { getDirectOrder } from '../delivery/store';
import { prepFor } from '../prep';
import { localTimeLabel } from '../time';
import { noteAiFailure, noteAiSuccess, phoneAiUsable } from './ai-health';
import { addToCart, addUpsell, buildPhoneMenu, cartSummary, removeFromCart, upsellOffer, type CartLine, type PhoneMenu } from './cart';
import { say, type PhoneCall, type PhoneLang, type TurnReply } from './calls';
import { kitchenHours, paymentText, phoneDeliveryAvailable, phonePaymentPlan, placePhoneOrder, setOrderDetails } from './order';
import { isMultiKitchen, kitchenView, lineKitchens, type PhoneLine, type PhoneSettings } from './settings';
import { goodDay, orderDigits, personaBlock, personaFor, VOICE_STYLE } from './style';

export function phoneModel(): string {
  return process.env.FOODHUB_PHONE_MODEL || 'claude-opus-5-5';
}

/** The AI key is set (see ai-health.ts phoneAiUsable for "set and working"). */
export function phoneAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const str = (description: string) => ({ type: 'string', description });

const LANG_NAME: Record<PhoneLang, string> = { fr: 'French', en: 'English', es: 'Spanish' };

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'choose_kitchen', strict: true,
    description: 'Lines that serve several kitchens (a KITCHENS list in your instructions): record which kitchen (restaurant) the caller orders from. Needed before add_item. Switching later re-checks the cart against that kitchen\'s menu.',
    input_schema: { type: 'object', additionalProperties: false, required: ['location_code'], properties: { location_code: str('location_code from the KITCHENS list.') } },
  },
  {
    name: 'add_item', strict: true,
    description: 'Add one menu item to the cart with the options the caller chose. Fails (and says why) when a required choice is missing, an option does not fit, or the item is not available.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['brand', 'item_ref', 'quantity', 'option_refs', 'notes'],
      properties: {
        brand: str('Brand name exactly as in the MENU.'), item_ref: str('item_ref from the MENU.'), quantity: { type: 'integer', description: '1 to 20.' },
        option_refs: { type: 'array', items: { type: 'string' }, description: 'option_ref of every option chosen (empty if none).' },
        notes: str('Short kitchen note from the caller ("well done", "no onions"), or empty.'),
      },
    },
  },
  {
    name: 'add_upsell', strict: true,
    description: 'Add Duo, Trio or Combo (UPSELL options in the MENU) to one cart line, after the caller accepted it AND named the drink. The option chosen is the drink. At most one of the three per item.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['line_number', 'option_ref', 'caller_chose_drink'],
      properties: {
        line_number: { type: 'integer', description: 'Cart line of the main dish (as in add_item / view_cart).' },
        option_ref: str('option_ref of the drink in the Duo, Trio or Combo the caller chose.'),
        caller_chose_drink: { type: 'boolean', description: 'true only when the caller said which drink. Never choose it for them.' },
      },
    },
  },
  {
    name: 'remove_item', strict: true, description: 'Remove one line from the cart (line numbers as shown by view_cart).',
    input_schema: { type: 'object', additionalProperties: false, required: ['line_number'], properties: { line_number: { type: 'integer' } } },
  },
  { name: 'view_cart', strict: true, description: 'The cart with line numbers, taxes and the TOTAL to read back.', input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  {
    name: 'set_order_details', strict: true,
    description: 'Record the customer name, pickup or delivery, the delivery address, a callback / texting number and the wanted time. Checks the address, the delivery area and the hours.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['customer_name', 'fulfillment', 'address', 'address_details', 'callback_phone', 'wanted_time'],
      properties: {
        customer_name: str('Name for the order.'), fulfillment: { type: 'string', enum: ['pickup', 'delivery'] },
        address: str('Delivery: street number, street, city, postal code — empty for pickup.'), address_details: str('Apartment, door code, instructions — or empty.'),
        callback_phone: str('Only if the caller gives another number than the one they call from (the cell that receives texts); else empty.'),
        wanted_time: str('HH:MM on a 0–23 hour clock (for example 19:30, or 00:30 for after midnight) if the caller wants a later time; empty = as soon as possible.'),
      },
    },
  },
  {
    name: 'place_order', strict: true, description: 'Send the order. Only after reading back the items and the TOTAL and hearing a clear yes. With a payment link the order is held and goes to the kitchen once paid.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['caller_confirmed', 'payment'],
      properties: {
        caller_confirmed: { type: 'boolean', description: 'true only when the caller clearly confirmed the total.' },
        payment: { type: 'string', enum: ['link', 'counter'], description: 'link = secure Clover payment link by text (see PAYMENT); counter = pay at the counter for pickup / a team member calls back for a delivery.' },
      },
    },
  },
  {
    name: 'check_payment', strict: true, description: 'Ask Clover once whether the payment link of the order placed on this call was paid (when the caller says they paid).',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'resend_payment_link', strict: true, description: 'Text the payment link of the order placed on this call again (the caller did not get it).',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'set_language', strict: true, description: 'Switch the call to French, English or Spanish (speech recognition and voice). Call it FIRST as soon as the caller speaks another language than the current one.',
    input_schema: { type: 'object', additionalProperties: false, required: ['language'], properties: { language: { type: 'string', enum: ['fr', 'en', 'es'] } } },
  },
  {
    name: 'transfer_to_human', strict: true, description: 'Hand the call to a team member: refunds, complaints, cancelling or changing an earlier order, payment questions, allergies you cannot answer from the menu, large orders, or the caller asks for a person.',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str('Why, in a few words (for the team).') } },
  },
  {
    name: 'end_call', strict: true, description: 'Hang up after your goodbye (order placed, or the caller is done).',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str('Why the call ends.') } },
  },
];

export const RULES = `You are the phone ordering assistant of ON2GO, a group of real neighbourhood restaurants in Montréal, Québec. You answer real phone calls.

${VOICE_STYLE}

Taking the order
- If your instructions list several KITCHENS, first find out which restaurant the caller wants (ask, or deduce it when the brand they name is sold in only one kitchen) and call choose_kitchen. The MENU of that kitchen then appears.
- Sell only what is in the MENU. Never invent items, prices, options, specials, discounts or promotions. If something is not there, say so and suggest something close from the MENU.
- Call add_item as soon as the caller decides on an item, and confirm it in a few words (« Parfait, un poulet entier piri-piri. »). When a tool says a required choice is missing, ask exactly that question.
- The upsell: when add_item says UPSELL, offer it ONCE in one short sentence with the prices of its options (« Voulez-vous en faire un Duo avec un breuvage pour 2,50 $, un Trio avec petite frite et breuvage pour 5,42 $, ou un Combo avec petite poutine et breuvage pour 7,58 $ ? »). If the caller says yes, ALWAYS ask which drink (never choose it), then call add_upsell. Only one of Duo, Trio or Combo per item. If the caller says no or is in a hurry, do not offer it again on this call. Without an UPSELL in the menu, suggest at most one drink or side from the MENU once, never alcohol.
- Then get the name, pickup or delivery (for delivery: street number, street, apartment, door code, postal code) and call set_order_details.
- Call view_cart and read back every item and the TOTAL with taxes, plus pickup or delivery and the time. Only after a clear yes, call place_order with caller_confirmed=true and the payment chosen as PAYMENT says.
- After place_order succeeds, Food Hub itself tells the caller the order number, the time and how to pay: do not repeat them. Answer a last question if any, then a warm short goodbye (« Merci d'avoir commandé chez <brand>, bonne soirée ! ») and call end_call.

Hours
- Only the HOURS in your instructions. If the kitchen is closed now, say when it opens and offer an order for a time it is open (wanted_time). If the HOURS are NOT SET, never say we are open or give hours: transfer_to_human.

Absolute rules
- Never take card numbers or any payment details by phone. Payment is the texted Clover link, the counter, or a call back from the team, as PAYMENT says.
- Never give or promise refunds, discounts, credits or free items; never cancel or change an order placed earlier. For a complaint, a refund, a cancellation, a problem with an earlier order, a payment question, an allergy you cannot answer from the menu, a large catering order, or when the caller asks for a person: call transfer_to_human.
- Alcohol only if it is in the MENU (it is then legal now). Tell the caller photo ID (18+) is checked at pickup or at the door. If the caller sounds underage or intoxicated, do not sell alcohol — transfer instead.
- If the caller is abusive, or nothing makes sense after two tries, call transfer_to_human.`;

export interface AgentContext {
  /** The line as the agent works it now: one kitchen (its menu, hours, delivery) — or, before a choice, the whole multi-kitchen line. */
  line: PhoneLine;
  /** The line as configured (all its kitchens). Defaults to `line`. */
  configured?: PhoneLine;
  menu: PhoneMenu;
  settings: PhoneSettings;
  simulate: boolean;
  now?: number;
}

/** A line with several kitchens and none chosen yet for this call. */
export function needsKitchen(ctx: Pick<AgentContext, 'line' | 'configured'>, call: Pick<PhoneCall, 'locationCode'>): boolean {
  return isMultiKitchen(ctx.configured ?? ctx.line) && !call.locationCode;
}

async function kitchenLines(configured: PhoneLine, settings: PhoneSettings, now: number): Promise<string[]> {
  const locations = (await getCatalog()).locations;
  const out: string[] = [];
  for (const k of lineKitchens(configured)) {
    const loc = locations.find((l) => l.code === k.locationCode);
    const hours = await kitchenHours(k, now);
    const pay = await phonePaymentPlan(k, settings);
    out.push(`- location_code=${k.locationCode} | ${loc?.name ?? k.locationCode}${loc?.address ? `, ${loc.address}, ${loc.city ?? 'Montréal'}` : ''} | brands: ${k.brands.join(', ')} | ${hours.text} | payment: ${pay.link ? 'Clover link by text' : 'at the counter'}`);
  }
  return out;
}

/** The system prompt's line part, computed once at the first turn of a call and then frozen (see the header). */
async function lineBlock(ctx: AgentContext, call: PhoneCall): Promise<string> {
  const configured = ctx.configured ?? ctx.line;
  const now = ctx.now ?? Date.now();
  const persona = personaBlock(personaFor(ctx.settings.persona, ctx.settings.voiceFr));
  if (needsKitchen(ctx, call)) {
    return [
      persona,
      `THIS LINE: ${configured.name}`,
      'This phone number serves several kitchens. Before adding items, find out which restaurant the caller wants: ask (name the neighbourhoods), or deduce it when the brand they name is sold in only one kitchen. Then call choose_kitchen. For a delivery, prefer the kitchen closest to the caller.',
      'Taxes: GST + QST (14.975 %) are added to menu prices. Prices in CAD.',
      '',
      'KITCHENS',
      ...(await kitchenLines(configured, ctx.settings, now)),
    ].join('\n');
  }
  return `${persona}\n${await kitchenBlock(ctx)}`;
}

/** One kitchen of the line: brands, address, hours, pickup / delivery, payment, alcohol, and its live MENU. */
async function kitchenBlock(ctx: AgentContext): Promise<string> {
  const configured = ctx.configured ?? ctx.line;
  const now = ctx.now ?? Date.now();
  const loc = (await getCatalog()).locations.find((l) => l.code === ctx.line.locationCode);
  const delivery = await phoneDeliveryAvailable(ctx.line);
  const others = isMultiKitchen(configured) ? lineKitchens(configured).filter((k) => k.locationCode !== ctx.line.locationCode) : [];
  const hours = await kitchenHours(ctx.line, now);
  const pay = await phonePaymentPlan(ctx.line, ctx.settings);
  return [
    `THIS LINE: ${ctx.line.name}`,
    `Brands sold on this line: ${ctx.line.brands.join(', ')}`,
    `Kitchen: ${loc?.name ?? ctx.line.locationCode}${loc?.address ? `, ${loc.address}, ${loc.city ?? 'Montréal'}` : ''}${others.length ? ` (chosen by the caller; other kitchens on this number: ${others.map((k) => `location_code=${k.locationCode} (${k.brands.join(', ')})`).join('; ')} — choose_kitchen switches)` : ''}`,
    hours.text,
    `Pickup: yes. Delivery: ${delivery.available ? `yes, fee ${delivery.fee.toFixed(2)} $ (delivery area checked by set_order_details)` : `no (${delivery.reason})`}.`,
    paymentText(pay),
    `Alcohol by phone right now: ${ctx.menu.alcohol.allowed ? `yes, 18+ with photo ID${ctx.menu.alcohol.requireFood ? ', only with food' : ''}` : 'no'}.`,
    'Taxes: GST + QST (14.975 %) are added to menu prices. Prices in CAD.',
    '',
    'MENU',
    ctx.menu.text,
  ].join('\n');
}

/** The first message of a call: the moment, the kitchen state, and the caller's first words. */
async function openingContext(call: PhoneCall, ctx: AgentContext): Promise<string> {
  const now = ctx.now ?? Date.now();
  const who = `Caller ID: ${call.from && call.from !== 'anonymous' ? 'known (use it for the order and the texts)' : 'hidden (ask for a cell number)'}. Language: ${LANG_NAME[call.lang]}.`;
  if (needsKitchen(ctx, call)) {
    return `[Call started ${localTimeLabel(now)} (Montréal time). This number serves ${lineKitchens(ctx.configured ?? ctx.line).length} kitchens: find out which one, then choose_kitchen. ${who}]`;
  }
  const prep = await prepFor(ctx.line.locationCode);
  const hours = await kitchenHours(ctx.line, now);
  const state = hours.state === 'open' ? 'yes' : hours.state === 'unknown' ? 'UNKNOWN (hours not set — transfer_to_human for an order)' : 'NO — take only orders for a later time when it is open (see HOURS), or apologise';
  return `[Call started ${localTimeLabel(now)} (Montréal time). Kitchen open now: ${state}. Prep time about ${prep.minutes} min. ${who}]`;
}

function client(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    // A phone turn must answer quickly; Twilio waits 15 s per request (slow turns continue on a redirect).
    timeout: 20_000,
    maxRetries: 1,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
}

/** Text for the voice: no markdown, no list marks, never a web address (a payment link is texted, never read). */
export const clean = (s: string) => s.replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/[*_#`>]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();

type ToolOutcome = { content: string; isError?: boolean; next?: TurnReply['next'] };

const KITCHEN_FIRST = new Set(['add_item', 'add_upsell', 'set_order_details', 'place_order']);

interface TurnState { call: PhoneCall; kitchenChanged?: boolean; /** Said by the code after place_order (number, time, payment). */ confirm?: string; confirmDigits?: string }

/** choose_kitchen: the caller's kitchen on a multi-kitchen line. The cart (if any) must exist on that kitchen's menu. */
async function chooseKitchen(code: string, state: TurnState, ctx: AgentContext): Promise<ToolOutcome> {
  const call = state.call;
  const configured = ctx.configured ?? ctx.line;
  const kitchens = lineKitchens(configured);
  const view = kitchenView(configured, code);
  if (!view) return { content: `Unknown kitchen "${code}". Kitchens on this line: ${kitchens.map((k) => k.locationCode).join(', ')}.`, isError: true };
  if (call.locationCode === view.locationCode) return { content: `The kitchen is already ${view.locationCode}.` };
  const now = ctx.now ?? Date.now();
  const menu = await buildPhoneMenu(view, now);
  // An item may be sold out (86) or not sold at the other kitchen: the switch is refused rather than dropping it silently.
  let cart: CartLine[] = [];
  for (const l of call.cart) {
    const r = addToCart(menu, cart, { brand: l.brand, item_ref: l.itemRef, quantity: l.quantity, option_refs: l.modifiers.map((m) => m.ref), notes: l.notes ?? '' });
    if (!r.ok) return { content: `Cannot switch to ${view.locationCode}: "${l.name}" — ${r.error} Stay with the current kitchen, or remove that item first.`, isError: true };
    cart = r.cart;
  }
  const switched = Boolean(call.locationCode);
  // Pickup / delivery details were checked against the previous kitchen (area, hours): asked again after a switch.
  const customer = switched ? { name: call.customer.name, phone: call.customer.phone } : call.customer;
  state.call = { ...call, locationCode: view.locationCode, brands: view.brands, cart, customer };
  ctx.line = view;
  ctx.menu = menu;
  state.kitchenChanged = true;
  const loc = (await getCatalog()).locations.find((l) => l.code === view.locationCode);
  const hours = await kitchenHours(view, now);
  const prep = await prepFor(view.locationCode);
  return {
    content: `Kitchen set: ${loc?.name ?? view.locationCode}. Brands: ${view.brands.join(', ')}. ${hours.text} Prep about ${prep.minutes} min. Its MENU, hours and payment are now in your instructions.${switched ? ' The cart was re-checked; ask pickup or delivery again (set_order_details).' : ''}`,
  };
}

async function runTool(name: string, input: any, state: TurnState, ctx: AgentContext): Promise<ToolOutcome> {
  const call = state.call;
  if (KITCHEN_FIRST.has(name) && needsKitchen(ctx, call)) {
    return { content: 'No kitchen chosen yet: ask which restaurant (KITCHENS in your instructions), then call choose_kitchen.', isError: true };
  }
  switch (name) {
    case 'choose_kitchen':
      return chooseKitchen(String(input.location_code ?? '').trim().toUpperCase(), state, ctx);
    case 'add_item': {
      const r = addToCart(ctx.menu, call.cart, input);
      if (!r.ok) return { content: r.error, isError: true };
      state.call = { ...call, cart: r.cart };
      // The upsell is offered once per call, after the first main dish that has one (the code decides, not the model).
      const offer = call.upsellOffered ? null : upsellOffer(ctx.menu, r.cart[r.cart.length - 1]);
      if (offer) {
        state.call = { ...state.call, upsellOffered: true };
        return { content: `${r.message} UPSELL (offer it now, once, in one short sentence with these prices; if yes, ask which drink, then add_upsell line ${r.cart.length}): ${offer}` };
      }
      return { content: r.message };
    }
    case 'add_upsell': {
      const r = addUpsell(ctx.menu, call.cart, input);
      if (!r.ok) return { content: r.error, isError: true };
      state.call = { ...call, cart: r.cart, upsellOffered: true };
      return { content: r.message };
    }
    case 'remove_item': {
      const r = removeFromCart(call.cart, Number(input.line_number));
      if (!r.ok) return { content: r.error, isError: true };
      state.call = { ...call, cart: r.cart };
      return { content: r.message };
    }
    case 'view_cart': {
      const delivery = call.customer.fulfillment === 'delivery' ? (await phoneDeliveryAvailable(ctx.line)).fee : 0;
      return { content: cartSummary(call.cart, delivery) };
    }
    case 'set_order_details': {
      const others = lineKitchens(ctx.configured ?? ctx.line).map((k) => k.locationCode).filter((c) => c !== ctx.line.locationCode);
      const r = await setOrderDetails(call, ctx.line, input, others);
      state.call = r.call;
      return { content: r.message, isError: !r.ok };
    }
    case 'place_order': {
      const r = await placePhoneOrder(call, ctx.line, ctx.menu, { confirmed: input.caller_confirmed === true, simulate: ctx.simulate, smsConfirmation: ctx.settings.smsConfirmation, payment: input.payment === 'counter' ? 'counter' : 'link', settings: ctx.settings });
      state.call = r.call;
      if (r.ok) {
        state.call = say(state.call, 'system', `Order placed: ${r.order?.number ?? 'TEST'} (${r.order ? `${r.order.total.toFixed(2)} $${r.order.status === 'awaiting_payment' ? ', waiting for the payment link' : ''}` : 'simulation'})`);
        if (r.confirm) { state.confirm = r.confirm; state.confirmDigits = orderDigits(r.order?.number ?? 'TEST'); }
      }
      return { content: r.message, isError: !r.ok };
    }
    case 'check_payment': {
      if (!call.orderId) return { content: 'No order with a payment link on this call.', isError: true };
      if (ctx.simulate) return { content: 'SIMULATION: payment not checked (no real link).' };
      const r = await checkPayLink(call.orderId, 'phone');
      const say_ = r.state === 'paid' ? 'Paid: the order is going to the kitchen now. Tell the caller, warmly.' : r.state === 'pending' ? 'Not paid yet. Tell the caller the order starts as soon as the payment goes through; they can pay by the texted link.' : `The link is ${r.state}. Apologise; offer a team member (transfer_to_human).`;
      return { content: say_ };
    }
    case 'resend_payment_link': {
      if (!call.orderId) return { content: 'No order with a payment link on this call.', isError: true };
      if (ctx.simulate) return { content: 'SIMULATION: the link would be texted again.' };
      const o = await getDirectOrder(call.orderId);
      if (!o?.paylink || o.status !== 'awaiting_payment') return { content: 'This order has no payment link waiting.', isError: true };
      try {
        await resendPayLink(o.id, { username: 'phone-ai', name: 'AI phone agent', source: 'automation' });
        return { content: `Texted again to the number ending in ${(o.customer.phone ?? '').slice(-4)}.` };
      } catch (e) {
        return { content: `Not sent: ${e instanceof Error ? e.message : String(e)}. Offer a team member.`, isError: true };
      }
    }
    case 'set_language': {
      const lang: PhoneLang = input.language === 'en' || input.language === 'es' ? input.language : 'fr';
      state.call = { ...call, lang };
      return { content: `Language set to ${LANG_NAME[lang]}. Continue in that language.` };
    }
    case 'transfer_to_human': {
      state.call = { ...call, handoffReason: String(input.reason ?? '').slice(0, 200) };
      return { content: 'Transferring: tell the caller in one short sentence that you are transferring them to a team member.', next: 'handoff' };
    }
    case 'end_call':
      return { content: 'The call ends after this reply. If the caller has not heard the order number, the time and how to pay yet, say them now; then a short warm goodbye. If you already said goodbye, answer with nothing more.', next: 'hangup' };
    default:
      return { content: `Unknown tool ${name}.`, isError: true };
  }
}

const FALLBACK: Record<PhoneLang, { handoff: string; again: string }> = {
  fr: { handoff: 'Un petit instant, je vous transfère à un membre de notre équipe.', again: 'Pardon, la ligne est un peu mauvaise. Pouvez-vous répéter ?' },
  en: { handoff: 'One moment, I’m transferring you to a team member.', again: 'Sorry, the line is a bit faint. Could you say that again?' },
  es: { handoff: 'Un momento, le transfiero a un miembro de nuestro equipo.', again: 'Perdón, la línea está un poco mala. ¿Puede repetirlo?' },
};

/**
 * One turn of the conversation. Returns the call as updated (cart, details, history, usage) and what to say.
 * Never throws: any failure hands the call to a person.
 */
export async function runAgentTurn(call: PhoneCall, callerText: string, ctx: AgentContext): Promise<{ call: PhoneCall; reply: TurnReply }> {
  const state: TurnState = { call: say({ ...call, turns: call.turns + 1 }, 'caller', callerText || '(silence)') };
  const handoff = (why: string): { call: PhoneCall; reply: TurnReply } => {
    // An order placed during this turn is still confirmed to the caller before the transfer.
    const text = [state.confirm, FALLBACK[state.call.lang].handoff].filter(Boolean).join(' ');
    state.call = say({ ...state.call, handoffReason: state.call.handoffReason ?? why, error: why }, 'agent', text);
    return { call: state.call, reply: { say: text, next: 'handoff', lang: state.call.lang, ...(state.confirm ? { confirm: state.confirm } : {}) } };
  };
  if (!phoneAgentConfigured()) return handoff('ANTHROPIC_API_KEY is not set');
  if (!(await phoneAiUsable())) return handoff('Phone AI paused (circuit breaker: the last requests failed)');
  if (state.call.turns > ctx.settings.maxTurns) return handoff(`More than ${ctx.settings.maxTurns} turns`);

  const first = (call.messages ?? []).length === 0;
  const messages = [...(call.messages as Anthropic.Beta.BetaMessageParam[] ?? [])];
  messages.push({ role: 'user', content: first ? `${await openingContext(call, ctx)}\n${callerText || '(silence)'}` : callerText || '(the caller said nothing)' });
  // Frozen for the whole call (see the header): computed at the first turn, then reused byte for byte.
  const prompt = state.call.prompt ?? (await lineBlock(ctx, state.call));
  state.call = { ...state.call, prompt };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: RULES },
    { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
  ];
  let next: TurnReply['next'] = 'listen';
  const said: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, ...(call.usage ?? {}) };
  try {
    const api = client();
    for (let step = 0; step < 6; step++) {
      const res = await api.beta.messages.create({
        model: phoneModel(),
        max_tokens: 2048,
        system,
        tools: TOOLS,
        messages,
        output_config: { effort: 'low' },
        // A safety decline on the main model is retried server-side on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      usage.requests++;
      usage.inputTokens += res.usage?.input_tokens ?? 0;
      usage.outputTokens += res.usage?.output_tokens ?? 0;
      usage.cacheReadTokens += res.usage?.cache_read_input_tokens ?? 0;
      if (step === 0) await noteAiSuccess();
      if (res.stop_reason === 'refusal') { state.call = { ...state.call, usage }; return handoff('The AI declined to continue'); }
      messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      // Every step's words are spoken, in order (text written next to a tool call is not lost).
      const stepText = clean(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(' '));
      if (stepText) said.push(stepText);
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && uses.length) {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          const out = await runTool(u.name, u.input, state, ctx);
          if (out.next) next = out.next;
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        // The caller chose (or switched) the kitchen: its menu arrives as an appended system message, after the tool
        // results — never by rewriting the system prompt.
        if (state.kitchenChanged) {
          state.kitchenChanged = false;
          messages.push({ role: 'system', content: `KITCHEN CHOSEN. From now on sell only from this kitchen and this MENU (it replaces any kitchen chosen earlier in the call).\n${await kitchenBlock(ctx)}` });
        }
        continue;
      }
      let spoken = said.join(' ');
      // The order number, time and payment are always heard, whatever the model wrote (or did not write).
      if (state.confirm && !(state.confirmDigits && spoken.includes(state.confirmDigits))) spoken = `${state.confirm} ${spoken}`.trim();
      if (!spoken) spoken = next === 'handoff' ? FALLBACK[state.call.lang].handoff : next === 'hangup' ? goodDay(state.call.lang) : FALLBACK[state.call.lang].again;
      else if (next === 'hangup' && state.confirm && !said.length) spoken = `${spoken} ${goodDay(state.call.lang)}`;
      state.call = say({ ...state.call, messages, usage }, 'agent', spoken);
      if (next === 'handoff') state.call = { ...state.call, status: 'handoff' };
      return { call: state.call, reply: { say: spoken, next, lang: state.call.lang } };
    }
    state.call = { ...state.call, messages, usage };
    return handoff('Too many steps in one turn');
  } catch (e) {
    state.call = { ...state.call, usage };
    const f = await noteAiFailure(e, { test: ctx.simulate || state.call.simulated });
    return handoff(`AI error (${f.kind}): ${f.reason}`);
  }
}
