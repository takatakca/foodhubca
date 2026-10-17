'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { FilterBar } from '@/components/ui/filter-bar';
import { ChartCard, fmtInt, fmtMoney, HBars, StatTile } from '@/components/charts/charts';
import { usePulse } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { api, ApiError } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { OpsGoals, OpsMetric, OpsMetricKey, OpsQuality, OpsRow, OpsStatus } from '@/lib/foodhub/ops-quality';

const METRICS: OpsMetricKey[] = ['missingIncorrect', 'lateReady', 'avoidableCancel', 'downtime'];
const GOAL_FIELDS: Array<keyof OpsGoals> = ['missingIncorrectPct', 'lateReadyPct', 'avoidableCancelPct', 'downtimePct', 'lateGraceMin'];

export default function OperationsQualityPage() {
  const { t, lang } = useI18n();
  const { locations, brands, can } = useViewer();
  const { scope, brands: brandScope } = usePulse();
  const { filters, set, query } = useFilters('30d', scope, brandScope);
  const [data, setData] = useState<OpsQuality | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<OpsQuality>(`/api/foodhub/ops-quality?${query}`).then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => alive && setError(e instanceof ApiError && e.status === 400 ? 'bad_range' : e instanceof Error ? e.message : String(e))).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [query, reload]);

  const pctTxt = (n: number) => (lang === 'fr' ? `${n.toLocaleString('fr-CA')} %` : `${n}%`);
  // Changes are in percentage points (1.00 % → 3.00 % is +2 pts, not +200 %).
  const ptsTxt = (n: number) => (lang === 'fr' ? `${n.toLocaleString('fr-CA')} ${n < 2 ? 'pt' : 'pts'}` : `${n} ${n === 1 ? 'pt' : 'pts'}`);
  const rowLabel = (level: OpsRow['level'], key: string, label: string) => (key !== 'unmapped' ? label
    : level === 'location' ? t('Succursale non associée', 'Unmapped location') : level === 'brand' ? t('Marque non associée', 'Unmapped brand') : t('Magasin non associé', 'Unmapped store'));
  const storeLabel = (storeId: string, label: string) => rowLabel('store', storeId, label);
  const grace = data?.goals.lateGraceMin ?? 5;
  const LABEL: Record<OpsMetricKey, string> = {
    missingIncorrect: t('Commandes incomplètes ou erronées', 'Missing or incorrect orders'),
    lateReady: t('Commandes prêtes en retard', 'Orders ready late'),
    avoidableCancel: t('Annulations évitables', 'Avoidable cancellations'),
    downtime: t('Temps hors ligne', 'Downtime'),
  };
  const DEF: Record<OpsMetricKey, string> = {
    missingIncorrect: t('Commandes livrées ou ramassées avec un article manquant signalé par la cuisine ou des frais d’erreur facturés par la plateforme.', 'Delivered or picked-up orders with a missing item reported by the kitchen or an error charge billed by the platform.'),
    lateReady: t(`Prêtes plus de ${grace} min après l’heure promise.`, `Marked ready more than ${grace} min after the promised time.`),
    avoidableCancel: t('Annulées par le restaurant ou à cause de la caisse ou de la tablette.', 'Cancelled by the restaurant or because of the POS or tablet.'),
    downtime: t('Part des heures d’ouverture où le magasin était en pause, fermé ou désactivé.', 'Share of opening hours the store was paused, closed or deactivated.'),
  };
  const DOWN_CAUSE: Record<string, string> = {
    paused_by_staff: t('Pause par l’équipe', 'Paused by staff'), paused_auto: t('Pause automatique', 'Automatic pause'), platform_paused: t('Pause par la plateforme', 'Paused by the platform'),
    deactivated: t('Désactivé par la plateforme', 'Deactivated by the platform'), closed_on_platform: t('Fermé sur la plateforme', 'Closed on the platform'), unknown: t('Raison inconnue', 'Reason unknown'),
  };
  const CANCEL_CAUSE: Record<string, string> = { store: t('Restaurant', 'Restaurant'), pos: t('Caisse ou tablette', 'POS or tablet'), platform: t('Plateforme', 'Platform'), customer: t('Client', 'Customer'), unknown: t('Non précisé', 'Not reported') };
  const MISSING_CAUSE: Record<string, string> = { reported_by_kitchen: t('Signalé par la cuisine', 'Reported by the kitchen'), error_charge: t('Frais d’erreur', 'Error charge') };
  const NOTE: Record<string, string> = {
    no_hours_for_some_stores: t('Ajoutez les heures d’ouverture pour mesurer le temps hors ligne.', 'Add opening hours to measure downtime.'),
    no_statements_imported: t('Importez les relevés de paiement pour compter les frais d’erreur.', 'Import payout statements to count error charges.'),
    relay_stores_no_status: t('Les magasins reçus par le relais de commandes n’envoient pas leur statut : leur temps hors ligne n’est pas mesuré.', 'Stores reached through the order relay send no status: their downtime is not measured.'),
    statements_truncated: t('Trop de lignes de relevés de paiement pour cette période : des frais d’erreur peuvent manquer. Choisissez une période plus courte.', 'Too many payout statement lines for this period: some error charges may be missing. Pick a shorter period.'),
    direct_orders_not_included: t('Les commandes directes (téléphone, site web, Clover) ne sont pas encore incluses.', 'Direct orders (phone, website, Clover) are not included yet.'),
  };
  const STATUS: Record<OpsStatus, string> = { attention: t('À surveiller', 'Needs attention'), on_track: t('Dans les objectifs', 'On track'), no_data: t('Pas assez de données', 'Not enough data') };
  const causeLabel = (k: OpsMetricKey, c?: string) => (!c ? '' : k === 'downtime' ? DOWN_CAUSE[c] ?? c : k === 'avoidableCancel' ? CANCEL_CAUSE[c] ?? c : MISSING_CAUSE[c] ?? c);
  const countTxt = (k: OpsMetricKey, m: { numerator: number; denominator: number }) => (k === 'downtime'
    ? t(`${fmtInt(m.numerator)} min hors ligne sur ${fmtInt(m.denominator)} min ouvertes`, `${fmtInt(m.numerator)} min offline of ${fmtInt(m.denominator)} open min`)
    : t(`${fmtInt(m.numerator)} sur ${fmtInt(m.denominator)} commandes`, `${fmtInt(m.numerator)} of ${fmtInt(m.denominator)} orders`));

  const extraLine = (k: OpsMetricKey, m: OpsMetric): string => {
    const e = m.extra as Record<string, any>;
    if (k === 'missingIncorrect') return t(`${e.reportedByKitchen} signalées par la cuisine · ${e.errorCharged} avec frais d’erreur (${fmtMoney(e.errorChargeAmount)})`, `${e.reportedByKitchen} reported by the kitchen · ${e.errorCharged} with an error charge (${fmtMoney(e.errorChargeAmount)})`);
    if (k === 'lateReady') return [t(`${pctTxt(e.notMarkedReadyPct)} jamais marquées prêtes`, `${e.notMarkedReadyPct}% never marked ready`), e.avgMinutesLate ? t(`retard moyen ${e.avgMinutesLate} min`, `average ${e.avgMinutesLate} min late`) : ''].filter(Boolean).join(' · ');
    if (k === 'avoidableCancel') {
      const by = Object.entries(e.byCause as Record<string, number>).filter(([, n]) => n > 0).map(([c, n]) => t(`${CANCEL_CAUSE[c] ?? c} : ${n}`, `${CANCEL_CAUSE[c] ?? c}: ${n}`)).join(' · ');
      return [by, e.lostSales ? t(`ventes perdues ${fmtMoney(e.lostSales)}`, `lost sales ${fmtMoney(e.lostSales)}`) : ''].filter(Boolean).join(' · ');
    }
    return Object.entries(e.byCause as Record<string, number>).filter(([, n]) => n > 0).map(([c, n]) => t(`${DOWN_CAUSE[c] ?? c} : ${fmtInt(n)} min`, `${DOWN_CAUSE[c] ?? c}: ${fmtInt(n)} min`)).join(' · ');
  };

  // Change vs the previous period, in points; up is bad for all four metrics. Hidden when that period had too little data.
  const deltaLine = (m: OpsMetric) => {
    if (m.previous === null) return <p className="mt-2 text-xs text-ink-3">{t('Pas assez de données sur la période précédente pour comparer.', 'Not enough data in the previous period to compare.')}</p>;
    const d = m.changePts;
    const tone = d > 0 ? 'text-stop-2' : d < 0 ? 'text-go-2' : 'text-ink-2';
    return (
      <p className={`mt-2 text-[13px] font-bold ${tone}`}>
        {d > 0 ? '▲ +' : d < 0 ? '▼ −' : '■ '}{ptsTxt(Math.abs(d))}{' '}
        <span className="font-normal text-ink-3">{t(`par rapport à ${pctTxt(m.previous)} sur la période précédente`, `vs ${m.previous}% in the previous period`)}</span>
      </p>
    );
  };

  const metricCard = (k: OpsMetricKey) => {
    const m = data!.overall[k];
    const rows = data!.byStore.filter((r) => r.metrics[k].denominator > 0 || r.metrics[k].status !== 'no_data');
    return (
      <ChartCard key={k} title={LABEL[k]} subtitle={DEF[k]} loading={loading}
        table={{ columns: [t('Magasin', 'Store'), '%', t('Compté', 'Counted'), t('Sur', 'Out of'), t('Objectif', 'Goal'), t('Statut', 'Status')], rows: rows.map((r) => [rowLabel('store', r.key, r.label), pctTxt(r.metrics[k].value), r.metrics[k].numerator, r.metrics[k].denominator, pctTxt(r.metrics[k].goal), STATUS[r.metrics[k].status]]), filename: `takatak-ops-${k}` }}>
        <StatTile label={t(`Objectif : ${pctTxt(m.goal)} ou moins`, `Goal: ${m.goal}% or less`)} value={pctTxt(m.value)} note={countTxt(k, m)} />
        {deltaLine(m)}
        {extraLine(k, m) && <p className="mt-3 text-xs text-ink-3">{extraLine(k, m)}</p>}
        <div className="mt-4 text-[13px] font-semibold text-ink-2">{t('Les 5 magasins les plus touchés', 'The 5 most affected stores')}</div>
        <div className="mt-2"><HBars rows={data!.top5[k].map((r) => ({ label: storeLabel(r.storeId, r.label), value: r.value, detail: countTxt(k, r) }))} format={pctTxt} empty={t('Aucun magasin avec assez de données.', 'No store with enough data.')} /></div>
      </ChartCard>
    );
  };

  const groupCard = (title: string, rows: OpsRow[], name: string) => (
    <ChartCard title={title} loading={loading}
      table={{ columns: [title, ...METRICS.map((k) => LABEL[k])], rows: rows.map((r) => [rowLabel(r.level, r.key, r.label), ...METRICS.map((k) => (r.metrics[k].status === 'no_data' ? '—' : pctTxt(r.metrics[k].value)))]), filename: `takatak-ops-${name}` }}>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="px-2 py-1.5 text-left text-xs font-semibold text-ink-3">{title}</th>{METRICS.map((k) => <th key={k} className="px-2 py-1.5 text-right text-xs font-semibold text-ink-3">{LABEL[k]}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="px-2 py-1.5">{rowLabel(r.level, r.key, r.label)}</td>
                {METRICS.map((k) => { const m = r.metrics[k]; return <td key={k} className={`num px-2 py-1.5 text-right ${m.status === 'attention' ? 'font-bold text-stop-2' : m.status === 'on_track' ? 'text-go-2' : 'text-ink-3'}`}>{m.status === 'no_data' ? '—' : pctTxt(m.value)}</td>; })}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-ink-3">{t('Aucune donnée.', 'No data.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );

  const section = (status: OpsStatus) => {
    const keys = METRICS.filter((k) => data!.overall[k].status === status);
    const attention = status === 'attention' ? data!.attention : [];
    if (!keys.length && !attention.length) return null;
    return (
      <section className="mb-6">
        <h2 className="mb-3 text-[17px] font-bold text-ink">{STATUS[status]}</h2>
        {attention.length > 0 && (
          <ChartCard className="mb-5" title={t('Magasins à corriger en premier', 'Stores to fix first')} subtitle={t('Le plus loin de l’objectif en premier', 'Furthest from the goal first')} loading={loading}
            table={{ columns: [t('Magasin', 'Store'), t('Mesure', 'Metric'), '%', t('Objectif', 'Goal'), t('Compté', 'Counted'), t('Sur', 'Out of'), t('Cause', 'Cause')], rows: attention.map((a) => [storeLabel(a.storeId, a.label), LABEL[a.metric], pctTxt(a.value), pctTxt(a.goal), a.numerator, a.denominator, causeLabel(a.metric, a.cause)]), filename: 'takatak-ops-attention' }}>
            <HBars rows={attention.map((a) => ({ label: `${storeLabel(a.storeId, a.label)} · ${LABEL[a.metric]}`, value: a.value, detail: [t(`objectif ${pctTxt(a.goal)}`, `goal ${a.goal}%`), causeLabel(a.metric, a.cause)].filter(Boolean).join(' · ') }))} format={pctTxt} />
          </ChartCard>
        )}
        {keys.length > 0 && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{keys.map(metricCard)}</div>}
      </section>
    );
  };

  const noOrders = data ? data.overall.avoidableCancel.denominator === 0 : false;
  return (
    <div>
      <PageHeader title={t('Qualité des opérations', 'Operations quality')} subtitle={t('Toutes vos plateformes au même endroit, comparées à vos objectifs.', 'All your platforms in one place, compared with your goals.')} />
      <InsightsTabs />
      <FilterBar filters={filters} set={set} locations={locations} brands={brands} />
      {error && <Banner tone="stop" className="mb-4">{error === 'bad_range' ? t('Période invalide : la date de fin doit suivre la date de début.', 'Invalid period: the end date must come after the start date.') : error}</Banner>}
      {!data && !error && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse rounded-lg bg-sunken" />)}</div>}
      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          {data.notes.map((n) => <Banner key={n} tone="info" className="mb-3">{NOTE[n] ?? n}</Banner>)}
          {data.range.truncated && <Banner tone="warn" className="mb-3">{t('Période très chargée : seules les lignes les plus récentes sont comptées. Choisissez une période plus courte.', 'Very busy period: only the newest rows are counted. Pick a shorter period.')}</Banner>}
          {noOrders && <Card className="mb-5"><EmptyState icon={<ClipboardList className="size-6" />} title={t('Aucune commande pour cette période.', 'No orders in this period.')} /></Card>}
          {section('attention')}
          {section('on_track')}
          {section('no_data')}
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {groupCard(t('Par plateforme', 'By platform'), data.byChannel, 'platform')}
            {groupCard(t('Par succursale', 'By location'), data.byLocation, 'location')}
          </div>
          <div className="mb-5">{groupCard(t('Par marque', 'By brand'), data.byBrand, 'brand')}</div>
          {can('admin') && <GoalsForm goals={data.goals} onSaved={() => setReload((n) => n + 1)} />}
        </div>
      )}
    </div>
  );
}

function GoalsForm({ goals, onSaved }: { goals: OpsGoals; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<keyof OpsGoals, string>>(() => Object.fromEntries(GOAL_FIELDS.map((k) => [k, String(goals[k])])) as Record<keyof OpsGoals, string>);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'go' | 'stop'; text: string } | null>(null);
  // Reset only when the saved values change, not on every refetch (a new `goals` object): half-typed edits survive a filter change.
  const saved = GOAL_FIELDS.map((k) => goals[k]).join('|');
  useEffect(() => { setForm(Object.fromEntries(saved.split('|').map((v, i) => [GOAL_FIELDS[i], v])) as Record<keyof OpsGoals, string>); }, [saved]);
  if (hidden) return null;
  const LABELS: Record<keyof OpsGoals, string> = {
    missingIncorrectPct: t('Commandes incomplètes ou erronées (%)', 'Missing or incorrect orders (%)'),
    lateReadyPct: t('Commandes prêtes en retard (%)', 'Orders ready late (%)'),
    avoidableCancelPct: t('Annulations évitables (%)', 'Avoidable cancellations (%)'),
    downtimePct: t('Temps hors ligne (%)', 'Downtime (%)'),
    lateGraceMin: t('Délai de grâce avant « en retard » (min)', 'Grace before “late” (min)'),
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const body = Object.fromEntries(GOAL_FIELDS.map((k) => [k, Number(form[k].trim().replace(',', '.'))])) as Record<keyof OpsGoals, number>;
    // Checked here first so the message is in the reader's language (the server's 400 text is technical English).
    const badPct = GOAL_FIELDS.some((k) => k !== 'lateGraceMin' && (form[k].trim() === '' || !Number.isFinite(body[k]) || body[k] < 0 || body[k] > 100));
    if (badPct) { setMsg({ tone: 'stop', text: t('Entrez un pourcentage entre 0 et 100.', 'Enter a percentage from 0 to 100.') }); return; }
    const g = body.lateGraceMin;
    if (form.lateGraceMin.trim() === '' || !Number.isInteger(g) || g < 0 || g > 60) { setMsg({ tone: 'stop', text: t('Entrez un nombre entier de minutes entre 0 et 60.', 'Enter whole minutes from 0 to 60.') }); return; }
    setSaving(true);
    try {
      await api('/api/foodhub/ops-quality/goals', { method: 'PUT', json: body });
      setMsg({ tone: 'go', text: t('Objectifs enregistrés.', 'Goals saved.') });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) { setHidden(true); return; }
      setMsg({ tone: 'stop', text: t('Impossible d’enregistrer les objectifs.', 'Could not save the goals.') });
    } finally { setSaving(false); }
  };
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-bold text-ink">{t('Vos objectifs', 'Your goals')}</h2>
      <p className="mt-0.5 text-[13px] text-ink-3">{t('Le maximum que vous acceptez pour chaque mesure. Seul le propriétaire peut les changer.', 'The most you accept for each metric. Only the owner can change them.')}</p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {GOAL_FIELDS.map((k) => (
          <Field key={k} label={LABELS[k]}>
            <Input type="number" inputMode="decimal" min={0} max={k === 'lateGraceMin' ? 60 : 100} step={k === 'lateGraceMin' ? 1 : 0.1} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} required />
          </Field>
        ))}
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
          <Button type="submit" loading={saving}>{t('Enregistrer les objectifs', 'Save goals')}</Button>
          {msg && <span className={msg.tone === 'go' ? 'text-sm text-go-2' : 'text-sm text-stop-2'}>{msg.text}</span>}
        </div>
      </form>
    </Card>
  );
}

