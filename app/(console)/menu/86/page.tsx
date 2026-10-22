'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Info, Search } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Chips, Input, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { MenuTabs } from '../menu-tabs';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { useI18n, useProduct } from '@/lib/i18n/client';
import { countEn, countFr } from '@/lib/ui/count-label';
import type { MasterMenu } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

type Result = { channel: string; result: { ok: boolean; status: string; message: string } };

function untilEndOfDay() { const e = new Date(); e.setHours(23, 59, 0, 0); return Math.max(5, Math.round((e.getTime() - Date.now()) / 60000)); }

/** 86 board: sold out at one location → off on Uber Eats, DoorDash and Skip there, back by itself if you want. */
export default function EightySix() {
  const { t, lang, loc } = useI18n();
  const product = useProduct();
  const { viewer, locations, brands: catalogBrands, can } = useViewer();
  const { scope, site } = usePulse();
  // Starts on the console's brand and location (header picker) when one is picked.
  const scopeBrand = site.brand;
  const toast = useToast();
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [location, setLocation] = useState(viewer.device?.locationCode ?? scope[0] ?? locations[0]?.code ?? '');
  const [menu, setMenu] = useState<MasterMenu | null>(null);
  const [tab, setTab] = useState<'items' | 'options' | 'off'>('items');
  const [q, setQ] = useState('');
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api<{ brands: string[]; summary: Array<{ brandName: string; items: number }> }>('/api/foodhub/menu').then((d) => { const withItems = d.summary.filter((s) => s.items > 0).map((s) => s.brandName); const list = withItems.length ? withItems : d.brands; setBrands(list); setBrand((b) => b || (scopeBrand && list.includes(scopeBrand) ? scopeBrand : list[0]) || ''); }).catch(() => setBrands(catalogBrands)); }, [catalogBrands, scopeBrand]);
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
      if (bad.length) toast.error(t(`${name} : ${countFr(bad.length, 'plateforme a', 'plateformes ont')} refusé`, `${name}: ${countEn(bad.length, 'platform')} refused`), bad.map((b) => `${b.channel}: ${b.result.message}`).join('\n'));
      else toast.success(available ? t(`${name} de retour`, `${name} back on`) : t(`${name} épuisé`, `${name} sold out`), d.results.length ? t(`${countFr(d.results.length, 'plateforme mise', 'plateformes mises')} à jour`, `${countEn(d.results.length, 'platform')} updated`) : t(`Aucun magasin branché ici — enregistré dans ${product.name} seulement.`, `No store connected here — saved in ${product.name} only.`));
      await load();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader eyebrow={t('Menus', 'Menus')} tabs={<MenuTabs className="mb-0" />}
        title={<span className="inline-flex flex-wrap items-center gap-3">{t('Épuisés', 'Sold out')}{menu && <Badge tone={offCount ? 'stop' : 'neutral'} className="num">{offCount ? t(`${offCount} en ce moment`, `${offCount} right now`) : t('aucun', 'none')}</Badge>}</span>}
        subtitle={t('Un article manque ? Touchez-le : il disparaît d’Uber Eats, DoorDash et Skip dans cette cuisine. Touchez encore pour le remettre.', 'Out of something? Tap it: it disappears from Uber Eats, DoorDash and Skip at this kitchen. Tap again to bring it back.')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select className="w-full sm:w-56" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label={t('Marque', 'Brand')}>{brands.map((b) => <option key={b}>{b}</option>)}</Select>
        <Hint id="menu86.location">{viewer.device ? <Badge tone="dark" className="text-body h-10 px-3">{shortLoc(locations.find((l) => l.code === location)?.name ?? location)}</Badge>
          : <Select className="w-full sm:w-52" value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('Cuisine', 'Kitchen')}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>}</Hint>
        {/* The label sits above its chips: on a phone « Retour : » no longer breaks beside them. */}
        <Hint id="menu86.return"><div role="group" aria-labelledby="menu86-return"><div id="menu86-return" className="text-small mb-1.5 font-semibold text-ink-3">{t('Revient en ligne', 'Comes back')}</div><Chips size="sm" value={duration} onChange={setDuration} options={[{ value: 0, label: t('quand je le remets', 'when I turn it on') }, { value: 30, label: '30 min' }, { value: 60, label: '1 h' }, { value: 120, label: '2 h' }, { value: -1, label: t('fin de journée', 'end of day') }]} /></div></Hint>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* A filter, not a third level of navigation (A4 #3): rail → Menus tabs → this. */}
        <Hint id="menu86.tabs"><Segmented label={t('Afficher', 'Show')} value={tab} onChange={setTab} options={[
          { key: 'items', label: <>{t('Articles', 'Items')} <span className="num text-ink-3">{menu?.items.length ?? 0}</span></> },
          { key: 'options', label: <>{t('Options', 'Options')} <span className="num text-ink-3">{menu?.modifierGroups.reduce((s, g) => s + g.modifiers.length, 0) ?? 0}</span></> },
          { key: 'off', label: <>{t('Épuisés', 'Sold out')} <span className={cn('num', offCount ? 'text-stop-2' : 'text-ink-3')}>{offCount}</span></> },
        ]} /></Hint>
        <span className="hidden flex-1 sm:block" />
        <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden /><Input className="pl-9" aria-label={t('Chercher un article', 'Search an item')} placeholder={t('Chercher', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {!menu ? <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy>{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div> : rows.length === 0 ? (
        <Card>{q ? <EmptyState icon={<Search />} title={t('Rien ne correspond', 'Nothing matches')} action={<Button variant="outline" onClick={() => setQ('')}>{t('Effacer la recherche', 'Clear the search')}</Button>} />
          : tab === 'off' ? <EmptyState icon={<CheckCircle2 />} title={t('Rien d’épuisé ici', 'Nothing sold out here')} body={t('Tout le menu est en vente dans cette cuisine.', 'The whole menu is on sale at this kitchen.')} action={<Button variant="outline" onClick={() => setTab('items')}>{t('Voir les articles', 'See the items')}</Button>} />
            : <EmptyState icon={<Ban />} title={t('Aucun article', 'No items')} body={t('Importez le menu de cette marque depuis Clover dans l’éditeur.', 'Import this brand’s menu from Clover in the editor.')} action={can('menu:edit') ? <ButtonLink href="/menu" variant="primary">{t('Ouvrir l’éditeur de menu', 'Open the menu editor')}</ButtonLink> : undefined} />}</Card>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((r) => {
            const off = offAt(r.ref);
            const until = untilOf(r.ref);
            return (
              <Hint id="menu86.toggle" key={r.ref}><button type="button" disabled={busy === r.ref} onClick={() => toggle(r.ref, r.name)}
                className={cn('flex min-h-24 flex-col items-start rounded-xl border-2 p-3.5 text-left transition-all active:scale-[0.98] disabled:opacity-60', off ? 'border-stop bg-stop-soft' : 'border-line bg-surface hover:border-ink-4')}>
                <span className="flex w-full items-start justify-between gap-2"><span className={cn('text-body leading-snug font-bold', off && 'text-stop-2 line-through decoration-2')}>{r.name}</span>{off ? <Ban className="size-5 shrink-0 text-stop" /> : <CheckCircle2 className="size-5 shrink-0 text-go/60" />}</span>
                <span className="mt-auto pt-2 text-small text-ink-3">{r.group}</span>
                {off && <span className="mt-1 text-small font-bold text-stop-2">{until ? t(`de retour à ${timeOf(new Date(until).toISOString(), loc)}`, `back at ${timeOf(new Date(until).toISOString(), loc)}`) : t('épuisé', 'sold out')}</span>}
              </button></Hint>
            );
          })}
        </div>
      )}
      <p className="text-small mt-4 flex items-start gap-2 text-ink-3"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t(`Les options (sauces, tailles, extras) passent par les API d’options de chaque plateforme. DoorDash n’a pas de minuterie : ${product.name} remet l’article à l’heure prévue.`, `Options (sauces, sizes, extras) use each platform’s option APIs. DoorDash has no timer: ${product.name} turns the item back on at the planned time.`)}</p>
    </div>
  );
}
