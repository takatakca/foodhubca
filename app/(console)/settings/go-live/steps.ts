// Settings → Go-live: how a step reads for the owner (premium A3), and the steps whose wording matters most.
//   - « Prêt » (done), « À faire » (todo), « À vérifier » (warn: something to look at, e.g. staff without a PIN, a
//     session secret that just changed) and « Optionnel » (warn + optional: nothing breaks without it, e.g. the team
//     chat or the AI explanations). An optional step keeps that word in view even when its text is all setting names.
//   - The sentences with a setting name or a command fold under « Détails techniques » (tech-text.ts splitTech).
//   - The progress ring and the stepper (goLiveProgress, goLiveStages) count what is left « À faire »: 100 % = nothing.
import type { T } from '@/lib/i18n';
import { PUBLIC_URL_PROBLEM_TEXT, type PublicUrlProblem } from '@/lib/foodhub/public-url';
import type { PlatformScreen, ScreenStatus } from '@/lib/foodhub/screens';
import type { RuleSetting } from '@/lib/foodhub/watch/types';
import { plainTitle, splitTech } from '../tech-text';

export type Step = { key: string; state: 'done' | 'todo' | 'warn'; title: string; body: string; href: string; cta: string; group: string; optional?: boolean };
export type StepKind = 'done' | 'todo' | 'check' | 'optional';

export function stepKind(s: Pick<Step, 'state' | 'optional'>): StepKind {
  return s.state === 'done' ? 'done' : s.state === 'todo' ? 'todo' : s.optional ? 'optional' : 'check';
}

/** The word on a step's badge: never a colour alone. */
export function stepBadge(t: T, s: Pick<Step, 'state' | 'optional'>): { tone: 'go' | 'neutral' | 'wait' | 'info'; word: string } {
  switch (stepKind(s)) {
    case 'done': return { tone: 'go', word: t('Prêt', 'Ready') };
    case 'todo': return { tone: 'neutral', word: t('À faire', 'To do') };
    case 'optional': return { tone: 'info', word: t('Optionnel', 'Optional') };
    default: return { tone: 'wait', word: t('À vérifier', 'To check') };
  }
}

export function stepTally(steps: Array<Pick<Step, 'state' | 'optional'>>): Record<StepKind, number> {
  const out: Record<StepKind, number> = { done: 0, todo: 0, check: 0, optional: 0 };
  for (const s of steps) out[stepKind(s)] += 1;
  return out;
}

export type GoLiveProgress = { percent: number; ready: number; counted: number; todo: number; complete: boolean };

/**
 * The Go-live ring (Phase 3 P2): of the steps that must be done, the share that is done. A step « À vérifier » or
 * « Optionnel » never holds the ring back (nothing breaks without it) and counts once it is done. 100 % means nothing
 * is left « À faire », and only then: 99.6 % shows 99 %.
 */
export function goLiveProgress(steps: Array<Pick<Step, 'state'>>): GoLiveProgress {
  const counted = steps.filter((s) => s.state !== 'warn');
  const ready = counted.filter((s) => s.state === 'done').length;
  const todo = counted.length - ready;
  const complete = counted.length > 0 && todo === 0;
  const percent = complete ? 100 : counted.length ? Math.floor((ready / counted.length) * 100) : 0;
  return { percent, ready, counted: counted.length, todo, complete };
}

/** done: all ready · check: nothing to do, something to look at · current: the first group with something to do. */
export type GoLiveStage = { group: string; state: 'done' | 'check' | 'current' | 'todo'; ready: number; counted: number };

/** The stepper above the list: one stage per group, in page order. */
export function goLiveStages(steps: Array<Pick<Step, 'group' | 'state' | 'optional'>>): GoLiveStage[] {
  let seenCurrent = false;
  return [...new Set(steps.map((s) => s.group))].map((group) => {
    const mine = steps.filter((s) => s.group === group);
    const p = goLiveProgress(mine);
    let state: GoLiveStage['state'];
    if (p.todo) { state = seenCurrent ? 'todo' : 'current'; seenCurrent = true; }
    else state = mine.some((s) => stepKind(s) === 'check') ? 'check' : 'done';
    return { group, state, ready: p.ready, counted: p.counted };
  });
}

/** "3 à faire · 1 à vérifier · 2 optionnels": the counter above the list. */
export function tallyLine(t: T, n: Record<StepKind, number>): string {
  const parts = [t(`${n.todo} à faire`, `${n.todo} to do`), t(`${n.check} à vérifier`, `${n.check} to check`)];
  if (n.optional) parts.push(t(`${n.optional} ${n.optional === 1 ? 'optionnel' : 'optionnels'}`, `${n.optional} optional`));
  return parts.join(' · ');
}

