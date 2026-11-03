'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCircle2, ChevronRight, CircleDashed, CirclePlus, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CelebrationBanner, useCelebrateOnce } from '@/components/ui/celebration';
import { ProgressRing } from '@/components/ui/progress-ring';
import { TechDetails } from '../tech-details';
import { plainTitle } from '../tech-text';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { CELEBRATION_KEYS } from '@/lib/ui/celebrate';
import { cn } from '@/lib/ui/cn';
import { alertSteps, cloverAppSteps, goLiveProgress, goLiveStages, stepBadge, stepKind, stepTally, stepText, tallyLine, type CloverAppInfo, type GoLiveStage, type Step } from './steps';

type Readiness = { channel: string; label: string; configured: boolean; canSend: boolean; missing: string[]; viaClover?: boolean };
/** A mapped store whose orders cannot get into Clover (lib/foodhub/go-live.ts, sent by /api/foodhub/channels). */
type CloverStoreProblem = { channel: string; brandName: string; locationCode: string; merchantId: string | null; reason: 'no_merchant' | 'no_token' | 'reconnect' };
type SessionSecretInfo = { source: 'env' | 'password' | 'dev' | null; set: boolean; strong: boolean; since: string | null; changedAt: string | null };
type ChannelsData = {
  mode: string; liveEnabled: boolean; dashboardProtected: boolean;
  clover: { configured: boolean; appConfigured?: boolean; tokenMerchants?: number; missing: string[]; webhookAuthSet?: boolean; verification?: { code: string } | null; app?: CloverAppInfo };
  channels: Readiness[]; relay?: { channels: string[] };
  goLive?: { clover: { injectionEnabled: boolean; unreachableStores: CloverStoreProblem[] }; sessionSecret: SessionSecretInfo };
};
/** A SESSION_SECRET that changed less than this long ago is pointed out (everyone, tablets included, had to sign in again). */
const SECRET_CHANGE_WARN_MS = 7 * 86400_000;
type Notify = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
type User = { username: string; name: string; role: string; locations: string[]; email: string | null; phone: string | null; active: boolean; hasPin: boolean };
type Device = { id: string; locationCode: string; status: string };
type Store = { channel: string; brandName: string; locationCode: string };
type Fees = { confirmed: Record<string, boolean> };

/** A step's text for the owner: plain sentences in view, setting names and commands under « Détails techniques » (steps.ts). */
function StepText({ step }: { step: Step }) {
  const { t } = useI18n();
  const { plain, tech } = stepText(t, step);
  return (
    <>
      <div className="text-small mt-0.5 break-words text-ink-3">{plain}</div>
      {tech && <TechDetails>{tech}</TechDetails>}
    </>
  );
}

