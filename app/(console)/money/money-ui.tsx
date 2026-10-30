'use client';

import type { ReactNode } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/card';
import { LinkTabs } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';

export const CH_NAME: Record<string, string> = { uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', tgtg: 'Too Good To Go' };

export function MoneyHead({ title, intro, right }: { title: string; intro: ReactNode; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader eyebrow={t('Argent', 'Money')} title={title} subtitle={intro} right={right} />
      <LinkTabs tabs={[
        { href: '/money', label: t('Où est mon argent', 'Where is my money'), exact: true },
        { href: '/money/reconciliation', label: t('Commandes vs paiements', 'Orders vs payouts') },
        { href: '/money/disputes', label: t('Litiges', 'Disputes') },
        { href: '/money/payouts', label: t('Paiements et dépôts', 'Payouts & deposits') },
        { href: '/money/ledger', label: t('Grand livre', 'Ledger') },
        { href: '/money/statements', label: t('Relevés', 'Statements') },
        { href: '/money/fees', label: t('Commissions', 'Commissions') },
        { href: '/money/tgtg', label: 'Too Good To Go' },
      ]} />
    </>
  );
}

export const cad = (n: number | null | undefined, loc = 'fr-CA') => (n === null || n === undefined ? '—' : new Intl.NumberFormat(loc, { style: 'currency', currency: 'CAD' }).format(n));
export const signed = (n: number | null | undefined, loc = 'fr-CA') => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${cad(Math.abs(n), loc)}`);

export type ReconStatus = 'matched' | 'short_paid' | 'over_paid' | 'refunded' | 'error_charge' | 'missing' | 'pending' | 'cancelled' | 'not_covered';
export function reconLabel(t: T, s: ReconStatus) {
  return ({ matched: t('Payée comme prévu', 'Paid as expected'), short_paid: t('Payée en moins', 'Paid less'), over_paid: t('Payée en plus', 'Paid more'), refunded: t('Remboursement', 'Refund / chargeback'), error_charge: t('Frais d’erreur', 'Error charge'), missing: t('Absente du paiement', 'Missing from payout'), pending: t('Pas encore due', 'Not due yet'), cancelled: t('Annulée', 'Cancelled'), not_covered: t('Pas de relevé', 'No statement yet') })[s] ?? s;
}
const RT: Record<ReconStatus, [Tone, string]> = { matched: ['go', '✓'], short_paid: ['stop', '▼'], over_paid: ['info', '▲'], refunded: ['stop', '↩'], error_charge: ['stop', '!'], missing: ['stop', '✕'], pending: ['wait', '◷'], cancelled: ['neutral', '–'], not_covered: ['wait', '?'] };
export function ReconBadge({ status }: { status: ReconStatus }) {
  const { t } = useI18n();
  const [tone, icon] = RT[status] ?? ['neutral', '·'];
  return <Badge tone={tone}><span aria-hidden>{icon}</span>{reconLabel(t, status)}</Badge>;
}
export const PROBLEM: ReconStatus[] = ['missing', 'short_paid', 'error_charge', 'refunded', 'over_paid'];

export type CaseStatus = 'open' | 'disputed' | 'recovered' | 'written_off' | 'resolved' | 'ignored';
export const RECOVERABLE = ['short_paid', 'missing', 'error_charge', 'refunded'];
export function caseLabel(t: T, s: CaseStatus) {
  return ({ open: t('À vérifier', 'To check'), disputed: t('Contesté', 'Disputed'), recovered: t('Récupéré', 'Recovered'), written_off: t('Radié', 'Written off'), resolved: t('Réglé par un paiement', 'Fixed by a payout'), ignored: t('Ignoré', 'Ignored') })[s];
}
export function CaseBadge({ status }: { status: CaseStatus }) {
  const { t } = useI18n();
  const tone: Tone = status === 'open' ? 'stop' : status === 'disputed' ? 'wait' : status === 'recovered' || status === 'resolved' ? 'go' : 'neutral';
  return <Badge tone={tone}>{caseLabel(t, status)}</Badge>;
}

export type Expected = { sales: number; tax: number; commission: number; commissionTax: number; fixedFee: number; net: number; ratePct: number };
export type OrderRecon = {
  orderId: string; channel: string; ref: string; displayId: string; brandName: string | null; locationCode: string | null; date: string; fulfillment: string; orderStatus: string;
  total: number; expected: Expected; actual: number | null; diff: number | null; status: ReconStatus; lines: number; payoutDate: string | null; refunds: number; errorCharges: number; adjustments: number; planConfirmed: boolean; caseStatus: CaseStatus | null;
};
export type Unmatched = { id: string; channel: string; ref: string | null; kind: string; description: string; orderDate: string | null; payoutDate: string | null; net: number };
export type ChannelSummary = { channel: string; label: string; orders: number; sales: number; expected: number; paid: number; diff: number; missingMoney: number; counts: Record<ReconStatus, number>; otherCharges: number; unknownOrders: number; coveredUntil: string | null; planConfirmed: boolean };
export type Recon = { orders: OrderRecon[]; unmatched: Unmatched[]; other: Unmatched[]; channels: ChannelSummary[]; totals: { orders: number; expected: number; paid: number; diff: number; missingMoney: number; unknownOrders: number; otherCharges: number }; imports: number; generatedAt: string };

/** "1 commande" / "3 commandes": a real plural, never "commande(s)". */
export function plural(t: T, n: number, fr: [string, string], en: [string, string]) {
  return t(`${n} ${n === 1 ? fr[0] : fr[1]}`, `${n} ${n === 1 ? en[0] : en[1]}`);
}

/**
 * The calm card beside « Argent à récupérer » when nothing is owed. Green « Tout est réglé » means every order of the
 * period was checked against a statement and nothing is missing. Until then it stays neutral and says why: no
 * statement imported, orders no statement covers yet, or orders whose payout is not due yet (status "pending": the
 * platform's payout delay, about 10 days for Uber Eats and DoorDash, 14 for Skip, so the last days of any period).
 */
export function settledCard(t: T, r: Pick<Recon, 'orders' | 'imports'>): { settled: boolean; title: string; body: string } {
  if (!r.imports) return { settled: false, title: t('Pas encore vérifié', 'Not checked yet'), body: t('Importez un relevé pour vérifier cette période.', 'Import a statement to check this period.') };
  const notCovered = r.orders.filter((o) => o.status === 'not_covered').length;
  const pending = r.orders.filter((o) => o.status === 'pending').length;
  if (notCovered || pending) {
    const body = [
      notCovered ? plural(t, notCovered, ['commande pas encore couverte par un relevé.', 'commandes pas encore couvertes par un relevé.'], ['order not covered by a statement yet.', 'orders not covered by a statement yet.']) : '',
      pending ? plural(t, pending, ['commande attend son versement, pas encore dû.', 'commandes attendent leur versement, pas encore dû.'], ['order is waiting for its payout, not due yet.', 'orders are waiting for their payout, not due yet.']) : '',
    ].filter(Boolean).join(' ');
    return { settled: false, title: notCovered ? t('Rien à récupérer pour l’instant', 'Nothing to recover so far') : t('Versements pas encore dus', 'Payouts not due yet'), body };
  }
  if (!r.orders.length) return { settled: false, title: t('Aucune commande', 'No orders'), body: t('Aucune commande dans cette période : rien à vérifier.', 'No order in this period: nothing to check.') };
  return { settled: true, title: t('Tout est réglé', 'All settled'), body: t('Chaque commande de cette période a été comparée à un relevé : aucun argent à récupérer.', 'Every order in this period was checked against a statement: no money to recover.') };
}

export function toRecover(r: Pick<OrderRecon, 'status' | 'diff' | 'expected'> & { caseStatus?: CaseStatus | null }) {
  if (r.caseStatus && ['recovered', 'written_off', 'ignored'].includes(r.caseStatus)) return 0;
  if (r.status === 'missing') return r.expected.net;
  if (['short_paid', 'error_charge', 'refunded'].includes(r.status) && r.diff !== null && r.diff < 0) return -r.diff;
  return 0;
}
