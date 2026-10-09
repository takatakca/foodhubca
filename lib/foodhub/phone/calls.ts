// The phone call log: one record per call (or per "Try the agent" session in the console) with the transcript, the cart,
// the outcome (order placed, handed to a person, hung up) and the AI usage. Stored in fh_docs ("phone_calls").
// The caller's number is kept in full on the call (it is the customer's own order contact, like a platform order) and
// shown masked in lists. The AI conversation itself (Claude message history) is dropped when the call ends — only the
// readable transcript stays.
import { nowIso } from '../config';
import { getRepo } from '../repo';
import type { DropoffAddress } from '../delivery/types';
import type { CartLine } from './cart';

export const PHONE_CALLS = 'phone_calls';

/** Language of a call: Québec French (default), English, or Spanish (ON2GO menu callers who chose español). */
export type PhoneLang = 'fr' | 'en' | 'es';

export type CallStatus = 'active' | 'ordered' | 'handoff' | 'handoff_missed' | 'ended' | 'abandoned' | 'error';

export interface TurnReply {
  say: string;
  /** What happens after saying it. */
  next: 'listen' | 'handoff' | 'hangup';
  lang: PhoneLang;
}

export interface PhoneCall {
  id: string;
  lineId: string;
  lineName: string;
  locationCode: string;
  brands: string[];
  from: string;
  to: string;
  lang: PhoneLang;
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  turns: number;
  transcript: Array<{ at: string; who: 'caller' | 'agent' | 'system'; text: string }>;
  /** Claude message history while the call runs (dropped when it ends). */
  messages: unknown[];
  /** The line part of the system prompt, frozen at the first AI turn (the prefix must not change during a call). Dropped when it ends. */
  prompt?: string;
  cart: CartLine[];
  customer: { name?: string; phone?: string; fulfillment?: 'pickup' | 'delivery'; dropoff?: DropoffAddress; wantedAt?: string };
  orderId?: string;
  orderNumber?: string;
  /** Turn being computed (Twilio waits at most 15 s per request: a slow turn continues on a redirect). */
  pending?: { turn: number; startedAt: string; reply?: TurnReply };
  handoffReason?: string;
  error?: string;
  simulated?: boolean;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; requests: number };
  updatedAt: string;
}

export async function saveCall(call: PhoneCall): Promise<PhoneCall> {
  const next = { ...call, updatedAt: nowIso() };
  await getRepo().putDocs<PhoneCall>(PHONE_CALLS, [{ id: next.id, key: next.lineId, at: next.startedAt, data: next }]);
  return next;
}

export async function getCall(id: string): Promise<PhoneCall | null> {
  return (await getRepo().getDoc<PhoneCall>(PHONE_CALLS, id))?.data ?? null;
}

export async function listCalls(opts: { since?: string; limit?: number } = {}): Promise<PhoneCall[]> {
  return (await getRepo().listDocs<PhoneCall>(PHONE_CALLS, { since: opts.since, limit: opts.limit ?? 300 })).map((d) => d.data);
}

export function say(call: PhoneCall, who: PhoneCall['transcript'][number]['who'], text: string): PhoneCall {
  return { ...call, transcript: [...call.transcript, { at: nowIso(), who, text: text.slice(0, 2000) }].slice(-400) };
}

/** Ends a call: final status, duration, and the AI history dropped (the transcript stays). */
export async function endCall(id: string, status?: CallStatus, durationSec?: number): Promise<PhoneCall | null> {
  const call = await getCall(id);
  if (!call) return null;
  const final: CallStatus = status ?? (call.status === 'active' ? (call.orderId ? 'ordered' : call.cart.length ? 'abandoned' : 'ended') : call.status);
  const endedAt = call.endedAt ?? nowIso();
  return saveCall({ ...call, status: final, endedAt, durationSec: durationSec ?? call.durationSec ?? Math.round((Date.parse(endedAt) - Date.parse(call.startedAt)) / 1000), messages: [], prompt: undefined, pending: undefined });
}

/** Calls still "active" 30 minutes later lost their final callback: close them. */
export async function closeStaleCalls(now = Date.now()): Promise<number> {
  const calls = await listCalls({ since: new Date(now - 2 * 86400_000).toISOString(), limit: 500 });
  let n = 0;
  for (const c of calls) {
    if (c.status === 'active' && now - Date.parse(c.updatedAt || c.startedAt) > 30 * 60_000) { await endCall(c.id); n++; }
  }
  return n;
}

export function maskNumber(n: string): string {
  return /^\+?\d{7,}$/.test(n) ? `${n.slice(0, n.length - 7)}•••${n.slice(-4)}` : n;
}
