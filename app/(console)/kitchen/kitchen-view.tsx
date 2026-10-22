'use client';

import { useEffect, useState } from 'react';
import { ChefHat, Flame, LayoutGrid, Maximize, Minimize, MonitorSmartphone, PackageCheck, Snowflake } from 'lucide-react';
import { Hint } from '@/components/help/hint';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { useNow } from '@/components/ui/timer';
import { useToast } from '@/components/ui/toast';
import { OrderCard } from '@/components/live/order-card';
import { OrderDrawer } from '@/components/live/order-drawer';
import { useWebsiteOrders, WebsiteOrderCard } from '@/components/live/website-orders';
import { OwnOrderCard, useOwnOrders } from '@/components/live/own-orders';
import { CourierStrip } from '@/components/expansion/courier-strip';
import { KitchenStatus } from '@/components/live/order-tools/kitchen-status';
import { refreshEverything, usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { useBoardOrders } from '../orders/orders-view';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

/** Kitchen display: big tickets, one tap to bump. Dark, readable from across the kitchen. */
export function KitchenView() {
  const { t, loc } = useI18n();
  const { viewer, can, locations, locName } = useViewer();
  const { pulse, scope } = usePulse();
  const toast = useToast();
  const orders = useBoardOrders({ allBrands: true });
  const now = useNow(1000);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const f = () => setFull(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);

  const here = viewer.device?.locationCode ?? (scope.length === 1 ? scope[0] : locations.length === 1 ? locations[0].code : null);
  const kitchen = here ? pulse?.kitchen?.[here] : null;
  const isSched = (o: { timeline?: { fireAt?: string; firedAt?: string } }) => Boolean(o.timeline?.fireAt && !o.timeline.firedAt && Date.parse(o.timeline.fireAt) > now);
  const cooking = (orders ?? []).filter((o) => (o.status === 'new' || o.status === 'accepted') && !isSched(o)).sort((a, b) => (a.timeline?.readyTarget ?? a.createdAt).localeCompare(b.timeline?.readyTarget ?? b.createdAt));
  const ready = (orders ?? []).filter((o) => o.status === 'ready');
  // Website orders Clover Online Ordering took and printed: mirrored here, Clover keeps control.
  const web = useWebsiteOrders(here);
  const webCooking = web.orders.filter((o) => o.status === 'new' || o.status === 'in_kitchen');
  const webReady = web.orders.filter((o) => o.status === 'ready');
  // Our own orders (AI phone, phone, website, typed in): Food Hub sent them to Clover; the kitchen cooks them from here too.
  const own = useOwnOrders(here);
  const ownCooking = own.orders.filter((o) => o.status === 'new' || o.status === 'in_kitchen');
  const ownReady = own.orders.filter((o) => o.status === 'ready');

  async function toggleBusy() {
    if (!here) return;
    setBusy(true);
    try { await api('/api/foodhub/prep', { method: 'POST', json: { locationCode: here, isBusy: !kitchen?.busy } }); toast.success(kitchen?.busy ? t('Retour au temps normal', 'Back to normal time') : t('Mode occupé activé', 'Busy mode on')); refreshEverything(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    // The dark theme’s amber chip fill is lifted one step here (#33280a read muddy from across the kitchen).
    <div className="-mx-4 -mt-5 min-h-[calc(100dvh-4rem)] px-4 pt-5 [--color-wait-soft:#4a3a0e] sm:-mx-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="eyebrow mb-1 text-brand">{t('Cuisine', 'Kitchen')}</div>
          <h1 className="text-display text-ink">{here ? shortLoc(locName(here)) : t('Toutes les cuisines', 'All kitchens')}</h1>
        </div>
        <div className="num text-display text-ink-2 sm:ml-2" suppressHydrationWarning>{new Date(now).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {/* Enrolling the tablet is a one-time step: a header chip, not a 64 px banner over the tickets. */}
          {!viewer.device && can('stores:map') && (
            <ButtonLink href="/settings/devices" variant="outline" size="lg" icon={<MonitorSmartphone className="size-5 text-brand" aria-hidden />}
              title={t('Enregistrez cette tablette : l’équipe entre avec son NIP et vous êtes alerté si elle s’éteint.', 'Enrol this tablet: the team unlocks it with their PIN and you get alerted if it goes off.')}>
              <span className="sm:hidden">{t('Enregistrer', 'Enrol')}</span><span className="hidden sm:inline">{t('Enregistrer cette tablette', 'Enrol this tablet')}</span>
            </ButtonLink>
          )}
          {here && <KitchenStatus locationCode={here} />}
          {here && can('stores:toggle') && (
            <Hint id="kitchen.busy"><Button variant={kitchen?.busy ? 'danger' : 'outline'} size="lg" loading={busy} onClick={toggleBusy} icon={kitchen?.busy ? <Flame className="size-5" /> : <Snowflake className="size-5" />}>
              {kitchen?.busy ? t(`Occupé · ${kitchen.minutes} min`, `Busy · ${kitchen.minutes} min`) : t(`Normal · ${kitchen?.minutes ?? 15} min`, `Normal · ${kitchen?.minutes ?? 15} min`)}
            </Button></Hint>
          )}
          <Hint id="kitchen.fullscreen"><Button variant="outline" size="lg" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)} icon={full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}>{full ? t('Quitter', 'Exit') : t('Plein écran', 'Full screen')}</Button></Hint>
        </div>
      </div>

      {/* Our own delivery orders and their courier (only when own delivery is on and something is on the road). */}
      <CourierStrip locationCode={here ?? undefined} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <section>
          {/* The tip sits on the column title, not on each ticket: no card pops over the next ticket during a rush, and the tour finds it even with no orders. */}
          <Hint id="kitchen.ticket"><h2 className="text-heading mb-3 flex items-baseline gap-2 text-ink">{t('À préparer', 'To cook')}<span className="num text-ink-3">{cooking.length + webCooking.length + ownCooking.length}</span></h2></Hint>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {cooking.map((o) => <OrderCard key={o.id} o={o} big onOpen={() => setOpen(o.id)} />)}
            {webCooking.map((o) => <WebsiteOrderCard key={o.id} o={o} big onChanged={web.reload} />)}
            {ownCooking.map((o) => <OwnOrderCard key={o.id} o={o} big onChanged={own.reload} />)}
          </div>
          {orders && cooking.length === 0 && webCooking.length === 0 && ownCooking.length === 0 && <Card><EmptyState icon={<ChefHat />} title={t('Rien à préparer', 'Nothing to cook')} body={t('Les nouvelles commandes arrivent ici toutes seules, avec une sonnerie.', 'New orders land here by themselves, with a chime.')} /></Card>}
        </section>
        <section>
          <Hint id="kitchen.pickup"><h2 className="text-heading mb-3 flex items-baseline gap-2 text-ink">{t('Prêtes — attendent le livreur', 'Ready — waiting for courier')}<span className="num text-ink-3">{ready.length + webReady.length + ownReady.length}</span></h2></Hint>
          <div className="flex flex-col gap-3">
            {ready.map((o) => <OrderCard key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}
            {webReady.map((o) => <WebsiteOrderCard key={o.id} o={o} onChanged={web.reload} />)}
            {ownReady.map((o) => <OwnOrderCard key={o.id} o={o} onChanged={own.reload} />)}
          </div>
          {orders && ready.length === 0 && webReady.length === 0 && ownReady.length === 0 && <Card><EmptyState compact icon={<PackageCheck />} title={t('Aucune commande prête', 'No order ready')} body={t('Touchez « Prête » sur un billet : il passe ici jusqu’au livreur.', 'Tap “Ready” on a ticket: it moves here until the courier comes.')} /></Card>}
          {!viewer.device && <ButtonLink href="/orders" variant="ghost" size="lg" className="mt-4" icon={<LayoutGrid className="size-4" aria-hidden />}>{t('Vue tableau des commandes', 'Orders board view')}</ButtonLink>}
        </section>
      </div>
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
