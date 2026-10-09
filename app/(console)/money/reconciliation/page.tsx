'use client';

// Orders vs payouts — every order, what it should have paid and what the statement did pay.
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, Search } from 'lucide-react';
import { PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, Card, CardHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { statusLabel } from '@/components/live/order-drawer';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { usePulse } from '@/components/live/pulse';
import { CH_NAME, CaseBadge, MoneyHead, PROBLEM, ReconBadge, cad, reconLabel, signed, toRecover, type OrderRecon, type Recon, type ReconStatus, type Unmatched } from '../money-ui';
import { api, dayOf, downloadCsv } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { cn } from '@/lib/ui/cn';

type View = 'problems' | 'all' | 'matched' | 'waiting' | 'statement';
const inView = (v: View, s: ReconStatus) => v === 'all' || (v === 'problems' && PROBLEM.includes(s)) || (v === 'matched' && (s === 'matched' || s === 'cancelled')) || (v === 'waiting' && (s === 'pending' || s === 'not_covered'));
const PAGE = 300;

export default function ReconciliationPage() {
  const { t, loc } = useI18n();
  const { locations, locName } = useViewer();
  const { scope } = usePulse();
  const { filters, set, query } = useFilters('30d', scope);
  const [view, setView] = useState<View>('problems');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Recon | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => { const v = new URLSearchParams(window.location.search).get('view') as View | null; if (v && ['problems', 'all', 'matched', 'waiting', 'statement'].includes(v)) setView(v); }, []);
  const load = useCallback(() => api<Recon>(`/api/foodhub/recon?${query}`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLimit(PAGE); }, [view, search, query]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '');
    return (data?.orders ?? [])
      .filter((o) => inView(view, o.status))
      .filter((o) => !q || o.displayId.toLowerCase().includes(q) || o.ref.toLowerCase().includes(q) || (o.brandName ?? '').toLowerCase().includes(q))
      .sort((a, b) => (view === 'problems' ? toRecover(b) - toRecover(a) : 0) || b.date.localeCompare(a.date));
  }, [data, view, search]);
  const count = (v: View) => (v === 'statement' ? (data?.unmatched.length ?? 0) + (data?.other.length ?? 0) : (data?.orders ?? []).filter((o) => inView(v, o.status)).length);

  function exportCsv() {
    downloadCsv(`commandes-vs-paiements-${filters.from}-${filters.to}`, [
      [t('Date', 'Date'), t('Plateforme', 'Platform'), t('Commande', 'Order'), t('No plateforme', 'Platform order id'), t('Marque', 'Brand'), t('Succursale', 'Location'), t('Mode', 'Fulfillment'), t('Payé par le client', 'Customer paid'), t('Ventes nourriture', 'Food sales'), t('Taxes', 'Tax'), t('Commission %', 'Commission %'), t('Commission', 'Commission'), t('Taxes sur commission', 'Tax on commission'), t('Frais fixes', 'Fixed fee'), t('Paiement attendu', 'Expected payout'), t('Payé', 'Paid'), t('Écart', 'Difference'), t('À récupérer', 'To recover'), t('Statut', 'Status'), t('Date du paiement', 'Payout date')],
      ...rows.map((o) => [dayOf(o.date, loc), CH_NAME[o.channel] ?? o.channel, o.displayId, o.ref, o.brandName ?? '', o.locationCode ?? '', o.fulfillment, o.total.toFixed(2), o.expected.sales.toFixed(2), o.expected.tax.toFixed(2), o.expected.ratePct, o.expected.commission.toFixed(2), o.expected.commissionTax.toFixed(2), o.expected.fixedFee.toFixed(2), o.expected.net.toFixed(2), o.actual?.toFixed(2) ?? '', o.diff?.toFixed(2) ?? '', toRecover(o).toFixed(2), reconLabel(t, o.status), o.payoutDate ?? '']),
    ]);
  }

  return (
    <div>
      <MoneyHead title={t('Commandes vs paiements', 'Orders vs payouts')} intro={t('Chaque commande acceptée avec son paiement attendu (prix client − commission − taxes sur commission) à côté de ce que le relevé de la plateforme a payé. Cliquez une commande pour voir le calcul.', 'Each accepted order with its expected payout (customer price − commission − tax on commission) next to what the platform statement paid. Click an order to see the calculation.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      <FilterBar filters={filters} set={set} locations={locations} showBrands={false} presets={['yesterday', '7d', '30d', 'month', 'last_month', 'custom']} extra={<>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input inputSize="sm" type="search" className="w-48 pl-8" placeholder={t('No ou marque', 'Order # or brand')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('Chercher', 'Search')} />
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length} icon={<Download className="size-4" />}>CSV</Button>
      </>} />
      <Tabs className="mb-4" value={view} onChange={setView} tabs={[
        { key: 'problems', label: t('Problèmes', 'Problems'), count: data ? count('problems') : null },
        { key: 'all', label: t('Toutes', 'All orders'), count: data ? count('all') : null },
        { key: 'matched', label: t('Payées comme prévu', 'Paid as expected'), count: data ? count('matched') : null },
        { key: 'waiting', label: t('Pas encore dues', 'Not due yet'), count: data ? count('waiting') : null },
        { key: 'statement', label: t('Seulement sur les relevés', 'Only on statements'), count: data ? count('statement') : null },
      ]} />

      {view === 'statement' ? <StatementOnly data={data} /> : (
        <Card>
          <Table>
            <thead><tr><Th className="w-8" /><Th>Date</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Commande', 'Order')}</Th><Th>{t('Marque · succursale', 'Brand · location')}</Th><Th align="right">{t('Client a payé', 'Customer paid')}</Th><Th align="right">{t('Attendu', 'Expected')}</Th><Th align="right">{t('Payé', 'Paid')}</Th><Th align="right">{t('Écart', 'Difference')}</Th><Th>{t('Statut', 'Status')}</Th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((o) => {
                const isOpen = open === o.orderId;
                return (
                  <Fragment key={o.orderId}>
                    <Tr className={cn('cursor-pointer', isOpen && 'bg-raised')} onClick={() => setOpen(isOpen ? null : o.orderId)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : o.orderId); } }} aria-expanded={isOpen}>
                      <Td><ChevronDown className={cn('size-4 text-ink-3 transition-transform', isOpen && 'rotate-180')} /></Td>
                      <Td className="whitespace-nowrap text-ink-3">{dayOf(o.date, loc)}</Td>
                      <Td><PlatformTag channel={o.channel} /></Td>
                      <Td className="font-bold">#{o.displayId}</Td>
                      <Td className="text-ink-2">{o.brandName ?? '—'} · {o.locationCode ? shortLoc(locName(o.locationCode)) : '—'}</Td>
                      <Td align="right">{cad(o.total, loc)}</Td>
                      <Td align="right">{cad(o.expected.net, loc)}</Td>
                      <Td align="right">{cad(o.actual, loc)}</Td>
                      <Td align="right" className={cn(o.diff !== null && o.diff < -0.01 && 'font-bold text-stop', o.diff !== null && o.diff > 0.01 && 'text-info-2')}>{signed(o.diff, loc)}</Td>
                      <Td><ReconBadge status={o.status} /></Td>
                    </Tr>
                    {isOpen && <tr className="bg-raised"><td colSpan={10} className="border-b border-line px-4 py-4"><Detail o={o} /></td></tr>}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-ink-3">{data ? (view === 'problems' ? t('Aucun problème dans cette période. 👍', 'No problem in this period. 👍') : t('Aucune commande dans cette vue.', 'No order in this view.')) : t('Chargement…', 'Loading…')}</td></tr>}
            </tbody>
          </Table>
          {rows.length > limit && <div className="p-3"><Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>{t('Afficher plus', 'Show more')} ({rows.length - limit})</Button></div>}
        </Card>
      )}
    </div>
  );
}

