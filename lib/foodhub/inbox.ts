// TAKATAK Food Hub — durable order intake ("never lose an order").
//
// A platform gets its 2xx only once the order is saved here (fh_docs, collection 'order_inbox', one record per
// channel + platform order id — the same key insertOrderIfNew dedupes on), then the pipeline runs after the response:
//   queued → done    processed (or already in Food Hub: nothing is ingested twice)
//   queued → error   processing failed: kept with the reason, flagged (Channels → Unparsed payloads, activity log,
//                    Command Center / Watchtower) and replayable from Settings → Platforms & Clover.
// A record still queued after INBOX_STALE_MS means the server stopped between the 2xx and the pipeline: the sync
// (runSync → sweepOrderInbox) runs it again, at most MAX_RECOVERY_ATTEMPTS times, then flags it for a person.
// Past the platform's answer window (deadline.ts: DoorDash 3 min, Skip 5, Uber 11.5) the platform has cancelled the
// order or sent it to its tablet: it is flagged for a person instead (a late Clover ticket could cook it twice).
// Records live in fh_docs (not fh_jobs) so one row per order never crowds the platform jobs the screens list.
import crypto from 'node:crypto';
import { logActivity } from './activity';
import { fetchUberOrder, parseUberOrder } from './adapters/uber-eats';
import { CHANNEL_LABELS, nowIso } from './config';
import { deadlineFor, ORDER_DEADLINE_MIN } from './deadline';
import { processIncomingOrder, type PipelineOutcome } from './pipeline';
import { getRepo } from './repo';
import type { ChannelKey, NormalizedOrder } from './types';

export const INBOX = 'order_inbox';
/** After this long a queued record is not being worked on any more (webhook routes stop at 60 s). */
export const INBOX_STALE_MS = 2 * 60_000;
/** Recovery runs before a record is handed to a person (a payload that kills the server every time). */
export const MAX_RECOVERY_ATTEMPTS = 5;
/** Processed records are only needed for a few days: the order itself is in fh_orders. */
const DONE_KEEP_MS = 7 * 86400_000;
/** The sweep runs inside the sync (60 s budget): a few orders per run, oldest first. */
const SWEEP_BATCH = 5;
const SWEEP_BUDGET_MS = 20_000;

export type InboxStatus = 'queued' | 'done' | 'error';
export type InboxRun = 'webhook' | 'recovery' | 'replay';

export interface InboxRecord {
  channel: ChannelKey;
  externalOrderId: string;
  /** The order as the platform sent it (normalized, raw payload included), before any processing. */
  order?: NormalizedOrder;
  /** Uber only notifies: what is needed to fetch the order again. */
  uber?: { href: string; storeId?: string | null };
  status: InboxStatus;
  receivedAt: string;
  /** Recovery runs by the sweeper (the run right after the webhook is not counted). */
  attempts: number;
  lastAttemptAt?: string | null;
  processedAt?: string | null;
  /** Food Hub order id once stored. */
  orderId?: string | null;
  /** The order was already in Food Hub (another delivery or path got there first). */
  duplicate?: boolean;
  error?: string | null;
  lastReplay?: { at: string; by: string } | null;
}

export interface InboxRunResult { ok: boolean; status: InboxStatus; orderId?: string | null; duplicate?: boolean; error?: string | null; already?: boolean }

/** What Settings → Platforms & Clover shows (no customer details). */
export interface InboxView {
  id: string; channel: ChannelKey; externalOrderId: string; displayId: string | null; brandName: string | null; total: number | null; items: number | null;
  status: InboxStatus; stuck: boolean; receivedAt: string; attempts: number; error: string | null; lastReplay: { at: string; by: string } | null;
  /** When the platform stops waiting for an answer (null: no platform deadline, e.g. relay or TGTG), and whether it has passed. */
  deadline: string | null;
  pastDeadline: boolean;
}

export function inboxId(channel: ChannelKey, externalOrderId: string) { return `${channel}:${externalOrderId}`; }

/** The platform's answer deadline for this order (an Uber notification has no order yet: counted from its arrival). */
export function inboxDeadline(rec: InboxRecord): string | null {
  return deadlineFor({ channel: rec.channel, createdAt: rec.receivedAt, placedAt: rec.order?.placedAt ?? null, viaHub: rec.order?.viaHub });
}

async function save(id: string, rec: InboxRecord) {
  await getRepo().putDocs<InboxRecord>(INBOX, [{ id, key: rec.status, at: rec.receivedAt, data: rec }]);
}

/**
 * Saves an incoming order before the platform is answered. A re-delivery of the same order overwrites the record
 * (back to queued): processing again is harmless, insertOrderIfNew dedupes. Throws when it cannot be saved.
 */
