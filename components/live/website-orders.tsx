'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, Globe, PackageCheck, Printer, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown, Elapsed, useNow } from '@/components/ui/timer';
import { useToast } from '@/components/ui/toast';
import { refreshEverything, useRefreshOn } from '@/components/live/pulse';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { ALLERGY } from './order-drawer';
import type { DirectOrder } from '@/lib/foodhub/delivery/types';
import { api, ApiError, money, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/**
 * Website orders that Clover Online Ordering took (pppmtl.com's "Commander en ligne" button…). Clover accepted, printed
 * and sent them to its KDS; this screen only mirrors them. Clover stays the source of truth: refunds and cancels are
 * done in Clover and come back here by themselves.
 */
export function useWebsiteOrders(locationCode?: string | null) {
  const [orders, setOrders] = useState<DirectOrder[]>([]);
  const load = useCallback(async () => {
    const q = locationCode ? `?locations=${encodeURIComponent(locationCode)}` : '';
    const d = await api<{ orders: DirectOrder[] }>(`/api/foodhub/website-orders${q}`).catch(() => null);
    if (d) setOrders(d.orders);
  }, [locationCode]);
  useEffect(() => { load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load]);
  useRefreshOn(load);
  return { orders, reload: load };
}

/** One website order on the kitchen screen: "accepted in Clover", the items, and the screen's own Seen / Ready / Done. */
export function WebsiteOrderCard({ o, big, onChanged }: { o: DirectOrder; big?: boolean; onChanged?: () => void }) {
  const { t, loc } = useI18n();
  const { can, locName } = useViewer();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const items = o.lines.reduce((s, l) => s + l.quantity, 0);
  const unseen = !o.seenAt && o.status !== 'ready';
  const allergy = [o.notes, ...o.lines.map((l) => l.notes)].some((n) => n && ALLERGY.test(n));
  const now = useNow(15_000);
  const late = o.status === 'in_kitchen' && o.readyAt && Date.parse(o.readyAt) < now;

  async function run(action: 'ack' | 'ready' | 'complete') {
    setBusy(action);
    try {
      await api(`/api/foodhub/website-orders/${o.id}`, { method: 'POST', json: { action } });
      onChanged?.();
      refreshEverything();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('rounded-lg border bg-surface shadow-card', unseen ? 'border-clover ring-2 ring-clover/25' : late ? 'border-stop/50' : 'border-line')}>
      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <span className={cn('inline-flex shrink-0 items-center justify-center rounded-sm bg-clover text-white', big ? 'size-8' : 'size-6')} title={t('Site web · Clover en ligne', 'Website · Clover Online')}><Globe className={big ? 'size-4.5' : 'size-3.5'} /></span>
          <div className="min-w-0 flex-1">
            <div className={cn('flex items-baseline gap-2 font-extrabold text-ink', big ? 'text-xl' : 'text-base')}>{o.customer.name || o.number}<span className="truncate text-[13px] font-semibold text-ink-3">{o.brandName}</span></div>
            <div className="truncate text-xs text-ink-3">{o.number} · {shortLoc(locName(o.locationCode))} · {items} {t('art.', 'items')} · {money(o.total, loc)}</div>
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
        {o.notes && big && <p className={cn('mt-2 rounded px-2 py-1 text-[13px] font-semibold', ALLERGY.test(o.notes) ? 'bg-stop text-white' : 'bg-sunken text-ink-2')}>« {o.notes} »</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="go" icon={<Check className="size-3" />} title={t('Clover a accepté, encaissé et imprimé la commande. Food Hub la suit seulement.', 'Clover accepted, charged and printed the order. Food Hub only follows it.')}>{t('Acceptée dans Clover', 'Accepted in Clover')}</Badge>
          {o.posPrintedAt
            ? <Badge tone="info" icon={<Printer className="size-3" />}>{t('Imprimée par Clover', 'Printed by Clover')}</Badge>
            : <Badge tone="neutral" icon={<Printer className="size-3" />} title={t('Clover ne l’a pas encore marquée imprimée. Food Hub n’imprime jamais ces commandes : vérifiez l’imprimante Clover ou le KDS.', 'Clover has not marked it printed yet. Food Hub never prints these orders: check the Clover printer or KDS.')}>{t('Impression Clover en attente', 'Clover print pending')}</Badge>}
          {o.status === 'in_kitchen' && o.readyAt && <Badge tone={late ? 'stop' : 'neutral'}>{timeOf(o.readyAt, loc)} · <Countdown to={o.readyAt} className="text-inherit" /></Badge>}
          <Badge tone="neutral">{o.fulfillment === 'delivery' ? t('Livraison (Clover)', 'Delivery (Clover)') : t('Pour emporter', 'Pickup')}</Badge>
          {o.payment !== 'paid' && <Badge tone="wait">{t('À payer au comptoir', 'Pay at the counter')}</Badge>}
          {unseen && <Badge tone="brand" icon={<Eye className="size-3" />}>{t('pas vue', 'not seen')}</Badge>}
          {allergy && <Badge tone="stop" icon={<TriangleAlert className="size-3" />}>{t('allergie', 'allergy')}</Badge>}
          {o.attention && <Badge tone="wait" icon={<TriangleAlert className="size-3" />} title={o.attention}>{t('à vérifier', 'check')}</Badge>}
        </div>
      </div>
      {can('orders:act') && (
        <div className="border-t border-line p-2">
          <div className="flex gap-1.5">
            {unseen && <Button variant="soft" size={big ? 'lg' : 'sm'} loading={busy === 'ack'} onClick={() => run('ack')} icon={<Eye className="size-4" />}>{t('Vu', 'Seen')}</Button>}
            {o.status === 'in_kitchen' || o.status === 'new'
              ? <Button variant="go" size={big ? 'lg' : 'sm'} className="flex-1" loading={busy === 'ready'} onClick={() => run('ready')} icon={<PackageCheck className="size-4" />}>{t('Prête', 'Ready')}</Button>
              : <Button variant="outline" size={big ? 'lg' : 'sm'} className="flex-1" loading={busy === 'complete'} onClick={() => run('complete')} icon={<Check className="size-4" />}>{t('Remise / terminée', 'Handed over / done')}</Button>}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-ink-4">{t('Sur cet écran seulement. Annuler ou rembourser : dans Clover.', 'On this screen only. Cancel or refund: in Clover.')}</p>
        </div>
      )}
    </div>
  );
}
