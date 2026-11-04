'use client';

import { ArrowRight, Computer, LogIn, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { screenReadiness, type ReadinessScreen } from '@/lib/ui/screens-readiness';
import type { Scope } from '@/lib/foodhub/scope';
import type { T } from '@/lib/i18n';
import { ago } from '@/lib/ui/api';

const LABELS: Record<string, string> = { doordash: 'DoorDash', ubereats: 'Uber Eats', skip: 'Skip' };
export type ScreenOrderRoute = { platform: string; mode: 'via_clover' | 'direct' | 'none'; cloverReady: boolean; lastOrderAt: string | null };

/** Existing sessions and API order routes are separate; neither one is presented as production acceptance. */
export function ScreenReadinessPanel({ screens, paths, site, live, relayConfigured, manage, lang, onShow, t }: {
  screens: ReadonlyArray<ReadinessScreen>; paths: ScreenOrderRoute[]; site: Scope; live: boolean | null;
  relayConfigured: boolean; manage: boolean; lang: 'fr' | 'en'; onShow?: (channel: string) => void; t: T;
}) {
  const summaries = screenReadiness(screens, site);
  return (
    <section className="mb-5 space-y-3" aria-label={t('Sessions et connexions', 'Sessions and connections')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-heading text-ink">{t('Vos comptes, en un coup d’œil', 'Your accounts at a glance')}</h2>
          <p className="mt-1 text-small text-ink-3">{t('Objectif : 18 comptes par plateforme. Vous pouvez en avoir davantage ; vos comptes existants sont conservés.', 'Target: 18 accounts per platform. You can have more; existing accounts are kept.')}</p>
        </div>
        <Badge tone={live === false ? 'wait' : 'neutral'}>{live === null ? t('Mode API non signalé', 'API mode not reported') : live ? t('Écritures API activées', 'API writes enabled') : t('Mode sûr · écritures API désactivées', 'Safe mode · API writes off')}</Badge>
      </div>
      {summaries.length > 0 && <div className="grid gap-3 lg:grid-cols-3">
        {summaries.map((summary) => {
          const route = paths.find((path) => path.platform === summary.platform);
          return (
            <Card key={summary.platform} className="flex min-w-0 flex-col p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-extrabold text-ink">{LABELS[summary.platform]}</h3>
                <span className="text-small text-ink-3">{summary.registered} {t('enregistrés', 'registered')} · {t('objectif', 'target')} {summary.target}</span>
              </div>
              <div className="mb-3 flex items-baseline gap-2"><strong className="num text-3xl font-extrabold text-ink">{summary.online}</strong><span className="text-small text-ink-2">{t('écran(s) signalé(s) en ligne', 'screen(s) reported online')}</span></div>
              <dl className="mb-3 grid grid-cols-3 gap-2 border-y border-line py-3 text-small">
                <div><dt className="text-ink-3">{t('À connecter', 'Sign in')}</dt><dd className="num font-bold text-ink">{summary.signIn}</dd></div>
                <div><dt className="text-ink-3">{t('À vérifier', 'Check')}</dt><dd className="num font-bold text-ink">{summary.unavailable}</dd></div>
                <div><dt className="text-ink-3">{t('Jamais vus', 'Not seen')}</dt><dd className="num font-bold text-ink">{summary.never}</dd></div>
              </dl>
              <p className="flex items-center gap-1.5 text-small text-ink-3"><Radio className="size-3.5 shrink-0" aria-hidden />{summary.lastReportAt ? `${t('Dernier signal', 'Last report')} ${ago(summary.lastReportAt, lang)}` : t('Aucun signal reçu pour ces comptes.', 'No report received for these accounts.')}</p>
              {summary.pending > 0 && <p className="mt-1 text-small font-semibold text-wait-2">{t(`${summary.pending} commande(s) à remettre au relais`, `${summary.pending} command(s) awaiting the relay`)}</p>}
              <div className="mt-3 space-y-1 rounded-lg bg-sunken p-3 text-small text-ink-2">
                <p className="font-semibold">{route?.mode === 'via_clover' ? t('Parcours configuré : plateforme → Clover', 'Configured route: platform → Clover') : route?.mode === 'direct' ? t('Parcours configuré : plateforme → Food Hub', 'Configured route: platform → Food Hub') : route ? t('Parcours API non configuré', 'API route not configured') : t('Parcours API non signalé', 'API route not reported')}</p>
                {route?.mode === 'direct' && <p>{route.cloverReady ? t('Connexion Clover configurée.', 'Clover connection configured.') : t('Connexion Clover à configurer.', 'Clover connection needs setup.')}</p>}
                {route?.lastOrderAt ? <p>{t('Dernière commande enregistrée', 'Last recorded order')} {ago(route.lastOrderAt, lang)}</p> : <p>{route ? t('Aucune commande récente enregistrée.', 'No recent order recorded.') : t('Historique des commandes non signalé.', 'Order history not reported.')}</p>}
              </div>
              {onShow && <Button variant="ghost" className="mt-3 w-full" onClick={() => onShow(summary.channel)} icon={<ArrowRight className="size-4" />}>{t('Afficher les écrans', 'Show screens')} {LABELS[summary.platform]}</Button>}
            </Card>
          );
        })}
      </div>}
      <p className="flex items-start gap-2 text-small text-ink-3"><LogIn className="mt-0.5 size-4 shrink-0" aria-hidden />{t('Vous vous connectez vous-même dans chaque écran de plateforme. Un écran en ligne ne confirme pas l’accès API ni l’impression d’une commande : ces parcours se vérifient séparément.', 'Sign in yourself inside each platform screen. An online screen does not confirm API access or order printing; verify those routes separately.')}</p>
      {!relayConfigured && <p className="text-small font-semibold text-wait-2">{t('La surveillance du relais n’est pas configurée dans cette instance de Food Hub. Les connexions déjà ouvertes sur votre PC sont conservées.', 'Relay monitoring is not configured in this Food Hub instance. Existing sign-ins on your PC are preserved.')}</p>}
      {manage && <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-bold text-ink"><Computer className="size-4 shrink-0 text-brand" aria-hidden />{t('Déjà installé sur votre PC Windows ?', 'Already installed on your Windows PC?')}</summary>
        <div className="mt-2 space-y-2 text-small leading-relaxed text-ink-2">
          <p>{t('Gardez votre installation et vos profils existants. Avant d’ajouter des comptes, vérifiez l’état sur ce même PC, dans le dossier de vos écrans Food Hub.', 'Keep your existing installation and browser profiles. Before adding accounts, check status on that same PC in your existing Food Hub screens folder.')}</p>
          <p>{t('Lancez seulement', 'Run only')} <code className="rounded bg-sunken px-1.5 py-0.5">Status-Screens.ps1</code>. {t('Ce contrôle lit les écrans enregistrés, les navigateurs et les agents actifs. Il ne réinstalle rien et ne déconnecte aucun compte.', 'This check reads registered screens, browsers and active agents. It reinstalls nothing and signs no account out.')}</p>
          <p>{t('Si un écran demande une connexion, ouvrez sa fenêtre existante sur le PC et reconnectez-vous vous-même. Ne supprimez pas ses profils pour le réparer.', 'If a screen asks for sign-in, open its existing window on the PC and sign in yourself. Do not delete its profiles to fix it.')}</p>
        </div>
      </details>}
    </section>
  );
}
