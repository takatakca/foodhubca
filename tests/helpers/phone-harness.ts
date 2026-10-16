// Shared helpers of the phone tests: mocked Claude responses, Twilio-signed requests, kitchen hours.
import { allDayWeek, saveHours } from '../../lib/foodhub/hours';
import { twilioSignature } from '../../lib/foodhub/phone/twilio';
import type { WeeklyHours } from '../../lib/foodhub/types';

export const claudeResponse = (content: any[], stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } });
export const toolUse = (name: string, input: unknown, id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`) => ({ type: 'tool_use', id, name, input });
export const text = (t: string) => ({ type: 'text', text: t });

/** An Anthropic API error body (credit balance, authentication, overloaded…). */
export function apiError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });
}

export function signed(base: string, path: string, fields: Record<string, string>, token = 'tw-token'): Request {
  const params = new URLSearchParams(fields);
  const url = `${base}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, token) }, body: params.toString() });
}

/** Kitchens open all day, every day (phone orders need hours set in Food Hub). */
export async function openAllDay(codes: string[]): Promise<void> {
  await saveHours({ locations: Object.fromEntries(codes.map((c) => [c, allDayWeek()])), brands: {}, holidays: [] });
}

export const everyDay = (open: string, close: string): WeeklyHours => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [{ open, close }]])) as unknown as WeeklyHours;
