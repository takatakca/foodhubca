// ON2GO phone menu — what is kept: one record per call (path, transcript, captured order numbers, platform, links
// texted, tickets, voicemail and outcome), the platform reference records (which platform order a caller called
// about, saved BEFORE the transfer), and tickets (leads, voicemails, requests for a person). Stored in fh_docs.
// Card numbers never get here (redacted before saving). The AI message history is dropped when the call ends.
import { nowIso } from '../../config';
import { normalizePhone, postToChat } from '../../notify';
import { getRepo } from '../../repo';
import type { IvrLang, PlatformId } from './config';
import { redactCards } from './words';

export const IVR_CALLS = 'ivr_calls';
export const IVR_REFS = 'ivr_platform_refs';
export const IVR_TICKETS = 'ivr_tickets';

export type IvrState = 'greeting' | 'ai' | 'menu' | 'platform' | 'order_id' | 'confirm_id' | 'order' | 'handoff' | 'voicemail' | 'done';
export type IvrOutcome = 'resolved' | 'order_agent' | 'platform_transfer' | 'platform_link' | 'handoff' | 'handoff_missed' | 'voicemail' | 'ticket' | 'hangup' | 'error';
export type TicketCategory = 'online_order' | 'card_charge' | 'billing' | 'merchant_lead' | 'courier_lead' | 'customer_service' | 'callback' | 'voicemail' | 'platform' | 'other';
export const TICKET_CATEGORIES: TicketCategory[] = ['online_order', 'card_charge', 'billing', 'merchant_lead', 'courier_lead', 'customer_service', 'callback', 'voicemail', 'platform', 'other'];

export interface IvrReply {
  say: string;
  /** listen = ask the caller again (AI); route = go to a branch; menu = the keypad menu takes over; hangup = goodbye. */
  next: 'listen' | 'route' | 'menu' | 'hangup';
  route?: { node: string; platform?: PlatformId; orderId?: string };
}

export interface IvrCall {
  id: string;
  from: string;
  to: string;
  lang: IvrLang;
  state: IvrState;
  /** Keypad level the caller is on ('' = main menu). */
  menu: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  /** Every branch visited, with how the caller got there. */
  path: Array<{ at: string; node: string; via: 'ai' | 'keypad' | 'speech' | 'system' }>;
  transcript: Array<{ at: string; who: 'caller' | 'agent' | 'system'; text: string }>;
  /** Claude history while the call runs (dropped at the end). */
  messages: unknown[];
  /** System prompt frozen at the first AI turn (the prefix never changes during a call). Dropped at the end. */
  prompt?: string;
  turns: number;
  /** AI misunderstandings in a row (2 = keypad menu). */
  misses: number;
  silences: number;
  /** Tries on the current capture step. */
  tries: number;
  platform?: PlatformId;
  /** Order number being confirmed (platform capture). */
  pendingOrderId?: string;
  /** Every order number this call mentioned (platform or own), for search. */
  orderIds: string[];
  refs: string[];
  tickets: string[];
  sms: Array<{ at: string; kind: string; ok: boolean }>;
  voicemail?: { recordingSid?: string; recordingUrl?: string; durationSec?: number; transcript?: string; transcriptDone?: boolean; emailedAt?: string; ticketId?: string; reason?: string };
  outcome?: IvrOutcome;
  /** Known from an own order looked up during the call. */
  brand?: string;
  locationCode?: string;
  /** AI turn running across Twilio's 15-second limit. */
  pending?: { startedAt: string; reply?: IvrReply };
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; requests: number };
  error?: string;
  updatedAt: string;
}

export interface PlatformRef {
  id: string;
  callId: string;
  at: string;
  from: string;
  lang: IvrLang;
  platform: PlatformId;
  /** Normalised order number ("" when the caller could not give one). */
  orderId: string;
  /** What happened next: the official line dialed, or the official help link texted. */
  next: 'transfer' | 'sms_link' | 'none';
  transferredTo?: string;
  /** Recording of the transfer, when recording is on. */
  recordingUrl?: string;
  brand?: string;
  locationCode?: string;
  note?: string;
}

export interface IvrTicket {
  id: string;
  at: string;
  callId: string;
  from: string;
  lang: IvrLang;
  category: TicketCategory;
  summary: string;
  orderRef?: string;
  platform?: PlatformId;
  status: 'open' | 'done';
  recordingUrl?: string;
  transcript?: string;
  doneAt?: string;
  doneBy?: string;
}

export function newIvrCall(id: string, from: string, to: string): IvrCall {
  const at = nowIso();
  return {
    id, from: from || 'anonymous', to, lang: 'fr', state: 'greeting', menu: '', status: 'active', startedAt: at,
    path: [], transcript: [], messages: [], turns: 0, misses: 0, silences: 0, tries: 0, orderIds: [], refs: [], tickets: [], sms: [], updatedAt: at,
  };
}

export async function saveIvrCall(call: IvrCall): Promise<IvrCall> {
  const next = { ...call, updatedAt: nowIso() };
  await getRepo().putDocs<IvrCall>(IVR_CALLS, [{ id: next.id, key: normalizePhone(next.from) ?? next.from, at: next.startedAt, data: next }]);
  return next;
}

export async function getIvrCall(id: string): Promise<IvrCall | null> {
  if (!id) return null;
  return (await getRepo().getDoc<IvrCall>(IVR_CALLS, id))?.data ?? null;
}

export async function listIvrCalls(opts: { since?: string; limit?: number } = {}): Promise<IvrCall[]> {
  return (await getRepo().listDocs<IvrCall>(IVR_CALLS, { since: opts.since, limit: opts.limit ?? 500 })).map((d) => d.data);
}

