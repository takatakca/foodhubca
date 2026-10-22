import { Ban, BellRing, ChartNoAxesCombined, ChefHat, House, LayoutDashboard, ReceiptText, Settings, Store, UtensilsCrossed } from 'lucide-react';
import type { T } from '@/lib/i18n';
import { SETTINGS_PAGES } from './settings-pages';

/**
 * The console's menu, DoorDash Merchant style: a few groups. A group lists sections underneath only when they are
 * separate pages without tabs between them (Orders → own orders, Reports → money); other sub-pages are tabs on the page.
 * `features`: shown only when one of these expansion features is on. `match`: other paths that light up the group.
 *
 * Two menus: `NAV_SIMPLE` (the default "simple view", 6 entries in plain words) and `NAV` (the "full view", today's
 * console, unchanged). The view only hides links: every page still opens by its address and through search.
 */
export type NavChild = { href: string; label: (t: T) => string; perm: string; allLocations?: boolean; features?: string[]; exact?: boolean };
export type NavItem = {
  href: string; icon: typeof LayoutDashboard; label: (t: T) => string; perm: string; allLocations?: boolean;
  badge?: 'orders' | 'alerts' | 'stores'; features?: string[]; match?: string[]; children?: NavChild[];
};

/** The full view's menu: exactly the console before task 40. */
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

/** The kitchen screen as a menu entry of its own (full view; operators and kitchen tablets in the simple view). */
export const KITCHEN: NavItem = { href: '/kitchen', icon: ChefHat, label: (t) => t('Écran cuisine', 'Kitchen screen'), perm: 'view' };

/** The sold-out board (86), for the phone's bottom bar. */
export const SOLD_OUT: NavItem = { href: '/menu/86', icon: Ban, label: (t) => t('Épuisés', 'Sold out'), perm: 'items:toggle' };

const DIRECT: NavChild = { href: '/direct', label: (t) => t('Commandes directes', 'Direct orders'), perm: 'view', features: ['delivery', 'phone'] };

const HOME_SIMPLE: NavItem = { href: '/', icon: House, label: (t) => t('Accueil', 'Home'), perm: 'view' };
const ORDERS_SIMPLE: NavItem = {
  href: '/orders', icon: ReceiptText, label: (t) => t('Commandes', 'Orders'), perm: 'view', badge: 'orders', match: ['/direct', '/kitchen'],
  children: [
    { href: '/orders', label: (t) => t('Toutes les commandes', 'All orders'), perm: 'view' },
    { href: '/kitchen', label: (t) => t('Écran cuisine', 'Kitchen screen'), perm: 'view' },
    DIRECT,
  ],
};
const MENUS: NavItem = { href: '/menu', icon: UtensilsCrossed, label: (t) => t('Menus', 'Menus'), perm: 'items:toggle' };
const RESTAURANTS: NavItem = { href: '/stores', icon: Store, label: (t) => t('Restaurants', 'Restaurants'), perm: 'view', badge: 'stores' };
const REPORTS_SIMPLE: NavItem = {
  href: '/insights', icon: ChartNoAxesCombined, label: (t) => t('Rapports', 'Reports'), perm: 'analytics:view', match: ['/money'],
  children: [
    { href: '/insights', label: (t) => t('Ventes et tendances', 'Sales & trends'), perm: 'analytics:view' },
    { href: '/money', label: (t) => t('Argent', 'Money'), perm: 'analytics:view', allLocations: true },
  ],
};
const SETTINGS: NavItem = { href: '/settings', icon: Settings, label: (t) => t('Réglages', 'Settings'), perm: 'view' };

/** The simple view's menu: 6 entries. The kitchen screen sits under Orders. */
export const NAV_SIMPLE: NavItem[] = [HOME_SIMPLE, ORDERS_SIMPLE, MENUS, RESTAURANTS, REPORTS_SIMPLE, SETTINGS];

/** Staff on the line (operator) and kitchen tablets: the kitchen screen is a top entry, right after Home. */
const ORDERS_FLOOR: NavItem = { ...ORDERS_SIMPLE, match: ['/direct'], children: ORDERS_SIMPLE.children!.filter((c) => c.href !== '/kitchen') };
const NAV_FLOOR: NavItem[] = [HOME_SIMPLE, KITCHEN, ORDERS_FLOOR, MENUS, RESTAURANTS, REPORTS_SIMPLE, SETTINGS];

type Who = { device?: unknown; role?: string };
const onTheFloor = (who: Who) => Boolean(who.device) || who.role === 'operator';

