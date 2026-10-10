// ON2GO phone menu — the AI that talks with the caller right after the greeting.
//
// It understands what the caller wants and either handles it itself (a problem with an online order, a card charge,
// billing, merchant or courier sign-up, customer service: explain, look up OUR orders, text a link, open a ticket) or
// routes the call with a tool (route_to): the ordering assistant, a platform order (capture the order number, save the
// reference, transfer to that platform's official support), a person, or voicemail. The keypad stays a silent
// fallback; after two misunderstandings (not_understood) the caller hears the short keypad menu.
//
// Locked rules (same as the ordering agent): the AI never refunds, cancels, discounts, credits or promises money; it
// never asks for or accepts card numbers (and card-like numbers are removed before it sees the caller's words); it
// cannot see or change a platform's order.
//
// Same frozen-prompt rule as ../agent.ts: the system prompt (rules + this call's menu block) is computed at the first
// AI turn and stored on the call; it never changes during the call (Claude binds thinking blocks to the exact prefix).
// Later context — a key the caller pressed, a step that finished — is appended to the conversation as text.
import Anthropic from '@anthropic-ai/sdk';
import { listDirectOrders } from '../../delivery/store';
import type { DirectOrder } from '../../delivery/types';
import { normalizePhone, sendSms } from '../../notify';
import { localTimeLabel } from '../../time';
import { phoneAgentConfigured, phoneModel } from '../agent';
import { findNode, LINK_KEYS, PLATFORM_IDS, PLATFORM_NAME, walk, type IvrLang, type IvrNode, type IvrSettings, type LinkKey, type PlatformId } from './config';
import { note, openTicket, TICKET_CATEGORIES, visit, withOrderId, type IvrCall, type IvrReply, type TicketCategory } from './records';
import { normalizeOrderId } from './words';

const str = (description: string) => ({ type: 'string', description });

export const IVR_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'route_to', strict: true,
    description: 'Send the call to a branch of the ON2GO menu (BRANCHES in your instructions). Branches marked "AI" are handled by you right after (follow that flow); every other branch takes over the call: do not say anything after calling it.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['branch', 'platform', 'order_id', 'note'],
      properties: {
        branch: str('Branch id from BRANCHES.'),
        platform: { type: 'string', enum: ['', ...PLATFORM_IDS], description: 'For a platform order: ubereats, doordash or skip when known, else empty.' },
        order_id: str('Platform order number if the caller already said it clearly, else empty.'),
        note: str('A few words for the team (why), or empty.'),
      },
    },
  },
  {
    name: 'lookup_order', strict: true,
    description: 'Find an order the caller placed with US (ON2GO, Clover online ordering, our restaurant websites, our phone line) in the last 30 days, by order number or by the number the caller is calling from. Never for Uber Eats, DoorDash or SkipTheDishes orders.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['order_number', 'use_caller_number'],
      properties: { order_number: str('Order number as the caller said it, or empty.'), use_caller_number: { type: 'boolean', description: 'true to search by the number the caller is calling from.' } },
    },
  },
  {
    name: 'send_link', strict: true, description: 'Text the caller one ON2GO link (sign-up page, help page, billing help, ordering site).',
    input_schema: { type: 'object', additionalProperties: false, required: ['link'], properties: { link: { type: 'string', enum: LINK_KEYS } } },
  },
  {
    name: 'open_ticket', strict: true,
    description: 'Write down a request for the ON2GO team: a lead (merchant or courier sign-up), a problem with an online order, a card charge question, billing, or anything that needs a person to follow up. Include the caller\'s name and the details they gave.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['category', 'summary', 'order_ref'],
      properties: {
        category: { type: 'string', enum: TICKET_CATEGORIES },
        summary: str('What the caller needs, with their name and details, in one or two sentences (in English or French).'),
        order_ref: str('Order number concerned, or empty.'),
      },
    },
  },
  {
    name: 'set_language', strict: true, description: 'Switch the call to French, English or Spanish (voice and speech recognition). Call it as soon as the caller speaks another language than the current one.',
    input_schema: { type: 'object', additionalProperties: false, required: ['language'], properties: { language: { type: 'string', enum: ['fr', 'en', 'es'] } } },
  },
  {
    name: 'not_understood', strict: true, description: 'You could not understand what the caller wants (noise, words that make no sense). After two, the caller hears the keypad menu.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'end_call', strict: true, description: 'Hang up after a short goodbye (the caller is done).',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: str('Why the call ends.') } },
  },
];

