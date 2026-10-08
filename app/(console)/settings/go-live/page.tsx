'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner, Card } from '@/components/ui/card';
import { shortLoc, useViewer } from '@/components/shell/viewer';
import { SettingsHead } from '../settings-ui';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { PUBLIC_URL_PROBLEM_TEXT, type PublicUrlProblem } from '@/lib/foodhub/public-url';

type Readiness = { channel: string; label: string; configured: boolean; canSend: boolean; missing: string[]; viaClover?: boolean };
type CloverAppInfo = {
  configured: boolean; merchants: Array<{ status?: string }>;
  legalStatus?: { supportEmailSet: boolean; supportPhoneSet?: boolean; approved: boolean };
  domain?: { url: string; ready: boolean; problems: PublicUrlProblem[] };
};
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
type Step = { key: string; state: 'done' | 'todo' | 'warn'; title: string; body: string; href: string; cta: string; group: string };

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

/** Clover App Market app: domain, keys, webhook, public legal pages, merchants waiting for approval (optional group). */
function cloverAppSteps(ch: ChannelsData, t: (fr: string, en: string) => string): Step[] {
  const app = ch.clover.app;
  if (!app) return [];
  const g = t('Application Clover (App Market)', 'Clover app (App Market)');
  const pending = app.merchants.filter((m) => m.status === 'pending').length;
  const legal = app.legalStatus ?? { supportEmailSet: false, supportPhoneSet: false, approved: false };
  const hook = Boolean(ch.clover.webhookAuthSet && ch.clover.verification);
  const legalMissing = [!legal.supportEmailSet && 'FOODHUB_SUPPORT_EMAIL', !legal.supportPhoneSet && 'FOODHUB_SUPPORT_PHONE', !legal.approved && 'FOODHUB_LEGAL_APPROVED=true'].filter(Boolean).join(', ');
  const domain = app.domain;
  return [
    ...(domain ? [{ group: g, key: 'clover-domain', state: domain.ready ? 'done' as const : 'warn' as const, title: t('Votre propre domaine en HTTPS', 'Your own domain over HTTPS'),
      body: domain.ready ? t(`Site URL Clover : ${domain.url}`, `Clover Site URL: ${domain.url}`) : domain.problems.map((p) => t(PUBLIC_URL_PROBLEM_TEXT[p].fr, PUBLIC_URL_PROBLEM_TEXT[p].en)).join(' '),
      href: '/settings/clover-app', cta: t('Voir', 'See') }] : []),
    { group: g, key: 'clover-app', state: app.configured ? 'done' : 'warn', title: t('Clés de l’app Clover', 'Clover app keys'), body: app.configured ? t('Chaque marchand Clover se branche en un clic.', 'Each Clover merchant connects in one click.') : t('Optionnel : CLOVER_CLIENT_ID (l’App ID) et CLOVER_CLIENT_SECRET avec npm run setup.', 'Optional: CLOVER_CLIENT_ID (the App ID) and CLOVER_CLIENT_SECRET with npm run setup.'), href: '/settings/clover-app', cta: t('Voir', 'See') },
    { group: g, key: 'clover-hook', state: hook ? 'done' : 'warn', title: t('Webhook Clover vérifié', 'Clover webhook verified'), body: hook ? t('Ruptures instantanées et désinstallations reçues.', 'Instant sold-outs and uninstalls received.') : t('Développeur Clover → Webhooks : l’adresse de Réglages → Plateformes, événements Inventaire et App ; recollez le code de vérification, puis CLOVER_WEBHOOK_AUTH.', 'Clover developer → Webhooks: the URL from Settings → Platforms, events Inventory and App; paste back the verification code, then CLOVER_WEBHOOK_AUTH.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'legal', state: legalMissing ? 'warn' : 'done', title: t('Pages confidentialité, conditions, soutien', 'Privacy, terms and support pages'), body: legalMissing ? `${t('Brouillons publics à faire relire. Manque :', 'Public drafts to review. Missing:')} ${legalMissing}` : t('Prêtes pour la fiche Clover.', 'Ready for the Clover listing.'), href: '/legal/privacy', cta: t('Relire', 'Review') },
    { group: g, key: 'clover-listing', state: 'warn', title: t('Fiche App Market et soumission', 'App Market listing and submission'), body: t('Textes FR/EN, adresses à copier, vidéo fonctionnelle et ce qui reste à faire dans le tableau de bord Clover.', 'FR/EN texts, addresses to copy, functional video and what is left to do in the Clover dashboard.'), href: '/settings/clover-app', cta: t('Ouvrir', 'Open') },
    ...(pending ? [{ group: g, key: 'clover-pending', state: 'todo' as const, title: t('Marchands Clover en attente', 'Clover merchants waiting'), body: t(`${pending} marchand(s) ont ouvert l’app depuis Clover et attendent votre approbation.`, `${pending} merchant(s) opened the app from Clover and are waiting for your approval.`), href: '/settings/channels', cta: t('Approuver', 'Approve') }] : []),
  ];
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
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'email', state: w.channels.email ? 'done' : 'todo', title: t('Courriels de connexion (Resend)', 'Sign-in emails (Resend)'), body: w.channels.email ? t('Les codes partent par courriel.', 'Codes are sent by email.') : t('RESEND_API_KEY + AUTH_EMAIL_FROM, avec un domaine vérifié chez Resend.', 'RESEND_API_KEY + AUTH_EMAIL_FROM, with a domain verified at Resend.'), href: '/settings/alerts', cta: t('Tester', 'Test') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'sms', state: w.channels.sms && w.channels.call ? 'done' : 'todo', title: t('Textos et appels (Twilio)', 'Texts and calls (Twilio)'), body: w.channels.sms ? (w.channels.call ? t('Textos et appels d’alerte prêts.', 'Alert texts and calls ready.') : t('Textos prêts ; ajoutez TWILIO_FROM pour les appels.', 'Texts ready; add TWILIO_FROM for calls.')) : t('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM (un numéro canadien).', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Canadian number).'), href: '/settings/alerts', cta: t('Tester', 'Test') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'chat', state: w.channels.chat ? 'done' : 'warn', title: t('Clavardage de l’équipe', 'Team chat'), body: w.channels.chat ? t('Les alertes sont publiées.', 'Alerts are posted.') : t('Optionnel : ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).', 'Optional: ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).'), href: '/settings/alerts', cta: t('Voir', 'See') },
        { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'ai', state: w.channels.ai ? 'done' : 'warn', title: t('Surveillance IA (Claude)', 'AI watchtower (Claude)'), body: w.channels.ai ? t('Claude explique les alertes et répond au copilote.', 'Claude explains alerts and answers the copilot.') : t('Optionnel : ANTHROPIC_API_KEY. Sans clé, les règles intégrées expliquent les alertes.', 'Optional: ANTHROPIC_API_KEY. Without it, built-in rules explain alerts.'), href: '/settings/alerts', cta: t('Voir', 'See') },
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
        ...cloverAppSteps(ch, t),
        { group: t('Argent', 'Money'), key: 'fees', state: unconfirmed.length ? 'warn' : 'done', title: t('Plans de commission confirmés', 'Commission plans confirmed'), body: unconfirmed.length ? `${t('À confirmer :', 'To confirm:')} ${unconfirmed.map((k) => ready(k)?.label ?? k).join(', ')}` : t('Conformes à vos contrats.', 'Match your contracts.'), href: '/money/fees', cta: t('Vérifier', 'Check') },
        { group: t('Ouverture', 'Opening'), key: 'live', state: ch.liveEnabled ? 'done' : 'todo', title: t('Mode direct', 'Live mode'), body: ch.liveEnabled ? t('Les actions partent vers les plateformes.', 'Actions are sent to the platforms.') : t('Dernière étape : LIVE_CONNECTORS_GLOBAL_ENABLED=true, quand tout le reste est vert.', 'Last step: LIVE_CONNECTORS_GLOBAL_ENABLED=true, once everything else is green.'), href: '/settings/channels', cta: t('Voir', 'See') },
      ];
      setSteps(out); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [locations, locName, loc, t]);
  useEffect(() => { if (can('admin')) load(); }, [load, can]);

  if (!can('admin')) return <div><SettingsHead title={t('Mise en service', 'Go-live')} /><Banner tone="info">{t('Réservé au propriétaire.', 'Owner only.')}</Banner></div>;
  const done = steps?.filter((s) => s.state === 'done').length ?? 0;
  const total = steps?.length ?? 1;
  const groups = steps ? [...new Set(steps.map((s) => s.group))] : [];

  return (
    <div>
      <SettingsHead title={t('Mise en service', 'Go-live')} intro={t('Ce qui reste avant d’ouvrir les vannes. Chaque ligne se vérifie toute seule ; les clés se mettent avec npm run setup ou dans l’hébergeur, jamais dans le clavardage.', 'What is left before switching everything on. Each line checks itself; keys go in with npm run setup or the hosting settings, never in chat.')}
        right={<Button variant="outline" loading={busy} onClick={load} icon={<RefreshCw className="size-4" />}>{t('Revérifier', 'Re-check')}</Button>} />
      <div className="max-w-4xl">
      {err && <Banner tone="stop" className="mb-4">{err}</Banner>}
      {steps && (
        <Card className="mb-5 p-5">
          <div className="flex items-end justify-between gap-3">
            <div><div className="text-3xl font-extrabold text-ink num">{done}/{total}</div><div className="text-[13px] text-ink-3">{t('étapes prêtes', 'steps ready')}</div></div>
            <div className="text-right text-[13px] text-ink-3">{steps.filter((s) => s.state === 'todo').length} {t('à faire', 'to do')} · {steps.filter((s) => s.state === 'warn').length} {t('optionnelles', 'optional')}</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-go transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
        </Card>
      )}
      {!steps && !err && <div className="h-96 animate-pulse rounded-lg bg-sunken" />}
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <div className="mb-2 text-xs font-bold tracking-wide text-ink-3 uppercase">{g}</div>
          <Card>
            <ul className="divide-y divide-line">
              {steps!.filter((s) => s.group === g).map((s) => (
                <li key={s.key} className="flex items-start gap-3 px-5 py-3.5">
                  {s.state === 'done' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-go" /> : s.state === 'warn' ? <TriangleAlert className="mt-0.5 size-5 shrink-0 text-wait" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-ink-4" />}
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-bold', s.state === 'done' ? 'text-ink-2' : 'text-ink')}>{s.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{s.body}</div>
                  </div>
                  {s.state !== 'done' && <Link href={s.href} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-bold text-ink hover:bg-sunken">{s.cta}<ChevronRight className="size-4" /></Link>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}
      </div>
    </div>
  );
}
