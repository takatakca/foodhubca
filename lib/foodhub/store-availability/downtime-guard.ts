// "Garde tablette éteinte" (OFF by default, per kitchen). When every kitchen tablet of an open kitchen has been off for
// graceMin minutes, the platforms keep sending orders nobody sees: the guard pauses the kitchen's stores on the chosen
// channels for a limited time (pauseMin, re-extended every pauseMin/2 while the tablets stay off, so a crash never leaves
// a store paused for long — the existing timed-pause re-open takes over). When a tablet is back, it resumes only the
// stores it paused itself and that still carry its reason: a person's pause in the meantime wins.
// Never: relay stores, "do not touch" stores, the DoorDash stores the owner forbids (FORBIDDEN_STORE_IDS).
import { z } from 'zod';
import { logActivity, type Actor } from '../activity';
import { brandHoursState, getHours } from '../hours';
import { deviceStatus, listDevices, type Device } from '../identity/devices';
import { setStoresOnline, storesFor } from '../ops';
import { getRepo } from '../repo';
import type { ChannelKey } from '../types';
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

/** What the guard paused at a kitchen (store ids that accepted the pause) and when it last (re)paused them. */
export interface GuardState { storeIds: string[]; pausedAt: string; extendedAt: string; untilMs: number; blocked?: number }

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

export interface GuardTick { paused: string[]; extended: string[]; resumed: string[]; blocked: number }

async function resumeOwn(loc: string, st: GuardState, out: GuardTick): Promise<void> {
  const stores = await storesFor({ storeIds: st.storeIds, locationCode: loc });
  // Still paused, still with the guard's reason: anything else means a person (or the platform) took over.
  const ids = stores.filter((s) => !isLockedStore(s) && !isStoreOnline(s) && platformStatusOf(s)?.detail === GUARD_REASON).map((s) => s.id);
  if (!ids.length) return;
  const rows = await setStoresOnline(ids, true, { actor: GUARD_ACTOR });
  out.resumed.push(...rows.filter((r) => r.result.ok).map((r) => r.storeId));
  out.blocked += rows.summary.blockedCount;
}

async function kitchenOpenNow(loc: string, now: number): Promise<boolean> {
  const hours = await getHours();
  const brands = [...new Set((await storesFor({ locationCode: loc })).map((s) => s.brandName))];
  // Unknown hours never count as open: the guard only acts when the hours say someone should be cooking.
  return brands.some((b) => brandHoursState(hours, b, loc, now) === 'open');
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
        if (now - offSince(kitchen) < cfg.graceMin * 60_000) continue;
        if (!(await kitchenOpenNow(loc, now))) {
          // Closed now: the guard's timed pauses end on their own (timed-pause re-open); forget them once they are over.
          if (st && now >= st.untilMs) { delete state[loc]; changed = true; }
          continue;
        }
        const untilMs = now + cfg.pauseMin * 60_000;
        if (st) {
          if (now - Date.parse(st.extendedAt) < cfg.pauseMin * 30_000) continue;
          // Nothing went through last time (blocked): try the kitchen's online stores again. Otherwise re-extend only
          // the stores still paused by the guard; one a person resumed or re-paused is left alone (and never re-paused).
          const retry = !st.storeIds.length && (st.blocked ?? 0) > 0;
          const ids = retry ? await candidates(loc, cfg.channels)
            : (await storesFor({ storeIds: st.storeIds, locationCode: loc })).filter((s) => !isLockedStore(s) && !isStoreOnline(s) && platformStatusOf(s)?.detail === GUARD_REASON).map((s) => s.id);
          let ok: string[] = [];
          let blocked = 0;
          if (ids.length) {
            const rows = await setStoresOnline(ids, false, { untilMs, reason: GUARD_REASON, actor: GUARD_ACTOR });
            ok = rows.filter((r) => r.result.ok).map((r) => r.storeId);
            blocked = rows.summary.blockedCount;
            out.blocked += blocked;
            (retry ? out.paused : out.extended).push(...ok);
          }
          state[loc] = { ...st, storeIds: retry ? ok : ids, extendedAt: new Date(now).toISOString(), untilMs: ok.length ? untilMs : st.untilMs, blocked: retry ? blocked : 0 };
          changed = true;
          continue;
        }
        const ids = await candidates(loc, cfg.channels);
        if (!ids.length) continue;
        const rows = await setStoresOnline(ids, false, { untilMs, reason: GUARD_REASON, actor: GUARD_ACTOR });
        const ok = rows.filter((r) => r.result.ok).map((r) => r.storeId);
        out.paused.push(...ok);
        out.blocked += rows.summary.blockedCount;
        if (rows.summary.blockedCount) {
          await logActivity({ actor: GUARD_ACTOR.name, source: GUARD_ACTOR.source, kind: 'device', action: 'guard_blocked', status: 'failed', locationCode: loc,
            summary: `Tablet-off guard ${loc}: ${rows.summary.blockedCount} store(s) NOT paused — not sent (live connector off or not allowed)`, detail: { notSent: true, summary: rows.summary } });
        }
        // Remembered even when nothing went through (blocked): the next attempt waits pauseMin/2 instead of every tick.
        state[loc] = { storeIds: ok, pausedAt: new Date(now).toISOString(), extendedAt: new Date(now).toISOString(), untilMs, blocked: rows.summary.blockedCount };
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

/** Online stores of the chosen channels at the kitchen — never relay, "do not touch" or forbidden stores. */
async function candidates(loc: string, channels: ChannelKey[]): Promise<string[]> {
  return (await storesFor({ locationCode: loc, channels })).filter((s) => !isLockedStore(s) && isStoreOnline(s)).map((s) => s.id);
}
