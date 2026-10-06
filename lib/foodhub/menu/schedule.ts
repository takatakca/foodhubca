// Scheduled menu publishes (Atlas "Scheduled Publish"): pick locations/platforms + date/time;
// Food Hub publishes at that time (sync engine / cron) and logs the result. Can be cancelled.
import crypto from 'node:crypto';
import { logActivity, SCHEDULE_ACTOR, type Actor } from '../activity';
import { publishMenu } from '../ops';
import { getRepo } from '../repo';
import type { ChannelKey } from '../types';

export interface ScheduledPublish {
  id: string;
  brand: string;
  storeIds?: string[];
  channels?: ChannelKey[];
  at: string;
  createdBy: string;
  createdAt: string;
  status: 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled';
  /** When the publish was claimed by a sync/cron run. */
  startedAt?: string;
  /** Same id on every entry created by one "publish every brand sharing this menu" request: they are cancelled together. */
  groupId?: string;
  result?: string;
}

const KEY = 'scheduled_publishes';
/** A "running" entry older than this was cut off (function timeout / crash) and is reported as failed. */
export const STALE_RUNNING_MS = 10 * 60_000;

export async function listScheduled(brand?: string): Promise<ScheduledPublish[]> {
  const all = (await getRepo().getKv<ScheduledPublish[]>(KEY).catch(() => null)) ?? [];
  return all.filter((s) => !brand || s.brand === brand).sort((a, b) => a.at.localeCompare(b.at));
}

async function saveAll(list: ScheduledPublish[]) {
  // Keep the last 200 entries.
  await getRepo().setKv(KEY, list.slice(-200));
}

export async function schedulePublish(input: { brand: string; storeIds?: string[]; channels?: ChannelKey[]; at: string; groupId?: string }, actor: Actor): Promise<ScheduledPublish> {
  const when = Date.parse(input.at);
  if (!Number.isFinite(when) || when < Date.now() + 60_000) throw new Error('Pick a date and time at least one minute in the future.');
  const entry: ScheduledPublish = { id: crypto.randomUUID(), brand: input.brand, storeIds: input.storeIds, channels: input.channels, at: new Date(when).toISOString(), createdBy: actor.name, createdAt: new Date().toISOString(), status: 'scheduled', ...(input.groupId ? { groupId: input.groupId } : {}) };
  const all = (await getRepo().getKv<ScheduledPublish[]>(KEY)) ?? [];
  await saveAll([...all, entry]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'schedule_publish', status: 'queued', brandName: input.brand, summary: `Menu publish for ${input.brand} scheduled at ${new Date(when).toLocaleString('fr-CA')}` });
  return entry;
}

/** Cancels a scheduled publish — and every other brand's entry from the same "all brands" request. */
export async function cancelScheduled(id: string, actor: Actor): Promise<boolean> {
  const all = (await getRepo().getKv<ScheduledPublish[]>(KEY)) ?? [];
  const e = all.find((x) => x.id === id && x.status === 'scheduled');
  if (!e) return false;
  const hit = all.filter((x) => x.status === 'scheduled' && (x.id === id || (e.groupId && x.groupId === e.groupId)));
  for (const x of hit) x.status = 'cancelled';
  await saveAll(all);
  for (const x of hit) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'cancel_scheduled_publish', status: 'info', brandName: x.brand, summary: `Scheduled menu publish for ${x.brand} cancelled` });
  }
  return true;
}

/** Runs every due scheduled publish once. Called by the sync engine and the cron. */
export async function runDuePublishes(now = Date.now()): Promise<number> {
  const all = (await getRepo().getKv<ScheduledPublish[]>(KEY).catch(() => null)) ?? [];
  // A publish claimed by an earlier run that never wrote its result was cut off (timeout/crash):
  // never leave it looking "in progress" (or done) — report it failed so the owner publishes again.
  let stale = 0;
  for (const x of all) {
    if (x.status !== 'running' || Date.parse(x.startedAt ?? x.at) > now - STALE_RUNNING_MS) continue;
    x.status = 'failed'; x.result = 'Interrupted before every store was updated (timeout) — publish again.'; stale++;
    await logActivity({ actor: SCHEDULE_ACTOR.name, source: SCHEDULE_ACTOR.source, kind: 'menu_publish', action: 'scheduled_publish', status: 'failed', brandName: x.brand, summary: `Scheduled menu publish for ${x.brand} was interrupted — publish again` });
  }
  const due = all.filter((x) => x.status === 'scheduled' && Date.parse(x.at) <= now);
  if (!due.length) { if (stale) await saveAll(all); return 0; }
  // Claim as "running" first so two concurrent syncs cannot both publish; the real outcome is written per entry below.
  for (const d of due) { d.status = 'running'; d.startedAt = new Date(now).toISOString(); }
  await saveAll(all);
  for (const d of due) {
    try {
      const rows = await publishMenu(d.brand, { storeIds: d.storeIds, channels: d.channels, actor: { ...SCHEDULE_ACTOR, name: `Scheduled by ${d.createdBy}` } });
      d.result = `${rows.filter((r) => r.result.ok).length}/${rows.length} stores updated`;
      d.status = !rows.length || rows.some((r) => !r.result.ok) ? 'failed' : 'done';
    } catch (error) {
      d.status = 'failed';
      d.result = error instanceof Error ? error.message : String(error);
    }
    // Persist each result immediately: a crash on the next entry must not hide this one's outcome.
    await saveAll(all);
  }
  return due.length;
}
