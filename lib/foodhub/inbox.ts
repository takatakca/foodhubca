// Webhook inbox — "never lose an order" (docs/MASTER_PLAN.md Phase 1, item 1).
//
// Every platform webhook that carries an order, a cancellation, a courier or a store/menu update is SAVED here before
// Food Hub answers the platform, then processed. So:
//  - the server stopping right after answering loses nothing: the recovery runner (recovery.ts) processes again any
//    entry still "received" after 2 minutes;
//  - a failure (Uber order fetch refused, database hiccup…) is retried by itself after 30 s and 2 min, then waits
//    for a person: Settings → Platforms & Clover → Webhook inbox → Replay;
//  - processing twice is harmless: orders are de-duplicated by platform + order id, statuses only move forward;
//  - an automatic run never cooks a late order: past the platform's answer window (deadline.ts — DoorDash 3 min,
//    Skip 5, Uber 11.5; relay and Too Good To Go: FOODHUB_INBOX_MAX_AGE_MIN, default 30) the platform has cancelled
//    it or sent it to its tablet, so the entry waits for a person (Replay) instead of printing a ticket nobody should
//    make; an entry interrupted again and again (the server stops each time) also goes to a person after
//    MAX_RECOVERY_ATTEMPTS tries.
// When the inbox itself cannot be written (database down), the route answers 503 so the platform sends it again — and
// if the write did land with only its answer lost, that entry is marked "refused" (never swept): the platform kept the
// message (it retries, or its tablet takes the order), so Food Hub must not process it a second time.
//
// Stored in fh_docs, collection "webhook_inbox"; the doc key is the status, so the runner only reads open entries.
import crypto from 'node:crypto';
import { logActivity, type Actor } from './activity';
import { CHANNEL_LABELS, nowIso } from './config';
import { deadlineFor, ORDER_DEADLINE_MIN } from './deadline';
import { getRepo } from './repo';
import type { ChannelKey, NormalizedOrder } from './types';

export const INBOX = 'webhook_inbox';
export type InboxKind = 'uber' | 'doordash' | 'order';
export type InboxStatus = 'received' | 'processing' | 'done' | 'failed' | 'refused';

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

/** Seconds before each automatic re-try of a failed entry (FOODHUB_INBOX_RETRY_S, default "30,120"). */
function retryDelaysS(): number[] {
  const list = String(process.env.FOODHUB_INBOX_RETRY_S ?? '30,120').split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? list.slice(0, 5) : [30, 120];
}
/** An entry still "received" / "processing" after this long was interrupted (server stopped): process it again. */
const STUCK_MS = 2 * 60_000;
const KEEP_DONE_DAYS = 14;
/** Tries before an entry that keeps being interrupted (the server stops each time) is handed to a person. */
export const MAX_RECOVERY_ATTEMPTS = 5;

/** Orders without a platform answer window (relay, Too Good To Go) are not processed automatically after this long. */
export function noDeadlineMaxMs(): number {
  const min = Number(process.env.FOODHUB_INBOX_MAX_AGE_MIN);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60_000;
}

/** Does this entry carry a new order (vs a cancel, a courier or a store update)? DoorDash is read the way its route reads it. */
async function carriesOrder(e: InboxEntry): Promise<{ placedAt?: string | null; viaHub?: 'relay' } | null> {
  const body = (e.body ?? {}) as Record<string, any>;
  if (e.kind === 'order') return { placedAt: body.placedAt ?? null, viaHub: body.viaHub };
  if (e.kind === 'uber') return /^orders(\.scheduled)?\.notification$/.test(String(body.event_type ?? '')) ? {} : null;
  const { classifyDoorDash } = await import('./webhooks/doordash');
  const c = classifyDoorDash(body);
  return c.kind === 'order' ? { placedAt: c.order?.placedAt ?? null } : null;
}

/**
 * When automatic runs must stop for an order entry: the platform's answer window (from when the order was placed, else
 * from its arrival here), or FOODHUB_INBOX_MAX_AGE_MIN for orders that have none. Null = not an order.
 */
export async function inboxOrderCutoff(e: InboxEntry): Promise<{ at: number; deadline: boolean } | null> {
  const o = await carriesOrder(e).catch(() => null);
  if (!o) return null;
  const deadline = deadlineFor({ channel: e.channel, createdAt: e.receivedAt, placedAt: o.placedAt ?? null, viaHub: o.viaHub });
  return deadline ? { at: Date.parse(deadline), deadline: true } : { at: Date.parse(e.receivedAt) + noDeadlineMaxMs(), deadline: false };
}

