// Webhook inbox — "never lose an order" (docs/MASTER_PLAN.md Phase 1, item 1).
//
// Every platform webhook that carries an order, a cancellation, a courier or a store/menu update is SAVED here before
// Food Hub answers the platform, then processed. So:
//  - the server stopping right after answering loses nothing: the recovery runner (recovery.ts) processes again any
//    entry still "received" after 2 minutes;
//  - a failure (Uber order fetch refused, database hiccup…) is retried by itself after 30 s and 2 min, then waits
//    for a person: Settings → Platforms & Clover → Webhook inbox → Replay;
//  - processing twice is harmless: orders are de-duplicated by platform + order id, statuses only move forward.
// When the inbox itself cannot be written (database down), the route answers 503 so the platform sends it again.
//
// Stored in fh_docs, collection "webhook_inbox"; the doc key is the status, so the runner only reads open entries.
import crypto from 'node:crypto';
import { logActivity, type Actor } from './activity';
import { CHANNEL_LABELS, nowIso } from './config';
import { getRepo } from './repo';
import type { ChannelKey, NormalizedOrder } from './types';

export const INBOX = 'webhook_inbox';
export type InboxKind = 'uber' | 'doordash' | 'order';
export type InboxStatus = 'received' | 'processing' | 'done' | 'failed';

export interface InboxEntry {
  id: string;
  channel: ChannelKey;
  kind: InboxKind;
  /** Platform order id / event reference, for the list and for search. */
  reference: string | null;
  status: InboxStatus;
  receivedAt: string;
  updatedAt: string;
  attempts: number;
  /** Next automatic try for a failed entry (null = waits for a person). */
  nextAt?: string | null;
  lastError?: string | null;
  result?: string | null;
  orderId?: string | null;
  body: unknown;
}

/** Seconds before each automatic re-try of a failed entry. */
const RETRY_S = [30, 120];
/** An entry still "received" / "processing" after this long was interrupted (server stopped): process it again. */
const STUCK_MS = 2 * 60_000;
const KEEP_DONE_DAYS = 14;

type Handler = (body: any) => Promise<{ result: string; orderId?: string | null }>;

async function handlerFor(kind: InboxKind): Promise<Handler> {
  if (kind === 'uber') return (await import('./webhooks/uber')).handleUberWebhook;
  if (kind === 'doordash') return (await import('./webhooks/doordash')).handleDoorDashWebhook;
  const { processIncomingOrder } = await import('./pipeline');
  return async (body: NormalizedOrder) => {
    const out = await processIncomingOrder(body);
    return { result: out.duplicate ? 'duplicate (already received)' : `order received${out.pos?.ok ? ', in Clover' : out.pos?.error ? `, Clover: ${out.pos.error}` : ''}`, orderId: out.order.id };
  };
}

async function save(e: InboxEntry) {
  await getRepo().putDocs<InboxEntry>(INBOX, [{ id: e.id, key: e.status, at: e.receivedAt, data: e }]);
}

export async function getInboxEntry(id: string): Promise<InboxEntry | null> {
  return (await getRepo().getDoc<InboxEntry>(INBOX, id))?.data ?? null;
}

/** Saves a webhook before the platform gets its answer. Throws when it cannot be saved (the route answers 503). */
export async function receiveWebhook(input: { channel: ChannelKey; kind: InboxKind; body: unknown; reference?: string | null }): Promise<InboxEntry> {
  const at = nowIso();
  const entry: InboxEntry = { id: crypto.randomUUID(), channel: input.channel, kind: input.kind, reference: input.reference ? String(input.reference).slice(0, 200) : null, status: 'received', receivedAt: at, updatedAt: at, attempts: 0, body: input.body };
  await save(entry);
  return entry;
}

