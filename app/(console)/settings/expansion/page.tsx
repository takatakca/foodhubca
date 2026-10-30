'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, CircleDashed, PhoneCall, ReceiptText, ShoppingBasket, Truck, Wine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Banner, Skeleton } from '@/components/ui/card';
import { Switch } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { ExpansionSummary } from '@/lib/foodhub/expansion/summary';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { ExpansionHead } from './expansion-ui';
import { TechDetails } from '../tech-details';

const ICON = { delivery: Truck, retail: ShoppingBasket, alcohol: Wine, phone: PhoneCall, mev: ReceiptText } as const;
const OPEN: Record<string, string> = { delivery: '/direct', retail: '/menu/retail', alcohol: '/settings/expansion/alcohol', phone: '/direct/calls', mev: '/settings/expansion/mev' };

export default function ExpansionPage() {
  const { t, lang } = useI18n();
  const { can } = useViewer();
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<ExpansionSummary | null>(null);
  const [busy, setBusy] = useState('');
  const owner = can('admin');

  const load = useCallback(() => api<ExpansionSummary>('/api/foodhub/expansion').then(setData).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { load(); }, [load]);

  async function toggle(key: string, on: boolean) {
    setBusy(key);
    try {
      setData(await api<ExpansionSummary>('/api/foodhub/expansion', { method: 'PUT', json: { key, on } }));
      toast.success(on ? t('Activé', 'Turned on') : t('Désactivé', 'Turned off'));
      router.refresh(); // the side menu follows
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <div>
      <ExpansionHead title={t('Expansion', 'Expansion')} intro={t('Nouveaux métiers et factures Revenu Québec, chacun derrière son interrupteur. Tout est désactivé au départ ; rien ne part vers une plateforme sans ses clés et son approbation, et l’IA n’approuve, ne rembourse et n’annule jamais rien.', 'New lines of business and Revenu Québec invoices, each behind its own switch. Everything starts off; nothing reaches a platform without its keys and approval, and the AI never approves, refunds or cancels anything.')} />
      {!owner && <Banner tone="info" className="mb-4">{t('Seul le propriétaire peut activer ou désactiver ces fonctions.', 'Only the owner can turn these features on or off.')}</Banner>}
      <div className="grid gap-4 lg:grid-cols-2">
        {!data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64" />)}
        {data?.features.map((f) => {
          const Icon = ICON[f.key];
          const done = f.checks.filter((c) => c.ok).length;
          return (
            <section key={f.key} className="flex min-w-0 flex-col rounded-md border border-line bg-surface p-5 shadow-card">
              {/* Icon + title + switch on one row, the description under it at full width (no squeezed column on a phone). */}
              <div className="flex items-center gap-3">
                <div className={cn('grid size-11 shrink-0 place-items-center rounded-md', f.on ? 'bg-go-soft text-go-2' : 'bg-sunken text-ink-3')}><Icon className="size-5" aria-hidden /></div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><h2 className="text-heading min-w-0 break-words text-ink">{lang === 'fr' ? f.label.fr : f.label.en}</h2>{f.source === 'env' && <Badge tone="info">{t('fixé par le serveur', 'set by the server')}</Badge>}</div>
                <Switch checked={f.on} disabled={!owner || f.source === 'env' || busy === f.key} onChange={(v) => toggle(f.key, v)} label={<span className="sr-only">{lang === 'fr' ? f.label.fr : f.label.en}</span>} />
              </div>
              <p className="text-small mt-3 text-ink-3">{lang === 'fr' ? f.label.dfr : f.label.den}</p>
              <div className="mt-4 flex-1">
                {f.checks.map((c, i) => {
                  const body = <span className="text-small flex items-start gap-2">{c.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-go" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />}<span className={cn('min-w-0 break-words', c.ok ? 'text-ink-2' : 'text-ink-3')}>{lang === 'fr' ? c.fr : c.en}<span className="sr-only"> — {c.ok ? t('prêt', 'ready') : t('à faire', 'to do')}</span></span></span>;
                  return c.href ? <Link key={i} href={c.href} className="flex min-h-11 items-center rounded-md px-2 hover:bg-sunken">{body}</Link> : <div key={i} className="flex min-h-11 items-center px-2">{body}</div>;
                })}
              </div>
              <div className="text-small mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-ink-3">
                <span className="flex flex-wrap items-center gap-2"><Badge tone={f.on ? 'go' : 'neutral'}>{f.on ? t('Activé', 'On') : t('Éteint', 'Off')}</Badge>{done}/{f.checks.length} {t('prêts', 'ready')}{f.on && f.at ? ` · ${t('activé par', 'turned on by')} ${f.by}` : ''}</span>
                {f.on && <Link href={OPEN[f.key]} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-bold text-ink hover:underline">{t('Ouvrir', 'Open')}<ArrowRight className="size-4" aria-hidden /></Link>}
              </div>
            </section>
          );
        })}
      </div>
      <TechDetails className="mt-6" label={t('Étapes du propriétaire et approbations des plateformes', 'Owner steps and platform approvals')}>docs/EXPANSION_FEATURES.md</TechDetails>
    </div>
  );
}
