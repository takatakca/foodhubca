'use client';

import { useEffect, useMemo, useState } from 'react';
import { buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Banner, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { ChartCard, Columns, fmtInt, fmtMoney, HBars, StatTile, VIZ } from '@/components/charts/charts';
import { usePulse } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { InsightsTabs } from '../insights-tabs';
import { api } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import type { MixGroupRow, SalesMix, SalesMixTableKey, SourceKey } from '@/lib/foodhub/sales-mix';

type Mix = SalesMix & { itemsTotal: number };
type View = 'all' | 'platforms' | 'direct';
const DIRECT_PARAM: Record<View, string | null> = { all: null, platforms: 'exclude', direct: 'only' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/** Day × hour grid for this page (translated day names, money or order counts); same look as the Insights heatmap. */
function SalesHeatmap({ grid, days, format, title, unit }: { grid: number[][]; days: string[]; format: (v: number) => string; title: string; unit: string }) {
  const max = Math.max(0, ...grid.flat());
  const color = (v: number) => (v <= 0 || max <= 0 ? VIZ.none : VIZ.ramp[Math.min(VIZ.ramp.length - 1, Math.floor((v / max) * (VIZ.ramp.length - 1)))]);
  const legend = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <div className="viz-wrap">
      <div className="viz-heat" role="grid" aria-label={title}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="viz-heat-h">{h % 3 === 0 ? h : ''}</span>)}
        {grid.map((row, d) => (
          <div key={d} className="viz-heat-row" role="row">
            <span className="viz-heat-d">{days[d]}</span>
            {row.map((v, h) => {
              const text = `${days[d]} ${h}h · ${format(v)} ${unit}`;
              return <span key={h} role="gridcell" tabIndex={0} aria-label={text} title={text} className="viz-heat-cell" style={{ background: color(v) }} />;
            })}
          </div>
        ))}
      </div>
      <div className="viz-heat-legend small">
        <span>−</span>
        {legend.map((v, i) => <span key={i} className="viz-heat-swatch" style={{ background: color(v) }} title={`${format(v)} ${unit}`} />)}
        <span>+ (max {format(max)})</span>
      </div>
    </div>
  );
}

