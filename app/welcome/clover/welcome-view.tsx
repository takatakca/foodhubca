'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight, Check, CircleAlert, ExternalLink, Globe, Hourglass, Layers, Loader2, Lock, Mail, MonitorSmartphone,
  PartyPopper, Phone, PlugZap, Printer, Receipt, ShieldCheck, Store, Tablet, Tags, UtensilsCrossed, X,
} from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
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
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas text-ink lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)]">
      <Rail t={t} />
      <main className="relative flex min-w-0 flex-col px-4 pt-5 pb-8 sm:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_70%_0%,rgb(255_91_20/0.08),transparent)]" aria-hidden />
        <header className="relative flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 lg:invisible">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-8 rounded-lg" />
            <span className="font-extrabold tracking-tight">TAKATAK Food Hub</span>
          </span>
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-bold text-ink-3 hover:bg-sunken hover:text-ink" aria-label={lang === 'fr' ? 'Switch to English' : 'Passer au français'}>
            <Globe className="size-4" />{lang === 'fr' ? 'English' : 'Français'}
          </button>
        </header>

        <div className="relative mx-auto w-full max-w-2xl flex-1 space-y-5 py-8">
          <StatusHero data={data} t={t} />
          {allDone && <Celebration t={t} />}
          {data.merchant && data.state !== 'gone' && <RegisterCard data={data} t={t} lang={lang} />}
          {(data.state === 'connected' || data.state === 'pending') && <Steps data={data} t={t} />}
          {data.state === 'connected' && data.ticket && <TestOrder ticket={data.ticket} t={t} />}
          <Help data={data} t={t} lang={lang} />
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- rail */

function Rail({ t }: { t: T }) {
  const platforms = [
    { name: 'Uber Eats', dot: 'bg-uber' },
    { name: 'DoorDash', dot: 'bg-doordash' },
    { name: 'SkipTheDishes', dot: 'bg-skip' },
    { name: 'Too Good To Go', dot: 'bg-tgtg' },
  ];
  return (
    <aside className="relative hidden overflow-hidden bg-rail p-10 text-white lg:flex lg:flex-col xl:p-12">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
        <div>
          <div className="text-lg leading-tight font-extrabold tracking-tight">TAKATAK Food Hub</div>
          <div className="text-[13px] text-white/50">{t('pour votre caisse Clover', 'for your Clover register')}</div>
        </div>
      </div>

      <div className="my-auto py-10">
        <h1 className="max-w-md text-[40px] leading-[1.05] font-extrabold tracking-tight">
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

function StatusHero({ data, t }: { data: WelcomeData; t: T }) {
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
    intro: t('Bienvenue dans TAKATAK Food Hub', 'Welcome to TAKATAK Food Hub'),
  }[data.state];
  const body = {
    connected: t('Les commandes de livraison de ce restaurant arriveront dans Clover, s’imprimeront à la cuisine et se fermeront payées.', 'This restaurant’s delivery orders will land in Clover, print in the kitchen and close as paid.'),
    pending: t('Votre caisse attend l’approbation de l’équipe TAKATAK. Rien n’est envoyé à votre caisse avant. Nous sommes avisés et répondons en général le jour ouvrable même.', 'Your register is waiting for the TAKATAK team’s approval. Nothing is sent to your register until then. We have been notified and usually answer the same business day.'),
    gone: t('L’application a été désinstallée ou la demande a été refusée. Rouvrez l’application depuis Clover pour recommencer.', 'The app was uninstalled or the request was declined. Open the app again from Clover to start over.'),
    error: data.error ? t(data.error.fr, data.error.en) : '',
    intro: t('Ouvrez l’application depuis votre tableau de bord Clover : votre caisse se branche en un clic.', 'Open the app from your Clover dashboard: your register connects in one click.'),
  }[data.state];

  return (
    <section className="motion-safe:animate-rise rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="flex items-start gap-4">
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
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">{x.icon}<span className="truncate">{x.label}</span></div>
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
        {live && <ProgressRing done={done} total={live.length} t={t} />}
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

function ProgressRing({ done, total, t }: { done: number; total: number; t: T }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="relative size-14 shrink-0" role="img" aria-label={t(`${done} étape(s) sur ${total}`, `${done} of ${total} step(s)`)}>
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-sunken" />
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-go transition-[stroke-dashoffset] duration-500" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="num absolute inset-0 flex items-center justify-center text-[13px] font-extrabold">{done}/{total}</span>
    </div>
  );
}

const CONFETTI_COLORS = ['bg-brand', 'bg-go', 'bg-info', 'bg-wait', 'bg-violet', 'bg-clover'];

function Celebration({ t }: { t: T }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-rail p-6 text-white shadow-pop" role="status">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className={cn('absolute top-0 h-2.5 w-1.5 rounded-[2px] opacity-0 motion-safe:animate-confetti', CONFETTI_COLORS[i % CONFETTI_COLORS.length])}
            style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 70}ms`, ['--r' as string]: `${(i * 53) % 360}deg`, ['--x' as string]: `${((i * 29) % 60) - 30}px` }} />
        ))}
      </div>
      <div className="relative flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand motion-safe:animate-pop"><PartyPopper className="size-6" /></span>
        <div>
          <div className="text-xl font-extrabold">{t('Tout est prêt !', 'You’re all set!')}</div>
          <div className="text-[14px] text-white/70">{t('Plateformes branchées, menu importé, cuisine équipée. La prochaine commande arrive directement dans Clover.', 'Platforms connected, menu imported, kitchen equipped. The next order goes straight into Clover.')}</div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- test order */

type TestStep = { key: 'created' | 'printed' | 'paid'; ok: boolean; detail: string };
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
          : res.error || t('Clover a refusé la commande.', 'Clover refused the order.')
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
                <div className="num truncate text-[12px] text-ink-3">{s.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
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