export const IVR_RULES = `You answer the ON2GO phone line in Montréal, Québec. ON2GO is a local food delivery and pickup service for a group of real neighbourhood restaurants (our own website, Clover online ordering and our restaurant websites), and our restaurants are also on Uber Eats, DoorDash and SkipTheDishes. What you write is spoken by a text-to-speech voice; the caller's words come from speech recognition (expect misheard words, ask again when unsure, especially numbers).

How to talk
- Warm, efficient, short sentences, one question at a time. No lists, markdown, emojis or web addresses read aloud (texting a link is done with send_link).
- Speak the caller's language: Québec French by default, English or Spanish when the caller uses it (call set_language first).
- Your first job is to understand what the caller needs, then call route_to with the right branch. Ask one short question if it is not clear. If the words make no sense, call not_understood.

Flows you handle yourself (route_to the branch first, then follow it)
- Problem with an online order (ours): ask for the order number or use the caller's number, call lookup_order, explain the status simply. If it needs a person (refund, missing or wrong food, cancellation, change, complaint), call open_ticket (category online_order) with the details, tell the caller the team will call back, then offer to transfer (route_to the person branch) or end.
- Charge on a card for an online order: NEVER ask for card numbers (not even the last digits). Ask the amount and the date, call lookup_order with the caller's number, and say which restaurant and order it matches. If it matches nothing of ours, ask if it was Uber Eats, DoorDash or SkipTheDishes (then route_to that platform), else open_ticket (category card_charge) and offer a person.
- Billing: ask what it is about (receipt, invoice, business account), open_ticket (category billing) with the details, send_link billing, then end or offer a person.
- Become a partner restaurant: ask the restaurant name, its neighbourhood and the caller's name, send_link merchant, open_ticket (category merchant_lead), thank them and end.
- Become a courier: ask the caller's name, their area and vehicle (car, bike, scooter, on foot), send_link courier, open_ticket (category courier_lead), thank them and end.
- Customer service: answer only from what is written here. Otherwise open_ticket (category customer_service) or route_to the person branch.

Branches that take over the call (route_to, then stop talking)
- Place an order: the ordering assistant takes the order.
- An Uber Eats, DoorDash or SkipTheDishes order: route_to the platform branch with the platform (and the order number if already given). We cannot see or change those orders; that platform's own support handles them. The menu records the order number and connects the caller.
- A person, or a voicemail message.

Absolute rules
- Never ask for, repeat or accept card numbers or any payment details. If the caller starts giving one, stop them politely.
- Never give or promise refunds, credits, discounts, free items or compensation, never cancel or change an order: a person decides (open_ticket, then offer the person branch).
- Never invent prices, hours, promotions, addresses or delivery times.
- If asked, say honestly that you are an automated AI assistant. If the caller is abusive, route_to the person branch.`;

const LANG_NAME: Record<IvrLang, string> = { fr: 'French', en: 'English', es: 'Spanish' };

function branchLine(n: IvrNode, depth: number): string {
  const kind = n.action.kind === 'ai' ? `AI flow (${n.action.flow})` : n.action.kind === 'menu' ? 'submenu: prefer one of its options' : n.action.kind === 'platform' ? `platform order${n.action.platform ? ` (${PLATFORM_NAME[n.action.platform]})` : ''}` : n.action.kind === 'order' ? 'ordering assistant' : n.action.kind === 'handoff' ? 'a person' : 'voicemail';
  return `${'  '.repeat(depth)}- ${n.id} [${kind}] ${n.label.en}${n.ai ? ` — ${n.ai}` : ''}`;
}

