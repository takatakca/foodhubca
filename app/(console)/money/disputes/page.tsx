'use client';

// Disputes — every missing order, short payment, error charge and refund, from "to check" to "recovered".
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Tabs } from '@/components/ui/tabs';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { StatTile, fmtInt } from '@/components/charts/charts';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { CH_NAME, CaseBadge, MoneyHead, RECOVERABLE, cad, caseLabel, type CaseStatus } from '../money-ui';
import { api, ApiError, dayOf, downloadCsv } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';

type Case = {
  id: string; type: string; channel: string; ref: string; orderId: string | null; brandName: string | null; locationCode: string | null; orderDate: string | null;
  amount: number; status: CaseStatus; platformCaseId?: string; recoveredAmount?: number; notes: Array<{ at: string; by: string; text: string }>; openedAt: string; updatedAt: string; autoClosed?: boolean;
};
const typeLabel = (t: T, k: string) => ({ short_paid: t('Payée en moins', 'Paid less than expected'), missing: t('Absente du paiement', 'Missing from payout'), error_charge: t('Frais d’erreur', 'Error charge'), refunded: t('Remboursement / rétrofacturation', 'Refund / chargeback'), unknown_order: t('Commande payée absente de Food Hub', 'Paid order not in Food Hub'), deposit_gap: t('Dépôt différent du relevé', 'Deposit differs from statement') } as Record<string, string>)[k] ?? k;
type Tab = 'active' | 'recovered' | 'closed' | 'all';
const TAB_STATUSES: Record<Tab, CaseStatus[]> = { active: ['open', 'disputed'], recovered: ['recovered'], closed: ['resolved', 'written_off', 'ignored'], all: [] };