/** The platform store an entry is about (channelStoreId), for a manager limited to some locations. */
export function inboxStoreRef(e: Pick<InboxEntry, 'kind' | 'body'>): string | null {
  const b = (e.body ?? {}) as Record<string, any>;
  const id = e.kind === 'order' ? b.channelStoreId
    : e.kind === 'uber' ? b.meta?.user_id ?? b.store_id ?? b.meta?.store_id
      : b.order?.store?.merchant_supplied_id ?? b.store?.merchant_supplied_id;
  return id ? String(id) : null;
}

/** Location code per platform store, for location-limited viewers. */
async function storeLocations(): Promise<Map<string, string>> {
  return new Map((await getRepo().listStores()).map((s) => [`${s.channel}:${s.channelStoreId}`, s.locationCode]));
}

/** A manager limited to some locations sees an entry when its store is mapped to one of them; unmapped stores only the unrestricted. */
function visibleTo(e: Pick<InboxEntry, 'channel' | 'kind' | 'body'>, locations: string[] | undefined, where: Map<string, string>): boolean {
  if (!locations?.length) return true;
  const loc = where.get(`${e.channel}:${inboxStoreRef(e) ?? ''}`);
  return Boolean(loc && locations.includes(loc));
}

type Handler = (body: any) => Promise<{ result: string; orderId?: string | null }>;

async function handlerFor(kind: InboxKind): Promise<Handler> {
  if (kind === 'uber') return (await import('./webhooks/uber')).handleUberWebhook;
  if (kind === 'doordash') return (await import('./webhooks/doordash')).handleDoorDashWebhook;
  const { pipelineOutcomeText, processIncomingOrder } = await import('./pipeline');
  return async (body: NormalizedOrder) => {
    const out = await processIncomingOrder(body);
    return { result: pipelineOutcomeText(out), orderId: out.order.id };
  };
}

async function save(e: InboxEntry) {
  await getRepo().putDocs<InboxEntry>(INBOX, [{ id: e.id, key: e.status, at: e.receivedAt, data: e }]);
}

export async function getInboxEntry(id: string): Promise<InboxEntry | null> {
  return (await getRepo().getDoc<InboxEntry>(INBOX, id))?.data ?? null;
}

/**
 * Saves a webhook before the platform gets its answer. Throws when it cannot be saved: the route answers 503, after
 * refuseInboxEntry with the same id and receivedAt (the write may have landed with only its answer lost).
 */
export async function receiveWebhook(input: { channel: ChannelKey; kind: InboxKind; body: unknown; reference?: string | null; id?: string; receivedAt?: string }): Promise<InboxEntry> {
  const at = input.receivedAt ?? nowIso();
  // `id`: the platform's own event id when it has one (Uber event_id — adapters/uber-inbox.ts), so a re-delivery is recognised.
  const entry: InboxEntry = { id: input.id || crypto.randomUUID(), channel: input.channel, kind: input.kind, reference: input.reference ? String(input.reference).slice(0, 200) : null, status: 'received', receivedAt: at, updatedAt: at, attempts: 0, body: input.body };
  await save(entry);
  return entry;
}

/**
 * Food Hub answered 503 because receiveWebhook threw — but the write may have reached the database with only its
 * answer lost. The platform keeps that message (it retries, or its tablet takes the order), so the entry this delivery
 * tried to write is marked refused (never swept), or removed when even that fails. Never throws.
 */
export async function refuseInboxEntry(id: string, receivedAt: string, why: string): Promise<void> {
  try {
    const e = await getInboxEntry(id);
    if (!e || e.receivedAt !== receivedAt || (e.status !== 'received' && e.status !== 'processing')) return;
    await save({ ...e, status: 'refused', nextAt: null, lastError: `Food Hub answered 503 (${why.slice(0, 200)}): the platform kept this message — not processed here.`, updatedAt: nowIso() });
  } catch {
    await getRepo().deleteDocs(INBOX, [id]).catch((err) => console.error(`[foodhub] inbox ${id}: answered 503 but could not mark or remove an entry that may have been saved —`, err));
  }
}

/** Hands an entry to a person: failed, no automatic retry, the reason on the entry and in the activity log (Watchtower). */
async function handToPerson(entry: InboxEntry, reason: string): Promise<InboxEntry> {
  const failed: InboxEntry = { ...entry, status: 'failed', nextAt: null, lastError: reason.slice(0, 500), updatedAt: nowIso() };
  await save(failed).catch((e) => console.error('[foodhub] could not save the inbox entry for a person', e));
  console.warn(`[foodhub] ${entry.channel} webhook ${entry.reference ?? entry.id} kept in the inbox for a person: ${reason}`);
  await logActivity({ actor: CHANNEL_LABELS[entry.channel], source: 'platform', kind: entry.kind === 'order' || entry.kind === 'uber' ? 'order' : 'settings', action: 'webhook_failed', status: 'failed', channel: entry.channel,
    summary: `${CHANNEL_LABELS[entry.channel]} webhook${entry.reference ? ` ${entry.reference}` : ''} not processed automatically: ${reason} — kept in the webhook inbox (Settings → Platforms → Replay)`,
    detail: { inboxId: entry.id, reason } }).catch(() => undefined);
  return failed;
}

