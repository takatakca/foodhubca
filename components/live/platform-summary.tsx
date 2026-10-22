'use client';

// Home → "Par plateforme": one row per platform in use (stores, open stores, today's orders and sales). A tap shows that
// platform alone (the console's platform scope). Clover in-store sales get their own row (not a platform filter).
import { ChevronRight, Store } from 'lucide-react';
import { Card, CardHeader, Skeleton } from '@/components/ui/card';
import { PlatformMark } from '@/components/ui/badge';
import { usePulse } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { storesText } from '@/components/shell/scope-switcher';
import type { CommandCenter } from '@/lib/foodhub/command';
import { channelName, countStores } from '@/lib/foodhub/scope';
import { money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';

export function PlatformSummary({ cc }: { cc: CommandCenter | null }) {
  const { t, loc } = useI18n();
  const { stores } = useViewer();
  const { site, setSite } = usePulse();
  const rows = (cc?.channels ?? [])
    .map((c) => {
      const pickable = countStores({ stores }, { kitchen: site.kitchen, brand: site.brand, channel: c.channel });
      return { ...c, pickable, known: Math.max(c.storesMapped, pickable) };
    })
    .filter((c) => c.known > 0 || c.orders > 0);
  const inStore = cc?.kpis.inStore ?? 0;
  if (cc && !rows.length && !inStore) return null;
  return (
    <Card data-help="home.platforms">
      <CardHeader title={t('Par plateforme', 'By platform')} subtitle={t('Touchez une plateforme pour la voir seule.', 'Tap a platform to see it on its own.')} icon={<Store className="size-5" />} />
      <div className="divide-y divide-line border-t border-line">
        {!cc && <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {rows.map((c) => {
          const body = <>
            <PlatformMark channel={c.channel} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-ink">{channelName(c.channel)}</span>
              <span className="block truncate text-xs text-ink-3">{[c.known ? storesText(t, c.known) : null, c.storesMapped ? t(`${c.storesOnline} ouvert${c.storesOnline > 1 ? 's' : ''}`, `${c.storesOnline} open`) : null].filter(Boolean).join(' · ') || t('magasin pas encore relié', 'store not linked yet')}</span>
            </span>
            <span className="w-28 text-right">
              <span className="num block text-[15px] font-extrabold text-ink">{money(c.sales, loc)}</span>
              <span className="block text-xs text-ink-3">{t(`${c.orders} commande${c.orders > 1 ? 's' : ''}`, `${c.orders} order${c.orders === 1 ? '' : 's'}`)}</span>
            </span>
          </>;
          // A platform with orders but no store this person can pick (a store nobody linked yet): a plain row, since
          // picking it would show nothing.
          return c.pickable > 0
            ? <button key={c.channel} type="button" onClick={() => setSite({ channel: c.channel })} className="group flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left hover:bg-raised sm:gap-4">{body}<ChevronRight className="size-4 shrink-0 text-ink-4 group-hover:text-ink-2" /></button>
            : <div key={c.channel} className="flex min-h-16 items-center gap-3 px-5 py-3 sm:gap-4">{body}<span className="size-4 shrink-0" aria-hidden /></div>;
        })}
        {inStore > 0 && (
          <div className="flex min-h-16 items-center gap-3 px-5 py-3 sm:gap-4">
            <PlatformMark channel="clover" size="md" />
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold text-ink">{t('En salle (Clover)', 'In store (Clover)')}</span><span className="block text-xs text-ink-3">{t(`${cc?.kpis.inStorePayments ?? 0} paiement(s)`, `${cc?.kpis.inStorePayments ?? 0} payment(s)`)}</span></span>
            <span className="w-28 text-right"><span className="num block text-[15px] font-extrabold text-ink">{money(inStore, loc)}</span></span>
            <span className="size-4 shrink-0" aria-hidden />
          </div>
        )}
      </div>
    </Card>
  );
}
