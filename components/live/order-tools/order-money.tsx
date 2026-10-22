'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CircleDollarSign, ExternalLink } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useViewer } from '@/components/shell/viewer';
import { api, dayOf, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n';
import type { OrderMoney as Money } from '@/lib/foodhub/order-tools/order-money';

const STATUS: Record<string, [string, string, Tone]> = {
  matched: ['Payée comme prévu', 'Paid as expected', 'go'],
  short_paid: ['Payée moins que prévu', 'Paid less than expected', 'stop'],
  over_paid: ['Payée plus que prévu', 'Paid more than expected', 'info'],
  refunded: ['Remboursée / rétrofacturée', 'Refunded / charged back', 'stop'],
  error_charge: ['Frais d’erreur', 'Error charge', 'stop'],
  missing: ['Absente du versement', 'Missing from payout', 'stop'],
  cancelled: ['Annulée — rien de dû', 'Cancelled — nothing due', 'neutral'],
  not_yet: ['Pas encore de relevé', 'No statement yet', 'neutral'],
};
const CASE: Record<string, [string, string]> = {
  open: ['ouvert', 'open'], disputed: ['contesté', 'disputed'], recovered: ['récupéré', 'recovered'], written_off: ['perte acceptée', 'written off'], resolved: ['réglé', 'resolved'], ignored: ['ignoré', 'ignored'],
};

/**
 * The money of this order, read-only and on demand: expected, paid, gap, error charges, adjustments, dispute case.
 * Hidden without "analytics:view". Never submits or approves anything — disputes are filed by the owner in each portal.
 */
export function OrderMoney({ orderId }: { orderId: string }) {
  const { t, lang, loc } = useI18n();
  const { can } = useViewer();
  const [m, setM] = useState<Money | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!can('analytics:view')) return null;

  async function load() {
    setBusy(true); setErr('');
    try { setM((await api<{ money: Money }>(`/api/foodhub/order-tools/${orderId}/money`)).money); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!m) {
    return (
      <div>
        <Button variant="outline" loading={busy} onClick={load} icon={<CircleDollarSign className="size-4" />}>{t('Voir l’argent de cette commande', 'See this order’s money')}</Button>
        {err && <p className="text-small mt-2 text-stop-2">{err}</p>}
      </div>
    );
  }
  const [fr, en, tone] = STATUS[m.status] ?? [m.status, m.status, 'neutral' as Tone];
  const row = (label: string, v: number | null | undefined, strong = false) => (v === null || v === undefined ? null : (
    <><dt className="text-ink-3">{label}</dt><dd className={strong ? 'num text-right font-extrabold text-ink' : 'num text-right'}>{money(v, loc)}</dd></>
  ));
  return (
    <div className="rounded-lg border border-line bg-surface p-4 text-[13px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">{t('Argent de la commande', 'Order money')}</span>
        <Badge tone={tone}>{lang === 'fr' ? fr : en}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {row(t('Attendu (net)', 'Expected (net)'), m.expected)}
        {m.status !== 'not_yet' && <>
          {row(t('Payé', 'Paid'), m.actual)}
          {row(t('Écart', 'Gap'), m.diff, true)}
          {m.errorCharges ? row(t('Frais d’erreur', 'Error charges'), m.errorCharges) : null}
          {m.adjustments ? row(t('Ajustements', 'Adjustments'), m.adjustments) : null}
          {m.refunds ? row(t('Remboursements', 'Refunds'), m.refunds) : null}
          {m.promotions ? row(t('Promotions payées par vous', 'Promotions you paid'), m.promotions) : null}
        </>}
        {m.payoutDate && <><dt className="text-ink-3">{t('Versement', 'Payout')}</dt><dd className="text-right">{dayOf(m.payoutDate, loc)}</dd></>}
      </dl>
      {m.case && <p className="mt-2 text-ink-2">{caseLine(t, lang, m.case, loc)}</p>}
      <Link href="/money/disputes" className="mt-3 inline-flex min-h-12 items-center gap-1.5 font-semibold text-ink underline-offset-4 hover:underline">
        <ExternalLink className="size-4" />{t('Litiges et réclamations', 'Disputes and claims')}
      </Link>
      <p className="text-xs text-ink-4">{t('Lecture seule. Les réclamations se soumettent par le propriétaire dans le portail de chaque plateforme.', 'Read-only. Claims are submitted by the owner in each platform’s portal.')}</p>
    </div>
  );
}

function caseLine(t: T, lang: 'fr' | 'en', c: NonNullable<Money['case']>, loc: string) {
  const st = CASE[c.status] ?? [c.status, c.status];
  return t(`Cas de litige ${lang === 'fr' ? st[0] : st[1]} · ${money(c.amount, loc)}`, `Dispute case ${st[1]} · ${money(c.amount, loc)}`);
}
