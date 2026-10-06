'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Send, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/form';
import { DraftRestoredBanner, SaveChip } from '@/components/ui/save-chip';
import { Hint } from '@/components/help/hint';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { fullWeek, WeekEditor, weekProblems, weekSummary, type Slot, type Week } from '@/components/ui/week-editor';
import { MultiPick } from '@/components/ui/filter-bar';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { api, ApiError } from '@/lib/ui/api';
import { useAutosave } from '@/lib/ui/use-autosave';
import { useUndo } from '@/lib/ui/use-undo';
import { useI18n } from '@/lib/i18n/client';

type Holiday = { id: string; date: string; name: string; locationCodes: string[]; closed: boolean; slots?: Slot[] };
type Hours = { locations: Record<string, Week>; brands: Record<string, Week>; holidays: Holiday[] };
const editableOf = (h: Hours & { updatedAt?: string }): Hours => ({ locations: h.locations ?? {}, brands: h.brands ?? {}, holidays: h.holidays ?? [] });
const QC = (y: number): Array<[string, string]> => [[`${y}-01-01`, 'Jour de l’An'], [`${y}-06-24`, 'Fête nationale du Québec'], [`${y}-07-01`, 'Fête du Canada'], [`${y}-12-25`, 'Noël']];

export default function HoursPage() {
  const { t, lang } = useI18n();
  const { viewer, locations, brands, can } = useViewer();
  const toast = useToast();
  const editable = can('menu:edit');
  const [hours, setHours] = useState<Hours | null>(null);
  const [tab, setTab] = useState<'locations' | 'brands' | 'holidays'>('locations');
  const [loc, setLoc] = useState(locations[0]?.code ?? '');
  const [brand, setBrand] = useState(brands[0] ?? '');
  const [busy, setBusy] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const validate = useCallback((h: Hours) => [
    ...Object.entries(h.locations).flatMap(([k, w]) => weekProblems(w).map((p) => `${k} — ${p}`)),
    ...Object.entries(h.brands).flatMap(([k, w]) => weekProblems(w).map((p) => `${k} — ${p}`)),
    ...h.holidays.filter((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.date)).map((x) => `${x.name || t('Jour spécial', 'Special day')}: ${t('choisissez la date', 'pick the date')}`),
  ], [t]);
  // Autosave: no Save button; every change is kept on this screen at once and saved 1.2 s later.
  const autosave = useAutosave<Hours>({
    formKey: 'hours', user: viewer.username, value: hours, enabled: editable, validate,
    save: async (h) => { const d = await api<{ hours: Hours & { updatedAt?: string } }>('/api/foodhub/hours', { method: 'PUT', json: { hours: h } }); setUpdatedAt(d.hours.updatedAt ?? new Date().toISOString()); },
    onRestore: (draft) => setHours(draft),
  });
  const undo = useUndo<Hours>(hours, (h) => setHours(h), { enabled: editable });
  const { markLoaded } = autosave;
  const resetUndo = undo.reset;
  const load = useCallback(() => api<{ hours: Hours & { updatedAt?: string } }>('/api/foodhub/hours').then((d) => {
    const h = editableOf(d.hours);
    setHours(h); setUpdatedAt(d.hours.updatedAt ?? null); markLoaded(h); resetUndo();
  }).catch((e) => toast.error(e.message)), [toast, markLoaded, resetUndo]);
  useEffect(() => { load(); }, [load]);
  const patch = (fn: (h: Hours) => Hours) => setHours((h) => (h ? fn(h) : h));
  const problems = autosave.problems;

  /** Removal applied at once, with 6 s to take it back (no "are you sure?" question). */
  function removeHoliday(hol: Holiday) {
    const index = hours?.holidays.findIndex((x) => x.id === hol.id) ?? -1;
    patch((h) => ({ ...h, holidays: h.holidays.filter((x) => x.id !== hol.id) }));
    toast.undo(t(`« ${hol.name || hol.date} » retiré`, `“${hol.name || hol.date}” removed`), () => patch((h) => (h.holidays.some((x) => x.id === hol.id) ? h : { ...h, holidays: [...h.holidays.slice(0, Math.max(0, index)), hol, ...h.holidays.slice(Math.max(0, index))] })));
  }
  function removeBrandHours(b: string) {
    const week = hours?.brands[b];
    patch((h) => { const next = { ...h.brands }; delete next[b]; return { ...h, brands: next }; });
    if (week) toast.undo(t(`${b} suit de nouveau les heures de la succursale`, `${b} follows the location hours again`), () => patch((h) => ({ ...h, brands: { ...h.brands, [b]: week } })));
  }

  async function publishAll() {
    // Never publish a stale document: send what is pending first.
    if (!(await autosave.saveNow())) { toast.warn(t('Corrigez les heures avant de publier', 'Fix the hours before publishing'), autosave.problems[0] ?? autosave.error ?? undefined); return; }
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
        right={editable && <><SaveChip autosave={autosave} undo={undo} /><Hint id="hours.publish"><Button variant="brand" size="lg" loading={busy === 'publish'} onClick={publishAll} icon={<Send className="size-4" />}>{t('Publier sur les plateformes', 'Publish to platforms')}</Button></Hint></>} />
      <StoresTabs />
      {autosave.draftRestored && <DraftRestoredBanner onDiscard={autosave.discardDraft} />}
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
                <Hint id="hours.week"><div><WeekEditor value={locWeek} disabled={!editable} onChange={(w) => patch((h) => ({ ...h, locations: { ...h.locations, [loc]: w } }))} /></div></Hint>
                {editable && <Hint id="hours.copy"><div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]"><span className="text-ink-3">{t('Copier vers :', 'Copy to:')}</span>{locations.filter((l) => l.code !== loc).map((l) => <Button key={l.code} size="sm" variant="soft" onClick={() => { patch((h) => ({ ...h, locations: { ...h.locations, [l.code]: JSON.parse(JSON.stringify(locWeek)) } })); toast.undo(t(`Heures copiées vers ${shortLoc(l.name)}`, `Hours copied to ${shortLoc(l.name)}`), undo.undo); }}>{shortLoc(l.name)}</Button>)}</div></Hint>}
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
              : <><WeekEditor value={brandWeek} disabled={!editable} onChange={(w) => patch((h) => ({ ...h, brands: { ...h.brands, [brand]: w } }))} />{editable && <Button variant="ghost" className="mt-3" onClick={() => removeBrandHours(brand)}>{t('Revenir aux heures de la succursale', 'Follow the location hours again')}</Button>}</>}
          </div>
        </Card>
      )}

      {tab === 'holidays' && (
        <Hint id="hours.holidays"><Card>
          <CardHeader title={t('Fériés et jours spéciaux', 'Holidays & special days')} subtitle={t('Uber Eats et DoorDash les reçoivent à la publication. Skip n’a pas d’API : TAKATAK met Skip hors ligne pour la journée et le rouvre après minuit.', 'Uber Eats and DoorDash get them when you publish. Skip has no API: TAKATAK takes Skip offline for the day and reopens it after midnight.')}
            right={editable && <><Button size="sm" variant="outline" onClick={() => patch((h) => ({ ...h, holidays: [...h.holidays, ...QC(year).filter(([d]) => !h.holidays.some((x) => x.date === d)).map(([date, name]) => ({ id: `hol-${date}`, date, name, locationCodes: [], closed: true, slots: [] }))] }))} icon={<CalendarPlus className="size-4" />}>{t(`Fériés du Québec ${year}`, `Québec holidays ${year}`)}</Button><Button size="sm" onClick={() => patch((h) => ({ ...h, holidays: [...h.holidays, { id: `hol-${Date.now().toString(36)}`, date: new Date().toISOString().slice(0, 10), name: t('Jour spécial', 'Special day'), locationCodes: [], closed: true, slots: [] }] }))}>{t('+ Ajouter', '+ Add')}</Button></>} />
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
                  {editable && <button type="button" className="ml-auto rounded p-1.5 text-ink-4 hover:bg-sunken hover:text-stop" onClick={() => removeHoliday(hol)} aria-label={t('Retirer', 'Remove')}><Trash2 className="size-4" /></button>}
                </div>
              );
            })}
            {hours.holidays.length === 0 && <div className="px-5 py-6 text-sm text-ink-3">{t('Aucun férié pour l’instant.', 'No holidays yet.')}</div>}
          </div>
        </Card></Hint>
      )}
      <p className="mt-4 text-xs text-ink-4">{t('Les horaires par catégorie (déjeuner, midi) se règlent dans Menus.', 'Category schedules (breakfast, lunch) are set in Menus.')} {updatedAt ? `${t('Dernier enregistrement', 'Last saved')} ${new Date(updatedAt).toLocaleString()}` : ''}</p>
    </div>
  );
}
