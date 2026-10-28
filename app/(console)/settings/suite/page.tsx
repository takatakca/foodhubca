'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Banner, Card, Skeleton } from '@/components/ui/card';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

// Settings → Connected apps (the TAKATAK Suite): the Clover App Market apps (C4ISSE, T4CTILE, 4CCOUNTING…) that work alone and together.
// Each app is connected by two server variables (docs/TAKATAK_SUITE.md); this page only shows the state, never a secret.

type App = { key: string; name: string; repo: string; fr: string; en: string; connected: boolean; problem: string | null; subscribed: string[]; pending: number; failed: number; sent24h: number; lastError: string | null };

export default function SuitePage() {
  const { t } = useI18n();
  const [apps, setApps] = useState<App[] | null>(null);
  const [keys, setKeys] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => api<{ apps: App[]; customerKeys: boolean }>('/api/foodhub/suite').then((d) => { setApps(d.apps); setKeys(d.customerKeys); setErr(''); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);
  const connected = apps?.filter((a) => a.connected).length ?? 0;

  return (
    <div>
      <SettingsHead title={t('Apps connectées', 'Connected apps')}
        intro={t('Vos apps Clover App Market. Chacune fonctionne seule chez un marchand ; branchées ici, elles reçoivent les commandes de Food Hub en direct et se parlent entre elles. Aucune donnée client nominative n’est envoyée.', 'Your Clover App Market apps. Each one works alone at a merchant; connected here, they get Food Hub’s orders live and talk to each other. No named customer data is sent.')} />
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {apps && connected === 0 && <Banner tone="info" className="mb-4">{t('Aucune app branchée. Pour en brancher une : FOODHUB_SUITE_<APP>_URL et FOODHUB_SUITE_<APP>_SECRET dans Coolify (guide : docs/TAKATAK_SUITE.md).', 'No app connected. To connect one: FOODHUB_SUITE_<APP>_URL and FOODHUB_SUITE_<APP>_SECRET in Coolify (guide: docs/TAKATAK_SUITE.md).')}</Banner>}
      {apps && connected > 0 && !keys && <Banner tone="warn" className="mb-4">{t('FOODHUB_SUITE_CUSTOMER_SALT n’est pas réglé : les apps ne reçoivent pas de clé client, donc la fidélité ne peut pas reconnaître un client d’une commande à l’autre.', 'FOODHUB_SUITE_CUSTOMER_SALT is not set: apps get no customer key, so loyalty cannot recognise a customer from one order to the next.')}</Banner>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!apps && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}
        {apps?.map((a) => (
          <Card key={a.key} className={cn('p-4', a.failed > 0 && 'border-stop/40')}>
            <div className="flex items-start gap-3">
              <div className={cn('grid size-10 shrink-0 place-items-center rounded-md', a.connected ? 'bg-go/10 text-go-2' : 'bg-sunken text-ink-3')}><Boxes className="size-5" /></div>
              <div className="min-w-0">
                <div className="font-extrabold text-ink">{a.name}</div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{t(a.fr, a.en)}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="flex items-center gap-1.5 text-ink-3"><StatusDot tone={a.connected ? 'go' : a.problem ? 'stop' : 'neutral'} />{a.connected ? t('Branchée', 'Connected') : a.problem ? a.problem : t('Pas branchée', 'Not connected')}</span>
              {a.connected && <Badge>{a.sent24h} {t('envoyés (24 h)', 'sent (24 h)')}</Badge>}
              {a.pending > 0 && <Badge tone="wait">{a.pending} {t('en attente', 'waiting')}</Badge>}
              {a.failed > 0 && <Badge tone="stop">{a.failed} {t('échoués', 'failed')}</Badge>}
            </div>
            {a.lastError && <div className="mt-2 truncate text-[11px] text-stop" title={a.lastError}>{a.lastError}</div>}
            <div className="mt-3 border-t border-line pt-2 text-[11px] text-ink-3">github.com/takatakca/{a.repo} · {a.subscribed.join(', ')}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
