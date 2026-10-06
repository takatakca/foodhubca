'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Link2 } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Button, buttonClass } from '@/components/ui/button';
import { Banner, PageHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Segmented } from '@/components/ui/tabs';
import { ChartCard, Columns, CompareLine, compactMoney, fmtInt, fmtMoney, HBars, Heatmap, LineLegend, StatTile, VIZ } from '@/components/charts/charts';
import { usePulse } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from './insights-tabs';
import { api } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { Analytics } from '@/lib/foodhub/analytics';

type Group = Omit<Analytics['byChannel'][number], 'key'> & { key: string };

export default function InsightsPage() {
  const { t, loc } = useI18n();
  const { locations, brands } = useViewer();
  const { scope } = usePulse();
  const { filters, set, query } = useFilters('7d', scope);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<'sales' | 'orders'>('sales');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Analytics>(`/api/foodhub/analytics?${query}`).then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [query]);
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(loc, { month: 'short', day: 'numeric' });
  const mins = (n: number) => (n >= 120 ? `${(n / 60).toFixed(1)} h` : `${Math.round(n)} min`);
  const points = useMemo(() => (data?.daily ?? []).map((d) => ({ label: d.date, cur: metric === 'sales' ? d.sales : d.orders, prev: metric === 'sales' ? d.prevSales : d.prevOrders })), [data, metric]);
  const k = data?.kpis;
  const table = (rows: Group[], name: string) => ({ columns: [name, t('Ventes', 'Sales'), t('Commandes', 'Orders'), t('Panier', 'Avg'), '%', t('vs préc. %', 'vs prev %'), t('Annulées', 'Cancelled'), t('Perdu', 'Lost')], rows: rows.map((g) => [g.label, fmtMoney(g.sales), g.orders, fmtMoney(g.aov), `${g.share}%`, `${g.change > 0 ? '+' : ''}${g.change}%`, g.lostOrders, fmtMoney(g.lostRevenue)]), filename: `takatak-${name}` });
  const bars = (rows: Group[]) => rows.map((g) => ({ label: g.label, value: g.sales, detail: `${g.orders} ${t('cmd', 'orders')} · ${g.share}% · ${g.change > 0 ? '+' : ''}${g.change}%` }));
  const WHO: Record<string, string> = { store: t('Vous (magasin)', 'You (store)'), platform: t('Plateforme', 'Platform'), customer: t('Client', 'Customer'), unknown: t('Non précisé', 'Not reported') };
  const STAGE: Record<string, string> = { before_accept: t('Avant acceptation', 'Before accepting'), after_accept: t('Après acceptation', 'After accepting'), unknown: t('Non précisé', 'Not reported') };

  return (
    <div>
      <PageHeader title={t('Analyses', 'Insights')} subtitle={t('Chaque chiffre est comparé à la période précédente de même durée. Les commandes annulées sont des ventes perdues.', 'Every number is compared with the previous period of the same length. Cancelled orders count as lost sales.')}
        right={<><Button variant="outline" onClick={() => navigator.clipboard?.writeText(window.location.href)} icon={<Link2 className="size-4" />}>{t('Copier le lien', 'Copy link')}</Button><Hint id="insights.export"><a className={buttonClass('outline', 'md')} href={`/api/foodhub/reports/order_transactions?format=xlsx&${query}`}><Download className="size-4" />Excel</a></Hint></>} />
      <InsightsTabs />
      <Hint id="insights.period"><FilterBar filters={filters} set={set} locations={locations} brands={brands} /></Hint>
      {error && <Banner tone="stop" className="mb-4">{error}</Banner>}
      {!data && !error && <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-sunken" />)}</div>}
      {data && k && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <Hint id="insights.kpis"><div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile hero label={t('Ventes', 'Sales')} value={fmtMoney(k.sales.value)} change={k.sales.change} previous={fmtMoney(k.sales.previous)} />
            <StatTile label={t('Commandes', 'Orders')} value={fmtInt(k.orders.value)} change={k.orders.change} previous={fmtInt(k.orders.previous)} />
            <StatTile label={t('Panier moyen', 'Average order')} value={fmtMoney(k.aov.value)} change={k.aov.change} previous={fmtMoney(k.aov.previous)} />
            <StatTile label={t('Ventes perdues (annulées)', 'Lost sales (cancelled)')} value={fmtMoney(k.lostRevenue.value)} change={k.lostRevenue.change} previous={fmtMoney(k.lostRevenue.previous)} upIsGood={false} note={`${k.lostOrders.value} ${t('cmd', 'orders')} · ${k.cancelRate.value}%`} />
            <StatTile label={t('Temps pour accepter', 'Time to accept')} value={mins(k.avgAcceptMin.value)} change={k.avgAcceptMin.change} previous={mins(k.avgAcceptMin.previous)} upIsGood={false} note={`${k.autoAcceptRate.value}% ${t('automatique', 'automatic')}`} />
            <StatTile label={t('Temps de préparation', 'Prep time')} value={k.avgPrepMin.value ? mins(k.avgPrepMin.value) : '—'} change={k.avgPrepMin.value ? k.avgPrepMin.change : undefined} previous={mins(k.avgPrepMin.previous)} upIsGood={false} note={t('acceptée → prête', 'accepted → ready')} />
            <StatTile label={t('Magasins ouverts (heures)', 'Store uptime (open hours)')} value={`${data.uptime.overallPct}%`} note={`${mins(data.uptime.offlineMinutes)} ${t('hors ligne', 'offline')}`} />
            <StatTile label={t('Reçues dans Clover', 'Reached Clover')} value={`${k.cloverRate.value}%`} change={k.cloverRate.change} previous={`${k.cloverRate.previous}%`} />
          </div></Hint>
          <ChartCard className="mb-5" title={metric === 'sales' ? t('Ventes par jour', 'Sales per day') : t('Commandes par jour', 'Orders per day')} subtitle={`${fmtDay(data.range.from)} – ${fmtDay(new Date(Date.parse(data.range.to) - 1).toISOString())}`}
            legend={<><LineLegend items={[{ label: t('Cette période', 'This period'), color: VIZ.series }, { label: t('Période précédente', 'Previous period'), color: VIZ.compare, dash: true }]} /><Hint id="insights.metric"><Segmented size="sm" value={metric} onChange={setMetric} options={[{ key: 'sales', label: t('Ventes', 'Sales') }, { key: 'orders', label: t('Commandes', 'Orders') }]} /></Hint></>}
            table={{ columns: ['Date', t('Ventes', 'Sales'), t('Commandes', 'Orders'), t('Ventes préc.', 'Prev sales'), t('Cmd préc.', 'Prev orders')], rows: data.daily.map((d) => [d.date, fmtMoney(d.sales), d.orders, fmtMoney(d.prevSales), d.prevOrders]), filename: 'takatak-daily' }}>
            {data.daily.length < 2 ? <div className="py-10 text-center text-sm text-ink-3">{t('Choisissez 2 jours ou plus pour voir la tendance.', 'Pick 2 days or more to see the trend.')}</div>
              : <CompareLine points={points} curLabel={t('Cette période', 'This period')} prevLabel={t('Période précédente', 'Previous period')} format={metric === 'sales' ? fmtMoney : (n) => `${fmtInt(n)}`} axisFormat={metric === 'sales' ? compactMoney : fmtInt} />}
          </ChartCard>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Par plateforme', 'By platform')} table={table(data.byChannel, 'platform')}><HBars rows={bars(data.byChannel)} format={fmtMoney} /></ChartCard>
            <ChartCard title={t('Par succursale', 'By location')} table={table(data.byLocation, 'location')}><HBars rows={bars(data.byLocation)} format={fmtMoney} /></ChartCard>
          </div>
          <ChartCard className="mb-5" title={t('Par marque', 'By brand')} subtitle={`${data.byBrand.length} ${t('marques', 'brands')}`} table={table(data.byBrand, 'brand')}><HBars rows={bars(data.byBrand)} format={fmtMoney} /></ChartCard>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Heures de pointe', 'Busiest hours')} subtitle={t('Commandes par jour et par heure (Montréal)', 'Orders by day and hour (Montréal)')} table={{ columns: ['', ...Array.from({ length: 24 }, (_, h) => `${h}h`)], rows: data.heatmap.map((r, d) => [['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][d], ...r]), filename: 'takatak-heatmap' }}><Heatmap grid={data.heatmap} /></ChartCard>
            <ChartCard title={t('Taille des commandes', 'Order size')} table={{ columns: [t('Total', 'Total'), t('Commandes', 'Orders')], rows: data.aovBuckets.map((b) => [b.label, b.orders]), filename: 'takatak-order-size' }}><Columns rows={data.aovBuckets.map((b) => ({ label: b.label, value: b.orders }))} format={fmtInt} /></ChartCard>
          </div>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Annulations — par qui', 'Cancellations — by whom')} subtitle={`${data.cancellations.total} · ${fmtMoney(data.cancellations.lostRevenue)}`} table={{ columns: [t('Qui', 'Who'), t('Commandes', 'Orders')], rows: Object.entries(data.cancellations.byWho).map(([w, n]) => [WHO[w] ?? w, n]), filename: 'takatak-cancel-who' }}>
              <HBars rows={Object.entries(data.cancellations.byWho).filter(([, n]) => n > 0).map(([w, n]) => ({ label: WHO[w] ?? w, value: n }))} format={fmtInt} empty={t('Aucune annulation. 👏', 'No cancellations. 👏')} />
              {data.cancellations.total > 0 && <div className="mt-3 text-xs text-ink-3">{Object.entries(data.cancellations.byStage).filter(([, n]) => n > 0).map(([s, n]) => `${STAGE[s] ?? s} : ${n}`).join(' · ')}</div>}
            </ChartCard>
            <ChartCard title={t('Raisons d’annulation', 'Cancellation reasons')} table={{ columns: [t('Raison', 'Reason'), t('Commandes', 'Orders')], rows: data.cancellations.reasons.map((r) => [r.reason, r.count]), filename: 'takatak-cancel-reasons' }}><HBars rows={data.cancellations.reasons.map((r) => ({ label: r.reason, value: r.count }))} format={fmtInt} empty={t('Aucune annulation. 👏', 'No cancellations. 👏')} /></ChartCard>
          </div>
          <ChartCard className="mb-5" title={t('Meilleurs articles', 'Top items')} subtitle={t('Par revenu, avec la variation de quantité', 'By revenue, with the quantity change')} table={{ columns: [t('Article', 'Item'), t('Marque', 'Brand'), t('Qté', 'Qty'), t('Revenu', 'Revenue'), t('Cmd', 'Orders'), '%'], rows: data.items.map((i) => [i.name, i.brand, i.qty, fmtMoney(i.revenue), i.orders, `${i.change > 0 ? '+' : ''}${i.change}%`]), filename: 'takatak-top-items' }}>
            <HBars rows={data.items.slice(0, 15).map((i) => ({ label: `${i.name}${i.brand ? ` · ${i.brand}` : ''}`, value: i.revenue, detail: `${i.qty} · ${i.change > 0 ? '+' : ''}${i.change}%` }))} format={fmtMoney} />
            {data.lostItems.length > 0 && <p className="mt-3 text-xs text-ink-3">{t('Souvent dans les commandes annulées :', 'Often in cancelled orders:')} {data.lostItems.slice(0, 5).map((i) => `${i.name} (${i.qty})`).join(', ')}</p>}
          </ChartCard>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Disponibilité pendant les heures d’ouverture', 'Uptime during opening hours')} subtitle={t('Les plus bas d’abord', 'Lowest first')} table={{ columns: [t('Plateforme', 'Platform'), t('Marque', 'Brand'), t('Succursale', 'Location'), t('Heures', 'Hours'), t('Ouvert (min)', 'Open (min)'), t('Hors ligne (min)', 'Offline (min)'), '%'], rows: data.uptime.stores.map((u) => [u.label, u.brandName, u.location, u.hoursSet ? '✓' : '24/7', u.openMinutes, u.offlineMinutes, `${u.uptimePct}%`]), filename: 'takatak-uptime' }}>
              <HBars rows={data.uptime.stores.slice(0, 12).map((u) => ({ label: `${u.label} · ${u.brandName} · ${u.location}`, value: u.uptimePct, detail: `${mins(u.offlineMinutes)} ${t('hors ligne', 'offline')}` }))} format={(n) => `${n}%`} empty={t('Aucun magasin branché.', 'No store connected.')} />
            </ChartCard>
            <ChartCard title={t('Clients', 'Customers')} subtitle={t('Quand la plateforme partage un identifiant client', 'When the platform shares a customer id')} table={{ columns: ['', ''], rows: [[t('Identifiés', 'Identified'), data.customers.identified], [t('Nouveaux', 'New'), data.customers.newCustomers], [t('Fidèles', 'Returning'), data.customers.repeatCustomers], ['%', `${data.customers.repeatRate}%`]], filename: 'takatak-customers' }}>
              <div className="grid grid-cols-2 gap-3"><StatTile label={t('Nouveaux clients', 'New customers')} value={fmtInt(data.customers.newCustomers)} /><StatTile label={t('Clients fidèles', 'Returning customers')} value={fmtInt(data.customers.repeatCustomers)} note={`${data.customers.repeatRate}%`} /></div>
              <p className="mt-3 text-xs text-ink-3">{t(`Identifiant client sur ${data.customers.coveragePct} % des commandes.`, `Customer id on ${data.customers.coveragePct}% of orders.`)}</p>
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
