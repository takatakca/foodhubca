import type { T } from '@/lib/i18n';
import type { StoredOrder } from '../types';

// Current recorded facts only: absence of a courier update is not proof that no courier was assigned.
export const ISSUE_FILTERS = ['', 'any', 'none', 'clover', 'platform', 'printing', 'mapping', 'missing_items'] as const;
export const OUTCOME_FILTERS = ['', 'in_progress', 'completed', 'cancelled_store', 'cancelled_customer', 'cancelled_platform', 'cancelled_unknown', 'tablet'] as const;
export const COURIER_FILTERS = ['', 'not_reported', 'unassigned', 'assigned', 'arriving', 'at_store', 'picked_up', 'delivered', 'not_applicable'] as const;
export const ORDER_STATUSES = ['new', 'accepted', 'ready', 'dispatched', 'completed', 'cancelled', 'failed'] as const;
export type IssueFilter = typeof ISSUE_FILTERS[number];
export type OutcomeFilter = typeof OUTCOME_FILTERS[number];
export type CourierFilter = typeof COURIER_FILTERS[number];
export type OrderIssue = Exclude<IssueFilter, '' | 'any' | 'none'>;
export type OrderFilters = { issue: IssueFilter; outcome: OutcomeFilter; courier: CourierFilter };
type OrderLike = Pick<StoredOrder, 'status' | 'fulfillment' | 'timeline' | 'posError' | 'posOrderId' | 'channelError' | 'mappingWarnings'>;

export function parseOrderFilters(q: Pick<URLSearchParams, 'get'>): OrderFilters {
  const read = <T extends string>(key: string, options: readonly T[]): T => {
    const value = q.get(key) ?? '';
    if (!options.includes(value as T)) throw new Error(`Invalid ${key} filter.`);
    return value as T;
  };
  return { issue: read('issue', ISSUE_FILTERS), outcome: read('outcome', OUTCOME_FILTERS), courier: read('courier', COURIER_FILTERS) };
}

/** Change page filters without losing restaurant/provider scope, period, open order or other navigation. */
export function withOrderFilters(search: string, patch: Partial<OrderFilters> & { status?: string; q?: string }): string {
  const q = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) { if (value) q.set(key, value); else q.delete(key); }
  return q.toString();
}

export function orderIssues(o: OrderLike): OrderIssue[] {
  const tl = o.timeline;
  const issues: OrderIssue[] = [];
  if ((o.posError && !o.posOrderId) || (tl?.posPaymentError && !tl.posPaymentId)) issues.push('clover');
  if (o.channelError) issues.push('platform');
  if (tl?.printError) issues.push('printing');
  if (o.mappingWarnings?.length) issues.push('mapping');
  if (tl?.missingItems?.length) issues.push('missing_items');
  return issues;
}

export function orderOutcome(o: OrderLike): Exclude<OutcomeFilter, ''> {
  if (o.status === 'cancelled') return `cancelled_${o.timeline?.cancelledBy ?? 'unknown'}`;
  if (o.status === 'completed') return 'completed';
  if (o.status === 'failed') return 'tablet';
  return 'in_progress';
}

export function orderCourier(o: OrderLike): Exclude<CourierFilter, ''> {
  if (o.fulfillment !== 'delivery') return 'not_applicable';
  return o.timeline?.courier?.status ?? 'not_reported';
}

export function matchesOrderFilters(o: OrderLike, filters: OrderFilters): boolean {
  const issues = orderIssues(o);
  return (!filters.issue || (filters.issue === 'any' ? issues.length > 0 : filters.issue === 'none' ? issues.length === 0 : issues.includes(filters.issue)))
    && (!filters.outcome || orderOutcome(o) === filters.outcome)
    && (!filters.courier || orderCourier(o) === filters.courier);
}

export function issueLabel(t: T, value: IssueFilter) {
  return ({ '': t('Tous les problèmes', 'All issues'), any: t('Avec un problème signalé', 'With a recorded issue'), none: t('Aucun problème signalé', 'No recorded issue'), clover: t('Erreur Clover', 'Clover error'), platform: t('Erreur de plateforme', 'Platform error'), printing: t('Erreur d’impression', 'Print error'), mapping: t('Articles à vérifier dans Clover', 'Check Clover items'), missing_items: t('Articles signalés manquants', 'Items reported missing') })[value];
}
export function outcomeLabel(t: T, value: OutcomeFilter) {
  return ({ '': t('Toutes les issues', 'All outcomes'), in_progress: t('En cours', 'In progress'), completed: t('Terminée', 'Completed'), cancelled_store: t('Annulée par le restaurant', 'Cancelled by restaurant'), cancelled_customer: t('Annulée par le client', 'Cancelled by customer'), cancelled_platform: t('Annulée par la plateforme', 'Cancelled by platform'), cancelled_unknown: t('Annulée — auteur non indiqué', 'Cancelled — source not reported'), tablet: t('Prise en charge sur tablette Skip', 'Handled on Skip tablet') })[value];
}
export function courierFilterLabel(t: T, value: CourierFilter) {
  return ({ '': t('Tous les livreurs', 'All courier states'), not_reported: t('Livreur non renseigné', 'Courier not reported'), unassigned: t('Livreur retiré', 'Courier unassigned'), assigned: t('Livreur assigné', 'Courier assigned'), arriving: t('Livreur arrive', 'Courier arriving'), at_store: t('Livreur au comptoir', 'Courier at store'), picked_up: t('Récupérée par le livreur', 'Picked up by courier'), delivered: t('Livraison confirmée', 'Delivery reported'), not_applicable: t('Sans livraison', 'No delivery') })[value];
}
