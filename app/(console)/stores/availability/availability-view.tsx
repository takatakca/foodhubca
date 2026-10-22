'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Download, Flame, Lock, Plus, ShieldAlert, Tablet, Trash2 } from 'lucide-react';
import { Badge, PlatformTag, type Tone } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Checkbox, Chips, Input, Select, Switch } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SectionPicker } from '@/components/stores/section-picker';
import { statusDetailText } from '@/components/stores/status-detail';
import { useToast } from '@/components/ui/toast';
import { useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { StoresTabs } from '../stores-tabs';
import { api, ApiError, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { countEn, countFr } from '@/lib/ui/count-label';
import type { T } from '@/lib/i18n';
import type { AvailabilityBoard, ChannelRow, KitchenBoard, PausedBy } from '@/lib/foodhub/store-availability/board';
import type { BusyState, BusyWindow } from '@/lib/foodhub/store-availability/busy-schedule';
import type { GuardConfig, GuardState } from '@/lib/foodhub/store-availability/downtime-guard';
import type { HistoryResult, HistoryRow } from '@/lib/foodhub/store-availability/history';
import type { SpecialDayPreset } from '@/lib/foodhub/store-availability/special-days';
import type { ChannelKey, DayKey } from '@/lib/foodhub/types';

type Section = 'now' | 'busy' | 'guard' | 'special' | 'history';
const DAYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CHANNELS: ChannelKey[] = ['uber_eats', 'doordash', 'skip', 'tgtg'];
const CHANNEL_NAME: Record<string, string> = { uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'Skip', tgtg: 'Too Good To Go', clover_online: 'Clover Online Ordering' };

const dayShort = (t: T, d: DayKey) => ({ monday: t('Lun', 'Mon'), tuesday: t('Mar', 'Tue'), wednesday: t('Mer', 'Wed'), thursday: t('Jeu', 'Thu'), friday: t('Ven', 'Fri'), saturday: t('Sam', 'Sat'), sunday: t('Dim', 'Sun') })[d];
const pick = (t: T, b: { fr: string; en: string }) => t(b.fr, b.en);
/** The error in the viewer's language: the new routes answer { error, errorFr }. */
const errText = (t: T, e: unknown) => {
  if (e instanceof ApiError && typeof e.body.errorFr === 'string' && e.body.errorFr) return t(e.body.errorFr, e.message);
  return e instanceof Error ? e.message : String(e);
};
/** A labelled chip group: a screen reader announces "Days, Mon, pressed" rather than a bare "Mon". */
const Group = ({ label, className, children }: { label: string; className?: string; children: ReactNode }) => (
  <div role="group" aria-label={label} className={className}>{children}</div>
);
const cancelled = (e: unknown) => e instanceof ApiError && e.status === 499;

function stateText(t: T, s: ChannelRow['state']): { text: string; tone: Tone } {
  switch (s) {
    case 'online': return { text: t('En ligne', 'Online'), tone: 'go' };
    case 'paused': return { text: t('En pause', 'Paused'), tone: 'wait' };
    case 'closed': return { text: t('Fermé (heures)', 'Closed (hours)'), tone: 'neutral' };
    case 'deactivated': return { text: t('Désactivé', 'Deactivated'), tone: 'stop' };
    case 'manuel': return { text: t('À faire dans Clover', 'Do it in Clover'), tone: 'info' };
    default: return { text: t('Inconnu', 'Unknown'), tone: 'neutral' };
  }
}

function byText(t: T, by: PausedBy | null): string | null {
  if (!by) return null;
  return ({ TAKATAK: t('par TAKATAK', 'from TAKATAK'), plateforme: t('par la plateforme', 'by the platform'), garde: t('par la garde tablette', 'by the tablet guard'), horaire: t('par les heures', 'by the hours') } as Record<PausedBy, string>)[by];
}

/** A time in the hub's zone (from the API), not the device's: a phone set to another zone still reads Montréal time. */
function hubTime(iso: string, loc: string, tz?: string, withDate = false): string {
  if (!tz) return timeOf(iso, loc, withDate);
  return new Date(iso).toLocaleString(loc, { ...(withDate ? { dateStyle: 'short', timeStyle: 'short' } : { hour: '2-digit', minute: '2-digit' }), timeZone: tz } as Intl.DateTimeFormatOptions);
}

/** "à 16 h 30" today, "mar. 9 h" another day (both in the hub's zone). */
function whenText(iso: string, loc: string, tz?: string): string {
  const day = (d: Date) => d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : {});
  const d = new Date(iso);
  return day(d) === day(new Date()) ? hubTime(iso, loc, tz) : d.toLocaleString(loc, { weekday: 'short', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
}

/** "30 min", "1 h", "1 h 30" — the Québec way. */
const durationText = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);

export function AvailabilityView() {
  const { t } = useI18n();
  const { locations } = useViewer();
  const [section, setSection] = useState<Section>('now');
  const [kitchen, setKitchen] = useState<string>('');
  useEffect(() => { if (!kitchen && locations[0]) setKitchen(locations[0].code); }, [kitchen, locations]);

  const kitchenPicker = locations.length > 1 && (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-body font-semibold text-ink-2">{t('Cuisine', 'Kitchen')}</span>
      <Group label={t('Cuisine', 'Kitchen')}><Chips size="lg" value={kitchen} onChange={setKitchen} options={locations.map((l) => ({ value: l.code, label: shortLoc(l.name) }))} /></Group>
    </div>
  );

  return (
    <div>
      <PageHeader title={t('Restaurants', 'Restaurants')} tabs={<StoresTabs className="mb-0" />}
        subtitle={t('Qui est ouvert, en pause ou fermé sur chaque plateforme, et quand ça rouvre. Mode occupé à l’horaire, garde tablette éteinte, jours spéciaux et historique.', 'Who is open, paused or closed on each platform, and when it reopens. Busy mode by the clock, tablet-off guard, special days and history.')} />
      <SectionPicker className="mb-4" label={t('Afficher', 'Show')} value={section} onChange={setSection} options={[
        { key: 'now', label: t('Statut maintenant', 'Status now') },
        { key: 'busy', label: t('Calendrier occupé', 'Busy schedule') },
        { key: 'guard', label: t('Garde tablette éteinte', 'Tablet-off guard') },
        { key: 'special', label: t('Jours spéciaux', 'Special days') },
        { key: 'history', label: t('Historique', 'History') },
      ]} />
      {section === 'now' && <StatusNow />}
      {section === 'busy' && <>{kitchenPicker}{kitchen && <BusySchedule key={kitchen} code={kitchen} />}</>}
      {section === 'guard' && <>{kitchenPicker}{kitchen && <GuardSettings key={kitchen} code={kitchen} />}</>}
      {section === 'special' && <>{kitchenPicker}<SpecialDays kitchen={kitchen} /></>}
      {section === 'history' && <History />}
    </div>
  );
}

// ---------------------------------------------------------------- Statut maintenant

function StatusNow() {
  const { t } = useI18n();
  const [board, setBoard] = useState<AvailabilityBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { setBoard((await api<{ board: AvailabilityBoard }>('/api/foodhub/store-availability')).board); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);

  if (!board) return failed
    ? <Banner tone="stop">{t('Impossible de lire le statut pour l’instant : on réessaie toutes les 30 secondes.', 'Cannot read the status right now: it retries every 30 seconds.')}</Banner>
    : <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-48" />)}</div>;
  if (!board.kitchens.length) return <Card><EmptyState icon={<Tablet />} title={t('Aucune cuisine', 'No kitchen')} body={t('Les cuisines apparaissent ici dès qu’un magasin y est branché.', 'Kitchens show up here as soon as a store is connected to them.')} action={<ButtonLink href="/stores/mapping" variant="outline">{t('Brancher un magasin', 'Connect a store')}</ButtonLink>} /></Card>;
  return (
    <div className="space-y-5">
      <p className="text-body text-ink-3">{t('Pour mettre en pause ou rouvrir, utilisez', 'To pause or resume, use')} <Link href="/stores" className="font-semibold text-brand hover:underline">{t('Statut et pauses', 'Status & pauses')}</Link>.</p>
      {board.kitchens.map((k) => <KitchenCard key={k.code} k={k} tz={board.timeZone} />)}
    </div>
  );
}

function KitchenCard({ k, tz }: { k: KitchenBoard; tz?: string }) {
  const { t, loc } = useI18n();
  const tone: Tone = k.summary.kind === 'open' ? 'go' : k.summary.kind === 'paused' ? 'wait' : 'neutral';
  const tabletsOff = k.devices.total > 0 && k.devices.online === 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-heading text-ink">{shortLoc(k.name)}</h2>
          <div className="text-small text-ink-3">{pick(t, k.nextOpening.label)}</div>
        </div>
        <Badge tone={tone} className="text-body">{pick(t, k.summary.label)}</Badge>
        <Badge tone={tabletsOff ? 'stop' : k.devices.total ? 'go' : 'neutral'} icon={<Tablet className="size-3.5" />}>
          {k.devices.total ? t(`Tablettes ${k.devices.online}/${k.devices.total} en ligne`, `Tablets ${k.devices.online}/${k.devices.total} online`) : t('Aucune tablette', 'No tablet')}
        </Badge>
        {k.prep.isBusy && <Badge tone="stop" icon={<Flame className="size-3.5" />}>{t(`Occupé · ${k.prep.minutes} min`, `Busy · ${k.prep.minutes} min`)}</Badge>}
      </div>
      {!k.brands.length ? <EmptyState compact icon={<Tablet />} title={t('Aucun magasin branché dans cette cuisine', 'No store connected at this kitchen')} action={<ButtonLink href="/stores/mapping" variant="outline">{t('Brancher un magasin', 'Connect a store')}</ButtonLink>} /> : (
        <div className="divide-y divide-line">
          {k.brands.map((b) => (
            <div key={b.name} className="px-5 py-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3"><span className="text-body font-bold">{b.name}</span><span className="text-small text-ink-3">{pick(t, b.nextOpening.label)}</span></div>
              <div className="space-y-1.5">
                {b.channels.map((c, i) => {
                  const st = stateText(t, c.state);
                  const by = byText(t, c.by);
                  // Two stores of one brand on the same platform (e.g. two Too Good To Go stores) read « magasin 2 », not a twin row.
                  const twin = b.channels.filter((x) => x.channel === c.channel).length > 1 ? b.channels.slice(0, i + 1).filter((x) => x.channel === c.channel).length : 0;
                  const detail = c.state !== 'online' ? statusDetailText(t, c.detail) : null;
                  return (
                    <div key={c.storeId ?? `${b.name}-${c.channel}`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-raised px-3 py-2">
                      <span className="text-body flex w-48 items-center gap-2 font-semibold">{c.channel === 'clover_online' ? CHANNEL_NAME.clover_online : <PlatformTag channel={c.channel} />}{twin > 0 && <span className="text-small font-normal text-ink-3">{t(`magasin ${twin}`, `store ${twin}`)}</span>}</span>
                      <Badge tone={st.tone}>{st.text}</Badge>
                      {c.text && <span className="text-body font-semibold text-ink">{pick(t, c.text)}</span>}
                      {by && <span className={c.by === 'plateforme' || c.by === 'garde' ? 'text-small font-semibold text-wait-2' : 'text-small text-ink-3'}>{by}</span>}
                      {c.reopensAt && <span className="text-body font-semibold text-ink">{t('rouvre', 'reopens')} {whenText(c.reopensAt, loc, tz)}</span>}
                      {c.state === 'paused' && !c.reopensAt && <span className="text-small text-ink-3">{t('jusqu’à réouverture manuelle', 'until resumed by hand')}</span>}
                      {detail && <span className="truncate text-small text-ink-3">{detail}</span>}
                      {c.locked && <Badge tone="dark" icon={<Lock className="size-3" />} title={t('Jamais touché par les automatismes', 'Never touched by automations')}>{t('ne pas toucher', 'do not touch')}</Badge>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Calendrier occupé

type DraftWindow = Omit<BusyWindow, 'id'> & { id?: string };
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function BusySchedule({ code }: { code: string }) {
  const { t } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const editable = can('stores:toggle');
  const [windows, setWindows] = useState<DraftWindow[] | null>(null);
  const [state, setState] = useState<BusyState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ schedule: Record<string, BusyWindow[]>; state: Record<string, BusyState> }>('/api/foodhub/store-availability/busy-schedule')
      .then((r) => { setWindows(r.schedule[code] ?? []); setState(r.state[code] ?? null); })
      .catch(() => setWindows([]));
  }, [code]);

  const patch = (i: number, p: Partial<DraftWindow>) => setWindows((all) => (all ?? []).map((w, j) => (j === i ? { ...w, ...p } : w)));
  async function save() {
    if (!windows) return;
    setSaving(true); setError(null);
    try {
      const r = await api<{ windows: BusyWindow[] }>('/api/foodhub/store-availability/busy-schedule', { method: 'PUT', json: { locationCode: code, windows } });
      setWindows(r.windows);
      toast.success(t('Calendrier occupé enregistré', 'Busy schedule saved'));
    } catch (e) { if (!cancelled(e)) setError(errText(t, e)); } finally { setSaving(false); }
  }

  if (!windows) return <Skeleton className="h-64" />;
  return (
    <Card>
      <CardHeader icon={<Flame className="size-4" />} title={t('Calendrier occupé', 'Busy schedule')}
        subtitle={t('Le mode occupé s’active au début de la plage et s’arrête à la fin (temps normal + minutes en plus, aussi envoyé à Uber Eats). Si quelqu’un change le mode occupé pendant la plage, son choix l’emporte.', 'Busy mode turns on at the start of a window and off at its end (normal time + extra minutes, also sent to Uber Eats). If someone changes busy mode during the window, their choice wins.')} />
      <div className="space-y-4 px-5 pb-5">
        {state?.applied && !state.kept && <Banner tone="info">{t('Une plage est en cours : le mode occupé a été activé par le calendrier.', 'A window is running: busy mode was turned on by the schedule.')}</Banner>}
        {state?.kept && <Banner tone="warn" action={<ButtonLink href="/stores" variant="outline">{t('Statut et pauses', 'Status & pauses')}</ButtonLink>}>{t('La plage est finie, mais le mode occupé est resté activé : quelqu’un l’a changé pendant la plage. Arrêtez-le dans Statut et pauses quand le rush est passé.', 'The window is over, but busy mode stayed on: someone changed it during the window. Turn it off in Status & pauses once the rush is over.')}</Banner>}
        <WeekGrid windows={windows} />
        {windows.map((w, i) => (
          <div key={w.id ?? `new-${i}`} className="space-y-3 rounded-lg border border-line p-4">
            <Group label={t('Jours de la plage', 'Days of the window')}><Chips size="lg" disabled={!editable} value={w.days} onChange={(d) => editable && patch(i, { days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d] })} options={DAYS.map((d) => ({ value: d, label: dayShort(t, d) }))} /></Group>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-body font-semibold text-ink-2">{t('de', 'from')}<Input type="time" className="h-11 w-32 text-base" value={w.start} disabled={!editable} onChange={(e) => patch(i, { start: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-body font-semibold text-ink-2">{t('à', 'to')}<Input type="time" className="h-11 w-32 text-base" value={w.end} disabled={!editable} onChange={(e) => patch(i, { end: e.target.value })} /></label>
              {w.end && w.start && toMin(w.end) < toMin(w.start) && <span className="text-small text-ink-3">{t('finit le lendemain', 'ends the next day')}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body font-semibold text-ink-2">{t('Minutes en plus', 'Extra minutes')}</span>
              <Group label={t('Minutes en plus', 'Extra minutes')}><Chips disabled={!editable} value={w.extraMin} onChange={(m) => editable && patch(i, { extraMin: m })} options={[5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: `+${m}` }))} /></Group>
              <span className="flex-1" />
              {editable && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setWindows(windows.filter((_, j) => j !== i))}>{t('Retirer', 'Remove')}</Button>}
            </div>
          </div>
        ))}
        {!windows.length && <p className="text-body text-ink-3">{t('Aucune plage. Exemple : vendredi et samedi de 17 h à 20 h, +10 min.', 'No window. Example: Friday and Saturday 5 pm to 8 pm, +10 min.')}</p>}
        {error && <Banner tone="stop">{error}</Banner>}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" icon={<Plus className="size-4" />} onClick={() => setWindows([...windows, { days: ['friday', 'saturday'], start: '17:00', end: '20:00', extraMin: 10 }])}>{t('Ajouter une plage', 'Add a window')}</Button>
            <Button variant="brand" size="lg" loading={saving} onClick={save}>{t('Enregistrer', 'Save')}</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** One line per day, midnight to midnight, windows drawn on it (a night across midnight continues on the next day). */
function WeekGrid({ windows }: { windows: DraftWindow[] }) {
  const { t } = useI18n();
  const summary = windows.filter((w) => w.days.length && w.start && w.end).map((w) => `${w.days.map((d) => dayShort(t, d)).join(', ')} ${w.start}–${w.end} +${w.extraMin} min`).join(' ; ');
  const bars = useMemo(() => {
    const out: Record<DayKey, Array<[number, number]>> = Object.fromEntries(DAYS.map((d) => [d, []])) as unknown as Record<DayKey, Array<[number, number]>>;
    for (const w of windows) {
      if (!/^\d\d:\d\d$/.test(w.start) || !/^\d\d:\d\d$/.test(w.end)) continue;
      const a = toMin(w.start); const b = toMin(w.end);
      for (const d of w.days) {
        if (b > a) out[d].push([a, b]);
        else if (b < a) { out[d].push([a, 1440]); out[DAYS[(DAYS.indexOf(d) + 1) % 7]].push([0, b]); }
      }
    }
    return out;
  }, [windows]);
  return (
    <div className="space-y-1.5" role="img" aria-label={`${t('Semaine du calendrier occupé', 'Busy schedule week')} : ${summary || t('aucune plage', 'no window')}`}>
      {DAYS.map((d) => (
        <div key={d} className="flex items-center gap-2">
          <span className="w-10 text-small font-semibold text-ink-2">{dayShort(t, d)}</span>
          <div className="relative h-6 flex-1 rounded bg-sunken">
            {bars[d].map(([a, b], i) => <span key={i} className="absolute inset-y-0 rounded bg-stop" style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }} />)}
          </div>
        </div>
      ))}
      <div className="flex justify-between pl-12 text-micro text-ink-3"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>{t('minuit', 'midnight')}</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- Garde tablette éteinte

function GuardSettings({ code }: { code: string }) {
  const { t, loc } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const editable = can('stores:map');
  const [cfg, setCfg] = useState<GuardConfig | null>(null);
  const [state, setState] = useState<GuardState | null>(null);
  const [tz, setTz] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<{ guard: Record<string, GuardConfig>; state: Record<string, GuardState>; timeZone?: string }>('/api/foodhub/store-availability/guard')
      .then((r) => { setCfg(r.guard[code] ?? { enabled: false, graceMin: 5, pauseMin: 30, channels: [...CHANNELS] }); setState(r.state[code] ?? null); setTz(r.timeZone); })
      .catch(() => setCfg({ enabled: false, graceMin: 5, pauseMin: 30, channels: [...CHANNELS] }));
  }, [code]);

  async function save(next: GuardConfig) {
    setSaving(true);
    try {
      const r = await api<{ guard: GuardConfig }>('/api/foodhub/store-availability/guard', { method: 'PUT', json: { locationCode: code, config: next } });
      setCfg(r.guard);
      toast.success(r.guard.enabled ? t('Garde tablette activée', 'Tablet guard on') : t('Garde tablette arrêtée', 'Tablet guard off'));
    } catch (e) { if (!cancelled(e)) toast.error(errText(t, e)); } finally { setSaving(false); }
  }
  if (!cfg) return <Skeleton className="h-64" />;
  const set = (p: Partial<GuardConfig>) => setCfg({ ...cfg, ...p });
  return (
    <Card>
      <CardHeader icon={<ShieldAlert className="size-4" />} title={t('Garde tablette éteinte', 'Tablet-off guard')}
        subtitle={t('Si toutes les tablettes de la cuisine sont éteintes pendant les heures d’ouverture, les commandes arrivent sans que personne les voie.', 'If every kitchen tablet is off during opening hours, orders arrive and nobody sees them.')} />
      <div className="space-y-5 px-5 pb-5">
        <Banner tone="warn">{t('Attention : une fois activée, la garde met vos magasins en pause automatiquement, pour une durée limitée. Elle rouvre seulement ce qu’elle a mis en pause, dès qu’une tablette revient. Les magasins « ne pas toucher » ne sont jamais touchés.', 'Careful: once on, the guard pauses your stores automatically, for a limited time. It reopens only what it paused, as soon as a tablet is back. “Do not touch” stores are never touched.')}</Banner>
        <Switch checked={cfg.enabled} disabled={!editable} onChange={(v) => set({ enabled: v })} label={t('Activer la garde pour cette cuisine', 'Turn on the guard for this kitchen')} description={t('Éteinte par défaut.', 'Off by default.')} />
        <div><div className="mb-2 text-body font-semibold text-ink-2">{t('Tablettes éteintes depuis', 'Tablets off for')}</div>
          <Group label={t('Tablettes éteintes depuis', 'Tablets off for')}><Chips size="lg" disabled={!editable} value={cfg.graceMin} onChange={(v) => editable && set({ graceMin: v })} options={[3, 5, 10, 15, 30].map((m) => ({ value: m, label: `${m} min` }))} /></Group></div>
        <div><div className="mb-2 text-body font-semibold text-ink-2">{t('Durée de la pause (prolongée tant que les tablettes restent éteintes)', 'Pause length (extended while the tablets stay off)')}</div>
          <Group label={t('Durée de la pause', 'Pause length')}><Chips size="lg" disabled={!editable} value={cfg.pauseMin} onChange={(v) => editable && set({ pauseMin: v })} options={[15, 30, 60, 90, 120].map((m) => ({ value: m, label: durationText(m) }))} /></Group></div>
        <div><div className="mb-2 text-body font-semibold text-ink-2">{t('Plateformes à mettre en pause', 'Platforms to pause')}</div>
          <Group label={t('Plateformes à mettre en pause', 'Platforms to pause')}><Chips size="lg" disabled={!editable} value={cfg.channels} onChange={(c) => editable && set({ channels: cfg.channels.includes(c) ? cfg.channels.filter((x) => x !== c) : [...cfg.channels, c] })} options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_NAME[c] }))} /></Group></div>
        {state && state.storeIds.length > 0 && <Banner tone="info">{t(`La garde a ${countFr(state.storeIds.length, 'magasin')} en pause jusqu’à ${hubTime(new Date(state.untilMs).toISOString(), loc, tz)}.`, `The guard has ${countEn(state.storeIds.length, 'store')} paused until ${hubTime(new Date(state.untilMs).toISOString(), loc, tz)}.`)}</Banner>}
        {state && (state.blocked ?? 0) > 0 && <Banner tone="stop">{t(`${countFr(state.blocked, 'magasin')} non mis en pause : rien n’a été envoyé (la connexion à la plateforme est éteinte ou a refusé).`, `${countEn(state.blocked, 'store')} not paused: nothing was sent (the platform connection is off or refused).`)}</Banner>}
        {state && (state.failed ?? 0) > 0 && <Banner tone="stop">{t(`${countFr(state.failed, 'magasin')} non mis en pause : la plateforme a refusé ou n’a pas répondu. La garde réessaie toutes les ${cfg.pauseMin / 2} min.`, `${countEn(state.failed, 'store')} not paused: the platform refused or did not answer. The guard tries again every ${cfg.pauseMin / 2} min.`)}</Banner>}
        {editable && <Button variant="brand" size="lg" loading={saving} disabled={!cfg.channels.length} onClick={() => save(cfg)}>{t('Enregistrer', 'Save')}</Button>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Jours spéciaux

type PresetRow = SpecialDayPreset & { existing: Array<{ id: string; name: string; closed: boolean; locationCodes: string[] }> };

function SpecialDays({ kitchen }: { kitchen: string }) {
  const { t, loc } = useI18n();
  const { can, allLocations, locations } = useViewer();
  const toast = useToast();
  const editable = can('menu:edit');
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [presets, setPresets] = useState<PresetRow[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState('11:00');
  const [close, setClose] = useState('20:00');
  const [where, setWhere] = useState<'all' | 'one'>(allLocations ? 'all' : 'one');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ presets: PresetRow[] }>(`/api/foodhub/store-availability/special-days?year=${year}`).catch(() => null);
    setPresets(r?.presets ?? []);
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    setSaving(true); setDone(null);
    try {
      const codes = where === 'all' && allLocations ? [] : [kitchen || locations[0]?.code].filter(Boolean);
      const r = await api<{ added: Array<{ name: string }>; skipped: Array<{ id: string }> }>('/api/foodhub/store-availability/special-days', { method: 'POST', json: { ids: chosen, year, locationCodes: codes, ...(closed ? { closed: true } : { slots: [{ open, close }] }) } });
      setDone(t(`${countFr(r.added.length, 'jour ajouté', 'jours ajoutés')}${r.skipped.length ? `, ${countFr(r.skipped.length, 'déjà présent', 'déjà présents')}` : ''}.`, `${countEn(r.added.length, 'day')} added${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`));
      setChosen([]);
      await load();
    } catch (e) { if (!cancelled(e)) toast.error(errText(t, e)); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader icon={<CalendarDays className="size-4" />} title={t('Jours spéciaux', 'Special days')}
        subtitle={t('En plus des fériés du Québec (onglet Heures d’ouverture). Ils partent aux plateformes à la prochaine publication.', 'On top of the Québec holidays (Opening hours tab). They reach the platforms with the next publish.')}
        right={<Group label={t('Année', 'Year')}><Chips value={year} onChange={setYear} options={[thisYear, thisYear + 1].map((y) => ({ value: y, label: String(y) }))} /></Group>} />
      <div className="space-y-4 px-5 pb-5">
        {!presets ? <Skeleton className="h-48" /> : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {presets.map((p) => (
              <div key={p.id} className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2.5">
                <Checkbox checked={chosen.includes(p.id)} disabled={!editable} onChange={(v) => setChosen(v ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}
                  label={<span className="font-semibold">{t(p.nameFr, p.nameEn)}</span>} />
                <span className="text-body text-ink-2">{new Date(`${p.date}T12:00:00`).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                <span className="flex-1 text-small text-ink-3">{pick(t, p.suggestion)}</span>
                {p.existing.length > 0 && <Badge tone="go">{p.existing[0].closed ? t('déjà : fermé', 'already: closed') : t('déjà ajouté', 'already added')}</Badge>}
              </div>
            ))}
          </div>
        )}
        {editable && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Group label={t('Ce jour-là', 'That day')}><Chips size="lg" value={closed ? 'closed' : 'hours'} onChange={(v) => setClosed(v === 'closed')} options={[{ value: 'hours', label: t('Heures spéciales', 'Special hours') }, { value: 'closed', label: t('Fermé', 'Closed') }]} /></Group>
              {!closed && <>
                <Input type="time" className="h-11 w-32 text-base" value={open} onChange={(e) => setOpen(e.target.value)} aria-label={t('Ouverture', 'Opening')} />
                <span className="text-body text-ink-3">{t('à', 'to')}</span>
                <Input type="time" className="h-11 w-32 text-base" value={close} onChange={(e) => setClose(e.target.value)} aria-label={t('Fermeture', 'Closing')} />
              </>}
            </div>
            {closed && <p className="text-body text-ink-2">{t('Skip : mis hors ligne automatiquement ce jour-là (jusqu’à minuit), sans publication. Les autres plateformes reçoivent la fermeture à la prochaine publication.', 'Skip: taken offline automatically that day (until midnight), with no publish. The other platforms get the closure with the next publish.')}</p>}
            {allLocations && locations.length > 1 && (
              <Group label={t('Pour quelles cuisines', 'For which kitchens')}><Chips value={where} onChange={setWhere} options={[{ value: 'all', label: t('Toutes les cuisines', 'Every kitchen') }, { value: 'one', label: t(`Seulement ${shortLoc(locations.find((l) => l.code === kitchen)?.name ?? kitchen)}`, `Only ${shortLoc(locations.find((l) => l.code === kitchen)?.name ?? kitchen)}`) }]} /></Group>
            )}
            <Button variant="brand" size="lg" loading={saving} disabled={!chosen.length} onClick={add}>{t(chosen.length ? `Ajouter ${countFr(chosen.length, 'jour')}` : 'Ajouter', chosen.length ? `Add ${countEn(chosen.length, 'day')}` : 'Add')}</Button>
          </>
        )}
        {done && <Banner tone="go" action={<ButtonLink href="/stores/hours" variant="brand">{t('Publier sur les plateformes', 'Publish to platforms')}</ButtonLink>}>{done} {t('Publiez depuis Heures d’ouverture pour les envoyer aux plateformes.', 'Publish from Opening hours to send them to the platforms.')}</Banner>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Historique

const EVENT_TEXT: Record<string, [string, string]> = {
  pause: ['Pause', 'Pause'], resume: ['Reprise', 'Resume'], busy_on: ['Occupé activé', 'Busy on'], busy_off: ['Occupé arrêté', 'Busy off'],
  prep_time: ['Temps de préparation', 'Prep time'], holiday_closure: ['Fermeture fériée', 'Holiday closure'], holiday: ['Jour spécial ajouté', 'Special day added'],
  hours: ['Heures', 'Hours'], guard_pause: ['Pause par la garde', 'Guard pause'], guard_resume: ['Reprise par la garde', 'Guard resume'],
  reopen_failed: ['Réouverture échouée', 'Reopen failed'], busy_schedule: ['Calendrier occupé', 'Busy schedule'], busy_kept: ['Occupé resté activé', 'Busy left on'],
  platform_online: ['Plateforme : en ligne', 'Platform: online'], platform_paused: ['Plateforme : en pause', 'Platform: paused'], platform_closed: ['Plateforme : fermé', 'Platform: closed'],
  platform_deactivated: ['Plateforme : désactivé', 'Platform: deactivated'],
};
/** Names the automations write under (GUARD_ACTOR / BUSY_ACTOR in store-availability/common.ts), shown in the viewer's language. */
const ACTOR_TEXT: Record<string, [string, string]> = { 'Garde tablette': ['Garde tablette', 'Tablet guard'], 'Calendrier occupé': ['Calendrier occupé', 'Busy schedule'] };
const RESULT_TONE: Record<HistoryResult, Tone> = { ok: 'go', blocked: 'wait', failed: 'stop' };

function History() {
  const { t, loc } = useI18n();
  const { locations, locName } = useViewer();
  const [days, setDays] = useState(7);
  const [location, setLocation] = useState('');
  const [channel, setChannel] = useState('');
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [tz, setTz] = useState<string | undefined>();
  const query = useMemo(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (location) q.set('location', location);
    if (channel) q.set('channel', channel);
    return q.toString();
  }, [days, location, channel]);
  useEffect(() => {
    setRows(null);
    api<{ rows: HistoryRow[]; total: number; truncated?: boolean; timeZone?: string }>(`/api/foodhub/store-availability/history?${query}`).then((r) => { setRows(r.rows); setTotal(r.total); setTruncated(Boolean(r.truncated)); setTz(r.timeZone); }).catch(() => setRows([]));
  }, [query]);
  const resultText = (r: HistoryResult) => ({ ok: t('fait', 'done'), blocked: t('bloqué (non envoyé)', 'blocked (not sent)'), failed: t('échec', 'failed') })[r];

  return (
    <Card>
      <CardHeader title={t('Historique des statuts', 'Status history')} subtitle={t('Pauses, reprises, changements des plateformes, mode occupé, fériés et garde, avec la raison et le résultat.', 'Pauses, resumes, platform changes, busy mode, holidays and the guard, with the reason and the result.')}
        right={<a className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-2 px-4 text-body font-semibold text-ink hover:bg-raised" href={`/api/foodhub/store-availability/history?${query}&format=csv`}><Download className="size-4" />CSV</a>} />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-4">
        <Group label={t('Période', 'Period')}><Chips value={days} onChange={setDays} options={[{ value: 1, label: t('1 jour', '1 day') }, { value: 7, label: t('7 jours', '7 days') }, { value: 30, label: t('30 jours', '30 days') }, { value: 90, label: t('90 jours', '90 days') }]} /></Group>
        {locations.length > 1 && <Select value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('Cuisine', 'Kitchen')}><option value="">{t('Toutes les cuisines', 'Every kitchen')}</option>{locations.map((l) => <option key={l.code} value={l.code}>{shortLoc(l.name)}</option>)}</Select>}
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t('Plateforme', 'Platform')}><option value="">{t('Toutes les plateformes', 'Every platform')}</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_NAME[c]}</option>)}</Select>
      </div>
      {!rows ? <div className="px-5 pb-5"><Skeleton className="h-40" /></div> : !rows.length ? <EmptyState title={t('Rien sur cette période', 'Nothing in this period')} /> : (
        <Table>
          <thead><tr><Th>{t('Quand', 'When')}</Th><Th>{t('Cuisine', 'Kitchen')}</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Événement', 'Event')}</Th><Th>{t('Jusqu’à', 'Until')}</Th><Th>{t('Raison', 'Reason')}</Th><Th>{t('Par', 'By')}</Th><Th>{t('Résultat', 'Result')}</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const ev = EVENT_TEXT[r.event];
              return (
                <Tr key={`${r.at}-${i}`}>
                  <Td className="whitespace-nowrap">{hubTime(r.at, loc, tz, true)}</Td>
                  <Td>{r.kitchen ? shortLoc(locName(r.kitchen)) : t('toutes', 'all')}</Td>
                  <Td>{r.brand ?? '—'}</Td>
                  <Td>{r.channel ? CHANNEL_NAME[r.channel] : '—'}</Td>
                  <Td className="font-semibold" title={ev ? undefined : r.event}>{ev ? t(ev[0], ev[1]) : t('Autre', 'Other')}</Td>
                  <Td className="whitespace-nowrap">{r.until ? hubTime(r.until, loc, tz, true) : '—'}</Td>
                  <Td className="max-w-56 truncate" title={r.summary}>{r.reason ?? '—'}</Td>
                  <Td>{ACTOR_TEXT[r.by] ? t(ACTOR_TEXT[r.by][0], ACTOR_TEXT[r.by][1]) : r.by}</Td>
                  <Td><Badge tone={RESULT_TONE[r.result]}>{resultText(r.result)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {rows && total > rows.length && !truncated && <p className="px-5 py-3 text-small text-ink-3">{t(`${rows.length} lignes affichées sur ${total} : le CSV les contient toutes.`, `${rows.length} of ${total} lines shown: the CSV has them all.`)}</p>}
      {rows && truncated && <div className="px-5 py-3"><Banner tone="warn">{t('Limité aux 5000 derniers événements : les plus anciens de la période manquent, ici et dans le CSV. Réduisez la période ou choisissez une cuisine.', 'Limited to the latest 5000 events: the oldest of the period are missing, here and in the CSV. Narrow the period or pick a kitchen.')}</Banner></div>}
    </Card>
  );
}
