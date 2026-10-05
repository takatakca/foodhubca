'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge, PlatformMark, platformOf } from '@/components/ui/badge';
import { Banner } from '@/components/ui/card';
import { OrderDetail, STATUS_TONE, statusLabel, type FullOrder } from '@/components/live/order-drawer';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { OrderEvent, StoredOrder } from '@/lib/foodhub/types';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const [order, setOrder] = useState<FullOrder | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const d = await api<{ order: StoredOrder; events: OrderEvent[]; actions: string[] }>(`/api/foodhub/orders/${id}`); setOrder({ ...d.order, actions: d.actions }); setEvents(d.events); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/orders?view=history" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t('Commandes', 'Orders')}</Link>
      {error && <Banner tone="stop">{error}</Banner>}
      {order && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <PlatformMark channel={order.channel} size="lg" />
            <div><h1 className="text-2xl font-extrabold">#{order.displayId || order.externalOrderId.slice(0, 8)}</h1><div className="text-sm text-ink-3">{platformOf(order.channel).label} · {order.brandName ?? '—'}</div></div>
            <Badge tone={STATUS_TONE[order.status]} className="ml-auto text-sm">{statusLabel(t, order.status)}</Badge>
          </div>
          <OrderDetail order={order} events={events} compact onChange={() => load()} />
        </>
      )}
    </div>
  );
}
