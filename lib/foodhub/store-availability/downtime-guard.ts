// "Garde tablette éteinte" (OFF by default, per kitchen). When every kitchen tablet of an open kitchen has been off for
// graceMin minutes, the platforms keep sending orders nobody sees: the guard pauses the kitchen's stores on the chosen
// channels for a limited time (pauseMin, re-extended every pauseMin/2 while the tablets stay off, so a crash never leaves
// a store paused for long — the existing timed-pause re-open takes over). When a tablet is back, it resumes only the
// stores it paused itself and that still carry its reason: a person's pause in the meantime wins.
// Never: relay stores, "do not touch" stores, the DoorDash stores the owner forbids (FORBIDDEN_STORE_IDS).
import { z } from 'zod';
import { logActivity, type Actor } from '../activity';
import { brandHoursState, effectiveHours, getHours, holidaysFor, localDate, openIntervals } from '../hours';
import { deviceStatus, listDevices, type Device } from '../identity/devices';
import { setStoresOnline, storesFor, type FanOut } from '../ops';
import { getRepo } from '../repo';
import { foodhubTimeZone } from '../time';
import type { ChannelKey, ChannelStore, HoursConfig } from '../types';
import { AVAILABILITY_CHANNELS, GUARD_ACTOR, GUARD_REASON, isLockedStore, isStoreOnline, platformStatusOf } from './common';

export const GUARD_KEY = 'downtime_guard_v1';
export const GUARD_STATE_KEY = 'downtime_guard_state_v1';

export const guardConfigSchema = z.object({
  enabled: z.boolean().default(false),
  graceMin: z.number().int().min(3).max(30).default(5),
  pauseMin: z.number().int().min(15).max(120).default(30),
  channels: z.array(z.enum(AVAILABILITY_CHANNELS as [ChannelKey, ...ChannelKey[]])).min(1).default([...AVAILABILITY_CHANNELS]),
});
export type GuardConfig = { enabled: boolean; graceMin: number; pauseMin: number; channels: ChannelKey[] };
export const DEFAULT_GUARD: GuardConfig = { enabled: false, graceMin: 5, pauseMin: 30, channels: [...AVAILABILITY_CHANNELS] };

/** What the guard paused at a kitchen (store ids that accepted the pause), when it last (re)paused them, and how many
 *  stores of the last attempt did not take the pause (blocked = not sent, failed = refused): those are tried again. */
export interface GuardState { storeIds: string[]; pausedAt: string; extendedAt: string; untilMs: number; blocked?: number; failed?: number }

export async function getGuardConfigs(): Promise<Record<string, GuardConfig>> {
  const raw = (await getRepo().getKv<Record<string, Partial<GuardConfig>>>(GUARD_KEY).catch(() => null)) ?? {};
  return Object.fromEntries(Object.entries(raw).map(([loc, c]) => {
    const parsed = guardConfigSchema.safeParse(c ?? {});
    return [loc, parsed.success ? parsed.data : { ...DEFAULT_GUARD }];
  }));
}

export async function guardConfigFor(locationCode: string): Promise<GuardConfig> {
  return (await getGuardConfigs())[locationCode] ?? { ...DEFAULT_GUARD };
}

export async function getGuardState(): Promise<Record<string, GuardState>> {
  return (await getRepo().getKv<Record<string, GuardState>>(GUARD_STATE_KEY).catch(() => null)) ?? {};
}

export async function saveGuardConfig(locationCode: string, input: unknown, actor: Actor): Promise<GuardConfig> {
  const parsed = guardConfigSchema.safeParse(input ?? {});
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; '));
  const cfg: GuardConfig = { ...parsed.data, channels: [...new Set(parsed.data.channels)] };
  const all = (await getRepo().getKv<Record<string, GuardConfig>>(GUARD_KEY).catch(() => null)) ?? {};
  await getRepo().setKv(GUARD_KEY, { ...all, [locationCode]: cfg });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'downtime_guard', status: 'success', locationCode,
    summary: `Tablet-off guard ${locationCode}: ${cfg.enabled ? `ON — after ${cfg.graceMin} min, pause ${cfg.pauseMin} min on ${cfg.channels.join(', ')}` : 'OFF'}` });
  return cfg;
}

