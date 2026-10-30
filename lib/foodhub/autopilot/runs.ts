// What each automation did last, for Settings → Autopilot. One small key: a note per automation, written only when it
// did something (the activity log keeps the full story). Never throws: a note must never break the automation itself.
import { nowIso } from '../config';
import { getRepo } from '../repo';

export const AUTOPILOT_RUNS_KEY = 'autopilot_runs_v1';

export interface RunNote { at: string; status: 'success' | 'failed' | 'info'; fr: string; en: string }
export type RunNotes = Record<string, RunNote>;

export async function getRuns(): Promise<RunNotes> {
  return (await getRepo().getKv<RunNotes>(AUTOPILOT_RUNS_KEY).catch(() => null)) ?? {};
}

/** Saves several notes in one write (nothing is written for an empty set). */
export async function noteRuns(notes: Record<string, Omit<RunNote, 'at'> & { at?: string }>): Promise<void> {
  const ids = Object.keys(notes);
  if (!ids.length) return;
  try {
    const cur = await getRuns();
    for (const id of ids) cur[id] = { ...notes[id], at: notes[id].at ?? nowIso() };
    await getRepo().setKv(AUTOPILOT_RUNS_KEY, cur);
  } catch (e) {
    console.error('[foodhub] autopilot run note failed', e instanceof Error ? e.message : e);
  }
}

export async function noteRun(id: string, note: Omit<RunNote, 'at'> & { at?: string }): Promise<void> {
  await noteRuns({ [id]: note });
}

/** What the sync engine's housekeeping did on one run (lib/foodhub/sync.ts). */
export interface SyncResults {
  reopened: number;
  itemsReenabled: number;
  scheduledPublishes: number;
  autoCompleted: number;
  holidayClosures: number;
  recon: { opened: number; closed: number } | null;
  cloverInventory: { turnedOff: number; turnedOn: number; priceChanges: number };
}

/**
 * Notes for the automations that existed before Autopilot and run from the sync engine: one note per automation that
 * did something on this run. Their behaviour is untouched; this only remembers the result for the page.
 */
export function syncNotes(r: SyncResults): Record<string, Omit<RunNote, 'at'>> {
  const out: Record<string, Omit<RunNote, 'at'>> = {};
  const done = (fr: string, en: string): Omit<RunNote, 'at'> => ({ status: 'success', fr, en });
  if (r.reopened > 0) out.timed_reopen = done(`Magasin(s) rouvert(s) à la fin d’une pause minutée : ${r.reopened}`, `Store(s) re-opened at the end of a timed pause: ${r.reopened}`);
  if (r.itemsReenabled > 0) out.timed_86 = done(`Article(s) remis en vente à la fin d’un 86 minuté : ${r.itemsReenabled}`, `Item(s) back on sale at the end of a timed 86: ${r.itemsReenabled}`);
  if (r.scheduledPublishes > 0) out.scheduled_publish = done(`Publication(s) programmée(s) lancée(s) : ${r.scheduledPublishes}`, `Scheduled publish(es) run: ${r.scheduledPublishes}`);
  if (r.autoCompleted > 0) out.auto_close = done(`Vieille(s) commande(s) fermée(s) : ${r.autoCompleted}`, `Stale order(s) closed: ${r.autoCompleted}`);
  if (r.holidayClosures > 0) out.holiday_closures = done(`Magasin(s) Skip fermé(s) pour un jour férié : ${r.holidayClosures}`, `Skip store(s) closed for a holiday: ${r.holidayClosures}`);
  if (r.recon) out.daily_recon = { status: 'success', fr: `Cas d’argent : ${r.recon.opened} ouvert(s), ${r.recon.closed} fermé(s)`, en: `Money cases: ${r.recon.opened} opened, ${r.recon.closed} closed` };
  const inv = r.cloverInventory;
  if (inv.turnedOff + inv.turnedOn + inv.priceChanges > 0) {
    out.clover_inventory = { status: 'success', fr: `Clover : ${inv.turnedOff} en 86, ${inv.turnedOn} de retour, ${inv.priceChanges} prix signalé(s)`, en: `Clover: ${inv.turnedOff} 86'd, ${inv.turnedOn} back, ${inv.priceChanges} price(s) flagged` };
  }
  return out;
}