export async function saveToInbox(input: { channel: ChannelKey; externalOrderId: string; order?: NormalizedOrder; uber?: InboxRecord['uber'] }): Promise<{ id: string; record: InboxRecord }> {
  const ref = input.externalOrderId || `unknown-${crypto.randomUUID()}`;
  const record: InboxRecord = { channel: input.channel, externalOrderId: ref, ...(input.order ? { order: input.order } : {}), ...(input.uber ? { uber: input.uber } : {}), status: 'queued', receivedAt: nowIso(), attempts: 0 };
  const id = inboxId(input.channel, ref);
  await save(id, record);
  return { id, record };
}

/** The order to run: a copy of the saved one (the pipeline rewrites lines), or Uber's details fetched again. */
async function readOrder(rec: InboxRecord): Promise<{ order: NormalizedOrder | null; raw?: unknown }> {
  if (rec.order) return { order: structuredClone(rec.order) };
  if (rec.uber) {
    const href = rec.uber.href;
    // One retry: Uber does not resend the notification, so a slow/failed fetch must not lose the order.
    const details = await fetchUberOrder(href).catch(() => fetchUberOrder(href));
    return { order: parseUberOrder(details, rec.uber.storeId ?? undefined), raw: details };
  }
  return { order: null };
}

function orderRef(rec: InboxRecord) { return `#${rec.order?.displayId || rec.externalOrderId.slice(0, 12)}`; }

/** Command Center / Watchtower see webhook_unparsed records; the activity log says what to do. */
async function flag(id: string, rec: InboxRecord, reason: string, how: InboxRun, raw?: unknown) {
  const where = 'Replay it under Settings → Platforms & Clover';
  try {
    await getRepo().addJob({ kind: 'webhook_unparsed', channel: rec.channel, reference: rec.externalOrderId, status: 'error',
      request: { body: (raw ?? rec.order ?? rec.uber ?? {}) as Record<string, unknown>, inboxId: id, label: `order ${id}` }, result: { reason: `Order not processed: ${reason} — kept. ${where}.` } });
  } catch (e) { console.error(`[foodhub] could not flag inbox order ${id}:`, e); }
  await logActivity({
    actor: how === 'webhook' ? CHANNEL_LABELS[rec.channel] : 'Food Hub', source: how === 'webhook' ? 'platform' : 'automation', kind: 'order', action: 'order_intake_failed', status: 'failed', channel: rec.channel,
    summary: `${CHANNEL_LABELS[rec.channel]} order ${orderRef(rec)} was received but not processed: ${reason} — kept. ${where}.`, detail: { inboxId: id, reason, attempts: rec.attempts, how },
  });
}

/**
 * Runs one inbox record through the pipeline and records the outcome on it. Processing failures are recorded
 * (status error + flag), not thrown; only a failure to save the record itself throws (it then stays queued for the sweeper).
 */
