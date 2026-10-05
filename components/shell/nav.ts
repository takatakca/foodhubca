import { BellRing, ChartNoAxesCombined, ChefHat, LayoutDashboard, ReceiptText, Settings, Store, UtensilsCrossed, Wallet } from 'lucide-react';
import type { T } from '@/lib/i18n';

export type NavItem = { href: string; icon: typeof LayoutDashboard; label: (t: T) => string; perm: string; allLocations?: boolean; badge?: 'orders' | 'alerts' | 'stores' };
export const NAV: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: (t) => t('Aperçu', 'Overview'), perm: 'view' },
  { href: '/orders', icon: ReceiptText, label: (t) => t('Commandes', 'Orders'), perm: 'view', badge: 'orders' },
  { href: '/kitchen', icon: ChefHat, label: (t) => t('Cuisine', 'Kitchen'), perm: 'view' },
  { href: '/stores', icon: Store, label: (t) => t('Magasins', 'Stores'), perm: 'view', badge: 'stores' },
  { href: '/menu', icon: UtensilsCrossed, label: (t) => t('Menus', 'Menus'), perm: 'items:toggle' },
  { href: '/alerts', icon: BellRing, label: (t) => t('Alertes', 'Alerts'), perm: 'view', badge: 'alerts' },
  { href: '/insights', icon: ChartNoAxesCombined, label: (t) => t('Analyses', 'Insights'), perm: 'analytics:view' },
  { href: '/money', icon: Wallet, label: (t) => t('Argent', 'Money'), perm: 'analytics:view', allLocations: true },
  { href: '/settings', icon: Settings, label: (t) => t('Réglages', 'Settings'), perm: 'view' },
];

