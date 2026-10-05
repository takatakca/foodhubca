'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, CircleAlert, CircleCheck, Copy, Download, ImageOff, ImageUp, Info, Languages, Plus, Search, Send, Trash2, TriangleAlert } from 'lucide-react';
import { Badge, PlatformMark, PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Segmented } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { fullWeek, WeekEditor, weekProblems, type Week } from '@/components/ui/week-editor';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { MenuTabs } from './menu-tabs';
import { api, ApiError, money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { MasterMenu, MenuCategory, MenuItem, MenuModifierGroup } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

type Issue = { level: 'error' | 'warning' | 'tip'; code: string; message: string; ref?: string };
type Check = { ok: boolean; errors: Issue[]; warnings: Issue[]; tips: Issue[] };
type StoreStatus = { storeId: string; channel: string; locationCode: string; channelStoreId: string; status: string; at: string | null; message: string | null };
type Scheduled = { id: string; at: string; status: string; createdBy: string; storeIds?: string[]; result?: string };
type PriceChange = { brandName: string; ref: string; name: string; foodhubPrice: number; cloverPrice: number };
type Langs = { uber_eats: string; doordash: string; skip: string };

const PRICE_CH: Array<[string, string]> = [['uber_eats', 'Uber'], ['doordash', 'DoorDash'], ['skip', 'Skip']];
/** Same rounding as lib/foodhub/menu/translate.ts withMarkup (kept here so the client bundle stays small). */
const withMarkup = (price: number, pct: number) => (pct && price > 0 ? Math.round(price * (100 + pct) + 1e-6) / 100 : price);
const TAGS: Array<[string, string, string]> = [['vegetarian', 'Végétarien', 'Vegetarian'], ['vegan', 'Végane', 'Vegan'], ['gluten_free', 'Sans gluten', 'Gluten-free'], ['spicy', 'Épicé', 'Spicy'], ['halal', 'Halal', 'Halal'], ['alcohol', 'Alcool', 'Alcohol']];
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function MenuEditor() {
  const { t, lang, loc } = useI18n();
  const { brands: catalogBrands, locName } = useViewer();
  const toast = useToast();
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [menu, setMenu] = useState<MasterMenu | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [stores, setStores] = useState<StoreStatus[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [prices, setPrices] = useState<PriceChange[]>([]);
  const [langs, setLangs] = useState<Langs | null>(null);
  const [cat, setCat] = useState<string>('*');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'items' | 'options' | 'publish'>('items');
  const [editItem, setEditItem] = useState<string | null>(null);
  const [editHours, setEditHours] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'copy' | 'langs' | 'newcat' | null>(null);

  useEffect(() => { api<{ brands: string[] }>('/api/foodhub/menu').then((d) => { setBrands(d.brands); setBrand((b) => b || d.brands[0] || ''); }).catch((e) => toast.error(e.message)); }, [toast]);
  useEffect(() => { api<{ languages: Langs }>('/api/foodhub/menu/languages').then((d) => setLangs(d.languages)).catch(() => undefined); }, []);
  const loadStatus = useCallback(async (b: string) => {
    const d = await api<{ check: Check | null; stores: StoreStatus[]; scheduled: Scheduled[] }>(`/api/foodhub/menu/publish?brand=${encodeURIComponent(b)}`).catch(() => null);
    if (d) { setCheck(d.check); setStores(d.stores); setScheduled(d.scheduled); }
  }, []);
  const load = useCallback(async (b: string) => {
    if (!b) return;
    const d = await api<{ menu: MasterMenu }>(`/api/foodhub/menu?brand=${encodeURIComponent(b)}`);
    setMenu(d.menu); setDirty(false); setCat('*');
    loadStatus(b);
    api<{ changes: PriceChange[] }>(`/api/foodhub/menu/clover-prices?brand=${encodeURIComponent(b)}`).then((x) => setPrices(x.changes)).catch(() => setPrices([]));
  }, [loadStatus]);
  useEffect(() => { load(brand).catch((e) => toast.error(e.message)); }, [brand, load, toast]);

  const update = (fn: (m: MasterMenu) => MasterMenu) => { setMenu((m) => (m ? fn(m) : m)); setDirty(true); };
  const updateItem = (ref: string, p: Partial<MenuItem>) => update((m) => ({ ...m, items: m.items.map((i) => (i.ref === ref ? { ...i, ...p } : i)) }));
  const updateGroup = (ref: string, p: Partial<MenuModifierGroup>) => update((m) => ({ ...m, modifierGroups: m.modifierGroups.map((g) => (g.ref === ref ? { ...g, ...p } : g)) }));
  const fail = (e: unknown) => { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); };

  async function save() {
    setBusy('save');
    try { const d = await api<{ menu: MasterMenu }>('/api/foodhub/menu', { method: 'PUT', json: { menu } }); setMenu(d.menu); setDirty(false); toast.success(t('Menu enregistré', 'Menu saved'), t('Vérification à jour.', 'Checks updated.')); loadStatus(brand); }
    catch (e) { fail(e); } finally { setBusy(''); }
  }
  async function importClover() {
    if (menu?.items.length && !window.confirm(t('Réimporter depuis Clover ? Noms, prix et options viennent de Clover ; vos prix par plateforme, descriptions, photos, étiquettes et horaires sont gardés.', 'Re-import from Clover? Names, prices and options come from Clover; your platform prices, descriptions, photos, tags and schedules are kept.'))) return;
    setBusy('import');
    try { const d = await api<{ menu: MasterMenu; imported: { items: number; categories: number; modifierGroups: number } }>('/api/foodhub/menu/import', { method: 'POST', json: { brand } }); setMenu(d.menu); setDirty(false); toast.success(t('Importé de Clover', 'Imported from Clover'), `${d.imported.items} ${t('articles', 'items')} · ${d.imported.categories} ${t('catégories', 'categories')} · ${d.imported.modifierGroups} ${t('groupes d’options', 'option groups')}`); loadStatus(brand); }
    catch (e) { fail(e); } finally { setBusy(''); }
  }
  async function resolvePrice(c: PriceChange, accept: boolean) {
    if (dirty && !window.confirm(t('Vos changements non enregistrés seront rechargés. Continuer ?', 'Unsaved changes will be reloaded. Continue?'))) return;
    try { await api('/api/foodhub/menu/clover-prices', { method: 'POST', json: { brand: c.brandName, ref: c.ref, accept } }); await load(brand); toast.success(accept ? t('Prix Clover appliqué — publiez pour l’envoyer.', 'Clover price applied — publish to send it.') : t('Prix TAKATAK gardé.', 'TAKATAK price kept.')); }
    catch (e) { fail(e); }
  }

  const cats = useMemo(() => [...(menu?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [menu]);
  const items = useMemo(() => (menu?.items ?? []).filter((i) => (cat === '*' || i.categoryRef === cat) && (!q.trim() || `${i.name} ${i.nameFr ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [menu, cat, q]);
  const issuesFor = (ref: string) => [...(check?.errors ?? []), ...(check?.warnings ?? [])].filter((x) => x.ref === ref);
  const item = menu?.items.find((i) => i.ref === editItem) ?? null;
  const hoursCat = menu?.categories.find((c) => c.ref === editHours) ?? null;
  const allBrands = brands.length ? brands : catalogBrands;
  const LANG = { en: 'English', fr: 'Français', both: 'FR / EN' } as Record<string, string>;

  return (
    <div>
      <PageHeader title={t('Menus', 'Menus')} subtitle={t('Un menu maître par marque → vérifié → publié sur Uber Eats, DoorDash et Skip avec les heures, fériés et horaires de catégorie.', 'One master menu per brand → checked → published to Uber Eats, DoorDash and Skip with hours, holidays and category schedules.')}
        right={<>
          <Select className="w-56" value={brand} onChange={(e) => { if (dirty && !window.confirm(t('Abandonner les changements ?', 'Discard changes?'))) return; setBrand(e.target.value); }} aria-label={t('Marque', 'Brand')}>{allBrands.map((b) => <option key={b}>{b}</option>)}</Select>
          <Button variant="outline" loading={busy === 'import'} onClick={importClover} icon={<Download className="size-4" />}>{t('Importer de Clover', 'Import from Clover')}</Button>
          <Button variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={save}>{dirty ? t('Enregistrer', 'Save') : t('Enregistré', 'Saved')}</Button>
          <Button variant="brand" onClick={() => (dirty ? toast.warn(t('Enregistrez avant de publier.', 'Save before publishing.')) : setDialog('publish'))} icon={<Send className="size-4" />}>{t('Publier', 'Publish')}</Button>
        </>} />
      <MenuTabs />

      {prices.length > 0 && (
        <Banner tone="warn" className="mb-4">
          <strong>{t('Prix changés dans Clover :', 'Prices changed in Clover:')}</strong>
          <div className="mt-2 space-y-1.5">{prices.map((c) => (
            <div key={c.ref} className="flex flex-wrap items-center gap-2"><span>{c.name} : {money(c.foodhubPrice, loc)} → <strong>{money(c.cloverPrice, loc)}</strong></span>
              <Button size="xs" variant="outline" onClick={() => resolvePrice(c, true)}>{t('Prendre le prix Clover', 'Use Clover price')}</Button><Button size="xs" variant="ghost" onClick={() => resolvePrice(c, false)}>{t('Garder', 'Keep')} {money(c.foodhubPrice, loc)}</Button></div>
          ))}</div>
        </Banner>
      )}

      {check && <CheckCard check={check} dirty={dirty} onFix={(ref) => setEditItem(ref)} hasItem={(ref) => Boolean(menu?.items.some((i) => i.ref === ref))} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={[{ key: 'items', label: t(`Articles (${menu?.items.length ?? 0})`, `Items (${menu?.items.length ?? 0})`) }, { key: 'options', label: t(`Options (${menu?.modifierGroups.length ?? 0})`, `Options (${menu?.modifierGroups.length ?? 0})`) }, { key: 'publish', label: t('Publication', 'Publishing') }]} />
        {menu && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1" title={t('Ajouté à chaque prix (articles et options) sur la plateforme. Le prix de base reste le prix en magasin (Clover). Un prix fixé par article a priorité.', 'Added to every price (items and options) on that platform. The base price stays the in-store (Clover) price. A per-item price always wins.')}>
            <span className="text-xs font-semibold text-ink-3">{t('Majoration', 'Markup')}</span>
            {PRICE_CH.map(([k, l]) => (
              <label key={k} className="flex items-center gap-1 text-xs"><PlatformMark channel={k} size="xs" /><span className="sr-only">{l}</span>
                <Input inputSize="sm" type="number" step="1" min="-50" max="200" placeholder="0" className="num w-16" aria-label={`${l} %`}
                  value={menu.channelMarkupPct?.[k as 'uber_eats'] ?? ''}
                  onChange={(e) => update((m) => { const next = { ...(m.channelMarkupPct || {}) } as Record<string, number>; if (e.target.value === '' || Number(e.target.value) === 0) delete next[k]; else next[k] = Number(e.target.value); return { ...m, channelMarkupPct: next }; })} />%
              </label>
            ))}
          </div>
        )}
        {langs && <button type="button" onClick={() => setDialog('langs')} className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><Languages className="size-4" />Uber {LANG[langs.uber_eats]} · DoorDash {LANG[langs.doordash]} · Skip {LANG[langs.skip]}</button>}
      </div>

      {!menu && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}

      {menu && view === 'items' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-2">
            <button type="button" onClick={() => setCat('*')} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold', cat === '*' ? 'bg-ink text-canvas' : 'hover:bg-sunken')}>{t('Tout le menu', 'Whole menu')}<span className="num text-xs opacity-70">{menu.items.length}</span></button>
            {cats.map((c, idx) => (
              <div key={c.ref} className={cn('group flex items-center gap-1 rounded-md', cat === c.ref ? 'bg-sunken' : 'hover:bg-sunken/60')}>
                <button type="button" onClick={() => setCat(c.ref)} className="min-w-0 flex-1 px-3 py-2 text-left">
                  <span className="block truncate text-sm font-semibold">{lang === 'fr' && c.nameFr ? c.nameFr : c.name}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-3">{menu.items.filter((i) => i.categoryRef === c.ref).length} {t('articles', 'items')}{c.hours && Object.values(c.hours).some((d) => d.length) && <><CalendarClock className="ml-1 size-3" />{t('horaire', 'schedule')}</>}</span>
                </button>
                <div className="hidden flex-col group-hover:flex">
                  <button type="button" disabled={idx === 0} className="p-0.5 text-ink-3 hover:text-ink disabled:opacity-30" onClick={() => update((m) => { const cs = [...m.categories].sort((a, b) => a.sortOrder - b.sortOrder); [cs[idx - 1], cs[idx]] = [cs[idx], cs[idx - 1]]; return { ...m, categories: cs.map((x, k) => ({ ...x, sortOrder: k })) }; })} aria-label="↑"><ArrowUp className="size-3.5" /></button>
                  <button type="button" disabled={idx === cats.length - 1} className="p-0.5 text-ink-3 hover:text-ink disabled:opacity-30" onClick={() => update((m) => { const cs = [...m.categories].sort((a, b) => a.sortOrder - b.sortOrder); [cs[idx + 1], cs[idx]] = [cs[idx], cs[idx + 1]]; return { ...m, categories: cs.map((x, k) => ({ ...x, sortOrder: k })) }; })} aria-label="↓"><ArrowDown className="size-3.5" /></button>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => setDialog('newcat')} icon={<Plus className="size-4" />}>{t('Catégorie', 'Category')}</Button>
          </Card>

          <div className="min-w-0">
            {cat !== '*' && (() => { const c = menu.categories.find((x) => x.ref === cat); if (!c) return null; const n = menu.items.filter((i) => i.categoryRef === c.ref).length; return (
              <Card className="mb-3 flex flex-wrap items-center gap-3 p-3">
                <Input inputSize="sm" className="w-48" value={c.name} onChange={(e) => update((m) => ({ ...m, categories: m.categories.map((x) => (x.ref === c.ref ? { ...x, name: e.target.value } : x)) }))} aria-label="Name (EN)" />
                <Input inputSize="sm" className="w-48" placeholder="Nom en français" value={c.nameFr ?? ''} onChange={(e) => update((m) => ({ ...m, categories: m.categories.map((x) => (x.ref === c.ref ? { ...x, nameFr: e.target.value || undefined } : x)) }))} aria-label="Nom (FR)" />
                <Button size="sm" variant="soft" onClick={() => setEditHours(c.ref)} icon={<CalendarClock className="size-4" />}>{c.hours && Object.values(c.hours).some((d) => d.length) ? t('Horaire propre', 'Own schedule') : t('Mêmes heures que le magasin', 'Same as store hours')}</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-stop" disabled={n > 0} title={n ? t('Déplacez ses articles d’abord', 'Move its items first') : ''} onClick={() => { update((m) => ({ ...m, categories: m.categories.filter((x) => x.ref !== c.ref) })); setCat('*'); }} icon={<Trash2 className="size-4" />}>{t('Retirer', 'Remove')}</Button>
              </Card>
            ); })()}
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" /><Input className="pl-9" placeholder={t('Chercher un article', 'Search items')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => { if (!menu.categories.length) { setDialog('newcat'); return; } const ref = uid('item'); update((m) => ({ ...m, items: [...m.items, { ref, name: t('Nouvel article', 'New item'), price: 0, categoryRef: cat !== '*' ? cat : m.categories[0].ref, available: true, modifierGroupRefs: [] }] })); setEditItem(ref); }}>{t('Article', 'Item')}</Button>
            </div>
            <Card>
              {items.length === 0 ? <EmptyState icon={<ImageOff className="size-6" />} title={menu.items.length ? t('Aucun article ici', 'No items here') : t('Menu vide', 'Empty menu')} body={menu.items.length ? undefined : t('« Importer de Clover » apporte articles, prix et options en un clic.', '“Import from Clover” brings items, prices and options in one click.')} /> : (
                <div className="divide-y divide-line">
                  {items.map((i) => {
                    const issues = issuesFor(i.ref);
                    return (
                      <div key={i.ref} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        {i.imageUrl ? <img /* eslint-disable-line @next/next/no-img-element -- menu photos come from platform CDNs */ src={i.imageUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-4"><ImageOff className="size-5" /></span>}
                        <button type="button" onClick={() => setEditItem(i.ref)} className="min-w-0 flex-1 text-left">
                          <div className="truncate font-bold">{lang === 'fr' && i.nameFr ? i.nameFr : i.name}</div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-ink-3">
                            {cat === '*' && <span>{cats.find((c) => c.ref === i.categoryRef)?.name}</span>}
                            {i.modifierGroupRefs.length > 0 && <span>· {i.modifierGroupRefs.length} {t('groupe(s) d’options', 'option group(s)')}</span>}
                            {!i.posItemRef && <span className="text-wait-2">· {t('pas lié à Clover', 'not linked to Clover')}</span>}
                            {issues[0] && <span className={issues.some((x) => x.level === 'error') ? 'font-semibold text-stop' : 'text-wait-2'}>· {issues[0].message}</span>}
                          </div>
                        </button>
                        <label className="flex items-center gap-1 text-xs text-ink-3">{t('Prix', 'Price')}<Input inputSize="sm" type="number" step="0.01" min="0" className="num w-24" value={i.price} onChange={(e) => updateItem(i.ref, { price: Number(e.target.value) })} /></label>
                        <div className="hidden gap-1 xl:flex">{PRICE_CH.map(([k, l]) => (
                          <label key={k} className="flex items-center gap-1" title={`${l}`}><PlatformMark channel={k} size="xs" /><Input inputSize="sm" type="number" step="0.01" min="0" placeholder={menu.channelMarkupPct?.[k as 'uber_eats'] ? withMarkup(i.price, Number(menu.channelMarkupPct[k as 'uber_eats'])).toFixed(2) : '='} className="num w-20" value={i.channelPrices?.[k as 'uber_eats'] ?? ''} onChange={(e) => { const next = { ...(i.channelPrices || {}) } as Record<string, number>; if (e.target.value === '') delete next[k]; else next[k] = Number(e.target.value); updateItem(i.ref, { channelPrices: next }); }} /></label>
                        ))}</div>
                        <Switch size="sm" checked={i.available} onChange={(v) => updateItem(i.ref, { available: v })} />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <p className="mt-2 text-xs text-ink-4">{t('Prix plateforme vide (=) = prix de base. L’interrupteur retire l’article partout ; pour une rupture à une succursale, utilisez Ruptures (86).', 'Empty platform price (=) = base price. The switch removes the item everywhere; for one location, use the 86 board.')}</p>
          </div>
        </div>
      )}

      {menu && view === 'options' && (
        <div>
          <div className="mb-3 flex justify-end"><Button variant="outline" icon={<Plus className="size-4" />} onClick={() => update((m) => ({ ...m, modifierGroups: [...m.modifierGroups, { ref: uid('grp'), name: 'New options', min: 0, max: 1, modifiers: [{ ref: uid('mod'), name: 'Option', price: 0, available: true }] }] }))}>{t('Groupe d’options', 'Option group')}</Button></div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {menu.modifierGroups.map((g) => {
              const usedBy = menu.items.filter((i) => i.modifierGroupRefs.includes(g.ref)).length;
              return (
                <Card key={g.ref} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input inputSize="sm" className="flex-1 font-bold" value={g.name} onChange={(e) => updateGroup(g.ref, { name: e.target.value })} aria-label="Group (EN)" />
                    <Input inputSize="sm" className="w-36" placeholder="Français" value={g.nameFr ?? ''} onChange={(e) => updateGroup(g.ref, { nameFr: e.target.value || undefined })} aria-label="Groupe (FR)" />
                    <label className="flex items-center gap-1 text-xs text-ink-3">min<Input inputSize="sm" type="number" min={0} className="w-14" value={g.min} onChange={(e) => updateGroup(g.ref, { min: Math.max(0, Number(e.target.value)) })} /></label>
                    <label className="flex items-center gap-1 text-xs text-ink-3">max<Input inputSize="sm" type="number" min={0} className="w-14" value={g.max} onChange={(e) => updateGroup(g.ref, { max: Math.max(0, Number(e.target.value)) })} /></label>
                  </div>
                  <div className="mt-1.5 text-xs text-ink-3">{g.min > 0 ? t(`Obligatoire — ${g.min}${g.max > g.min ? `–${g.max}` : ''}`, `Required — pick ${g.min}${g.max > g.min ? `–${g.max}` : ''}`) : t(`Facultatif — jusqu’à ${g.max || '∞'}`, `Optional — up to ${g.max || 'any'}`)} · {t(`utilisé par ${usedBy} article(s)`, `used by ${usedBy} item(s)`)}</div>
                  <div className="mt-3 space-y-1.5">
                    {g.modifiers.map((md) => (
                      <div key={md.ref} className="flex items-center gap-2">
                        <Input inputSize="sm" className="flex-1" value={md.name} onChange={(e) => updateGroup(g.ref, { modifiers: g.modifiers.map((x) => (x.ref === md.ref ? { ...x, name: e.target.value } : x)) })} />
                        <Input inputSize="sm" className="w-28" placeholder="Français" value={md.nameFr ?? ''} onChange={(e) => updateGroup(g.ref, { modifiers: g.modifiers.map((x) => (x.ref === md.ref ? { ...x, nameFr: e.target.value || undefined } : x)) })} />
                        <Input inputSize="sm" type="number" step="0.01" min="0" className="num w-20" value={md.price} onChange={(e) => updateGroup(g.ref, { modifiers: g.modifiers.map((x) => (x.ref === md.ref ? { ...x, price: Number(e.target.value) } : x)) })} />
                        <Switch size="sm" checked={md.available} onChange={(v) => updateGroup(g.ref, { modifiers: g.modifiers.map((x) => (x.ref === md.ref ? { ...x, available: v } : x)) })} />
                        <button type="button" className="p-1 text-ink-4 hover:text-stop" onClick={() => updateGroup(g.ref, { modifiers: g.modifiers.filter((x) => x.ref !== md.ref) })} aria-label="×"><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="xs" variant="soft" onClick={() => updateGroup(g.ref, { modifiers: [...g.modifiers, { ref: uid('mod'), name: 'Option', price: 0, available: true }] })} icon={<Plus className="size-3.5" />}>{t('option', 'option')}</Button>
                    <Button size="xs" variant="ghost" className="text-stop" disabled={usedBy > 0} onClick={() => update((m) => ({ ...m, modifierGroups: m.modifierGroups.filter((x) => x.ref !== g.ref) }))}>{t('Retirer le groupe', 'Remove group')}</Button>
                  </div>
                </Card>
              );
            })}
            {menu.modifierGroups.length === 0 && <Card className="lg:col-span-2"><EmptyState title={t('Aucun groupe d’options', 'No option groups')} body={t('Les options Clover arrivent avec « Importer de Clover ».', 'Clover modifiers come with “Import from Clover”.')} /></Card>}
          </div>
        </div>
      )}

      {menu && view === 'publish' && (
        <Card>
          <CardHeader title={t('Dernière publication par magasin', 'Last publish per store')} right={<Button size="sm" variant="outline" onClick={() => loadStatus(brand)}>{t('Actualiser', 'Refresh')}</Button>} />
          <div className="divide-y divide-line border-t border-line">
            {stores.map((s) => (
              <div key={s.storeId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <PlatformTag channel={s.channel} className="w-40" />
                <span className="w-32 text-sm text-ink-2">{shortLoc(locName(s.locationCode))}</span>
                <span className="text-xs text-ink-3">{s.at ? timeOf(s.at, loc, true) : t('jamais', 'never')}</span>
                {s.status !== 'never' && <Badge tone={s.status === 'done' ? 'go' : s.status === 'queued' ? 'wait' : 'stop'}>{s.status === 'done' ? t('reçu', 'received') : s.status === 'queued' ? t('en attente de confirmation', 'waiting for confirmation') : t('échec', 'failed')}</Badge>}
                <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{s.message}</span>
              </div>
            ))}
            {stores.length === 0 && <div className="px-5 py-6 text-sm text-ink-3">{t('Aucun magasin branché pour cette marque.', 'No store connected for this brand.')}</div>}
          </div>
          {scheduled.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <div className="mb-2 text-sm font-bold">{t('Publications programmées', 'Scheduled publishes')}</div>
              {scheduled.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
                  <span className="font-semibold">{timeOf(s.at, loc, true)}</span><span className="text-ink-3">{s.storeIds?.length ? `${s.storeIds.length} ${t('magasins', 'stores')}` : t('tous', 'all')} · {s.createdBy}</span>
                  <Badge tone={s.status === 'done' ? 'go' : s.status === 'failed' ? 'stop' : s.status === 'cancelled' ? 'neutral' : 'wait'}>{s.status}</Badge>
                  {s.status === 'scheduled' && <Button size="xs" variant="ghost" onClick={async () => { await api(`/api/foodhub/menu/publish?id=${s.id}`, { method: 'DELETE' }).catch(fail); loadStatus(brand); }}>{t('Annuler', 'Cancel')}</Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {item && menu && <ItemDialog item={item} markup={menu.channelMarkupPct} groups={menu.modifierGroups} categories={cats} onChange={(p) => updateItem(item.ref, p)} onRemove={() => { update((m) => ({ ...m, items: m.items.filter((x) => x.ref !== item.ref) })); setEditItem(null); }} onClose={() => setEditItem(null)} />}
      {hoursCat && <CategoryHours category={hoursCat} onSave={(h) => { update((m) => ({ ...m, categories: m.categories.map((c) => (c.ref === hoursCat.ref ? { ...c, hours: h as MenuCategory['hours'] } : c)) })); setEditHours(null); }} onClose={() => setEditHours(null)} />}
      {dialog === 'publish' && menu && <PublishDialog brand={brand} stores={stores} check={check} onClose={() => setDialog(null)} onDone={() => { setDialog(null); loadStatus(brand); setView('publish'); }} />}
      {dialog === 'langs' && langs && <LangDialog value={langs} onClose={() => setDialog(null)} onSaved={(l) => { setLangs(l); setDialog(null); toast.success(t('Langues enregistrées — publiez pour les appliquer.', 'Languages saved — publish to apply them.')); }} />}
      {dialog === 'newcat' && <NewCategory onClose={() => setDialog(null)} onAdd={(name, nameFr) => { const ref = uid('cat'); update((m) => ({ ...m, categories: [...m.categories, { ref, name, nameFr: nameFr || undefined, sortOrder: m.categories.length }] })); setCat(ref); setDialog(null); }} copyFrom={allBrands.filter((b) => b !== brand)} onCopy={async (src) => {
        const d = await api<{ menu: MasterMenu }>(`/api/foodhub/menu?brand=${encodeURIComponent(src)}`);
        if (!d.menu.items.length) { toast.warn(t(`${src} n’a pas d’articles.`, `${src} has no items.`)); return; }
        if (!window.confirm(t(`Remplacer le menu de ${brand} par une copie de ${src} ?`, `Replace ${brand}'s menu with a copy of ${src}?`))) return;
        update((m) => ({ ...m, categories: d.menu.categories, items: d.menu.items, modifierGroups: d.menu.modifierGroups })); setDialog(null); toast.success(t(`Copié de ${src} — vérifiez puis enregistrez.`, `Copied from ${src} — review, then save.`));
      }} />}
    </div>
  );
}

function CheckCard({ check, dirty, onFix, hasItem }: { check: Check; dirty: boolean; onFix: (ref: string) => void; hasItem: (ref: string) => boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const all = [...check.errors, ...check.warnings, ...(open ? check.tips : [])];
  return (
    <Card className="mb-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left">
        {check.errors.length ? <CircleAlert className="size-5 text-stop" /> : <CircleCheck className="size-5 text-go" />}
        <span className="font-bold">{check.errors.length ? t(`${check.errors.length} erreur(s) bloquent la publication`, `${check.errors.length} error(s) block publishing`) : t('Prêt à publier', 'Ready to publish')}</span>
        <Badge tone="wait">{check.warnings.length} {t('avertissement(s)', 'warning(s)')}</Badge>
        <Badge tone="neutral">{check.tips.length} {t('conseil(s)', 'tip(s)')}</Badge>
        {dirty && <span className="text-xs text-ink-3">{t('(vérifié sur la version enregistrée)', '(checked on the saved version)')}</span>}
        <span className="ml-auto text-xs font-semibold text-ink-3">{open ? t('Masquer', 'Hide') : t('Détails', 'Details')}</span>
      </button>
      {(open || check.errors.length > 0) && all.length > 0 && (
        <ul className="space-y-1 border-t border-line px-5 py-3">
          {all.map((x, i) => (
            <li key={i} className={cn('flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm', x.level === 'error' ? 'bg-stop-soft' : x.level === 'warning' ? 'bg-wait-soft' : 'bg-sunken')}>
              {x.level === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-stop" /> : x.level === 'warning' ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-wait-2" /> : <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />}
              <span className="flex-1">{x.message}</span>
              {x.ref && hasItem(x.ref) && <button type="button" className="text-xs font-bold underline" onClick={() => onFix(x.ref!)}>{t('Corriger', 'Fix')}</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemDialog({ item, markup, groups, categories, onChange, onRemove, onClose }: { item: MenuItem; markup?: Partial<Record<string, number>>; groups: MenuModifierGroup[]; categories: MenuCategory[]; onChange: (p: Partial<MenuItem>) => void; onRemove: () => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [allergens, setAllergens] = useState((item.allergens ?? []).join(', '));
  const [upload, setUpload] = useState<{ busy: boolean; msg: string; tone: 'stop' | 'warn' | null }>({ busy: false, msg: '', tone: null });
  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUpload({ busy: true, msg: '', tone: null });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/foodhub/media', { method: 'POST', body: fd, cache: 'no-store' });
      const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok?: boolean; url?: string; error?: string; warning?: string | null };
      if (!res.ok || !body.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
      onChange({ imageUrl: body.url });
      setUpload({ busy: false, msg: body.warning ?? '', tone: body.warning ? 'warn' : null });
    } catch (e) { setUpload({ busy: false, msg: e instanceof Error ? e.message : String(e), tone: 'stop' }); }
  };
  const done = () => { onChange({ allergens: allergens.split(',').map((a) => a.trim()).filter(Boolean) }); onClose(); };
  return (
    <Modal title={item.name || t('Article', 'Item')} size="lg" onClose={done}
      footer={<><Button variant="ghost" className="mr-auto text-stop" onClick={() => { if (window.confirm(t(`Retirer ${item.name} ?`, `Remove ${item.name}?`))) onRemove(); }} icon={<Trash2 className="size-4" />}>{t('Retirer', 'Remove')}</Button><Button onClick={done}>{t('Terminé', 'Done')}</Button></>}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Name (English)"><Input value={item.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
          <Field label="Nom (français)"><Input value={item.nameFr ?? ''} placeholder="Ex. Poulet grillé" onChange={(e) => onChange({ nameFr: e.target.value || undefined })} /></Field>
          <Field label="Description (English)"><Textarea rows={3} value={item.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} /></Field>
          <Field label="Description (français)"><Textarea rows={3} value={item.descriptionFr ?? ''} onChange={(e) => onChange({ descriptionFr: e.target.value || undefined })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Catégorie', 'Category')}><Select value={item.categoryRef} onChange={(e) => onChange({ categoryRef: e.target.value })}>{categories.map((c) => <option key={c.ref} value={c.ref}>{lang === 'fr' && c.nameFr ? c.nameFr : c.name}</option>)}</Select></Field>
            <Field label={t('Prix de base', 'Base price')}><Input type="number" step="0.01" min="0" value={item.price} onChange={(e) => onChange({ price: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">{PRICE_CH.map(([k, l]) => <Field key={k} label={<span className="flex items-center gap-1"><PlatformMark channel={k} size="xs" />{l}</span>}><Input type="number" step="0.01" min="0" placeholder={withMarkup(item.price, Number(markup?.[k] ?? 0)).toFixed(2)} value={item.channelPrices?.[k as 'uber_eats'] ?? ''} onChange={(e) => { const next = { ...(item.channelPrices || {}) } as Record<string, number>; if (e.target.value === '') delete next[k]; else next[k] = Number(e.target.value); onChange({ channelPrices: next }); }} /></Field>)}</div>
        </div>
        <div className="space-y-4">
          <Field label={t('Photo (URL https, 1200×800 recommandé)', 'Photo (https URL, 1200×800 recommended)')}>
            <div className="flex gap-2">
              <Input className="min-w-0 flex-1" value={item.imageUrl ?? ''} placeholder="https://…" onChange={(e) => onChange({ imageUrl: e.target.value.trim() || undefined })} />
              <label className={cn('inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line px-3 text-sm font-semibold text-ink hover:bg-sunken', upload.busy && 'pointer-events-none opacity-60')}>
                <ImageUp className="size-4" />{upload.busy ? t('Envoi…', 'Uploading…') : t('Téléverser', 'Upload')}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </Field>
          {upload.msg && <Banner tone={upload.tone === 'stop' ? 'stop' : 'warn'}>{upload.msg}</Banner>}
          {item.imageUrl && <img /* eslint-disable-line @next/next/no-img-element -- menu photos come from platform CDNs */ src={item.imageUrl} alt={item.name} className="max-h-44 w-full rounded-lg object-cover" />}
          <div><div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Étiquettes', 'Dietary tags')}</div><div className="flex flex-wrap gap-x-4 gap-y-2">{TAGS.map(([k, fr, en]) => <Checkbox key={k} checked={(item.tags ?? []).includes(k)} onChange={(c) => onChange({ tags: c ? [...(item.tags ?? []), k] : (item.tags ?? []).filter((x) => x !== k) })} label={lang === 'fr' ? fr : en} />)}</div></div>
          <Field label={t('Allergènes (séparés par des virgules)', 'Allergens (comma-separated)')}><Input value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="arachides, lait, blé" /></Field>
          <Field label="Calories"><Input type="number" min={0} className="w-32" value={item.calories ?? ''} onChange={(e) => onChange({ calories: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
          <div><div className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('Groupes d’options', 'Option groups')}</div><div className="space-y-1.5">{groups.map((g) => <Checkbox key={g.ref} checked={item.modifierGroupRefs.includes(g.ref)} onChange={(c) => onChange({ modifierGroupRefs: c ? [...item.modifierGroupRefs, g.ref] : item.modifierGroupRefs.filter((r) => r !== g.ref) })} label={`${lang === 'fr' && g.nameFr ? g.nameFr : g.name} (${g.modifiers.length}${g.min ? `, ${t('obligatoire', 'required')}` : ''})`} />)}{groups.length === 0 && <span className="text-xs text-ink-3">—</span>}</div></div>
          <div className="text-xs text-ink-3">Clover : <span className="font-mono">{item.posItemRef || t('non lié — arrive comme ligne libre', 'not linked — arrives as a custom line')}</span></div>
        </div>
      </div>
    </Modal>
  );
}

function CategoryHours({ category, onSave, onClose }: { category: MenuCategory; onSave: (h: Week | null) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [week, setWeek] = useState<Week>(() => (category.hours && Object.values(category.hours).some((d) => d.length) ? JSON.parse(JSON.stringify(category.hours)) : fullWeek('07:00', '11:00')));
  const problems = weekProblems(week);
  return (
    <Modal title={`${t('Horaire', 'Schedule')} — ${category.name}`} subtitle={t('Vendue seulement à ces heures (et quand le magasin est ouvert). Uber et Skip : menu séparé ; DoorDash : heures par article.', 'Only sold at these times (and while the store is open). Uber and Skip: a separate menu; DoorDash: item hours.')} size="lg" onClose={onClose}
      footer={<><Button variant="ghost" className="mr-auto" onClick={() => onSave(null)}>{t('Mêmes heures que le magasin', 'Same as store hours')}</Button><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button disabled={problems.length > 0} onClick={() => onSave(week)}>{t('Utiliser cet horaire', 'Use this schedule')}</Button></>}>
      <WeekEditor value={week} onChange={setWeek} />
      {problems.length > 0 && <Banner tone="warn" className="mt-3">{problems.join(' · ')}</Banner>}
    </Modal>
  );
}

function PublishDialog({ brand, stores, check, onClose, onDone }: { brand: string; stores: StoreStatus[]; check: Check | null; onClose: () => void; onDone: () => void }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const toast = useToast();
  const [sel, setSel] = useState<string[]>(stores.map((s) => s.storeId));
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = Boolean(check && !check.ok);
  async function go() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { brand, storeIds: sel.length === stores.length ? undefined : sel };
      if (when === 'later') body.at = new Date(at).toISOString();
      const d = await api<{ results?: Array<{ channel: string; result: { ok: boolean; status: string; message: string } }>; scheduled?: { at: string } }>('/api/foodhub/menu/publish', { method: 'POST', json: body });
      if (d.scheduled) toast.success(t('Publication programmée', 'Publish scheduled'), timeOf(d.scheduled.at, loc, true));
      else { const bad = (d.results ?? []).filter((r) => !r.result.ok); if (bad.length) toast.error(t(`${bad.length} plateforme(s) ont refusé`, `${bad.length} platform(s) refused`), bad.map((b) => `${b.channel}: ${b.result.message}`).join('\n')); else toast.success(t('Menu envoyé', 'Menu sent'), t('Skip et DoorDash confirment en arrière-plan.', 'Skip and DoorDash confirm in the background.')); }
      onDone();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={t(`Publier ${brand}`, `Publish ${brand}`)} size="lg" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="brand" loading={busy} disabled={blocked || !sel.length || (when === 'later' && !at)} onClick={go} icon={<Send className="size-4" />}>{when === 'now' ? t(`Publier sur ${sel.length} magasin(s)`, `Publish to ${sel.length} store(s)`) : t('Programmer', 'Schedule')}</Button></>}>
      {blocked && <Banner tone="stop" className="mb-3">{t(`Corrigez les ${check!.errors.length} erreur(s) d’abord.`, `Fix the ${check!.errors.length} error(s) first.`)}</Banner>}
      <div className="mb-2 flex gap-2 text-xs"><button type="button" className="font-semibold underline" onClick={() => setSel(stores.map((s) => s.storeId))}>{t('Tous', 'All')}</button><button type="button" className="font-semibold underline" onClick={() => setSel([])}>{t('Aucun', 'None')}</button><span className="text-ink-3">{sel.length}/{stores.length}</span></div>
      <div className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {stores.map((s) => <label key={s.storeId} className="flex cursor-pointer items-center gap-3 px-3 py-2"><input type="checkbox" className="size-4" checked={sel.includes(s.storeId)} onChange={(e) => setSel(e.target.checked ? [...sel, s.storeId] : sel.filter((x) => x !== s.storeId))} /><PlatformTag channel={s.channel} className="w-40" /><span className="text-sm text-ink-2">{shortLoc(locName(s.locationCode))}</span></label>)}
        {stores.length === 0 && <div className="p-4 text-sm text-ink-3">{t('Aucun magasin branché.', 'No store connected.')}</div>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented value={when} onChange={setWhen} options={[{ key: 'now', label: t('Maintenant', 'Now') }, { key: 'later', label: t('Plus tard', 'Later') }]} />
        {when === 'later' && <Input type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} />}
      </div>
    </Modal>
  );
}

function LangDialog({ value, onSaved, onClose }: { value: Langs; onSaved: (l: Langs) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const opts = [['fr', 'Français'], ['en', 'English'], ['both', 'Français / English']];
  async function save() { setBusy(true); try { const d = await api<{ languages: Langs }>('/api/foodhub/menu/languages', { method: 'PUT', json: { languages: v } }); onSaved(d.languages); } finally { setBusy(false); } }
  return (
    <Modal title={t('Langue du menu par plateforme', 'Menu language per platform')} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="space-y-4">
        {([['uber_eats', t('Uber montre à chaque client sa langue quand les noms français sont remplis.', 'Uber shows each customer their language when French names are filled in.')], ['doordash', t('Une langue par menu.', 'One language per menu.')], ['skip', t('Une langue par menu.', 'One language per menu.')]] as const).map(([k, note]) => (
          <Field key={k} label={<span className="flex items-center gap-2"><PlatformMark channel={k} size="xs" />{k === 'uber_eats' ? 'Uber Eats' : k === 'doordash' ? 'DoorDash' : 'SkipTheDishes'}</span>} hint={note}>
            <Select value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })}>{opts.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</Select>
          </Field>
        ))}
        <p className="text-xs text-ink-3">{t('« Français / English » affiche les deux : « Poulet grillé / Grilled chicken ».', '“Français / English” shows both: “Poulet grillé / Grilled chicken”.')}</p>
      </div>
    </Modal>
  );
}

function NewCategory({ onAdd, onClose, copyFrom, onCopy }: { onAdd: (name: string, nameFr: string) => void; onClose: () => void; copyFrom: string[]; onCopy: (b: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [src, setSrc] = useState(copyFrom[0] ?? '');
  return (
    <Modal title={t('Nouvelle catégorie', 'New category')} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button disabled={!name.trim()} onClick={() => onAdd(name.trim(), nameFr.trim())}>{t('Ajouter', 'Add')}</Button></>}>
      <div className="space-y-4">
        <Field label="Name (English)"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Nom (français)"><Input value={nameFr} onChange={(e) => setNameFr(e.target.value)} /></Field>
        {copyFrom.length > 0 && (
          <div className="rounded-lg border border-line bg-raised p-3">
            <div className="mb-2 text-[13px] font-semibold">{t('Ou copier tout le menu d’une autre marque', 'Or copy a whole menu from another brand')}</div>
            <div className="flex gap-2"><Select selectSize="sm" value={src} onChange={(e) => setSrc(e.target.value)}>{copyFrom.map((b) => <option key={b}>{b}</option>)}</Select><Button size="sm" variant="outline" onClick={() => onCopy(src)} icon={<Copy className="size-4" />}>{t('Copier', 'Copy')}</Button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
