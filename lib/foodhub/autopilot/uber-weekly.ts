// Autopilot · "Weekly Uber payment report" (OFF by default). From Monday 06:00 (the hub's time zone, America/Toronto by
// default), Autopilot asks Uber for the previous week's Payment Details report (Monday to Sunday) with the same call as
// Money → Statements (recon/automation.ts requestUberPaymentReport). Uber builds it and calls the report webhook, which
// imports it and refreshes the money cases. A report request reads data: it never pays, disputes or settles anything.
// One request per week; a refused request is tried again at most twice, 6 hours apart (never every minute).
import { AUTOPILOT_ACTOR } from '../activity';
import { localDate } from '../hours';
import { getRepo } from '../repo';
import { requestUberPaymentReport } from '../recon/automation';
import { foodhubTimeZone, localParts, localWallToUtcMs } from '../time';
import { noteRun } from './runs';

export const UBER_WEEKLY_KEY = 'autopilot_uber_weekly_v1';
const MAX_TRIES = 3;
const RETRY_GAP_MS = 6 * 3600_000;

export interface UberWeeklyState { week: string; tries: number; lastAt: string; status: 'requested' | 'failed'; message: string; from: string; to: string; requestId?: string }

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

/** This week's Monday (local date), when the request is due (Monday 06:00 local) and the week to ask for. */
export function uberWeekWindow(now: number, tz = foodhubTimeZone()): { monday: string; dueAt: number; from: string; to: string } {
  const p = localParts(now, tz);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  const monday = addDays(localDate(now, tz), -((dow + 6) % 7));
  const [y, m, d] = monday.split('-').map(Number);
  return { monday, dueAt: localWallToUtcMs(y, m, d, 6, 0, tz), from: addDays(monday, -7), to: addDays(monday, -1) };
}

export async function getUberWeekly(): Promise<UberWeeklyState | null> {
  return getRepo().getKv<UberWeeklyState>(UBER_WEEKLY_KEY).catch(() => null);
}

/** One heartbeat (called by runAutopilot while the switch is on). Null when nothing was due. Never throws. */
export async function tickUberWeekly(now: number): Promise<UberWeeklyState | null> {
  try {
    const w = uberWeekWindow(now);
    if (now < w.dueAt) return null;
    const st = await getUberWeekly();
    if (st?.week === w.monday && (st.status === 'requested' || st.tries >= MAX_TRIES || now - Date.parse(st.lastAt) < RETRY_GAP_MS)) return null;
    const tries = st?.week === w.monday ? st.tries + 1 : 1;
    const doc = await requestUberPaymentReport(w.from, w.to, AUTOPILOT_ACTOR);
    const next: UberWeeklyState = { week: w.monday, tries, lastAt: new Date(now).toISOString(), status: doc.status === 'requested' ? 'requested' : 'failed', message: doc.message, from: w.from, to: w.to, requestId: doc.id };
    await getRepo().setKv(UBER_WEEKLY_KEY, next);
    await noteRun('uber_weekly_report', next.status === 'requested'
      ? { status: 'success', fr: `Rapport de paiement Uber demandé pour ${w.from} → ${w.to}`, en: `Uber payment report requested for ${w.from} → ${w.to}` }
      : { status: 'failed', fr: `Rapport Uber ${w.from} → ${w.to} non demandé (essai ${tries}/${MAX_TRIES}) : ${doc.message}`, en: `Uber report ${w.from} → ${w.to} not requested (try ${tries}/${MAX_TRIES}): ${doc.message}` });
    return next;
  } catch (e) {
    console.error('[foodhub] autopilot weekly Uber report failed', e instanceof Error ? e.message : e);
    return null;
  }
}
