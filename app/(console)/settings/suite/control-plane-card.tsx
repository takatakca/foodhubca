'use client';

import { useEffect, useState } from 'react';
import { Banner, Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n/client';
import { api } from '@/lib/ui/api';
import type { ControlPlaneStatus } from '@/lib/foodhub/control-plane/status';

export function ControlPlaneCard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ControlPlaneStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => api<{ controlPlane: ControlPlaneStatus }>('/api/foodhub/control-plane')
      .then((body) => { if (active) { setStatus(body.controlPlane);setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    void load();const timer = setInterval(load, 30_000);
    return () => { active = false;clearInterval(timer); };
  }, []);
  const time = (raw: string | null) => raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleString() : t('Pas encore vérifié', 'Not checked yet');
  return <Card className="mb-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-heading font-extrabold">{t('Connexion à TAKATAK', 'TAKATAK connection')}</h2>
        <p className="mt-1 max-w-3xl text-small text-ink-3">{t('État du restaurant et comptes de commandes envoyés en arrière-plan. La réception des commandes et la cuisine continuent si cette connexion est indisponible.', 'Restaurant status and order counts sent in the background. Order intake and the kitchen keep working when this connection is unavailable.')}</p></div>
      <Badge tone={status?.configured && status.durable ? 'info' : 'neutral'}>{!status ? failed ? t('Indisponible', 'Unavailable') : t('Vérification…', 'Checking…') : status.configured ? t('Configuration en place', 'Configured') : t('Pas configurée', 'Not configured')}</Badge>
    </div>
    {failed && <Banner tone="warn" className="mt-3">{t('L’état de cette connexion est momentanément indisponible.', 'Connection status is temporarily unavailable.')}</Banner>}
    {status?.configured && !status.durable && <Banner tone="warn" className="mt-3">{t('Le stockage persistant est requis avant le reporting en production.', 'Persistent storage is required before production reporting.')}</Banner>}
    {status?.merchants.map((merchant, i) => <div key={i} className="mt-3 rounded-md border border-line p-3 text-small">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{merchant.name || t('Groupe de restaurants', 'Restaurant group')}</strong>
        <Badge tone={merchant.state === 'verified' ? 'info' : merchant.state === 'unavailable' ? 'wait' : 'neutral'}>{merchant.state === 'verified' ? t('Correspondance vérifiée', 'Mapping verified') : merchant.state === 'unlinked' ? t('Restaurant non reconnu', 'Restaurant not registered') : merchant.state === 'unavailable' ? t('Vérification indisponible', 'Check unavailable') : t('À vérifier', 'Awaiting check')}</Badge></div>
      <p className="mt-1 text-ink-3">{t('Dernière correspondance vérifiée : ', 'Last verified mapping: ')}{time(merchant.lastVerifiedAt)}</p>
      {merchant.sourceSubscriptionPlan && <p className="mt-1 text-ink-3">{t('Dernier forfait déclaré : ', 'Last reported plan: ')}{merchant.sourceSubscriptionPlan}{merchant.sourceSubscriptionStatus ? ` · ${merchant.sourceSubscriptionStatus}` : ''}</p>}
    </div>)}
    {status?.configured && <p className="mt-3 text-small text-ink-3">{status.countsLimited ? t('Au moins ', 'At least ') : ''}{status.pending} {t('en attente', 'waiting')} · {status.failed} {t('à vérifier', 'need review')} · {status.held} {t('retenus après un changement de configuration', 'held after a configuration change')}</p>}
    <p className="mt-3 border-t border-line pt-3 text-small text-ink-3">{t('Le forfait affiché reflète les données synchronisées du restaurant. Cette connexion ne crée pas de facturation et ne change pas les fonctions autorisées.', 'The reported plan reflects synchronized restaurant data. This connection does not create billing or change authorized features.')}</p>
  </Card>;
}
