'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileUp, RefreshCw } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { PlatformTag } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, CardHeader, EmptyState, SkeletonStats } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ChartCard, HBars, StatTile, fmtInt } from '@/components/charts/charts';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { usePulse } from '@/components/live/pulse';
import { CaseBadge, MoneyHead, PROBLEM, RECOVERABLE, ReconBadge, cad, reconLabel, signed, toRecover, type Recon, type ReconStatus } from './money-ui';
import { api, ApiError, dayOf } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';

/** "1 commande" / "3 commandes": a real plural, never "commande(s)". */
function plural(t: (fr: string, en: string) => string, n: number, fr: [string, string], en: [string, string]) {
  return t(`${n} ${n === 1 ? fr[0] : fr[1]}`, `${n} ${n === 1 ? en[0] : en[1]}`);
}

export default function MoneyOverview() {
  const { t, loc } = useI18n();
  const { locations, locName, can } = useViewer();
  const toast = useToast();
  const { scope } = usePulse();
  const { filters, set, query } = useFilters('30d', scope);
  const [data, setData] = useState<Recon | null>(null);
  const [cases, setCases] = useState<{ count: number; amount: number } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api<Recon>(`/api/foodhub/recon?${query}`), api<{ cases: Array<{ amount: number; type: string }> }>('/api/foodhub/recon/cases?status=open,disputed')]);
      const owed = c.cases.filter((x) => RECOVERABLE.includes(x.type));
      setData(r); setCases({ count: owed.length, amount: owed.reduce((s, x) => s + x.amount, 0) }); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [query]);
  useEffect(() => { load(); }, [load]);
  async function recheck() {
    setBusy(true);
    try { const r = await api<{ opened: number; closed: number }>('/api/foodhub/recon/run', { method: 'POST' }); toast.success(t('90 derniers jours revérifiés', 'Last 90 days re-checked'), `${plural(t, r.opened, ['nouveau problème', 'nouveaux problèmes'], ['new problem', 'new problems'])} · ${plural(t, r.closed, ['réglé', 'réglés'], ['fixed', 'fixed'])}`); await load(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const problems = useMemo(() => (data?.orders ?? []).filter((o) => PROBLEM.includes(o.status)).sort((a, b) => toRecover(b) - toRecover(a)), [data]);
  const unconfirmed = (data?.channels ?? []).filter((c) => c.orders > 0 && !c.planConfirmed);
  const notCovered = (data?.orders ?? []).filter((o) => o.status === 'not_covered').length;
  const statusRows = useMemo(() => { const m = new Map<ReconStatus, number>(); for (const o of data?.orders ?? []) m.set(o.status, (m.get(o.status) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ label: reconLabel(t, s), value: n })); }, [data, t]);
  const recoverRows = (data?.channels ?? []).filter((c) => c.orders || c.unknownOrders).map((c) => ({ label: c.label, value: c.missingMoney, detail: `${c.counts.missing} ${t('absentes', 'missing')} · ${c.counts.short_paid + c.counts.error_charge + c.counts.refunded} ${t('payées en moins', 'paid less')}` }));
  return (
    <div>
      <MoneyHead title={t('Où est mon argent ?', 'Where is my money?')} intro={t('Chaque commande est comparée à votre plan de commission et à ce que les relevés ont vraiment payé. Commandes absentes, paiements en moins, frais d’erreur et remboursements deviennent des litiges automatiquement. Rien n’est approuvé ni publié à votre place.', 'Every order is checked against your commission plan and against what the statements really paid. Missing orders, short payments, error charges and refunds become dispute cases automatically. Nothing is approved or posted for you.')}
        right={<><ButtonLink href="/money/statements" variant="outline" icon={<FileUp className="size-4" />}>{t('Importer un relevé', 'Import a statement')}</ButtonLink>{can('finance:edit') && <Button loading={busy} onClick={recheck} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>}</>} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <Hint id="money.period"><FilterBar filters={filters} set={set} locations={locations} showBrands={false} presets={['yesterday', '7d', '30d', 'month', 'last_month', 'custom']} /></Hint>
      {data && data.imports === 0 && <Banner tone="info" className="mb-4" action={<ButtonLink href="/money/statements" variant="outline" size="md" className="shrink-0">{t('Importer', 'Import')}</ButtonLink>}>{t('Aucun relevé importé : les montants attendus sont calculés, mais rien ne peut être marqué absent ou payé en moins avant un import.', 'No statement imported: expected payouts are calculated, but nothing can be marked missing or short-paid until you import one.')}</Banner>}
      {unconfirmed.length > 0 && <Banner tone="warn" className="mb-4" action={<ButtonLink href="/money/fees" variant="outline" size="md" className="shrink-0">{t('Vérifier', 'Check')}</ButtonLink>}>{t('Plan de commission non confirmé pour', 'Commission plan not confirmed for')} {unconfirmed.map((c) => c.label).join(', ')}.</Banner>}
      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            {/* The dark hero only when there is money to recover. The calm green "all settled" card only when statements
                really covered the period: with no import, or orders no statement covers yet, nothing was checked. */}
            <Hint id="money.recover">{data.totals.missingMoney > 0
              ? <StatTile hero label={t('Argent à récupérer', 'Money to recover')} value={cad(data.totals.missingMoney, loc)} note={`${plural(t, problems.filter((o) => toRecover(o) > 0).length, ['commande', 'commandes'], ['order', 'orders'])} · ${plural(t, cases?.count ?? 0, ['litige ouvert', 'litiges ouverts'], ['open case', 'open cases'])}`} />
              : data.imports === 0 || notCovered > 0
                ? <div className="flex h-full flex-col justify-center rounded-md border border-line bg-surface p-5 shadow-card"><div className="text-heading text-ink">{data.imports === 0 ? t('Pas encore vérifié', 'Not checked yet') : t('Rien à récupérer pour l’instant', 'Nothing to recover so far')}</div><div className="text-small mt-1 text-ink-2">{data.imports === 0 ? t('Importez un relevé pour vérifier cette période.', 'Import a statement to check this period.') : plural(t, notCovered, ['commande pas encore couverte par un relevé.', 'commandes pas encore couvertes par un relevé.'], ['order not covered by a statement yet.', 'orders not covered by a statement yet.'])}</div></div>
                : <div className="flex h-full flex-col justify-center rounded-md border border-go/30 bg-go-soft p-5"><div className="text-heading flex items-center gap-2 text-go-2"><CheckCircle2 className="size-5" aria-hidden />{t('Tout est réglé', 'All settled')}</div><div className="text-small mt-1 text-ink-2">{t('Aucun argent à récupérer pour cette période.', 'No money to recover in this period.')}</div></div>}</Hint>
            <StatTile label={t('Payé par les plateformes', 'Paid by the platforms')} value={cad(data.totals.paid, loc)} />
            <StatTile label={t('Attendu pour ces commandes', 'Expected for those orders')} value={cad(data.totals.expected, loc)} />
            <Hint id="money.diff"><StatTile label={t('Écart', 'Difference')} value={signed(data.totals.diff, loc)} note={t('payé − attendu', 'paid − expected')} /></Hint>
            <Hint id="money.unknown"><StatTile label={t('Payées mais inconnues', 'Paid but unknown')} value={fmtInt(data.totals.unknownOrders)} note={t('webhook manqué ou magasin non branché', 'missed webhook or unmapped store')} /></Hint>
            <StatTile label={t('Autres frais et crédits', 'Other charges & credits')} value={signed(data.totals.otherCharges, loc)} note={t('pubs, tablettes, ajustements', 'ads, tablets, adjustments')} />
          </div>
          <Card className="mb-5">
            <CardHeader title={t('Par plateforme', 'By platform')} subtitle={`${t('Vérifié', 'Checked')} ${new Date(data.generatedAt).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}`} />
            <Table>
              <thead><tr><Th>{t('Plateforme', 'Platform')}</Th><Th align="right">{t('Cmd', 'Orders')}</Th><Th align="right">{t('Ventes', 'Sales')}</Th><Th align="right">{t('Attendu', 'Expected')}</Th><Th align="right">{t('Payé', 'Paid')}</Th><Th align="right">{t('Écart', 'Diff.')}</Th><Th align="right">{t('À récupérer', 'To recover')}</Th><Th>{t('Relevés jusqu’au', 'Statements to')}</Th><Th>{t('Plan', 'Plan')}</Th></tr></thead>
              <tbody>{data.channels.map((c) => (
                <Tr key={c.channel}>
                  <Td><PlatformTag channel={c.channel} /></Td><Td align="right">{fmtInt(c.orders)}</Td><Td align="right">{cad(c.sales, loc)}</Td><Td align="right">{cad(c.expected, loc)}</Td><Td align="right">{cad(c.paid, loc)}</Td><Td align="right">{signed(c.diff, loc)}</Td>
                  <Td align="right" className={c.missingMoney ? 'font-bold text-stop' : ''}>{cad(c.missingMoney, loc)}</Td>
                  <Td className="text-ink-3">{c.coveredUntil ? dayOf(c.coveredUntil, loc) : t('aucun', 'none')}</Td>
                  <Td>{c.planConfirmed ? <span className="font-semibold text-go-2">✓</span> : <Link href="/money/fees" className="font-semibold text-wait-2 underline">{t('à confirmer', 'confirm')}</Link>}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          </Card>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('À récupérer par plateforme', 'To recover by platform')} table={{ columns: [t('Plateforme', 'Platform'), '$', ''], rows: recoverRows.map((r) => [r.label, r.value.toFixed(2), r.detail]), filename: 'money-to-recover' }}><HBars rows={recoverRows} format={(n) => cad(n, loc)} empty={t('Rien à récupérer. 👍', 'Nothing to recover. 👍')} /></ChartCard>
            <ChartCard title={t('Commandes par statut de paiement', 'Orders by payout status')} table={{ columns: [t('Statut', 'Status'), t('Commandes', 'Orders')], rows: statusRows.map((r) => [r.label, r.value]), filename: 'payout-status' }}><HBars rows={statusRows} format={fmtInt} /></ChartCard>
          </div>
          <Card>
            <CardHeader title={t('Plus gros problèmes', 'Biggest problems')} right={<><ButtonLink href="/money/reconciliation" variant="ghost" size="sm">{t('Toutes les commandes', 'All orders')} →</ButtonLink><ButtonLink href="/money/disputes" variant="ghost" size="sm">{t('Litiges', 'Disputes')}{cases ? ` (${cases.count})` : ''} →</ButtonLink></>} />
            {problems.length === 0 ? <EmptyState compact icon={<CheckCircle2 className="size-6" />} title={t('Aucun problème', 'No problem')} body={t('Aucune commande absente ou payée en moins pour cette période.', 'No missing or short-paid order in this period.')} action={<ButtonLink href="/money/statements" variant="outline" icon={<FileUp className="size-4" />}>{t('Importer un relevé', 'Import a statement')}</ButtonLink>} /> : (
              <Table>
                <thead><tr><Th>Date</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Commande', 'Order')}</Th><Th>{t('Marque · succursale', 'Brand · location')}</Th><Th align="right">{t('Attendu', 'Expected')}</Th><Th align="right">{t('Payé', 'Paid')}</Th><Th align="right">{t('À récupérer', 'To recover')}</Th><Th>{t('Statut', 'Status')}</Th><Th>{t('Litige', 'Dispute')}</Th></tr></thead>
                <tbody>{problems.slice(0, 10).map((o) => (
                  <Tr key={o.orderId}>
                    <Td className="text-ink-3">{dayOf(o.date, loc)}</Td><Td><PlatformTag channel={o.channel} /></Td><Td><Link href={`/orders?open=${o.orderId}`} className="font-bold underline-offset-4 hover:underline">#{o.displayId}</Link></Td>
                    <Td className="text-ink-2">{o.brandName ?? '—'} · {o.locationCode ? shortLoc(locName(o.locationCode)) : '—'}</Td><Td align="right">{cad(o.expected.net, loc)}</Td><Td align="right">{cad(o.actual, loc)}</Td>
                    <Td align="right" className="font-bold text-stop">{toRecover(o) ? cad(toRecover(o), loc) : '—'}</Td><Td><ReconBadge status={o.status} /></Td><Td>{o.caseStatus ? <CaseBadge status={o.caseStatus} /> : '—'}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
        </>
      )}
      {!data && !err && <SkeletonStats count={6} />}
    </div>
  );
}