/** Since when every tablet of the kitchen has been silent (latest heartbeat; enrolment time for one never seen). */
function offSince(devices: Device[]): number {
  return Math.max(...devices.map((d) => Date.parse(d.lastSeenAt ?? d.enrolledAt) || 0));
}

/**
 * When the brand's current opening started (epoch ms), or null when the brand is closed or its hours are unknown.
 * Back-to-back slots (an overnight 16:00–03:00 split at midnight) count as one opening.
 */
export function openSince(hours: HoursConfig, brand: string, loc: string, now: number, tz = foodhubTimeZone()): number | null {
  if (brandHoursState(hours, brand, loc, now, tz) !== 'open') return null;
  const week = effectiveHours(hours, brand, loc);
  if (!week) return null;
  const holidays = holidaysFor(hours, loc, localDate(now - 2 * 86400_000, tz), 4);
  let start: number | null = null;
  let end = -Infinity;
  for (const [a, b] of openIntervals(week, holidays, now - 36 * 3600_000, now + 1, tz)) {
    if (start === null || a > end + 60_000) start = a;
    end = Math.max(end, b);
  }
  // Should not happen (the brand is open): count from now, the safe side (a full grace time).
  return start !== null && start <= now && now < end ? start : now;
}

export interface GuardTick { paused: string[]; extended: string[]; resumed: string[]; blocked: number }

/** Still paused, still with the guard's reason: anything else means a person (or the platform) took over. */
function guardPaused(s: ChannelStore): boolean {
  return !isLockedStore(s) && !isStoreOnline(s) && platformStatusOf(s)?.detail === GUARD_REASON;
}

async function ownStores(loc: string, st: GuardState): Promise<ChannelStore[]> {
  // An empty storeIds filter means "every store" in storesFor: never widen the guard's own scope to the kitchen.
  if (!st.storeIds.length) return [];
  return (await storesFor({ storeIds: st.storeIds, locationCode: loc })).filter(guardPaused);
}

async function resumeOwn(loc: string, st: GuardState, out: GuardTick): Promise<void> {
  const ids = (await ownStores(loc, st)).map((s) => s.id);
  if (!ids.length) return;
  const rows = await setStoresOnline(ids, true, { actor: GUARD_ACTOR });
  out.resumed.push(...rows.filter((r) => r.result.ok).map((r) => r.storeId));
  out.blocked += rows.summary.blockedCount;
}

async function logNotPaused(loc: string, rows: FanOut): Promise<void> {
  const { blockedCount, errorCount } = rows.summary;
  if (!blockedCount && !errorCount) return;
  const why = [blockedCount ? `${blockedCount} not sent (live connector off or not allowed)` : '', errorCount ? `${errorCount} refused or failed on the platform` : ''].filter(Boolean).join(', ');
  await logActivity({ actor: GUARD_ACTOR.name, source: GUARD_ACTOR.source, kind: 'device', action: 'guard_blocked', status: 'failed', locationCode: loc,
    summary: `Tablet-off guard ${loc}: ${blockedCount + errorCount} store(s) NOT paused — ${why}; tried again in a few minutes`,
    detail: { notSent: blockedCount > 0, summary: rows.summary } });
}

