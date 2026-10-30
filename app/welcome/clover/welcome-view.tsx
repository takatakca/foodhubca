'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight, Check, CircleAlert, ExternalLink, Globe, Hourglass, Layers, Loader2, Lock, Mail, MonitorSmartphone,
  Phone, PlugZap, Printer, Receipt, ShieldCheck, Store, Tablet, Tags, UtensilsCrossed, X,
} from 'lucide-react';
import { TakatakMark } from '@/components/brand/takatak-mark';
import { buttonClass } from '@/components/ui/button';
import { CelebrationBanner, Confetti, useCelebrateOnce } from '@/components/ui/celebration';
import { ProgressRing } from '@/components/ui/progress-ring';
import { useI18n } from '@/lib/i18n/client';
import { CELEBRATION_KEYS } from '@/lib/ui/celebrate';
import { cn } from '@/lib/ui/cn';
import type { MevMerchantSetup } from '@/lib/foodhub/mev/clover-merchants';
import type { CloverBilling, CloverMerchantProfile } from '@/lib/foodhub/pos/clover-oauth';
import type { OnboardingKey, OnboardingStep } from '@/lib/foodhub/onboarding';

type FrEn = { fr: string; en: string };

export interface WelcomeData {
  state: 'connected' | 'pending' | 'gone' | 'error' | 'intro';
  ticket: string | null;
  merchant: { id: string; name: string | null; city: string | null; region: string | null; country: string | null } | null;
  register: CloverMerchantProfile | null;
  billing: CloverBilling | null;
  error: FrEn | null;
  viewer: { name: string; canSetup: boolean } | null;
  steps: OnboardingStep[] | null;
  loginHref: string;
  cloverUrl: string;
  support: { email: string | null; phone: string | null; hours: FrEn };
  /** Which Clover app was opened (absent = TAKATAK Food Hub) and its listing name. */
  app?: 'foodhub' | 'phone' | 'mev';
  appName?: string;
  /** TAKATAK MEV: the merchant's own self-serve set-up in Takatak MEV (lib/foodhub/mev/clover-merchants.ts). */
  mevSetup?: MevMerchantSetup;
}

type T = (fr: string, en: string) => string;

const STEP_TEXT: Record<OnboardingKey, { icon: ReactNode; title: FrEn; body: FrEn }> = {
  platforms: {
    icon: <PlugZap className="size-5" />,
    title: { fr: 'Branchez vos plateformes de livraison', en: 'Connect your delivery platforms' },
    body: { fr: 'Uber Eats, DoorDash, SkipTheDishes : les accès de chaque plateforme et vos magasins jumelés.', en: 'Uber Eats, DoorDash, SkipTheDishes: each platform’s access and your stores mapped.' },
  },
  menu: {
    icon: <UtensilsCrossed className="size-5" />,
    title: { fr: 'Importez votre menu Clover', en: 'Import your Clover menu' },
    body: { fr: 'Vos articles, catégories et options deviennent le menu maître publié partout.', en: 'Your items, categories and options become the master menu published everywhere.' },
  },
  kitchen: {
    icon: <Tablet className="size-5" />,
    title: { fr: 'Tablette de cuisine et NIP', en: 'Kitchen tablet and PIN' },
    body: { fr: 'Inscrivez la tablette de la cuisine et choisissez votre NIP de gérant.', en: 'Enrol the kitchen tablet and choose your manager PIN.' },
  },
};
const STEP_ORDER: OnboardingKey[] = ['platforms', 'menu', 'kitchen'];

