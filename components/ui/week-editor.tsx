'use client';

import { Copy, Plus, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export type Slot = { open: string; close: string };
export type Week = Record<string, Slot[]>;
export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const LABEL: Record<string, [string, string]> = { monday: ['Lundi', 'Monday'], tuesday: ['Mardi', 'Tuesday'], wednesday: ['Mercredi', 'Wednesday'], thursday: ['Jeudi', 'Thursday'], friday: ['Vendredi', 'Friday'], saturday: ['Samedi', 'Saturday'], sunday: ['Dimanche', 'Sunday'] };
export const fullWeek = (open = '11:00', close = '23:00'): Week => Object.fromEntries(WEEK_DAYS.map((d) => [d, [{ open, close }]]));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function weekProblems(week: Week): string[] {
  const out: string[] = [];
  for (const d of WEEK_DAYS) for (const s of week[d] ?? []) {
    if (!TIME.test(s.open) || !TIME.test(s.close)) out.push(`${LABEL[d][0]} : HH:MM`);
    else if (s.open === s.close) out.push(`${LABEL[d][0]} : ${s.open}–${s.close}`);
  }
  return out;
}
export function weekSummary(w: Week | undefined, lang: 'fr' | 'en') {
  if (!w) return lang === 'fr' ? 'non défini' : 'not set';
  const open = WEEK_DAYS.filter((d) => (w[d] ?? []).length).length;
  return open === 0 ? (lang === 'fr' ? 'fermé tous les jours' : 'closed every day') : `${open}/7 ${lang === 'fr' ? 'jours ouverts' : 'days open'}`;
}

/** One row per day, several open/close slots per day. A slot past midnight (18:00–02:00) is allowed. */
export function WeekEditor({ value, onChange, disabled }: { value: Week; onChange: (w: Week) => void; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const setDay = (day: string, slots: Slot[]) => onChange({ ...value, [day]: slots });
  const copyToAll = (day: string) => onChange(Object.fromEntries(WEEK_DAYS.map((d) => [d, (value[day] ?? []).map((s) => ({ ...s }))])));
  const time = 'h-9 rounded-md border border-line-2 bg-surface px-2 text-sm num disabled:bg-sunken';
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {WEEK_DAYS.map((day) => {
        const slots = value[day] ?? [];
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="w-24 text-sm font-semibold">{lang === 'fr' ? LABEL[day][0] : LABEL[day][1]}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {slots.length === 0 && <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold text-ink-3">{t('Fermé', 'Closed')}</span>}
              {slots.map((s, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <input type="time" className={time} value={s.open} disabled={disabled} aria-label={t('Ouvre', 'Opens')} onChange={(e) => setDay(day, slots.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} />
                  <span className="text-ink-3">–</span>
                  <input type="time" className={time} value={s.close} disabled={disabled} aria-label={t('Ferme', 'Closes')} onChange={(e) => setDay(day, slots.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} />
                  {s.close <= s.open && s.close !== s.open && <span className="text-[11px] text-ink-3">(+1 {t('j', 'd')})</span>}
                  {!disabled && <button type="button" className="rounded p-1 text-ink-4 hover:bg-sunken hover:text-ink" onClick={() => setDay(day, slots.filter((_, j) => j !== i))} aria-label={t('Retirer', 'Remove')}><X className="size-4" /></button>}
                </span>
              ))}
            </div>
            {!disabled && (
              <span className={cn('flex gap-1')}>
                <button type="button" className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-2 hover:bg-sunken" onClick={() => setDay(day, [...slots, slots.length ? { open: '17:00', close: '22:00' } : { open: '11:00', close: '23:00' }])}><Plus className="size-3.5" />{t('plage', 'slot')}</button>
                <button type="button" className="h-8 rounded-md px-2 text-xs font-semibold text-ink-2 hover:bg-sunken" onClick={() => setDay(day, [{ open: '00:00', close: '23:59' }])}>24 h</button>
                <button type="button" className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-2 hover:bg-sunken" onClick={() => copyToAll(day)} title={t('Copier sur tous les jours', 'Copy to every day')}><Copy className="size-3.5" />{t('tous', 'all')}</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
