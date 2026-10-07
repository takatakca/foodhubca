// The AI phone agent: one caller sentence in → what to say back (and whether to keep listening, hand the call to a
// person, or hang up). Claude takes the order with tools that check everything against the real menu and rules; the
// tools — not the model — decide what is possible (open hours, required choices, alcohol, delivery area, totals).
//
// Locked rule: the AI never refunds, cancels, discounts or approves money. It has no tool that could: it can only add or
// remove items in the cart of THIS call, place the order the caller confirmed, or transfer to a person. It never takes
// card numbers (pickup is paid at the counter; for delivery a person calls back for the payment).
//
// Model: FOODHUB_PHONE_MODEL (default claude-opus-5-5) at low effort — a phone call needs quick answers. The rules and the
// line's menu are a cached prompt prefix; the conversation is append-only (thinking blocks are passed back unchanged).
import Anthropic from '@anthropic-ai/sdk';
import { getCatalog } from '../catalog';
import { prepFor } from '../prep';
import { localTimeLabel } from '../time';
import { addToCart, cartSummary, removeFromCart, type PhoneMenu } from './cart';
import { say, type PhoneCall, type TurnReply } from './calls';
import { openNow, phoneDeliveryAvailable, placePhoneOrder, setOrderDetails } from './order';
import type { PhoneLine, PhoneSettings } from './settings';

export function phoneModel(): string {
  return process.env.FOODHUB_PHONE_MODEL || 'claude-opus-5-5';
}

export function phoneAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const str = (description: string) => ({ type: 'string', description });

export const TOOLS: Anthropic.Beta.BetaTool[] = [
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
    name: 'remove_item', strict: true, description: 'Remove one line from the cart (line numbers as shown by view_cart).',
    input_schema: { type: 'object', additionalProperties: false, required: ['line_number'], properties: { line_number: { type: 'integer' } } },
  },
  { name: 'view_cart', strict: true, description: 'The cart with line numbers, taxes and the TOTAL to read back.', input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  {
    name: 'set_order_details', strict: true,
    description: 'Record the customer name, pickup or delivery, the delivery address, a callback number and the wanted time. Checks the address and the delivery area.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['customer_name', 'fulfillment', 'address', 'address_details', 'callback_phone', 'wanted_time'],
      properties: {
        customer_name: str('Name for the order.'), fulfillment: { type: 'string', enum: ['pickup', 'delivery'] },
        address: str('Delivery: street number, street, city, postal code — empty for pickup.'), address_details: str('Apartment, door code, instructions — or empty.'),
        callback_phone: str('Only if the caller gives another number than the one they call from; else empty.'),
        wanted_time: str('HH:MM (24 h) today if the caller wants a later time; empty = as soon as possible.'),
      },
    },
  },
  {
    name: 'place_order', strict: true, description: 'Send the order to the kitchen. Only after reading back the items and the TOTAL and hearing a clear yes.',
    input_schema: { type: 'object', additionalProperties: false, required: ['caller_confirmed'], properties: { caller_confirmed: { type: 'boolean', description: 'true only when the caller clearly confirmed the total.' } } },
  },
  {
    name: 'set_language', strict: true, description: 'Switch the call to French or English (speech recognition and voice).',
    input_schema: { type: 'object', additionalProperties: false, required: ['language'], properties: { language: { type: 'string', enum: ['fr', 'en'] } } },
  },
  {
    name: 'transfer_to_human', strict: true, description: 'Hand the call to a team member: refunds, complaints, cancelling or changing an earlier order, payment questions, allergies you cannot answer from the menu, large orders, or the caller asks for a person.',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str('Why, in a few words (for the team).') } },
  },
  {
    name: 'end_call', strict: true, description: 'Hang up after saying goodbye (order placed, or the caller is done).',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str('Why the call ends.') } },
  },
];

