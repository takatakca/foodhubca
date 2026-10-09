'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Inbox, Search } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge, PlatformTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useNow } from '@/components/ui/timer';
import { OrderCard, type BoardOrder } from '@/components/live/order-card';
import { OrderDrawer, STATUS_TONE, statusLabel } from '@/components/live/order-drawer';
import { usePulse, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { api, downloadCsv, money, timeOf } from '@/lib/ui/api';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

export function OrdersView() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<'live' | 'history'>('live');
  const open = params.get('open');
  useEffect(() => { if (params.get('view') === 'history') setView('history'); }, [params]);
  const setOpen = useCallback((id: string | null) => {
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('open', id); else q.delete('open');
    router.replace(`/orders${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [router]);
  return (
    <div>
      <PageHeader title={t('Commandes', 'Orders')} subtitle={t('Toutes les plateformes, en direct. Touchez une commande pour tout voir.', 'Every platform, live. Tap an order to see everything.')}
        right={<Hint id="orders.view"><Segmented value={view} onChange={setView} options={[{ key: 'live', label: t('En direct', 'Live') }, { key: 'history', label: t('Historique', 'History') }]} /></Hint>} />
      {view === 'live' ? <LiveBoard onOpen={setOpen} /> : <History onOpen={setOpen} />}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const LANES = [
  { key: 'new', fr: 'Nouvelles', en: 'New', dot: 'bg-brand' },
  { key: 'accepted', fr: 'En préparation', en: 'Preparing', dot: 'bg-wait' },
  { key: 'ready', fr: 'Prêtes', en: 'Ready', dot: 'bg-go' },
  { key: 'dispatched', fr: 'Parties', en: 'Picked up', dot: 'bg-info' },
] as const;

/** `allBrands`: the kitchen screen shows every brand of its kitchen, whatever brand the console is looking at. */
export function useBoardOrders({ allBrands = false }: { allBrands?: boolean } = {}) {
  const { pulse, scope, brands } = usePulse();
  const brandKey = allBrands ? '' : brands.join(',');
  const [orders, setOrders] = useState<BoardOrder[] | null>(null);
  const sig = pulse ? JSON.stringify([pulse.orders, pulse.incoming.map((o) => o.id + o.status)]) : '';
  const load = useCallback(async () => {
    const q = new URLSearchParams({ status: 'new,accepted,ready,dispatched', since: new Date(Date.now() - 48 * 3600_000).toISOString(), limit: '400' });
    if (scope.length) q.set('locations', scope.join(','));
    if (brandKey) q.set('brands', brandKey);
    const d = await api<{ orders: BoardOrder[] }>(`/api/foodhub/orders?${q}`).catch(() => null);
    if (d) setOrders(d.orders);
  }, [scope, brandKey]);
  useEffect(() => { load(); }, [load, sig]);
  useEffect(() => { const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  return orders;
}

function LiveBoard({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const orders = useBoardOrders();
  const now = useNow(15_000);
  const isScheduled = (o: BoardOrder) => Boolean(o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) > now && ['new', 'accepted'].includes(o.status));
  const scheduled = (orders ?? []).filter(isScheduled);
  const lane = (k: string) => (orders ?? []).filter((o) => o.status === k && !isScheduled(o)).sort((a, b) => (a.timeline?.readyTarget ?? a.createdAt).localeCompare(b.timeline?.readyTarget ?? b.createdAt));
  const late = (orders ?? []).filter((o) => o.status === 'accepted' && o.timeline?.readyTarget && Date.parse(o.timeline.readyTarget) < now).length;
  if (!orders) return <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-lg bg-sunken" />)}</div>;
  return (
    <div>
      {late > 0 && <div className="mb-4 rounded-lg bg-stop-soft px-4 py-2.5 text-sm font-bold text-stop-2">⏱ {t(`${late} commande(s) en retard sur l’heure « prête »`, `${late} order(s) past their ready time`)}</div>}
      {scheduled.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"><span className="size-2 rounded-full bg-violet" />{t('Planifiées', 'Scheduled')} <span className="num text-ink-3">{scheduled.length}</span></div>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">{scheduled.map((o) => <div key={o.id} className="w-72 shrink-0"><Hint id="orders.card"><OrderCard o={o} onOpen={() => onOpen(o.id)} /></Hint></div>)}</div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((l) => {
          const list = lane(l.key);
          return (
            <section key={l.key} className="flex min-h-48 flex-col rounded-xl bg-sunken/60 p-2.5">
              <div className="mb-2.5 flex items-center gap-2 px-1.5 pt-1 text-sm font-bold text-ink"><span className={cn('size-2 rounded-full', l.dot)} />{t(l.fr, l.en)}<span className="num ml-auto rounded-full bg-surface px-2 text-xs text-ink-2">{list.length}</span></div>
              <div className="flex flex-col gap-2.5">
                {list.map((o) => <Hint id="orders.card" key={o.id}><OrderCard o={o} onOpen={() => onOpen(o.id)} /></Hint>)}
                {list.length === 0 && <div className="px-2 py-8 text-center text-[13px] text-ink-4">{l.key === 'new' ? t('Rien en attente 👌', 'Nothing waiting 👌') : '—'}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

type Row = BoardOrder & { actions: string[] };

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, loc } = useI18n();
  const { locations, brands, locName } = useViewer();
  const { scope, brands: brandScope } = usePulse();
  const { filters, set, query } = useFilters('today', scope, brandScope);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [limit, setLimit] = useState(200);
  useEffect(() => {
    let alive = true;
    setRows(null);
    const p = new URLSearchParams(query);
    p.set('limit', '3000');
    if (status) p.set('status', status);
    api<{ orders: Row[] }>(`/api/foodhub/orders?${p}`).then((d) => alive && setRows(d.orders)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [query, status]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, '');
    return (rows ?? []).filter((o) => !s || [o.displayId, o.externalOrderId, o.customerName, o.posOrderId, o.brandName].some((v) => v && String(v).toLowerCase().includes(s)));
  }, [rows, q]);
  const counted = shown.filter((o) => o.status !== 'cancelled');
  const sales = counted.reduce((a, o) => a + Number(o.total || 0), 0);
  function csv() {
    downloadCsv(`takatak-commandes-${filters.from}-${filters.to}`, [
      ['Date', 'Heure', 'Plateforme', 'No', 'Marque', 'Succursale', 'Client', 'Statut', 'Mode', 'Sous-total', 'Taxes', 'Pourboire', 'Total', 'Clover'],
      ...shown.map((o) => [o.createdAt.slice(0, 10), timeOf(o.createdAt, loc), o.channel, o.displayId || o.externalOrderId, o.brandName ?? '', o.locationCode ?? '', o.customerName ?? '', o.status, o.fulfillment, o.subtotal, o.tax, o.tip, o.total, o.posOrderId ?? '']),
    ]);
  }
  return (
    <div>
      <Hint id="orders.filters"><FilterBar filters={filters} set={set} locations={locations} brands={brands}
        extra={<>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-line-2 bg-surface px-3 text-[13px] font-semibold" aria-label={t('Statut', 'Status')}>
            <option value="">{t('Tous les statuts', 'All statuses')}</option>
            {['new', 'accepted', 'ready', 'dispatched', 'completed', 'cancelled', 'failed'].map((s) => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
          </select>
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" /><Input inputSize="sm" className="h-9 w-56 pl-8" placeholder={t('No, client, Clover…', '#, customer, Clover…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button variant="outline" size="sm" className="h-9" onClick={csv} disabled={!shown.length} icon={<Download className="size-4" />}>CSV</Button>
        </>} /></Hint>
      <div className="mb-3 flex flex-wrap gap-4 text-sm"><span><strong className="num">{counted.length}</strong> <span className="text-ink-3">{t('commandes', 'orders')}</span></span><span><strong className="num">{money(sales, loc)}</strong> <span className="text-ink-3">{t('ventes', 'sales')}</span></span><span className="text-ink-3">{shown.length - counted.length} {t('annulées', 'cancelled')}</span></div>
      <Card>
        {rows === null ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-sunken" />)}</div>
          : shown.length === 0 ? <EmptyState icon={<Inbox className="size-6" />} title={t('Aucune commande', 'No orders')} body={t('Changez la période ou les filtres.', 'Change the period or the filters.')} />
            : (
              <Table>
                <thead><tr><Th>{t('Heure', 'Time')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>No</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Succursale', 'Location')}</Th><Th>{t('Client', 'Customer')}</Th><Th>{t('Statut', 'Status')}</Th><Th align="right">Total</Th></tr></thead>
                <tbody>
                  {shown.slice(0, limit).map((o) => (
                    <Tr key={o.id} className="cursor-pointer" onClick={() => onOpen(o.id)}>
                      <Td className="whitespace-nowrap text-ink-2">{timeOf(o.createdAt, loc, filters.from !== filters.to)}</Td>
                      <Td><PlatformTag channel={o.channel} /></Td>
                      <Td className="font-bold">#{o.displayId || o.externalOrderId.slice(0, 8)}</Td>
                      <Td>{o.brandName ?? '—'}</Td>
                      <Td className="text-ink-2">{o.locationCode ? shortLoc(locName(o.locationCode)) : '—'}</Td>
                      <Td className="text-ink-2">{o.customerName ?? '—'}</Td>
                      <Td><Badge tone={STATUS_TONE[o.status]}>{statusLabel(t, o.status)}</Badge></Td>
                      <Td align="right" className={cn('font-semibold', o.status === 'cancelled' && 'text-ink-4 line-through')}>{money(o.total, loc)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
        {shown.length > limit && <div className="border-t border-line p-3 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit(limit + 300)}>{t(`Voir plus (${shown.length - limit})`, `Show more (${shown.length - limit})`)}</Button></div>}
      </Card>
    </div>
  );
}
