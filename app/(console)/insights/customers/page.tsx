'use client';

import { useEffect, useState } from 'react';
import { Banner, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Segmented } from '@/components/ui/tabs';
import { ChartCard, fmtInt, fmtMoney, HBars, StatTile } from '@/components/charts/charts';
import { usePulse } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { api } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { CustomerInsights, CustomerTier, DirectMode } from '@/lib/foodhub/customer-insights';

const DIRECT_KEYS: DirectMode[] = ['include', 'exclude', 'only'];

export default function CustomersInsightsPage() {
  const { t } = useI18n();
  const { locations, brands } = useViewer();
  const { scope, brands: brandScope } = usePulse();
  const { filters, set, query } = useFilters('30d', scope, brandScope);
  const [direct, setDirectState] = useState<DirectMode | ''>('');
  const [data, setData] = useState<CustomerInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // The "All / Platforms / Direct" choice lives in the URL too, so a view can be shared as a link.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('direct');
    if (v && DIRECT_KEYS.includes(v as DirectMode)) setDirectState(v as DirectMode);
  }, []);
  const setDirect = (v: DirectMode) => {
    setDirectState(v);
    const q = new URLSearchParams(window.location.search);
    q.set('direct', v);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  };

  const fullQuery = direct ? `${query}&direct=${direct}` : query;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<CustomerInsights>(`/api/foodhub/customer-insights?${fullQuery}`).then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [fullQuery]);

  const tierLabel = (k: CustomerTier) => ({ new: t('Nouveaux', 'New'), occasional: t('Occasionnels', 'Occasional'), frequent: t('Fidèles', 'Frequent') }[k]);
  const tierOne = (k: CustomerTier) => ({ new: t('Nouveau', 'New'), occasional: t('Occasionnel', 'Occasional'), frequent: t('Fidèle', 'Frequent') }[k]);
  const chanLabel = (key: string, label: string) => (key === 'direct' ? t('Commandes directes', 'Direct orders') : label);
  const brandLabel = (b: { brand: string; unmapped: boolean }) => (b.unmapped ? t('Magasin non relié', 'Unmapped store') : b.brand);
  const pctTxt = (n: number) => t(`${n} %`, `${n}%`);
  const shown = (direct || (filters.channels.length ? 'exclude' : 'include')) as DirectMode;
  const tierNote: Record<CustomerTier, string> = {
    new: t('Aucune commande dans les 180 jours avant la période.', 'No order in the 180 days before the period.'),
    occasional: t('1 à 3 commandes en 90 jours.', '1 to 3 orders in 90 days.'),
    frequent: t('4 commandes ou plus en 90 jours.', '4 or more orders in 90 days.'),
  };

  return (
    <div>
      <PageHeader title={t('Clients', 'Customers')} subtitle={t('Nouveaux, occasionnels et fidèles — sur toutes vos plateformes et vos commandes directes.', 'New, occasional and frequent — across all your platforms and direct orders.')}
        right={<Segmented value={shown} onChange={setDirect} options={[{ key: 'include', label: t('Tout', 'All') }, { key: 'exclude', label: t('Plateformes', 'Platforms') }, { key: 'only', label: t('Directes', 'Direct') }]} />} />
      <InsightsTabs />
      <FilterBar filters={filters} set={set} locations={locations} brands={brands} />
      {error && <Banner tone="stop" className="mb-4">{error}</Banner>}
      {data?.range.truncated && (data.range.periodComplete
        ? <Banner tone="warn" className="mb-4">{t('Historique de 180 jours incomplet (trop de commandes) : les chiffres « nouveaux » et « à reconquérir » sont approximatifs. Filtrez par cuisine ou par marque pour un compte exact.', 'The 180-day history is incomplete (too many orders): the new and lapsed figures are approximate. Filter by kitchen or brand for an exact count.')}</Banner>
        : <Banner tone="warn" className="mb-4">{t('Beaucoup de commandes : seules les plus récentes de la période sont comptées. Filtrez par cuisine ou par marque, ou choisissez une période plus courte.', 'Many orders: only the most recent in the period are counted. Filter by kitchen or brand, or pick a shorter period.')}</Banner>)}
      {!data && !error && <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-sunken" />)}</div>}
      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile hero label={t('Clients identifiés', 'Identified customers')} value={fmtInt(data.totals.customers)} note={t(`${data.totals.coveragePct} % des commandes`, `${data.totals.coveragePct}% of orders`)} />
            <StatTile label={t('Taux de retour', 'Repeat rate')} value={pctTxt(data.repeatRate)} />
            <StatTile label={t('Clients multi-marques', 'Multi-brand customers')} value={fmtInt(data.multiBrand.customers)} note={`${pctTxt(data.multiBrand.pct)} · ${fmtMoney(data.multiBrand.sales)}`} />
            <StatTile label={t('À reconquérir (90 j)', 'Lapsed (90 days)')} value={fmtInt(data.lapsed.customers)} note={fmtMoney(data.lapsed.salesBefore)} />
          </div>
          {data.totals.customers === 0 ? (
            <Card className="mb-5"><EmptyState title={t('Aucun client identifié pour cette période. Les plateformes ne partagent pas toujours l’identifiant du client.', 'No identified customers in this period. Platforms do not always share a customer id.')} /></Card>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                {(['new', 'occasional', 'frequent'] as const).map((k) => {
                  const s = data.tiers[k];
                  return (
                    <Card key={k} className="p-4">
                      <div className="text-sm font-semibold text-ink">{tierLabel(k)}</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{fmtInt(s.customers)}</div>
                      <div className="mt-1 text-xs text-ink-3">{t(`${s.pctSales} % des ventes · panier moyen ${fmtMoney(s.aov)}`, `${s.pctSales}% of sales · average order ${fmtMoney(s.aov)}`)}</div>
                      <p className="mt-2 text-xs text-ink-3">{tierNote[k]}</p>
                    </Card>
                  );
                })}
              </div>
              <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                <ChartCard title={t('Par plateforme', 'By platform')}
                  table={{ columns: [t('Plateforme', 'Platform'), t('Commandes', 'Orders'), t('Identifiées', 'Identified'), '%', t('Clients', 'Customers'), t('Nouveaux', 'New'), t('Occasionnels', 'Occasional'), t('Fidèles', 'Frequent'), t('Ventes', 'Sales')], rows: data.byChannel.map((c) => [chanLabel(c.key, c.label), c.orders, c.identifiedOrders, pctTxt(c.coveragePct), c.customers, c.new, c.occasional, c.frequent, fmtMoney(c.sales)]), filename: 'takatak-customers-platform' }}>
                  <HBars rows={data.byChannel.map((c) => ({ label: chanLabel(c.key, c.label), value: c.customers, detail: `${t(`${c.new} nouv. · ${c.occasional} occ. · ${c.frequent} fid.`, `${c.new} new · ${c.occasional} occ. · ${c.frequent} freq.`)} · ${t('identifiées', 'identified')} ${pctTxt(c.coveragePct)}` }))} format={fmtInt} />
                </ChartCard>
                <ChartCard title={t('Par marque', 'By brand')}
                  table={{ columns: [t('Marque', 'Brand'), t('Clients', 'Customers'), t('Nouveaux', 'New'), t('Occasionnels', 'Occasional'), t('Fidèles', 'Frequent'), t('Taux de retour', 'Repeat rate'), t('Ventes', 'Sales')], rows: data.byBrand.map((b) => [brandLabel(b), b.customers, b.new, b.occasional, b.frequent, pctTxt(b.repeatRate), fmtMoney(b.sales)]), filename: 'takatak-customers-brand' }}>
                  <HBars rows={data.byBrand.map((b) => ({ label: brandLabel(b), value: b.customers, detail: `${t('retour', 'repeat')} ${pctTxt(b.repeatRate)}` }))} format={fmtInt} />
                </ChartCard>
              </div>
              <ChartCard className="mb-5" title={t('Meilleurs clients (anonymisés)', 'Top customers (anonymized)')}
                table={{ columns: [t('Code', 'Code'), t('Type', 'Type'), t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Panier', 'Avg'), t('Première', 'First'), t('Dernière', 'Last'), t('Plateformes', 'Platforms'), t('Marques', 'Brands')], rows: data.top.map((c) => [c.id, tierOne(c.tier), c.orders, fmtMoney(c.sales), fmtMoney(c.aov), c.firstOrder, c.lastOrder, c.channels.map((k) => (k === 'direct' ? t('Directes', 'Direct') : data.byChannel.find((r) => r.key === k)?.label ?? k)).join(', '), c.brands.join(', ')]), filename: 'takatak-top-customers' }}>
                <HBars rows={data.top.slice(0, 10).map((c) => ({ label: `${c.id} · ${tierOne(c.tier)}`, value: c.sales, detail: `${c.orders} ${t('cmd', 'orders')} · ${c.brands.length} ${t('marque(s)', 'brand(s)')}` }))} format={fmtMoney} />
              </ChartCard>
            </>
          )}
          <p className="text-xs text-ink-3">{t('Aucun nom, téléphone ni adresse n’est affiché : chaque client a un code anonyme.', 'No name, phone or address is shown: each customer has an anonymous code.')}</p>
        </div>
      )}
    </div>
  );
}
