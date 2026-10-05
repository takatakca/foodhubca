'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ymd } from './api';
import type { T } from '@/lib/i18n';

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_month' | 'custom';
export function rangeLabel(t: T, p: RangePreset) {
  return { today: t('Aujourd’hui', 'Today'), yesterday: t('Hier', 'Yesterday'), '7d': t('7 derniers jours', 'Last 7 days'), '30d': t('30 derniers jours', 'Last 30 days'), month: t('Ce mois-ci', 'This month'), last_month: t('Mois dernier', 'Last month'), custom: t('Personnalisé', 'Custom') }[p];
}

export function presetRange(p: RangePreset, custom?: { from: string; to: string }): { from: string; to: string } {
  const now = new Date();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return ymd(d); };
  switch (p) {
    case 'today': return { from: day(0), to: day(0) };
    case 'yesterday': return { from: day(-1), to: day(-1) };
    case '7d': return { from: day(-6), to: day(0) };
    case '30d': return { from: day(-29), to: day(0) };
    case 'month': return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(0) };
    case 'last_month': return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
    default: return custom ?? { from: day(0), to: day(0) };
  }
}

export type Filters = { preset: RangePreset; from: string; to: string; locations: string[]; channels: string[]; brands: string[] };

/** Period + location / platform / brand filters, kept in the URL so a view can be shared as a link. */
export function useFilters(defaultPreset: RangePreset = '7d', scope: string[] = []) {
  const [f, setF] = useState<Filters>(() => ({ preset: defaultPreset, ...presetRange(defaultPreset), locations: [], channels: [], brands: [] }));
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const preset = (q.get('range') as RangePreset) || defaultPreset;
    const custom = q.get('from') && q.get('to') ? { from: q.get('from')!, to: q.get('to')! } : undefined;
    const split = (k: string) => (q.get(k) || '').split(',').filter(Boolean);
    setF({ preset, ...presetRange(preset, custom), locations: split('locations'), channels: split('channels'), brands: split('brands') });
  }, [defaultPreset]);
  const set = useCallback((patch: Partial<Filters>) => {
    setF((cur) => {
      const next = { ...cur, ...patch };
      if (patch.preset && patch.preset !== 'custom') Object.assign(next, presetRange(patch.preset));
      const q = new URLSearchParams(window.location.search);
      q.set('range', next.preset);
      if (next.preset === 'custom') { q.set('from', next.from); q.set('to', next.to); } else { q.delete('from'); q.delete('to'); }
      for (const k of ['locations', 'channels', 'brands'] as const) { if (next[k].length) q.set(k, next[k].join(',')); else q.delete(k); }
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
      return next;
    });
  }, []);
  const locations = f.locations.length ? f.locations : scope;
  const query = useMemo(() => {
    const q = new URLSearchParams({ from: f.from, to: f.to });
    if (locations.length) q.set('locations', locations.join(','));
    if (f.channels.length) q.set('channels', f.channels.join(','));
    if (f.brands.length) q.set('brands', f.brands.join(','));
    return q.toString();
  }, [f, locations]);
  return { filters: f, set, query };
}
