// Pure core of Settings → Go-live (no React, no fetch) — unit-tested in node (tests/go-live.test.ts).
// The page loads the console's own APIs; this turns them into the checklist. A green row means the thing really works,
// not merely that a key exists:
//  - Clover is done only when at least one merchant can receive orders: CLOVER_MERCHANT_ID + CLOVER_ACCESS_TOKEN, a
//    CLOVER_MERCHANT_TOKENS entry, or a merchant connected through the Clover app (approved, access not expired).
//    The app keys alone connect nobody.
//  - A platform is done when it is connected directly with a store mapped, linked through Clover, or reached through
//    the Food Hub Order Relay (in FOODHUB_RELAY_CHANNELS, with a store mapped as "relay:<id>"), labelled as such.
//    Direct AND relay at once is flagged: the same order would arrive twice.
//  - DASHBOARD_PASSWORD and SESSION_SECRET are both required; SESSION_SECRET must also be long and stable.
//  - 'info' rows cannot be checked from here (the outside uptime monitor): shown, never counted in the progress.
import type { T } from '../i18n';

export type StepState = 'done' | 'todo' | 'warn' | 'info';
export type Step = { key: string; state: StepState; title: string; body: string; href: string; cta: string; group: string; external?: boolean };

type Readiness = { channel: string; label: string; configured: boolean; canSend: boolean; missing: string[]; viaClover?: boolean };
type CloverAppInfo = { configured: boolean; merchants: Array<{ merchantId?: string; status?: string; needsReconnect?: boolean }>; legalStatus?: { supportEmailSet: boolean; approved: boolean } };
type SessionSecretInfo = { source: 'env' | 'password' | 'dev' | null; set: boolean; strong: boolean; since: string | null; changedAt: string | null };
export type ChannelsData = {
  mode: string; publicUrl?: string; liveEnabled: boolean; dashboardProtected: boolean;
  clover: { configured: boolean; missing: string[]; webhookAuthSet?: boolean; verification?: { code: string } | null; app?: CloverAppInfo };
  channels: Readiness[];
  relay?: { webhookReady: boolean; callbackReady: boolean; channels: string[] };
  goLive?: { clover: { envMerchantIds: string[]; tokenMapInvalid: boolean; injectionEnabled: boolean }; sessionSecret: SessionSecretInfo };
};
export type Notify = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };
export type User = { username: string; name: string; role: string; locations: string[]; email: string | null; phone: string | null; active: boolean; hasPin: boolean };
export type Device = { id: string; locationCode: string; status: string };
export type Store = { channel: string; channelStoreId?: string; brandName: string; locationCode: string };
export type Fees = { confirmed: Record<string, boolean> };
export type CloverCheck = { report: { ok: boolean; unprintedCount: number; items: number; kitchenLabels: unknown[] } | null; taxes?: { ok: boolean; problems: string[]; problemsFr?: string[]; defaultPercent: number } };
type Loc = { code: string; name: string };

export type GoLiveInput = {
  channels: ChannelsData; notify: Notify; users: User[]; devices: Device[]; stores: Store[]; fees: Fees; cloverCheck: CloverCheck;
  /** Brands & Locations (phones). */
  catalog: Array<Loc & { phone?: string | null; active: boolean }>;
  /** Locations the viewer sees. */
  locations: Loc[];
  now?: number;
};

/** Where the outside uptime monitor is explained (Part B, step 10). */
export const BACK_ONLINE_DOC_URL = 'https://github.com/takatakca/foodhubca/blob/main/docs/BACK_ONLINE_TODAY.md';
/** A changed SESSION_SECRET is pointed out for this long. */
export const SECRET_CHANGE_WARN_MS = 7 * 86_400_000;
const RELAY_STORE_PREFIX = 'relay:'; // same as lib/foodhub/adapters/relay.ts (server module)

const shortLoc = (name: string) => name.split(' — ')[0]; // same as components/shell/viewer.tsx
const day = (iso: string, t: T) => new Date(iso).toLocaleDateString(t('fr-CA', 'en-CA'), { day: 'numeric', month: 'long', year: 'numeric' });

