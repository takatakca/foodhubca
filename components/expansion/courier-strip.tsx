'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bike, TriangleAlert, Wine } from 'lucide-react';
import { useViewer } from '@/components/shell/viewer';
import type { Delivery } from '@/lib/foodhub/delivery/types';
import { api, timeOf } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { deliveryStatusLabel } from './labels';

type Item = { id: string; number: string; brandName: string; locationCode: string; status: string; readyAt: string | null; attention: string | null; containsAlcohol: boolean; delivery: Delivery | null };

/**
 * Kitchen screen: our own delivery orders with their courier ("Dasher at the counter", "on the way"), big and dark like
 * the rest of the kitchen. Nothing at all while own delivery is off or there is nothing on the road.
 */
export function CourierStrip({ locationCode }: { locationCode?: string }) {
  const { t, loc } = useI18n();
  const { features } = useViewer();
  const [items, setItems] = useState<Item[]>([]);
  const on = features.includes('delivery');
  const load = useCallback(() => api<{ items: Item[] }>(`/api/foodhub/delivery/active${locationCode ? `?location=${encodeURIComponent(locationCode)}` : ''}`).then((d) => setItems(d.items)).catch(() => undefined), [locationCode]);
  useEffect(() => { if (!on) return; load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load, on]);
  if (!on || !items.length) return null;
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {items.map((o) => {
        const d = o.delivery;
        const here = d?.status === 'at_pickup';
        return (
          <Link key={o.id} href="/direct" className={cn('flex min-h-14 min-w-56 shrink-0 items-center gap-3 rounded-lg border px-3 py-2', here ? 'border-brand bg-brand-soft' : o.attention ? 'border-wait/60 bg-wait-soft' : 'border-line bg-surface')}>
            <Bike className={cn('size-6 shrink-0', here ? 'text-brand' : 'text-ink-3')} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[15px] font-extrabold"><span className="num">{o.number}</span><span className="truncate text-xs font-semibold text-ink-3">{o.brandName}</span>{o.containsAlcohol && <Wine className="size-3.5 text-violet" />}</div>
              <div className={cn('text-[13px] font-semibold', here ? 'text-brand-2' : 'text-ink-2')}>
                {o.attention && !d ? <span className="flex items-center gap-1 text-wait-2"><TriangleAlert className="size-3.5" />{t('À vérifier', 'Check it')}</span>
                  : d ? `${deliveryStatusLabel(t, d.status)}${d.courier?.name ? ` · ${d.courier.name}` : ''}${d.pickupEta && ['created', 'assigned'].includes(d.status) ? ` · ${t('arrive', 'arrives')} ${timeOf(d.pickupEta, loc)}` : ''}`
                    : `${t('Livreur pas encore demandé', 'No courier yet')}${o.readyAt ? ` · ${t('prête', 'ready')} ${timeOf(o.readyAt, loc)}` : ''}`}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
