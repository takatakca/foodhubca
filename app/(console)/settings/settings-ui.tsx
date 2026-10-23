'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/card';
import { LinkTabs } from '@/components/ui/tabs';
import { useScopeHref } from '@/components/live/pulse';
import { SETTINGS_PAGES, settingsPageOf } from '@/components/shell/settings-pages';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import { TechDetails } from './tech-details';

export { SETTINGS_GROUPS, SETTINGS_PAGES, type SettingsGroup } from '@/components/shell/settings-pages';

export type Role = 'owner' | 'manager' | 'operator' | 'menu' | 'analyst';
export const ROLES: Role[] = ['owner', 'manager', 'operator', 'menu', 'analyst'];
export function roleLabel(t: T, r: string) {
  return ({ owner: t('Propriétaire', 'Owner'), manager: t('Gérant', 'Manager'), operator: t('Employé', 'Staff'), menu: t('Éditeur de menu', 'Menu editor'), analyst: t('Comptable / analyste', 'Accountant / analyst') } as Record<string, string>)[r] ?? r;
}
export function roleHelp(t: T, r: string) {
  return ({
    owner: t('Tout, y compris l’argent, les règles et l’équipe.', 'Everything, including money, rules and the team.'),
    manager: t('Commandes, magasins, menus, équipe de ses succursales, argent. Son NIP approuve les actions des employés.', 'Orders, stores, menus, team at their locations, money. Their PIN approves staff actions.'),
    operator: t('Accepter et préparer les commandes, mettre des articles en rupture, mode occupé.', 'Accept and prepare orders, 86 items, busy mode.'),
    menu: t('Menus, prix et disponibilité.', 'Menus, prices and availability.'),
    analyst: t('Lecture seule : analyses, rapports et argent.', 'Read only: insights, reports and money.'),
  } as Record<string, string>)[r] ?? '';
}

/**
 * A Settings page's header: "← Réglages" back to the hub, the title, and the action on the right. From 1280 px the
 * side-nav (settings-nav.tsx) lists every page, so the tabs of the page's own group (at most 4) only show below that.
 * An advanced page opened by its address in the simple view still renders, with its group's tabs.
 */
export function SettingsHead({ title, intro, right }: { title: string; intro?: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  const { can } = useViewer();
  const path = usePathname();
  const href = useScopeHref();
  const group = settingsPageOf(path)?.group;
  const tabs = group ? SETTINGS_PAGES.filter((p) => p.group === group && can(p.perm)) : [];
  return (
    <>
      <PageHeader back={{ href: href('/settings'), label: t('Réglages', 'Settings') }} title={title} subtitle={intro} right={right} />
      {tabs.length > 1 && <LinkTabs className="xl:hidden" label={t('Pages de ce groupe', 'Pages in this group')} tabs={tabs.map((p) => ({ href: p.href, label: t(p.fr, p.en) }))} />}
    </>
  );
}

/**
 * A settings card. `subtitle` is one plain sentence (inline content: it sits in a <p>); `tech` folds the setting names
 * behind it under « Détails techniques », rendered after the <p> (a <details> block may not sit inside a paragraph).
 */
export function Section({ title, subtitle, tech, right, children, icon }: { title: ReactNode; subtitle?: ReactNode; tech?: ReactNode; right?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="mb-6 min-w-0 rounded-md border border-line bg-surface shadow-card">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-ink-2">{icon}</div>}
          <div className="min-w-0"><h2 className="text-heading break-words text-ink">{title}</h2>{subtitle && <p className="text-small mt-0.5 break-words text-ink-3">{subtitle}</p>}{tech && <TechDetails className="mt-1">{tech}</TechDetails>}</div>
        </div>
        {right}
      </div>
      <div className="min-w-0 px-5 py-5">{children}</div>
    </section>
  );
}
