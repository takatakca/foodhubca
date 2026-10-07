// Uber Eats webhook events, processed from the webhook inbox (inbox.ts) — the route only checks the signature, saves
// the raw event and answers 200. The same code runs for a live delivery, an automatic retry and an owner's Replay, and
// throws when the event could not be processed, so the inbox keeps it and tries again.
// The event handling itself lives in adapters/uber-events.ts (orders, cancellations, customer edits, courier states,
// reports, store provisioning / status, menu refresh requests — a locked or "Do not touch" store is never published).
import { handleUberEvent, type HandlerOutcome } from '../adapters/uber-events';

export type { HandlerOutcome };

export function uberEventKind(body: any): string {
  return String(body?.event_type || '');
}

export async function handleUberWebhook(body: any): Promise<HandlerOutcome> {
  return handleUberEvent(body);
}
