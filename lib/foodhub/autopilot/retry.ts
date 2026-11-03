// Autopilot · "Retry refused sends" (OFF by default). A menu publish, an 86 / back in stock or a store pause that a
// platform REFUSED (job status error; "blocked" = never sent, so not a refusal) is sent again by Autopilot at most 3
// times, 2, 10 then 30 minutes apart; after the third refusal the Watchtower opens an incident (menu_failed).
//
// Only where nothing retries today: store resumes after a timed pause already retry (ops.reopenExpiredPauses), the
// tablet-off guard retries its own pauses, holiday closures are re-applied on every sync, Clover orders have their own
// retry. So: publishes, 86 / back in stock, and pauses made by a person or by another rule. A DoorDash "show / hide
// menu" (Settings → DoorDash API, a menu_push carrying menuActive) is NOT a publish and is never retried: a publish
// would send the menu visible, the opposite of a refused "hide".
//
// Safe by construction:
//   - only failures that happened after the switch was turned on, and in the last 2 hours — checked when a refusal is
//     picked up AND again before every retry, so a chain from an earlier "on" or from before a long break in the sync
//     is dropped, never sent late; a retry more than 15 minutes overdue is dropped too;
//   - turning the switch off ends every waiting chain (switches.ts → endWaitingRetries);
//   - a protected store (Po Poulet NDG, a locked menu, "Do not touch", a forbidden DoorDash store) is never retried;
//   - a newer action on the same store (a person's click, another rule) wins: the old one is never sent again;
//   - a person's « Arrêter » wins, even when it lands while a heartbeat is sending (re-read before each send and
//     before saving);
//   - an 86 / pause whose end time is over, or whose state in Food Hub no longer matches, is not sent again;
//   - every send goes through the same fan-out as a click (ops.ts), logged with the actor "Autopilot".
import { AUTOPILOT_ACTOR, logActivity, type Actor } from '../activity';
import { isRelayStore } from '../adapters/relay';
import { CHANNEL_LABELS } from '../config';
import { menuChangesRefused } from '../menu/lock';
import { getMenuSharing, sourceOf } from '../menu/shared';
import { HOLIDAY_REASON, offRefsAt, publishMenu, setItemAvailability, setStoresOnline, type FanOut } from '../ops';
import { getRepo } from '../repo';
import { GUARD_REASON, isLockedStore, isStoreOnline } from '../store-availability/common';
import { foodhubTimeZone } from '../time';
import type { ActivityKind, ChannelKey, ChannelStore, FoodHubJob } from '../types';
import { noteRun } from './runs';

export const RETRY_KEY = 'autopilot_retries_v1';
/** Minutes before the 1st, 2nd and 3rd retry. */
export const RETRY_DELAYS_MIN = [2, 10, 30] as const;
export const RETRY_LOOKBACK_MS = 2 * 3600_000;
/** A retry this late (the sync stopped for a while) is dropped, not sent: the moment for it has passed. */
export const RETRY_OVERDUE_MS = 15 * 60_000;
/** A gave-up chain keeps its incident open this long, unless a later send to that store worked or a person stopped it. */
export const RETRY_INCIDENT_MS = 6 * 3600_000;
const MAX_SENDS_PER_TICK = 5;
const KEEP_MS = 7 * 86400_000;
const KEEP_MAX = 300;

export type RetryKind = 'menu_push' | 'item_toggle' | 'store_toggle';
const KINDS: RetryKind[] = ['menu_push', 'item_toggle', 'store_toggle'];

export interface RetryChain {
  /** The refused job that started the chain. */
  id: string;
  kind: RetryKind;
  storeId: string;
  channel: ChannelKey;
  brandName: string;
  locationCode: string;
  request: Record<string, unknown>;
  failedAt: string;
  lastError: string;
  /** Retries already sent (0–3). */
  attempts: number;
  nextAt: string | null;
  status: 'waiting' | 'done' | 'gave_up' | 'superseded' | 'skipped' | 'stopped';
  /** Jobs written by Autopilot's own sends (never mistaken for a new refusal). */
  childJobIds: string[];
  endedAt?: string;
  note?: string;
  stoppedBy?: string;
}
type Chains = Record<string, RetryChain>;

export interface RetryTick { planned: number; sent: number; ok: number; gaveUp: number; ended: number }