export default function SalesMixPage() {
  const { t, lang } = useI18n();
  const { locations, brands } = useViewer();
  const { scope, brands: brandScope } = usePulse();
  const { filters, set, query } = useFilters('7d', scope, brandScope);
  const [view, setView] = useState<View>('all');
  const [heat, setHeat] = useState<'sales' | 'orders'>('sales');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<Mix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fullQuery = useMemo(() => { const d = DIRECT_PARAM[view]; return d ? `${query}&direct=${d}` : query; }, [query, view]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<Mix>(`/api/foodhub/sales-mix?limit=2000&${fullQuery}`).then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [fullQuery]);

  const label = (g: MixGroupRow) => (lang === 'en' ? g.labelEn : g.label);
  // A read hit the row cap: the change vs the previous period would be wrong, so it is hidden.
  const cmp = data?.range.comparable !== false;
  const vs = (n: number) => (cmp ? signed(n) : '—');
  const days = lang === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const exportLinks = (table: SalesMixTableKey) => (
    <div className="flex gap-2">
      <a className={buttonClass('outline', 'xs')} href={`/api/foodhub/sales-mix?format=xlsx&table=${table}&lang=${lang}&${fullQuery}`}>Excel</a>
      <a className={buttonClass('outline', 'xs')} href={`/api/foodhub/sales-mix?format=csv&table=${table}&lang=${lang}&${fullQuery}`}>CSV</a>
    </div>
  );
  const groupTable = (rows: MixGroupRow[], name: string, filename: string) => ({
    columns: [name, t('Ventes', 'Sales'), t('Commandes', 'Orders'), t('Panier', 'Avg'), '%', t('vs préc. %', 'vs prev %'), t('Annulées', 'Cancelled'), t('Perdu', 'Lost')],
    rows: rows.map((g) => [label(g), fmtMoney(g.sales), g.orders, fmtMoney(g.aov), `${g.share}%`, vs(g.change), g.lostOrders, fmtMoney(g.lostSales)]),
    filename,
  });
  const groupBars = (rows: MixGroupRow[]) => rows.map((g) => ({ label: label(g), value: g.sales, detail: `${g.orders} ${t('cmd', 'orders')} · ${g.share}%${cmp ? ` · ${signed(g.change)}` : ''}` }));

  const sourcesInItems = useMemo(() => (data ? data.bySource.map((s) => s.key as SourceKey).filter((k) => data.items.some((i) => (i.bySource[k] ?? 0) > 0)) : []), [data]);
  const sourceName = (k: SourceKey) => { const g = data?.bySource.find((s) => s.key === k); return g ? label(g) : k; };
  const shown = useMemo(() => {
    const n = norm(search);
    return (data?.items ?? []).filter((i) => !n || norm(i.name).includes(n) || norm(i.brand).includes(n));
  }, [data, search]);
  const k = data?.totals;
  const empty = data && k && k.orders === 0 && k.lostOrders === 0;

  return (
    <div>
      <PageHeader title={t('Ventes par article et par heure', 'Sales by item and hour')}
        subtitle={t('Toutes les plateformes et vos commandes directes. Ventes avant taxes, frais de livraison et pourboires.', 'Every platform and your direct orders. Sales before tax, delivery fees and tips.')} />
      <InsightsTabs />
      <FilterBar filters={filters} set={set} locations={locations} brands={brands} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[{ key: 'all', label: t('Tout', 'All') }, { key: 'platforms', label: t('Plateformes', 'Platforms') }, { key: 'direct', label: t('Directes', 'Direct') }]} />
        <span className="text-xs text-ink-3">{t('Les montants diffèrent de la page Analyses, qui compte les totaux des commandes.', 'Amounts differ from the Insights page, which counts order totals.')}</span>
      </div>
      {error && <Banner tone="stop" className="mb-4">{error}</Banner>}
      {data?.range.truncated && <Banner tone="warn" className="mb-4">{t('Trop de commandes pour cette période : seules les plus récentes sont comptées. Choisissez une période plus courte.', 'Too many orders for this period: only the newest are counted. Pick a shorter period.')}</Banner>}
      {data && !data.range.truncated && data.range.previousIncomplete && <Banner tone="warn" className="mb-4">{t('Trop de commandes dans la période précédente : la comparaison est masquée. Choisissez une période plus courte.', 'Too many orders in the previous period: the comparison is hidden. Pick a shorter period.')}</Banner>}
      {!data && !error && <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-sunken" />)}</div>}
      {empty && <EmptyState title={t('Aucune vente pour cette période.', 'No sales in this period.')} />}
      {data && k && !empty && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile hero label={t('Ventes', 'Sales')} value={fmtMoney(k.sales)} change={cmp ? k.salesChange : undefined} previous={cmp ? fmtMoney(k.prevSales) : undefined} />
            <StatTile label={t('Commandes', 'Orders')} value={fmtInt(k.orders)} change={cmp ? k.ordersChange : undefined} previous={cmp ? fmtInt(k.prevOrders) : undefined} />
            <StatTile label={t('Panier moyen', 'Average order')} value={fmtMoney(k.aov)} />
            <StatTile label={t('Articles vendus', 'Items sold')} value={fmtInt(k.itemsSold)} />
            <StatTile label={t('Ventes perdues', 'Lost sales')} value={fmtMoney(k.lostSales)} change={cmp ? k.lostSalesChange : undefined} previous={cmp ? fmtMoney(k.prevLostSales) : undefined} upIsGood={false} note={`${k.lostOrders} ${t('cmd annulées', 'cancelled orders')}`} />
          </div>

          <Card className="mb-5 p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-ink">{t('Ventes par article', 'Sales by item')}</h2>
                <div className="mt-0.5 text-[13px] text-ink-3">{t(`${data.itemsTotal} articles · le même plat est regroupé sur tous les canaux`, `${data.itemsTotal} items · the same dish is merged across every channel`)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input inputSize="sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Chercher un article', 'Search an item')} aria-label={t('Chercher un article', 'Search an item')} />
                {exportLinks('items')}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">{t('Article', 'Item')}</th>
                    <th className="py-2 pr-3 text-right">{t('Qté', 'Qty')}</th>
                    <th className="py-2 pr-3 text-right">{t('Ventes', 'Sales')}</th>
                    <th className="py-2 pr-3 text-right">%</th>
                    <th className="py-2 pr-3 text-right">{t('Prix moyen', 'Avg price')}</th>
                    <th className="py-2 pr-3 text-right">{t('vs préc.', 'vs prev')}</th>
                    {sourcesInItems.map((s) => <th key={s} className="py-2 pr-3 text-right">{sourceName(s)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 300).map((i) => (
                    <tr key={i.key} className="border-b border-line/60">
                      <td className="num py-2 pr-3 text-ink-3">{i.rank}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{i.name}</span>{i.popular && <Badge tone="brand">{t('Populaire', 'Popular')}</Badge>}</div>
                        <div className="text-xs text-ink-3">{i.brand}{i.lostQty > 0 ? ` · ${i.lostQty} ${t('annulé(s)', 'cancelled')}` : ''}</div>
                      </td>
                      <td className="num py-2 pr-3 text-right">{fmtInt(i.qty)}</td>
                      <td className="num py-2 pr-3 text-right">{fmtMoney(i.sales)}</td>
                      <td className="num py-2 pr-3 text-right">{i.share}%</td>
                      <td className="num py-2 pr-3 text-right">{fmtMoney(i.avgPrice)}</td>
                      <td className={`num py-2 pr-3 text-right ${cmp && i.change > 0 ? 'text-go-2' : cmp && i.change < 0 ? 'text-stop-2' : 'text-ink-3'}`}>{vs(i.change)}</td>
                      {sourcesInItems.map((s) => <td key={s} className="num py-2 pr-3 text-right">{i.bySource[s] ?? 0}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <div className="py-8 text-center text-sm text-ink-3">{t('Aucun article trouvé.', 'No item found.')}</div>}
              {data.itemsTotal > data.items.length && <div className="pt-3 text-xs text-ink-3">{t(`Recherche limitée aux ${data.items.length} premiers articles : exportez pour la liste complète.`, `Search covers the first ${data.items.length} items: export for the full list.`)}</div>}
              {shown.length > 300 && <div className="pt-3 text-xs text-ink-3">{t('300 premiers articles affichés : exportez pour la liste complète.', 'First 300 items shown: export for the full list.')}</div>}
            </div>
          </Card>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Par heure', 'By hour')} subtitle={t('Ventes selon l’heure de la commande (heure locale)', 'Sales by order time (local time)')} legend={exportLinks('hours')}
              table={{ columns: [t('Heure', 'Hour'), t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Panier', 'Avg')], rows: data.byHour.map((h) => [`${h.hour}h`, h.orders, fmtMoney(h.sales), fmtMoney(h.aov)]), filename: 'takatak-sales-by-hour' }}>
              <Columns rows={data.byHour.map((h) => ({ label: `${h.hour}h`, value: h.sales }))} format={fmtMoney} />
            </ChartCard>
            <ChartCard title={t('Par jour de la semaine', 'By day of the week')} subtitle={t('Ventes et moyenne par jour', 'Sales and average per day')} legend={exportLinks('weekdays')}
              table={{ columns: [t('Jour', 'Day'), t('Commandes', 'Orders'), t('Ventes', 'Sales'), t('Jours', 'Days'), t('Moyenne par jour', 'Average per day')], rows: data.byWeekday.map((d) => [days[d.dow], d.orders, fmtMoney(d.sales), d.days, fmtMoney(d.avgSalesPerDay)]), filename: 'takatak-sales-by-weekday' }}>
              <HBars rows={data.byWeekday.map((d) => ({ label: days[d.dow], value: d.sales, detail: `${d.orders} ${t('cmd', 'orders')} · ${fmtMoney(d.avgSalesPerDay)} ${t('moyenne par jour', 'average per day')}` }))} format={fmtMoney} />
            </ChartCard>
          </div>

          <ChartCard className="mb-5" title={t('Heures de pointe', 'Busiest hours')} subtitle={heat === 'sales' ? t('Ventes par jour et par heure', 'Sales by day and hour') : t('Commandes par jour et par heure', 'Orders by day and hour')}
            legend={<Segmented size="sm" value={heat} onChange={setHeat} options={[{ key: 'sales', label: t('Ventes', 'Sales') }, { key: 'orders', label: t('Commandes', 'Orders') }]} />}
            table={{ columns: ['', ...Array.from({ length: 24 }, (_, h) => `${h}h`)], rows: data.heatmap[heat].map((r, d) => [days[d], ...r]), filename: `takatak-heatmap-${heat}` }}>
            <SalesHeatmap grid={data.heatmap[heat]} days={days} format={heat === 'sales' ? fmtMoney : fmtInt} unit={heat === 'sales' ? t('de ventes', 'in sales') : t('commandes', 'orders')}
              title={heat === 'sales' ? t('Ventes par jour et par heure', 'Sales by day and hour') : t('Commandes par jour et par heure', 'Orders by day and hour')} />
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title={t('Par canal', 'By channel')} subtitle={t('Plateformes et commandes directes', 'Platforms and direct orders')} legend={exportLinks('sources')} table={groupTable(data.bySource, t('Canal', 'Channel'), 'takatak-sales-by-channel')}>
              <HBars rows={groupBars(data.bySource)} format={fmtMoney} empty={t('Aucune vente pour cette période.', 'No sales in this period.')} />
            </ChartCard>
            <ChartCard title={t('Livraison, à emporter, sur place', 'Delivery, pickup, dine-in')} legend={exportLinks('fulfillment')} table={groupTable(data.byFulfillment, t('Mode', 'Fulfillment'), 'takatak-sales-by-fulfillment')}>
              <HBars rows={groupBars(data.byFulfillment)} format={fmtMoney} empty={t('Aucune vente pour cette période.', 'No sales in this period.')} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
