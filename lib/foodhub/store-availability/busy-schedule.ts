// "Calendrier occupé": busy mode by the clock, per kitchen (e.g. Friday and Saturday 17:00–20:00, +10 min).
// It acts only at the edges of a window: at the start it turns busy mode on (normal prep + extra minutes, also sent to
// Uber Eats through the existing, live-gated pushPrepTimeToUber); at the end it goes back to normal and restores the
// busy minutes it replaced — only when the last prep change is still its own. A person's change during the window wins.
// On purpose: a window saved while it runs, or missed by a restart, is caught up on the next tick (once per window);
// removing a running window counts as its end (same "still its own" rule).
import crypto from 'node:crypto';
import { z } from 'zod';
import { logActivity, type Actor } from '../activity';
import { pushPrepTimeToUber } from '../adapters/uber-api';
import { DAYS, dayKeyOf, localDate } from '../hours';
import { getPrepSettings, prepFor, savePrep } from '../prep';
import { getRepo } from '../repo';
import { foodhubTimeZone, localParts } from '../time';
import type { DayKey } from '../types';
import { BilingualError, BUSY_ACTOR, BUSY_KEPT_ACTION, BUSY_SCHEDULE_ACTION } from './common';

export const BUSY_SCHEDULE_KEY = 'busy_schedule_v1';
export const BUSY_STATE_KEY = 'busy_schedule_state_v1';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const busyWindowSchema = z.object({
  id: z.string().trim().min(1).max(60).optional(),
  days: z.array(z.enum(DAYS as [DayKey, ...DayKey[]])).min(1).max(7),
  start: z.string().regex(HHMM, 'HH:MM'),
  end: z.string().regex(HHMM, 'HH:MM'),
  extraMin: z.number().int().min(5).max(60),
});
export type BusyWindow = { id: string; days: DayKey[]; start: string; end: string; extraMin: number };
export type BusySchedule = Record<string, BusyWindow[]>;

/**
 * What the schedule did at a kitchen: kept so the end of the window knows what to restore. kept = the window is over
 * but busy mode stayed on because a person changed it during the window (shown to staff until busy mode is off).
 */
export interface BusyState { windowId: string; occurrence: string; prevBusy: number; appliedAt: string; applied: boolean; kept?: boolean; keptAt?: string }

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const WEEK = 7 * 1440;
const lengthOf = (w: Pick<BusyWindow, 'start' | 'end'>) => { const a = toMin(w.start); const b = toMin(w.end); return b > a ? b - a : 1440 - a + b; };

const DAY_FR: Record<DayKey, string> = { monday: 'lundi', tuesday: 'mardi', wednesday: 'mercredi', thursday: 'jeudi', friday: 'vendredi', saturday: 'samedi', sunday: 'dimanche' };

/** Validates one kitchen's windows: shape, 5–60 extra minutes, start ≠ end, no two windows overlapping (across midnight too).
 *  errorsFr: the same errors in French, in the same order. */
export function validateBusyWindows(input: unknown): { windows: BusyWindow[]; errors: string[]; errorsFr: string[] } {
  const parsed = z.array(busyWindowSchema).max(30).safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5);
    return {
      windows: [],
      errors: issues.map((i) => `${i.path.join('.') || 'windows'}: ${i.message}`),
      errorsFr: issues.map((i) => `${typeof i.path[0] === 'number' ? `Plage ${i.path[0] + 1}` : 'Plages'} : vérifiez les jours (au moins un), les heures (HH:MM) et les minutes en plus (5 à 60)`),
    };
  }
  const windows: BusyWindow[] = parsed.data.map((w) => ({ id: w.id ?? crypto.randomUUID(), days: [...new Set(w.days)].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)), start: w.start, end: w.end, extraMin: w.extraMin }));
  const errors: string[] = [];
  const errorsFr: string[] = [];
  const add = (en: string, fr: string) => { if (!errors.includes(en)) { errors.push(en); errorsFr.push(fr); } };
  if (new Set(windows.map((x) => x.id)).size !== windows.length) add('duplicate window id', 'identifiant de plage en double');
  const owner = new Int16Array(WEEK);
  windows.forEach((w, i) => {
    if (w.start === w.end) { add(`${w.start}–${w.end}: empty window`, `${w.start}–${w.end} : plage vide (début = fin)`); return; }
    for (const d of w.days) {
      const s = DAYS.indexOf(d) * 1440 + toMin(w.start);
      for (let k = 0; k < lengthOf(w); k++) {
        const at = (s + k) % WEEK;
        if (owner[at] && owner[at] !== i + 1) {
          const other = windows[owner[at] - 1];
          add(`${d} ${w.start}–${w.end} overlaps ${other.start}–${other.end}`, `${DAY_FR[d]} ${w.start}–${w.end} chevauche ${other.start}–${other.end}`);
          break;
        }
        owner[at] = i + 1;
      }
    }
  });
  return { windows, errors, errorsFr };
}

export async function getBusySchedule(): Promise<BusySchedule> {
  return (await getRepo().getKv<BusySchedule>(BUSY_SCHEDULE_KEY).catch(() => null)) ?? {};
}

export async function getBusyState(): Promise<Record<string, BusyState>> {
  return (await getRepo().getKv<Record<string, BusyState>>(BUSY_STATE_KEY).catch(() => null)) ?? {};
}