function hhmm(ms: number): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: foodhubTimeZone(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** A copy of the stored chains (never the stored object itself: what is changed is saved on purpose, never by accident). */
export async function getChains(): Promise<Chains> {
  const stored = await getRepo().getKv<Chains>(RETRY_KEY).catch(() => null);
  return stored ? structuredClone(stored) : {};
}

const refsOf = (r: Record<string, unknown>) => [...((r.itemRefs as string[] | undefined) ?? []), ...((r.modifierRefs as string[] | undefined) ?? [])].map(String);
const resultStatusOf = (j: FoodHubJob) => String((j.result as { status?: string } | null)?.status ?? '');
const errorOf = (j: FoodHubJob) => String((j.result as { message?: string } | null)?.message ?? 'refused').slice(0, 300);

/** A refused job Autopilot may send again (see the header for why each case is left out). */
export function retryableJob(j: FoodHubJob, sinceMs: number): boolean {
  if (!KINDS.includes(j.kind as RetryKind) || j.status !== 'error') return false;
  if (['blocked', 'skipped', 'queued'].includes(resultStatusOf(j))) return false;
  if (!(Date.parse(j.createdAt) >= sinceMs)) return false;
  const r = j.request ?? {};
  if (typeof r.storeId !== 'string' || !r.storeId || r.locked === true) return false;
  // A DoorDash « show / hide menu » (doordash/stores.ts setDoorDashMenuActive): resending it as a publish would show a
  // menu a person asked to hide. Left to the person.
  if (j.kind === 'menu_push') return typeof r.menuActive !== 'boolean';
  if (j.kind === 'store_toggle') return r.online === false && r.reason !== GUARD_REASON && r.reason !== HOLIDAY_REASON;
  if (j.kind === 'item_toggle') return refsOf(r).length > 0 && typeof r.available === 'boolean';
  return true;
}

function what(c: Pick<RetryChain, 'kind' | 'request'>): { fr: string; en: string } {
  if (c.kind === 'menu_push') return { fr: 'Publication du menu', en: 'Menu publish' };
  if (c.kind === 'store_toggle') return { fr: 'Pause du magasin', en: 'Store pause' };
  const refs = refsOf(c.request).slice(0, 4).join(', ');
  return c.request.available ? { fr: `Retour en stock (${refs})`, en: `Back in stock (${refs})` } : { fr: `86 (${refs})`, en: `86 (${refs})` };
}

function activityKind(kind: RetryKind): ActivityKind {
  return kind === 'menu_push' ? 'menu_publish' : kind === 'item_toggle' ? 'item_availability' : 'store_status';
}

function where(c: Pick<RetryChain, 'brandName' | 'locationCode' | 'channel'>): string {
  return `${c.brandName} · ${c.locationCode} on ${CHANNEL_LABELS[c.channel] ?? c.channel}`;
}

async function log(c: RetryChain, action: string, status: 'success' | 'failed' | 'queued' | 'info', summary: string) {
  await logActivity({ actor: AUTOPILOT_ACTOR.name, source: AUTOPILOT_ACTOR.source, kind: activityKind(c.kind), action, status, channel: c.channel, brandName: c.brandName, locationCode: c.locationCode, storeId: c.storeId,
    summary: `Autopilot: ${summary}`, detail: { retryOf: c.id, attempts: c.attempts } });
}

/** A newer action on the same store (not one of Autopilot's own sends) for the same thing: it wins. */
function supersededBy(c: RetryChain, jobs: FoodHubJob[]): FoodHubJob | undefined {
  const refs = new Set(refsOf(c.request));
  return jobs.find((j) => j.id !== c.id && !c.childJobIds.includes(j.id) && j.kind === c.kind && j.request?.storeId === c.storeId
    && j.createdAt > c.failedAt && (c.kind !== 'item_toggle' || refsOf(j.request ?? {}).some((r) => refs.has(r))));
}

function end(c: RetryChain, status: RetryChain['status'], note: string, now: number) {
  c.status = status; c.nextAt = null; c.note = note; c.endedAt = new Date(now).toISOString();
}

/**
 * Why this chain must not be sent again right now (null = send it). `since` = the switch-on time or 2 hours ago,
 * whichever is later: a chain from before it (an earlier "on", a long break in the sync) is never sent late.
 */
async function stopReason(c: RetryChain, store: ChannelStore | null, jobs: FoodHubJob[], now: number, since: number): Promise<{ status: RetryChain['status']; note: string } | null> {
  if (!(Date.parse(c.failedAt) >= since)) return { status: 'skipped', note: 'too old: refused before the switch was last turned on, or more than 2 hours ago' };
  if (c.nextAt && now - Date.parse(c.nextAt) > RETRY_OVERDUE_MS) return { status: 'skipped', note: `too late: the retry was due at ${hhmm(Date.parse(c.nextAt))} (the sync was not running)` };
  if (!store) return { status: 'skipped', note: 'store removed' };
  if (isRelayStore(store)) return { status: 'skipped', note: 'relay store (orders only)' };
  // Protected stores are never paused, published or 86'd by an automation (store-availability/common.ts, menu/lock.ts).
  if (isLockedStore(store) || (c.kind !== 'store_toggle' && menuChangesRefused(store))) return { status: 'skipped', note: 'protected store — never touched by an automation' };
  const newer = supersededBy(c, jobs);
  if (newer) return { status: 'superseded', note: `a newer action on this store (${newer.status}) replaced it` };
  const until = Number(c.request.untilMs) || 0;
  if (c.kind === 'store_toggle') {
    if (until && until <= now + 60_000) return { status: 'skipped', note: 'the pause time is already over' };
    if (!isStoreOnline(store)) return { status: 'done', note: 'the store is already paused' };
  }
  if (c.kind === 'item_toggle') {
    if (c.request.available === false && until && until <= now + 60_000) return { status: 'skipped', note: 'the 86 time is already over' };
    const sharing = await getMenuSharing();
    const menu = await getRepo().getMenu(sourceOf(sharing, store.brandName));
    if (!menu) return { status: 'skipped', note: 'no menu' };
    const off = offRefsAt(menu, store.locationCode, now);
    const refs = refsOf(c.request);
    const matches = c.request.available ? refs.every((r) => !off.has(r)) : refs.every((r) => off.has(r));
    if (!matches) return { status: 'superseded', note: 'changed in Food Hub since — the newer state wins' };
  }
  return null;
}

async function send(c: RetryChain, store: ChannelStore): Promise<FanOut> {
  const r = c.request;
  const untilMs = Number(r.untilMs) || undefined;
  if (c.kind === 'menu_push') return publishMenu(store.brandName, { storeIds: [store.id], actor: AUTOPILOT_ACTOR });
  if (c.kind === 'item_toggle') {
    return setItemAvailability(store.brandName, refsOf(r), r.available === true, { locationCode: store.locationCode, storeIds: [store.id], untilMs: r.available ? undefined : untilMs, actor: AUTOPILOT_ACTOR });
  }
  return setStoresOnline([store.id], false, { untilMs, reason: typeof r.reason === 'string' ? r.reason : undefined, actor: AUTOPILOT_ACTOR });
}

/**
 * One heartbeat (called by runAutopilot while the switch is on): picks up new refusals since `switchOnAt`, sends the
 * due retries (5 at most per heartbeat), forgets old chains. Never throws.
 */
export async function tickRetries(now: number, switchOnAt: string): Promise<RetryTick> {
  const out: RetryTick = { planned: 0, sent: 0, ok: 0, gaveUp: 0, ended: 0 };
  try {
    const repo = getRepo();
    const chains = await getChains();
    const jobs = await repo.listJobs(500);
    const children = new Set(Object.values(chains).flatMap((c) => c.childJobIds));
    const since = Math.max(now - RETRY_LOOKBACK_MS, Date.parse(switchOnAt) || now);
    let changed = false;
    for (const j of jobs) {
      if (chains[j.id] || children.has(j.id) || !retryableJob(j, since)) continue;
      const store = await repo.getStore(String(j.request.storeId));
      if (!store) continue;
      const c: RetryChain = {
        id: j.id, kind: j.kind as RetryKind, storeId: store.id, channel: store.channel, brandName: store.brandName, locationCode: store.locationCode,
        request: j.request, failedAt: j.createdAt, lastError: errorOf(j), attempts: 0,
        nextAt: new Date(Date.parse(j.createdAt) + RETRY_DELAYS_MIN[0] * 60_000).toISOString(), status: 'waiting', childJobIds: [],
      };
      chains[j.id] = c; changed = true;
      const w = what(c);
      if (isRelayStore(store) || isLockedStore(store) || (c.kind !== 'store_toggle' && menuChangesRefused(store))) {
        // Remembered (so it is not looked at again), never sent.
        end(c, 'skipped', 'protected store — never touched by an automation', now); out.ended++;
        await log(c, 'autopilot_retry_ended', 'info', `${w.en} refused for ${where(c)} — not retried: protected store, never touched by an automation`);
        continue;
      }
      out.planned++;
      await log(c, 'autopilot_retry_planned', 'queued', `${w.en} refused for ${where(c)} (${c.lastError}) — retry 1/3 at ${hhmm(Date.parse(c.nextAt!))}`);
    }
    const due = Object.values(chains).filter((c) => c.status === 'waiting' && c.nextAt && Date.parse(c.nextAt) <= now).sort((a, b) => a.nextAt!.localeCompare(b.nextAt!));
    let budget = MAX_SENDS_PER_TICK;
    for (const c of due) {
      if (budget <= 0) break;
      changed = true;
      const store = await repo.getStore(c.storeId);
      const w = what(c);
      const stop = await stopReason(c, store, jobs, now, since);
      if (stop) {
        end(c, stop.status, stop.note, now); out.ended++;
        await log(c, 'autopilot_retry_ended', 'info', `${w.en} for ${where(c)} not sent again — ${stop.note}`);
        continue;
      }
      // A person may have clicked « Arrêter » while this heartbeat was busy with another send: theirs wins.
      const latest = (await getChains())[c.id];
      if (latest && latest.status !== 'waiting') { Object.assign(c, latest); continue; }
      budget--;
      const started = new Date().toISOString();
      let ok = false; let blocked = false; let message = '';
      try {
        const rows = await send(c, store!);
        const res = rows.find((x) => x.storeId === c.storeId)?.result;
        ok = Boolean(res?.ok); blocked = res?.status === 'blocked' || !res; message = res?.message ?? 'not sent';
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      // The jobs this send wrote: Autopilot's own, never a new refusal to retry.
      const mine = (await repo.listJobs(50).catch(() => [] as FoodHubJob[])).filter((j) => j.createdAt >= started && j.kind === c.kind && j.request?.storeId === c.storeId).map((j) => j.id);
      c.childJobIds = [...new Set([...c.childJobIds, ...mine])];
      c.attempts++; out.sent++;
      if (ok) {
        end(c, 'done', `worked on retry ${c.attempts}/3`, now); out.ok++;
        await log(c, 'autopilot_retry_ok', 'success', `${w.en} for ${where(c)} went through on retry ${c.attempts}/3`);
        await noteRun('retry_failed_jobs', { status: 'success', fr: `${w.fr} réussi(e) au nouvel essai ${c.attempts}/3 — ${c.brandName} · ${c.locationCode}`, en: `${w.en} went through on retry ${c.attempts}/3 — ${c.brandName} · ${c.locationCode}` });
      } else if (blocked) {
        end(c, 'skipped', `not sent: ${message}`, now); out.ended++;
        await log(c, 'autopilot_retry_ended', 'info', `${w.en} for ${where(c)} not sent (${message}) — Autopilot stops here`);
      } else if (c.attempts >= RETRY_DELAYS_MIN.length) {
        c.lastError = message.slice(0, 300);
        end(c, 'gave_up', `refused ${c.attempts + 1} times`, now); out.gaveUp++;
        await log(c, 'autopilot_retry_gave_up', 'failed', `${w.en} for ${where(c)} still refused after 3 retries (${c.lastError}) — an alert is open; do it by hand on the platform or from Food Hub`);
        await noteRun('retry_failed_jobs', { status: 'failed', fr: `${w.fr} toujours refusé(e) après 3 essais — ${c.brandName} · ${c.locationCode} : alerte ouverte`, en: `${w.en} still refused after 3 retries — ${c.brandName} · ${c.locationCode}: alert open` });
      } else {
        c.lastError = message.slice(0, 300);
        c.nextAt = new Date(now + RETRY_DELAYS_MIN[c.attempts] * 60_000).toISOString();
        await log(c, 'autopilot_retry_failed', 'failed', `${w.en} for ${where(c)} refused again on retry ${c.attempts}/3 (${c.lastError}) — next try at ${hhmm(Date.parse(c.nextAt))}`);
      }
    }
    // Forget ended chains after a week (the activity log keeps the story).
    const keep = Object.values(chains).filter((c) => c.status === 'waiting' || now - Date.parse(c.endedAt ?? c.failedAt) < KEEP_MS)
      .sort((a, b) => b.failedAt.localeCompare(a.failedAt)).slice(0, KEEP_MAX);
    if (keep.length !== Object.keys(chains).length) changed = true;
    if (changed) {
      // Saved over a fresh read: a stop (or a switch-off) written while this heartbeat was sending is kept, with the
      // jobs this heartbeat wrote remembered on it (never taken for a new refusal).
      const stored = await getChains();
      const merged: Chains = {};
      for (const c of keep) {
        const s = stored[c.id];
        merged[c.id] = s && s.status === 'stopped' ? { ...s, attempts: Math.max(s.attempts, c.attempts), childJobIds: [...new Set([...s.childJobIds, ...c.childJobIds])] } : c;
      }
      await repo.setKv(RETRY_KEY, merged);
    }
  } catch (e) {
    console.error('[foodhub] autopilot retries failed', e instanceof Error ? e.message : e);
  }
  return out;
}

/** The chains still waiting or that gave up recently (the page lists them with « Arrêter »). */
export async function openChains(now = Date.now()): Promise<RetryChain[]> {
  return Object.values(await getChains())
    .filter((c) => c.status === 'waiting' || (c.status === 'gave_up' && now - Date.parse(c.endedAt ?? c.failedAt) < RETRY_INCIDENT_MS))
    .sort((a, b) => (a.nextAt ?? a.endedAt ?? '').localeCompare(b.nextAt ?? b.endedAt ?? ''));
}

/** Undo: a person stops a waiting chain (nothing more is sent) or dismisses a gave-up one (its incident closes). */
export async function stopRetry(id: string, actor: Actor, now = Date.now()): Promise<RetryChain | null> {
  const chains = await getChains();
  const c = chains[id];
  if (!c || (c.status !== 'waiting' && c.status !== 'gave_up')) return null;
  end(c, 'stopped', `stopped by ${actor.name}`, now);
  c.stoppedBy = actor.name;
  await getRepo().setKv(RETRY_KEY, chains);
  const w = what(c);
  await logActivity({ actor: actor.name, source: actor.source, kind: activityKind(c.kind), action: 'autopilot_retry_stopped', status: 'info', channel: c.channel, brandName: c.brandName, locationCode: c.locationCode, storeId: c.storeId,
    summary: `${actor.name} stopped Autopilot's retries: ${w.en} for ${where(c)}`, detail: { retryOf: c.id } });
  return c;
}

/**
 * "Retry refused sends" was turned off: every waiting chain ends (nothing more is sent, even if the switch comes back
 * on later). Called by switches.ts setSwitch. Returns how many ended.
 */
export async function endWaitingRetries(actor: Actor, now = Date.now()): Promise<number> {
  const chains = await getChains();
  const waiting = Object.values(chains).filter((c) => c.status === 'waiting');
  if (!waiting.length) return 0;
  for (const c of waiting) { end(c, 'stopped', `switch turned off by ${actor.name}`, now); c.stoppedBy = actor.name; }
  await getRepo().setKv(RETRY_KEY, chains);
  for (const c of waiting) await log(c, 'autopilot_retry_ended', 'info', `${what(c).en} for ${where(c)} not sent again — “Retry refused sends” was turned off by ${actor.name}`);
  return waiting.length;
}

/** Watchtower: one incident per chain that gave up (menu_failed), until a later send to that store works or a person stops it. */
export interface RetryDetection {
  key: string; kind: 'menu_failed'; severity: 'warning';
  title: string; titleEn: string; detail?: string; detailEn?: string;
  locationCode?: string | null; brandName?: string | null; channel?: string | null; storeId?: string | null;
}

export async function retryIncidentDetections(now: number, jobs: FoodHubJob[]): Promise<RetryDetection[]> {
  const chains = Object.values(await getChains()).filter((c) => c.status === 'gave_up' && now - Date.parse(c.endedAt ?? c.failedAt) < RETRY_INCIDENT_MS);
  return chains.filter((c) => !jobs.some((j) => j.status === 'done' && j.kind === c.kind && j.request?.storeId === c.storeId && j.createdAt > (c.endedAt ?? c.failedAt))).map((c) => {
    const w = what(c);
    return {
      key: `autopilot_retry:${c.id}`, kind: 'menu_failed' as const, severity: 'warning' as const,
      title: `${w.fr} refusé(e) 4 fois : ${c.brandName} · ${c.locationCode}`, titleEn: `${w.en} refused 4 times: ${c.brandName} · ${c.locationCode}`,
      detail: `Autopilot a réessayé 3 fois (2, 10 puis 30 min). Dernière réponse : ${c.lastError}`, detailEn: `Autopilot retried 3 times (2, 10 then 30 min). Last answer: ${c.lastError}`,
      locationCode: c.locationCode, brandName: c.brandName, channel: c.channel, storeId: c.storeId,
    };
  });
}
