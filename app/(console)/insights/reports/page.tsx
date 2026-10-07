'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Download, Eye, Mail, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Banner, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { FilterBar, MultiPick, CHANNEL_OPTIONS } from '@/components/ui/filter-bar';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { FormDraftNote } from '@/components/ui/save-chip';
import { useToast } from '@/components/ui/toast';
import { Hint } from '@/components/help/hint';
import { usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { api, timeOf } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { formDraftId, useFormDraft } from '@/lib/ui/use-form-draft';
import { useI18n } from '@/lib/i18n/client';

type Report = { key: string; title: string; description: string };
type Schedule = { id: string; report: string; frequency: 'daily' | 'weekly' | 'monthly'; emails: string[]; format: 'csv' | 'xlsx'; filter: { locationCodes?: string[]; channels?: string[]; brands?: string[] }; lastSentAt?: string; lastError?: string | null };
type Preview = { title: string; columns: string[]; rows: Array<Array<string | number>>; total: number };
/** What the "Email" and "Schedule" pop-ups keep on this device when closed by mistake (addresses and choices — nothing secret). */
type MailForm = { emails: string; format: 'xlsx' | 'csv' };
type ScheduleForm = MailForm & { frequency: Schedule['frequency']; locationCodes: string[]; channels: string[]; brands: string[] };
const FR: Record<string, [string, string]> = {
  order_transactions: ['Transactions par commande', 'Une ligne par commande : montants, taxes, statut, plateforme, Clover.'],
  order_status_transitions: ['Étapes des commandes', 'Heures de réception, acceptation, prête, ramassée, annulée — et qui l’a fait.'],
  item_wise: ['Articles vendus', 'Quantités et revenus par article.'],
  option_wise: ['Options vendues', 'Quantités et revenus par option (sauces, extras…).'],
  items_summary: ['Résumé des articles', 'Totaux par article sur la période.'],
  menu_snapshot: ['Photo du menu', 'Le menu maître de chaque marque, prix par plateforme.'],
  store_actions: ['Actions sur les magasins', 'Pauses, ruptures, publications : qui, quand, résultat.'],
};

export default function ReportsPage() {
  const { t, lang, loc } = useI18n();
  const { can, locations, brands, locName } = useViewer();
  // Emailing and scheduling a report need finance:edit on the server (owner, manager); an accountant / analyst downloads.
  const canSend = can('finance:edit');
  const { scope } = usePulse();
  const toast = useToast();
  const { filters, set, query } = useFilters('yesterday', scope);
  const [reports, setReports] = useState<Report[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [emailOn, setEmailOn] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: Preview | null } | null>(null);
  const [mailFor, setMailFor] = useState<Report | null>(null);
  const [schedFor, setSchedFor] = useState<Report | null>(null);
  const load = useCallback(() => api<{ reports: Report[]; schedules: Schedule[]; emailConfigured: boolean }>('/api/foodhub/reports').then((d) => { setReports(d.reports); setSchedules(d.schedules); setEmailOn(d.emailConfigured); }).catch((e) => toast.error(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  const title = (r: Report) => (lang === 'fr' && FR[r.key] ? FR[r.key][0] : r.title);
  const desc = (r: Report) => (lang === 'fr' && FR[r.key] ? FR[r.key][1] : r.description);
  async function show(key: string) {
    setPreview({ key, data: null });
    try { setPreview({ key, data: await api<Preview>(`/api/foodhub/reports/${key}?format=json&limit=20&${query}`) }); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); setPreview(null); }
  }
  const FREQ = { daily: t('Chaque jour (la veille)', 'Daily (yesterday)'), weekly: t('Chaque lundi (semaine passée)', 'Mondays (last week)'), monthly: t('Le 1er du mois (mois passé)', 'The 1st (last month)') };
  return (
    <div>
      <PageHeader title={t('Analyses', 'Insights')} subtitle={t('Téléchargez n’importe quel rapport pour la période choisie, envoyez-le maintenant ou chaque jour, semaine ou mois.', 'Download any report for the chosen period, email it now, or every day, week or month.')} />
      <InsightsTabs />
      {emailOn && !canSend && <Banner tone="info" className="mb-4">{t('Envoyer ou programmer un rapport : réservé au propriétaire et aux gérants. Les téléchargements marchent pour tous.', 'Emailing or scheduling a report: owner and managers only. Downloads work for everyone.')}</Banner>}
      {!emailOn && <Banner tone="warn" className="mb-4">{t('Courriel pas branché : les téléchargements marchent, mais « Envoyer » et les envois programmés demandent RESEND_API_KEY et REPORT_EMAIL_FROM.', 'Email not set up: downloads work, but “Email” and schedules need RESEND_API_KEY and REPORT_EMAIL_FROM.')}</Banner>}
      <Hint id="reports.period"><FilterBar filters={filters} set={set} locations={locations} brands={brands} /></Hint>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.key} className="flex flex-col p-5">
            <h2 className="text-[15px] font-bold">{title(r)}</h2>
            <p className="mt-1 flex-1 text-[13px] text-ink-3">{desc(r)}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Hint id="reports.download"><a className={buttonClass('primary', 'md')} href={`/api/foodhub/reports/${r.key}?format=xlsx&${query}`}><Download className="size-4" />Excel</a></Hint>
              <a className={buttonClass('outline', 'md')} href={`/api/foodhub/reports/${r.key}?format=csv&${query}`}>CSV</a>
              <Button variant="ghost" onClick={() => show(r.key)} icon={<Eye className="size-4" />}>{t('Aperçu', 'Preview')}</Button>
              <Hint id="reports.email"><Button variant="ghost" disabled={!emailOn || !canSend} onClick={() => setMailFor(r)} icon={<Mail className="size-4" />}>{t('Envoyer', 'Email')}</Button></Hint>
              <Hint id="reports.schedule"><Button variant="ghost" disabled={!emailOn || !canSend} onClick={() => setSchedFor(r)} icon={<CalendarClock className="size-4" />}>{t('Programmer', 'Schedule')}</Button></Hint>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title={t(`Envois programmés (${schedules.length})`, `Scheduled emails (${schedules.length})`)} subtitle={t('Envoyés après 8 h (Montréal) par la tâche quotidienne.', 'Sent after 8:00 (Montréal) by the daily job.')} />
        <div className="divide-y divide-line border-t border-line">
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="font-semibold">{(lang === 'fr' && FR[s.report]?.[0]) || s.report}</span><Badge tone="neutral">{s.format.toUpperCase()}</Badge>
              <span className="text-ink-3">{FREQ[s.frequency]}</span>
              <span className="min-w-0 flex-1 truncate text-ink-3">{s.emails.join(', ')} {s.filter.locationCodes?.length ? `· ${s.filter.locationCodes.map((c) => shortLoc(locName(c))).join(', ')}` : ''}</span>
              <span className="text-xs text-ink-3">{s.lastSentAt ? timeOf(s.lastSentAt, loc, true) : t('pas encore', 'not yet')}</span>
              {s.lastError && <Badge tone="stop" title={s.lastError}>{t('échec', 'failed')}</Badge>}
              {canSend && <Hint id="reports.stop"><button type="button" className="flex size-10 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-stop" onClick={() => {
                // Hidden at once; really stopped after 6 s unless "Undo" is tapped.
                setSchedules((list) => list.filter((x) => x.id !== s.id));
                toast.undo(t('Envoi arrêté', 'Email stopped'), () => load(), {
                  onCommit: () => { api(`/api/foodhub/reports/schedules?id=${s.id}`, { method: 'DELETE' }).catch((e) => { toast.error(e instanceof Error ? e.message : String(e)); load(); }); },
                });
              }} aria-label={t('Arrêter', 'Stop')} title={t('Arrêter cet envoi', 'Stop this email')}><Trash2 className="size-5" /></button></Hint>}
            </div>
          ))}
          {schedules.length === 0 && <div className="px-5 py-6 text-sm text-ink-3">{t('Aucun envoi programmé.', 'No scheduled email.')}</div>}
        </div>
      </Card>
      {preview && (
        <Modal title={preview.data?.title ?? '…'} size="xl" onClose={() => setPreview(null)}>
          {!preview.data ? <div className="h-40 animate-pulse rounded bg-sunken" /> : (
            <>
              <p className="mb-2 text-xs text-ink-3">{t(`${preview.data.rows.length} premières lignes sur ${preview.data.total}`, `First ${preview.data.rows.length} of ${preview.data.total} rows`)}</p>
              <div className="scrollbar-thin max-h-[60vh] overflow-auto rounded-md border border-line"><table className="w-full text-xs"><thead><tr>{preview.data.columns.map((c) => <th key={c} className="sticky top-0 border-b border-line bg-raised px-2 py-1.5 text-left font-semibold whitespace-nowrap text-ink-3">{c}</th>)}</tr></thead><tbody>{preview.data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-line px-2 py-1 whitespace-nowrap">{String(v ?? '')}</td>)}</tr>)}</tbody></table></div>
            </>
          )}
        </Modal>
      )}
      {mailFor && <MailDialog report={mailFor} title={title(mailFor)} query={query} onClose={() => setMailFor(null)} />}
      {schedFor && <ScheduleDialog report={schedFor} title={title(schedFor)} freq={FREQ} onClose={() => setSchedFor(null)} onDone={() => { setSchedFor(null); load(); }} />}
    </div>
  );
}