/** The rail for this person: the full view's menu, or the simple one (kitchen screen on top for operators and tablets). */
export function navFor(full: boolean, who: Who): NavItem[] {
  if (full) return NAV;
  return onTheFloor(who) ? NAV_FLOOR : NAV_SIMPLE;
}

/**
 * The phone's bottom bar (4 slots, then "Plus"): the full view keeps today's bar; the simple view takes the first 4
 * allowed of Home, Orders, Sold out, Restaurants, Reports; operators and tablets get Orders, Kitchen, Sold out, Restaurants.
 */
export function mobileNav(full: boolean, who: Who, visible: (n: Pick<NavItem, 'perm' | 'allLocations' | 'features'>) => boolean): NavItem[] {
  if (full) return [NAV[0], NAV[1], NAV[2], ALERTS].filter(visible);
  const list = onTheFloor(who) ? [ORDERS_FLOOR, KITCHEN, SOLD_OUT, RESTAURANTS] : [HOME_SIMPLE, ORDERS_SIMPLE, SOLD_OUT, RESTAURANTS, REPORTS_SIMPLE];
  return list.filter(visible).slice(0, 4);
}

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

type Page = { href: string; label: (t: T) => string; perm: string; allLocations?: boolean; features?: string[] };

/** Pages that are tabs on another page (Restaurants, Menus, Reports, Money): reachable from search in both views. */
const TAB_PAGES: Page[] = [
  { href: '/stores/list', label: (t) => t('Tous les magasins', 'All stores'), perm: 'view' },
  { href: '/stores/hours', label: (t) => t('Heures d’ouverture', 'Opening hours'), perm: 'menu:edit' },
  { href: '/stores/mapping', label: (t) => t('Branchement des magasins', 'Store connections'), perm: 'stores:map' },
  { href: '/stores/uber', label: () => 'Uber Eats', perm: 'stores:map' },
  { href: '/menu/86', label: (t) => t('Épuisés', 'Sold out'), perm: 'items:toggle' },
  { href: '/menu/retail', label: (t) => t('Épicerie', 'Grocery'), perm: 'items:toggle', features: ['retail'] },
  { href: '/insights/reports', label: (t) => t('Rapports détaillés', 'Detailed reports'), perm: 'analytics:view' },
  { href: '/insights/activity', label: (t) => t('Journal d’activité', 'Activity log'), perm: 'analytics:view' },
  { href: '/money/reconciliation', label: (t) => t('Commandes vs paiements', 'Orders vs payouts'), perm: 'analytics:view', allLocations: true },
  { href: '/money/disputes', label: (t) => t('Litiges', 'Disputes'), perm: 'analytics:view', allLocations: true },
  { href: '/money/payouts', label: (t) => t('Paiements et dépôts', 'Payouts & deposits'), perm: 'analytics:view', allLocations: true },
  { href: '/money/ledger', label: (t) => t('Grand livre', 'Ledger'), perm: 'analytics:view', allLocations: true },
  { href: '/money/statements', label: (t) => t('Relevés', 'Statements'), perm: 'analytics:view', allLocations: true },
  { href: '/money/fees', label: (t) => t('Commissions', 'Commissions'), perm: 'analytics:view', allLocations: true },
  { href: '/money/tgtg', label: () => 'Too Good To Go', perm: 'analytics:view', allLocations: true },
];

/**
 * Every console page this person may open, once, for search (⌘K) in both views: both menus, Alerts, the Settings pages
 * and the tab pages. Filtered by permission, locations and expansion features.
 */
export function allConsolePages(t: T, can: (perm: string) => boolean, allLocations: boolean, features: string[]): Array<{ href: string; label: string }> {
  const ok = (p: Pick<Page, 'perm' | 'allLocations' | 'features'>) => navVisible(p, can, allLocations, features);
  const pages: Page[] = [];
  for (const n of [...NAV_SIMPLE, KITCHEN, ...NAV, ALERTS]) {
    if (!ok(n)) continue;
    pages.push(n);
    for (const c of n.children ?? []) pages.push(c);
  }
  pages.push(...SETTINGS_PAGES.map((p) => ({ href: p.href, perm: p.perm, label: (tt: T) => tt(p.fr, p.en) })), ...TAB_PAGES);
  const seen = new Set<string>();
  return pages.filter((p) => ok(p) && !seen.has(p.href) && Boolean(seen.add(p.href))).map((p) => ({ href: p.href, label: p.label(t) }));
}
