'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, CircleDashed, PhoneCall, ShoppingBasket, Truck, Wine } from 'lucide-react';
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

const ICON = { delivery: Truck, retail: ShoppingBasket, alcohol: Wine, phone: PhoneCall } as const;
const OPEN: Record<string, string> = { delivery: '/direct', retail: '/menu/retail', alcohol: '/settings/expansion/alcohol', phone: '/direct/calls' };

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
      <ExpansionHead title={t('Expansion', 'Expansion')} intro={t('Quatre nouveaux métiers, chacun derrière son interrupteur. Tout est désactivé au départ ; rien ne part vers une plateforme sans ses clés et son approbation, et l’IA n’approuve, ne rembourse et n’annule jamais rien.', 'Four new lines of business, each behind its own switch. Everything starts off; nothing reaches a platform without its keys and approval, and the AI never approves, refunds or cancels anything.')} />
      {!owner && <Banner tone="info" className="mb-4">{t('Seul le propriétaire peut activer ou désactiver ces fonctions.', 'Only the owner can turn these features on or off.')}</Banner>}
      <div className="grid gap-4 lg:grid-cols-2">
        {!data && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}
        {data?.features.map((f) => {
          const Icon = ICON[f.key];
          const done = f.checks.filter((c) => c.ok).length;
          return (
            <section key={f.key} className={cn('flex flex-col rounded-xl border bg-surface p-5 shadow-card', f.on ? 'border-go/40' : 'border-line')}>
              <div className="flex items-start gap-4">
                <div className={cn('grid size-12 shrink-0 place-items-center rounded-lg', f.on ? 'bg-go-soft text-go-2' : 'bg-sunken text-ink-3')}><Icon className="size-6" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold">{lang === 'fr' ? f.label.fr : f.label.en}</h2>{f.source === 'env' && <Badge tone="info">{t('fixé par le serveur', 'set by the server')}</Badge>}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{lang === 'fr' ? f.label.dfr : f.label.den}</p>
                </div>
                <Switch checked={f.on} disabled={!owner || f.source === 'env' || busy === f.key} onChange={(v) => toggle(f.key, v)} label={<span className="sr-only">{lang === 'fr' ? f.label.fr : f.label.en}</span>} />
              </div>
              <div className="mt-4 flex-1 space-y-1.5">
                {f.checks.map((c, i) => {
                  const body = <span className="flex items-start gap-2 text-[13px]">{c.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-go" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-4" />}<span className={c.ok ? 'text-ink-2' : 'text-ink-3'}>{lang === 'fr' ? c.fr : c.en}</span></span>;
                  return c.href ? <Link key={i} href={c.href} className="block rounded px-1 py-0.5 hover:bg-sunken">{body}</Link> : <div key={i} className="px-1 py-0.5">{body}</div>;
                })}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-ink-3">
                <span>{done}/{f.checks.length} {t('prêt', 'ready')}{f.on && f.at ? ` · ${t('activé par', 'turned on by')} ${f.by}` : ''}</span>
                {f.on && <Link href={OPEN[f.key]} className="flex items-center gap-1 font-bold text-ink hover:underline">{t('Ouvrir', 'Open')}<ArrowRight className="size-3.5" /></Link>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-ink-4">{t('Étapes pour le propriétaire et ce que chaque plateforme doit approuver : docs/EXPANSION_FEATURES.md.', 'Owner steps and what each platform must approve: docs/EXPANSION_FEATURES.md.')}</p>
    </div>
  );
}
