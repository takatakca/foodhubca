import { BellRing, ChartNoAxesCombined, ChefHat, LayoutDashboard, ReceiptText, Settings, Store, UtensilsCrossed } from 'lucide-react';
import type { T } from '@/lib/i18n';

/**
 * The console's menu, DoorDash Merchant style: a few groups. A group lists sections underneath only when they are
 * separate pages without tabs between them (Orders → own orders, Reports → money); other sub-pages are tabs on the page.
 * `features`: shown only when one of these expansion features is on. `match`: other paths that light up the group.
 */
export type NavChild = { href: string; label: (t: T) => string; perm: string; allLocations?: boolean; features?: string[]; exact?: boolean };
export type NavItem = {
  href: string; icon: typeof LayoutDashboard; label: (t: T) => string; perm: string; allLocations?: boolean;
  badge?: 'orders' | 'alerts' | 'stores'; features?: string[]; match?: string[]; children?: NavChild[];
};

export const NAV: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: (t) => t('Aujourd’hui', 'Today'), perm: 'view' },
  {
    href: '/orders', icon: ReceiptText, label: (t) => t('Commandes', 'Orders'), perm: 'view', badge: 'orders', match: ['/direct'],
    children: [
      { href: '/orders', label: (t) => t('Toutes les commandes', 'All orders'), perm: 'view' },
      { href: '/direct', label: (t) => t('Nos commandes', 'Own orders'), perm: 'view', features: ['delivery', 'phone'] },
    ],
  },
  { href: '/kitchen', icon: ChefHat, label: (t) => t('Écran cuisine', 'Kitchen screen'), perm: 'view' },
  // Menus and Restaurants keep their sub-pages as tabs on the page (86 board, hours, platform links).
  { href: '/menu', icon: UtensilsCrossed, label: (t) => t('Menus', 'Menus'), perm: 'items:toggle' },
  { href: '/stores', icon: Store, label: (t) => t('Restaurants', 'Restaurants'), perm: 'view', badge: 'stores' },
  {
    href: '/insights', icon: ChartNoAxesCombined, label: (t) => t('Rapports', 'Reports'), perm: 'analytics:view', match: ['/money'],
    children: [
      { href: '/insights', label: (t) => t('Analyses', 'Insights'), perm: 'analytics:view' },
      { href: '/money', label: (t) => t('Argent', 'Money'), perm: 'analytics:view', allLocations: true },
    ],
  },
  { href: '/settings', icon: Settings, label: (t) => t('Réglages', 'Settings'), perm: 'view' },
];

/** Alerts live in the top bar (bell with a counter); listed here for search and the mobile bar. */
export const ALERTS: NavItem = { href: '/alerts', icon: BellRing, label: (t) => t('Alertes', 'Alerts'), perm: 'view', badge: 'alerts' };

export function navVisible(n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>, can: (perm: string) => boolean, allLocations: boolean, features: string[]): boolean {
  return can(n.perm) && (!n.allLocations || allLocations) && (!n.features || n.features.some((f) => features.includes(f)));
}

/** Is this group the current page (its own path, a sub-page, or one of its other paths)? */
export function navActive(n: Pick<NavItem, 'href' | 'match'>, path: string): boolean {
  if (n.href === '/') return path === '/';
  return [n.href, ...(n.match ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
}

export function childActive(c: Pick<NavChild, 'href' | 'exact'>, path: string): boolean {
  return c.exact ? path === c.href : path === c.href || path.startsWith(`${c.href}/`);
}
