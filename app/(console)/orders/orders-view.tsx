'use client';

// Orders: Actives (in progress, by step), Planifiées (for later) and Historique (a period, with search and CSV). The
// filter chips change the console's scope (location, brand, platform), like the header picker. The kitchen screen keeps
// its own data (`useBoardOrders({ allBrands: true })`: its whole location, every brand, every platform).
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlarmClock, ArrowRight, CalendarClock, ChefHat, Download, Inbox, Search, Volume2 } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Badge, PlatformMark, PlatformTag } from '@/components/ui/badge';
import { MevBadge } from '@/components/live/mev-panel';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton, SkeletonList, SkeletonTable } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Input, Select } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useNow } from '@/components/ui/timer';
import { OrderCard, type BoardOrder } from '@/components/live/order-card';
import { OrderDrawer, STATUS_TONE, statusLabel } from '@/components/live/order-drawer';
import { usePulse, useRefreshOn, useScopeHref } from '@/components/live/pulse';
import { CollapsibleFilters } from '@/components/live/collapsible-filters';
import { orderNumber, plurals } from '@/components/live/words';
import { ScopeChips } from '@/components/shell/scope-chips';
import { useScopeLabel } from '@/components/shell/scope-switcher';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { api, downloadCsv, money, timeOf } from '@/lib/ui/api';
import { audioReady, playSound, unlockAudio } from '@/lib/ui/sound';
import { useFilters } from '@/lib/ui/range';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type View = 'active' | 'scheduled' | 'history';
const viewOf = (v: string | null): View => (v === 'history' ? 'history' : v === 'scheduled' ? 'scheduled' : 'active');