function Line({ label, value, total, minus }: { label: string; value: string; total?: boolean; minus?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4 py-1 text-[13px]', total && 'mt-1 border-t border-line-2 pt-2 font-extrabold text-ink')}>
      <span className={total ? '' : 'text-ink-2'}>{label}</span><span className={cn('num', minus && 'text-ink-2')}>{value}</span>
    </div>
  );
}

function Detail({ o }: { o: OrderRecon }) {
  const { t, loc } = useI18n();
  const e = o.expected;
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Paiement attendu', 'Expected payout')}</div>
        <Line label={t('Ventes nourriture (après vos promos)', 'Food sales (after your promotions)')} value={cad(e.sales, loc)} />
        <Line label={t('+ Taxes de vente (TPS + TVQ)', '+ Sales tax passed through (GST + QST)')} value={cad(e.tax, loc)} />
        <Line label={`− ${t('Commission', 'Commission')} ${e.ratePct} % (${o.fulfillment === 'pickup' ? t('à emporter', 'pickup') : t('livraison', 'delivery')})`} value={`−${cad(e.commission, loc)}`} minus />
        <Line label={t('− Taxes sur commission (récupérables)', '− Tax on commission (recoverable)')} value={`−${cad(e.commissionTax, loc)}`} minus />
        {e.fixedFee ? <Line label={t('− Frais fixes par commande', '− Fixed fee per order')} value={`−${cad(e.fixedFee, loc)}`} minus /> : null}
        <Line total label={t('Attendu', 'Expected')} value={cad(e.net, loc)} />
        {!o.planConfirmed && <p className="mt-2 text-xs text-wait-2">{t('Calculé avec la grille publique —', 'Uses the published rate card —')} <Link href="/money/fees" className="font-bold underline">{t('confirmez votre plan', 'confirm your plan')}</Link>.</p>}
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Ce que dit le relevé', 'What the statement says')}</div>
        <Line label={t('Lignes du relevé', 'Statement lines')} value={String(o.lines)} />
        <Line label={t('Payé (net)', 'Paid (net)')} value={cad(o.actual, loc)} />
        {o.refunds ? <Line label={t('Remboursements / rétrofacturations', 'Refunds / chargebacks')} value={cad(o.refunds, loc)} /> : null}
        {o.errorCharges ? <Line label={t('Frais d’erreur', 'Error charges')} value={cad(o.errorCharges, loc)} /> : null}
        {o.adjustments ? <Line label={t('Ajustements', 'Adjustments')} value={cad(o.adjustments, loc)} /> : null}
        <Line label={t('Date du paiement', 'Payout date')} value={o.payoutDate ? dayOf(o.payoutDate, loc) : '—'} />
        <Line total label={t('Écart', 'Difference')} value={signed(o.diff, loc)} />
        <p className="mt-2 text-xs leading-relaxed text-ink-2">{explain(t, o)}</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{t('Commande', 'Order')}</div>
        <Line label={t('No plateforme', 'Platform id')} value={o.ref.length > 18 ? `${o.ref.slice(0, 16)}…` : o.ref} />
        <Line label={t('Statut', 'Status')} value={statusLabel(t, o.orderStatus)} />
        <Line label={t('Client a payé', 'Customer paid')} value={cad(o.total, loc)} />
        {o.caseStatus && <div className="flex items-center justify-between py-1 text-[13px]"><span className="text-ink-2">{t('Litige', 'Dispute')}</span><CaseBadge status={o.caseStatus} /></div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/orders/${o.orderId}`} className="text-[13px] font-bold underline-offset-4 hover:underline">{t('Ouvrir la commande', 'Open the order')} →</Link>
          {toRecover(o) >= 1 && <Link href="/money/disputes" className="text-[13px] font-bold text-stop underline-offset-4 hover:underline">{t('Contester', 'Dispute')} ({cad(toRecover(o), loc)}) →</Link>}
        </div>
      </div>
    </div>
  );
}

function explain(t: T, o: OrderRecon) {
  switch (o.status) {
    case 'matched': return t('La plateforme a payé ce que votre plan prévoit.', 'The platform paid what your plan says it should.');
    case 'missing': return t('Cette commande est dans une période couverte par un relevé importé, mais aucune ligne ne la paie. Contestez-la auprès de la plateforme.', 'This order is inside a period covered by an imported statement, but no line pays it. Dispute it with the platform.');
    case 'short_paid': return t('Payée moins que prévu — vérifiez d’abord le plan de commission, puis contestez la différence.', 'Paid less than expected — check the commission plan first, then dispute the difference.');
    case 'over_paid': return t('Payée plus que prévu — souvent une promo payée par la plateforme, ou un taux différent sur ce magasin.', 'Paid more than expected — often a promotion the platform funded, or a different commission rate on this store.');
    case 'refunded': return t('La plateforme a remboursé le client et vous a repris l’argent. Contestez si la commande était correcte.', 'The platform refunded the customer and took the money back from you. Dispute it if the food was correct.');
    case 'error_charge': return t('La plateforme vous a facturé une erreur (article manquant, mauvaise commande…). Contestez si la commande était bonne.', 'The platform charged you for an error (missing item, wrong order…). Dispute it if the order was right.');
    case 'pending': return t('Pas encore payée — elle est encore dans le délai normal de paiement.', 'The platform has not paid this order yet — it is still inside the normal payout delay.');
    case 'not_covered': return t('Aucun relevé importé pour cette date. Importez le relevé pour la vérifier.', 'No statement imported for this date yet. Import the statement to check it.');
    case 'cancelled': return t('Annulée — rien n’est dû.', 'Cancelled — nothing is due.');
    default: return '';
  }
}

function StatementList({ rows, empty }: { rows: Unmatched[]; empty: string }) {
  const { t, loc } = useI18n();
  const kind = (k: string) => ({ order: t('Commande', 'Order'), refund: t('Remboursement', 'Refund'), adjustment: t('Ajustement', 'Adjustment'), error_charge: t('Frais d’erreur', 'Error charge'), promotion: t('Promotion', 'Promotion'), ads: t('Publicité', 'Ads'), fee: t('Frais', 'Fee'), other: t('Autre', 'Other') } as Record<string, string>)[k] ?? k;
  return (
    <Table>
      <thead><tr><Th>{t('Plateforme', 'Platform')}</Th><Th>{t('Date commande', 'Order date')}</Th><Th>{t('Date paiement', 'Payout date')}</Th><Th>{t('Référence', 'Reference')}</Th><Th>{t('Type', 'Type')}</Th><Th>{t('Description', 'Description')}</Th><Th align="right">{t('Montant', 'Amount')}</Th></tr></thead>
      <tbody>
        {rows.map((l) => (
          <Tr key={l.id}><Td><PlatformTag channel={l.channel} /></Td><Td className="text-ink-3">{l.orderDate ? dayOf(l.orderDate, loc) : '—'}</Td><Td className="text-ink-3">{l.payoutDate ? dayOf(l.payoutDate, loc) : '—'}</Td><Td className="font-mono text-xs">{l.ref ?? '—'}</Td><Td>{kind(l.kind)}</Td><Td className="max-w-80 text-ink-2">{l.description || '—'}</Td><Td align="right" className={l.net < 0 ? 'text-stop' : ''}>{signed(l.net, loc)}</Td></Tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-3">{empty}</td></tr>}
      </tbody>
    </Table>
  );
}

function StatementOnly({ data }: { data: Recon | null }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={t('Commandes payées que Food Hub n’a jamais reçues', 'Paid orders Food Hub never received')} subtitle={t('La plateforme a payé ces commandes mais Food Hub n’a aucune commande avec ce numéro : un webhook a été manqué, ou le magasin n’est pas encore branché. Vérifiez le jumelage des magasins.', 'The platform paid these orders but Food Hub has no order with that number: a webhook was missed, or the store is not connected yet. Check the store mapping.')} right={<Link href="/stores/mapping" className="text-[13px] font-bold underline-offset-4 hover:underline">{t('Jumelage', 'Mapping')} →</Link>} />
        <StatementList rows={data?.unmatched ?? []} empty={t('Aucune — chaque commande payée est dans Food Hub.', 'None — every paid order on the statements is in Food Hub.')} />
      </Card>
      <Card>
        <CardHeader title={t('Frais et crédits sans commande', 'Charges and credits without an order')} subtitle={t('Publicités, frais de tablette, frais mensuels, ajustements et crédits qui ne sont pas liés à une commande. Ils vont au grand livre sous « Publicités et autres frais de plateforme ».', 'Ads, tablet fees, monthly fees, adjustments and credits not tied to one order. They go to the ledger under “Ads & other platform charges”.')} />
        <StatementList rows={data?.other ?? []} empty={t('Aucun dans cette période.', 'None in this period.')} />
      </Card>
    </div>
  );
}