/** One stage per group, in page order: a tap jumps to its list. Wraps on a phone; the word is there for screen readers. */
function GoLiveStepper({ stages }: { stages: GoLiveStage[] }) {
  const { t } = useI18n();
  const word: Record<GoLiveStage['state'], string> = { done: t('prêt', 'ready'), check: t('à vérifier', 'to check'), current: t('en cours', 'in progress'), todo: t('à faire', 'to do') };
  return (
    <ol className="mt-5 flex flex-wrap gap-2" aria-label={t('Étapes de la mise en service', 'Go-live stages')}>
      {stages.map((s, i) => (
        <li key={s.group}>
          <a href={`#golive-${i}`} aria-current={s.state === 'current' ? 'step' : undefined}
            className={cn('text-small flex min-h-11 items-center gap-2 rounded-full border py-1 pr-3 pl-1 font-semibold hover:bg-sunken', s.state === 'current' ? 'border-brand text-ink' : 'border-line text-ink-2')}>
            <span aria-hidden className={cn('num flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold',
              s.state === 'done' ? 'bg-go text-white' : s.state === 'check' ? 'bg-wait-soft text-wait-2' : s.state === 'current' ? 'bg-brand text-white' : 'bg-sunken text-ink-3')}>
              {s.state === 'done' ? <Check className="size-4" strokeWidth={3} /> : s.state === 'check' ? <TriangleAlert className="size-3.5" /> : i + 1}
            </span>
            <span>{s.group}</span>
            {s.counted > 0 && s.state !== 'done' && s.state !== 'check' && <span className="num text-ink-3" aria-hidden>{s.ready}/{s.counted}</span>}
            <span className="sr-only">: {word[s.state]}{s.counted > 0 && s.state !== 'done' ? t(` (${s.ready} sur ${s.counted})`, ` (${s.ready} of ${s.counted})`) : ''}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

type CloverCheck = { report: { ok: boolean; unprintedCount: number; items: number; kitchenLabels: unknown[] } | null; taxes?: { ok: boolean; problems: string[]; problemsFr?: string[]; defaultPercent: number } };

/** Clover register check: kitchen printing labels and tax rates (read from Clover). */
function cloverCheckSteps(ck: CloverCheck, t: (fr: string, en: string) => string): Step[] {
  const out: Step[] = [];
  const r = ck.report;
  if (r?.ok) {
    out.push({ group: t('Plateformes', 'Platforms'), key: 'clover-print', state: r.unprintedCount ? 'todo' : 'done', title: t('Impression en cuisine (Clover)', 'Kitchen printing (Clover)'),
      body: r.unprintedCount ? t(`${r.unprintedCount} article(s) sur ${r.items} n’ont pas d’étiquette d’imprimante : ils ne s’impriment pas en cuisine.`, `${r.unprintedCount} of ${r.items} item(s) have no printer label: they never print in the kitchen.`) : t('Tous les articles s’impriment en cuisine.', 'Every item prints in the kitchen.'),
      href: '/settings/channels', cta: t('Corriger', 'Fix') });
  }
  if (ck.taxes?.ok) {
    out.push({ group: t('Plateformes', 'Platforms'), key: 'clover-tax', state: ck.taxes.problems.length ? 'todo' : 'done', title: t('Taxes dans Clover', 'Taxes in Clover'),
      body: ck.taxes.problems.length ? t((ck.taxes.problemsFr ?? ck.taxes.problems).join(' '), ck.taxes.problems.join(' ')) : t(`Taxes par défaut : ${ck.taxes.defaultPercent} %.`, `Default taxes: ${ck.taxes.defaultPercent}%.`), href: '/settings/channels', cta: t('Voir', 'See') });
  }
  return out;
}

/**
 * Clover line: orders reach Clover only with a merchant token in the environment or a merchant connected through the
 * app — and it stays to-do while a mapped store cannot reach its own register (no merchant, no token, app access expired).
 */
function cloverStep(ch: ChannelsData, t: (fr: string, en: string) => string, locName: (code: string) => string): Step {
  const envToken = ch.clover.missing.length === 0 || (ch.clover.tokenMerchants ?? 0) > 0;
  const active = (ch.clover.app?.merchants ?? []).filter((m) => m.status !== 'pending').length;
  const appKeys = Boolean(ch.clover.app?.configured ?? ch.clover.appConfigured);
  const done = envToken || active > 0;
  const stuck = ch.goLive?.clover.unreachableStores ?? [];
  if (done && stuck.length) {
    const why = (p: CloverStoreProblem) => p.reason === 'no_merchant' ? t('aucun marchand Clover', 'no Clover merchant')
      : p.reason === 'reconnect' ? t('accès de l’app Clover expiré : à rebrancher', 'Clover app access expired: reconnect') : t('marchand sans jeton', 'merchant without a token');
    const label = (k: string) => ch.channels.find((x) => x.channel === k)?.label ?? k;
    const list = stuck.slice(0, 4).map((p) => `${p.brandName} · ${shortLoc(locName(p.locationCode))} · ${label(p.channel)} (${why(p)})`).join(' ; ') + (stuck.length > 4 ? ` … (+${stuck.length - 4})` : '');
    return { group: t('Plateformes', 'Platforms'), key: 'clover', state: 'todo', title: 'Clover', href: '/stores/mapping', cta: t('Corriger', 'Fix'),
      body: `${t('Ces magasins ne peuvent pas envoyer leurs commandes dans Clover :', 'These stores cannot get their orders into Clover:')} ${list}` };
  }
  return {
    group: t('Plateformes', 'Platforms'), key: 'clover', state: done ? 'done' : 'todo', title: 'Clover',
    body: done
      ? (active ? t(`Les commandes vont dans la caisse (${active} marchand(s) branché(s) par l’app).`, `Orders go into the register (${active} merchant(s) connected through the app).`) : t('Les commandes vont dans la caisse.', 'Orders go into the register.'))
      : appKeys
        ? t('Les clés de l’app sont en place, mais aucun marchand Clover n’est branché : « Brancher un marchand Clover », ou ouvrez l’app depuis Clover.', 'The app keys are in, but no Clover merchant is connected: “Connect a Clover merchant”, or open the app from Clover.')
        : `${t('Manque :', 'Missing:')} ${ch.clover.missing.join(', ')}`,
    href: '/settings/channels', cta: t('Brancher', 'Connect'),
  };
}

/** SESSION_SECRET: required (set, long), and stable — a recent change is pointed out. */
function sessionSecretStep(ch: ChannelsData, t: (fr: string, en: string) => string, loc: string, now: number): Step {
  const base = { group: t('Fondations', 'Foundations'), key: 'session-secret', title: t('Secret de session (SESSION_SECRET)', 'Session secret (SESSION_SECRET)'), href: '/settings/channels', cta: t('Voir', 'See') };
  const s = ch.goLive?.sessionSecret;
  const day = (iso: string) => new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });
  const add = t('Ajoutez-le dans l’hébergeur (npm run setup) et gardez-le fixe — tapé par vous, jamais dans le clavardage.', 'Add it in the hosting settings (npm run setup) and keep it fixed — typed by you, never in chat.');
  if (!s?.set) {
    const why = s?.source === 'password'
      ? t('Manque : les sessions sont signées avec une clé tirée de DASHBOARD_PASSWORD, donc changer ce mot de passe déconnecte tout le monde, tablettes de cuisine comprises.', 'Missing: sessions are signed with a key derived from DASHBOARD_PASSWORD, so changing that password signs everyone out, kitchen tablets included.')
      : t('Manque : sans lui ni DASHBOARD_PASSWORD, chaque écran affiche « Locked » en production.', 'Missing: without it or DASHBOARD_PASSWORD, every screen says “Locked” in production.');
    return { ...base, state: 'todo', body: `${why} ${add}` };
  }
  if (!s.strong) return { ...base, state: 'todo', body: `${t('Trop court (moins de 32 caractères).', 'Too short (under 32 characters).')} ${add}` };
  if (s.changedAt && now - Date.parse(s.changedAt) < SECRET_CHANGE_WARN_MS) {
    return { ...base, state: 'warn', body: t(`A changé le ${day(s.changedAt)} : tout le monde a dû se reconnecter, tablettes comprises. Si ce n’est pas vous, l’hébergeur en crée un nouveau à chaque déploiement : mettez une valeur fixe.`, `Changed on ${day(s.changedAt)}: everyone had to sign in again, tablets included. If that was not you, the host makes a new one at each deploy: set a fixed value.`) };
  }
  return { ...base, state: 'done', body: s.since
    ? t(`Défini, sans changement depuis le ${day(s.since)}. Gardez-le fixe : le changer déconnecte tout le monde.`, `Set, unchanged since ${day(s.since)}. Keep it fixed: changing it signs everyone out.`)
    : t('Défini. Gardez-le fixe : le changer déconnecte tout le monde.', 'Set. Keep it fixed: changing it signs everyone out.') };
}

export default function GoLivePage() {
  const { t, loc } = useI18n();
  const { locations, can, locName } = useViewer();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ch, w, u, d, s, f, cat, ck] = await Promise.all([
        api<ChannelsData>('/api/foodhub/channels'),
        api<{ channels: Notify }>('/api/foodhub/watch/settings'),
        api<{ users: User[] }>('/api/foodhub/users'),
        api<{ devices: Device[] }>('/api/foodhub/devices'),
        api<{ stores: Store[] }>('/api/foodhub/stores'),
        api<{ fees: Fees }>('/api/foodhub/recon/fees').catch((): { fees: Fees } => ({ fees: { confirmed: {} } })),
        api<{ locations: Array<{ code: string; name: string; phone?: string | null; active: boolean }> }>('/api/foodhub/catalog'),
        api<CloverCheck>('/api/foodhub/clover-labels').catch((): CloverCheck => ({ report: null })),
      ]);
      const noPhone = cat.locations.filter((l) => l.active && !l.phone);
      const users = u.users.filter((x) => x.active);
      const owner = users.some((x) => x.role === 'owner' && (x.email || x.phone));
      const locNoManager = locations.filter((l) => !users.some((x) => (x.role === 'manager' || x.role === 'owner') && x.phone && x.hasPin && (!x.locations.length || x.locations.includes(l.code))));
      const locNoTablet = locations.filter((l) => !d.devices.some((x) => x.locationCode === l.code));
      const tabletsOff = d.devices.filter((x) => x.status !== 'online').length;
      const staffNoPin = users.filter((x) => x.role === 'operator' && !x.hasPin).length;
      const byCh = (k: string) => s.stores.filter((x) => x.channel === k).length;
      const ready = (k: string) => ch.channels.find((x) => x.channel === k);
      const unconfirmed = ['uber_eats', 'doordash', 'skip'].filter((k) => !f.fees.confirmed[k]);
      const list = (xs: Array<{ name: string }>) => xs.map((l) => shortLoc(l.name)).join(', ');

      const out: Step[] = [
        { group: t('Fondations', 'Foundations'), key: 'db', state: ch.mode === 'memory' ? 'todo' : 'done', title: t('Base de données Supabase', 'Supabase database'), body: ch.mode === 'memory' ? t('Mode démo : rien n’est gardé au redémarrage. Lancez npm run setup avec l’URL et la clé Supabase, puis exécutez INSTALL_ALL.sql.', 'Demo mode: nothing is kept across restarts. Run npm run setup with the Supabase URL and key, then run INSTALL_ALL.sql.') : t('Branchée.', 'Connected.'), href: '/settings/channels', cta: t('Voir', 'See') },
        { group: t('Fondations', 'Foundations'), key: 'secret', state: ch.dashboardProtected ? 'done' : 'todo', title: t('Mot de passe de secours (DASHBOARD_PASSWORD)', 'Recovery password (DASHBOARD_PASSWORD)'), body: ch.dashboardProtected ? t('Défini : connexion de secours « owner ».', 'Set: recovery sign-in as “owner”.') : t('Définissez DASHBOARD_PASSWORD (npm run setup ou l’hébergeur) : la connexion de secours « owner ». Obligatoire avant le mode direct, sinon la console se verrouille. Vous le tapez vous-même — jamais dans le clavardage.', 'Set DASHBOARD_PASSWORD (npm run setup or the hosting settings): the recovery sign-in as “owner”. Required before live mode, or the console locks itself. You type it yourself — never in chat.'), href: '/settings/channels', cta: t('Voir', 'See') },
        sessionSecretStep(ch, t, loc, Date.now()),
        ...alertSteps(w.channels, t),
        { group: t('Équipe', 'Team'), key: 'owner', state: owner ? 'done' : 'todo', title: t('Votre compte propriétaire', 'Your owner account'), body: owner ? t('Connexion par code, sans mot de passe.', 'Code sign-in, no password.') : t('Créez votre compte avec votre courriel ou cellulaire, puis ne gardez le mot de passe que pour le secours.', 'Create your account with your email or cell, then keep the password for recovery only.'), href: '/settings/team', cta: t('Ajouter', 'Add') },
        { group: t('Équipe', 'Team'), key: 'managers', state: locNoManager.length ? 'todo' : 'done', title: t('Un gérant joignable par succursale', 'A reachable manager per location'), body: locNoManager.length ? `${t('Sans gérant avec cellulaire et NIP :', 'No manager with cell and PIN:')} ${list(locNoManager)}` : t('Chaque succursale a un gérant avec cellulaire et NIP.', 'Every location has a manager with a cell and a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
        { group: t('Équipe', 'Team'), key: 'pins', state: staffNoPin ? 'warn' : 'done', title: t('NIP des employés', 'Staff PINs'), body: staffNoPin ? t(`${staffNoPin} employé(s) sans NIP — ils ne peuvent pas déverrouiller une tablette.`, `${staffNoPin} staff without a PIN — they cannot unlock a tablet.`) : t('Tous les employés ont un NIP.', 'All staff have a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
        { group: t('Cuisine', 'Kitchen'), key: 'tablets', state: locNoTablet.length ? 'todo' : tabletsOff ? 'warn' : 'done', title: t('Une tablette par cuisine', 'A tablet per kitchen'), body: locNoTablet.length ? `${t('Sans tablette :', 'No tablet:')} ${list(locNoTablet)}` : tabletsOff ? t(`${tabletsOff} tablette(s) hors ligne en ce moment.`, `${tabletsOff} tablet(s) offline right now.`) : t('Toutes en ligne.', 'All online.'), href: '/settings/devices', cta: t('Tablettes', 'Tablets') },
        { group: t('Cuisine', 'Kitchen'), key: 'kphone', state: noPhone.length ? 'warn' : 'done', title: t('Téléphone de chaque cuisine', 'Each kitchen’s phone'), body: noPhone.length ? `${t('La surveillance ne peut pas appeler :', 'The watchtower cannot call:')} ${list(noPhone)}` : t('La surveillance appelle la cuisine en premier, comme Uber.', 'The watchtower calls the kitchen first, like Uber.'), href: '/settings/business', cta: t('Ajouter', 'Add') },
        cloverStep(ch, t, locName),
        ...(['uber_eats', 'doordash', 'skip'] as const).map((k): Step => {
          const r = ready(k);
          const n = byCh(k);
          if (r?.viaClover) return { group: t('Plateformes', 'Platforms'), key: k, state: 'done', title: r.label, body: t('Relié par Clover : les commandes arrivent dans Clover et Food Hub les lit (lecture seule).', 'Linked through Clover: orders arrive in Clover and Food Hub reads them (read-only).'), href: '/settings/channels', cta: t('Voir', 'See') };
          // A partner pushing this platform's orders to the Food Hub Order Relay (FOODHUB_RELAY_CHANNELS) is a working path too.
          if (ch.relay?.channels.includes(k) && !(r?.configured && n)) return { group: t('Plateformes', 'Platforms'), key: k, state: 'done', title: r?.label ?? k, body: t('Par le relais de commandes Food Hub : un partenaire envoie ces commandes.', 'Through the Food Hub Order Relay: a partner sends these orders.'), href: '/settings/channels', cta: t('Voir', 'See') };
          return { group: t('Plateformes', 'Platforms'), key: k, state: r?.configured && n ? 'done' : 'todo', title: r?.label ?? k, body: !r?.configured ? `${t('Manque :', 'Missing:')} ${r?.missing.join(', ') || '—'}` : n ? t(`${n} magasin(s) jumelé(s).`, `${n} store(s) mapped.`) : t('Branché, mais aucun magasin jumelé.', 'Connected, but no store mapped.'), href: r?.configured ? '/stores/mapping' : '/settings/channels', cta: r?.configured ? t('Jumeler', 'Map') : t('Brancher', 'Connect') };
        }),
        ...cloverCheckSteps(ck, t),
        ...cloverAppSteps(ch.clover, t),
        { group: t('Argent', 'Money'), key: 'fees', state: unconfirmed.length ? 'warn' : 'done', title: t('Plans de commission confirmés', 'Commission plans confirmed'), body: unconfirmed.length ? `${t('À confirmer :', 'To confirm:')} ${unconfirmed.map((k) => ready(k)?.label ?? k).join(', ')}` : t('Conformes à vos contrats.', 'Match your contracts.'), href: '/money/fees', cta: t('Vérifier', 'Check') },
        { group: t('Ouverture', 'Opening'), key: 'live', state: ch.liveEnabled ? 'done' : 'todo', title: t('Mode direct', 'Live mode'), body: ch.liveEnabled ? t('Les actions partent vers les plateformes.', 'Actions are sent to the platforms.') : t('Dernière étape : LIVE_CONNECTORS_GLOBAL_ENABLED=true, quand tout le reste est vert.', 'Last step: LIVE_CONNECTORS_GLOBAL_ENABLED=true, once everything else is green.'), href: '/settings/channels', cta: t('Voir', 'See') },
      ];
      setSteps(out); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [locations, locName, loc, t]);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);
  const progress = goLiveProgress(steps ?? []);
  // One celebration when nothing is left to do: once per device (lib/ui/celebrate.ts), quiet under reduced motion.
  const celebrate = useCelebrateOnce(CELEBRATION_KEYS.goLive, Boolean(steps) && progress.complete);
  const [celebrationClosed, setCelebrationClosed] = useState(false);

  if (!can('admin')) return <div><SettingsHead title={t('Mise en service', 'Go-live')} /><Banner tone="info">{t('Réservé au propriétaire.', 'Owner only.')}</Banner></div>;
  const tally = stepTally(steps ?? []);
  const done = tally.done;
  const total = steps?.length ?? 1;
  const groups = steps ? [...new Set(steps.map((s) => s.group))] : [];
  const left = progress.todo;

  return (
    <div>
      <SettingsHead title={t('Mise en service', 'Go-live')} intro={t('Ce qui reste avant d’ouvrir les vannes. Chaque ligne se vérifie toute seule ; les clés sont posées par votre technicien dans l’hébergeur, jamais dans le clavardage.', 'What is left before switching everything on. Each line checks itself; your technician sets the keys in the hosting settings, never in chat.')}
        right={<Button variant="outline" loading={busy} onClick={load} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>} />
      <div className="max-w-4xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {steps && (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing size="lg" value={progress.percent / 100} label={t(`${progress.percent} %`, `${progress.percent}%`)}
              ariaLabel={t(`Prêt à ${progress.percent} % : ${progress.ready} étape(s) obligatoire(s) faite(s) sur ${progress.counted}`, `${progress.percent}% ready: ${progress.ready} of ${progress.counted} required step(s) done`)} />
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-heading text-ink">{progress.complete
                ? t('Tout est prêt pour ouvrir.', 'Everything is ready to open.')
                : t(`Encore ${left} étape${left > 1 ? 's' : ''} à faire avant d’ouvrir.`, `${left} step${left === 1 ? '' : 's'} left before opening.`)}</div>
              <div className="text-small mt-1 text-ink-3">{t(`${done}/${total} étapes prêtes`, `${done}/${total} steps ready`)} · {tallyLine(t, tally)}</div>
            </div>
          </div>
          <GoLiveStepper stages={goLiveStages(steps)} />
        </Card>
      )}
      {celebrate && !celebrationClosed && (
        <CelebrationBanner className="mb-5" title={t('Mise en service terminée !', 'Go-live complete!')}
          body={t('Plus rien à faire : chaque étape obligatoire est prête. Gardez un œil sur les lignes « À vérifier ».', 'Nothing left to do: every required step is ready. Keep an eye on the “To check” lines.')}
          onClose={() => setCelebrationClosed(true)} closeLabel={t('Fermer', 'Close')} />
      )}
      {!steps && !err && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}
      {groups.map((g, gi) => (
        <div key={g} id={`golive-${gi}`} className="mb-5 scroll-mt-24">
          <h2 className="text-heading mb-3 text-ink">{g}</h2>
          <Card>
            <ul className="divide-y divide-line">
              {steps!.filter((s) => s.group === g).map((s) => {
                const kind = stepKind(s);
                const badge = stepBadge(t, s);
                return (
                  <li key={s.key} className="flex flex-wrap items-start gap-3 px-5 py-4 sm:flex-nowrap">
                    {kind === 'done' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" aria-hidden />
                      : kind === 'check' ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-wait" aria-hidden />
                        : kind === 'optional' ? <CirclePlus className="mt-0.5 size-5 shrink-0 text-info-2" aria-hidden />
                          : <CircleDashed className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('text-body font-bold', kind === 'done' ? 'text-ink-2' : 'text-ink')}>{plainTitle(s.title)}</span>
                        <Badge tone={badge.tone}>{badge.word}</Badge>
                      </div>
                      <StepText step={s} />
                    </div>
                    {kind !== 'done' && <Link href={s.href} className="text-small ml-8 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-line-2 px-3 font-bold text-ink hover:bg-sunken sm:ml-0">{s.cta}<ChevronRight className="size-4" aria-hidden /></Link>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ))}
      </div>
    </div>
  );
}
