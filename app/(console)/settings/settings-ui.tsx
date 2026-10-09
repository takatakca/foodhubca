'use client';

import type { ReactNode } from 'react';
import { BellRing, Blocks, Building2, MonitorSmartphone, PlugZap, Rocket, ShieldCheck, Store, Truck, UserRound, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/card';
import { LinkTabs } from '@/components/ui/tabs';
import { useViewer } from '@/components/shell/viewer';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';

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

export const SETTINGS_PAGES = [
  { href: '/settings/profile', icon: UserRound, perm: 'view', fr: 'Mon profil', en: 'My profile', dfr: 'Nom, courriel, cellulaire, langue, votre NIP et vos alertes.', den: 'Name, email, cell, language, your PIN and your alerts.' },
  { href: '/settings/team', icon: Users, perm: 'stores:map', fr: 'Équipe et NIP', en: 'Team & PINs', dfr: 'Qui a accès, à quelles succursales, avec quel rôle et quel NIP.', den: 'Who has access, to which locations, with which role and PIN.' },
  { href: '/settings/devices', icon: MonitorSmartphone, perm: 'view', fr: 'Tablettes', en: 'Tablets', dfr: 'Les écrans de cuisine : en ligne, son, batterie. Enregistrer ou retirer.', den: 'Kitchen screens: online, sound, battery. Enrol or remove.' },
  { href: '/settings/security', icon: ShieldCheck, perm: 'view', fr: 'NIP gérant', en: 'Manager PIN', dfr: 'Quelles actions demandent le NIP d’un gérant : refuser, annuler, rembourser, fermer…', den: 'Which actions need a manager PIN: reject, cancel, refund, pause…' },
  { href: '/settings/alerts', icon: BellRing, perm: 'view', fr: 'Alertes et surveillance', en: 'Alerts & watchtower', dfr: 'Quand texter, appeler, réveiller le propriétaire. Heures calmes, IA, clavardage.', den: 'When to text, call, wake the owner. Quiet hours, AI, chat.' },
  { href: '/settings/channels', icon: PlugZap, perm: 'stores:map', fr: 'Plateformes et Clover', en: 'Platforms & Clover', dfr: 'Adresses webhook, secrets à donner aux plateformes, état des branchements.', den: 'Webhook URLs, secrets to give the platforms, connection status.' },
  { href: '/settings/doordash', icon: Truck, perm: 'stores:map', fr: 'DoorDash (API)', en: 'DoorDash (API)', dfr: 'Toutes les API DoorDash : lectures en direct, ruptures, heures, rapports, épicerie, Drive, publicité.', den: 'Every DoorDash API: live reads, 86s, hours, reports, retail, Drive, ads.' },
  { href: '/settings/business', icon: Building2, perm: 'view', fr: 'Entreprise', en: 'Business', dfr: 'Succursales et marques.', den: 'Locations and brands.' },
  { href: '/settings/clover-app', icon: Store, perm: 'admin', fr: 'App Clover', en: 'Clover app', dfr: 'Fiche App Market : textes, adresses à copier, soumission, marchands en attente.', den: 'App Market listing: texts, addresses to copy, submission, merchants waiting.' },
  { href: '/settings/expansion', icon: Blocks, perm: 'view', fr: 'Expansion', en: 'Expansion', dfr: 'Livraison par nos coursiers, épicerie, alcool, commandes par téléphone (IA) : interrupteurs et règles.', den: 'Own-order delivery, grocery, alcohol, AI phone ordering: switches and rules.' },
  { href: '/settings/go-live', icon: Rocket, perm: 'admin', fr: 'Mise en service', en: 'Go-live', dfr: 'La liste de ce qui reste avant d’ouvrir les vannes.', den: 'What is left before switching everything on.' },
] as const;

export function SettingsHead({ title, intro, right }: { title: string; intro?: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  const { can } = useViewer();
  return (
    <>
      <PageHeader eyebrow={t('Réglages', 'Settings')} title={title} subtitle={intro} right={right} />
      <LinkTabs tabs={SETTINGS_PAGES.filter((p) => can(p.perm)).map((p) => ({ href: p.href, label: t(p.fr, p.en) }))} />
    </>
  );
}

export function Section({ title, subtitle, right, children, icon }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-surface shadow-card">
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