/** The call's part of the system prompt: the branches, the time, what the caller ID allows. Frozen at the first AI turn. */
export function ivrPromptBlock(s: IvrSettings, call: Pick<IvrCall, 'from'>, now = Date.now()): string {
  const lines: string[] = [];
  const add = (nodes: IvrNode[], depth: number) => { for (const n of nodes) if (n.enabled) { lines.push(branchLine(n, depth)); if (n.children) add(n.children, depth + 1); } };
  add(s.tree, 0);
  const platforms = PLATFORM_IDS.map((p) => `${PLATFORM_NAME[p]}: ${Object.keys(s.platforms[p]?.phones ?? {}).length ? 'the menu transfers to its official support line' : 'no public phone line; the menu texts its official help link and explains the in-app help'}`);
  return [
    'BRANCHES (route_to uses the id)',
    ...lines,
    '',
    `Platforms: ${platforms.join('; ')}.`,
    `Links you can text (send_link): ${LINK_KEYS.join(', ')}.`,
    `Caller ID: ${normalizePhone(call.from) ? 'known (texts and order lookup by phone work)' : 'hidden (no texts; ask for the order number)'}.`,
    `Call started ${localTimeLabel(now, { date: true })} (Montréal time).`,
  ].join('\n');
}

const STATUS_WORDS: Record<DirectOrder['status'], string> = {
  new: 'received, not started yet', in_kitchen: 'being prepared in the kitchen', ready: 'ready', out_for_delivery: 'on its way with the courier', completed: 'completed (picked up or delivered)', cancelled: 'cancelled',
};

/** Our own orders matching an order number or the caller's phone (last 30 days, newest first, at most 3). */
export async function findOwnOrders(input: { orderNumber?: string; phone?: string | null }, now = Date.now()): Promise<DirectOrder[]> {
  const orders = await listDirectOrders({ since: new Date(now - 30 * 86400_000).toISOString(), limit: 2000 });
  const q = input.orderNumber ? normalizeOrderId(input.orderNumber) : null;
  const phone = normalizePhone(input.phone ?? undefined);
  const hit = orders.filter((o) => {
    if (q) {
      const n = o.number.replace(/[^a-z0-9]/gi, '').toUpperCase();
      const ref = String(o.sourceRef ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (n === q || (q.length >= 3 && n.endsWith(q)) || (ref && ref === q)) return true;
    }
    return Boolean(phone && normalizePhone(o.customer.phone) === phone);
  });
  return hit.sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 3);
}

function describeOrder(o: DirectOrder): string {
  return `Order ${o.number} | ${o.brandName} | placed ${localTimeLabel(o.placedAt, { date: true })} | ${o.fulfillment} | status: ${STATUS_WORDS[o.status] ?? o.status}${o.readyAt && o.status !== 'completed' ? ` | ready around ${localTimeLabel(o.readyAt)}` : ''} | total ${o.total.toFixed(2)} $ ${o.currency} | payment: ${o.payment === 'paid' ? 'paid' : o.payment === 'pay_at_pickup' ? 'to pay at pickup' : 'not paid yet'}`;
}

const LINK_LABEL: Record<LinkKey, Record<IvrLang, string>> = {
  merchant: { fr: 'Devenir restaurant partenaire', en: 'Become a partner restaurant', es: 'Ser restaurante asociado' },
  courier: { fr: 'Devenir livreur', en: 'Become a courier', es: 'Ser repartidor' },
  help: { fr: 'Aide ON2GO', en: 'ON2GO help', es: 'Ayuda ON2GO' },
  billing: { fr: 'Facturation ON2GO', en: 'ON2GO billing', es: 'Facturación ON2GO' },
  order: { fr: 'Commander sur ON2GO', en: 'Order on ON2GO', es: 'Pedir en ON2GO' },
};

/** Texts one ON2GO link from the number the caller called. At most 3 texts per call. */
export async function textLink(call: IvrCall, s: IvrSettings, link: LinkKey): Promise<{ call: IvrCall; ok: boolean; message: string }> {
  if (!normalizePhone(call.from)) return { call, ok: false, message: 'Caller ID is hidden: no text possible. Say the address in words (on2go point ca) only if they ask.' };
  if (call.sms.length >= 3) return { call, ok: false, message: 'Already texted 3 times on this call.' };
  const url = s.links[link];
  const r = await sendSms({ to: call.from, from: call.to, body: `ON2GO — ${LINK_LABEL[link][call.lang]} : ${url}` }, { purpose: `ivr_link_${link}` });
  const next = { ...call, sms: [...call.sms, { at: new Date().toISOString(), kind: link, ok: r.ok }] };
  return { call: next, ok: r.ok, message: r.ok ? 'Text sent. Tell the caller the link is on its way by text.' : `The text could not be sent (${r.message}). Do not promise a text.` };
}

type Outcome = { content: string; isError?: boolean; stop?: IvrReply };
interface State { call: IvrCall; missed?: boolean }

