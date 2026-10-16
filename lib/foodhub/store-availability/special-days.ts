// "Jours spéciaux" in one tap, on top of the Québec statutory holidays already on /stores/hours: Halloween, Remembrance
// Day, Christmas Eve, Boxing Day, New Year's Eve, Valentine's Day, Mother's Day, Father's Day. They are saved as holidays
// (closed, or special hours) through getHours/saveHours; the platforms get them with the next menu publish
// (/stores/hours → "Publier sur les plateformes"). Nothing is published from here.
import { logActivity, type Actor } from '../activity';
import { getHours, holidaySlotErrors, saveHours, type Slot } from '../hours';
import type { Holiday, HoursConfig } from '../types';
import type { Bilingual } from './next-open';

export type SpecialDayId = 'valentines' | 'mothers_day' | 'fathers_day' | 'halloween' | 'remembrance' | 'christmas_eve' | 'boxing_day' | 'new_years_eve';
export interface SpecialDayPreset { id: SpecialDayId; date: string; nameFr: string; nameEn: string; suggestion: Bilingual }

const pad = (n: number) => String(n).padStart(2, '0');

/** Day of the month of the n-th Sunday of a month (UTC calendar: dates only, no time zone involved). */
export function nthSunday(year: number, month: number, n: number): number {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  return 1 + ((7 - dow) % 7) + 7 * (n - 1);
}

export function specialDayPresets(year: number): SpecialDayPreset[] {
  const d = (m: number, day: number) => `${year}-${pad(m)}-${pad(day)}`;
  const list: SpecialDayPreset[] = [
    { id: 'valentines', date: d(2, 14), nameFr: 'Saint-Valentin', nameEn: 'Valentine’s Day', suggestion: { fr: 'Soirée chargée : heures normales, pensez au mode occupé.', en: 'Busy evening: normal hours, think of busy mode.' } },
    { id: 'mothers_day', date: d(5, nthSunday(year, 5, 2)), nameFr: 'Fête des Mères', nameEn: 'Mother’s Day', suggestion: { fr: 'Brunch et souper chargés : heures normales ou ouverture plus tôt.', en: 'Busy brunch and dinner: normal hours or open earlier.' } },
    { id: 'fathers_day', date: d(6, nthSunday(year, 6, 3)), nameFr: 'Fête des Pères', nameEn: 'Father’s Day', suggestion: { fr: 'Souper chargé : heures normales, pensez au mode occupé.', en: 'Busy dinner: normal hours, think of busy mode.' } },
    { id: 'halloween', date: d(10, 31), nameFr: 'Halloween', nameEn: 'Halloween', suggestion: { fr: 'Soirée très chargée : heures normales, pensez au mode occupé.', en: 'Very busy evening: normal hours, think of busy mode.' } },
    { id: 'remembrance', date: d(11, 11), nameFr: 'Jour du Souvenir', nameEn: 'Remembrance Day', suggestion: { fr: 'Pas un jour férié au Québec : heures normales en général.', en: 'Not a holiday in Québec: usually normal hours.' } },
    { id: 'christmas_eve', date: d(12, 24), nameFr: 'Veille de Noël', nameEn: 'Christmas Eve', suggestion: { fr: 'Fermeture plus tôt (par exemple 11 h à 18 h).', en: 'Close earlier (for example 11 am to 6 pm).' } },
    { id: 'boxing_day', date: d(12, 26), nameFr: 'Lendemain de Noël', nameEn: 'Boxing Day', suggestion: { fr: 'Ouverture plus tard ou fermé.', en: 'Open later, or closed.' } },
    { id: 'new_years_eve', date: d(12, 31), nameFr: 'Veille du jour de l’An', nameEn: 'New Year’s Eve', suggestion: { fr: 'Fermeture plus tôt (par exemple 11 h à 20 h).', en: 'Close earlier (for example 11 am to 8 pm).' } },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

export type SpecialDayHours = { closed: true } | { closed?: false; slots: Slot[] };

export interface AddSpecialDaysResult {
  added: Holiday[];
  skipped: Array<{ id: SpecialDayId; date: string; reason: string }>;
  hours: HoursConfig;
}

/** Same date, and the kitchens overlap (no kitchen listed = every kitchen). */
function clashes(h: Holiday, date: string, locationCodes: string[]): boolean {
  if (h.date !== date) return false;
  if (!h.locationCodes.length || !locationCodes.length) return true;
  return h.locationCodes.some((c) => locationCodes.includes(c));
}

/** Adds the chosen special days as holidays (no duplicate date for the same kitchens). Throws on invalid input. */
export async function addSpecialDays(ids: string[], year: number, how: SpecialDayHours, locationCodes: string[], actor: Actor): Promise<AddSpecialDaysResult> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('year must be between 2020 and 2100');
  const presets = specialDayPresets(year);
  const unknown = ids.filter((id) => !presets.some((p) => p.id === id));
  if (unknown.length) throw new Error(`Unknown special day: ${unknown.join(', ')}`);
  if (!ids.length) throw new Error('Choose at least one special day');
  const closed = how.closed === true;
  const slots = closed ? [] : (how as { slots?: Slot[] }).slots ?? [];
  if (!closed && !slots.length) throw new Error('Give the special hours, or choose closed');
  const errors = holidaySlotErrors({ closed, slots });
  if (errors.length) throw new Error(errors.join('; '));
  const codes = [...new Set(locationCodes.map(String).filter(Boolean))].sort();
  const cfg = await getHours();
  const holidays = [...cfg.holidays];
  const added: Holiday[] = [];
  const skipped: AddSpecialDaysResult['skipped'] = [];
  for (const p of presets.filter((x) => ids.includes(x.id))) {
    const existing = holidays.find((h) => clashes(h, p.date, codes));
    if (existing) { skipped.push({ id: p.id, date: p.date, reason: `already set: ${existing.name}` }); continue; }
    const base = `special_${p.id}_${year}${codes.length ? `_${codes.join('-')}` : ''}`;
    let id = base;
    for (let n = 2; holidays.some((h) => h.id === id); n++) id = `${base}_v${n}`;
    const h: Holiday = { id, date: p.date, name: p.nameFr, locationCodes: codes, closed, ...(closed ? {} : { slots }) };
    holidays.push(h);
    added.push(h);
  }
  const hours = added.length ? await saveHours({ ...cfg, holidays }) : cfg;
  if (added.length) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'hours', action: 'special_days_added', status: 'success', locationCode: codes.length === 1 ? codes[0] : null,
      summary: `Special days added (${closed ? 'closed' : slots.map((s) => `${s.open}–${s.close}`).join(', ')}): ${added.map((h) => `${h.name} ${h.date}`).join(', ')}${codes.length ? ` — ${codes.join(', ')}` : ' — every kitchen'}. Publish the menus to send them to the platforms.`,
      detail: { ids: added.map((h) => h.id), locationCodes: codes } });
  }
  return { added, skipped, hours };
}