export function OrdersView() {
  const { t } = useI18n();
  const { features } = useViewer();
  const router = useRouter();
  const params = useSearchParams();
  const href = useScopeHref();
  const view = viewOf(params.get('view'));
  const open = params.get('open');
  const { orders, at } = useBoardOrderState();
  const now = useNow(5_000);
  const isScheduled = useCallback((o: BoardOrder) => Boolean(o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) > now && ['new', 'accepted'].includes(o.status)), [now]);
  const active = useMemo(() => (orders ?? []).filter((o) => !isScheduled(o)), [orders, isScheduled]);
  const scheduled = useMemo(() => (orders ?? []).filter(isScheduled), [orders, isScheduled]);
  // ?view= in the address (old links with ?view=live open Actives); other parameters (scope, ?open=) are kept.
  const setView = useCallback((v: View) => {
    const q = new URLSearchParams(window.location.search);
    if (v === 'active') q.delete('view'); else q.set('view', v);
    router.replace(`/orders${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [router]);
  const setOpen = useCallback((id: string | null) => {
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('open', id); else q.delete('open');
    router.replace(`/orders${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [router]);
  const ago = at ? Math.max(0, Math.round((now - at) / 1000)) : null;
  const direct = features.includes('delivery') || features.includes('phone');
  return (
    <div>
      <PageHeader title={t('Commandes', 'Orders')}
        subtitle={<>{t('Toutes vos plateformes, en direct.', 'All your platforms, live.')}{ago !== null && <span className="text-ink-3"> · {t(`mis à jour il y a ${ago} s`, `updated ${ago} s ago`)}</span>}</>}
        right={<ButtonLink href={href('/kitchen')} variant="outline" size="lg" icon={<ChefHat className="size-4" />}>{t('Écran cuisine', 'Kitchen screen')}</ButtonLink>} />
      <Hint id="orders.view">
        <Tabs className="mb-4" value={view} onChange={setView} tabs={[
          { key: 'active', label: t('Actives', 'Active'), count: orders ? active.length : null },
          { key: 'scheduled', label: t('Planifiées', 'Scheduled'), count: orders ? scheduled.length : null },
          { key: 'history', label: t('Historique', 'History') },
        ]} />
      </Hint>
      {view === 'active' && <LiveBoard orders={orders === null ? null : active} onOpen={setOpen} />}
      {view === 'scheduled' && <Scheduled orders={orders === null ? null : scheduled} onOpen={setOpen} />}
      {view === 'history' && <History onOpen={setOpen} />}
      {direct && (
        <Link href={href('/direct')} className="text-body mt-6 flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 font-semibold text-ink-2 shadow-card hover:border-ink-4 hover:text-ink">
          {t('Vos commandes site web et téléphone sont dans Commandes directes', 'Your website and phone orders are in Direct orders')}<ArrowRight className="ml-auto size-4 shrink-0" />
        </Link>
      )}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const LANES = [
  { key: 'new', fr: 'Nouvelles', en: 'New', dot: 'bg-brand', efr: 'Aucune nouvelle commande', een: 'No new order' },
  { key: 'accepted', fr: 'En préparation', en: 'Preparing', dot: 'bg-wait', efr: 'Rien en préparation', een: 'Nothing preparing' },
  { key: 'ready', fr: 'Prêtes', en: 'Ready', dot: 'bg-go', efr: 'Rien à remettre', een: 'Nothing to hand over' },
  { key: 'dispatched', fr: 'Parties', en: 'Picked up', dot: 'bg-info', efr: 'Rien de parti récemment', een: 'Nothing picked up lately' },
] as const;
const RANK: Record<string, number> = { new: 0, accepted: 1, ready: 2, dispatched: 3 };

function useBoardOrderState({ allBrands = false }: { allBrands?: boolean } = {}) {
  const { pulse, scope, brands, channels } = usePulse();
  // The kitchen screen (allBrands): its whole location, every brand and every platform, whatever the console shows.
  const brandKey = allBrands ? '' : brands.join(',');
  const channelKey = allBrands ? '' : channels.join(',');
  const [state, setState] = useState<{ orders: BoardOrder[] | null; at: number | null }>({ orders: null, at: null });
  const sig = pulse ? JSON.stringify([pulse.orders, pulse.incoming.map((o) => o.id + o.status)]) : '';
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const q = new URLSearchParams({ status: 'new,accepted,ready,dispatched', since, limit: '400' });
    if (scope.length) q.set('locations', scope.join(','));
    if (brandKey) q.set('brands', brandKey);
    if (channelKey) q.set('channels', channelKey);
    // Orders page: an order placed more than 48 h ahead still shows in Planifiées (openAlso lists open orders whatever
    // day they arrived). Only those waiting for their cooking time are added: Actives stays the last 48 h, as before.
    if (!allBrands) q.set('openAlso', '1');
    const d = await api<{ orders: BoardOrder[] }>(`/api/foodhub/orders?${q}`).catch(() => null);
    if (!d) return;
    const now = Date.now();
    const orders = allBrands ? d.orders : d.orders.filter((o) => o.createdAt >= since || Boolean(['new', 'accepted'].includes(o.status) && o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) > now));
    setState({ orders, at: now });
  }, [scope, brandKey, channelKey, allBrands]);
  useEffect(() => { load(); }, [load, sig]);
  useEffect(() => { const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  return state;
}

/** `allBrands`: the kitchen screen shows every brand and platform of its kitchen, whatever the console is looking at. */
export function useBoardOrders(opts: { allBrands?: boolean } = {}) {
  return useBoardOrderState(opts).orders;
}

/** The order cards as a list, each with its step (phones and tablets; one step picked on a big screen). */
function CardList({ list, onOpen, showStatus }: { list: BoardOrder[]; onOpen: (id: string) => void; showStatus?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map((o) => {
        const lane = LANES.find((l) => l.key === o.status);
        return (
          <div key={o.id}>
            {showStatus && lane && <div className="eyebrow mb-1.5 flex items-center gap-1.5 px-1 text-ink-3"><span aria-hidden className={cn('size-2 rounded-full', lane.dot)} />{t(lane.fr, lane.en)}</div>}
            <Hint id="orders.card"><OrderCard o={o} onOpen={() => onOpen(o.id)} /></Hint>
          </div>
        );
      })}
    </div>
  );
}

function LiveBoard({ orders, onOpen }: { orders: BoardOrder[] | null; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { viewer } = useViewer();
  const { site, setSite } = usePulse();
  const label = useScopeLabel();
  const href = useScopeHref();
  const now = useNow(15_000);
  const [status, setStatus] = useState<string>('');
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(audioReady()); const i = setInterval(() => setSound(audioReady()), 2000); return () => clearInterval(i); }, []);
  const lane = (k: string) => (orders ?? []).filter((o) => o.status === k).sort((a, b) => (a.timeline?.readyTarget ?? a.createdAt).localeCompare(b.timeline?.readyTarget ?? b.createdAt));
  const late = (orders ?? []).filter((o) => o.status === 'accepted' && o.timeline?.readyTarget && Date.parse(o.timeline.readyTarget) < now).length;
  const narrowed = Boolean(site.brand || site.channel);
  const lateWords = plurals(late, ['en retard', 'en retard'], ['late', 'late']);
  // A kitchen tablet never leaves its location: there the button widens to every brand and platform of that location.
  const keepLocation = Boolean(site.kitchen && viewer.device);
  const soundButton = !sound && <Button variant="primary" size="lg" icon={<Volume2 className="size-4" />} onClick={() => { unlockAudio(); playSound('soft'); setSound(true); }}>{t('Activer le son', 'Turn sound on')}</Button>;
  // The status pills wrap onto a second line on a phone (every step stays visible, nothing hidden off-screen).
  const pills = (
    <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label={t('Statut', 'Status')}>
      {[{ key: '', fr: 'Toutes', en: 'All', n: orders?.length ?? 0 }, ...LANES.map((l) => ({ key: l.key, fr: l.fr, en: l.en, n: lane(l.key).length }))].map((p) => (
        <button key={p.key || 'all'} type="button" aria-pressed={status === p.key} onClick={() => setStatus(p.key)}
          className={cn('text-small flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-semibold whitespace-nowrap sm:h-9', status === p.key ? 'border-ink bg-ink text-canvas' : 'border-line-2 bg-surface text-ink-2 hover:border-ink-4')}>
          {t(p.fr, p.en)}<span className={cn('num', status !== p.key && 'text-ink-3')}>{p.n}</span>
        </button>
      ))}
      {late > 0 && (
        <button type="button" onClick={() => setStatus('accepted')} aria-pressed={status === 'accepted'} data-late-chip
          className="text-small flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-stop/30 bg-stop-soft px-3.5 font-bold whitespace-nowrap text-stop-2 sm:h-9">
          <AlarmClock className="size-4" aria-hidden />{t(lateWords[0], lateWords[1])}
        </button>
      )}
    </div>
  );
  const filters = <Hint id="orders.filters"><ScopeChips extra={pills} extraActive={Boolean(status)} onClearExtra={() => setStatus('')} /></Hint>;
  if (!orders) return <>{filters}<div className="grid grid-cols-1 gap-4 xl:grid-cols-4" role="status" aria-label={t('Chargement…', 'Loading…')}>{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-3 rounded-md bg-sunken/60 p-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-28 bg-surface" /><Skeleton className="h-28 bg-surface" /></div>)}</div></>;
  const shown = (status ? lane(status) : [...orders].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (a.timeline?.readyTarget ?? a.createdAt).localeCompare(b.timeline?.readyTarget ?? b.createdAt)));
  if (orders.length === 0) {
    return (
      <>
        {filters}
        <Card>
          {narrowed ? (
            <EmptyState icon={<Inbox className="size-6" />} title={t(`Aucune commande en cours pour ${label.words}.`, `No orders right now for ${label.words}.`)}
              action={<div className="flex flex-wrap justify-center gap-2">
                {soundButton}
                <Button variant="outline" size="lg" onClick={() => setSite(keepLocation ? { brand: null, channel: undefined } : { kitchen: null, brand: null, channel: undefined })}>{keepLocation ? t('Voir toutes les marques et plateformes de cette succursale', 'See every brand and platform of this location') : t('Voir tous les restaurants et plateformes', 'See every restaurant and platform')}</Button>
              </div>} />
          ) : (
            <EmptyState icon={<Inbox className="size-6" />} title={t('Aucune commande en cours.', 'No orders right now.')} body={t('Les nouvelles commandes sonnent et s’ouvrent toutes seules.', 'New orders ring and open by themselves.')}
              action={soundButton || <ButtonLink href={href('/kitchen')} variant="outline" size="lg" icon={<ChefHat className="size-4" />}>{t('Ouvrir l’écran cuisine', 'Open the kitchen screen')}</ButtonLink>} />
          )}
        </Card>
      </>
    );
  }
  return (
    <div>
      {filters}
      {/* Big screen, every step: the four lanes. */}
      {!status && (
        <div className="hidden grid-cols-4 gap-4 xl:grid">
          {LANES.map((l) => {
            const list = lane(l.key);
            return (
              <section key={l.key} aria-label={t(l.fr, l.en)} className="flex min-h-48 flex-col rounded-md bg-sunken/60 p-3">
                <h2 className="eyebrow mb-3 flex items-center gap-2 px-1 pt-1 text-ink-3"><span aria-hidden className={cn('size-2 rounded-full', l.dot)} />{t(l.fr, l.en)}<span className="num text-small ml-auto rounded-full bg-surface px-2 font-bold tracking-normal text-ink-2">{list.length}</span></h2>
                <div className="flex flex-col gap-3">
                  {list.map((o) => <Hint id="orders.card" key={o.id}><OrderCard o={o} onOpen={() => onOpen(o.id)} /></Hint>)}
                  {list.length === 0 && <div className="text-small px-2 py-8 text-center text-ink-3">{t(l.efr, l.een)}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {/* Phones and tablets (and one picked step on a big screen): one list, new first. */}
      <div className={cn(!status && 'xl:hidden')}>
        {shown.length ? <CardList list={shown} onOpen={onOpen} showStatus={!status} />
          : <Card><EmptyState title={t(LANES.find((l) => l.key === status)?.efr ?? '', LANES.find((l) => l.key === status)?.een ?? '')} /></Card>}
      </div>
    </div>
  );
}

function Scheduled({ orders, onOpen }: { orders: BoardOrder[] | null; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <Hint id="orders.filters"><ScopeChips /></Hint>
      {!orders ? <SkeletonList count={3} />
        : orders.length === 0 ? <Card><EmptyState icon={<CalendarClock className="size-6" />} title={t('Aucune commande planifiée.', 'No scheduled order.')} body={t('Les commandes pour plus tard s’affichent ici jusqu’à l’heure de les préparer.', 'Orders for later show here until it is time to cook them.')} /></Card>
          : <CardList list={orders} onOpen={onOpen} />}
    </div>
  );
}

type Row = BoardOrder & { actions: string[] };

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, loc } = useI18n();
  const { locations, brands, locName } = useViewer();
  const { site, setSite, scope, brands: brandScope, channels: channelScope } = usePulse();
  const href = useScopeHref();
  // No brand or platform picker of its own here (the chips change the console's scope): old `?channels=` links are ignored.
  const { filters, set, query } = useFilters('today', scope, brandScope, channelScope, { scopeOnly: true });
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
  const anyFilter = Boolean(status || q.trim() || site.kitchen || site.brand || site.channel);
  // The file name never carries a brand: it may be sent to an accountant who sees every brand.
  function csv() {
    downloadCsv(`commandes-${filters.from}-${filters.to}`, [
      ['Date', 'Heure', 'Plateforme', 'No', 'Marque', 'Succursale', 'Client', 'Statut', 'Mode', 'Sous-total', 'Taxes', 'Pourboire', 'Total', 'Clover'],
      ...shown.map((o) => [o.createdAt.slice(0, 10), timeOf(o.createdAt, loc), o.channel, o.displayId || o.externalOrderId, o.brandName ?? '', o.locationCode ?? '', o.customerName ?? '', o.status, o.fulfillment, o.subtotal, o.tax, o.tip, o.total, o.posOrderId ?? '']),
    ]);
  }
  const clearAll = () => { setStatus(''); setQ(''); setSite({ kitchen: null, brand: null, channel: undefined }); };
  // Filters on, for the phone's "Filtres" button: the period when not today, the status, the console scope.
  const activeFilters = [filters.preset !== 'today', Boolean(status), Boolean(site.kitchen), Boolean(site.brand), Boolean(site.channel)].filter(Boolean).length;
  const search = (cls: string) => <div className={cn('relative', cls)}><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden /><Input inputSize="sm" className="h-11 w-full pl-8 sm:h-9 md:w-56" aria-label={t('Chercher une commande', 'Search an order')} placeholder={t('No, client, Clover…', '#, customer, Clover…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>;
  const counts = plurals(counted.length, ['commande'], ['order']);
  const cancelledWords = plurals(shown.length - counted.length, ['annulée'], ['cancelled', 'cancelled']);
  const extra: ReactNode = (
    <>
      <ScopeChips className="contents" />
      <Select selectSize="sm" value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 w-auto font-semibold sm:h-9" aria-label={t('Statut', 'Status')}>
        <option value="">{t('Tous les statuts', 'All statuses')}</option>
        {['new', 'accepted', 'ready', 'dispatched', 'completed', 'cancelled', 'failed'].map((s) => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
      </Select>
      {search('hidden md:block')}
      <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={csv} disabled={!shown.length} icon={<Download className="size-4" />}>{t('Exporter (CSV)', 'Export (CSV)')}</Button>
    </>
  );
  return (
    <div>
      <Hint id="orders.filters"><CollapsibleFilters active={activeFilters} lead={search('w-full')}><FilterBar filters={filters} set={set} locations={locations} brands={brands} showBrands={false} showChannels={false} extra={extra} /></CollapsibleFilters></Hint>
      <div className="text-body mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-live="polite">{rows === null ? <Skeleton className="h-5 w-56" /> : <><span className="font-semibold text-ink">{t(counts[0], counts[1])}</span><span><strong className="num">{money(sales, loc)}</strong> <span className="text-ink-3">{t('ventes', 'sales')}</span></span><span className="text-ink-3">{t(cancelledWords[0], cancelledWords[1])}</span></>}</div>
      <Card>
        {rows === null ? <SkeletonTable rows={6} cols={6} className="border-0 shadow-none" />
          : shown.length === 0 ? (
            <EmptyState icon={<Inbox className="size-6" />} title={t('Aucune commande pour cette période.', 'No orders for this period.')}
              body={<>{t('Il manque une commande ?', 'Missing an order?')} <Link href={href('/alerts')} className="font-semibold text-brand hover:underline">{t('Regardez les Alertes.', 'Check the Alerts.')}</Link></>}
              action={<div className="flex flex-wrap justify-center gap-2">
                {filters.preset !== '7d' && <Button variant="primary" size="lg" onClick={() => set({ preset: '7d' })}>{t('Voir les 7 derniers jours', 'See the last 7 days')}</Button>}
                {anyFilter && <Button variant="outline" size="lg" onClick={clearAll}>{t('Effacer les filtres', 'Clear the filters')}</Button>}
              </div>} />
          ) : (
            <>
              {/* From md up: the table. */}
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>{t('Heure', 'Time')}</Th><Th>{t('Plateforme', 'Platform')}</Th><Th>No</Th><Th>{t('Marque', 'Brand')}</Th><Th>{t('Succursale', 'Location')}</Th><Th>{t('Client', 'Customer')}</Th><Th>{t('Statut', 'Status')}</Th><Th align="right">Total</Th></tr></thead>
                  <tbody>
                    {shown.slice(0, limit).map((o) => (
                      <Tr key={o.id} className="cursor-pointer" onClick={() => onOpen(o.id)}>
                        <Td className="whitespace-nowrap text-ink-2">{timeOf(o.createdAt, loc, filters.from !== filters.to)}</Td>
                        <Td><PlatformTag channel={o.channel} /></Td>
                        {/* The order number is a real button: keyboard users open the order with Tab + Enter. */}
                        <Td className="font-bold"><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(o.id); }} className="-mx-1 rounded px-1 font-bold hover:underline">#{orderNumber(o)}</button></Td>
                        <Td>{o.brandName ?? '—'}</Td>
                        <Td className="text-ink-2">{o.locationCode ? shortLoc(locName(o.locationCode)) : '—'}</Td>
                        <Td className={o.customerName ? 'text-ink-2' : 'text-ink-3'}>{o.customerName || t('Client inconnu', 'Unknown customer')}</Td>
                        <Td><span className="flex flex-wrap items-center gap-1"><Badge tone={STATUS_TONE[o.status]}>{statusLabel(t, o.status)}</Badge><MevBadge mev={o.timeline?.mev} /></span></Td>
                        <Td align="right" className={cn('font-semibold', o.status === 'cancelled' && 'text-ink-3 line-through')}>{money(o.total, loc)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {/* Phones: one card per order. */}
              <ul className="divide-y divide-line md:hidden">
                {shown.slice(0, limit).map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => onOpen(o.id)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                      <PlatformMark channel={o.channel} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2"><span className="shrink-0 font-extrabold whitespace-nowrap">#{orderNumber(o)}</span><span className="text-small truncate text-ink-3">{o.brandName ?? '—'}</span></span>
                        <span className="text-small block text-ink-3">{timeOf(o.createdAt, loc, filters.from !== filters.to)}</span>
                      </span>
                      <span className="text-right">
                        <span className={cn('num text-body block font-bold', o.status === 'cancelled' && 'text-ink-3 line-through')}>{money(o.total, loc)}</span>
                        <Badge tone={STATUS_TONE[o.status]}>{statusLabel(t, o.status)}</Badge>
                        <MevBadge mev={o.timeline?.mev} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        {shown.length > limit && <div className="border-t border-line p-3 text-center"><Button variant="ghost" onClick={() => setLimit(limit + 300)}>{t(`Voir plus (${shown.length - limit})`, `Show more (${shown.length - limit})`)}</Button></div>}
      </Card>
    </div>
  );
}
