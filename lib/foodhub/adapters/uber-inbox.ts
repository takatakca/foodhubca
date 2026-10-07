// Uber Eats webhook inbox: every signed webhook is saved (raw body) BEFORE Food Hub answers 200, then processed.
// Uber does not resend a notification that got its 200, so a crash or a failed order fetch between the answer and the
// processing would otherwise lose the order. The sync replays what is still pending a few minutes later (inside Uber's
// 11.5-minute accept window); processing is idempotent (orders are de-duplicated, statuses only move forward).
// The bodies stay 30 days, so what Uber really sent can always be checked.
import crypto from 'node:crypto';
import { nowIso } from '../config';
import { getRepo } from '../repo';

export const UBER_INBOX = 'uber_webhooks';
/** A webhook still pending after this long is replayed (the first try runs right after the 200). */
export const REPLAY_AFTER_MS = 2 * 60_000;
/** Attempts before an entry is left 'failed' (and kept under Channels → Unparsed payloads with an alert). */
export const MAX_ATTEMPTS = 4;
const KEEP_DAYS = 30;

export interface UberInboxEntry {
  event: string;
  eventId: string | null;
  resourceId: string | null;
  body: unknown;
  status: 'pending' | 'done' | 'failed';
  receivedAt: string;
  attempts: number;
  processedAt?: string;
  error?: string;
}

/** Uber's event_id when present (it is the same on a re-delivery), otherwise a hash of the raw body. */
export function uberInboxId(body: any, raw: string): string {
  const id = body?.event_id ? String(body.event_id) : '';
  return id && id.length <= 200 ? id : `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

/**
 * Saves the webhook. `duplicate` = Uber delivered the same event again while the first copy is done or still being
 * processed (under REPLAY_AFTER_MS): nothing more to do. A save error is thrown — the route then answers 500 so Uber
 * retries, instead of a 200 for a webhook Food Hub could not keep.
 */
export async function saveUberWebhook(body: any, raw: string, now = Date.now()): Promise<{ id: string; duplicate: boolean }> {
  const repo = getRepo();
  const id = uberInboxId(body, raw);
  const prev = await repo.getDoc<UberInboxEntry>(UBER_INBOX, id);
  if (prev && (prev.data.status === 'done' || now - Date.parse(prev.data.processedAt ?? prev.data.receivedAt) < REPLAY_AFTER_MS)) return { id, duplicate: true };
  const entry: UberInboxEntry = {
    event: String(body?.event_type ?? ''), eventId: body?.event_id ? String(body.event_id) : null,
    resourceId: body?.meta?.resource_id ? String(body.meta.resource_id) : null, body,
    status: 'pending', receivedAt: prev?.data.receivedAt ?? new Date(now).toISOString(), attempts: prev?.data.attempts ?? 0,
  };
  await repo.putDocs(UBER_INBOX, [{ id, key: entry.resourceId, at: entry.receivedAt, data: entry }]);
  return { id, duplicate: false };
}

/** Records the outcome of one processing attempt; returns the entry as saved (status 'failed' = no attempt left). */
export async function markUberWebhook(id: string, outcome: { ok: true } | { ok: false; error: string }): Promise<UberInboxEntry | null> {
  const repo = getRepo();
  const doc = await repo.getDoc<UberInboxEntry>(UBER_INBOX, id);
  if (!doc) return null;
  const attempts = doc.data.attempts + 1;
  const data: UberInboxEntry = outcome.ok
    ? { ...doc.data, attempts, processedAt: nowIso(), status: 'done', error: undefined }
    : { ...doc.data, attempts, processedAt: nowIso(), status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: outcome.error.slice(0, 500) };
  await repo.putDocs(UBER_INBOX, [{ ...doc, data }]);
  return data;
}

/**
 * Replays webhooks still pending after REPLAY_AFTER_MS (a crash after the 200, or a processing error with attempts
 * left), oldest first, and drops entries older than KEEP_DAYS. `run` processes one entry and records its outcome
 * (see runUberWebhook), returning true when it worked.
 */
export async function replayPendingUberWebhooks(run: (id: string, body: any) => Promise<boolean>, now = Date.now()): Promise<{ replayed: number; failed: number }> {
  const repo = getRepo();
  const since = new Date(now - 2 * 86400_000).toISOString();
  const due = (await repo.listDocs<UberInboxEntry>(UBER_INBOX, { since, limit: 2000 }))
    .filter((d) => d.data.status === 'pending' && now - Date.parse(d.data.processedAt ?? d.data.receivedAt) >= REPLAY_AFTER_MS)
    .reverse();
  let replayed = 0; let failed = 0;
  for (const d of due.slice(0, 50)) {
    if (await run(d.id, d.data.body).catch(() => false)) replayed++; else failed++;
  }
  const old = await repo.listDocs<UberInboxEntry>(UBER_INBOX, { until: new Date(now - KEEP_DAYS * 86400_000).toISOString(), limit: 5000 }).catch(() => []);
  if (old.length) await repo.deleteDocs(UBER_INBOX, old.map((d) => d.id)).catch(() => undefined);
  return { replayed, failed };
}
