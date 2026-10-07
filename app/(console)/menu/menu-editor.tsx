'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, CircleAlert, CircleCheck, Copy, Download, ImageOff, ImageUp, Info, Languages, Link2, Plus, Search, Send, Trash2, TriangleAlert } from 'lucide-react';
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
type Scheduled = { id: string; brand: string; at: string; status: string; createdBy: string; storeIds?: string[]; result?: string; groupId?: string };
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
  const [dialog, setDialog] = useState<'publish' | 'uber' | 'copy' | 'langs' | 'newcat' | 'share' | 'import' | null>(null);
  // One menu for several brands: follower → source. sharedFrom = the brand whose menu this one uses.
  const [sharing, setSharing] = useState<Record<string, string>>({});
  const [sharedFrom, setSharedFrom] = useState<string | null>(null);
  const [group, setGroup] = useState<string[]>([]);

  const loadBrands = useCallback(() => api<{ brands: string[]; sharing?: Record<string, string> }>('/api/foodhub/menu').then((d) => { setBrands(d.brands); setSharing(d.sharing ?? {}); setBrand((b) => b || d.brands[0] || ''); }).catch((e) => toast.error(e.message)), [toast]);
  useEffect(() => { loadBrands(); }, [loadBrands]);
  useEffect(() => { api<{ languages: Langs }>('/api/foodhub/menu/languages').then((d) => setLangs(d.languages)).catch(() => undefined); }, []);
  const loadStatus = useCallback(async (b: string) => {
    const d = await api<{ check: Check | null; stores: StoreStatus[]; scheduled: Scheduled[]; group?: string[] }>(`/api/foodhub/menu/publish?brand=${encodeURIComponent(b)}`).catch(() => null);
    if (d) { setCheck(d.check); setStores(d.stores); setScheduled(d.scheduled); setGroup(d.group ?? [b]); }
  }, []);
  const load = useCallback(async (b: string) => {
    if (!b) return;
    const d = await api<{ menu: MasterMenu; sharedFrom?: string | null }>(`/api/foodhub/menu?brand=${encodeURIComponent(b)}`);
    setMenu(d.menu); setSharedFrom(d.sharedFrom ?? null); setDirty(false); setCat('*');
    loadStatus(b);
    api<{ changes: PriceChange[] }>(`/api/foodhub/menu/clover-prices?brand=${encodeURIComponent(b)}`).then((x) => setPrices(x.changes)).catch(() => setPrices([]));
  }, [loadStatus]);
  useEffect(() => { load(brand).catch((e) => toast.error(e.message)); }, [brand, load, toast]);

  const update = (fn: (m: MasterMenu) => MasterMenu) => {
    // A brand that shares another brand's menu is read-only here: it is edited on that brand.
    if (sharedFrom) { toast.warn(t(`${brand} utilise le menu ${sharedFrom}`, `${brand} uses the ${sharedFrom} menu`), t(`Modifiez ${sharedFrom} : le changement s’applique à toutes les marques qui le partagent.`, `Edit ${sharedFrom}: the change applies to every brand that shares it.`)); return; }
    setMenu((m) => (m ? fn(m) : m)); setDirty(true);
  };
  const updateItem = (ref: string, p: Partial<MenuItem>) => update((m) => ({ ...m, items: m.items.map((i) => (i.ref === ref ? { ...i, ...p } : i)) }));
  const updateGroup = (ref: string, p: Partial<MenuModifierGroup>) => update((m) => ({ ...m, modifierGroups: m.modifierGroups.map((g) => (g.ref === ref ? { ...g, ...p } : g)) }));
  const fail = (e: unknown) => { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); };

  async function save() {
    setBusy('save');
    try { const d = await api<{ menu: MasterMenu }>('/api/foodhub/menu', { method: 'PUT', json: { menu } }); setMenu(d.menu); setDirty(false); toast.success(t('Menu enregistré', 'Menu saved'), t('Vérification à jour.', 'Checks updated.')); loadStatus(brand); }
    catch (e) { fail(e); } finally { setBusy(''); }
  }
  function importClover() {
    if (dirty) { toast.warn(t('Enregistrez d’abord.', 'Save first.')); return; }
    setDialog('import');
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
      <PageHeader title={t('Menus', 'Menus')} subtitle={t('Un menu maître par marque, ou un seul menu partagé entre vos marques → vérifié → publié sur Uber Eats, DoorDash et Skip avec les heures, fériés et horaires de catégorie.', 'One master menu per brand, or one menu shared by your brands → checked → published to Uber Eats, DoorDash and Skip with hours, holidays and category schedules.')}
        right={<>
          <Select className="w-56" value={brand} onChange={(e) => { if (dirty && !window.confirm(t('Abandonner les changements ?', 'Discard changes?'))) return; setBrand(e.target.value); }} aria-label={t('Marque', 'Brand')}>{allBrands.map((b) => <option key={b} value={b}>{sharing[b] ? `${b} → ${sharing[b]}` : b}</option>)}</Select>
          <Button variant="outline" onClick={() => (dirty ? toast.warn(t('Enregistrez d’abord.', 'Save first.')) : setDialog('share'))} icon={<Link2 className="size-4" />}>{t('Menu partagé', 'Shared menu')}</Button>
          <Button variant="outline" disabled={Boolean(sharedFrom)} loading={busy === 'import'} onClick={importClover} icon={<Download className="size-4" />}>{t('Importer de Clover', 'Import from Clover')}</Button>
          <Button variant="primary" disabled={!dirty || Boolean(sharedFrom)} loading={busy === 'save'} onClick={save}>{dirty ? t('Enregistrer', 'Save') : t('Enregistré', 'Saved')}</Button>
          <Button variant="outline" onClick={() => (dirty ? toast.warn(t('Enregistrez avant de publier.', 'Save before publishing.')) : setDialog('uber'))} icon={<PlatformMark channel="uber_eats" size="xs" />}>{t('Tous les magasins Uber', 'All Uber stores')}</Button>
          <Button variant="brand" onClick={() => (dirty ? toast.warn(t('Enregistrez avant de publier.', 'Save before publishing.')) : setDialog('publish'))} icon={<Send className="size-4" />}>{t('Publier', 'Publish')}</Button>
        </>} />
      <MenuTabs />

      {sharedFrom ? (
        <Banner tone="info" className="mb-4" action={<Button size="xs" variant="outline" onClick={() => setBrand(sharedFrom)}>{t(`Modifier ${sharedFrom}`, `Edit ${sharedFrom}`)}</Button>}>
          {t(`${brand} utilise le menu ${sharedFrom} (articles, prix, options, ruptures). Il est publié sous le nom, les heures et les magasins de ${brand}. Modifiez-le sur ${sharedFrom}.`,
            `${brand} uses the ${sharedFrom} menu (items, prices, options, 86s). It is published under ${brand}’s own name, hours and stores. Edit it on ${sharedFrom}.`)}
        </Banner>
      ) : group.length > 1 && (
        <Banner tone="info" className="mb-4">
          {t(`Ce menu est aussi utilisé par : ${group.slice(1).join(', ')}. Chaque changement et chaque rupture s’appliquent à toutes ces marques.`,
            `This menu is also used by: ${group.slice(1).join(', ')}. Every change and every 86 applies to all of these brands.`)}
        </Banner>
      )}

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
                  <span className="font-semibold">{timeOf(s.at, loc, true)}</span>{group.length > 1 && <span className="font-semibold">{s.brand}</span>}<span className="text-ink-3">{s.storeIds?.length ? `${s.storeIds.length} ${t('magasins', 'stores')}` : t('tous', 'all')} · {s.createdBy}</span>
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
      {dialog === 'share' && <ShareDialog brand={sharedFrom ?? brand} brands={allBrands} sharing={sharing} onClose={() => setDialog(null)} onSaved={(next, publish) => { setSharing(next); setDialog(null); load(brand).catch(fail); loadBrands(); toast.success(t('Menus partagés enregistrés', 'Shared menus saved'), publish.length ? t(`Publiez ${publish.join(', ')} : leurs plateformes montrent encore l’ancien menu.`, `Publish ${publish.join(', ')}: their platforms still show the previous menu.`) : undefined); }} />}
      {dialog === 'import' && <ImportDialog brand={brand} hasItems={Boolean(menu?.items.length)} onClose={() => setDialog(null)} onDone={(m) => { setMenu(m); setDirty(false); setDialog(null); loadStatus(brand); }} />}
      {dialog === 'publish' && menu && <PublishDialog brand={brand} group={group} stores={stores} check={check} onClose={() => setDialog(null)} onDone={() => { setDialog(null); loadStatus(brand); setView('publish'); }} />}
      {dialog === 'uber' && <UberPublishDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); loadStatus(brand); setView('publish'); }} />}
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

