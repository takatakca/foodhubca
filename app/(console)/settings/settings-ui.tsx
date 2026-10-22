'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/ui/card';
import { LinkTabs } from '@/components/ui/tabs';
import { useScopeHref } from '@/components/live/pulse';
import { SETTINGS_PAGES, settingsPageOf } from '@/components/shell/settings-pages';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';

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
 * A Settings page's header: "← Réglages" back to the hub, the title, and the tabs of its own group only (at most 4).
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
      <PageHeader
        eyebrow={<Link href={href('/settings')} className="-my-1.5 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 normal-case tracking-normal text-brand hover:underline"><ArrowLeft className="size-3.5" />{t('Réglages', 'Settings')}</Link>}
        title={title} subtitle={intro} right={right} />
      {tabs.length > 1 && <LinkTabs tabs={tabs.map((p) => ({ href: p.href, label: t(p.fr, p.en) }))} />}
    </>
  );
}

export function Section({ title, subtitle, right, children, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="mb-5 rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-ink-2">{icon}</div>}
          <div className="min-w-0"><h2 className="text-base font-extrabold text-ink">{title}</h2>{subtitle && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{subtitle}</p>}</div>
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