/** Clover register check: kitchen printing labels and tax rates (read from Clover). */
function cloverCheckSteps(ck: CloverCheck, t: T): Step[] {
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

/** Clover App Market app: keys, webhook, public legal pages, merchants waiting for approval (optional group). */
function cloverAppSteps(ch: ChannelsData, t: T): Step[] {
  const app = ch.clover.app;
  if (!app) return [];
  const g = t('Application Clover (App Market)', 'Clover app (App Market)');
  const pending = app.merchants.filter((m) => m.status === 'pending').length;
  const legal = app.legalStatus ?? { supportEmailSet: false, approved: false };
  const hook = Boolean(ch.clover.webhookAuthSet && ch.clover.verification);
  const legalMissing = [!legal.supportEmailSet && 'FOODHUB_SUPPORT_EMAIL', !legal.approved && 'FOODHUB_LEGAL_APPROVED=true'].filter(Boolean).join(', ');
  return [
    { group: g, key: 'clover-app', state: app.configured ? 'done' : 'warn', title: t('Clés de l’app Clover', 'Clover app keys'), body: app.configured ? t('Chaque marchand Clover se branche en un clic.', 'Each Clover merchant connects in one click.') : t('Optionnel : CLOVER_CLIENT_ID (App ID 629HFYHNVMZYR) et CLOVER_CLIENT_SECRET avec npm run setup.', 'Optional: CLOVER_CLIENT_ID (App ID 629HFYHNVMZYR) and CLOVER_CLIENT_SECRET with npm run setup.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'clover-hook', state: hook ? 'done' : 'warn', title: t('Webhook Clover vérifié', 'Clover webhook verified'), body: hook ? t('Ruptures instantanées et désinstallations reçues.', 'Instant sold-outs and uninstalls received.') : t('Développeur Clover → Webhooks : l’adresse de Réglages → Plateformes, événements Inventaire et App ; recollez le code de vérification, puis CLOVER_WEBHOOK_AUTH.', 'Clover developer → Webhooks: the URL from Settings → Platforms, events Inventory and App; paste back the verification code, then CLOVER_WEBHOOK_AUTH.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'legal', state: legalMissing ? 'warn' : 'done', title: t('Pages confidentialité, conditions, soutien', 'Privacy, terms and support pages'), body: legalMissing ? `${t('Brouillons publics à faire relire. Manque :', 'Public drafts to review. Missing:')} ${legalMissing}` : t('Prêtes pour la fiche Clover.', 'Ready for the Clover listing.'), href: '/legal/privacy', cta: t('Relire', 'Review') },
    ...(pending ? [{ group: g, key: 'clover-pending', state: 'todo' as const, title: t('Marchands Clover en attente', 'Clover merchants waiting'), body: t(`${pending} marchand(s) ont ouvert l’app depuis Clover et attendent votre approbation.`, `${pending} merchant(s) opened the app from Clover and are waiting for your approval.`), href: '/settings/channels', cta: t('Approuver', 'Approve') }] : []),
  ];
}

/** Clover: done only when at least one merchant can really receive orders (an env token, or an app merchant that works). */
export function cloverStep(ch: ChannelsData, t: T): Step {
  const base = { group: t('Plateformes', 'Platforms'), key: 'clover', title: 'Clover', href: '/settings/channels' };
  const facts = ch.goLive?.clover ?? { envMerchantIds: [], tokenMapInvalid: false, injectionEnabled: true };
  if (!facts.injectionEnabled) {
    return { ...base, state: 'warn', cta: t('Voir', 'See'), body: t('Éteint (FOODHUB_POS_INJECTION=off) : les commandes ne vont pas dans Clover et sont acceptées sans lui.', 'Turned off (FOODHUB_POS_INJECTION=off): orders do not go into Clover and are accepted without it.') };
  }
  // A merchant with an env token is counted once, from the env (cloverToken tries it first, so an expired app
  // connection does not matter for it).
  const env = new Set(facts.envMerchantIds);
  const merchants = ch.clover.app?.merchants ?? [];
  const approved = merchants.filter((m) => m.status !== 'pending' && !env.has(m.merchantId ?? ''));
  const viaApp = approved.filter((m) => !m.needsReconnect).length;
  const expired = approved.length - viaApp;
  const pending = merchants.filter((m) => m.status === 'pending').length;
  const usable = env.size + viaApp;
  const from = [env.size && t(`${env.size} par les variables du serveur`, `${env.size} from the server settings`), viaApp && t(`${viaApp} par l’app Clover`, `${viaApp} through the Clover app`)].filter(Boolean).join(', ');
  const reconnect = t(`${expired} marchand(s) de l’app Clover à rebrancher (accès expiré) : leurs commandes ne peuvent pas entrer dans Clover.`, `${expired} Clover app merchant(s) to reconnect (access expired): their orders cannot get into Clover.`);
  if (usable && !expired) return { ...base, state: 'done', cta: t('Voir', 'See'), body: t(`Les commandes vont dans la caisse : ${usable} marchand(s) prêt(s) (${from}).`, `Orders go into the register: ${usable} merchant(s) ready (${from}).`) };
  if (usable) return { ...base, state: 'todo', cta: t('Rebrancher', 'Reconnect'), body: `${reconnect} ${t(`Prêt(s) : ${usable} (${from}).`, `Ready: ${usable} (${from}).`)}` };
  const why = [
    facts.tokenMapInvalid && t('CLOVER_MERCHANT_TOKENS est illisible (il faut un objet JSON comme {"MERCHANT_ID":"jeton"}).', 'CLOVER_MERCHANT_TOKENS cannot be read (it must be a JSON object such as {"MERCHANT_ID":"token"}).'),
    expired && reconnect,
    pending && t(`${pending} marchand(s) attendent votre approbation.`, `${pending} merchant(s) waiting for your approval.`),
    ch.clover.app?.configured
      ? t('Les clés de l’app Clover sont en place, mais aucun marchand n’est branché : « Brancher un marchand Clover » dans Réglages → Plateformes.', 'The Clover app keys are set, but no merchant is connected: “Connect a Clover merchant” in Settings → Platforms.')
      : t('Manque : CLOVER_MERCHANT_ID + CLOVER_ACCESS_TOKEN, ou CLOVER_MERCHANT_TOKENS, ou un marchand branché par l’app Clover.', 'Missing: CLOVER_MERCHANT_ID + CLOVER_ACCESS_TOKEN, or CLOVER_MERCHANT_TOKENS, or a merchant connected through the Clover app.'),
  ].filter(Boolean).join(' ');
  return { ...base, state: 'todo', cta: t('Brancher', 'Connect'), body: why };
}

/**
 * Uber Eats / DoorDash / Skip: linked through Clover, connected directly with a store mapped, or reached through the
 * Food Hub Order Relay with a "relay:<id>" store mapped. A relay store never makes the direct connection count (and
 * the reverse), and both paths at once is a to-do: each order would come in twice.
 */
export function platformStep(k: string, ch: ChannelsData, stores: Store[], t: T): Step {
  const group = t('Plateformes', 'Platforms');
  const r = ch.channels.find((x) => x.channel === k);
  const label = r?.label ?? k;
  if (r?.viaClover) return { group, key: k, state: 'done', title: label, body: t('Relié par Clover : les commandes arrivent dans Clover et Food Hub les lit (lecture seule).', 'Linked through Clover: orders arrive in Clover and Food Hub reads them (read-only).'), href: '/settings/channels', cta: t('Voir', 'See') };
  const mine = stores.filter((s) => s.channel === k);
  const relayN = mine.filter((s) => String(s.channelStoreId ?? '').startsWith(RELAY_STORE_PREFIX)).length;
  const directN = mine.length - relayN;
  const viaRelay = Boolean(ch.relay?.channels.includes(k));
  if (r?.configured && viaRelay) {
    return { group, key: k, state: 'todo', title: label, href: '/settings/channels', cta: t('Voir', 'See'),
      body: t(`Branché en direct ET accepté par le relais de commandes (FOODHUB_RELAY_CHANNELS) : chaque commande peut arriver deux fois. Gardez un seul chemin : retirez ${k} de FOODHUB_RELAY_CHANNELS, ou les clés directes.`, `Connected directly AND accepted through the Order Relay (FOODHUB_RELAY_CHANNELS): each order can come in twice. Keep one path: remove ${k} from FOODHUB_RELAY_CHANNELS, or the direct keys.`) };
  }
  if (r?.configured) {
    return { group, key: k, state: directN ? 'done' : 'todo', title: label, body: directN ? t(`${directN} magasin(s) jumelé(s).`, `${directN} store(s) mapped.`) : t('Branché, mais aucun magasin jumelé.', 'Connected, but no store mapped.'), href: '/stores/mapping', cta: t('Jumeler', 'Map') };
  }
  if (viaRelay) {
    const title = `${label} · ${t('relais de commandes Food Hub', 'Food Hub Order Relay')}`;
    if (!ch.relay?.webhookReady) return { group, key: k, state: 'todo', title, href: '/settings/channels', cta: t('Voir', 'See'), body: t('L’adresse du relais n’est pas prête : FOODHUB_RELAY_SECRET manque (il se crée au démarrage du serveur avec la base de données).', 'The relay address is not ready: FOODHUB_RELAY_SECRET is missing (it is created when the server starts with the database).') };
    return relayN
      ? { group, key: k, state: 'done', title, href: '/stores/mapping', cta: t('Voir', 'See'), body: t(`Les commandes ${label} arrivent par le relais de commandes Food Hub : ${relayN} magasin(s) jumelé(s) (relay:<id>). Menus, ruptures et pauses se font chez le partenaire.`, `${label} orders come through the Food Hub Order Relay: ${relayN} store(s) mapped (relay:<id>). Menus, 86s and pauses are done on the partner’s side.`) }
      : { group, key: k, state: 'todo', title, href: '/stores/mapping', cta: t('Jumeler', 'Map'), body: t('Accepté par le relais, mais aucun magasin jumelé sous relay:<id> : ses commandes attendent un jumelage.', 'Accepted through the relay, but no store mapped as relay:<id>: its orders wait for a mapping.') };
  }
  const relayHint = k === 'skip' ? ` ${t('Ou : un partenaire envoie les commandes Skip par le relais de commandes Food Hub (FOODHUB_RELAY_CHANNELS=skip,tgtg).', 'Or: a partner sends Skip orders through the Food Hub Order Relay (FOODHUB_RELAY_CHANNELS=skip,tgtg).')}` : '';
  return { group, key: k, state: 'todo', title: label, body: `${t('Manque :', 'Missing:')} ${r?.missing.join(', ') || '—'}${relayHint}`, href: '/settings/channels', cta: t('Brancher', 'Connect') };
}

/** SESSION_SECRET: required (set, long), and stable — a recent change is pointed out. Never generated at runtime. */
export function sessionSecretStep(ch: ChannelsData, t: T, now = Date.now()): Step {
  const base = { group: t('Fondations', 'Foundations'), key: 'session-secret', title: t('Secret de session (SESSION_SECRET)', 'Session secret (SESSION_SECRET)'), href: '/settings/channels', cta: t('Voir', 'See') };
  const s = ch.goLive?.sessionSecret;
  const add = t('Ajoutez-le dans l’hébergeur (openssl rand -hex 32, ou npm run setup) et gardez-le fixe — tapé par vous, jamais dans le clavardage.', 'Add it in the hosting settings (openssl rand -hex 32, or npm run setup) and keep it fixed — typed by you, never in chat.');
  if (!s?.set) {
    const why = s?.source === 'password'
      ? t('Manque : les sessions sont signées avec une clé tirée de DASHBOARD_PASSWORD, donc changer ce mot de passe déconnecte tout le monde, tablettes de cuisine comprises.', 'Missing: sessions are signed with a key derived from DASHBOARD_PASSWORD, so changing that password signs everyone out, kitchen tablets included.')
      : t('Manque : une clé de développement signe les sessions ; en production, sans lui ni DASHBOARD_PASSWORD, chaque écran affiche « Locked ».', 'Missing: a development key signs sessions; in production, without it or DASHBOARD_PASSWORD, every screen says “Locked”.');
    return { ...base, state: 'todo', body: `${why} ${add}` };
  }
  if (!s.strong) return { ...base, state: 'todo', body: `${t('Trop court (moins de 32 caractères).', 'Too short (under 32 characters).')} ${add}` };
  if (s.changedAt && now - Date.parse(s.changedAt) < SECRET_CHANGE_WARN_MS) {
    return { ...base, state: 'warn', body: t(`A changé le ${day(s.changedAt, t)} : tout le monde a dû se reconnecter, tablettes comprises. Si ce n’est pas vous, l’hébergeur en crée un nouveau à chaque déploiement : mettez une valeur fixe.`, `Changed on ${day(s.changedAt, t)}: everyone had to sign in again, tablets included. If that was not you, the host makes a new one at each deploy: set a fixed value.`) };
  }
  return { ...base, state: 'done', body: s.since
    ? t(`Défini, sans changement depuis le ${day(s.since, t)}. Gardez-le fixe : le changer déconnecte tout le monde.`, `Set, unchanged since ${day(s.since, t)}. Keep it fixed: changing it signs everyone out.`)
    : t('Défini. Gardez-le fixe : le changer déconnecte tout le monde.', 'Set. Keep it fixed: changing it signs everyone out.') };
}

/** Outside uptime monitor on /api/health: cannot be checked from inside the server it watches. */
export function uptimeStep(ch: ChannelsData, t: T): Step {
  const url = `${(ch.publicUrl || t('https://<domaine>', 'https://<domain>')).replace(/\/+$/, '')}/api/health`;
  return { group: t('Ouverture', 'Opening'), key: 'uptime', state: 'info', title: t('Surveillance externe sur /api/health (optionnel)', 'Uptime monitor on /api/health (optional)'),
    body: t(`Impossible à vérifier d’ici : la surveillance interne ne peut pas signaler la panne de son propre serveur. Un moniteur gratuit (UptimeRobot, Better Stack) sur ${url} vous texte et vous écrit s’il ne répond plus — docs/BACK_ONLINE_TODAY.md, partie B, étape 10.`, `Cannot be checked from here: the built-in watchtower cannot report its own server going down. A free monitor (UptimeRobot, Better Stack) on ${url} texts and emails you when it stops answering — docs/BACK_ONLINE_TODAY.md, Part B step 10.`),
    href: BACK_ONLINE_DOC_URL, external: true, cta: t('Guide', 'Guide') };
}

/** The whole checklist, in display order. */
export function goLiveSteps(input: GoLiveInput, t: T): Step[] {
  const { channels: ch, notify: w, devices, stores, fees, cloverCheck, locations } = input;
  const now = input.now ?? Date.now();
  const noPhone = input.catalog.filter((l) => l.active && !l.phone);
  const users = input.users.filter((x) => x.active);
  const owner = users.some((x) => x.role === 'owner' && (x.email || x.phone));
  const locNoManager = locations.filter((l) => !users.some((x) => (x.role === 'manager' || x.role === 'owner') && x.phone && x.hasPin && (!x.locations.length || x.locations.includes(l.code))));
  const locNoTablet = locations.filter((l) => !devices.some((x) => x.locationCode === l.code));
  const tabletsOff = devices.filter((x) => x.status !== 'online').length;
  const staffNoPin = users.filter((x) => x.role === 'operator' && !x.hasPin).length;
  const label = (k: string) => ch.channels.find((x) => x.channel === k)?.label ?? k;
  const unconfirmed = ['uber_eats', 'doordash', 'skip'].filter((k) => !fees.confirmed[k]);
  const list = (xs: Loc[]) => xs.map((l) => shortLoc(l.name)).join(', ');

  return [
    { group: t('Fondations', 'Foundations'), key: 'db', state: ch.mode === 'memory' ? 'todo' : 'done', title: t('Base de données Supabase', 'Supabase database'), body: ch.mode === 'memory' ? t('Mode démo : rien n’est gardé au redémarrage. Lancez npm run setup avec l’URL et la clé Supabase, puis exécutez INSTALL_ALL.sql.', 'Demo mode: nothing is kept across restarts. Run npm run setup with the Supabase URL and key, then run INSTALL_ALL.sql.') : t('Branchée.', 'Connected.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: t('Fondations', 'Foundations'), key: 'secret', state: ch.dashboardProtected ? 'done' : 'todo', title: t('Mot de passe de secours (DASHBOARD_PASSWORD)', 'Recovery password (DASHBOARD_PASSWORD)'), body: ch.dashboardProtected ? t('Défini : connexion de secours « owner ».', 'Set: recovery sign-in as “owner”.') : t('Définissez DASHBOARD_PASSWORD (npm run setup ou l’hébergeur) : la connexion de secours « owner ». Obligatoire avant le mode direct, sinon la console se verrouille. Vous le tapez vous-même — jamais dans le clavardage.', 'Set DASHBOARD_PASSWORD (npm run setup or the hosting settings): the recovery sign-in as “owner”. Required before live mode, or the console locks itself. You type it yourself — never in chat.'), href: '/settings/channels', cta: t('Voir', 'See') },
    sessionSecretStep(ch, t, now),
    { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'email', state: w.email ? 'done' : 'todo', title: t('Courriels de connexion (Resend)', 'Sign-in emails (Resend)'), body: w.email ? t('Les codes partent par courriel.', 'Codes are sent by email.') : t('RESEND_API_KEY + AUTH_EMAIL_FROM, avec un domaine vérifié chez Resend.', 'RESEND_API_KEY + AUTH_EMAIL_FROM, with a domain verified at Resend.'), href: '/settings/alerts', cta: t('Tester', 'Test') },
    { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'sms', state: w.sms && w.call ? 'done' : 'todo', title: t('Textos et appels (Twilio)', 'Texts and calls (Twilio)'), body: w.sms ? (w.call ? t('Textos et appels d’alerte prêts.', 'Alert texts and calls ready.') : t('Textos prêts ; ajoutez TWILIO_FROM pour les appels.', 'Texts ready; add TWILIO_FROM for calls.')) : t('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM (un numéro canadien).', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Canadian number).'), href: '/settings/alerts', cta: t('Tester', 'Test') },
    { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'chat', state: w.chat ? 'done' : 'warn', title: t('Clavardage de l’équipe', 'Team chat'), body: w.chat ? t('Les alertes sont publiées.', 'Alerts are posted.') : t('Optionnel : ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).', 'Optional: ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).'), href: '/settings/alerts', cta: t('Voir', 'See') },
    { group: t('Connexion et alertes', 'Sign-in & alerts'), key: 'ai', state: w.ai ? 'done' : 'warn', title: t('Surveillance IA (Claude)', 'AI watchtower (Claude)'), body: w.ai ? t('Claude explique les alertes et répond au copilote.', 'Claude explains alerts and answers the copilot.') : t('Optionnel : ANTHROPIC_API_KEY. Sans clé, les règles intégrées expliquent les alertes.', 'Optional: ANTHROPIC_API_KEY. Without it, built-in rules explain alerts.'), href: '/settings/alerts', cta: t('Voir', 'See') },
    { group: t('Équipe', 'Team'), key: 'owner', state: owner ? 'done' : 'todo', title: t('Votre compte propriétaire', 'Your owner account'), body: owner ? t('Connexion par code, sans mot de passe.', 'Code sign-in, no password.') : t('Créez votre compte avec votre courriel ou cellulaire, puis ne gardez le mot de passe que pour le secours.', 'Create your account with your email or cell, then keep the password for recovery only.'), href: '/settings/team', cta: t('Ajouter', 'Add') },
    { group: t('Équipe', 'Team'), key: 'managers', state: locNoManager.length ? 'todo' : 'done', title: t('Un gérant joignable par succursale', 'A reachable manager per location'), body: locNoManager.length ? `${t('Sans gérant avec cellulaire et NIP :', 'No manager with cell and PIN:')} ${list(locNoManager)}` : t('Chaque succursale a un gérant avec cellulaire et NIP.', 'Every location has a manager with a cell and a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
    { group: t('Équipe', 'Team'), key: 'pins', state: staffNoPin ? 'warn' : 'done', title: t('NIP des employés', 'Staff PINs'), body: staffNoPin ? t(`${staffNoPin} employé(s) sans NIP — ils ne peuvent pas déverrouiller une tablette.`, `${staffNoPin} staff without a PIN — they cannot unlock a tablet.`) : t('Tous les employés ont un NIP.', 'All staff have a PIN.'), href: '/settings/team', cta: t('Équipe', 'Team') },
    { group: t('Cuisine', 'Kitchen'), key: 'tablets', state: locNoTablet.length ? 'todo' : tabletsOff ? 'warn' : 'done', title: t('Une tablette par cuisine', 'A tablet per kitchen'), body: locNoTablet.length ? `${t('Sans tablette :', 'No tablet:')} ${list(locNoTablet)}` : tabletsOff ? t(`${tabletsOff} tablette(s) hors ligne en ce moment.`, `${tabletsOff} tablet(s) offline right now.`) : t('Toutes en ligne.', 'All online.'), href: '/settings/devices', cta: t('Tablettes', 'Tablets') },
    { group: t('Cuisine', 'Kitchen'), key: 'kphone', state: noPhone.length ? 'warn' : 'done', title: t('Téléphone de chaque cuisine', 'Each kitchen’s phone'), body: noPhone.length ? `${t('La surveillance ne peut pas appeler :', 'The watchtower cannot call:')} ${list(noPhone)}` : t('La surveillance appelle la cuisine en premier, comme Uber.', 'The watchtower calls the kitchen first, like Uber.'), href: '/settings/business', cta: t('Ajouter', 'Add') },
    cloverStep(ch, t),
    ...(['uber_eats', 'doordash', 'skip'] as const).map((k) => platformStep(k, ch, stores, t)),
    ...cloverCheckSteps(cloverCheck, t),
    ...cloverAppSteps(ch, t),
    { group: t('Argent', 'Money'), key: 'fees', state: unconfirmed.length ? 'warn' : 'done', title: t('Plans de commission confirmés', 'Commission plans confirmed'), body: unconfirmed.length ? `${t('À confirmer :', 'To confirm:')} ${unconfirmed.map(label).join(', ')}` : t('Conformes à vos contrats.', 'Match your contracts.'), href: '/money/fees', cta: t('Vérifier', 'Check') },
    uptimeStep(ch, t),
    { group: t('Ouverture', 'Opening'), key: 'live', state: ch.liveEnabled ? 'done' : 'todo', title: t('Mode direct', 'Live mode'), body: ch.liveEnabled ? t('Les actions partent vers les plateformes.', 'Actions are sent to the platforms.') : t('Dernière étape : LIVE_CONNECTORS_GLOBAL_ENABLED=true, quand tout le reste est vert.', 'Last step: LIVE_CONNECTORS_GLOBAL_ENABLED=true, once everything else is green.'), href: '/settings/channels', cta: t('Voir', 'See') },
  ];
}

/** Progress counts: 'info' rows (cannot be checked) are left out, so 100 % stays reachable. */
export function goLiveProgress(steps: Step[]) {
  const counted = steps.filter((s) => s.state !== 'info');
  return {
    done: counted.filter((s) => s.state === 'done').length,
    total: counted.length,
    todo: counted.filter((s) => s.state === 'todo').length,
    optional: counted.filter((s) => s.state === 'warn').length,
  };
}