export function WelcomeView({ data }: { data: WelcomeData }) {
  const { t, lang, setLang } = useI18n();
  const allDone = data.state === 'connected' && Boolean(data.steps?.length) && data.steps!.every((s) => s.done);
  // Clover connected: this page is where the Clover app lands once the register is connected. The first time this device
  // sees it, one confetti burst over the status (once per device; not when the "all set" celebration already shows).
  const connectedNow = useCelebrateOnce(CELEBRATION_KEYS.cloverConnected, data.state === 'connected');
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas text-ink lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)]">
      <Rail t={t} appName={data.appName} />
      <main className="relative flex min-w-0 flex-col px-4 pt-5 pb-8 sm:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_70%_0%,rgb(31_139_255/0.08),transparent)]" aria-hidden />
        <header className="relative flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 lg:invisible">
            <TakatakMark size="sm" />
            <span className="font-extrabold tracking-tight">{data.appName || 'TAKATAK Food Hub'}</span>
          </span>
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-bold text-ink-3 hover:bg-sunken hover:text-ink" aria-label={lang === 'fr' ? 'Switch to English' : 'Passer au français'}>
            <Globe className="size-4" />{lang === 'fr' ? 'English' : 'Français'}
          </button>
        </header>

        <div className="relative mx-auto w-full max-w-2xl flex-1 space-y-5 py-8">
          <StatusHero data={data} t={t} confetti={connectedNow && !allDone} />
          {allDone && <Celebration t={t} />}
          {data.merchant && data.state !== 'gone' && <RegisterCard data={data} t={t} lang={lang} />}
          {(!data.app || data.app === 'foodhub') && (data.state === 'connected' || data.state === 'pending') && <Steps data={data} t={t} />}
          {(!data.app || data.app === 'foodhub') && data.state === 'connected' && data.ticket && <TestOrder ticket={data.ticket} t={t} />}
          {data.app === 'mev' && data.state === 'connected' && data.ticket && data.mevSetup?.open && !data.mevSetup.kitchen && <MevSetup ticket={data.ticket} initial={data.mevSetup} t={t} />}
          <Help data={data} t={t} lang={lang} />
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- rail */

function Rail({ t, appName }: { t: T; appName?: string }) {
  const platforms = [
    { name: 'Uber Eats', dot: 'bg-uber' },
    { name: 'DoorDash', dot: 'bg-doordash' },
    { name: 'SkipTheDishes', dot: 'bg-skip' },
    { name: 'Too Good To Go', dot: 'bg-tgtg' },
  ];
  return (
    <aside className="relative hidden overflow-hidden bg-rail p-10 text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col xl:p-12">
      <div className="flex items-center gap-3">
        <TakatakMark />
        <div>
          <div className="text-lg leading-tight font-extrabold tracking-tight">{appName || 'TAKATAK Food Hub'}</div>
          <div className="text-[13px] text-white/50">{t('pour votre caisse Clover', 'for your Clover register')}</div>
        </div>
      </div>

      <div className="my-auto py-8">
        <h1 className="max-w-lg text-[38px] leading-[1.05] font-extrabold tracking-tight xl:text-[42px]">
          {t('Toutes vos plateformes.', 'Every platform.')}<br /><span className="text-brand">{t('Une seule caisse.', 'One register.')}</span>
        </h1>
        <p className="mt-4 max-w-md text-white/60">{t('Les commandes de livraison arrivent dans Clover, s’impriment à la cuisine et se ferment payées — sans agrégateur.', 'Delivery orders land in Clover, print in the kitchen and close as paid — no aggregator.')}</p>

        {/* How orders flow: platforms → Food Hub → Clover */}
        <div className="mt-10 max-w-sm" aria-hidden>
          <div className="grid grid-cols-2 gap-2">
            {platforms.map((p) => (
              <div key={p.name} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] font-semibold text-white/85">
                <span className={cn('size-2 rounded-full', p.dot)} />{p.name}
              </div>
            ))}
          </div>
          <FlowLine />
          <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-black">T</span>
            <div><div className="text-sm font-bold">Food Hub</div><div className="text-xs text-white/55">{t('accepte, imprime, synchronise', 'accepts, prints, syncs')}</div></div>
          </div>
          <FlowLine />
          <div className="flex items-center gap-3 rounded-xl border border-clover/50 bg-clover/15 px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-clover"><Receipt className="size-4" /></span>
            <div><div className="text-sm font-bold">{t('Votre caisse Clover', 'Your Clover register')}</div><div className="text-xs text-white/55">{t('commande, billet de cuisine, paiement', 'order, kitchen ticket, payment')}</div></div>
          </div>
        </div>
      </div>

      <ul className="space-y-2.5 text-[13px] text-white/70">
        <li className="flex items-center gap-2.5"><ShieldCheck className="size-4 text-brand" />{t('Vos jetons Clover restent sur notre serveur.', 'Your Clover tokens stay on our server.')}</li>
        <li className="flex items-center gap-2.5"><Lock className="size-4 text-brand" />{t('Aucun paiement par carte : nous ne touchons pas à l’argent.', 'No card payments: we never touch the money.')}</li>
        <li className="flex items-center gap-2.5"><Globe className="size-4 text-brand" />{t('En français et en anglais.', 'In French and English.')}</li>
      </ul>
      <div className="pointer-events-none absolute -right-48 -bottom-48 size-[520px] rounded-full bg-brand/15 blur-3xl" />
    </aside>
  );
}

