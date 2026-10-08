// Uber Eats webhook inbox: every signed webhook is saved (raw body) BEFORE Food Hub answers 200, then processed.
// Uber does not resend a notification that got its 200, so a crash or a failed order fetch between the answer and the
// processing would otherwise lose the order.
//
// Uber webhooks live in the shared webhook inbox (lib/foodhub/inbox.ts, kind "uber"), with DoorDash and the other
// platforms: it retries a failed entry by itself (30 s, 2 min — inside Uber's 11.5-minute accept window), processes
// again an entry the server never finished (the recovery runner, every sync / cron / server timer), shows it under
// Settings → Platforms → Webhook inbox with Replay, and counts it on /api/health. Processing is idempotent (orders
// are de-duplicated, statuses only move forward).
// What is Uber-specific lives here: the entry id is Uber's event_id (the same on a re-delivery), so an event Uber
// delivers again is recognised and not processed a second time.
import crypto from 'node:crypto';
import { getInboxEntry, INBOX, receiveWebhook, refuseInboxEntry, type InboxEntry } from '../inbox';

export const UBER_INBOX = INBOX;
export type UberInboxEntry = InboxEntry;
/** A copy still unfinished after this long is processed again when Uber delivers the event again. */
export const REPLAY_AFTER_MS = 2 * 60_000;

/** Uber's event_id when present (it is the same on a re-delivery), otherwise a hash of the raw body. */
export function uberInboxId(body: any, raw: string): string {
  const id = body?.event_id ? String(body.event_id) : '';
  return id && id.length <= 200 ? id : `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

/** The order / store the event is about, shown on the inbox entry and used to search it. */
function uberReference(body: any): string | null {
  const ref = body?.meta?.resource_id || body?.meta?.order_id || body?.store_id || body?.meta?.store_id || body?.workflow_id || '';
  return ref ? String(ref) : null;
}

/**
 * Saves the webhook. `duplicate` = Uber delivered the same event again while the first copy is done or still being
 * processed (under REPLAY_AFTER_MS): nothing more to do. An older unfinished copy is processed again (not duplicate).
 * A save error is thrown — the route then answers 503 so Uber retries, instead of a 200 for a webhook Food Hub could
 * not keep. A copy that landed anyway is marked refused, and Uber's re-delivery (same event_id) saves it again as new.
 */
export async function saveUberWebhook(body: any, raw: string, now = Date.now()): Promise<{ id: string; duplicate: boolean }> {
  const id = uberInboxId(body, raw);
  const prev = await getInboxEntry(id);
  const refused = prev?.status === 'refused';
  if (prev && !refused && (prev.status === 'done' || now - Date.parse(prev.updatedAt) < REPLAY_AFTER_MS)) return { id, duplicate: true };
  if (!prev || refused) {
    const receivedAt = new Date(now).toISOString();
    try {
      await receiveWebhook({ id, receivedAt, channel: 'uber_eats', kind: 'uber', body, reference: uberReference(body) });
    } catch (error) {
      await refuseInboxEntry(id, receivedAt, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  return { id, duplicate: false };
}
