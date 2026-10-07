'use client';

import { AlarmClock, Bike, CalendarClock, Check, Eye, PackageCheck, TriangleAlert } from 'lucide-react';
import { Badge, PlatformMark } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown, Elapsed, useNow } from '@/components/ui/timer';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { ALLERGY, courierLabel, primaryAction, useOrderActions } from './order-drawer';
import { money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { StoredOrder } from '@/lib/foodhub/types';
import { cn } from '@/lib/ui/cn';

export type BoardOrder = StoredOrder & { actions: string[] };

/** One order on the live board / kitchen screen. Click = open; the button does the next step. */
export function OrderCard({ o, onOpen, big }: { o: BoardOrder; onOpen: () => void; big?: boolean }) {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const { run, busy } = useOrderActions();
  const tl = o.timeline ?? {};
  const prim = primaryAction(o);
  const items = o.lines.reduce((s, l) => s + l.quantity, 0);
  const now = useNow(15_000);
  const late = o.status === 'accepted' && tl.readyTarget && Date.parse(tl.readyTarget) < now;
  const unseen = o.status === 'accepted' && !tl.seenAt;
  const allergy = [o.notes, ...o.lines.map((l) => l.notes)].some((n) => n && ALLERGY.test(n));
  const scheduled = Boolean(tl.fireAt && !tl.firedAt && Date.parse(tl.fireAt) > now);
  return (
    <div className={cn('group rounded-lg border bg-surface shadow-card transition-all hover:-translate-y-px hover:shadow-pop', o.status === 'new' ? 'border-brand ring-2 ring-brand/20' : late ? 'border-stop/50' : 'border-line')}>
      <button type="button" onClick={onOpen} className="block w-full p-3.5 text-left">
        <div className="flex items-start gap-2.5">
          <PlatformMark channel={o.channel} size={big ? 'md' : 'sm'} />
          <div className="min-w-0 flex-1">
            <div className={cn('flex items-baseline gap-2 font-extrabold text-ink', big ? 'text-xl' : 'text-base')}>#{o.displayId || o.externalOrderId.slice(0, 8)}<span className="truncate text-[13px] font-semibold text-ink-3">{o.brandName ?? '—'}</span></div>
            <div className="truncate text-xs text-ink-3">{o.locationCode ? shortLoc(locName(o.locationCode)) : t('non relié', 'unmapped')} · {items} {t('art.', 'items')} · {money(o.total, loc)}</div>
          </div>
          <Elapsed since={o.createdAt} warnAt={o.status === 'new' ? 60 : 900} badAt={o.status === 'new' ? 180 : 1500} className="text-sm" />
        </div>
        {big && (
          <ul className="mt-3 space-y-1">
            {o.lines.slice(0, 8).map((l, i) => (
              <li key={i} className="text-[15px] leading-snug"><span className="num font-extrabold">{l.quantity}×</span> <span className="font-semibold">{l.name}</span>
                {l.mapping === 'free' && !o.viaPos && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-wait-soft px-1 align-middle text-[11px] font-bold text-wait-2" title={t('Pas un article de l’inventaire Clover — vérifiez le billet', 'Not a Clover inventory item — check the ticket')}><TriangleAlert className="size-3" />{t('texte libre', 'free text')}</span>}
                {l.modifiers.length > 0 && <span className="block pl-6 text-[13px] text-ink-2">{l.modifiers.map((m) => m.name).join(', ')}</span>}
                {l.notes && <span className={cn('ml-6 mt-0.5 inline-block rounded px-1.5 text-[13px] font-bold', ALLERGY.test(l.notes) ? 'bg-stop text-white' : 'bg-wait-soft text-wait-2')}>« {l.notes} »</span>}
              </li>
            ))}
            {o.lines.length > 8 && <li className="text-xs text-ink-3">+{o.lines.length - 8} {t('autres', 'more')}</li>}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {o.status === 'accepted' && tl.readyTarget && <Badge tone={late ? 'stop' : 'neutral'} icon={<AlarmClock className="size-3" />}>{timeOf(tl.readyTarget, loc)} · <Countdown to={tl.readyTarget} className="text-inherit" /></Badge>}
          {o.viaPos && <Badge tone="info" title={t('Reçue par l’intégration Clover de la plateforme — Food Hub suit seulement.', 'Received through the platform’s Clover integration — Food Hub only follows it.')}>{t('via Clover', 'via Clover')}</Badge>}
          {scheduled && <Badge tone="violet" icon={<CalendarClock className="size-3" />}>{t('planifiée', 'scheduled')} {timeOf(tl.scheduledFor ?? tl.fireAt, loc)}</Badge>}
          {tl.courier && <Badge tone={tl.courier.status === 'at_store' ? 'wait' : 'info'} icon={<Bike className="size-3" />}>{courierLabel(t, tl.courier.status)}</Badge>}
          {unseen && <Badge tone="brand" icon={<Eye className="size-3" />}>{t('pas vue', 'not seen')}</Badge>}
          {allergy && <Badge tone="stop" icon={<TriangleAlert className="size-3" />}>{t('allergie', 'allergy')}</Badge>}
          {o.posError && !o.posOrderId && <Badge tone="stop">{t('pas dans Clover', 'not in Clover')}</Badge>}
          {o.status === 'failed' && <Badge tone="violet">{t('tablette Skip', 'Skip tablet')}</Badge>}
          {(tl.delayedMinutes ?? 0) > 0 && <Badge tone="wait">+{tl.delayedMinutes} min</Badge>}
        </div>
      </button>
      {can('orders:act') && (prim || unseen) && (
        <div className="border-t border-line p-2">
          {unseen && !prim ? (
            <Button variant="soft" size="sm" className="w-full" loading={busy === 'ack'} onClick={() => run(o.id, 'ack')} icon={<Eye className="size-4" />}>{t('Vu', 'Seen')}</Button>
          ) : prim === 'accept' ? (
            <Button variant="go" size={big ? 'lg' : 'sm'} className="w-full" loading={busy === 'accept'} onClick={() => run(o.id, 'accept')} icon={<Check className="size-4" />}>{t('Accepter', 'Accept')}</Button>
          ) : prim === 'ready' ? (
            <div className="flex gap-1.5">
              {unseen && <Button variant="soft" size={big ? 'lg' : 'sm'} loading={busy === 'ack'} onClick={() => run(o.id, 'ack')} icon={<Eye className="size-4" />}>{t('Vu', 'Seen')}</Button>}
              <Button variant="go" size={big ? 'lg' : 'sm'} className="flex-1" loading={busy === 'ready'} onClick={() => run(o.id, 'ready')} icon={<PackageCheck className="size-4" />}>{t('Prête', 'Ready')}</Button>
            </div>
          ) : prim === 'dispatch' ? (
            <Button variant="primary" size={big ? 'lg' : 'sm'} className="w-full" loading={busy === 'dispatch'} onClick={() => run(o.id, 'dispatch')} icon={<Bike className="size-4" />}>{t('Remise au livreur', 'Picked up')}</Button>
          ) : prim === 'complete' ? (
            <Button variant="outline" size="sm" className="w-full" loading={busy === 'complete'} onClick={() => run(o.id, 'complete')} icon={<Check className="size-4" />}>{t('Livrée / terminée', 'Delivered / done')}</Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
