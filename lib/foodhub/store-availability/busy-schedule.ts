// "Calendrier occupé": busy mode by the clock, per kitchen (e.g. Friday and Saturday 17:00–20:00, +10 min).
// It acts only at the edges of a window: at the start it turns busy mode on (normal prep + extra minutes, also sent to
// Uber Eats through the existing, live-gated pushPrepTimeToUber); at the end it goes back to normal and restores the
// busy minutes it replaced — only when the last prep change is still its own. A person's change during the window wins.
import crypto from 'node:crypto';
import { z } from 'zod';
import { logActivity, SCHEDULE_ACTOR, type Actor } from '../activity';
import { pushPrepTimeToUber } from '../adapters/uber-api';
import { DAYS, dayKeyOf, localDate } from '../hours';
import { getPrepSettings, prepFor, savePrep } from '../prep';
import { getRepo } from '../repo';
import { foodhubTimeZone, localParts } from '../time';
import type { DayKey } from '../types';
import { BUSY_SCHEDULE_ACTION } from './common';

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

/** What the schedule did at a kitchen: kept so the end of the window knows what to restore. */
export interface BusyState { windowId: string; occurrence: string; prevBusy: number; appliedAt: string; applied: boolean }

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const WEEK = 7 * 1440;
const lengthOf = (w: Pick<BusyWindow, 'start' | 'end'>) => { const a = toMin(w.start); const b = toMin(w.end); return b > a ? b - a : 1440 - a + b; };

/** Validates one kitchen's windows: shape, 5–60 extra minutes, start ≠ end, no two windows overlapping (across midnight too). */
export function validateBusyWindows(input: unknown): { windows: BusyWindow[]; errors: string[] } {
  const parsed = z.array(busyWindowSchema).max(30).safeParse(input);
  if (!parsed.success) return { windows: [], errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'windows'}: ${i.message}`) };
  const windows: BusyWindow[] = parsed.data.map((w) => ({ id: w.id ?? crypto.randomUUID(), days: [...new Set(w.days)].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)), start: w.start, end: w.end, extraMin: w.extraMin }));
  const errors: string[] = [];
  if (new Set(windows.map((x) => x.id)).size !== windows.length) errors.push('duplicate window id');
  const owner = new Int16Array(WEEK);
  windows.forEach((w, i) => {
    if (w.start === w.end) { errors.push(`${w.start}–${w.end}: empty window`); return; }
    for (const d of w.days) {
      const s = DAYS.indexOf(d) * 1440 + toMin(w.start);
      for (let k = 0; k < lengthOf(w); k++) {
        const at = (s + k) % WEEK;
        if (owner[at] && owner[at] !== i + 1) {
          const other = windows[owner[at] - 1];
          errors.push(`${d} ${w.start}–${w.end} overlaps ${other.start}–${other.end}`);
          break;
        }
        owner[at] = i + 1;
      }
    }
  });
  return { windows, errors: [...new Set(errors)] };
}

export async function getBusySchedule(): Promise<BusySchedule> {
  return (await getRepo().getKv<BusySchedule>(BUSY_SCHEDULE_KEY).catch(() => null)) ?? {};
}

export async function getBusyState(): Promise<Record<string, BusyState>> {
  return (await getRepo().getKv<Record<string, BusyState>>(BUSY_STATE_KEY).catch(() => null)) ?? {};
}

/** Saves one kitchen's windows (all of them, replacing the old list). Throws with readable errors when invalid. */
export async function saveBusySchedule(locationCode: string, input: unknown, actor: Actor): Promise<BusyWindow[]> {
  const { windows, errors } = validateBusyWindows(input);
  if (errors.length) throw new Error(errors.join('; '));
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

async function endWindow(loc: string, st: BusyState, out: BusyTick): Promise<void> {
  if (!st.applied) return;
  const current = (await getPrepSettings())[loc];
  // Only when the last prep change is still the schedule's own: a person who changed it during the window wins.
  if (!current || current.changedBy !== SCHEDULE_ACTOR.name || !current.isBusy) { out.kept.push(loc); return; }
  const prep = await savePrep(loc, { isBusy: false, busy: st.prevBusy }, SCHEDULE_ACTOR);
  await pushPrepTimeToUber(loc, prep.normal, SCHEDULE_ACTOR).catch(() => []);
  out.ended.push(loc);
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
        if (st && active?.occurrence === st.occurrence) continue; // this start was already handled
        if (st) { await endWindow(loc, st, out); delete state[loc]; changed = true; }
        if (!active) continue;
        const prep = await prepFor(loc);
        if (prep.isBusy) {
          // Someone already turned busy mode on: the schedule leaves it (and will not turn it off at the end).
          state[loc] = { windowId: active.window.id, occurrence: active.occurrence, prevBusy: prep.busy, appliedAt: new Date(now).toISOString(), applied: false };
        } else {
          const saved = await savePrep(loc, { isBusy: true, busy: prep.normal + active.window.extraMin }, SCHEDULE_ACTOR);
          await pushPrepTimeToUber(loc, saved.busy, SCHEDULE_ACTOR).catch(() => []);
          state[loc] = { windowId: active.window.id, occurrence: active.occurrence, prevBusy: prep.busy, appliedAt: new Date(now).toISOString(), applied: true };
          out.started.push(loc);
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