/** Processes one entry (live, retry or Replay). Never throws: the outcome is written on the entry. */
export async function runInboxEntry(id: string, opts: { now?: number; replayBy?: string } = {}): Promise<InboxEntry | null> {
  const now = opts.now ?? Date.now();
  const entry = await getInboxEntry(id);
  if (!entry) return null;
  if (entry.status === 'done' && !opts.replayBy) return entry;
  const started: InboxEntry = { ...entry, status: 'processing', attempts: entry.attempts + 1, updatedAt: new Date(now).toISOString() };
  await save(started);
  try {
    const out = await (await handlerFor(entry.kind))(entry.body);
    const done: InboxEntry = { ...started, status: 'done', nextAt: null, lastError: null, result: out.result, orderId: out.orderId ?? entry.orderId ?? null, updatedAt: nowIso() };
    await save(done);
    if (opts.replayBy) {
      await logActivity({ actor: opts.replayBy, source: 'dashboard', kind: 'settings', action: 'webhook_replayed', status: 'success', channel: entry.channel, orderId: done.orderId ?? null,
        summary: `${CHANNEL_LABELS[entry.channel]} webhook replayed${entry.reference ? ` (${entry.reference})` : ''}: ${out.result}` });
    }
    return done;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const nextS = RETRY_S[started.attempts - 1];
    const failed: InboxEntry = { ...started, status: 'failed', lastError: reason.slice(0, 500), nextAt: nextS !== undefined && !opts.replayBy ? new Date(Date.now() + nextS * 1000).toISOString() : null, updatedAt: nowIso() };
    await save(failed).catch((e) => console.error('[foodhub] could not save the failed inbox entry', e));
    console.error(`[foodhub] ${entry.channel} webhook ${entry.reference ?? entry.id} failed:`, reason);
    // Logged once per entry when it stops retrying by itself (or on a failed Replay): the Watchtower picks it up.
    if (!failed.nextAt) {
      await logActivity({ actor: opts.replayBy ?? CHANNEL_LABELS[entry.channel], source: opts.replayBy ? 'dashboard' : 'platform', kind: entry.kind === 'order' || entry.kind === 'uber' ? 'order' : 'settings', action: 'webhook_failed', status: 'failed', channel: entry.channel,
        summary: `${CHANNEL_LABELS[entry.channel]} webhook${entry.reference ? ` ${entry.reference}` : ''} could not be processed after ${failed.attempts} tr${failed.attempts > 1 ? 'ies' : 'y'}: ${reason} — kept in the webhook inbox (Settings → Platforms → Replay)`,
        detail: { inboxId: entry.id, reason } }).catch(() => undefined);
    }
    return failed;
  }
}

export interface InboxSweep { processed: number; failed: number }

/** Interrupted entries (still received / processing after 2 min) and failed entries whose retry is due. */
export async function sweepInbox(opts: { now?: number; limit?: number } = {}): Promise<InboxSweep> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const open = (await repo.listDocs<InboxEntry>(INBOX, { keys: ['received', 'processing', 'failed'], limit: 500 })).map((d) => d.data);
  const due = open.filter((e) => (e.status === 'failed' ? Boolean(e.nextAt) && Date.parse(e.nextAt!) <= now : now - Date.parse(e.updatedAt) >= STUCK_MS))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(0, opts.limit ?? 20);
  const out: InboxSweep = { processed: 0, failed: 0 };
  for (const e of due) {
    const r = await runInboxEntry(e.id, { now });
    if (r?.status === 'done') out.processed++; else out.failed++;
  }
  // Housekeeping: processed entries are kept two weeks (proof of what each platform sent), then removed.
  const old = await repo.listDocs<InboxEntry>(INBOX, { keys: ['done'], until: new Date(now - KEEP_DONE_DAYS * 86400_000).toISOString(), limit: 500 }).catch(() => []);
  if (old.length) await repo.deleteDocs(INBOX, old.map((d) => d.id)).catch(() => undefined);
  return out;
}

export interface InboxSummary { received: number; stuck: number; failed: number; waiting: number; lastAt: string | null; entries: InboxEntry[] }

/** For Settings → Platforms (entries that need a look) and /api/health (counts). */
export async function inboxSummary(opts: { now?: number; withBodies?: boolean } = {}): Promise<InboxSummary> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  const open = (await repo.listDocs<InboxEntry>(INBOX, { keys: ['received', 'processing', 'failed'], limit: 500 })).map((d) => d.data);
  const recent = (await repo.listDocs<InboxEntry>(INBOX, { since: new Date(now - 86400_000).toISOString(), limit: 1 })).map((d) => d.data);
  const stuck = open.filter((e) => e.status !== 'failed' && now - Date.parse(e.updatedAt) >= STUCK_MS).length;
  const failed = open.filter((e) => e.status === 'failed');
  return {
    received: open.filter((e) => e.status !== 'failed').length,
    stuck,
    failed: failed.filter((e) => !e.nextAt).length,
    waiting: failed.filter((e) => e.nextAt).length,
    lastAt: recent[0]?.receivedAt ?? null,
    entries: open.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 50).map((e) => (opts.withBodies ? e : { ...e, body: undefined })),
  };
}

/** Owner / manager: process an entry again now (after fixing a mapping, a key, or once the platform is back). */
export async function replayInboxEntry(id: string, actor: Actor): Promise<InboxEntry | null> {
  const e = await getInboxEntry(id);
  if (!e) return null;
  if (e.status === 'processing' && Date.now() - Date.parse(e.updatedAt) < STUCK_MS) return e;
  return runInboxEntry(id, { replayBy: actor.name });
}