/**
 * A step's text for the owner: its plain sentences stay in view; the sentences with a setting name or a command fold
 * under « Détails techniques » (with the title when it names a setting). A step that is all technical says, in one
 * plain sentence, that the technician sets it on the server, and that it is optional when it is.
 */
export function stepText(t: T, s: Pick<Step, 'state' | 'optional' | 'title' | 'body'>): { plain: string; tech: string } {
  const { plain, tech } = splitTech(s.body);
  const titleTech = plainTitle(s.title) !== s.title;
  const fallback = s.state === 'done' ? t('Réglé sur le serveur.', 'Set on the server.')
    : s.state === 'warn' && s.optional ? t('Optionnel : un réglage du serveur, fait par votre technicien si vous le voulez.', 'Optional: a server setting, done by your technician if you want it.')
      : t('Un réglage du serveur, fait par votre technicien.', 'A server setting, done by your technician.');
  return { plain: plain || fallback, tech: tech || titleTech ? `${s.title}${tech ? ` — ${tech}` : ''}` : '' };
}

type Notify = { email: boolean; sms: boolean; call: boolean; chat: boolean; ai: boolean };

/** Sign-in emails and texts are needed; the team chat and the AI explanations are optional. */
export function alertSteps(n: Notify, t: T): Step[] {
  const g = t('Connexion et alertes', 'Sign-in & alerts');
  return [
    { group: g, key: 'email', state: n.email ? 'done' : 'todo', title: t('Courriels de connexion (SMTP ou Resend)', 'Sign-in emails (SMTP or Resend)'), body: n.email ? t('Les codes partent par courriel.', 'Codes are sent by email.') : t('SMTP_HOST + SMTP_USER + SMTP_PASS (votre boîte courriel) ou RESEND_API_KEY (domaine vérifié chez Resend), plus AUTH_EMAIL_FROM.', 'SMTP_HOST + SMTP_USER + SMTP_PASS (your own mailbox) or RESEND_API_KEY (domain verified at Resend), plus AUTH_EMAIL_FROM.'), href: '/settings/alerts', cta: t('Tester', 'Test') },
    { group: g, key: 'sms', state: n.sms && n.call ? 'done' : 'todo', title: t('Textos et appels (Twilio)', 'Texts and calls (Twilio)'), body: n.sms ? (n.call ? t('Textos et appels d’alerte prêts.', 'Alert texts and calls ready.') : t('Textos prêts ; ajoutez TWILIO_FROM pour les appels.', 'Texts ready; add TWILIO_FROM for calls.')) : t('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM (un numéro canadien).', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (a Canadian number).'), href: '/settings/alerts', cta: t('Tester', 'Test') },
    { group: g, key: 'chat', state: n.chat ? 'done' : 'warn', optional: true, title: t('Clavardage de l’équipe', 'Team chat'), body: n.chat ? t('Les alertes sont publiées.', 'Alerts are posted.') : t('Optionnel : ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).', 'Optional: ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).'), href: '/settings/alerts', cta: t('Voir', 'See') },
    { group: g, key: 'ai', state: n.ai ? 'done' : 'warn', optional: true, title: t('Surveillance IA (Claude)', 'AI watchtower (Claude)'), body: n.ai ? t('Claude explique les alertes et répond au copilote.', 'Claude explains alerts and answers the copilot.') : t('Optionnel : ANTHROPIC_API_KEY. Sans clé, les règles intégrées expliquent les alertes.', 'Optional: ANTHROPIC_API_KEY. Without it, built-in rules explain alerts.'), href: '/settings/alerts', cta: t('Voir', 'See') },
  ];
}

export type RelayGoLiveInput = {
  relay: { agentConfigured: boolean; screens: (Pick<PlatformScreen, 'platform' | 'locationCode'> & { status: ScreenStatus })[] } | null;
  watch: {
    enabled: boolean;
    sharedPhoneConfigured: boolean;
    callConfigured: boolean;
    rules: Partial<Record<'screen_down' | 'screen_waiting', RuleSetting>>;
  } | null;
  kitchenPhoneLocations: string[];
};

function relayScreenStep(relay: RelayGoLiveInput['relay'], t: T): Step {
  const step: Step = {
    group: t('Cuisine', 'Kitchen'), key: 'screens-relay', title: t('Relais des écrans de commande', 'Order screen relay'),
    state: 'warn', optional: true, body: '', href: '/stores/screens', cta: t('Écrans', 'Screens'),
  };
  if (!relay) return { ...step, body: t('État du relais indisponible.', 'Relay status unavailable.') };
  if (!relay.agentConfigured) return { ...step, body: t('Le jeton du relais doit être configuré dans Food Hub.', 'The relay token needs to be configured in Food Hub.') };
  if (!relay.screens.length) return { ...step, body: t('Aucun écran relais inscrit dans vos cuisines.', 'No relay screens enrolled in your kitchens.') };

  const counts: Record<ScreenStatus, number> = { online: 0, never: 0, offline: 0, login_required: 0, error: 0 };
  for (const screen of relay.screens) counts[screen.status]++;
  const total = relay.screens.length;
  const headline = t(`${counts.online} sur ${total} en ligne.`, `${counts.online} of ${total} online.`);
  const platforms = ([['ubereats', 'Uber Eats'], ['doordash', 'DoorDash'], ['skip', 'SkipTheDishes']] as const).flatMap(([key, label]) => {
    const screens = relay.screens.filter((screen) => screen.platform === key);
    return screens.length ? [`${label} ${screens.filter((screen) => screen.status === 'online').length}/${screens.length}`] : [];
  });
  const problems = [
    counts.never && t(`${counts.never} sans premier signal`, `${counts.never} awaiting first heartbeat`),
    counts.offline && t(`${counts.offline} hors ligne`, `${counts.offline} offline`),
    counts.login_required && t(`${counts.login_required} à reconnecter`, `${counts.login_required} with sign-in required`),
    counts.error && t(`${counts.error} en erreur`, `${counts.error} with an error`),
  ].filter(Boolean);
  const body = [headline, [...platforms, ...problems].join(' · ')].filter(Boolean).join(' ');
  return { ...step, state: counts.online === total ? 'done' : 'warn', body };
}

function relayCallStep({ relay, watch, kitchenPhoneLocations }: RelayGoLiveInput, t: T, locName: (code: string) => string): Step {
  const step: Step = {
    group: t('Cuisine', 'Kitchen'), key: 'screens-calls', title: t('Appels pour les alertes des écrans', 'Calls for screen alerts'),
    state: 'warn', optional: true, body: '', href: '/settings/alerts', cta: t('Alertes', 'Alerts'),
  };
  if (!watch) return { ...step, body: t('Réglages des appels indisponibles.', 'Call settings unavailable.') };
  if (!watch.enabled) return { ...step, body: t('Activez le Watchtower pour surveiller les écrans.', 'Turn on Watchtower to monitor the screens.') };
  const down = watch.rules.screen_down;
  const waiting = watch.rules.screen_waiting;
  const missingRules = [
    (!down?.enabled || !down.escalate) && t('pannes d’écran', 'screen outages'),
    (!waiting?.enabled || !waiting.escalate) && t('commandes en attente', 'waiting orders'),
  ].filter(Boolean);
  if (missingRules.length) {
    const names = missingRules.join(t(' et ', ' and '));
    return { ...step, body: t(`Activez les alertes et les appels pour les ${names}.`, `Enable alerts and calls for ${names}.`) };
  }
  if (!watch.callConfigured) return { ...step, body: t('Configurez Twilio pour passer les appels d’alerte.', 'Set up Twilio to make alert calls.') };
  if (!relay?.agentConfigured || !relay.screens.length) {
    return { ...step, href: '/stores/screens', cta: t('Écrans', 'Screens'), body: t('Vérifiez le relais pour connaître les écrans couverts par les alertes.', 'Check the relay to see which screens are covered by alerts.') };
  }
  if (watch.sharedPhoneConfigured) {
    return { ...step, state: 'done', body: t('La ligne partagée est configurée pour les alertes de ces écrans.', 'The shared line is configured for alerts from these screens.') };
  }

  const kitchensWithPhone = new Set(kitchenPhoneLocations);
  const relayKitchens = new Set(relay.screens.map((screen) => screen.locationCode));
  const missing = [...relayKitchens].filter((code) => !kitchensWithPhone.has(code));
  if (missing.length) {
    const listed = missing.slice(0, 4).map(locName).join(', ') + (missing.length > 4 ? ` (+${missing.length - 4})` : '');
    return { ...step, href: '/settings/business', cta: t('Téléphones', 'Phones'), body: t(`Ajoutez un téléphone de cuisine pour ${listed}.`, `Add a kitchen phone for ${listed}.`) };
  }
  return { ...step, state: 'done', body: t('Chaque cuisine de ces écrans a un téléphone configuré pour les alertes.', 'Every kitchen with one of these screens has a phone configured for alerts.') };
}

/** Configuration and heartbeat review for the screens available to this viewer. */
export function relayGoLiveSteps(input: RelayGoLiveInput, t: T, locName: (code: string) => string): Step[] {
  return [relayScreenStep(input.relay, t), relayCallStep(input, t, locName)];
}

export type CloverAppInfo = {
  configured: boolean; merchants: Array<{ status?: string }>;
  legalStatus?: { supportEmailSet: boolean; supportPhoneSet?: boolean; approved: boolean };
  domain?: { url: string; ready: boolean; problems: PublicUrlProblem[] };
};

/**
 * Clover App Market app: domain, keys, webhook, public legal pages, merchants waiting for approval. The app keys are
 * optional (the register works without the App Market app); the rest is to check once the app is on its way.
 */
export function cloverAppSteps(clover: { app?: CloverAppInfo; webhookAuthSet?: boolean; verification?: { code: string } | null }, t: T): Step[] {
  const app = clover.app;
  if (!app) return [];
  const g = t('Application Clover (App Market)', 'Clover app (App Market)');
  const pending = app.merchants.filter((m) => m.status === 'pending').length;
  const legal = app.legalStatus ?? { supportEmailSet: false, supportPhoneSet: false, approved: false };
  const hook = Boolean(clover.webhookAuthSet && clover.verification);
  const legalMissing = [!legal.supportEmailSet && 'FOODHUB_SUPPORT_EMAIL', !legal.supportPhoneSet && 'FOODHUB_SUPPORT_PHONE', !legal.approved && 'FOODHUB_LEGAL_APPROVED=true'].filter(Boolean).join(', ');
  const domain = app.domain;
  return [
    ...(domain ? [{ group: g, key: 'clover-domain', state: domain.ready ? 'done' as const : 'warn' as const, title: t('Votre propre domaine en HTTPS', 'Your own domain over HTTPS'),
      body: domain.ready ? t(`Site URL Clover : ${domain.url}`, `Clover Site URL: ${domain.url}`) : domain.problems.map((p) => t(PUBLIC_URL_PROBLEM_TEXT[p].fr, PUBLIC_URL_PROBLEM_TEXT[p].en)).join(' '),
      href: '/settings/clover-app', cta: t('Voir', 'See') }] : []),
    { group: g, key: 'clover-app', state: app.configured ? 'done' : 'warn', optional: true, title: t('Clés de l’app Clover', 'Clover app keys'), body: app.configured ? t('Chaque marchand Clover se branche en un clic.', 'Each Clover merchant connects in one click.') : t('Optionnel : CLOVER_CLIENT_ID (l’App ID) et CLOVER_CLIENT_SECRET avec npm run setup.', 'Optional: CLOVER_CLIENT_ID (the App ID) and CLOVER_CLIENT_SECRET with npm run setup.'), href: '/settings/clover-app', cta: t('Voir', 'See') },
    { group: g, key: 'clover-hook', state: hook ? 'done' : 'warn', title: t('Webhook Clover vérifié', 'Clover webhook verified'), body: hook ? t('Ruptures instantanées et désinstallations reçues.', 'Instant sold-outs and uninstalls received.') : t('Développeur Clover → Webhooks : l’adresse de Réglages → Plateformes, événements Inventaire et App ; recollez le code de vérification, puis CLOVER_WEBHOOK_AUTH.', 'Clover developer → Webhooks: the URL from Settings → Platforms, events Inventory and App; paste back the verification code, then CLOVER_WEBHOOK_AUTH.'), href: '/settings/channels', cta: t('Voir', 'See') },
    { group: g, key: 'legal', state: legalMissing ? 'warn' : 'done', title: t('Pages confidentialité, conditions, soutien', 'Privacy, terms and support pages'), body: legalMissing ? `${t('Brouillons publics à faire relire. Manque :', 'Public drafts to review. Missing:')} ${legalMissing}` : t('Prêtes pour la fiche Clover.', 'Ready for the Clover listing.'), href: '/legal/privacy', cta: t('Relire', 'Review') },
    { group: g, key: 'clover-listing', state: 'warn', title: t('Fiche App Market et soumission', 'App Market listing and submission'), body: t('Textes FR/EN, adresses à copier, vidéo fonctionnelle et ce qui reste à faire dans le tableau de bord Clover.', 'FR/EN texts, addresses to copy, functional video and what is left to do in the Clover dashboard.'), href: '/settings/clover-app', cta: t('Ouvrir', 'Open') },
    ...(pending ? [{ group: g, key: 'clover-pending', state: 'todo' as const, title: t('Marchands Clover en attente', 'Clover merchants waiting'), body: t(`${pending} marchand(s) ont ouvert l’app depuis Clover et attendent votre approbation.`, `${pending} merchant(s) opened the app from Clover and are waiting for your approval.`), href: '/settings/channels', cta: t('Approuver', 'Approve') }] : []),
  ];
}
