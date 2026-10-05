'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Send, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { fullWeek, WeekEditor, weekProblems, weekSummary, type Slot, type Week } from '@/components/ui/week-editor';
import { MultiPick } from '@/components/ui/filter-bar';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

type Holiday = { id: string; date: string; name: string; locationCodes: string[]; closed: boolean; slots?: Slot[] };
type Hours = { locations: Record<string, Week>; brands: Record<string, Week>; holidays: Holiday[]; updatedAt?: string };
const QC = (y: number): Array<[string, string]> => [[`${y}-01-01`, 'Jour de l’An'], [`${y}-06-24`, 'Fête nationale du Québec'], [`${y}-07-01`, 'Fête du Canada'], [`${y}-12-25`, 'Noël']];

export default function HoursPage() {
  const { t, lang } = useI18n();
  const { locations, brands, can } = useViewer();
  const toast = useToast();
  const editable = can('menu:edit');
  const [hours, setHours] = useState<Hours | null>(null);
  const [tab, setTab] = useState<'locations' | 'brands' | 'holidays'>('locations');
  const [loc, setLoc] = useState(locations[0]?.code ?? '');
  const [brand, setBrand] = useState(brands[0] ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api<{ hours: Hours }>('/api/foodhub/hours').then((d) => { setHours(d.hours); setDirty(false); }).catch((e) => toast.error(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  const patch = (fn: (h: Hours) => Hours) => { setHours((h) => (h ? fn(h) : h)); setDirty(true); };
  const problems = useMemo(() => !hours ? [] : [
    ...Object.entries(hours.locations).flatMap(([k, w]) => weekProblems(w).map((p) => `${k} — ${p}`)),
    ...Object.entries(hours.brands).flatMap(([k, w]) => weekProblems(w).map((p) => `${k} — ${p}`)),
    ...hours.holidays.filter((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h.date)).map((h) => `${h.name}: date`),
  ], [hours]);

  async function save() {
    if (!hours) return;
    setBusy('save');
    try { const d = await api<{ hours: Hours }>('/api/foodhub/hours', { method: 'PUT', json: { hours } }); setHours(d.hours); setDirty(false); toast.success(t('Heures enregistrées', 'Hours saved'), t('Publiez pour les envoyer aux plateformes.', 'Publish to send them to the platforms.')); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  async function publishAll() {
    if (dirty) { toast.warn(t('Enregistrez d’abord', 'Save first')); return; }
    setBusy('publish');
    const d = await api<{ summary: Array<{ brandName: string; items: number }> }>('/api/foodhub/menu').catch(() => ({ summary: [] }));
    const withMenu = d.summary.filter((s) => s.items > 0).map((s) => s.brandName);
    let ok = 0; const errs: string[] = [];
    for (const b of withMenu) {
      try { const r = await api<{ results: Array<{ result: { ok: boolean } }> }>('/api/foodhub/menu/publish', { method: 'POST', json: { brand: b } }); if (r.results.every((x) => x.result.ok)) ok++; else errs.push(b); }
      catch (e) { if (e instanceof ApiError && e.status === 499) break; errs.push(`${b}: ${e instanceof Error ? e.message : e}`); }
    }
    setBusy('');
    if (!withMenu.length) toast.warn(t('Aucune marque n’a de menu enregistré.', 'No brand has a saved menu yet.'));
    else if (errs.length) toast.error(t(`${ok}/${withMenu.length} marques publiées`, `${ok}/${withMenu.length} brands published`), errs.slice(0, 4).join('\n'));
    else toast.success(t(`${ok} marque(s) publiée(s) avec les heures`, `${ok} brand(s) published with the hours`));
  }

  if (!hours) return <div><PageHeader title={t('Magasins', 'Stores')} /><StoresTabs /><div className="h-96 animate-pulse rounded-lg bg-sunken" /></div>;
  const locWeek = hours.locations[loc];
  const brandWeek = hours.brands[brand];
  const year = new Date().getFullYear();
  return (
    <div>
      <PageHeader title={t('Magasins', 'Stores')} subtitle={t('Heures par succursale, exceptions par marque et jours fériés — envoyées à chaque plateforme avec le menu. Heure de Montréal.', 'Hours per location, brand exceptions and holidays — sent to every platform with the menu. Montréal time.')}
        right={editable && <><Button variant="primary" disabled={!dirty || problems.length > 0} loading={busy === 'save'} onClick={save}>{dirty ? t('Enregistrer', 'Save') : t('Enregistré', 'Saved')}</Button><Button variant="brand" loading={busy === 'publish'} onClick={publishAll} icon={<Send className="size-4" />}>{t('Publier sur les plateformes', 'Publish to platforms')}</Button></>} />
      <StoresTabs />
      {problems.length > 0 && <Banner tone="warn" className="mb-4">{problems.slice(0, 4).join(' · ')}</Banner>}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'locations', label: t('Succursales', 'Locations') }, { key: 'brands', label: t('Exceptions par marque', 'Brand exceptions') }, { key: 'holidays', label: t('Fériés et jours spéciaux', 'Holidays & special days'), count: hours.holidays.length }]} />

      {tab === 'locations' && (
        <Card>
          <CardHeader title={t('Heures de la succursale', 'Location hours')} right={<Select selectSize="sm" className="w-auto" value={loc} onChange={(e) => setLoc(e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)} — {weekSummary(hours.locations[l.code], lang)}</option>)}</Select>} />
          <div className="px-5 pb-5">
            {!locWeek ? (
              <div className="rounded-lg border border-dashed border-line-2 p-6 text-center">
                <p className="text-sm text-ink-3">{t('Pas d’heures pour cette succursale : un menu publié sans heures paraît ouvert 24/7 sur les plateformes.', 'No hours for this location: a menu published without hours shows open 24/7 on the platforms.')}</p>
                {editable && <Button className="mt-3" onClick={() => patch((h) => ({ ...h, locations: { ...h.locations, [loc]: fullWeek() } }))}>{t('Définir les heures', 'Set the hours')}</Button>}
              </div>
            ) : (
              <>
                <WeekEditor value={locWeek} disabled={!editable} onChange={(w) => patch((h) => ({ ...h, locations: { ...h.locations, [loc]: w } }))} />
                {editable && <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]"><span className="text-ink-3">{t('Copier vers :', 'Copy to:')}</span>{locations.filter((l) => l.code !== loc).map((l) => <Button key={l.code} size="xs" variant="soft" onClick={() => patch((h) => ({ ...h, locations: { ...h.locations, [l.code]: JSON.parse(JSON.stringify(locWeek)) } }))}>{shortLoc(l.name)}</Button>)}</div>}
              </>
            )}
          </div>
        </Card>
      )}

      {tab === 'brands' && (
        <Card>
          <CardHeader title={t('Exception par marque', 'Brand exception')} subtitle={t('Remplace les heures de la succursale pour cette marque partout (ex. marque déjeuner seulement).', 'Replaces the location hours for this brand everywhere (e.g. a breakfast-only brand).')}
            right={<Select selectSize="sm" className="w-auto" value={brand} onChange={(e) => setBrand(e.target.value)}>{brands.map((b) => <option key={b} value={b}>{b}{hours.brands[b] ? ` — ${t('heures propres', 'own hours')}` : ''}</option>)}</Select>} />
          <div className="px-5 pb-5">
            {!brandWeek
              ? editable && <Button onClick={() => patch((h) => ({ ...h, brands: { ...h.brands, [brand]: hours.locations[loc] ? JSON.parse(JSON.stringify(hours.locations[loc])) : fullWeek() } }))}>{t(`Donner des heures propres à ${brand}`, `Give ${brand} its own hours`)}</Button>
              : <><WeekEditor value={brandWeek} disabled={!editable} onChange={(w) => patch((h) => ({ ...h, brands: { ...h.brands, [brand]: w } }))} />{editable && <Button variant="ghost" className="mt-3" onClick={() => patch((h) => { const b = { ...h.brands }; delete b[brand]; return { ...h, brands: b }; })}>{t('Revenir aux heures de la succursale', 'Follow the location hours again')}</Button>}</>}
          </div>
        </Card>
      )}

      {tab === 'holidays' && (
        <Card>
          <CardHeader title={t('Fériés et jours spéciaux', 'Holidays & special days')} subtitle={t('Uber Eats et DoorDash les reçoivent à la publication. Skip n’a pas d’API : TAKATAK met Skip hors ligne pour la journée et le rouvre après minuit.', 'Uber Eats and DoorDash get them when you publish. Skip has no API: TAKATAK takes Skip offline for the day and reopens it after midnight.')}
            right={editable && <><Button size="sm" variant="outline" onClick={() => patch((h) => ({ ...h, holidays: [...h.holidays, ...QC(year).filter(([d]) => !h.holidays.some((x) => x.date === d)).map(([date, name]) => ({ id: `hol-${date}`, date, name, locationCodes: [], closed: true, slots: [] }))] }))} icon={<CalendarPlus className="size-4" />}>{t(`Fériés du Québec ${year}`, `Québec holidays ${year}`)}</Button><Button size="sm" onClick={() => patch((h) => ({ ...h, holidays: [...h.holidays, { id: `hol-${Date.now().toString(36)}`, date: '', name: t('Jour spécial', 'Special day'), locationCodes: [], closed: true, slots: [] }] }))}>{t('+ Ajouter', '+ Add')}</Button></>} />
          <div className="divide-y divide-line border-t border-line">
            {[...hours.holidays].sort((a, b) => a.date.localeCompare(b.date)).map((hol) => {
              const set = (p: Partial<Holiday>) => patch((h) => ({ ...h, holidays: h.holidays.map((x) => (x.id === hol.id ? { ...x, ...p } : x)) }));
              return (
                <div key={hol.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Input inputSize="sm" type="date" className="w-40" value={hol.date} disabled={!editable} onChange={(e) => set({ date: e.target.value })} />
                  <Input inputSize="sm" className="w-56" value={hol.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} />
                  <MultiPick label={t('Succursales', 'Locations')} options={locations.map((l) => [l.code, shortLoc(l.name)])} value={hol.locationCodes} onChange={(v) => set({ locationCodes: v })} />
                  <Checkbox checked={hol.closed} disabled={!editable} onChange={(c) => set({ closed: c, slots: c ? [] : [{ open: '12:00', close: '20:00' }] })} label={t('Fermé toute la journée', 'Closed all day')} />
                  {!hol.closed && (hol.slots ?? []).map((s, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <input type="time" className="h-8 rounded-md border border-line-2 px-2 text-sm" value={s.open} disabled={!editable} onChange={(e) => set({ slots: (hol.slots ?? []).map((x, j) => (j === i ? { ...x, open: e.target.value } : x)) })} />–
                      <input type="time" className="h-8 rounded-md border border-line-2 px-2 text-sm" value={s.close} disabled={!editable} onChange={(e) => set({ slots: (hol.slots ?? []).map((x, j) => (j === i ? { ...x, close: e.target.value } : x)) })} />
                    </span>
                  ))}
                  {hol.closed ? <Badge tone="stop">{t('fermé', 'closed')}</Badge> : <Badge tone="info">{t('heures spéciales', 'special hours')}</Badge>}
                  {editable && <button type="button" className="ml-auto rounded p-1.5 text-ink-4 hover:bg-sunken hover:text-stop" onClick={() => patch((h) => ({ ...h, holidays: h.holidays.filter((x) => x.id !== hol.id) }))} aria-label={t('Retirer', 'Remove')}><Trash2 className="size-4" /></button>}
                </div>
              );
            })}
            {hours.holidays.length === 0 && <div className="px-5 py-6 text-sm text-ink-3">{t('Aucun férié pour l’instant.', 'No holidays yet.')}</div>}
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-ink-4">{t('Les horaires par catégorie (déjeuner, midi) se règlent dans Menus.', 'Category schedules (breakfast, lunch) are set in Menus.')} {hours.updatedAt ? `${t('Dernier enregistrement', 'Last saved')} ${new Date(hours.updatedAt).toLocaleString()}` : ''}</p>
    </div>
  );
}
