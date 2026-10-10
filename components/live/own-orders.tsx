'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bike, Bot, Check, Eye, Globe, PackageCheck, PenLine, Phone, Printer, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown, Elapsed, useNow } from '@/components/ui/timer';
import { useToast } from '@/components/ui/toast';
import { refreshEverything, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { ALLERGY } from './order-drawer';
import type { DirectOrder } from '@/lib/foodhub/delivery/types';
import { api, ApiError, money, timeOf } from '@/lib/ui/api';
import { playSound } from '@/lib/ui/sound';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/**
 * Our own orders on the kitchen screen: AI phone, phone by staff, our website, typed in. Food Hub sent them to Clover
 * (which prints the ticket); this card is the kitchen's view with Seen / Ready / Picked up. A new one beeps once.
 */
export function useOwnOrders(locationCode?: string | null) {
  const [orders, setOrders] = useState<DirectOrder[]>([]);
  const known = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    const q = locationCode ? `?locations=${encodeURIComponent(locationCode)}` : '';
    const d = await api<{ orders: DirectOrder[] }>(`/api/foodhub/delivery/kitchen${q}`).catch(() => null);
    if (!d) return;
    // Beep once for an order the screen has not shown before (not on the first load).
    if (known.current && d.orders.some((o) => !o.seenAt && !known.current!.has(o.id))) playSound('order');
    known.current = new Set(d.orders.map((o) => o.id));
    setOrders(d.orders);
  }, [locationCode]);
  useEffect(() => { known.current = null; load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  return { orders, reload: load };
}

const SOURCE_ICON = { phone_ai: Bot, phone: Phone, website: Globe, manual: PenLine, clover: Printer, clover_online: Globe } as const;

export function OwnOrderCard({ o, big, onChanged }: { o: DirectOrder; big?: boolean; onChanged?: () => void }) {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const items = o.lines.reduce((s, l) => s + l.quantity, 0);
  const unseen = !o.seenAt && o.status !== 'ready';
  const allergy = [o.notes, ...o.lines.map((l) => l.notes)].some((n) => n && ALLERGY.test(n));
  const now = useNow(15_000);
  const cooking = o.status === 'new' || o.status === 'in_kitchen';
  const late = cooking && o.readyAt && Date.parse(o.readyAt) < now;
  const Icon = SOURCE_ICON[o.source] ?? Phone;
  const source = { phone_ai: t('Téléphone IA', 'AI phone'), phone: t('Téléphone', 'Phone'), website: t('Site web', 'Website'), manual: t('Saisie', 'Typed in'), clover: 'Clover', clover_online: 'Clover' }[o.source];

  async function run(action: 'seen' | 'ready' | 'picked_up') {
    setBusy(action);
    try {
      await api(`/api/foodhub/delivery/${o.id}`, { method: 'POST', json: { action } });
      onChanged?.();
      refreshEverything();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('rounded-lg border bg-surface shadow-card', unseen ? 'border-brand ring-2 ring-brand/25' : late ? 'border-stop/50' : 'border-line')}>
      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <span className={cn('inline-flex shrink-0 items-center justify-center rounded-sm bg-brand text-white', big ? 'size-8' : 'size-6')} title={source}><Icon className={big ? 'size-4.5' : 'size-3.5'} /></span>
          <div className="min-w-0 flex-1">
            <div className={cn('flex items-baseline gap-2 font-extrabold text-ink', big ? 'text-xl' : 'text-base')}>{o.customer.name || o.number}<span className="truncate text-[13px] font-semibold text-ink-3">{o.brandName}</span></div>
            <div className="truncate text-xs text-ink-3">{o.number} · {source} · {shortLoc(locName(o.locationCode))} · {items} {t('art.', 'items')} · {money(o.total, loc)}</div>
          </div>
          <Elapsed since={o.placedAt} warnAt={900} badAt={1500} className="text-sm" />
        </div>
        {big && (
          <ul className="mt-3 space-y-1">
            {o.lines.slice(0, 8).map((l, i) => (
              <li key={i} className="text-[15px] leading-snug"><span className="num font-extrabold">{l.quantity}×</span> <span className="font-semibold">{l.name}</span>
                {l.modifiers.length > 0 && <span className="block pl-6 text-[13px] text-ink-2">{l.modifiers.map((m) => m.name).join(', ')}</span>}
                {l.notes && <span className={cn('ml-6 mt-0.5 inline-block rounded px-1.5 text-[13px] font-bold', ALLERGY.test(l.notes) ? 'bg-stop text-white' : 'bg-wait-soft text-wait-2')}>« {l.notes} »</span>}
              </li>
            ))}
            {o.lines.length > 8 && <li className="text-xs text-ink-3">+{o.lines.length - 8} {t('autres', 'more')}</li>}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {o.posOrderId
            ? <Badge tone="info" icon={<Printer className="size-3" />}>{t('Dans Clover', 'In Clover')}</Badge>
            : <Badge tone={o.posError ? 'stop' : 'neutral'} icon={<Printer className="size-3" />} title={o.posError}>{o.posError ? t('Pas dans Clover', 'Not in Clover') : t('Food Hub seulement', 'Food Hub only')}</Badge>}
          {cooking && o.readyAt && <Badge tone={late ? 'stop' : 'neutral'}>{timeOf(o.readyAt, loc)} · <Countdown to={o.readyAt} className="text-inherit" /></Badge>}
          <Badge tone="neutral" icon={o.fulfillment === 'delivery' ? <Bike className="size-3" /> : undefined}>{o.fulfillment === 'delivery' ? t('Livraison', 'Delivery') : t('Pour emporter', 'Pickup')}</Badge>
          {o.payment !== 'paid' && <Badge tone="wait">{o.fulfillment === 'pickup' ? t('À payer au comptoir', 'Pay at the counter') : t('Paiement à prendre', 'Payment to take')}</Badge>}
          {o.containsAlcohol && <Badge tone="wait">{t('Alcool · ID 18+', 'Alcohol · ID 18+')}</Badge>}
          {unseen && <Badge tone="brand" icon={<Eye className="size-3" />}>{t('pas vue', 'not seen')}</Badge>}
          {allergy && <Badge tone="stop" icon={<TriangleAlert className="size-3" />}>{t('allergie', 'allergy')}</Badge>}
          {o.attention && <Badge tone="wait" icon={<TriangleAlert className="size-3" />} title={o.attention}>{t('à vérifier', 'check')}</Badge>}
        </div>
      </div>
      {can('orders:act') && (
        <div className="border-t border-line p-2">
          <div className="flex gap-1.5">
            {unseen && <Button variant="soft" size={big ? 'lg' : 'sm'} loading={busy === 'seen'} onClick={() => run('seen')} icon={<Eye className="size-4" />}>{t('Vu', 'Seen')}</Button>}
            {cooking
              ? <Button variant="go" size={big ? 'lg' : 'sm'} className="flex-1" loading={busy === 'ready'} onClick={() => run('ready')} icon={<PackageCheck className="size-4" />}>{t('Prête', 'Ready')}</Button>
              : o.fulfillment === 'pickup'
                ? <Button variant="outline" size={big ? 'lg' : 'sm'} className="flex-1" loading={busy === 'picked_up'} onClick={() => run('picked_up')} icon={<Check className="size-4" />}>{t('Remise au client', 'Picked up')}</Button>
                : <div className="flex flex-1 items-center gap-1.5 px-2 text-[13px] font-semibold text-ink-3"><Bike className="size-4" />{t('Attend le livreur', 'Waiting for the courier')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
