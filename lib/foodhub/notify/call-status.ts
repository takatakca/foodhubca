import type { OutboxEntry } from './index';

export const CALL_STATUSES = ['queued', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled'] as const;
export type CallStatus = typeof CALL_STATUSES[number];

const WATCHTOWER_CALL_PURPOSES = new Set(['alert', 'alert_kitchen', 'alert_shared_screen', 'alert_owner', 'alert_support']);

export function isTwilioCallSid(value: unknown): value is string {
  return typeof value === 'string' && /^CA[0-9a-f]{32}$/i.test(value);
}

/** Accept only a provider reference recorded for a Watchtower call. */
export function watchtowerCallSid(entry: OutboxEntry): string | null {
  return entry.channel === 'call' && entry.ok && !entry.skipped && entry.incidentId && WATCHTOWER_CALL_PURPOSES.has(entry.purpose)
    && isTwilioCallSid(entry.ref)
    ? entry.ref : null;
}

export function isCallStatus(value: unknown): value is CallStatus {
  return CALL_STATUSES.some((status) => status === value);
}