function PublishDialog({ brand, group, stores, check, onClose, onDone }: { brand: string; group: string[]; stores: StoreStatus[]; check: Check | null; onClose: () => void; onDone: () => void }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const toast = useToast();
  const [sel, setSel] = useState<string[]>(stores.map((s) => s.storeId));
  // Brands sharing this menu: publish them all at once (default) or only this brand's selected stores.
  const [allBrands, setAllBrands] = useState(group.length > 1);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const blocked = Boolean(check && !check.ok);
  const scope = () => (allBrands ? { brand, allBrands: true } : { brand, storeIds: sel.length === stores.length ? undefined : sel });
  /** Dry run: what each store would receive and what it changes — nothing is sent. */
  async function dryRun() {
    setPreviewing(true);
    try { const d = await api<{ preview: PreviewRow[] }>('/api/foodhub/menu/publish', { method: 'POST', json: { ...scope(), dryRun: true } }); setPreview(d.preview); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setPreviewing(false); }
  }
  async function go() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = scope();
      if (when === 'later') body.at = new Date(at).toISOString();
      const d = await api<{ results?: Array<{ channel: string; result: { ok: boolean; status: string; message: string } }>; scheduled?: { at: string } }>('/api/foodhub/menu/publish', { method: 'POST', json: body });
      if (d.scheduled) toast.success(t('Publication programmée', 'Publish scheduled'), timeOf(d.scheduled.at, loc, true));
      else if (!(d.results ?? []).length) toast.warn(t('Rien n’a été envoyé', 'Nothing was sent'), t('Aucun magasin de cette marque ne peut recevoir un menu.', 'No store of this brand can receive a menu.'));
      else { const bad = (d.results ?? []).filter((r) => !r.result.ok); if (bad.length) toast.error(t(`${bad.length} plateforme(s) ont refusé`, `${bad.length} platform(s) refused`), bad.map((b) => `${b.channel}: ${b.result.message}`).join('\n')); else toast.success(t('Menu envoyé', 'Menu sent'), t('Skip et DoorDash confirment en arrière-plan.', 'Skip and DoorDash confirm in the background.')); }
      onDone();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={t(`Publier ${brand}`, `Publish ${brand}`)} size="lg" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="outline" loading={previewing} disabled={!allBrands && !sel.length} onClick={dryRun} icon={<Search className="size-4" />}>{t('Aperçu (rien n’est envoyé)', 'Preview (nothing sent)')}</Button><Button variant="brand" loading={busy} disabled={blocked || (!allBrands && !sel.length) || (when === 'later' && !at)} onClick={go} icon={<Send className="size-4" />}>{when === 'later' ? t('Programmer', 'Schedule') : allBrands ? t(`Publier ${group.length} marques`, `Publish ${group.length} brands`) : t(`Publier sur ${sel.length} magasin(s)`, `Publish to ${sel.length} store(s)`)}</Button></>}>
      {blocked && <Banner tone="stop" className="mb-3">{t(`Corrigez les ${check!.errors.length} erreur(s) d’abord.`, `Fix the ${check!.errors.length} error(s) first.`)}</Banner>}
      {group.length > 1 && (
        <div className="mb-3 rounded-lg border border-line bg-raised p-3">
          <Checkbox checked={allBrands} onChange={setAllBrands} label={<span>{t(`Publier pour toutes les marques qui partagent ce menu (${group.length}) : `, `Publish for every brand that shares this menu (${group.length}): `)}<strong>{group.join(', ')}</strong></span>} />
        </div>
      )}
      {!allBrands && <>
      <div className="mb-2 flex gap-2 text-xs"><button type="button" className="font-semibold underline" onClick={() => setSel(stores.map((s) => s.storeId))}>{t('Tous', 'All')}</button><button type="button" className="font-semibold underline" onClick={() => setSel([])}>{t('Aucun', 'None')}</button><span className="text-ink-3">{sel.length}/{stores.length}</span></div>
      <div className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {stores.map((s) => <label key={s.storeId} className="flex cursor-pointer items-center gap-3 px-3 py-2"><input type="checkbox" className="size-4" checked={sel.includes(s.storeId)} onChange={(e) => setSel(e.target.checked ? [...sel, s.storeId] : sel.filter((x) => x !== s.storeId))} /><PlatformTag channel={s.channel} className="w-40" /><span className="text-sm text-ink-2">{shortLoc(locName(s.locationCode))}</span></label>)}
        {stores.length === 0 && <div className="p-4 text-sm text-ink-3">{t('Aucun magasin branché.', 'No store connected.')}</div>}
      </div>
      </>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented value={when} onChange={setWhen} options={[{ key: 'now', label: t('Maintenant', 'Now') }, { key: 'later', label: t('Plus tard', 'Later') }]} />
        {when === 'later' && <Input type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} />}
      </div>
      {preview && <PublishPreview rows={preview} />}
    </Modal>
  );
}

