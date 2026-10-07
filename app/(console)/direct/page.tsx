'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, PackageCheck, Plus, ShoppingBag, Store, TriangleAlert, Truck, Wine } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { Elapsed } from '@/components/ui/timer';
import { useViewer } from '@/components/shell/viewer';
import { DirectOrderDrawer, type DirectRow } from '@/components/expansion/direct-order-drawer';
import { NewDirectOrder } from '@/components/expansion/new-order-modal';
import { DELIVERY_TONE, DIRECT_TONE, FLEET_NAME, PAYMENT_TONE, deliveryStatusLabel, directStatusLabel, paymentLabel, sourceLabel } from '@/components/expansion/labels';
import { api, money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { DirectTabs } from './direct-tabs';

type Fleet = { fleet: string; label: string; configured: boolean; canSend: boolean; environment: 'sandbox' | 'production'; note: string; noteFr: string };
type Board = { orders: DirectRow[]; fleets: Fleet[] };
type Filter = 'todo' | 'road' | 'done' | 'all';

const OPEN = ['new', 'in_kitchen', 'ready'];

export default function DirectPage() {
  const { t, loc } = useI18n();
  const { features, can, locName } = useViewer();
  const router = useRouter();
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('todo');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const on = features.includes('delivery');

  const load = useCallback(() => api<Board>('/api/foodhub/delivery').then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { if (!on) return; load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load, on]);
  useEffect(() => { if (!on && features.includes('phone')) router.replace('/direct/calls'); }, [on, features, router]);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const shown = useMemo(() => orders.filter((o) => filter === 'all'
    || (filter === 'todo' && (OPEN.includes(o.status) || (o.attention && !['completed', 'cancelled'].includes(o.status))))
    || (filter === 'road' && o.status === 'out_for_delivery')
    || (filter === 'done' && ['completed', 'cancelled'].includes(o.status))), [orders, filter]);
  const today = orders.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString() && o.status !== 'cancelled');
  const attention = orders.filter((o) => o.attention && !['completed', 'cancelled'].includes(o.status)).length;
  const courierCost = today.reduce((s, o) => s + (o.delivery && o.delivery.status !== 'cancelled' ? o.delivery.fee ?? 0 : 0), 0);
  const feesCharged = today.reduce((s, o) => s + (o.fulfillment === 'delivery' ? o.deliveryFee : 0), 0);
  const drive = data?.fleets.find((f) => f.fleet === 'doordash_drive');

  if (!on) return <div><PageHeader eyebrow={t('Nos commandes', 'Own orders')} title={t('Livraison par nos coursiers', 'Own-order delivery')} /><DirectTabs /><EmptyState icon={<Truck className="size-6" />} title={t('La livraison de nos commandes est désactivée', 'Own-order delivery is turned off')} body={t('Le propriétaire l’active dans Réglages → Expansion.', 'The owner turns it on in Settings → Expansion.')} action={can('admin') ? <ButtonLink href="/settings/expansion">{t('Ouvrir Expansion', 'Open Expansion')}</ButtonLink> : undefined} /></div>;

  return (
    <div>
      <PageHeader eyebrow={t('Nos commandes', 'Own orders')} title={t('Commandes directes et livreurs', 'Direct orders & couriers')}
        subtitle={t('Téléphone, site web, Clover « Livraison » : la cuisine reçoit le billet Clover, et un livreur DoorDash Drive (ou Uber Direct) est demandé au bon moment.', 'Phone, website, Clover "Delivery": the kitchen gets the Clover ticket, and a DoorDash Drive (or Uber Direct) courier is requested at the right time.')}
        right={can('orders:act') ? <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('Nouvelle commande', 'New order')}</Button> : undefined} />
      <DirectTabs />

      {data && !drive?.configured && <Banner tone="warn" className="mb-4" action={can('stores:map') ? <ButtonLink size="sm" href="/settings/expansion/delivery">{t('Brancher', 'Connect')}</ButtonLink> : undefined}>{t('DoorDash Drive n’est pas branché : les commandes arrivent, mais aucun livreur ne peut être demandé.', 'DoorDash Drive is not connected: orders arrive, but no courier can be requested.')}</Banner>}
      {drive?.configured && drive.environment === 'sandbox' && <Banner tone="info" className="mb-4">{t('Bac à sable DoorDash Drive : les livraisons sont des essais, aucun vrai livreur ne se déplace.', 'DoorDash Drive sandbox: deliveries are tests, no real courier comes.')}</Banner>}
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Commandes aujourd’hui', 'Orders today')} value={data ? String(today.length) : '—'} note={data ? money(today.reduce((s, o) => s + o.total, 0), loc) : ''} icon={<ShoppingBag className="size-4" />} />
        <Stat label={t('Sur la route', 'On the road')} value={data ? String(orders.filter((o) => o.status === 'out_for_delivery').length) : '—'} icon={<Bike className="size-4" />} tone="brand" />
        <Stat label={t('À vérifier', 'Needs a person')} value={data ? String(attention) : '—'} icon={<TriangleAlert className="size-4" />} tone={attention ? 'wait' : undefined} />
        <Stat label={t('Livreurs vs frais facturés', 'Couriers vs fees charged')} value={data ? money(courierCost, loc) : '—'} note={data ? `${t('frais clients', 'customer fees')} ${money(feesCharged, loc)}` : ''} icon={<Truck className="size-4" />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { key: 'todo', label: `${t('À faire', 'To do')} (${orders.filter((o) => OPEN.includes(o.status) || (o.attention && !['completed', 'cancelled'].includes(o.status))).length})` },
          { key: 'road', label: t('En livraison', 'Out for delivery') },
          { key: 'done', label: t('Terminées', 'Done') },
          { key: 'all', label: t('Toutes', 'All') },
        ]} />
        <span className="text-xs text-ink-3">{t('Mise à jour toutes les 15 s', 'Refreshes every 15 s')}</span>
      </div>

      {!data && !err && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
      {data && !shown.length && <Card><EmptyState icon={<PackageCheck className="size-6" />} title={filter === 'todo' ? t('Rien à faire', 'Nothing to do') : t('Aucune commande', 'No orders')} body={t('Les commandes par téléphone, sur le site web et les commandes Clover « Livraison » apparaissent ici.', 'Phone, website and Clover "Delivery" orders show up here.')} /></Card>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((o) => {
          const d = o.delivery;
          return (
            <button key={o.id} type="button" onClick={() => setOpen(o.id)} className={cn('group flex flex-col rounded-lg border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop', o.attention && !['completed', 'cancelled'].includes(o.status) ? 'border-wait/60' : 'border-line')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="num text-lg font-extrabold">{o.number}</span><Badge tone="neutral">{sourceLabel(t, o.source)}</Badge>{o.containsAlcohol && <Badge tone="violet" icon={<Wine className="size-3" />}>18+</Badge>}</div>
                  <div className="truncate text-[13px] text-ink-3">{o.brandName} · {locName(o.locationCode)}</div>
                </div>
                <Badge tone={DIRECT_TONE[o.status] ?? 'neutral'}>{directStatusLabel(t, o.status)}</Badge>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink">
                {o.fulfillment === 'delivery' ? <Truck className="size-4 text-brand" /> : <Store className="size-4 text-ink-3" />}
                <span className="truncate">{o.customer.name || t('Client', 'Customer')}</span>
                <span className="ml-auto num">{money(o.total, loc)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <Badge tone={PAYMENT_TONE[o.payment] ?? 'neutral'}>{paymentLabel(t, o.payment)}</Badge>
                <span>{t('reçue', 'placed')} {timeOf(o.placedAt, loc)} · <Elapsed since={o.placedAt} /></span>
                {o.readyAt && !['completed', 'cancelled'].includes(o.status) && <span>{t('prête vers', 'ready at')} {timeOf(o.readyAt, loc)}</span>}
              </div>
              {o.fulfillment === 'delivery' && (
                <div className="mt-3 flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-[13px]">
                  {d ? <><StatusDot tone={DELIVERY_TONE[d.status] ?? 'neutral'} pulse={['assigned', 'at_pickup', 'picked_up', 'at_dropoff'].includes(d.status)} /><span className="font-semibold">{deliveryStatusLabel(t, d.status)}</span><span className="truncate text-ink-3">{d.courier?.name ? `· ${d.courier.name}` : ''} · {FLEET_NAME[d.fleet]}</span>{d.dropoffEta && !['delivered', 'cancelled', 'returned'].includes(d.status) && <span className="ml-auto text-xs text-ink-3">{t('chez le client', 'at customer')} {timeOf(d.dropoffEta, loc)}</span>}</>
                    : <><StatusDot tone="neutral" /><span className="text-ink-3">{t('Pas encore de livreur', 'No courier yet')}</span></>}
                </div>
              )}
              {o.attention && !['completed', 'cancelled'].includes(o.status) && <div className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-wait-2"><TriangleAlert className="mt-px size-3.5 shrink-0" /><span className="line-clamp-2">{o.attention}</span></div>}
            </button>
          );
        })}
      </div>
      {data && <p className="mt-4 text-xs text-ink-4">{t('Les commandes des plateformes (Uber Eats, DoorDash, Skip) restent dans', 'Platform orders (Uber Eats, DoorDash, Skip) stay in')} <Link href="/orders" className="underline">{t('Commandes', 'Orders')}</Link> — {t('leurs livreurs sont envoyés par la plateforme.', 'their couriers come from the platform.')}</p>}

      {open && <DirectOrderDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
      {creating && <NewDirectOrder onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpen(id); }} />}
    </div>
  );
}
