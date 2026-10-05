'use client';

// Internal ledger — one balanced journal entry per payout, drafted automatically, approved by the owner.
// Approval only marks an entry as reviewed: nothing is posted to QuickBooks or anywhere else.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { Badge, PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Modal } from '@/components/ui/overlay';
import { Tabs } from '@/components/ui/tabs';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import { MoneyHead, cad } from '../money-ui';
import { api, ApiError, dayOf } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';

type Line = { account: string; debit: number; credit: number; memo?: string };
type Entry = { key: string; date: string | null; channel: string; memo: string; lines: Line[]; debit: number; credit: number; balanced: boolean; status: 'draft' | 'approved'; approvedBy?: string; approvedAt?: string; warnings: string[] };
type Tab = 'draft' | 'approved' | 'all';

export default function LedgerPage() {
  const { t, loc } = useI18n();
  const { can, locations } = useViewer();
  const toast = useToast();
  const { filters, set, query } = useFilters('last_month');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tab, setTab] = useState<Tab>('draft');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => api<{ entries: Entry[] }>(`/api/foodhub/recon/ledger?${query}`).then((d) => { setEntries(d.entries); setErr(''); setLoaded(true); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [query]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => entries.filter((e) => tab === 'all' || e.status === tab), [entries, tab]);
  const byAccount = useMemo(() => {
    const m = new Map<string, { debit: number; credit: number }>();
    for (const e of entries) for (const l of e.lines) { const a = m.get(l.account) ?? { debit: 0, credit: 0 }; a.debit += l.debit; a.credit += l.credit; m.set(l.account, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  async function approve(e: Entry) {
    setBusy(e.key); setConfirm(null);
    try { await api('/api/foodhub/recon/ledger', { method: 'POST', json: { key: e.key } }); toast.success(t('Écriture approuvée', 'Entry approved'), e.memo); await load(); }
    catch (x) { if (!(x instanceof ApiError && x.status === 499)) toast.error(x instanceof Error ? x.message : String(x)); } finally { setBusy(null); }
  }

  const csvHref = `/api/foodhub/recon/ledger?format=csv&${query}`;
  return (
    <div>
      <MoneyHead title={t('Grand livre interne', 'Internal ledger')} intro={t('Le grand livre interne TAKATAK : une écriture par paiement — dépôt bancaire, ventes livraison, TPS et TVQ perçues, commissions, taxes sur frais (CTI/RTI), promotions, remboursements et autres frais. Les écritures restent des brouillons jusqu’à votre approbation. Rien n’est envoyé à QuickBooks ni ailleurs ; téléchargez le CSV pour votre comptable.', 'The TAKATAK internal ledger: one journal entry per payout — bank deposit, delivery sales, GST and QST collected, commissions, tax on fees (input tax credits), promotions, refunds and other charges. Entries are drafts until you approve them. Nothing is posted to QuickBooks or anywhere else; download the CSV for your accountant.')}
        right={<a href={csvHref} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-2 bg-surface px-3 text-[13px] font-semibold text-ink hover:border-ink-4"><Download className="size-4" />CSV</a>} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <FilterBar filters={filters} set={set} locations={locations} showLocations={false} showBrands={false} presets={['7d', '30d', 'month', 'last_month', 'custom']} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { key: 'draft', label: t('À approuver', 'To approve'), count: loaded ? entries.filter((e) => e.status === 'draft').length : null },
        { key: 'approved', label: t('Approuvées', 'Approved'), count: loaded ? entries.filter((e) => e.status === 'approved').length : null },
        { key: 'all', label: t('Toutes', 'All'), count: loaded ? entries.length : null },
      ]} />

      <div className="space-y-4">
        {rows.map((e) => (
          <Card key={e.key}>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0">
                <div className="font-extrabold text-ink">{e.memo}</div>
                <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-3"><PlatformTag channel={e.channel} />{e.date ? dayOf(e.date, loc) : '—'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {e.balanced ? <Badge tone="go" icon={<CheckCircle2 className="size-3.5" />}>{t('Équilibrée', 'Balanced')}</Badge> : <Badge tone="stop" icon={<XCircle className="size-3.5" />}>{t('Non équilibrée', 'Does not balance')}</Badge>}
                {e.status === 'approved'
                  ? <Badge tone="info">✓ {t('Approuvée par', 'Approved by')} {e.approvedBy}{e.approvedAt ? ` · ${dayOf(e.approvedAt, loc)}` : ''}</Badge>
                  : can('finance:edit') && <Button size="sm" disabled={!e.balanced} loading={busy === e.key} onClick={() => (e.warnings.length ? setConfirm(e) : approve(e))}>{t('Approuver', 'Approve')}</Button>}
              </div>
            </div>
            {e.warnings.length > 0 && <div className="space-y-2 px-5 pb-3">{e.warnings.map((w, i) => <Banner key={i} tone="warn">{w}</Banner>)}</div>}
            <Table>
              <thead><tr><Th>{t('Compte', 'Account')}</Th><Th align="right">{t('Débit', 'Debit')}</Th><Th align="right">{t('Crédit', 'Credit')}</Th><Th>{t('Mémo', 'Memo')}</Th></tr></thead>
              <tbody>
                {e.lines.map((l, i) => <Tr key={i}><Td>{l.account}</Td><Td align="right">{l.debit ? cad(l.debit, loc) : ''}</Td><Td align="right">{l.credit ? cad(l.credit, loc) : ''}</Td><Td className="text-ink-3">{l.memo ?? ''}</Td></Tr>)}
                <tr className="bg-raised font-extrabold"><td className="px-3 py-2.5">{t('Total', 'Total')}</td><td className="num px-3 py-2.5 text-right">{cad(e.debit, loc)}</td><td className="num px-3 py-2.5 text-right">{cad(e.credit, loc)}</td><td /></tr>
              </tbody>
            </Table>
          </Card>
        ))}
        {rows.length === 0 && <Card><EmptyState title={!loaded ? t('Chargement…', 'Loading…') : tab === 'draft' ? t('Rien à approuver', 'Nothing to approve') : t('Aucune écriture', 'No entry')} body={loaded && tab === 'draft' ? t('Les écritures apparaissent quand des relevés sont importés.', 'Entries appear when statements are imported.') : undefined} /></Card>}
      </div>

      {byAccount.length > 0 && (
        <Card className="mt-5">
          <CardHeader title={t('Totaux par compte (période)', 'Totals by account (period)')} subtitle={t('TPS/TVQ perçues (2310, 2320) moins les CTI/RTI (1310, 1320) = ce que les ventes des plateformes ajoutent à votre déclaration de taxes. Validez avec votre comptable.', 'GST/QST collected (2310, 2320) minus input tax credits (1310, 1320) is what the platforms’ sales add to your GST/QST return. Check with your accountant.')} />
          <Table>
            <thead><tr><Th>{t('Compte', 'Account')}</Th><Th align="right">{t('Débit', 'Debit')}</Th><Th align="right">{t('Crédit', 'Credit')}</Th><Th align="right">{t('Solde', 'Balance')}</Th></tr></thead>
            <tbody>{byAccount.map(([a, v]) => <Tr key={a}><Td>{a}</Td><Td align="right">{cad(v.debit, loc)}</Td><Td align="right">{cad(v.credit, loc)}</Td><Td align="right" className="font-semibold">{cad(v.debit - v.credit, loc)}</Td></Tr>)}</tbody>
          </Table>
        </Card>
      )}

      {confirm && (
        <Modal size="sm" title={t('Approuver malgré les avertissements ?', 'Approve despite the warnings?')} onClose={() => setConfirm(null)}
          footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t('Annuler', 'Cancel')}</Button><Button onClick={() => approve(confirm)}>{t('Approuver quand même', 'Approve anyway')}</Button></>}>
          <div className="space-y-2">{confirm.warnings.map((w, i) => <Banner key={i} tone="warn">{w}</Banner>)}</div>
          <p className="mt-3 text-[13px] text-ink-3">{t('Approuver marque seulement l’écriture comme révisée. Rien n’est envoyé à QuickBooks.', 'Approving only marks the entry as reviewed. Nothing is posted to QuickBooks.')}</p>
        </Modal>
      )}
    </div>
  );
}