/** Adds a transcript line (card numbers removed). */
export function note(call: IvrCall, who: IvrCall['transcript'][number]['who'], text: string): IvrCall {
  return { ...call, transcript: [...call.transcript, { at: nowIso(), who, text: redactCards(text).slice(0, 2000) }].slice(-400) };
}

export function visit(call: IvrCall, node: string, via: IvrCall['path'][number]['via']): IvrCall {
  return { ...call, path: [...call.path, { at: nowIso(), node, via }].slice(-60) };
}

export function withOrderId(call: IvrCall, id: string | undefined | null): IvrCall {
  return id && !call.orderIds.includes(id) ? { ...call, orderIds: [...call.orderIds, id].slice(-20) } : call;
}

export async function endIvrCall(id: string, outcome?: IvrOutcome, durationSec?: number): Promise<IvrCall | null> {
  const call = await getIvrCall(id);
  if (!call) return null;
  const endedAt = call.endedAt ?? nowIso();
  return saveIvrCall({
    ...call, status: 'ended', state: 'done', endedAt,
    outcome: outcome ?? call.outcome ?? (call.tickets.length ? 'ticket' : 'hangup'),
    durationSec: durationSec ?? call.durationSec ?? Math.round((Date.parse(endedAt) - Date.parse(call.startedAt)) / 1000),
    messages: [], prompt: undefined, pending: undefined,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Platform reference records

export async function savePlatformRef(ref: Omit<PlatformRef, 'id' | 'at'> & { id?: string }): Promise<PlatformRef> {
  const at = nowIso();
  const full: PlatformRef = { ...ref, id: ref.id ?? `ref_${ref.callId.slice(-10)}_${Date.now().toString(36)}`, at };
  await getRepo().putDocs<PlatformRef>(IVR_REFS, [{ id: full.id, key: full.orderId || full.platform, at, data: full }]);
  return full;
}

export async function getPlatformRef(id: string): Promise<PlatformRef | null> {
  return (await getRepo().getDoc<PlatformRef>(IVR_REFS, id))?.data ?? null;
}

export async function updatePlatformRef(id: string, patch: Partial<PlatformRef>): Promise<PlatformRef | null> {
  const cur = await getPlatformRef(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: cur.id, at: cur.at };
  await getRepo().putDocs<PlatformRef>(IVR_REFS, [{ id: next.id, key: next.orderId || next.platform, at: next.at, data: next }]);
  return next;
}

export async function listPlatformRefs(opts: { since?: string; limit?: number } = {}): Promise<PlatformRef[]> {
  return (await getRepo().listDocs<PlatformRef>(IVR_REFS, { since: opts.since, limit: opts.limit ?? 1000 })).map((d) => d.data);
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  online_order: 'Online order', card_charge: 'Card charge', billing: 'Billing', merchant_lead: 'Merchant sign-up', courier_lead: 'Courier sign-up',
  customer_service: 'Customer service', callback: 'Call back', voicemail: 'Voicemail', platform: 'Platform order', other: 'Other',
};
export const ticketLabel = (c: TicketCategory) => CATEGORY_LABEL[c] ?? c;

export async function openTicket(input: Omit<IvrTicket, 'id' | 'at' | 'status'>): Promise<IvrTicket> {
  const at = nowIso();
  const t: IvrTicket = { ...input, summary: redactCards(input.summary).slice(0, 1000), ...(input.transcript ? { transcript: redactCards(input.transcript).slice(0, 4000) } : {}), id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, status: 'open' };
  await getRepo().putDocs<IvrTicket>(IVR_TICKETS, [{ id: t.id, key: t.category, at, data: t }]);
  await postToChat({
    title: `☎️ ON2GO line: ${ticketLabel(t.category)}${t.from && t.from !== 'anonymous' ? ` — call back ${t.from}` : ''}`,
    text: `${t.summary}${t.orderRef ? ` (order ${t.orderRef})` : ''}`,
    severity: 'info',
  }, { purpose: 'ivr_ticket' }).catch(() => undefined);
  return t;
}

export async function getTicket(id: string): Promise<IvrTicket | null> {
  return (await getRepo().getDoc<IvrTicket>(IVR_TICKETS, id))?.data ?? null;
}

export async function updateTicket(id: string, patch: Partial<IvrTicket>): Promise<IvrTicket | null> {
  const cur = await getTicket(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: cur.id, at: cur.at };
  await getRepo().putDocs<IvrTicket>(IVR_TICKETS, [{ id: next.id, key: next.category, at: next.at, data: next }]);
  return next;
}

export async function listTickets(opts: { since?: string; limit?: number } = {}): Promise<IvrTicket[]> {
  return (await getRepo().listDocs<IvrTicket>(IVR_TICKETS, { since: opts.since, limit: opts.limit ?? 500 })).map((d) => d.data);
}

// ---------------------------------------------------------------------------------------------------------------
// Search (Calls log)

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Does a call match a search by phone number (any 4+ digits of it) or order number (platform or own)? */
export function callMatches(call: IvrCall, refs: PlatformRef[], tickets: IvrTicket[], q: string): boolean {
  const query = q.trim();
  if (!query) return true;
  const idQ = query.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const dQ = digitsOf(query);
  if (dQ.length >= 4 && digitsOf(call.from).includes(dQ)) return true;
  if (idQ.length >= 3) {
    if (call.orderIds.some((o) => o.toUpperCase().includes(idQ))) return true;
    if (refs.some((r) => r.callId === call.id && r.orderId.includes(idQ))) return true;
    if (tickets.some((t) => t.callId === call.id && (t.orderRef ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(idQ))) return true;
  }
  return false;
}