export const RULES = `You are the phone ordering assistant of a restaurant group in Montréal, Québec. You answer real phone calls: what you write is spoken by a text-to-speech voice, and the caller's words come from speech recognition (expect misheard words — ask again when unsure, especially for names, numbers and postal codes).

How to talk
- Friendly, efficient restaurant employee. Short sentences, one question at a time. Never lists, markdown, emojis or links.
- Speak the caller's language: Québec French by default, English if the caller speaks English (then call set_language).
- Prices: "24,99 $" in French, "$24.99" in English. Never say item_ref / option_ref codes — they are for the tools.

Taking the order
- Sell only what is in the MENU of this line. Never invent items, prices, options, specials, discounts or promotions. If something is not there, say so and suggest something close.
- Call add_item as soon as the caller decides on an item. When a tool says a required choice is missing, ask exactly that question.
- Then get the name, pickup or delivery (for delivery: street number, street, apartment, door code, postal code) and call set_order_details.
- Call view_cart and read back every item and the TOTAL with taxes. Only after a clear yes, call place_order with caller_confirmed=true.
- After place_order succeeds: give the order number, the time and how to pay, say goodbye, then call end_call.

Absolute rules
- Never take card numbers or any payment details. Pickup is paid at the counter. Delivery: a team member calls back to take the payment before the courier leaves.
- Never give or promise refunds, discounts, credits or free items; never cancel or change an order placed earlier. For a complaint, a refund, a cancellation, a problem with an earlier order, a payment question, an allergy you cannot answer from the menu, a large catering order, or when the caller asks for a person: call transfer_to_human.
- Alcohol only if it is in the MENU (it is then legal now). Tell the caller photo ID (18+) is checked at pickup or at the door. If the caller sounds underage or intoxicated, do not sell alcohol — transfer instead.
- If the caller is abusive, or nothing makes sense after two tries, call transfer_to_human.
- If asked, say honestly that you are an automated AI assistant.`;

export interface AgentContext {
  line: PhoneLine;
  menu: PhoneMenu;
  settings: PhoneSettings;
  simulate: boolean;
  now?: number;
}