function FlowLine() {
  return (
    <div className="relative ml-[22px] h-7 w-px bg-white/15">
      <span className="absolute -left-[3px] size-[7px] rounded-full bg-brand motion-safe:animate-flow" />
    </div>
  );
}

/* ---------------------------------------------------------------- status */

function StatusHero({ data, t, confetti }: { data: WelcomeData; t: T; confetti?: boolean }) {
  const who = data.merchant?.name || null;
  const where = [data.merchant?.city, data.merchant?.region].filter(Boolean).join(', ');
  const tone = {
    connected: { ring: 'bg-go-soft text-go', icon: <Check className="size-7" strokeWidth={3} /> },
    pending: { ring: 'bg-wait-soft text-wait-2', icon: <Hourglass className="size-7" /> },
    gone: { ring: 'bg-sunken text-ink-3', icon: <Store className="size-7" /> },
    error: { ring: 'bg-stop-soft text-stop', icon: <CircleAlert className="size-7" /> },
    intro: { ring: 'bg-brand-soft text-brand', icon: <Receipt className="size-7" /> },
  }[data.state];
  const title = {
    connected: t('Votre caisse Clover est branchée', 'Your Clover register is connected'),
    pending: t('Demande reçue', 'Request received'),
    gone: t('Cette connexion n’est plus active', 'This connection is no longer active'),
    error: t('Le branchement n’a pas fonctionné', 'The connection did not work'),
    intro: t(`Bienvenue dans ${data.appName || 'TAKATAK Food Hub'}`, `Welcome to ${data.appName || 'TAKATAK Food Hub'}`),
  }[data.state];
  const body = {
    connected: data.app === 'phone'
      ? t('L’IA répondra aux appels de ce restaurant : la commande payée arrivera dans Clover et s’imprimera à la cuisine.', 'The AI will answer this restaurant’s calls: the paid order will land in Clover and print in the kitchen.')
      : data.app === 'mev' && data.mevSetup?.kitchen
      ? t('Votre caisse est reliée à TAKATAK MEV. Ses ventes reçoivent leur facture par votre cuisine Food Hub : rien d’autre à faire ici.', 'Your register is linked to TAKATAK MEV. Its sales get their invoice through your Food Hub kitchen: nothing else to do here.')
      : data.app === 'mev' && data.mevSetup?.open
      ? t('Votre caisse est reliée à TAKATAK MEV. Suivez les 3 étapes ci-dessous pour que ses ventes reçoivent leur facture Revenu Québec.', 'Your register is linked to TAKATAK MEV. Follow the 3 steps below so its sales get their Revenu Québec invoice.')
      : data.app === 'mev'
      ? t('Votre caisse est reliée à TAKATAK MEV. Avant la première facture Revenu Québec, l’équipe TAKATAK configure votre dossier (NEQ, code d’autorisation, certificat) et active votre caisse : nous vous contactons.', 'Your register is linked to TAKATAK MEV. Before the first Revenu Québec invoice, the TAKATAK team sets up your file (NEQ, authorization code, certificate) and turns your register on: we will contact you.')
      : t('Les commandes de livraison de ce restaurant arriveront dans Clover, s’imprimeront à la cuisine et se fermeront payées.', 'This restaurant’s delivery orders will land in Clover, print in the kitchen and close as paid.'),
    pending: t('Votre caisse attend l’approbation de l’équipe TAKATAK. Rien n’est envoyé à votre caisse avant. Nous sommes avisés et répondons en général le jour ouvrable même.', 'Your register is waiting for the TAKATAK team’s approval. Nothing is sent to your register until then. We have been notified and usually answer the same business day.'),
    gone: t('L’application a été désinstallée ou la demande a été refusée. Rouvrez l’application depuis Clover pour recommencer.', 'The app was uninstalled or the request was declined. Open the app again from Clover to start over.'),
    error: data.error ? t(data.error.fr, data.error.en) : '',
    intro: t('Ouvrez l’application depuis votre tableau de bord Clover : votre caisse se branche en un clic.', 'Open the app from your Clover dashboard: your register connects in one click.'),
  }[data.state];

  return (
    <section className="relative overflow-hidden motion-safe:animate-rise rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
      {confetti && <Confetti />}
      <div className="relative flex items-start gap-4">
        <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-full motion-safe:animate-pop', tone.ring)}>{tone.icon}</span>
        <div className="min-w-0">
          {(who || where) && <div className="mb-1 truncate text-[13px] font-semibold text-ink-3">{[who, where].filter(Boolean).join(' · ')}</div>}
          <h2 className="text-[24px] leading-tight font-extrabold tracking-tight sm:text-[28px]">{title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{body}</p>
        </div>
      </div>

      {data.state === 'pending' && <Timeline t={t} />}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {data.state === 'connected' && data.viewer && <Link href="/" className={buttonClass('primary', 'lg')}>{t('Ouvrir Food Hub', 'Open Food Hub')}<ArrowRight className="size-4" /></Link>}
        {data.state === 'connected' && !data.viewer && <Link href={data.loginHref} className={buttonClass('primary', 'lg')}>{t('Se connecter à Food Hub', 'Sign in to Food Hub')}<ArrowRight className="size-4" /></Link>}
        {(data.state === 'error' || data.state === 'gone' || data.state === 'intro') && (
          <a href={data.cloverUrl} className={buttonClass('primary', 'lg')}>{t('Aller à Clover', 'Go to Clover')}<ExternalLink className="size-4" /></a>
        )}
        {data.support.email && <a href={`mailto:${data.support.email}`} className={buttonClass('outline', 'lg')}><Mail className="size-4" />{t('Nous écrire', 'Contact us')}</a>}
      </div>
    </section>
  );
}

function Timeline({ t }: { t: T }) {
  const items = [
    { label: t('Application installée', 'App installed'), state: 'done' as const },
    { label: t('Approbation par TAKATAK', 'Approval by TAKATAK'), state: 'now' as const },
    { label: t('Mise en route : 3 étapes', 'Set-up: 3 steps'), state: 'next' as const },
  ];
  return (
    <ol className="mt-6 grid grid-cols-3 gap-2" aria-label={t('Progression', 'Progress')}>
      {items.map((it, i) => (
        <li key={i} className="min-w-0">
          <div className={cn('h-1.5 rounded-full', it.state === 'done' ? 'bg-go' : it.state === 'now' ? 'bg-wait motion-safe:animate-pulse-soft' : 'bg-sunken')} />
          <div className={cn('mt-2 text-[12px] leading-snug font-semibold', it.state === 'next' ? 'text-ink-3' : 'text-ink')}>{it.label}</div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- register */

function RegisterCard({ data, t, lang }: { data: WelcomeData; t: T; lang: 'fr' | 'en' }) {
  const r = data.register;
  const m = data.merchant!;
  const tiles: Array<{ icon: ReactNode; label: string; value: number | null }> = [
    { icon: <UtensilsCrossed className="size-4" />, label: t('Articles', 'Items'), value: r?.items ?? null },
    { icon: <Layers className="size-4" />, label: t('Catégories', 'Categories'), value: r?.categories ?? null },
    { icon: <Tags className="size-4" />, label: t('Types de commande', 'Order types'), value: r?.orderTypes ?? null },
    { icon: <Receipt className="size-4" />, label: t('Modes de paiement', 'Tenders'), value: r?.tenders ?? null },
    { icon: <MonitorSmartphone className="size-4" />, label: t('Appareils', 'Devices'), value: r?.devices ?? null },
  ];
  const missing = (r?.missing ?? []).map((k) => ({ inventory: t('Inventaire', 'Inventory'), orders: t('Commandes', 'Orders'), merchant: t('Marchand', 'Merchant') })[k]);
  const read = r?.readAt ? new Date(r.readAt).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <section className="motion-safe:animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-[0.12em] text-ink-3 uppercase">{t('Votre caisse Clover', 'Your Clover register')}</div>
          <div className="mt-1 truncate text-lg font-extrabold">{m.name || t('Marchand Clover', 'Clover merchant')}</div>
          <div className="num text-[12px] text-ink-3">{t('Identifiant marchand', 'Merchant ID')} {m.id}</div>
        </div>
        {data.billing && <BillingPill billing={data.billing} t={t} />}
      </div>
      {r ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-xl bg-raised px-3 py-2.5">
                <div className="flex min-h-8 items-start gap-1.5 text-[12px] leading-tight font-medium text-ink-3"><span className="mt-px shrink-0">{x.icon}</span><span>{x.label}</span></div>
                <div className="num mt-0.5 text-xl font-extrabold">{x.value == null ? '—' : x.value >= 1000 ? '1000+' : x.value}</div>
              </div>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-wait-soft px-3 py-2 text-[13px] text-ink">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-wait-2" />
              {t(`Food Hub n’a pas pu lire : ${missing.join(', ')}. Votre forfait Clover doit inclure l’inventaire et les commandes.`, `Food Hub could not read: ${missing.join(', ')}. Your Clover plan must include Inventory and Orders.`)}
            </p>
          )}
          <p className="mt-3 text-[12px] text-ink-3">{t(`Lu en lecture seule${read ? ` le ${read}` : ''} : rien n’a été modifié dans votre caisse.`, `Read-only check${read ? ` on ${read}` : ''}: nothing was changed in your register.`)}</p>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">{t('La vérification de la caisse se fait à la prochaine ouverture de l’application depuis Clover.', 'The register check runs the next time the app is opened from Clover.')}</p>
      )}
    </section>
  );
}

function BillingPill({ billing, t }: { billing: CloverBilling; t: T }) {
  const s = (billing.status || '').toUpperCase();
  const ok = s === 'ACTIVE';
  const label = ok ? t('Abonnement actif', 'Subscription active') : s === 'LAPSED' ? t('Abonnement échu', 'Subscription lapsed') : s ? t(`Abonnement : ${s.toLowerCase()}`, `Subscription: ${s.toLowerCase()}`) : t('Abonnement inconnu', 'Subscription unknown');
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold', ok ? 'bg-go-soft text-go-2' : 'bg-wait-soft text-wait-2')}>
      <span className={cn('size-1.5 rounded-full', ok ? 'bg-go' : 'bg-wait')} />{label}{billing.inTrial ? ` · ${t('essai', 'trial')}` : ''}{billing.plan ? ` · ${billing.plan}` : ''}
    </span>
  );
}

/* ---------------------------------------------------------------- steps */

function Steps({ data, t }: { data: WelcomeData; t: T }) {
  const locked = data.state === 'pending';
  const live = data.steps;
  const done = live ? live.filter((s) => s.done).length : 0;
  return (
    <section className="motion-safe:animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.12em] text-brand uppercase">{t('Mise en route', 'Getting started')}</div>
          <h3 className="mt-1 text-lg font-extrabold">{t('3 étapes et vos commandes arrivent dans Clover', '3 steps and your orders reach Clover')}</h3>
        </div>
        {live && <ProgressRing value={live.length ? done / live.length : 0} label={`${done}/${live.length}`} ariaLabel={t(`${done} étape(s) sur ${live.length}`, `${done} of ${live.length} step(s)`)} />}
      </div>
      <ol className="mt-4 space-y-2">
        {STEP_ORDER.map((key, i) => {
          const s = live?.find((x) => x.key === key);
          const txt = STEP_TEXT[key];
          const isDone = Boolean(s?.done);
          return (
            <li key={key} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors', isDone ? 'border-go/30 bg-go-soft/60' : 'border-line bg-raised')}>
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold', isDone ? 'bg-go text-white' : locked ? 'bg-sunken text-ink-3' : 'bg-surface text-ink shadow-card')}>
                {isDone ? <Check className="size-4" strokeWidth={3} /> : locked ? <Lock className="size-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex items-center gap-2 font-bold"><span className="text-ink-3">{txt.icon}</span>{t(txt.title.fr, txt.title.en)}</div>
                <div className="mt-0.5 text-[13px] text-ink-2">{s ? t(s.detail.fr, s.detail.en) : t(txt.body.fr, txt.body.en)}</div>
              </div>
              {s && !isDone && <Link href={s.href} className={buttonClass('outline', 'sm')}>{t('Commencer', 'Start')}<ArrowRight className="size-3.5" /></Link>}
            </li>
          );
        })}
      </ol>
      {locked && <p className="mt-3 text-[13px] text-ink-3">{t('Ces étapes s’ouvrent dès que votre caisse est approuvée.', 'These steps open as soon as your register is approved.')}</p>}
      {!locked && !live && !data.viewer && (
        <p className="mt-3 text-[13px] text-ink-3">{t('Connectez-vous à Food Hub pour suivre ces étapes. Pas encore de compte ? Le propriétaire de votre groupe vous invite dans Réglages → Équipe.', 'Sign in to Food Hub to follow these steps. No account yet? Your group’s owner invites you in Settings → Team.')}</p>
      )}
      {!locked && !live && data.viewer && !data.viewer.canSetup && (
        <p className="mt-3 text-[13px] text-ink-3">{t('Ces étapes sont faites par le propriétaire ou un gérant.', 'These steps are done by the owner or a manager.')}</p>
      )}
    </section>
  );
}

/** The wizard's last moment (components/ui/celebration.tsx holds the confetti shared with Go-live and the menus). */
function Celebration({ t }: { t: T }) {
  return (
    <CelebrationBanner title={t('Tout est prêt !', 'You’re all set!')}
      body={t('Plateformes branchées, menu importé, cuisine équipée. La prochaine commande arrive directement dans Clover.', 'Platforms connected, menu imported, kitchen equipped. The next order goes straight into Clover.')} />
  );
}

/* ---------------------------------------------------------------- test order */

type TestStep = { key: 'created' | 'printed' | 'paid'; ok: boolean; detail: FrEn };
type TestResult = { ok: boolean; reason?: string; error?: string; steps?: TestStep[] };

function TestOrder({ ticket, t }: { ticket: string; t: T }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  async function send() {
    setBusy(true);
    try {
      const r = await fetch('/api/foodhub/clover-connect/test-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: ticket }) });
      setRes((await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as TestResult);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }
  const label: Record<TestStep['key'], string> = {
    created: t('Commande créée dans Clover', 'Order created in Clover'),
    printed: t('Billet envoyé à l’imprimante', 'Ticket sent to the printer'),
    paid: t('Payée avec le mode « Uber Eats »', 'Paid with the “Uber Eats” tender'),
  };
  const icon: Record<TestStep['key'], ReactNode> = { created: <Tags className="size-4" />, printed: <Printer className="size-4" />, paid: <Receipt className="size-4" /> };
  const err = res && !res.ok
    ? res.reason === 'not_approved' ? t('Votre caisse n’est pas encore approuvée.', 'Your register is not approved yet.')
      : res.reason === 'limited' ? t('Trois commandes test par heure au maximum. Réessayez plus tard.', 'Three test orders per hour at most. Try again later.')
        : res.reason === 'ticket' ? t('Lien expiré : rouvrez l’application depuis Clover.', 'Link expired: open the app again from Clover.')
          : t('Clover a refusé la commande test (détail ci-dessus).', 'Clover refused the test order (details above).')
    : null;
  return (
    <section className="motion-safe:animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="text-xs font-bold tracking-[0.12em] text-ink-3 uppercase">{t('Vérification', 'Check')}</div>
          <h3 className="mt-1 text-lg font-extrabold">{t('Envoyez une commande test à votre caisse', 'Send a test order to your register')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('Une commande TEST est créée dans Clover, s’imprime à la cuisine et se ferme payée — comme une vraie commande Uber Eats. Rien n’est envoyé aux plateformes.', 'A TEST order is created in Clover, prints in the kitchen and closes as paid — just like a real Uber Eats order. Nothing is sent to the platforms.')}</p>
        </div>
        <button type="button" onClick={send} disabled={busy} className={buttonClass('brand', 'lg')}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}{t('Envoyer une commande test', 'Send a test order')}
        </button>
      </div>
      {res?.steps && res.steps.length > 0 && (
        <ul className="mt-4 space-y-1.5" aria-live="polite">
          {res.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 rounded-lg bg-raised px-3 py-2">
              <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', s.ok ? 'bg-go text-white' : 'bg-stop text-white')}>{s.ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[14px] font-bold"><span className="text-ink-3">{icon[s.key]}</span>{label[s.key]}</div>
                <div className="num text-[12px] break-words text-ink-3">{t(s.detail.fr, s.detail.en)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-3 flex items-start gap-2 rounded-lg bg-stop-soft px-3 py-2 text-[13px] text-ink" aria-live="polite"><CircleAlert className="mt-0.5 size-4 shrink-0 text-stop" />{err}</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- TAKATAK MEV set-up */

function MevSetup({ ticket, initial, t }: { ticket: string; initial: MevMerchantSetup; t: T }) {
  const [setup, setSetup] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const active = setup.status === 'active';
  const r = setup.ready;
  async function check() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/foodhub/mev/clover-merchant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: ticket }) });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; setup?: MevMerchantSetup } | null;
      if (j?.ok && j.setup) {
        setSetup(j.setup);
        if (j.setup.error) setErr(t('Takatak MEV ne répond pas pour le moment. Réessayez dans quelques minutes.', 'Takatak MEV is not answering right now. Try again in a few minutes.'));
      } else if (j?.reason === 'ticket') setErr(t('Lien expiré : rouvrez l’application depuis Clover.', 'Link expired: open the app again from Clover.'));
      else setErr(t('La vérification n’a pas fonctionné.', 'The check did not work.'));
    } catch {
      setErr(t('La vérification n’a pas fonctionné.', 'The check did not work.'));
    } finally { setBusy(false); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(setup.locationCode ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the code stays visible to copy by hand */ }
  }
  const flags: Array<{ ok: boolean; label: string }> = [
    { ok: Boolean(r?.linked), label: t('Code lié', 'Code linked') },
    { ok: Boolean(r?.deviceReady), label: t('Caisse inscrite', 'Register enrolled') },
    { ok: Boolean(r?.certReady), label: t('Certificat', 'Certificate') },
    { ok: Boolean(r?.usersReady), label: t('Utilisateur Food Hub', 'Food Hub user') },
  ];
  const steps = [
    {
      title: t('Créez votre compte Takatak MEV', 'Create your Takatak MEV account'),
      body: t('Le nom de l’entreprise, son NEQ, ses numéros de TPS et de TVQ, et le gérant qui s’y connectera.', 'The business name, its NEQ, its GST and QST numbers, and the manager who will sign in.'),
    },
    {
      title: t('Inscrivez votre caisse et demandez son certificat', 'Enrol your register and request its certificate'),
      body: t('Dans Appareils : le numéro de dossier et le code d’autorisation que Revenu Québec vous a donnés pour cet établissement. Puis Paramètres → Demander un certificat.', 'In Appareils (Devices): the file number and authorization code Revenu Québec gave you for this establishment. Then Paramètres (Settings) → Demander un certificat.'),
    },
    {
      title: t('Liez votre caisse à Food Hub', 'Link your register to Food Hub'),
      body: t(`Dans Appareils → Cuisines Food Hub : locataire « ${setup.tenantId} », cuisine = votre code ci-dessous.`, `In Appareils (Devices) → Cuisines Food Hub: tenant “${setup.tenantId}”, kitchen = your code below.`),
    },
  ];
  return (
    <section className="motion-safe:animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="text-xs font-bold tracking-[0.12em] text-brand uppercase">{t('Mise en route', 'Getting started')}</div>
      <h3 className="mt-1 text-lg font-extrabold">{active ? t('Vos factures Revenu Québec sont activées', 'Your Revenu Québec invoices are on') : t('3 étapes dans Takatak MEV', '3 steps in Takatak MEV')}</h3>
      {setup.testMode && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-wait-soft px-3 py-2 text-[13px] text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-wait-2" />
          {t('Mode essai : Takatak MEV attend sa certification par Revenu Québec. D’ici là, les factures sont des essais, sans valeur fiscale.', 'Test mode: Takatak MEV is waiting for its Revenu Québec certification. Until then, invoices are tests with no tax value.')}
        </p>
      )}
      {!active && (
        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-4 rounded-xl border border-line bg-raised px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-extrabold text-ink shadow-card">{i + 1}</span>
              <div className="min-w-0">
                <div className="font-bold">{s.title}</div>
                <div className="mt-0.5 text-[13px] text-ink-2">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-raised px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[12px] font-semibold text-ink-3">{t('Votre code de cuisine Food Hub (gardez-le pour vous)', 'Your Food Hub kitchen code (keep it to yourself)')}</div>
          <div className="num mt-0.5 font-mono text-[15px] font-extrabold break-all">{setup.locationCode}</div>
        </div>
        <button type="button" onClick={copy} className={buttonClass('outline', 'sm')}>{copied ? <Check className="size-3.5" /> : null}{copied ? t('Copié', 'Copied') : t('Copier', 'Copy')}</button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-live="polite">
        {flags.map((f) => (
          <li key={f.label} className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold', f.ok ? 'bg-go-soft text-go-2' : 'bg-sunken text-ink-3')}>
            {f.ok ? <Check className="size-3.5" strokeWidth={3} /> : <Hourglass className="size-3.5" />}{f.label}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!active && setup.signUpUrl && <a href={setup.signUpUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg')}>{t('Ouvrir Takatak MEV', 'Open Takatak MEV')}<ExternalLink className="size-4" /></a>}
        {!active && (
          <button type="button" onClick={check} disabled={busy} className={buttonClass('outline', 'lg')}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{t('Vérifier maintenant', 'Check now')}
          </button>
        )}
      </div>
      {!active && !setup.signUpUrl && <p className="mt-3 text-[13px] text-ink-3">{t('L’adresse de Takatak MEV vous est envoyée par l’équipe TAKATAK : écrivez-nous.', 'The TAKATAK team sends you the Takatak MEV address: write to us.')}</p>}
      {active && <p className="mt-3 text-[13px] text-ink-2">{t('Chaque vente payée à votre caisse reçoit sa facture. L’application TAKATAK MEV sur votre appareil Clover l’imprime avec son code QR.', 'Every sale paid at your register gets its invoice. The TAKATAK MEV app on your Clover device prints it with its QR code.')}</p>}
      {err && <p className="mt-3 flex items-start gap-2 rounded-lg bg-stop-soft px-3 py-2 text-[13px] text-ink" aria-live="polite"><CircleAlert className="mt-0.5 size-4 shrink-0 text-stop" />{err}</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- help */

function Help({ data, t, lang }: { data: WelcomeData; t: T; lang: 'fr' | 'en' }) {
  const s = data.support;
  return (
    <footer className="rounded-2xl border border-dashed border-line-2 px-5 py-4 text-[13px] text-ink-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-bold text-ink">{t('Besoin d’aide ?', 'Need help?')}</span>
        {s.email && <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1.5 hover:text-ink"><Mail className="size-4" />{s.email}</a>}
        {s.phone && <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-ink"><Phone className="size-4" />{s.phone}</a>}
        <span className="text-ink-3">{lang === 'fr' ? s.hours.fr : s.hours.en}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-3">
        <Link href="/legal/support" className="underline-offset-4 hover:text-ink hover:underline">{t('Soutien et FAQ', 'Support and FAQ')}</Link>
        <Link href="/legal/privacy" className="underline-offset-4 hover:text-ink hover:underline">{t('Confidentialité', 'Privacy')}</Link>
        <Link href="/legal/terms" className="underline-offset-4 hover:text-ink hover:underline">{t('Conditions d’utilisation', 'Terms of use')}</Link>
      </div>
    </footer>
  );
}
