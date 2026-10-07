'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, PhoneCall, ShoppingBasket, Truck, Wine } from 'lucide-react';
import { useViewer } from '@/components/shell/viewer';
import type { ExpansionSummary } from '@/lib/foodhub/expansion/summary';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

/** Overview: one tile per expansion feature that is on (nothing at all while every switch is off). */
export function ExpansionTiles() {
  const { t, loc } = useI18n();
  const { features } = useViewer();
  const [d, setD] = useState<ExpansionSummary | null>(null);
  const load = useCallback(() => api<ExpansionSummary>('/api/foodhub/expansion').then(setD).catch(() => undefined), []);
  useEffect(() => { if (!features.length) return; load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load, features.length]);
  if (!features.length || !d) return null;
  const x = d.today;
  const tiles = [
    features.includes('delivery') && { key: 'delivery', href: '/direct', icon: Truck, title: t('Nos livraisons', 'Own delivery'), value: String(x.orders), unit: t('commandes', 'orders'),
      lines: [`${money(x.sales, loc)} · ${x.deliveriesActive} ${t('sur la route', 'on the road')}`, `${t('Livreurs', 'Couriers')} ${money(x.courierCost, loc)} / ${t('frais', 'fees')} ${money(x.feesCharged, loc)}`], alert: x.attention ? t(`${x.attention} à vérifier`, `${x.attention} need a person`) : null },
    features.includes('phone') && { key: 'phone', href: '/direct/calls', icon: PhoneCall, title: t('Téléphone IA', 'AI phone'), value: String(x.calls), unit: t('appels', 'calls'),
      lines: [`${x.callsOrdered} ${t('commandes passées', 'orders placed')}`, x.calls ? `${Math.round((x.callsOrdered / x.calls) * 100)} % ${t('de conversion', 'conversion')}` : t('aucun appel aujourd’hui', 'no calls today')], alert: x.callsMissed ? t(`${x.callsMissed} à rappeler`, `${x.callsMissed} to call back`) : null },
    features.includes('retail') && { key: 'retail', href: '/menu/retail', icon: ShoppingBasket, title: t('Épicerie', 'Grocery'), value: String(x.products), unit: t('produits', 'products'),
      lines: [t('DoorDash / Uber : approbation requise', 'DoorDash / Uber: approval needed')], alert: x.lowStock ? t(`${x.lowStock} en stock bas`, `${x.lowStock} low on stock`) : null },
    features.includes('alcohol') && { key: 'alcohol', href: '/settings/expansion/alcohol', icon: Wine, title: t('Alcool', 'Alcohol'), value: String(x.alcoholLocations), unit: t('succursale(s) avec permis', 'location(s) with a permit'),
      lines: [t('Bloqué partout ailleurs', 'Blocked everywhere else')], alert: null },
  ].filter(Boolean) as Array<{ key: string; href: string; icon: typeof Truck; title: string; value: string; unit: string; lines: string[]; alert: string | null }>;
  return (
    <div className={cn('grid gap-3', tiles.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : tiles.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {tiles.map((tile) => (
        <Link key={tile.key} href={tile.href} className={cn('group rounded-xl border bg-surface p-4 shadow-card transition-colors hover:border-ink-4', tile.alert ? 'border-wait/50' : 'border-line')}>
          <div className="flex items-center justify-between text-[13px] font-medium text-ink-3"><span className="flex items-center gap-1.5"><tile.icon className="size-4" />{tile.title}</span><ArrowRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" /></div>
          <div className="mt-1 flex items-baseline gap-1.5"><span className="num text-[28px] leading-tight font-extrabold">{tile.value}</span><span className="text-xs text-ink-3">{tile.unit}</span></div>
          {tile.lines.map((l) => <div key={l} className="text-xs text-ink-3">{l}</div>)}
          {tile.alert && <div className="mt-1 text-xs font-bold text-wait-2">{tile.alert}</div>}
        </Link>
      ))}
    </div>
  );
}