async function lineBlock(ctx: AgentContext): Promise<string> {
  const loc = (await getCatalog()).locations.find((l) => l.code === ctx.line.locationCode);
  const delivery = await phoneDeliveryAvailable(ctx.line);
  return [
    `THIS LINE: ${ctx.line.name}`,
    `Brands sold on this line: ${ctx.line.brands.join(', ')}`,
    `Kitchen: ${loc?.name ?? ctx.line.locationCode}${loc?.address ? `, ${loc.address}, ${loc.city ?? 'Montréal'}` : ''}`,
    `Pickup: yes. Delivery: ${delivery.available ? `yes, fee ${delivery.fee.toFixed(2)} $ (delivery area checked by set_order_details)` : `no (${delivery.reason})`}.`,
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
  const prep = await prepFor(ctx.line.locationCode);
  const open = await openNow(ctx.line, now);
  return `[Call started ${localTimeLabel(now)} (Montréal time). Kitchen open now: ${open ? 'yes' : 'NO — take only orders for a later time today when it is open, or apologise'}. Prep time about ${prep.minutes} min. Caller ID: ${call.from && call.from !== 'anonymous' ? 'known (use it for the order)' : 'hidden (ask for a number)'}. Language: ${call.lang === 'fr' ? 'French' : 'English'}.]`;
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

const clean = (s: string) => s.replace(/[*_#`>]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();

type ToolOutcome = { content: string; isError?: boolean; next?: TurnReply['next'] };

async function runTool(name: string, input: any, state: { call: PhoneCall }, ctx: AgentContext): Promise<ToolOutcome> {
  const call = state.call;
  switch (name) {
    case 'add_item': {
      const r = addToCart(ctx.menu, call.cart, input);
      if (!r.ok) return { content: r.error, isError: true };
      state.call = { ...call, cart: r.cart };
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
      const r = await setOrderDetails(call, ctx.line, input);
      state.call = r.call;
      return { content: r.message, isError: !r.ok };
    }
    case 'place_order': {
      const r = await placePhoneOrder(call, ctx.line, ctx.menu, { confirmed: input.caller_confirmed === true, simulate: ctx.simulate, smsConfirmation: ctx.settings.smsConfirmation });
      state.call = r.call;
      if (r.ok) state.call = say(state.call, 'system', `Order placed: ${r.order?.number ?? 'TEST'} (${r.order ? `${r.order.total.toFixed(2)} $` : 'simulation'})`);
      return { content: r.message, isError: !r.ok };
    }
    case 'set_language': {
      const lang = input.language === 'en' ? 'en' : 'fr';
      state.call = { ...call, lang };
      return { content: `Language set to ${lang === 'en' ? 'English' : 'French'}. Continue in that language.` };
    }
    case 'transfer_to_human': {
      state.call = { ...call, handoffReason: String(input.reason ?? '').slice(0, 200) };
      return { content: 'Transferring: tell the caller in one short sentence that you are transferring them to a team member.', next: 'handoff' };
    }
    case 'end_call':
      return { content: 'Say a short goodbye; the call ends after it.', next: 'hangup' };
    default:
      return { content: `Unknown tool ${name}.`, isError: true };
  }
}

const FALLBACK: Record<'fr' | 'en', { handoff: string; again: string }> = {
  fr: { handoff: 'Un instant, je vous transfère à un membre de l’équipe.', again: 'Pardon, pouvez-vous répéter ?' },
  en: { handoff: 'One moment, I am transferring you to a team member.', again: 'Sorry, could you say that again?' },
};

/**
 * One turn of the conversation. Returns the call as updated (cart, details, history, usage) and what to say.
 * Never throws: any failure hands the call to a person.
 */
export async function runAgentTurn(call: PhoneCall, callerText: string, ctx: AgentContext): Promise<{ call: PhoneCall; reply: TurnReply }> {
  const state = { call: say({ ...call, turns: call.turns + 1 }, 'caller', callerText || '(silence)') };
  const handoff = (why: string): { call: PhoneCall; reply: TurnReply } => {
    state.call = say({ ...state.call, handoffReason: state.call.handoffReason ?? why, error: why }, 'agent', FALLBACK[state.call.lang].handoff);
    return { call: state.call, reply: { say: FALLBACK[state.call.lang].handoff, next: 'handoff', lang: state.call.lang } };
  };
  if (!phoneAgentConfigured()) return handoff('ANTHROPIC_API_KEY is not set');
  if (state.call.turns > ctx.settings.maxTurns) return handoff(`More than ${ctx.settings.maxTurns} turns`);

  const first = (call.messages ?? []).length === 0;
  const messages = [...(call.messages as Anthropic.Beta.BetaMessageParam[] ?? [])];
  messages.push({ role: 'user', content: first ? `${await openingContext(call, ctx)}\n${callerText || '(silence)'}` : callerText || '(the caller said nothing)' });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: RULES },
    { type: 'text', text: await lineBlock(ctx), cache_control: { type: 'ephemeral' } },
  ];
  let next: TurnReply['next'] = 'listen';
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
      if (res.stop_reason === 'refusal') { state.call = { ...state.call, usage }; return handoff('The AI declined to continue'); }
      messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && uses.length) {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const u of uses) {
          const out = await runTool(u.name, u.input, state, ctx);
          if (out.next) next = out.next;
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      const text = clean(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(' '));
      const spoken = text || (next === 'handoff' ? FALLBACK[state.call.lang].handoff : FALLBACK[state.call.lang].again);
      state.call = say({ ...state.call, messages, usage }, 'agent', spoken);
      if (next === 'handoff') state.call = { ...state.call, status: 'handoff' };
      return { call: state.call, reply: { say: spoken, next, lang: state.call.lang } };
    }
    state.call = { ...state.call, messages, usage };
    return handoff('Too many steps in one turn');
  } catch (e) {
    state.call = { ...state.call, usage };
    return handoff(`AI error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}