function MailDialog({ report, title, query, onClose }: { report: Report; title: string; query: string; onClose: () => void }) {
  const { t } = useI18n();
  const { viewer } = useViewer();
  const toast = useToast();
  // One kept draft per report: closing by mistake keeps the addresses until "Send" succeeds.
  const f = useFormDraft<MailForm>(formDraftId('report-email', report.key), viewer.username, { emails: '', format: 'xlsx' });
  const { emails, format } = f.value;
  const [busy, setBusy] = useState(false);
  function close() {
    if (f.dirty) toast.info(t('Gardé — rouvrez pour terminer', 'Kept — reopen to finish'));
    onClose();
  }
  async function send() {
    setBusy(true);
    try { const r = await api<{ message: string; rows: number }>('/api/foodhub/reports/email', { method: 'POST', json: { report: report.key, emails, format, query: Object.fromEntries(new URLSearchParams(query)) } }); f.clear(); toast.success(t('Rapport envoyé', 'Report sent'), `${r.rows} ${t('lignes', 'rows')}`); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${t('Envoyer', 'Email')} « ${title} »`} onClose={close} footer={<><Button variant="ghost" size="lg" onClick={close}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={busy} disabled={!emails.trim()} onClick={send}>{t('Envoyer', 'Send')}</Button></>}>
      <FormDraftNote restored={f.restored} onDiscard={f.discard} />
      <div className="space-y-4">
        <Field label={t('À (séparés par des virgules)', 'To (comma-separated)')}><Input value={emails} onChange={(e) => f.set((v) => ({ ...v, emails: e.target.value }))} placeholder="comptable@exemple.ca" /></Field>
        <Field label={t('Format', 'Format')}><Select value={format} onChange={(e) => f.set((v) => ({ ...v, format: e.target.value as MailForm['format'] }))}><option value="xlsx">Excel</option><option value="csv">CSV</option></Select></Field>
        <p className="text-xs text-ink-3">{t('Avec la période et les filtres de la page.', 'With the page’s period and filters.')}</p>
      </div>
    </Modal>
  );
}

function ScheduleDialog({ report, title, freq, onClose, onDone }: { report: Report; title: string; freq: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { viewer, locations, brands } = useViewer();
  const toast = useToast();
  // One kept draft per report: closing by mistake keeps the addresses and choices until "Save" succeeds.
  const f = useFormDraft<ScheduleForm>(formDraftId('report-schedule', report.key), viewer.username, { emails: '', frequency: 'daily', format: 'xlsx', locationCodes: [], channels: [], brands: [] });
  const { emails, frequency, format, channels: chs } = f.value;
  // A kept location or brand that is no longer one of yours (draft from another day) is neither shown nor sent.
  const locs = f.value.locationCodes.filter((c) => locations.some((l) => l.code === c));
  const brs = f.value.brands.filter((b) => brands.includes(b));
  const put = (p: Partial<ScheduleForm>) => f.set((v) => ({ ...v, ...p }));
  const [busy, setBusy] = useState(false);
  function close() {
    if (f.dirty) toast.info(t('Gardé — rouvrez pour terminer', 'Kept — reopen to finish'));
    onClose();
  }
  async function save() {
    setBusy(true);
    try { await api('/api/foodhub/reports/schedules', { method: 'POST', json: { report: report.key, emails, frequency, format, locationCodes: locs, channels: chs, brands: brs } }); f.clear(); toast.success(t('Envoi programmé', 'Email scheduled')); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${t('Programmer', 'Schedule')} « ${title} »`} onClose={close} footer={<><Button variant="ghost" size="lg" onClick={close}>{t('Annuler', 'Cancel')}</Button><Button size="lg" loading={busy} disabled={!emails.trim()} onClick={save}>{t('Enregistrer', 'Save')}</Button></>}>
      <FormDraftNote restored={f.restored} onDiscard={f.discard} />
      <div className="space-y-4">
        <Field label={t('À', 'To')}><Input value={emails} onChange={(e) => put({ emails: e.target.value })} placeholder="vous@takatak.ca" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Fréquence', 'How often')}><Select value={frequency} onChange={(e) => put({ frequency: e.target.value as ScheduleForm['frequency'] })}>{Object.entries(freq).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label={t('Format', 'Format')}><Select value={format} onChange={(e) => put({ format: e.target.value as ScheduleForm['format'] })}><option value="xlsx">Excel</option><option value="csv">CSV</option></Select></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiPick label={t('Succursales', 'Locations')} options={locations.map((l) => [l.code, shortLoc(l.name)])} value={locs} onChange={(v) => put({ locationCodes: v })} />
          <MultiPick label={t('Plateformes', 'Platforms')} options={CHANNEL_OPTIONS.map(([k, l]) => [k, l])} value={chs} onChange={(v) => put({ channels: v })} />
          <MultiPick label={t('Marques', 'Brands')} options={brands.map((b) => [b, b])} value={brs} onChange={(v) => put({ brands: v })} />
        </div>
      </div>
    </Modal>
  );
}
