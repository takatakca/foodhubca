'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Search } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/card';
import { Chips, Input, Select } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { MenuTabs } from '../menu-tabs';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { MasterMenu } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

type Result = { channel: string; result: { ok: boolean; status: string; message: string } };

function untilEndOfDay() { const e = new Date(); e.setHours(23, 59, 0, 0); return Math.max(5, Math.round((e.getTime() - Date.now()) / 60000)); }

/** 86 board: sold out at one location → off on Uber Eats, DoorDash and Skip there, back by itself if you want. */
export default function EightySix() {
  const { t, lang, loc } = useI18n();
  const { viewer, locations, brands: catalogBrands } = useViewer();
  const { scope } = usePulse();
  const toast = useToast();
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [location, setLocation] = useState(viewer.device?.locationCode ?? scope[0] ?? locations[0]?.code ?? '');
  const [menu, setMenu] = useState<MasterMenu | null>(null);
  const [tab, setTab] = useState<'items' | 'options' | 'off'>('items');
  const [q, setQ] = useState('');
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api<{ brands: string[]; summary: Array<{ brandName: string; items: number }> }>('/api/foodhub/menu').then((d) => { const withItems = d.summary.filter((s) => s.items > 0).map((s) => s.brandName); const list = withItems.length ? withItems : d.brands; setBrands(list); setBrand((b) => b || list[0] || ''); }).catch(() => setBrands(catalogBrands)); }, [catalogBrands]);
  const load = useCallback(async () => { if (!brand) return; const d = await api<{ menu: MasterMenu }>(`/api/foodhub/menu?brand=${encodeURIComponent(brand)}`).catch(() => null); if (d) setMenu(d.menu); }, [brand]);
  useEffect(() => { load(); }, [load]);

  const offAt = useCallback((ref: string) => (menu?.unavailableByLocation?.[location] ?? []).includes(ref), [menu, location]);
  const untilOf = (ref: string) => menu?.unavailableUntil?.[`${location}|${ref}`];
  const rows = useMemo(() => {
    if (!menu) return [];
    const cat = (r: string) => { const c = menu.categories.find((x) => x.ref === r); return lang === 'fr' && c?.nameFr ? c.nameFr : c?.name ?? ''; };
    const itemRows = menu.items.map((i) => ({ ref: i.ref, name: lang === 'fr' && i.nameFr ? i.nameFr : i.name, group: cat(i.categoryRef) }));
    const modRows = menu.modifierGroups.flatMap((g) => g.modifiers.map((m) => ({ ref: m.ref, name: lang === 'fr' && m.nameFr ? m.nameFr : m.name, group: `${t('Option', 'Option')} · ${lang === 'fr' && g.nameFr ? g.nameFr : g.name}` })));
    const base = tab === 'items' ? itemRows : tab === 'options' ? modRows : [...itemRows, ...modRows].filter((r) => offAt(r.ref));
    return base.filter((r) => !q || `${r.name} ${r.group}`.toLowerCase().includes(q.toLowerCase()));
  }, [menu, tab, q, lang, offAt, t]);
  const offCount = menu ? [...menu.items.map((i) => i.ref), ...menu.modifierGroups.flatMap((g) => g.modifiers.map((m) => m.ref))].filter(offAt).length : 0;

  async function toggle(ref: string, name: string) {
    const available = offAt(ref);
    setBusy(ref);
    try {
      const minutes = available ? 0 : duration === -1 ? untilEndOfDay() : duration;
      const d = await api<{ results: Result[] }>('/api/foodhub/availability', { method: 'POST', json: { brand, locationCode: location, itemRefs: [ref], available, minutes } });
      const bad = d.results.filter((r) => !r.result.ok);
      if (bad.length) toast.error(t(`${name} : ${bad.length} plateforme(s) ont refusé`, `${name}: ${bad.length} platform(s) refused`), bad.map((b) => `${b.channel}: ${b.result.message}`).join('\n'));
      else toast.success(available ? t(`${name} de retour`, `${name} back on`) : t(`${name} en rupture`, `${name} 86'd`), d.results.length ? `${d.results.length} ${t('plateforme(s) mise(s) à jour', 'platform(s) updated')}` : t('Aucun magasin branché ici — enregistré dans TAKATAK seulement.', 'No store connected here — saved in TAKATAK only.'));
      await load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title={t('Menus', 'Menus')} subtitle={t('Un article manque ? Touchez-le : il disparaît d’Uber Eats, DoorDash et Skip à cette succursale. Touchez encore pour le remettre.', 'Out of something? Tap it: it disappears from Uber Eats, DoorDash and Skip at this location. Tap again to bring it back.')} />
      <MenuTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-56" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label={t('Marque', 'Brand')}>{brands.map((b) => <option key={b}>{b}</option>)}</Select>
        <Hint id="menu86.location">{viewer.device ? <Badge tone="dark" className="h-9 px-3 text-sm">{shortLoc(locations.find((l) => l.code === location)?.name ?? location)}</Badge>
          : <Select className="w-52" value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('Succursale', 'Location')}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>}</Hint>
        <Hint id="menu86.return"><div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-ink-3">{t('Retour', 'Back')} :</span><Chips size="sm" value={duration} onChange={setDuration} options={[{ value: 0, label: t('quand je le remets', 'when I turn it on') }, { value: 30, label: '30 min' }, { value: 60, label: '1 h' }, { value: 120, label: '2 h' }, { value: -1, label: t('fin de journée', 'end of day') }]} /></div></Hint>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Hint id="menu86.tabs"><Tabs className="flex-1" value={tab} onChange={setTab} tabs={[{ key: 'items', label: t('Articles', 'Items'), count: menu?.items.length ?? 0 }, { key: 'options', label: t('Options', 'Options'), count: menu?.modifierGroups.reduce((s, g) => s + g.modifiers.length, 0) ?? 0 }, { key: 'off', label: t('En rupture', '86’d now'), count: offCount }]} /></Hint>
        <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" /><Input className="pl-9" placeholder={t('Chercher', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {!menu ? <div className="h-64 animate-pulse rounded-lg bg-sunken" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-2 px-6 py-14 text-center text-ink-3">{tab === 'off' ? t('Rien en rupture ici. 👍', 'Nothing 86’d here. 👍') : t('Aucun article. Importez le menu depuis Clover dans l’éditeur.', 'No items. Import the menu from Clover in the editor.')}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((r) => {
            const off = offAt(r.ref);
            const until = untilOf(r.ref);
            return (
              <Hint id="menu86.toggle" key={r.ref}><button type="button" disabled={busy === r.ref} onClick={() => toggle(r.ref, r.name)}
                className={cn('flex min-h-24 flex-col items-start rounded-xl border-2 p-3.5 text-left transition-all active:scale-[0.98] disabled:opacity-60', off ? 'border-stop bg-stop-soft' : 'border-line bg-surface hover:border-ink-4')}>
                <span className="flex w-full items-start justify-between gap-2"><span className={cn('text-[15px] leading-snug font-bold', off && 'text-stop-2 line-through decoration-2')}>{r.name}</span>{off ? <Ban className="size-5 shrink-0 text-stop" /> : <CheckCircle2 className="size-5 shrink-0 text-go/60" />}</span>
                <span className="mt-auto pt-2 text-xs text-ink-3">{r.group}</span>
                {off && <span className="mt-1 text-xs font-bold text-stop-2">{until ? t(`de retour à ${timeOf(new Date(until).toISOString(), loc)}`, `back at ${timeOf(new Date(until).toISOString(), loc)}`) : t('en rupture', '86’d')}</span>}
              </button></Hint>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-4">{t('Les options (sauces, tailles, extras) passent par les API d’options de chaque plateforme. DoorDash n’a pas de minuterie : TAKATAK remet l’article à l’heure prévue.', 'Options (sauces, sizes, extras) use each platform’s option APIs. DoorDash has no timer: TAKATAK turns the item back on at the planned time.')}</p>
    </div>
  );
}