/** Processes one entry (live, retry or Replay). Never throws: the outcome is written on the entry. */
export async function runInboxEntry(id: string, opts: { now?: number; replayBy?: string } = {}): Promise<InboxEntry | null> {
  const now = opts.now ?? Date.now();
  const entry = await getInboxEntry(id);
  if (!entry) return null;
  if ((entry.status === 'done' || entry.status === 'refused') && !opts.replayBy) return entry;
  if (!opts.replayBy) {
    // Never a late kitchen ticket from an automatic run: past the answer window the platform has given up on the order.
    const cutoff = await inboxOrderCutoff(entry);
    if (cutoff && now > cutoff.at) {
      const label = CHANNEL_LABELS[entry.channel];
      return handToPerson(entry, cutoff.deadline
        ? `not processed within ${label}'s ${ORDER_DEADLINE_MIN[entry.channel]}-minute answer window — ${label} may have cancelled it or sent it to its tablet; check there before replaying`
        : `not processed within ${Math.round(noDeadlineMaxMs() / 60_000)} minutes — check with ${label} that the order still stands before replaying`);
    }
  }
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
    const nextS = retryDelaysS()[started.attempts - 1];
    const failed: InboxEntry = { ...started, status: 'failed', lastError: reason.slice(0, 500), nextAt: nextS !== undefined && !opts.replayBy ? new Date(Date.now() + nextS * 1000).toISOString() : null, updatedAt: nowIso() };
    await save(failed).catch((e) => console.error('[foodhub] could not save the failed inbox entry', e));
    // Handled, not a crash: the webhook stays in the inbox (retried by itself, or Replay).
    console.warn(`[foodhub] ${entry.channel} webhook ${entry.reference ?? entry.id} kept in the inbox (try ${failed.attempts}${failed.nextAt ? `, next at ${failed.nextAt}` : ', waits for Replay'}): ${reason}`);
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
    // Interrupted again and again (e.g. a payload that stops the server each time): a person looks at it.
    if (e.status !== 'failed' && e.attempts >= MAX_RECOVERY_ATTEMPTS) {
      await handToPerson(e, `still not processed after ${e.attempts} tries (the last one was interrupted: the server stopped)`);
      out.failed++;
      continue;
    }
    const r = await runInboxEntry(e.id, { now });
    if (r?.status === 'done') out.processed++; else out.failed++;
  }
  // Housekeeping: processed and refused entries are kept two weeks (proof of what each platform sent), then removed.
  const old = await repo.listDocs<InboxEntry>(INBOX, { keys: ['done', 'refused'], until: new Date(now - KEEP_DONE_DAYS * 86400_000).toISOString(), limit: 500 }).catch(() => []);
  if (old.length) await repo.deleteDocs(INBOX, old.map((d) => d.id)).catch(() => undefined);
  return out;
}

export interface InboxSummary { received: number; stuck: number; failed: number; waiting: number; lastAt: string | null; entries: InboxEntry[] }

/**
 * For Settings → Platforms (entries that need a look) and /api/health (counts). `locations`: the viewer's location
 * limit (empty = all) — the same rule as the orders list.
 */
export async function inboxSummary(opts: { now?: number; withBodies?: boolean; locations?: string[] } = {}): Promise<InboxSummary> {
  const now = opts.now ?? Date.now();
  const repo = getRepo();
  let open = (await repo.listDocs<InboxEntry>(INBOX, { keys: ['received', 'processing', 'failed'], limit: 500 })).map((d) => d.data);
  if (opts.locations?.length) {
    const where = await storeLocations();
    open = open.filter((e) => visibleTo(e, opts.locations, where));
  }
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

/** Can a viewer limited to `locations` (empty = all) see / replay this entry or payload? */
export async function inboxVisibleTo(e: Pick<InboxEntry, 'channel' | 'kind' | 'body'>, locations: string[] | undefined): Promise<boolean> {
  return !locations?.length || visibleTo(e, locations, await storeLocations());
}

/** Owner / manager: process an entry again now (after fixing a mapping, a key, or once the platform is back). */
export async function replayInboxEntry(id: string, actor: Actor & { locations?: string[] }): Promise<InboxEntry | null> {
  const e = await getInboxEntry(id);
  if (!e) return null;
  // A manager limited to some locations replays only their locations' entries (same rule as the list).
  if (!(await inboxVisibleTo(e, actor.locations))) return null;
  if (e.status === 'processing' && Date.now() - Date.parse(e.updatedAt) < STUCK_MS) return e;
  return runInboxEntry(id, { replayBy: actor.name });
}
