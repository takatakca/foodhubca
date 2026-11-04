'use client';

import Link from 'next/link';
import { ArrowRight, TriangleAlert, Zap } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardHeader, Skeleton } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { HOME_QUICK_ACTIONS, homeAttention, homeAttentionHref } from '@/lib/ui/home-operations';
import type { Alert } from '@/lib/foodhub/command';
import type { T } from '@/lib/i18n';

function attentionTitle(alert: Alert, t: T): string {
  const prefix = alert.id.split(':')[0];
  const names: Record<string, [string, string]> = {
    new: ['Commande en attente d’une réponse', 'Order waiting for a response'],
    print: ['Ticket cuisine à vérifier', 'Kitchen ticket needs checking'],
    pos: ['Commande non reçue par Clover', 'Order not received by Clover'],
    tablet: ['Commande à vérifier sur la tablette', 'Check the order on its tablet'],
    ch: ['Mise à jour de commande à vérifier', 'Order update needs checking'],
    unmapped: ['Magasin à associer', 'Store needs mapping'],
    deact: ['Magasin désactivé', 'Store deactivated'],
    pause: ['Magasin en pause', 'Store paused'],
    syncerr: ['Statut magasin à vérifier', 'Store status needs checking'],
    missing: ['Magasins de plateforme à associer', 'Platform stores need mapping'],
    'sync-stale': ['Synchronisation à vérifier', 'Sync needs checking'],
    'live-off': ['Écritures API désactivées', 'API writes are off'],
    'jobs-failed': ['Action de plateforme refusée', 'Platform action failed'],
    'unparsed': ['Réception de commande à vérifier', 'Order intake needs checking'],
  };
  return names[prefix] ? t(...names[prefix]) : t('Vérification requise', 'Needs checking');
}

/** Scoped command alerts are distinct from the Watchtower's broader ongoing incidents. */
export function OperationsOverview({ alerts, can, href, t }: {
  alerts: ReadonlyArray<Alert> | null; can: (permission: string) => boolean; href: (path: string) => string; t: T;
}) {
  const attention = alerts ? homeAttention(alerts) : null;
  const actions = HOME_QUICK_ACTIONS.filter((action) => can(action.perm));
  const target = (alert: Alert) => {
    const path = homeAttentionHref(alert);
    if ((path.startsWith('/settings') && !can('admin')) || (path.startsWith('/menu') && !can('menu:edit'))) return '/alerts';
    return path;
  };
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title={t('À régler d’abord', 'Needs attention')} icon={<TriangleAlert className="size-5" />} right={attention && <Badge tone={attention.some((item) => item.severity === 'critical') ? 'stop' : 'neutral'}>{attention.length}</Badge>}
          subtitle={t('Observations de cette vue ; les réglages communs peuvent concerner plusieurs succursales.', 'Observations for this view; shared settings can affect several locations.')} />
        <div className="divide-y divide-line border-t border-line">
          {attention?.slice(0, 5).map((alert) => <Link key={alert.id} href={href(target(alert))} className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-raised">
            <StatusDot tone={alert.severity === 'critical' ? 'stop' : 'wait'} />
            <span className="min-w-0 flex-1"><span className="text-body block font-bold text-ink">{attentionTitle(alert, t)}</span><span className="text-small mt-0.5 block break-words text-ink-3">{alert.title}</span></span>
            <ArrowRight className="size-4 shrink-0 text-ink-3" aria-hidden />
          </Link>)}
          {attention?.length === 0 && <p className="px-5 py-5 text-body text-ink-3">{t('Aucun point prioritaire signalé dans cette vue. Les alertes de surveillance restent ci-dessous.', 'No priority issue reported in this view. Monitoring alerts remain below.')}</p>}
          {attention && attention.length > 5 && <p className="px-5 py-3 text-small text-ink-3">{t(`${attention.length - 5} autre(s) point(s) signalé(s). Vérifiez aussi les alertes et les connexions.`, `${attention.length - 5} more issue(s) reported. Review alerts and connections too.`)}</p>}
          {!attention && <div role="status" aria-label={t('Chargement des priorités', 'Loading priorities')} className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        </div>
      </Card>
      <Card>
        <CardHeader title={t('Raccourcis', 'Quick actions')} icon={<Zap className="size-5" />} subtitle={t('Votre sélection de plateforme et de restaurant est conservée.', 'Your platform and restaurant selection stays with you.')} />
        <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {actions.map((action) => <ButtonLink key={action.href} href={href(action.href)} variant="outline" className="min-h-11 w-full whitespace-normal text-center">{t(action.fr, action.en)}</ButtonLink>)}
        </div>
      </Card>
    </div>
  );
}