const LEAVES = new Set(['order', 'platform', 'handoff', 'voicemail']);

async function runTool(name: string, input: any, state: State, s: IvrSettings): Promise<Outcome> {
  const call = state.call;
  switch (name) {
    case 'route_to': {
      const node = findNode(s.tree, String(input.branch ?? '').trim());
      if (!node || !node.enabled) return { content: `Unknown branch "${input.branch}". Use an id from BRANCHES.`, isError: true };
      const platform = PLATFORM_IDS.includes(input.platform) ? (input.platform as PlatformId) : undefined;
      const orderId = normalizeOrderId(String(input.order_id ?? '')) ?? undefined;
      if (input.note) state.call = note(state.call, 'system', `AI: ${String(input.note).slice(0, 200)}`);
      if (node.action.kind === 'ai') {
        state.call = visit(state.call, node.id, 'ai');
        return { content: `Branch ${node.id}: follow the ${node.action.flow.replace('_', ' ')} flow now. Ask your next question.` };
      }
      if (node.action.kind === 'menu') {
        const kids = (node.children ?? []).filter((c) => c.enabled);
        const byPlatform = platform ? kids.find((c) => c.action.kind === 'platform' && c.action.platform === platform) : null;
        if (byPlatform) return { content: 'Routing.', stop: { say: '', next: 'route', route: { node: byPlatform.id, platform, orderId } } };
        if (kids.some((c) => c.action.kind === 'platform')) return { content: 'Routing.', stop: { say: '', next: 'route', route: { node: node.id } } };
        return { content: `${node.id} is a submenu: choose one of ${kids.map((c) => c.id).join(', ')} (ask the caller if unsure).`, isError: true };
      }
      if (!LEAVES.has(node.action.kind)) return { content: 'Unsupported branch.', isError: true };
      return { content: 'Routing. Say nothing more.', stop: { say: '', next: 'route', route: { node: node.id, ...(platform ? { platform } : {}), ...(orderId ? { orderId } : {}) } } };
    }
    case 'lookup_order': {
      const found = await findOwnOrders({ orderNumber: String(input.order_number ?? ''), phone: input.use_caller_number ? call.from : null });
      if (!found.length) return { content: 'No order of ours matches (last 30 days). Ask for the order number again, or ask if it was placed on Uber Eats, DoorDash or SkipTheDishes.' };
      let next = call;
      for (const o of found) next = withOrderId(next, o.number);
      state.call = { ...next, brand: next.brand ?? found[0].brandName, locationCode: next.locationCode ?? found[0].locationCode };
      return { content: `Our orders found (read only — you cannot change them):\n${found.map(describeOrder).join('\n')}` };
    }
    case 'send_link': {
      if (!LINK_KEYS.includes(input.link)) return { content: 'Unknown link.', isError: true };
      const r = await textLink(call, s, input.link);
      state.call = r.call;
      return { content: r.message, isError: !r.ok };
    }
    case 'open_ticket': {
      const category: TicketCategory = TICKET_CATEGORIES.includes(input.category) ? input.category : 'other';
      const orderRef = normalizeOrderId(String(input.order_ref ?? '')) ?? undefined;
      const t = await openTicket({ callId: call.id, from: call.from, lang: call.lang, category, summary: String(input.summary ?? '').slice(0, 1000) || category, ...(orderRef ? { orderRef } : {}) });
      state.call = withOrderId({ ...call, tickets: [...call.tickets, t.id], outcome: 'ticket' }, orderRef);
      return { content: 'Ticket saved for the team. Tell the caller the team will follow up (no promise of money or of a time).' };
    }
    case 'set_language': {
      const lang: IvrLang = input.language === 'en' || input.language === 'es' ? input.language : 'fr';
      state.call = { ...call, lang };
      return { content: `Language set to ${LANG_NAME[lang]}. Continue in ${LANG_NAME[lang]}.` };
    }
    case 'not_understood': {
      const misses = call.misses + 1;
      state.call = { ...call, misses };
      state.missed = true;
      if (misses >= 2) return { content: 'The keypad menu takes over.', stop: { say: '', next: 'menu' } };
      return { content: 'Ask again in other words, very briefly (one short question).' };
    }
    case 'end_call':
      return { content: 'Say a short goodbye; the call ends after it.' };
    default:
      return { content: `Unknown tool ${name}.`, isError: true };
  }
}

