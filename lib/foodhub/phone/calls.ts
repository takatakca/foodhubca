// The phone call log: one record per call (or per "Try the agent" session in the console) with the transcript, the cart,
// the outcome (order placed, handed to a person, hung up) and the AI usage. Stored in fh_docs ("phone_calls").
// The caller's number is kept in full on the call (it is the customer's own order contact, like a platform order) and
// shown masked in lists. The AI conversation itself (Claude message history) is dropped when the call ends — only the
// readable transcript stays.
import { nowIso } from '../config';
import { normalizePhone } from '../notify';
import { getRepo } from '../repo';
import type { DropoffAddress } from '../delivery/types';
import type { CartLine } from './cart';
import { redactCards } from './ivr/words';

export const PHONE_CALLS = 'phone_calls';

/** Language of a call: Québec French (default), English, or Spanish (ON2GO menu callers who chose español). */
export type PhoneLang = 'fr' | 'en' | 'es';

export type CallStatus = 'active' | 'ordered' | 'handoff' | 'handoff_missed' | 'ended' | 'abandoned' | 'error';

export interface TurnReply {
  say: string;
  /** What happens after saying it. */
  next: 'listen' | 'handoff' | 'hangup';
  lang: PhoneLang;
  /** An order confirmation said in this turn: still said when the hand-off finds nobody. */
  confirm?: string;
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
  /** The AI answered the call (its greeting). Absent = the AI never took it (straight to a person). TAKATAK Phone bills AI minutes. */
  aiStartedAt?: string;
  /** The AI handed the call to a person (the <Dial> started): the hold and the person's part are not AI minutes. */
  aiEndedAt?: string;
  turns: number;
  transcript: Array<{ at: string; who: 'caller' | 'agent' | 'system'; text: string }>;
  /** Claude message history while the call runs (dropped when it ends). */
  messages: unknown[];
  /** The line part of the system prompt, frozen at the first AI turn (the prefix must not change during a call). Dropped when it ends. */
  prompt?: string;
  cart: CartLine[];
  /** Duo / Trio / Combo already offered on this call (offered once per call). */
  upsellOffered?: boolean;
  customer: { name?: string; phone?: string; fulfillment?: 'pickup' | 'delivery'; dropoff?: DropoffAddress; wantedAt?: string };
  orderId?: string;
  orderNumber?: string;
  /** The payment link could not be made on this call: a pickup may then be paid at the counter. */
  linkFailed?: boolean;
  /** Turn being computed (Twilio waits at most 15 s per request: a slow turn continues on a redirect). */
  pending?: { turn: number; startedAt: string; reply?: TurnReply };
  handoffReason?: string;
  error?: string;
  /** Console simulator, or a test caller (FOODHUB_PHONE_TEST_CALLERS): an order is never sent to Clover or the kitchen. */
  simulated?: boolean;
  /** Voices of the ON2GO menu when the call came from it (the voice never changes in the middle of a call). */
  voices?: { voiceFr: string; voiceEn: string; voiceEs: string };
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; requests: number };
  updatedAt: string;
}

/**
 * Numbers that make TEST calls (FOODHUB_PHONE_TEST_CALLERS, comma separated, set in the host only — never in git): the
 * call is real (voice, AI, texts of the menu), but an order placed is a test (no Clover order, no ticket, no link).
 */
export function isTestCaller(from: string | null | undefined): boolean {
  const n = normalizePhone(from);
  if (!n) return false;
  return String(process.env.FOODHUB_PHONE_TEST_CALLERS ?? '').split(/[,;\s]+/).map((x) => normalizePhone(x)).includes(n);
}

export async function saveCall(call: PhoneCall): Promise<PhoneCall> {
  const next = { ...call, updatedAt: nowIso() };
  await getRepo().putDocs<PhoneCall>(PHONE_CALLS, [{ id: next.id, key: next.lineId, at: next.startedAt, data: next }]);
  return next;
}

const AI_END = (id: string) => `phone_ai_end:${id}`;

/**
 * The AI's minutes stop now (hand-off to a person). Kept OUTSIDE the call record too, with one atomic insert (the first
 * mark wins): a slow AI turn that finishes after the hand-off and saves its older copy of the call can never erase it.
 * Never throws (the call goes on).
 */
export async function markAiEnded(id: string, at: string): Promise<void> {
  await getRepo().claimKv(AI_END(id), { at }).catch(() => undefined);
}

/** The AI-end mark of a call (markAiEnded), or undefined. */
export async function aiEndMark(id: string): Promise<string | undefined> {
  const v = await getRepo().getKv<{ at?: string }>(AI_END(id)).catch(() => null);
  return typeof v?.at === 'string' ? v.at : undefined;
}

export async function getCall(id: string): Promise<PhoneCall | null> {
  return (await getRepo().getDoc<PhoneCall>(PHONE_CALLS, id))?.data ?? null;
}

export async function listCalls(opts: { since?: string; limit?: number } = {}): Promise<PhoneCall[]> {
  return (await getRepo().listDocs<PhoneCall>(PHONE_CALLS, { since: opts.since, limit: opts.limit ?? 300 })).map((d) => d.data);
}

/** Adds a transcript line. Card numbers never reach a stored transcript (same rule as the ON2GO menu's records). */
export function say(call: PhoneCall, who: PhoneCall['transcript'][number]['who'], text: string): PhoneCall {
  return { ...call, transcript: [...call.transcript, { at: nowIso(), who, text: redactCards(text).slice(0, 2000) }].slice(-400) };
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
