'use client';

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ChevronRight, Clock, LayoutList, PauseCircle, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { useScopeHref } from '@/components/live/pulse';
import { useViewer } from '@/components/shell/viewer';
import { SETTINGS_GROUPS, SETTINGS_PAGES, roleLabel } from './settings-ui';
import { useI18n } from '@/lib/i18n/client';

type CardDef = { href: string; icon: ComponentType<{ className?: string }>; fr: string; en: string; dfr: string; den: string };

/** Restaurants pages, listed here too so an owner finds them from Settings (links only: they are not Settings tabs). */
const RESTAURANT_LINKS: Array<CardDef & { perm: string }> = [
  { href: '/stores', icon: PauseCircle, perm: 'view', fr: 'Statut et pauses', en: 'Status & pauses', dfr: 'Ouvert, en pause ou fermé, sur chaque plateforme. Pause et réouverture.', den: 'Open, paused or closed on each platform. Pause and reopen.' },
  { href: '/stores/list', icon: LayoutList, perm: 'view', fr: 'Tous les magasins', en: 'All stores', dfr: 'Chaque marque, sur chaque plateforme, dans chaque succursale.', den: 'Every brand, on every platform, at every location.' },
  { href: '/stores/hours', icon: Clock, perm: 'menu:edit', fr: 'Heures d’ouverture', en: 'Opening hours', dfr: 'Les heures de chaque marque et les jours fériés.', den: 'Each brand’s hours and holidays.' },
];

function HubCard({ c }: { c: CardDef }) {
  const { t } = useI18n();
  const href = useScopeHref();
  const Icon = c.icon;
  return (
    <Link href={href(c.href)} className="group flex min-h-20 items-start gap-4 rounded-md border border-line bg-surface p-5 transition-colors hover:border-ink-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-md bg-ink text-canvas"><Icon className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 font-extrabold text-ink">{t(c.fr, c.en)}<ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" /></div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{t(c.dfr, c.den)}</p>
      </div>
    </Link>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-[13px] font-bold tracking-[0.1em] text-ink-3 uppercase">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export default function SettingsHub() {
  const { t } = useI18n();
  const { can, viewer, full, canFull, setFull } = useViewer();
  const restaurants = RESTAURANT_LINKS.filter((p) => can(p.perm));
  return (
    <div>
      <PageHeader title={t('Réglages', 'Settings')} subtitle={<span className="flex flex-wrap items-center gap-2">{viewer.name}<Badge tone="dark">{roleLabel(t, viewer.role)}</Badge>{viewer.device && <Badge tone="info">{t('Tablette', 'Tablet')} · {viewer.device.name}</Badge>}</span>} />
      {restaurants.length > 0 && <Group title={t('Vos restaurants', 'Your restaurants')}>{restaurants.map((c) => <HubCard key={c.href} c={c} />)}</Group>}
      {SETTINGS_GROUPS.map((g) => {
        const pages = SETTINGS_PAGES.filter((p) => p.group === g.key && can(p.perm));
        if (g.key === 'advanced' && !full) {
          // Simple view: one card in place of the technician tools (owners and managers can switch to the full view).
          if (!canFull) return null;
          return (
            <Group key={g.key} title={t(g.fr, g.en)}>
              <div data-help="settings.advanced" className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5 sm:col-span-2 xl:col-span-3 sm:flex-row sm:items-center">
                <div className="grid size-11 shrink-0 place-items-center rounded-md bg-sunken text-ink-2"><Wrench className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-ink">{t('Outils avancés', 'Advanced tools')}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{t('Pour votre technicien ou notre équipe : branchements, API, mise en service.', 'For your technician or our team: connections, APIs, go-live.')}</p>
                </div>
                <Button variant="outline" onClick={() => setFull(true)}>{t('Passer à la vue complète', 'Switch to the full view')}</Button>
              </div>
            </Group>
          );
        }
        if (!pages.length) return null;
        return <Group key={g.key} title={t(g.fr, g.en)}>{pages.map((p) => <HubCard key={p.href} c={p} />)}</Group>;
      })}
    </div>
  );
}
