import type { Alert } from '../foodhub/command';

/** Counted orders exclude cancellations; adding them back gives today's recorded-order denominator. */
export function cancellationRate(counted: number, cancelled: number): number | null {
  if (![counted, cancelled].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const total = counted + cancelled;
  return total ? Math.round(cancelled / total * 1000) / 10 : null;
}

/** Existing Command Center observations only, most urgent first. No inferred recommendations or external calls. */
export function homeAttention(alerts: ReadonlyArray<Alert>): Alert[] {
  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.filter((alert) => alert.severity !== 'info').slice().sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Alerts normally supply an internal route; never turn an unexpected external value into a dashboard action. */
export function homeAttentionHref(alert: Alert): string {
  if (alert.orderId) return `/orders?open=${encodeURIComponent(alert.orderId)}`;
  return alert.href?.startsWith('/') && !alert.href.startsWith('//') && !/[\\\r\n]/.test(alert.href) ? alert.href : '/alerts';
}

export const HOME_QUICK_ACTIONS = [
  { href: '/orders', perm: 'view', fr: 'Ouvrir les commandes', en: 'Open orders' },
  { href: '/stores/screens', perm: 'view', fr: 'Tablettes virtuelles', en: 'Virtual tablets' },
  { href: '/menu/86', perm: 'items:toggle', fr: 'Ruptures de stock', en: 'Sold-out items' },
  { href: '/menu', perm: 'menu:edit', fr: 'Modifier le menu', en: 'Edit menu' },
  { href: '/stores/availability', perm: 'stores:toggle', fr: 'Disponibilité des magasins', en: 'Store availability' },
  { href: '/insights', perm: 'analytics:view', fr: 'Rapports de ventes', en: 'Sales reports' },
] as const;