export default function DisputesPage() {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const [cases, setCases] = useState<Case[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [channel, setChannel] = useState('');
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Case | null>(null);

  const load = useCallback(() => api<{ cases: Case[] }>('/api/foodhub/recon/cases').then((d) => { setCases(d.cases); setErr(''); setLoaded(true); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);

  const statuses = TAB_STATUSES[tab];
  const rows = useMemo(() => cases.filter((c) => (!statuses.length || statuses.includes(c.status)) && (!channel || c.channel === channel)).sort((a, b) => b.amount - a.amount), [cases, statuses, channel]);
  const sum = (f: (c: Case) => boolean, v: (c: Case) => number = (c) => c.amount) => cases.filter(f).reduce((s, c) => s + v(c), 0);
  const owed = (c: Case) => RECOVERABLE.includes(c.type);
  const unknownOpen = cases.filter((c) => c.type === 'unknown_order' && c.status === 'open').length;
  const countOf = (k: Tab) => cases.filter((c) => !TAB_STATUSES[k].length || TAB_STATUSES[k].includes(c.status)).length;

  function exportCsv() {
    downloadCsv('takatak-litiges', [
      [t('Ouvert', 'Opened'), t('Plateforme', 'Platform'), t('Problème', 'Problem'), t('Commande', 'Order'), t('Date commande', 'Order date'), t('Marque', 'Brand'), t('Succursale', 'Location'), t('Montant', 'Amount'), t('Statut', 'Status'), t('No dossier plateforme', 'Platform case #'), t('Récupéré', 'Recovered'), t('Dernière note', 'Last note')],
      ...rows.map((c) => [dayOf(c.openedAt, loc), CH_NAME[c.channel] ?? c.channel, typeLabel(t, c.type), c.ref, c.orderDate ?? '', c.brandName ?? '', c.locationCode ?? '', c.amount.toFixed(2), caseLabel(t, c.status), c.platformCaseId ?? '', c.recoveredAmount?.toFixed(2) ?? '', c.notes[c.notes.length - 1]?.text ?? '']),
    ]);
  }

  const how: Array<[string, string, string]> = [
    ['uber_eats', t('Uber Eats Manager → Commandes → ouvrez la commande → signaler un problème de paiement, ou contactez le soutien marchand avec le no de commande.', 'Uber Eats Manager → Orders → open the order → report a payment problem, or contact merchant support with the order id.'), ''],
    ['doordash', t('Merchant Portal → Commandes → ouvrez la commande → contestez le frais d’erreur ou l’ajustement. Gardez une photo de la commande si possible.', 'Merchant Portal → Orders → open the order → dispute the error charge or adjustment. Keep a photo of the order if you have one.'), ''],
    ['skip', t('Portail restaurant / soutien partenaire avec le no de commande et la ligne du relevé.', 'Restaurant Portal / partner support with the order number and the statement line.'), ''],
    ['tgtg', t('Soutien magasin Too Good To Go avec la période de paiement et la différence.', 'Too Good To Go store support with the payout period and the difference.'), ''],
  ];

  return (
    <div>
      <MoneyHead title={t('Litiges', 'Disputes')} intro={t('Les problèmes trouvés dans les paiements s’ouvrent ici tout seuls et se ferment tout seuls quand un relevé suivant paie la commande. Notez ce que vous avez contesté et ce qui est revenu — vos décisions ne sont jamais écrasées.', 'Problems found in the payouts open here by themselves and close by themselves when a later statement pays the order. Record what you disputed and what came back — your decisions are never overwritten.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile hero label={t('À récupérer — pas encore contesté', 'To recover — not disputed yet')} value={cad(sum((c) => owed(c) && c.status === 'open'), loc)} note={`${cases.filter((c) => owed(c) && c.status === 'open').length} ${t('dossier(s) à contester', 'case(s) to dispute')}`} />
        <StatTile label={t('Contesté, en attente', 'Disputed, waiting')} value={cad(sum((c) => owed(c) && c.status === 'disputed'), loc)} note={`${cases.filter((c) => owed(c) && c.status === 'disputed').length} ${t('dossier(s)', 'case(s)')}`} />
        <StatTile label={t('Récupéré', 'Recovered')} value={cad(sum((c) => c.status === 'recovered', (c) => c.recoveredAmount ?? c.amount), loc)} note={`${cases.filter((c) => c.status === 'recovered').length} ${t('dossier(s)', 'case(s)')} · ${cad(sum((c) => c.status === 'resolved'), loc)} ${t('réglés par des paiements', 'fixed by later payouts')}`} />
        <StatTile label={t('Radié', 'Written off')} value={cad(sum((c) => c.status === 'written_off'), loc)} />
        <StatTile label={t('Payées mais absentes de Food Hub', 'Paid orders not in Food Hub')} value={fmtInt(unknownOpen)} note={t('pas de l’argent perdu — webhook manqué ou magasin non jumelé', 'not money lost — missed webhook or unmapped store')} />
      </div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onChange={setTab} className="flex-1" tabs={[
          { key: 'active', label: t('À faire', 'To do'), count: loaded ? countOf('active') : null },
          { key: 'recovered', label: t('Récupérés', 'Recovered'), count: loaded ? countOf('recovered') : null },
          { key: 'closed', label: t('Fermés', 'Closed'), count: loaded ? countOf('closed') : null },
          { key: 'all', label: t('Tous', 'All'), count: loaded ? countOf('all') : null },
        ]} />
        <div className="flex items-center gap-2">
          <Select selectSize="sm" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t('Plateforme', 'Platform')} className="w-44">
            <option value="">{t('Toutes les plateformes', 'All platforms')}</option>
            {Object.entries(CH_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length} icon={<Download className="size-4" />}>CSV</Button>
        </div>
      </div>

      <Card className="mb-5">
        <Table>
          <thead><tr><Th>{t('Ouvert', 'Opened')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Problème', 'Problem')}</Th><Th>{t('Commande', 'Order')}</Th><Th>{t('Marque · succursale', 'Brand · location')}</Th><Th align="right">{t('Montant', 'Amount')}</Th><Th>{t('Statut', 'Status')}</Th><Th>{t('Dossier plateforme', 'Platform case')}</Th><Th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td className="whitespace-nowrap text-ink-3">{dayOf(c.openedAt, loc)}</Td>
                <Td><PlatformTag channel={c.channel} /></Td>
                <Td className="font-semibold">{typeLabel(t, c.type)}</Td>
                <Td>{c.orderId ? <Link href={`/orders/${c.orderId}`} className="font-bold underline-offset-4 hover:underline">#{c.ref}</Link> : <span className="font-mono text-xs">{c.ref}</span>}<div className="text-xs text-ink-3">{c.orderDate ? dayOf(c.orderDate, loc) : ''}</div></Td>
                <Td className="text-ink-2">{c.brandName || c.locationCode ? `${c.brandName ?? '—'} · ${c.locationCode ? shortLoc(locName(c.locationCode)) : '—'}` : t('Magasin non identifié', 'Store not identified')}</Td>
                <Td align="right"><span className="font-bold">{cad(c.amount, loc)}</span>{c.recoveredAmount !== undefined ? <div className="text-xs font-semibold text-go-2">✓ {cad(c.recoveredAmount, loc)} {t('revenus', 'back')}</div> : null}</Td>
                <Td><CaseBadge status={c.status} /></Td>
                <Td className="text-ink-3">{c.platformCaseId ?? '—'}</Td>
                <Td align="right"><Button size="sm" variant={can('finance:edit') && c.status === 'open' ? 'primary' : 'outline'} onClick={() => setEdit(c)}>{can('finance:edit') ? t('Mettre à jour', 'Update') : t('Historique', 'History')}</Button></Td>
              </Tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-3">{!loaded ? t('Chargement…', 'Loading…') : tab === 'active' ? t('Rien à contester. Les nouveaux problèmes apparaissent ici après chaque import de relevé et chaque jour.', 'Nothing to dispute right now. New problems appear here after each statement import and every day.') : t('Aucun dossier ici.', 'No case here.')}</td></tr>}
          </tbody>
        </Table>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-base font-extrabold">{t('Comment contester', 'How to dispute')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {how.map(([ch, d]) => <div key={ch} className="rounded-lg border border-line bg-raised p-3.5"><PlatformTag channel={ch} /><p className="mt-2 text-[13px] leading-relaxed text-ink-2">{d}</p></div>)}
        </div>
        <p className="mt-3 text-xs text-ink-3">{t('Contestez vite — les plateformes n’acceptent les litiges que pour un temps limité après la commande. Inscrivez le no de dossier de la plateforme ici pour que tout le monde puisse suivre.', 'Dispute quickly — platforms only accept disputes for a limited time after the order. Write the platform case number here so anyone can follow up.')}</p>
      </Card>

      {edit && <CaseDialog c={edit} canEdit={can('finance:edit')} onClose={() => setEdit(null)} onSaved={() => { toast.success(t(`Dossier #${edit.ref} enregistré`, `Case #${edit.ref} saved`)); setEdit(null); load(); }} />}
    </div>
  );
}

function CaseDialog({ c, canEdit, onClose, onSaved }: { c: Case; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, loc } = useI18n();
  const [status, setStatus] = useState<CaseStatus>(c.status);
  const [platformCaseId, setPlatformCaseId] = useState(c.platformCaseId ?? '');
  const [recovered, setRecovered] = useState(c.recoveredAmount !== undefined ? String(c.recoveredAmount) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try {
      await api('/api/foodhub/recon/cases', { method: 'POST', json: { id: c.id, status: status !== c.status ? status : undefined, note: note || undefined, platformCaseId: platformCaseId && platformCaseId !== c.platformCaseId ? platformCaseId : undefined, recoveredAmount: status === 'recovered' && recovered !== '' ? Number(recovered) : undefined } });
      onSaved();
    } catch (e) { if (!(e instanceof ApiError && e.status === 499)) setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const options: CaseStatus[] = (['open', 'disputed', 'recovered', 'written_off', 'resolved', 'ignored'] as CaseStatus[]).filter((s) => s !== 'resolved' || c.status === 'resolved');
  return (
    <Modal title={`${typeLabel(t, c.type)} — ${CH_NAME[c.channel] ?? c.channel} #${c.ref}`} subtitle={`${cad(c.amount, loc)} · ${t('ouvert le', 'opened')} ${dayOf(c.openedAt, loc)}${c.orderDate ? ` · ${t('commande du', 'order of')} ${dayOf(c.orderDate, loc)}` : ''}`} onClose={onClose}
      footer={canEdit ? <><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button loading={busy} onClick={save}>{t('Enregistrer', 'Save')}</Button></> : undefined}>
      {c.type === 'unknown_order' && <Banner tone="info" className="mb-4">{t('Pas de l’argent perdu : la plateforme a payé une commande que Food Hub n’a jamais reçue — un webhook manqué ou un magasin non jumelé. Vérifiez Magasins → Jumelage, puis mettez ce dossier à « Ignoré ».', 'Not money lost: the platform paid an order Food Hub never received — a missed webhook or an unmapped store. Check Stores → Mapping, then set this case to “Ignored”.')}</Banner>}
      {canEdit && (
        <div className="mb-5 grid gap-3">
          <Field label={t('Statut', 'Status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>{options.map((s) => <option key={s} value={s}>{caseLabel(t, s)}</option>)}</Select>
          </Field>
          <Field label={t('No de dossier / billet de la plateforme', 'Platform case / ticket number')}><Input value={platformCaseId} onChange={(e) => setPlatformCaseId(e.target.value)} maxLength={80} /></Field>
          {status === 'recovered' && <Field label={t('Montant récupéré ($)', 'Amount recovered ($)')}><Input type="number" step="0.01" min="0" inputMode="decimal" value={recovered} onChange={(e) => setRecovered(e.target.value)} placeholder={c.amount.toFixed(2)} /></Field>}
          <Field label={t('Note', 'Note')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('Ce que vous avez envoyé, à qui vous avez parlé…', 'What you sent, who you spoke to…')} /></Field>
          {err && <Banner tone="stop">{err}</Banner>}
        </div>
      )}
      <div className="text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Historique', 'History')}</div>
      <ol className="mt-2 space-y-2">
        {[...c.notes].reverse().map((n, i) => (
          <li key={i} className="rounded-md bg-raised px-3 py-2 text-[13px]"><div className="text-xs text-ink-3">{new Date(n.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })} · {n.by}</div><div className="text-ink">{n.text}</div></li>
        ))}
        {c.notes.length === 0 && <li className="text-[13px] text-ink-3">—</li>}
      </ol>
    </Modal>
  );
}
