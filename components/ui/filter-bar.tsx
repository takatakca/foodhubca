'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { PlatformMark } from './badge';
import { Input } from './form';
import { useI18n } from '@/lib/i18n/client';
import { rangeLabel, type Filters, type RangePreset } from '@/lib/ui/range';
import { cn } from '@/lib/ui/cn';

export const CHANNEL_OPTIONS = [['uber_eats', 'Uber Eats'], ['doordash', 'DoorDash'], ['skip', 'SkipTheDishes'], ['tgtg', 'Too Good To Go']] as const;

export function MultiPick({ label, options, value, onChange, renderOption }: { label: string; options: Array<[string, string]>; value: string[]; onChange: (v: string[]) => void; renderOption?: (k: string, l: string) => ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  const summary = value.length === 0 ? t('Toutes', 'All') : value.length === 1 ? options.find(([k]) => k === value[0])?.[1] ?? value[0] : `${value.length}`;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className={cn('flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold', value.length ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4')}>
        {label}: <span className="max-w-32 truncate">{summary}</span><ChevronDown className="size-3.5 opacity-70" />
      </button>
      {open && (
        <div className="absolute top-11 left-0 z-40 max-h-80 w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-rise">
          <button type="button" onClick={() => onChange([])} className="w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold text-ink-3 hover:bg-sunken">{t('Tout effacer', 'Clear')}</button>
          {options.map(([k, l]) => {
            const on = value.includes(k);
            return (
              <button key={k} type="button" onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sunken">
                <span className={cn('flex size-4 items-center justify-center rounded-[4px] border', on ? 'border-ink bg-ink text-canvas' : 'border-line-2')}>{on && <Check className="size-3" />}</span>
                {renderOption ? renderOption(k, l) : l}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ filters, set, locations, brands, presets, extra, showBrands = true, showLocations = true }: {
  filters: Filters; set: (p: Partial<Filters>) => void; locations: Array<{ code: string; name: string }>; brands?: string[];
  presets?: RangePreset[]; extra?: ReactNode; showBrands?: boolean; showLocations?: boolean;
}) {
  const { t } = useI18n();
  const list = presets ?? ['today', 'yesterday', '7d', '30d', 'month', 'last_month', 'custom'];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
        <select value={filters.preset} onChange={(e) => set({ preset: e.target.value as RangePreset })} className="h-9 appearance-none rounded-md border border-line-2 bg-surface pr-8 pl-8 text-[13px] font-semibold text-ink hover:border-ink-4" aria-label={t('Période', 'Period')}>
          {list.map((k) => <option key={k} value={k}>{rangeLabel(t, k)}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
      </div>
      {filters.preset === 'custom' && (
        <span className="flex items-center gap-1.5">
          <Input inputSize="sm" type="date" className="w-auto" value={filters.from} onChange={(e) => set({ from: e.target.value, preset: 'custom' })} aria-label={t('Du', 'From')} />
          <span className="text-xs text-ink-3">→</span>
          <Input inputSize="sm" type="date" className="w-auto" value={filters.to} onChange={(e) => set({ to: e.target.value, preset: 'custom' })} aria-label={t('Au', 'To')} />
        </span>
      )}
      {showLocations && locations.length > 1 && <MultiPick label={t('Succursales', 'Locations')} options={locations.map((l) => [l.code, l.name.split(' — ')[0]])} value={filters.locations} onChange={(v) => set({ locations: v })} />}
      <MultiPick label={t('Plateformes', 'Platforms')} options={CHANNEL_OPTIONS.map(([k, l]) => [k, l])} value={filters.channels} onChange={(v) => set({ channels: v })} renderOption={(k, l) => <span className="flex items-center gap-2"><PlatformMark channel={k} size="xs" />{l}</span>} />
      {showBrands && brands && brands.length > 0 && <MultiPick label={t('Marques', 'Brands')} options={brands.map((b) => [b, b])} value={filters.brands} onChange={(v) => set({ brands: v })} />}
      {extra}
    </div>
  );
}