/** Saves one kitchen's windows (all of them, replacing the old list). Throws with readable errors when invalid. */
export async function saveBusySchedule(locationCode: string, input: unknown, actor: Actor): Promise<BusyWindow[]> {
  const { windows, errors, errorsFr } = validateBusyWindows(input);
  if (errors.length) throw new BilingualError(errors.join('; '), errorsFr.join(' ; '));
  const all = await getBusySchedule();
  const next = { ...all, [locationCode]: windows };
  if (!windows.length) delete next[locationCode];
  await getRepo().setKv(BUSY_SCHEDULE_KEY, next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'hours', action: BUSY_SCHEDULE_ACTION, status: 'success', locationCode,
    summary: `Busy schedule ${locationCode}: ${windows.length ? windows.map((w) => `${w.days.map((d) => d.slice(0, 3)).join('/')} ${w.start}–${w.end} +${w.extraMin} min`).join(', ') : 'none'}` });
  return windows;
}

/** The window in force at `now` (local wall clock), with the local date it started on (one occurrence = one start). */
export function activeBusyWindow(windows: BusyWindow[], now = Date.now(), tz = foodhubTimeZone()): { window: BusyWindow; occurrence: string } | null {
  const p = localParts(now, tz);
  const nowW = DAYS.indexOf(dayKeyOf(localDate(now, tz))) * 1440 + p.hour * 60 + p.minute;
  for (const w of windows) {
    for (const d of w.days) {
      const s = DAYS.indexOf(d) * 1440 + toMin(w.start);
      const since = (((nowW - s) % WEEK) + WEEK) % WEEK;
      if (since < lengthOf(w)) return { window: w, occurrence: `${w.id}@${localDate(now - since * 60_000, tz)}` };
    }
  }
  return null;
}

export interface BusyTick { started: string[]; ended: string[]; kept: string[] }

/** Ends a window. Returns true when busy mode stays on because a person changed it during the window. */
async function endWindow(loc: string, st: BusyState, out: BusyTick): Promise<boolean> {
  if (!st.applied) return false;
  const current = (await getPrepSettings())[loc];
  // Only when the last prep change is still the schedule's own: a person who changed it during the window wins.
  if (!current || current.changedBy !== BUSY_ACTOR.name || !current.isBusy) {
    out.kept.push(loc);
    if (!current?.isBusy) return false;
    await logActivity({ actor: BUSY_ACTOR.name, source: BUSY_ACTOR.source, kind: 'hours', action: BUSY_KEPT_ACTION, status: 'success', locationCode: loc,
      summary: `Busy schedule ${loc}: window over, busy mode LEFT ON — changed during the window by ${current.changedBy ?? 'someone'}; turn it off from Stores if needed` });
    return true;
  }
  const prep = await savePrep(loc, { isBusy: false, busy: st.prevBusy }, BUSY_ACTOR);
  await pushPrepTimeToUber(loc, prep.normal, BUSY_ACTOR).catch(() => []);
  out.ended.push(loc);
  return false;
}

/** Busy mode on at a window's start, back to normal at its end. Idempotent (a start is acted on once); never throws. */
export async function tickBusySchedule(now = Date.now()): Promise<BusyTick> {
  const out: BusyTick = { started: [], ended: [], kept: [] };
  try {
    const schedule = await getBusySchedule();
    const state = await getBusyState();
    let changed = false;
    for (const loc of new Set([...Object.keys(schedule), ...Object.keys(state)])) {
      try {
        const active = activeBusyWindow(schedule[loc] ?? [], now);
        const st = state[loc];
        if (st && !st.kept && active?.occurrence === st.occurrence) continue; // this start was already handled
        if (st?.kept) {
          // Busy mode left on after a window: shown until someone turns it off, or until the next window starts.
          if (!active || active.occurrence === st.occurrence) {
            if (!(await prepFor(loc)).isBusy) { delete state[loc]; changed = true; }
            continue;
          }
          delete state[loc]; changed = true;
        } else if (st) {
          const kept = await endWindow(loc, st, out);
          if (kept) state[loc] = { ...st, kept: true, keptAt: new Date(now).toISOString() }; else delete state[loc];
          changed = true;
        }
        if (!active) continue;
        const prep = await prepFor(loc);
        const base = { windowId: active.window.id, occurrence: active.occurrence, appliedAt: new Date(now).toISOString() };
        if (prep.isBusy && prep.changedBy === BUSY_ACTOR.name) {
          // Busy mode is the schedule's own (its state was lost, e.g. a stop between the two saves): still its window,
          // so the end turns it off. The busy minutes it replaced are unknown: normal time is the safe guess.
          state[loc] = { ...base, prevBusy: Math.max(prep.normal, prep.busy - active.window.extraMin), applied: true };
        } else if (prep.isBusy) {
          // Someone already turned busy mode on: the schedule leaves it (and will not turn it off at the end).
          state[loc] = { ...base, prevBusy: prep.busy, applied: false };
        } else {
          // State first, then the change: a stop in between never leaves busy mode on with nobody to turn it off.
          state[loc] = { ...base, prevBusy: prep.busy, applied: true };
          changed = true;
          await getRepo().setKv(BUSY_STATE_KEY, state);
          try {
            const saved = await savePrep(loc, { isBusy: true, busy: prep.normal + active.window.extraMin }, BUSY_ACTOR);
            await pushPrepTimeToUber(loc, saved.busy, BUSY_ACTOR).catch(() => []);
            out.started.push(loc);
          } catch (e) {
            state[loc] = { ...state[loc], applied: false };
            throw e;
          }
        }
        changed = true;
      } catch (e) {
        console.error(`[foodhub] busy schedule ${loc} failed`, e instanceof Error ? e.message : e);
      }
    }
    if (changed) await getRepo().setKv(BUSY_STATE_KEY, state);
  } catch (e) {
    console.error('[foodhub] busy schedule tick failed', e instanceof Error ? e.message : e);
  }
  return out;
}