type CloverMenu = { id: string; name: string; type?: string; channel?: string; status?: string; items?: number; platform: 'uber_eats' | 'doordash' | 'skip' | null };
type ImportInfo = { merchants: Array<{ id: string; isDefault: boolean; locations: string[] }>; defaultMerchantId: string | null; cloverMenus: { merchantId: string | null; ok: boolean; menus: CloverMenu[]; error?: string } };
type ImportReport = { items: number; categories: number; modifierGroups: number; requiredGroups: number; skipped: { hidden: number; archived: number; notInMenu: number; variablePrice: number }; menu?: { name: string; items: number; missingFromInventory: number }; platformPrices?: Record<string, { markupPct: number | null; overrides: number; items: number }> };

/**
 * Import from Clover: the whole visible inventory, or one of the merchant's Clover menus (e.g. the DoorDash +20 % menu
 * — only its items, its photos, and its prices on the chosen platforms). Archived items are left out.
 */
function ImportDialog({ brand, hasItems, onClose, onDone }: { brand: string; hasItems: boolean; onClose: () => void; onDone: (m: MasterMenu) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [info, setInfo] = useState<ImportInfo | null>(null);
  const [mid, setMid] = useState('');
  const [source, setSource] = useState('inventory');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback((m?: string) => api<ImportInfo>(`/api/foodhub/menu/import${m ? `?merchantId=${encodeURIComponent(m)}` : ''}`).then((d) => { setInfo(d); setMid(d.cloverMenus.merchantId ?? ''); }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { void load(); }, [load]);
  const chosen = info?.cloverMenus.menus.find((m) => m.id === source);
  useEffect(() => { setPlatforms(chosen?.platform ? [chosen.platform] : []); }, [chosen?.id, chosen?.platform]);
  async function go() {
    if (hasItems && !window.confirm(t('Réimporter depuis Clover ? Noms, prix et options viennent de Clover ; vos descriptions, photos, étiquettes, traductions et horaires sont gardés.', 'Re-import from Clover? Names, prices and options come from Clover; your descriptions, photos, tags, translations and schedules are kept.'))) return;
    setBusy(true);
    try {
      const d = await api<{ menu: MasterMenu; report: ImportReport | null }>('/api/foodhub/menu/import', { method: 'POST', json: { brand, merchantId: mid || undefined, ...(chosen ? { cloverMenuId: chosen.id, platformPrices: platforms } : {}) } });
      const r = d.report;
      const lines = r ? [
        t(`${r.items} articles · ${r.categories} catégories · ${r.modifierGroups} groupes d’options (${r.requiredGroups} obligatoires)`, `${r.items} items · ${r.categories} categories · ${r.modifierGroups} option groups (${r.requiredGroups} required)`),
        r.skipped.archived || r.skipped.hidden || r.skipped.notInMenu ? t(`Laissés de côté : ${r.skipped.archived} archivés, ${r.skipped.hidden} cachés${r.menu ? `, ${r.skipped.notInMenu} hors du menu « ${r.menu.name} »` : ''}`, `Left out: ${r.skipped.archived} archived, ${r.skipped.hidden} hidden${r.menu ? `, ${r.skipped.notInMenu} not in the "${r.menu.name}" menu` : ''}`) : '',
        ...Object.entries(r.platformPrices ?? {}).map(([p, x]) => `${p}: ${x.markupPct !== null ? `+${x.markupPct} %` : t('prix par article', 'item prices')}${x.overrides ? t(` (${x.overrides} prix propres)`, ` (${x.overrides} own prices)`) : ''}`),
        r.skipped.variablePrice ? t(`${r.skipped.variablePrice} article(s) à prix variable importés indisponibles`, `${r.skipped.variablePrice} variable-price item(s) imported unavailable`) : '',
      ].filter(Boolean).join('\n') : `${d.menu.items.length} ${t('articles', 'items')}`;
      toast.success(t('Importé de Clover — publiez pour l’envoyer', 'Imported from Clover — publish to send it'), lines);
      onDone(d.menu);
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const PL: Array<[string, string]> = [['doordash', 'DoorDash'], ['uber_eats', 'Uber Eats'], ['skip', 'Skip']];
  // Clover's menu kinds in words: the POS menu (what the register shows) and the online / delivery menus.
  const menuType = (type?: string) => (!type ? '' : /DEFAULT_POS/i.test(type) ? t('Menu de la caisse', 'Register menu') : /OLO/i.test(type) ? t('Menu en ligne', 'Online menu') : type);
  return (
    <Modal title={t(`Importer ${brand} de Clover`, `Import ${brand} from Clover`)} size="lg" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="brand" loading={busy} disabled={!info} onClick={go} icon={<Download className="size-4" />}>{t('Importer', 'Import')}</Button></>}>
      {!info ? <div className="h-40 animate-pulse rounded-lg bg-sunken" /> : <div className="space-y-4">
        {info.merchants.length > 1 && <Field label={t('Marchand Clover', 'Clover merchant')}><Select value={mid} onChange={(e) => { setMid(e.target.value); setSource('inventory'); void load(e.target.value); }}>{info.merchants.map((m) => <option key={m.id} value={m.id}>{m.id}{m.isDefault ? ` (${t('par défaut', 'default')})` : ''}{m.locations.length ? ` — ${m.locations.join(', ')}` : ''}</option>)}</Select></Field>}
        <div>
          <div className="mb-1.5 text-sm font-semibold">{t('Que faut-il importer ?', 'What to import?')}</div>
          <div className="divide-y divide-line rounded-lg border border-line">
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5"><input type="radio" className="mt-1" checked={source === 'inventory'} onChange={() => setSource('inventory')} />
              <span><span className="font-semibold">{t('Tout l’inventaire visible', 'All visible inventory')}</span><span className="block text-xs text-ink-3">{t('Articles non cachés, hors catégories « ARCHIVE ». Prix en magasin ; majorations par plateforme gardées.', 'Items not hidden, outside “ARCHIVE” categories. In-store prices; platform markups kept.')}</span></span></label>
            {info.cloverMenus.menus.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5"><input type="radio" className="mt-1" checked={source === m.id} onChange={() => setSource(m.id)} />
                <span className="min-w-0"><span className="font-semibold">{m.name}</span>{m.platform && <PlatformMark channel={m.platform} size="xs" className="ml-1.5 inline-flex align-middle" />}
                  <span className="block text-xs text-ink-3">{[menuType(m.type), m.channel, m.status === 'published' ? t('publié', 'published') : m.status === 'draft' ? t('brouillon', 'draft') : m.status, m.items !== undefined ? t(`${m.items} articles`, `${m.items} items`) : ''].filter(Boolean).join(' · ')}</span></span></label>
            ))}
          </div>
          {!info.cloverMenus.ok && <p className="mt-1.5 text-xs text-ink-3">{t('Les menus Clover ne sont pas lisibles avec ce jeton — import de l’inventaire seulement.', 'Clover menus cannot be read with this token — inventory import only.')} <span className="font-mono">{info.cloverMenus.error}</span></p>}
        </div>
        {chosen && (
          <div>
            <div className="mb-1.5 text-sm font-semibold">{t('Les prix de ce menu deviennent les prix sur :', 'This menu’s prices become the prices on:')}</div>
            <div className="flex flex-wrap gap-4">{PL.map(([k, l]) => <Checkbox key={k} checked={platforms.includes(k)} onChange={(v) => setPlatforms(v ? [...platforms, k] : platforms.filter((x) => x !== k))} label={l} />)}</div>
            <p className="mt-1.5 text-xs text-ink-3">{t('Seuls les articles de ce menu sont importés. Si ses prix sont le prix Clover + un même pourcentage (ex. +20 %), Food Hub garde ce pourcentage : un prix changé dans Clover suit tout seul.', 'Only this menu’s items are imported. When its prices are the Clover price + one percentage (e.g. +20%), Food Hub keeps that percentage: a price changed in Clover follows by itself.')}</p>
          </div>
        )}
      </div>}
    </Modal>
  );
}

type UberPlanRow = {
  storeId: string; channelStoreId: string; brandName: string; locationCode: string; menuFrom: string | null; action: 'publish' | 'skip'; skip?: 'do_not_touch' | 'no_menu' | 'menu_errors';
  provisioning: 'confirmed' | 'waiting' | 'elsewhere' | 'disconnected' | 'unknown'; counts: { menus: number; categories: number; items: number; suspended: number; modifierGroups: number; modifierOptions: number } | null;
  markupPct: number; samples: Array<{ name: string; base: number; uber: number }>; hoursSet: boolean; holidays: number; issues: Issue[];
};
type UberPlan = { canSend: boolean; note: string; rows: UberPlanRow[]; summary: { stores: number; publish: number; doNotTouch: number; blocked: number } };
type UberResult = { storeId: string; result: { ok: boolean; status: string; message: string } };

/**
 * "Publish to all Uber stores": a dry run first (exactly what each store would receive, what blocks it), then one click.
 * Stores marked "Do not touch" are listed but never sent; the switch is right here.
 */
function UberPublishDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const toast = useToast();
  const [plan, setPlan] = useState<UberPlan | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<Record<string, UberResult['result']> | null>(null);
  const load = useCallback(() => api<{ plan: UberPlan }>('/api/foodhub/menu/uber').then((d) => { setPlan(d.plan); setSel(d.plan.rows.filter((r) => r.action === 'publish').map((r) => r.storeId)); }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);

  async function toggleTouch(r: UberPlanRow, doNotTouch: boolean) {
    setBusy(`touch-${r.storeId}`);
    try { await api('/api/foodhub/stores', { method: 'POST', json: { id: r.storeId, channel: 'uber_eats', channelStoreId: r.channelStoreId, brandName: r.brandName, locationCode: r.locationCode, doNotTouch } }); await load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish');
    try {
      const d = await api<{ results: UberResult[]; sent: number; failed: number; blocked: number; untouched: number }>('/api/foodhub/menu/uber', { method: 'POST', json: { storeIds: sel } });
      setResults(Object.fromEntries(d.results.map((r) => [r.storeId, r.result])));
      // "Sent" only for what Uber answered OK; blocked (safe mode, menu errors) and refused are said as such.
      if (d.sent && !d.failed && !d.blocked) toast.success(t(`Menu reçu par ${d.sent} magasin(s) Uber`, `Menu received by ${d.sent} Uber store(s)`));
      else toast.warn(t(`${d.sent} reçu(s) · ${d.failed} refusé(s) · ${d.blocked} non envoyé(s)`, `${d.sent} received · ${d.failed} refused · ${d.blocked} not sent`), t('Le détail est dans la liste.', 'Details are in the list.'));
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const PROV: Record<UberPlanRow['provisioning'], [string, string, 'go' | 'wait' | 'stop' | 'neutral']> = {
    confirmed: ['activé chez Uber', 'active at Uber', 'go'], waiting: ['en attente d’Uber', 'waiting for Uber', 'wait'], elsewhere: ['encore chez UrbanPiper', 'still on UrbanPiper', 'stop'], disconnected: ['débranché par Uber', 'disconnected by Uber', 'stop'], unknown: ['relié à la main', 'linked by hand', 'neutral'],
  };
  const resultBadge = (r: UberResult['result']) => r.status === 'done' || r.status === 'queued' ? <Badge tone="go">{t('reçu par Uber', 'received by Uber')}</Badge> : r.status === 'skipped' ? <Badge tone="neutral">{t('pas touché', 'left untouched')}</Badge> : r.status === 'blocked' ? <Badge tone="wait" title={r.message}>{t('non envoyé', 'not sent')}</Badge> : <Badge tone="stop" title={r.message}>{t('refusé', 'refused')}</Badge>;
  const rows = plan?.rows ?? [];
  return (
    <Modal title={t('Publier sur tous les magasins Uber Eats', 'Publish to all Uber Eats stores')} subtitle={t('Aperçu : rien n’est envoyé avant le bouton « Publier ».', 'Preview: nothing is sent until you press “Publish”.')} size="xl" onClose={results ? onDone : onClose}
      footer={results ? <Button onClick={onDone}>{t('Fermer', 'Close')}</Button> : <><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="brand" loading={busy === 'publish'} disabled={!sel.length || !plan} onClick={publish} icon={<Send className="size-4" />}>{t(`Publier sur ${sel.length} magasin(s) Uber`, `Publish to ${sel.length} Uber store(s)`)}</Button></>}>
      {!plan ? <div className="py-8 text-center text-sm text-ink-3">{t('Préparation de l’aperçu…', 'Building the preview…')}</div> : <>
        {!plan.canSend && <Banner tone="warn" className="mb-3">{t('Uber Eats n’est pas encore en direct : la publication sera refusée (« non envoyé ») tant que ceci n’est pas réglé — ', 'Uber Eats is not live yet: publishing is refused (“not sent”) until this is fixed — ')}{plan.note}</Banner>}
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <Badge tone="info">{plan.summary.stores} {t('magasins Uber', 'Uber stores')}</Badge>
          <Badge tone="go">{plan.summary.publish} {t('prêts', 'ready')}</Badge>
          {plan.summary.doNotTouch > 0 && <Badge tone="neutral">{plan.summary.doNotTouch} {t('« ne pas toucher »', '“do not touch”')}</Badge>}
          {plan.summary.blocked > 0 && <Badge tone="stop">{plan.summary.blocked} {t('bloqués', 'blocked')}</Badge>}
        </div>
        {rows.length === 0 && <EmptyState title={t('Aucun magasin Uber branché', 'No Uber store connected')} body={t('Branchez-les dans Magasins → Brancher Uber Eats.', 'Connect them in Stores → Connect Uber Eats.')} />}
        <div className="scrollbar-thin max-h-[55vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {rows.map((r) => {
            const [fr, en, tone] = PROV[r.provisioning];
            const errors = r.issues.filter((i) => i.level === 'error');
            const warnings = r.issues.filter((i) => i.level !== 'error');
            const res = results?.[r.storeId];
            return (
              <div key={r.storeId} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <input type="checkbox" className="size-4" aria-label={r.brandName} disabled={r.action !== 'publish' || Boolean(results)} checked={sel.includes(r.storeId)} onChange={(e) => setSel(e.target.checked ? [...sel, r.storeId] : sel.filter((x) => x !== r.storeId))} />
                  <div className="min-w-40 flex-1"><div className="font-semibold">{r.brandName}</div><div className="text-xs text-ink-3">{shortLoc(locName(r.locationCode))}{r.menuFrom && r.menuFrom !== r.brandName ? ` · ${t('menu de', 'menu from')} ${r.menuFrom}` : ''}</div></div>
                  <Badge tone={tone}>{t(fr, en)}</Badge>
                  {r.counts && <span className="text-xs text-ink-2">{r.counts.items} {t('articles', 'items')} · {r.counts.modifierGroups} {t('groupes', 'groups')} · {r.counts.modifierOptions} options{r.counts.suspended ? ` · ${r.counts.suspended} ${t('en rupture', '86’d')}` : ''}</span>}
                  {r.counts && <span className="text-xs text-ink-2">{r.markupPct ? `+${r.markupPct}%` : t('sans majoration', 'no markup')}{r.samples[0] ? ` (${r.samples[0].name}: ${money(r.samples[0].base, loc)} → ${money(r.samples[0].uber, loc)})` : ''}</span>}
                  {res ? resultBadge(res) : r.skip === 'do_not_touch' ? <Badge tone="neutral">{t('ne pas toucher', 'do not touch')}</Badge> : errors.length ? <Badge tone="stop">{errors.length} {t('erreur(s)', 'error(s)')}</Badge> : warnings.length ? <Badge tone="wait">{warnings.length} {t('avertissement(s)', 'warning(s)')}</Badge> : <Badge tone="go">{t('prêt', 'ready')}</Badge>}
                  <span className="ml-auto flex items-center gap-3 whitespace-nowrap">
                    {!results && <Switch size="sm" checked={r.skip === 'do_not_touch'} disabled={busy === `touch-${r.storeId}`} onChange={(v) => toggleTouch(r, v)} label={<span className="text-xs">{t('Ne pas toucher', 'Do not touch')}</span>} />}
                    {r.counts && <a className="text-xs font-semibold underline" href={`/api/foodhub/menu/uber?storeId=${encodeURIComponent(r.storeId)}`} target="_blank" rel="noreferrer">JSON</a>}
                    {r.issues.length > 0 && <button type="button" className="text-xs font-semibold underline" onClick={() => setOpen(open === r.storeId ? null : r.storeId)}>{open === r.storeId ? t('Masquer', 'Hide') : t('Détails', 'Details')}</button>}
                  </span>
                </div>
                {res && !res.ok && <div className="mt-1 text-xs text-stop-2">{res.message}</div>}
                {open === r.storeId && (
                  <ul className="mt-2 space-y-1">{r.issues.map((x, i) => <li key={i} className={cn('rounded-md px-2.5 py-1 text-xs', x.level === 'error' ? 'bg-stop-soft' : x.level === 'warning' ? 'bg-wait-soft' : 'bg-sunken')}>{x.message}</li>)}</ul>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-3">{t('Chaque magasin reçoit le menu de sa marque (le menu partagé si elle le suit), ses heures et ses fériés, en français et en anglais. « Ne pas toucher » : Food Hub n’envoie jamais de menu ni de rupture à ce magasin ; les commandes et la pause continuent.', 'Each store gets its brand’s menu (the shared menu when the brand follows it), its hours and holidays, in French and English. “Do not touch”: Food Hub never sends this store a menu or an 86; orders and pause keep working.')}</p>
      </>}
    </Modal>
  );
}

type Diff = { added: Array<{ name: string; price: number }>; removed: Array<{ name: string }>; repriced: Array<{ name: string; from: number; to: number }>; turnedOff: Array<{ name: string }>; turnedOn: Array<{ name: string }>; renamed: Array<{ from: string; to: string }>; same: boolean };
type PreviewRow = {
  storeId: string; brandName: string; channel: string; locationCode: string; channelStoreId: string; send: 'yes' | 'locked' | 'not_live' | 'via_clover'; reason?: string; reasonFr?: string;
  counts: { categories: number; items: number; available: number; unavailable: number; options: number }; hoursSet: boolean; holidays: number; language: string;
  diff: Diff | null; lastPublishedAt: string | null; sample: Array<{ name: string; price: number }>;
};

const LANG_LABEL: Record<string, string> = { en: 'EN', fr: 'FR', both: 'FR / EN' };

/** Dry-run result, one card per store: will it be sent, and what changes on the platform. */
function PublishPreview({ rows }: { rows: PreviewRow[] }) {
  const { t, loc } = useI18n();
  const { locName } = useViewer();
  const sendLabel: Record<PreviewRow['send'], [string, string, 'go' | 'stop' | 'wait' | 'info']> = {
    yes: ['Sera envoyé', 'Will be sent', 'go'], locked: ['Menu verrouillé — rien n’est envoyé', 'Menu locked — nothing sent', 'stop'],
    not_live: ['Pas en direct — rien n’est envoyé', 'Not live — nothing sent', 'wait'], via_clover: ['Relié par Clover — géré dans Clover', 'Linked through Clover — managed in Clover', 'info'],
  };
  const list = (items: Array<{ name: string }>, n = 6) => `${items.slice(0, n).map((i) => i.name).join(', ')}${items.length > n ? '…' : ''}`;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 text-sm font-bold">{t(`Aperçu — ${rows.length} magasin(s), rien n’a été envoyé`, `Preview — ${rows.length} store(s), nothing was sent`)}</div>
      <div className="scrollbar-thin max-h-96 space-y-2 overflow-y-auto">
        {rows.map((r) => {
          const [fr, en, tone] = sendLabel[r.send];
          const d = r.diff;
          return (
            <div key={r.storeId} className="rounded-lg border border-line p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformMark channel={r.channel} size="xs" /><span className="font-bold">{r.brandName}</span><span className="text-ink-3">· {shortLoc(locName(r.locationCode))}</span>
                <Badge tone={tone} className="ml-auto">{t(fr, en)}</Badge>
              </div>
              {r.reason && r.send !== 'yes' && <div className="mt-1 text-xs text-ink-3">{t(r.reasonFr ?? r.reason, r.reason)}</div>}
              {r.send !== 'locked' && <div className="mt-1.5 text-xs text-ink-2">
                {t(`${r.counts.categories} catégories · ${r.counts.available} articles en vente${r.counts.unavailable ? ` (${r.counts.unavailable} en rupture)` : ''} · ${r.counts.options} options`, `${r.counts.categories} categories · ${r.counts.available} items on sale${r.counts.unavailable ? ` (${r.counts.unavailable} 86'd)` : ''} · ${r.counts.options} options`)}
                {' · '}{r.hoursSet ? t('heures du magasin', 'store hours') : t('aucune heure (24/7)', 'no hours (24/7)')}{r.holidays ? ` · ${t(`${r.holidays} férié(s)`, `${r.holidays} holiday(s)`)}` : ''} · {LANG_LABEL[r.language] ?? r.language}
              </div>}
              {r.send !== 'locked' && r.sample.length > 0 && <div className="mt-1 text-xs text-ink-3">{r.sample.map((s) => `${s.name} ${money(s.price, loc)}`).join(' · ')}</div>}
              {r.send === 'yes' && <div className="mt-1.5 text-xs">
                {!d ? <span className="text-ink-3">{t('Jamais publié depuis Food Hub : tout le menu sera envoyé.', 'Never published from Food Hub: the whole menu is sent.')}</span>
                  : d.same ? <span className="text-go-2">{t('Aucun changement depuis la dernière publication.', 'No change since the last publish.')}</span>
                    : <ul className="space-y-0.5">
                      {d.added.length > 0 && <li><strong className="text-go-2">+{d.added.length}</strong> {t('nouveau(x) :', 'new:')} {list(d.added)}</li>}
                      {d.removed.length > 0 && <li><strong className="text-stop">−{d.removed.length}</strong> {t('retiré(s) :', 'removed:')} {list(d.removed)}</li>}
                      {d.repriced.length > 0 && <li><strong>{d.repriced.length}</strong> {t('prix changé(s) :', 'price change(s):')} {d.repriced.slice(0, 5).map((x) => `${x.name} ${money(x.from, loc)} → ${money(x.to, loc)}`).join(', ')}{d.repriced.length > 5 ? '…' : ''}</li>}
                      {d.turnedOff.length > 0 && <li><strong className="text-wait-2">{d.turnedOff.length}</strong> {t('en rupture :', '86\'d:')} {list(d.turnedOff)}</li>}
                      {d.turnedOn.length > 0 && <li><strong className="text-go-2">{d.turnedOn.length}</strong> {t('de retour :', 'back on:')} {list(d.turnedOn)}</li>}
                      {d.renamed.length > 0 && <li><strong>{d.renamed.length}</strong> {t('renommé(s)', 'renamed')}: {d.renamed.slice(0, 3).map((x) => `${x.from} → ${x.to}`).join(', ')}</li>}
                    </ul>}
                {r.lastPublishedAt && <div className="mt-0.5 text-[11px] text-ink-4">{t('Dernière publication :', 'Last publish:')} {new Date(r.lastPublishedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}</div>}
              </div>}
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-sm text-ink-3">{t('Aucun magasin ne recevrait ce menu.', 'No store would receive this menu.')}</div>}
      </div>
    </div>
  );
}

/** One menu for several brands: pick the brand whose menu is edited, then the brands that use it. */
function ShareDialog({ brand, brands, sharing, onSaved, onClose }: { brand: string; brands: string[]; sharing: Record<string, string>; onSaved: (s: Record<string, string>, publish: string[]) => void; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [source, setSource] = useState(sharing[brand] ?? brand);
  const followersOf = (src: string) => brands.filter((b) => b !== src && sharing[b] === src);
  const [users, setUsers] = useState<string[]>(followersOf(sharing[brand] ?? brand));
  const [busy, setBusy] = useState(false);
  const others = brands.filter((b) => b !== source);
  async function save() {
    // Every link to this source is rewritten; links to other sources stay as they are.
    const next: Record<string, string> = Object.fromEntries(Object.entries(sharing).filter(([k, v]) => v !== source && k !== source && !users.includes(k)));
    for (const b of users) next[b] = source;
    setBusy(true);
    try { const d = await api<{ sharing: Record<string, string>; publish?: string[] }>('/api/foodhub/menu/sharing', { method: 'PUT', json: { sharing: next } }); onSaved(d.sharing, d.publish ?? []); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('Menu partagé entre marques', 'Menu shared across brands')} size="lg" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{t('Un seul menu pour plusieurs marques, comme l’agrégateur de menus d’UrbanPiper : il se modifie, s’importe de Clover et se met en rupture sur une marque, puis chaque marque le publie sous son propre nom, avec ses heures et ses magasins.',
          'One menu for several brands, like UrbanPiper’s Menu Aggregator: it is edited, imported from Clover and 86’d on one brand, and every brand publishes it under its own name, hours and stores.')}</p>
        <Field label={t('Menu à utiliser (la marque où il se modifie)', 'Menu to use (the brand where it is edited)')}>
          <Select value={source} onChange={(e) => { setSource(e.target.value); setUsers(followersOf(e.target.value)); }}>{brands.filter((b) => !sharing[b]).map((b) => <option key={b} value={b}>{b}</option>)}</Select>
        </Field>
        <div>
          <div className="mb-2 flex items-center gap-3 text-[13px] font-semibold">{t('Marques qui utilisent ce menu', 'Brands that use this menu')}
            <button type="button" className="text-xs font-semibold underline" onClick={() => setUsers(others)}>{t('Toutes', 'All')}</button>
            <button type="button" className="text-xs font-semibold underline" onClick={() => setUsers([])}>{t('Aucune', 'None')}</button>
          </div>
          <div className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {others.map((b) => {
              const leads = followersOf(b).length > 0;
              return (
                <div key={b} className="px-3 py-2">
                  <Checkbox checked={users.includes(b)} disabled={leads} onChange={(v) => setUsers(v ? [...users, b] : users.filter((x) => x !== b))}
                    label={<span>{b}{sharing[b] && sharing[b] !== source ? <span className="text-ink-3"> · {t(`utilise ${sharing[b]}`, `uses ${sharing[b]}`)}</span> : null}{leads ? <span className="text-ink-3"> · {t('d’autres marques utilisent son menu', 'other brands use its menu')}</span> : null}</span>} />
                </div>
              );
            })}
            {others.length === 0 && <div className="p-4 text-sm text-ink-3">{t('Aucune autre marque.', 'No other brand.')}</div>}
          </div>
          <p className="mt-2 text-xs text-ink-3">{t('Le menu propre d’une marque n’est pas effacé : il revient (avec les ruptures en cours) si elle cesse de partager ; sans menu propre, elle reçoit une copie du menu partagé. Publiez ensuite les marques changées pour envoyer leur menu aux plateformes.', 'A brand’s own menu is not deleted: it comes back (with the current 86s) if the brand stops sharing; a brand without one gets a copy of the shared menu. Publish the changed brands afterwards to send their menu to the platforms.')}</p>
        </div>
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
        {([['uber_eats', t('Un seul texte par nom chez Uber (toutes les langues ensemble) — « Français / English » est conseillé au Québec.', 'Uber takes one text per name (all languages together) — “Français / English” is best in Québec.')], ['doordash', t('Une langue par menu.', 'One language per menu.')], ['skip', t('Une langue par menu.', 'One language per menu.')]] as const).map(([k, note]) => (
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