/** One heartbeat of the guard. Never throws. */
export async function tickDowntimeGuard(now = Date.now()): Promise<GuardTick> {
  const out: GuardTick = { paused: [], extended: [], resumed: [], blocked: 0 };
  try {
    const configs = await getGuardConfigs();
    const state = await getGuardState();
    const enabledLocs = Object.entries(configs).filter(([, c]) => c.enabled).map(([loc]) => loc);
    if (!enabledLocs.length && !Object.keys(state).length) return out;
    const devices = await listDevices();
    const hours = await getHours();
    let changed = false;
    for (const loc of new Set([...enabledLocs, ...Object.keys(state)])) {
      try {
        const cfg = configs[loc] ?? { ...DEFAULT_GUARD };
        const st = state[loc];
        const kitchen = devices.filter((d) => d.locationCode === loc && !d.revoked);
        const anyOnline = kitchen.some((d) => deviceStatus(d, now) === 'online');
        // A tablet is back (or the guard was switched off, or no tablet is enrolled any more): give back what it paused.
        if (st && (anyOnline || !cfg.enabled || !kitchen.length)) {
          await resumeOwn(loc, st, out);
          delete state[loc]; changed = true;
          continue;
        }
        if (!cfg.enabled || !kitchen.length || anyOnline) continue;
        // Brands open right now (unknown hours never count as open: the guard acts only when someone should be cooking).
        const brands = [...new Set((await storesFor({ locationCode: loc })).map((s) => s.brandName))];
        const opened = brands.flatMap((b) => { const since = openSince(hours, b, loc, now); return since === null ? [] : [{ brand: b, since }]; });
        if (!opened.length) {
          // Closed now: the guard's timed pauses end on their own (timed-pause re-open); forget them once they are over.
          if (st && now >= st.untilMs) { delete state[loc]; changed = true; }
          continue;
        }
        // "Off for N minutes during the opening hours": the grace time counts from the later of the last heartbeat and
        // the brand's opening, so a tablet switched off overnight is not "off for 13 h" on the first minute of service.
        const silentSince = offSince(kitchen);
        const ready = new Set(opened.filter((o) => now - Math.max(silentSince, o.since) >= cfg.graceMin * 60_000).map((o) => o.brand));
        if (!ready.size) continue;
        const untilMs = now + cfg.pauseMin * 60_000;
        if (st) {
          if (now - Date.parse(st.extendedAt) < cfg.pauseMin * 30_000) continue;
          // Re-extend only the stores still paused by the guard, of brands still open; one a person resumed or re-paused
          // is left alone (and never re-paused). When the last attempt did not go through everywhere (blocked or failed),
          // try the kitchen's other online stores again.
          const own = await ownStores(loc, st);
          const extendIds = own.filter((s) => ready.has(s.brandName)).map((s) => s.id);
          const retry = (st.blocked ?? 0) + (st.failed ?? 0) > 0;
          const fresh = retry ? (await candidates(loc, cfg.channels, ready)).filter((id) => !st.storeIds.includes(id)) : [];
          const ids = [...extendIds, ...fresh];
          let ok: string[] = [];
          let blocked = 0;
          let failed = 0;
          if (ids.length) {
            const rows = await setStoresOnline(ids, false, { untilMs, reason: GUARD_REASON, actor: GUARD_ACTOR });
            ok = rows.filter((r) => r.result.ok).map((r) => r.storeId);
            blocked = rows.summary.blockedCount;
            failed = rows.summary.errorCount;
            out.blocked += blocked;
            out.extended.push(...ok.filter((id) => extendIds.includes(id)));
            out.paused.push(...ok.filter((id) => fresh.includes(id)));
            if (fresh.length) await logNotPaused(loc, rows);
          }
          const storeIds = [...new Set([...own.map((s) => s.id), ...ok])];
          state[loc] = { ...st, storeIds, extendedAt: new Date(now).toISOString(), untilMs: ok.length ? Math.max(untilMs, st.untilMs) : st.untilMs, blocked, failed };
          changed = true;
          continue;
        }
        const ids = await candidates(loc, cfg.channels, ready);
        if (!ids.length) continue;
        const rows = await setStoresOnline(ids, false, { untilMs, reason: GUARD_REASON, actor: GUARD_ACTOR });
        const ok = rows.filter((r) => r.result.ok).map((r) => r.storeId);
        out.paused.push(...ok);
        out.blocked += rows.summary.blockedCount;
        await logNotPaused(loc, rows);
        // Remembered even when nothing went through (blocked or failed): the next attempt waits pauseMin/2, not every tick.
        state[loc] = { storeIds: ok, pausedAt: new Date(now).toISOString(), extendedAt: new Date(now).toISOString(), untilMs, blocked: rows.summary.blockedCount, failed: rows.summary.errorCount };
        changed = true;
      } catch (e) {
        console.error(`[foodhub] tablet-off guard ${loc} failed`, e instanceof Error ? e.message : e);
      }
    }
    if (changed) await getRepo().setKv(GUARD_STATE_KEY, state);
  } catch (e) {
    console.error('[foodhub] tablet-off guard tick failed', e instanceof Error ? e.message : e);
  }
  return out;
}

/** Online stores of the chosen channels and of open brands at the kitchen — never relay, "do not touch" or forbidden stores. */
async function candidates(loc: string, channels: ChannelKey[], brands: Set<string>): Promise<string[]> {
  return (await storesFor({ locationCode: loc, channels })).filter((s) => brands.has(s.brandName) && !isLockedStore(s) && isStoreOnline(s)).map((s) => s.id);
}
