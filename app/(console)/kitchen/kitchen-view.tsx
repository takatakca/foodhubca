'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Flame, Maximize, Minimize, MonitorSmartphone, Snowflake } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { useNow } from '@/components/ui/timer';
import { useToast } from '@/components/ui/toast';
import { OrderCard } from '@/components/live/order-card';
import { OrderDrawer } from '@/components/live/order-drawer';
import { refreshEverything, usePulse } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { useBoardOrders } from '../orders/orders-view';
import { api, ApiError } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/** Kitchen display: big tickets, one tap to bump. Dark, readable from across the kitchen. */
export function KitchenView() {
  const { t, loc } = useI18n();
  const { viewer, can, locations, locName } = useViewer();
  const { pulse, scope } = usePulse();
  const toast = useToast();
  const orders = useBoardOrders();
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

  async function toggleBusy() {
    if (!here) return;
    setBusy(true);
    try { await api('/api/foodhub/prep', { method: 'POST', json: { locationCode: here, isBusy: !kitchen?.busy } }); toast.success(kitchen?.busy ? t('Retour au temps normal', 'Back to normal time') : t('Mode occupé activé', 'Busy mode on')); refreshEverything(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="-mx-4 -mt-5 min-h-[calc(100dvh-4rem)] px-4 pt-5 sm:-mx-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs font-bold tracking-[0.14em] text-brand uppercase">{t('Cuisine', 'Kitchen')}</div>
          <h1 className="text-2xl font-extrabold">{here ? shortLoc(locName(here)) : t('Toutes les succursales', 'All locations')}</h1>
        </div>
        <div className="num ml-2 text-3xl font-extrabold text-ink-2" suppressHydrationWarning>{new Date(now).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {here && can('stores:toggle') && (
            <Button variant={kitchen?.busy ? 'danger' : 'outline'} size="lg" loading={busy} onClick={toggleBusy} icon={kitchen?.busy ? <Flame className="size-5" /> : <Snowflake className="size-5" />}>
              {kitchen?.busy ? t(`Occupé · ${kitchen.minutes} min`, `Busy · ${kitchen.minutes} min`) : t(`Normal · ${kitchen?.minutes ?? 15} min`, `Normal · ${kitchen?.minutes ?? 15} min`)}
            </Button>
          )}
          <Button variant="outline" size="lg" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)} icon={full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}>{full ? t('Quitter', 'Exit') : t('Plein écran', 'Full screen')}</Button>
        </div>
      </div>

      {!viewer.device && can('stores:map') && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <MonitorSmartphone className="size-5 text-brand" />
          <span className="flex-1">{t('Cet écran est-il la tablette de la cuisine ? Enregistrez-la : l’équipe entrera avec son NIP et vous serez alerté si elle s’éteint.', 'Is this screen the kitchen tablet? Enrol it: the team unlocks it with their PIN and you get alerted if it goes off.')}</span>
          <ButtonLink href="/settings/devices" variant="brand" size="sm">{t('Enregistrer cette tablette', 'Enrol this tablet')}</ButtonLink>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <section>
          <div className="mb-3 flex items-baseline gap-2 text-lg font-extrabold">{t('À préparer', 'To cook')}<span className="num text-ink-3">{cooking.length}</span></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {cooking.map((o) => <OrderCard key={o.id} o={o} big onOpen={() => setOpen(o.id)} />)}
          </div>
          {orders && cooking.length === 0 && <div className="rounded-xl border border-dashed border-line-2 px-6 py-16 text-center text-lg text-ink-3">{t('Aucune commande à préparer. 🍳', 'Nothing to cook. 🍳')}</div>}
        </section>
        <section>
          <div className="mb-3 flex items-baseline gap-2 text-lg font-extrabold">{t('Prêtes — attendent le livreur', 'Ready — waiting for courier')}<span className="num text-ink-3">{ready.length}</span></div>
          <div className="flex flex-col gap-3">{ready.map((o) => <OrderCard key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}</div>
          {orders && ready.length === 0 && <div className="rounded-xl border border-dashed border-line-2 px-4 py-10 text-center text-ink-3">—</div>}
          {!viewer.device && <p className={cn('mt-6 text-xs text-ink-4')}><Link href="/orders" className="underline">{t('Vue tableau des commandes', 'Orders board view')}</Link></p>}
        </section>
      </div>
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