export async function runInbox(id: string, rec: InboxRecord, how: InboxRun, by?: string): Promise<InboxRunResult> {
  let outcome: PipelineOutcome | null = null;
  let error: string | null = null;
  let raw: unknown;
  try {
    const read = await readOrder(rec);
    raw = read.raw;
    if (!read.order) error = rec.uber ? 'Uber order details could not be parsed' : 'No order saved with this record';
    else outcome = await processIncomingOrder(read.order);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[foodhub] inbox order ${id} (${how}) failed:`, e);
  }

  if (!outcome) {
    await save(id, { ...rec, status: 'error', error });
    if (how !== 'replay') await flag(id, rec, error ?? 'unknown error', how, raw);
    else await logActivity({ actor: by || 'Food Hub', source: 'dashboard', kind: 'order', action: 'order_replayed', status: 'failed', channel: rec.channel,
      summary: `Replay of ${CHANNEL_LABELS[rec.channel]} order ${orderRef(rec)} failed: ${error}`, detail: { inboxId: id, reason: error } });
    return { ok: false, status: 'error', error };
  }

  const o = outcome.order;
  await save(id, { ...rec, status: 'done', processedAt: nowIso(), orderId: o.id, duplicate: outcome.duplicate, error: null });
  if (how !== 'webhook') {
    const what = outcome.duplicate ? 'was already in Food Hub — nothing processed twice' : 'was processed';
    await logActivity({
      actor: how === 'replay' ? by || 'Food Hub' : 'Food Hub', source: how === 'replay' ? 'dashboard' : 'automation', kind: 'order', action: how === 'replay' ? 'order_replayed' : 'order_recovered', status: 'success',
      channel: rec.channel, brandName: o.brandName ?? null, locationCode: o.locationCode ?? null, orderId: o.id,
      summary: how === 'replay' ? `${CHANNEL_LABELS[rec.channel]} order ${orderRef(rec)} replayed: it ${what}`
        : `${CHANNEL_LABELS[rec.channel]} order ${orderRef(rec)} recovered after the server stopped before processing it: it ${what}`,
      detail: { inboxId: id, duplicate: outcome.duplicate, attempts: rec.attempts },
    });
  }
  return { ok: true, status: 'done', orderId: o.id, duplicate: outcome.duplicate };
}

/**
 * Crash recovery, run by the sync: orders saved but still queued after INBOX_STALE_MS are processed again
 * (oldest first, a few per run). Flagged for a person instead (failed): past the platform's answer window, or after
 * MAX_RECOVERY_ATTEMPTS. Also clears processed records older than a week.
 */
export async function sweepOrderInbox(opts: { now?: number } = {}): Promise<{ recovered: number; failed: number; pruned: number }> {
  const repo = getRepo();
  const now = opts.now ?? Date.now();
  const started = Date.now();
  const staleBefore = new Date(now - INBOX_STALE_MS).toISOString();
  const stale = (await repo.listDocs<InboxRecord>(INBOX, { keys: ['queued'], until: staleBefore, limit: 200 }))
    .filter((d) => !d.data.lastAttemptAt || d.data.lastAttemptAt < staleBefore)
    .reverse();
  let recovered = 0, failed = 0;
  for (const d of stale.slice(0, SWEEP_BATCH)) {
    if (Date.now() - started > SWEEP_BUDGET_MS) break;
    const rec = d.data;
    const deadline = inboxDeadline(rec);
    const late = Boolean(deadline && Date.parse(deadline) <= now);
    if (late || (rec.attempts ?? 0) >= MAX_RECOVERY_ATTEMPTS) {
      const label = CHANNEL_LABELS[rec.channel];
      // Never a late Clover ticket / accept for an order the platform has given up on: a person checks the platform first.
      const reason = late ? `not processed within ${label}'s ${ORDER_DEADLINE_MIN[rec.channel]}-minute answer window — ${label} may have cancelled it or sent it to its tablet; check there before replaying`
        : `still not processed after ${rec.attempts} recovery attempts (the server stopped each time)`;
      await save(d.id, { ...rec, status: 'error', error: reason });
      await flag(d.id, rec, reason, 'recovery');
      failed++;
      continue;
    }
    // Count the attempt before running it: a run that kills the server again still counts.
    const attempt: InboxRecord = { ...rec, attempts: (rec.attempts ?? 0) + 1, lastAttemptAt: new Date(now).toISOString() };
    await save(d.id, attempt);
    const r = await runInbox(d.id, attempt, 'recovery');
    if (r.ok) recovered++; else failed++;
  }
  const old = await repo.listDocs<InboxRecord>(INBOX, { keys: ['done'], until: new Date(now - DONE_KEEP_MS).toISOString(), limit: 500 });
  if (old.length) await repo.deleteDocs(INBOX, old.map((d) => d.id));
  return { recovered, failed, pruned: old.length };
}

/** Owner's Replay button: runs a failed (or stuck) record again. Null when there is no such record. */
export async function replayInbox(id: string, by: string): Promise<InboxRunResult | null> {
  const doc = await getRepo().getDoc<InboxRecord>(INBOX, id);
  if (!doc) return null;
  const rec = doc.data;
  if (rec.status === 'done') return { ok: true, status: 'done', orderId: rec.orderId ?? null, duplicate: rec.duplicate, already: true };
  return runInbox(id, { ...rec, lastReplay: { at: nowIso(), by } }, 'replay', by);
}

/** Records a person may need to act on: failed, or queued past the recovery delay. */
export async function listInboxAttention(limit = 20, now = Date.now()): Promise<InboxView[]> {
  const repo = getRepo();
  const staleBefore = new Date(now - INBOX_STALE_MS).toISOString();
  const docs = await repo.listDocs<InboxRecord>(INBOX, { keys: ['error', 'queued'], limit: 500 });
  return docs
    .filter((d) => d.data.status === 'error' || (d.data.receivedAt < staleBefore && (!d.data.lastAttemptAt || d.data.lastAttemptAt < staleBefore)))
    .slice(0, limit)
    .map(({ id, data: r }) => {
      const deadline = inboxDeadline(r);
      return {
        id, channel: r.channel, externalOrderId: r.externalOrderId, displayId: r.order?.displayId ?? null, brandName: r.order?.brandName ?? null,
        total: typeof r.order?.total === 'number' ? r.order.total : null, items: r.order ? r.order.lines?.length ?? 0 : null,
        status: r.status, stuck: r.status === 'queued', receivedAt: r.receivedAt, attempts: r.attempts ?? 0, error: r.error ?? null, lastReplay: r.lastReplay ?? null,
        deadline, pastDeadline: Boolean(deadline && Date.parse(deadline) <= now),
      };
    });
}
