// "Rouvre à …": when a kitchen or a brand opens next, or when it closes, from the hours saved in Food Hub.
// Built on openIntervals (hours.ts, imported only): overnight slots (16:00–03:00), closed holidays, holiday special
// hours and DST days are handled there; back-to-back slots (23:59 then 00:00) are joined here into one opening.
import { dayKeyOf, localDate, normalizeWeek, openIntervals } from '../hours';
import { foodhubTimeZone, localParts, startOfLocalDayMs } from '../time';
import type { DayKey, Holiday, WeeklyHours } from '../types';

export interface Bilingual { fr: string; en: string }

export interface NextOpening {
  /** False when no hours were ever set (nothing can be said about the opening). */
  known: boolean;
  openNow: boolean;
  /** Epoch ms of the closing time (the minute shown), when open now and closing within the next 6 days. */
  closesAt?: number;
  /** Epoch ms of the next opening, when closed now. */
  nextOpenAt?: number;
  label: Bilingual;
}

const DAY_FR: Record<DayKey, string> = { monday: 'lundi', tuesday: 'mardi', wednesday: 'mercredi', thursday: 'jeudi', friday: 'vendredi', saturday: 'samedi', sunday: 'dimanche' };
const DAY_EN: Record<DayKey, string> = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };

/** "16 h", "16 h 30", "9 h" — the Québec way. */
export function frTime(ms: number, tz = foodhubTimeZone()): string {
  const p = localParts(ms, tz);
  return p.minute ? `${p.hour} h ${String(p.minute).padStart(2, '0')}` : `${p.hour} h`;
}

/** "4 pm", "4:30 pm", "12 am". */
export function enTime(ms: number, tz = foodhubTimeZone()): string {
  const p = localParts(ms, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}${p.minute ? `:${String(p.minute).padStart(2, '0')}` : ''} ${p.hour < 12 ? 'am' : 'pm'}`;
}

/** Open intervals around `now`, with back-to-back slots joined (a night across midnight is one opening). */
function joined(week: WeeklyHours, holidays: Holiday[], fromMs: number, toMs: number, tz: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of openIntervals(week, holidays, fromMs, toMs, tz)) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 60_000) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

/**
 * Open now? When does it close, or when does it open next? `week` null = hours never set.
 * Labels: "Ferme à 3 h" / "Ouvre aujourd’hui à 16 h" / "Ouvre demain à 9 h" / "Ouvre mardi à 9 h".
 */
export function nextOpening(week: WeeklyHours | null | undefined, holidays: Holiday[], now = Date.now(), tz = foodhubTimeZone()): NextOpening {
  if (!week) return { known: false, openNow: false, label: { fr: 'Heures non définies', en: 'Hours not set' } };
  // Normalized first: an overnight slot (16:00–03:00) becomes 16:00–23:59 + next day 00:00–03:00, joined back below.
  const iv = joined(normalizeWeek(week), holidays, now - 36 * 3600_000, now + 8 * 86400_000, tz);
  const cur = iv.find(([a, b]) => a <= now && now < b);
  if (cur) {
    // openIntervals ends one minute after the closing time; an opening that runs past the window never closes this week.
    if (cur[1] - now > 6 * 86400_000) return { known: true, openNow: true, label: { fr: 'Ouvert', en: 'Open' } };
    const closesAt = cur[1] - 60_000;
    return { known: true, openNow: true, closesAt, label: { fr: `Ferme à ${frTime(closesAt, tz)}`, en: `Closes at ${enTime(closesAt, tz)}` } };
  }
  const next = iv.find(([a]) => a > now)?.[0];
  if (!next) return { known: true, openNow: false, label: { fr: 'Fermé (aucune ouverture dans les 7 jours)', en: 'Closed (no opening in the next 7 days)' } };
  const today = localDate(now, tz);
  const tomorrow = localDate(startOfLocalDayMs(now, tz) + 36 * 3600_000, tz);
  const date = localDate(next, tz);
  const day = dayKeyOf(date);
  const label = date === today
    ? { fr: `Ouvre aujourd’hui à ${frTime(next, tz)}`, en: `Opens today at ${enTime(next, tz)}` }
    : date === tomorrow
      ? { fr: `Ouvre demain à ${frTime(next, tz)}`, en: `Opens tomorrow at ${enTime(next, tz)}` }
      : { fr: `Ouvre ${DAY_FR[day]} à ${frTime(next, tz)}`, en: `Opens ${DAY_EN[day]} at ${enTime(next, tz)}` };
  return { known: true, openNow: false, nextOpenAt: next, label };
}
