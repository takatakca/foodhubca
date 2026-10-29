'use client';

import { useEffect, useRef } from 'react';
import { Bike, Clock, PackageCheck, Timer } from 'lucide-react';
import { useNow } from '@/components/ui/timer';
import { chimeOnce, courierWatchState, etaPassed, mmss, type CourierWatchKind } from '@/lib/foodhub/order-tools/courier-watch';
import type { OrderEvent, StoredOrder } from '@/lib/foodhub/types';
import { playSound } from '@/lib/ui/sound';
import { timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/**
 * This screen's sound switch (Settings → Alerts → This screen), read from the same saved settings as the new-order
 * alarm (components/live/incoming.tsx, key "takatak.alerts.v1"). Read here, not imported: incoming.tsx imports the
 * order drawer, which renders these tools.
 */
function soundOn(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem('takatak.alerts.v1') || '{}') as { sound?: boolean; volume?: number };
    return p.sound !== false && (typeof p.volume !== 'number' || p.volume > 0);
  } catch { return true; }
}

/**
 * Courier watch: "arrive dans ~N min", one discreet chime at 5 minutes (once per order, never looped, silent when this
 * screen's sound is off), "attend depuis mm:ss" in red while the order is not ready, planned vs actual once it left.
 *
 * Lives in the order drawer: the chime plays only while this order is open on the screen. Opening an order whose courier
 * ETA has already passed does not chime. The waiting timer counts from the courier's first arrival (order events), not
 * from the last platform update. Screen readers hear the state once when it changes, never the ticking timer.
 */
export function CourierWatch({ order, events }: { order: Pick<StoredOrder, 'id' | 'status' | 'fulfillment' | 'timeline'>; events?: OrderEvent[] }) {
  const { t, loc } = useI18n();
  const now = useNow(1000);
  const s = courierWatchState(order, now, { events });
  const lateAtMount = useRef(etaPassed(s));

  const chime = s.chime;
  useEffect(() => {
    if (chimeOnce(order.id, { chime }, undefined, lateAtMount.current) && soundOn()) playSound('soft');
  }, [order.id, chime]);

  if (s.kind === 'none') return null;
  const who = s.courierName ? ` · ${s.courierName}` : '';
  const box = 'flex min-h-12 items-center gap-3 rounded-lg border px-4 py-2.5';
  // Announced once per state change (the visible box below ticks every second and is not a live region).
  const said: Record<Exclude<CourierWatchKind, 'none'>, string> = {
    assigned: t('Livreur assigné', 'Courier assigned'),
    arriving: t('Livreur arrive bientôt', 'Courier arriving soon'),
    waiting: t('Livreur au comptoir, commande pas prête', 'Courier at the counter, order not ready'),
    here: t('Livreur au comptoir, remettez la commande', 'Courier at the counter, hand the order over'),
    gone: t('Commande partie avec le livreur', 'Order left with the courier'),
  };
  const live = <span role="status" className="sr-only">{said[s.kind]}</span>;

  if (s.kind === 'waiting') {
    return (
      <div className={cn(box, 'border-stop bg-stop-soft text-stop-2')}>
        {live}
        <Timer className="size-5 shrink-0" aria-hidden />
        <div className="flex-1 text-sm font-bold">{t('Livreur attend depuis', 'Courier waiting for')} <span className="num text-base" aria-hidden>{mmss(s.seconds ?? 0)}</span>{who}</div>
        <span className="text-xs font-semibold">{t('Commande pas prête', 'Order not ready')}</span>
      </div>
    );
  }
  if (s.kind === 'here') {
    return (
      <div className={cn(box, 'border-go bg-go-soft text-go-2')}>
        {live}
        <PackageCheck className="size-5 shrink-0" aria-hidden />
        <div className="flex-1 text-sm font-bold">{t('Livreur au comptoir — remettez la commande', 'Courier at the counter — hand the order over')}{who}</div>
      </div>
    );
  }
  if (s.kind === 'gone') {
    return (
      <div className={cn(box, 'border-line bg-surface text-ink')}>
        {live}
        <Bike className="size-5 shrink-0 text-ink-3" aria-hidden />
        <div className="flex-1 text-sm"><span className="font-bold">{t(`Parti à ${timeOf(s.actualAt, loc)}`, `Left at ${timeOf(s.actualAt, loc)}`)}</span>{who}</div>
        {s.plannedAt && <span className="num text-xs text-ink-3">{t('prévu', 'planned')} {timeOf(s.plannedAt, loc)} / {t('réel', 'actual')} {timeOf(s.actualAt, loc)}</span>}
      </div>
    );
  }
  const near = s.kind === 'arriving';
  return (
    <div className={cn(box, near ? 'border-wait bg-wait-soft text-wait-2' : 'border-line bg-surface text-ink')}>
      {live}
      {near ? <Clock className="size-5 shrink-0" aria-hidden /> : <Bike className="size-5 shrink-0 text-info" aria-hidden />}
      <div className="flex-1 text-sm">
        {near
          ? <span className="font-bold">{s.minutes !== undefined ? t(`Livreur arrive dans ~${s.minutes} min`, `Courier arriving in ~${s.minutes} min`) : t('Livreur arrive', 'Courier arriving')}</span>
          : <span className="font-bold">{s.etaAt ? t(`Livreur assigné, arrive vers ${timeOf(s.etaAt, loc)}`, `Courier assigned, arriving around ${timeOf(s.etaAt, loc)}`) : t('Livreur assigné', 'Courier assigned')}</span>}
        {who}
      </div>
      {!near && s.minutes !== undefined && <span className="num text-xs text-ink-3">~{s.minutes} min</span>}
    </div>
  );
}