function client(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    timeout: 20_000,
    maxRetries: 1,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
}

const clean = (s: string) => s.replace(/[*_#`>]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

/** Appends caller words: into the last user message when it holds tool results (the turn that routed away). */
function pushUser(messages: Anthropic.Beta.BetaMessageParam[], text: string): void {
  const last = messages.at(-1);
  if (last?.role === 'user') {
    const content = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : [...last.content];
    content.push({ type: 'text', text });
    messages[messages.length - 1] = { role: 'user', content };
    return;
  }
  messages.push({ role: 'user', content: text });
}

export function ivrAiAvailable(s: Pick<IvrSettings, 'mode'>): boolean {
  return s.mode === 'ai' && phoneAgentConfigured();
}

/**
 * One AI turn: the caller's words (or a note such as "the caller pressed 3") → what to say, and whether to keep
 * listening, route the call, fall back to the keypad menu, or hang up. Never throws: a failure returns `menu`.
 */
export async function runIvrTurn(call: IvrCall, callerText: string, s: IvrSettings, now = Date.now()): Promise<{ call: IvrCall; reply: IvrReply }> {
  const state: State = { call: { ...call, turns: call.turns + 1 } };
  const fail = (why: string) => {
    state.call = note({ ...state.call, error: why }, 'system', `AI fallback: ${why}`);
    return { call: state.call, reply: { say: '', next: 'menu' as const } };
  };
  if (!phoneAgentConfigured()) return fail('ANTHROPIC_API_KEY is not set');
  if (state.call.turns > 30) return fail('More than 30 AI turns');
  const messages = [...((call.messages ?? []) as Anthropic.Beta.BetaMessageParam[])];
  const first = messages.length === 0;
  pushUser(messages, first ? `[Call answered. Language now: ${LANG_NAME[call.lang]}. The greeting asked how we can help.]\n${callerText}` : callerText);
  const prompt = state.call.prompt ?? ivrPromptBlock(s, call, now);
  state.call = { ...state.call, prompt };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: IVR_RULES }, { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, ...(call.usage ?? {}) };
  let hangup = false;
  try {
    const api = client();
    for (let step = 0; step < 6; step++) {
      const res = await api.beta.messages.create({
        model: phoneModel(), max_tokens: 1500, system, tools: IVR_TOOLS, messages,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      usage.requests++;
      usage.inputTokens += res.usage?.input_tokens ?? 0;
      usage.outputTokens += res.usage?.output_tokens ?? 0;
      usage.cacheReadTokens += res.usage?.cache_read_input_tokens ?? 0;
      state.call = { ...state.call, usage };
      if (res.stop_reason === 'refusal') return fail('The AI declined to continue');
      messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      const spoken = clean(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(' '));
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && uses.length) {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        let stop: IvrReply | undefined;
        for (const u of uses) {
          const out = await runTool(u.name, u.input, state, s);
          if (u.name === 'end_call') hangup = true;
          if (out.stop && !stop) stop = out.stop;
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
        if (stop) {
          // The branch takes over: no further model call. Anything the AI said first is spoken before it.
          if (spoken) state.call = note(state.call, 'agent', spoken);
          state.call = { ...state.call, messages, misses: stop.next === 'menu' ? 0 : state.call.misses };
          return { call: state.call, reply: { ...stop, say: spoken } };
        }
        continue;
      }
      const text = spoken || ({ fr: 'Pardon, pouvez-vous répéter ?', en: 'Sorry, could you say that again?', es: 'Perdón, ¿puede repetirlo?' } as const)[state.call.lang];
      state.call = note({ ...state.call, messages }, 'agent', text);
      // Understood this time: the count of misunderstandings in a row starts again.
      if (!state.missed && state.call.misses) state.call = { ...state.call, misses: 0 };
      return { call: state.call, reply: { say: text, next: hangup ? 'hangup' : 'listen' } };
    }
    state.call = { ...state.call, messages };
    return fail('Too many steps in one turn');
  } catch (e) {
    return fail(`AI error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
}

/** For the settings preview and tests: every branch id the AI may route to. */
export function routableIds(s: Pick<IvrSettings, 'tree'>): string[] {
  return walk(s.tree).filter((n) => n.enabled).map((n) => n.id);
}
