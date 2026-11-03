// The Overview's "Connexions et synchro" strip, beyond the /api/health checks: the services Food Hub talks through —
// e-mail, SMS (and alert calls), the AI, plus the screens relay and the Too Good To Go mailbox once they are set up.
// Each row comes from the readiness function its own settings page already uses (notify/, screens.ts, tgtg-email/),
// so the strip and the settings pages never disagree.
//   ok   — works (or, for the relay and the mailbox, reported in on time)
//   warn — half set up, or set up but silent / failing
//   off  — not set up
// These rows never change the health status or the HTTP code: an uptime monitor only asks "can an order be missed?".
// `missing` names the environment variables to add — never their values — and /api/health keeps it for the owner only
// (forViewer below).
import { callConfigured, smsConfigured, aiConfigured } from './notify';
import { emailConfigured, emailProvider } from './notify/email';
import { MIN_AGENT_TOKEN, screenStatus, type PlatformScreen } from './screens';
import { tgtgEmailReadiness, type MailboxStatus } from './tgtg-email/settings';
import type { Role } from './types';

export type ServiceKey = 'email' | 'sms' | 'ai' | 'screens' | 'tgtg_email';
export type ServiceState = 'ok' | 'warn' | 'off';
export interface ServiceHealth { key: ServiceKey; status: ServiceState; detail: string; detailFr: string; missing: string[] }

/** What serviceHealth reads besides the environment (read by buildHealth, time-bounded). */
export interface ServiceInputs {
  /** The platform screens (only read when the relay token is set). */
  screens?: PlatformScreen[] | null;
  /** The Too Good To Go mailbox's last check (only read when the mailbox is set up). */
  mailbox?: MailboxStatus | null;
  /** The owner's switch in Settings → Platforms → Too Good To Go (default on). */
  tgtgEnabled?: boolean;
  now?: number;
}

const isSet = (k: string) => Boolean(process.env[k]?.trim());
const unset = (keys: string[]) => keys.filter((k) => !isSet(k));

/** The relay row appears once FOODHUB_SCREENS_AGENT_TOKEN is set at all (even too short: that mistake is shown). */
export function screensRelayWanted(): boolean { return isSet('FOODHUB_SCREENS_AGENT_TOKEN'); }
/** The mailbox row appears once any Too Good To Go mailbox or webhook setting is present. */
export function tgtgMailWanted(): boolean {
  return ['TGTG_IMAP_HOST', 'TGTG_IMAP_USER', 'TGTG_IMAP_PASSWORD', 'TGTG_EMAIL_WEBHOOK_SECRET'].some((k) => isSet(k));
}

/** A mailbox read more than this long ago is late (it is checked every TGTG_IMAP_POLL_S, 60 s by default). */
const MAILBOX_LATE_MS = 15 * 60_000;

function emailRow(): ServiceHealth {
  const provider = emailProvider();
  if (emailConfigured('auth')) {
    const how = provider === 'smtp' ? 'SMTP' : 'Resend';
    return { key: 'email', status: 'ok', detail: `Sign-in codes and reports are e-mailed (${how}).`, detailFr: `Les codes de connexion et les rapports partent par courriel (${how}).`, missing: [] };
  }
  if (provider) return { key: 'email', status: 'warn', detail: 'The mailbox is set, but not the sender address.', detailFr: 'La boîte d’envoi est réglée, pas l’adresse d’expéditeur.', missing: ['AUTH_EMAIL_FROM'] };
  // SMTP started: only what it still lacks. Nothing yet: the SMTP trio (Resend is the other way, said in the text).
  const smtp = isSet('SMTP_HOST') ? unset(['SMTP_USER', 'SMTP_PASS']) : ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  return {
    key: 'email', status: 'off',
    detail: 'Not set up: no sign-in code or report can be e-mailed (an SMTP mailbox, or Resend).',
    detailFr: 'Pas branché : aucun code ni rapport ne peut partir par courriel (une boîte SMTP, ou Resend).',
    missing: [...smtp, ...unset(['AUTH_EMAIL_FROM'])],
  };
}

function smsRow(): ServiceHealth {
  if (smsConfigured() && callConfigured()) return { key: 'sms', status: 'ok', detail: 'Alert texts and calls ready (Twilio).', detailFr: 'Textos et appels d’alerte prêts (Twilio).', missing: [] };
  if (smsConfigured()) return { key: 'sms', status: 'warn', detail: 'Texts ready; alert calls need a Twilio phone number.', detailFr: 'Textos prêts ; les appels d’alerte demandent un numéro Twilio.', missing: ['TWILIO_FROM'] };
  return {
    key: 'sms', status: 'off',
    detail: 'Not set up: the Watchtower cannot text or call anyone.', detailFr: 'Pas branché : la surveillance ne peut ni texter ni appeler.',
    missing: unset(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']),
  };
}

function aiRow(): ServiceHealth {
  return aiConfigured()
    ? { key: 'ai', status: 'ok', detail: 'Claude explains alerts and answers the copilot.', detailFr: 'Claude explique les alertes et répond au copilote.', missing: [] }
    : { key: 'ai', status: 'off', detail: 'Optional: without it, built-in rules explain alerts.', detailFr: 'Optionnel : sans elle, les règles intégrées expliquent les alertes.', missing: ['ANTHROPIC_API_KEY'] };
}

function screensRow(screens: PlatformScreen[], now: number): ServiceHealth {
  if ((process.env.FOODHUB_SCREENS_AGENT_TOKEN ?? '').trim().length < MIN_AGENT_TOKEN) {
    return { key: 'screens', status: 'warn', detail: `The relay token is too short (${MIN_AGENT_TOKEN}+ characters): the relay host is refused.`, detailFr: `Le jeton du relais est trop court (${MIN_AGENT_TOKEN} caractères ou plus) : le serveur relais est refusé.`, missing: ['FOODHUB_SCREENS_AGENT_TOKEN'] };
  }
  if (!screens.length) return { key: 'screens', status: 'warn', detail: 'Relay ready: no platform screen added yet.', detailFr: 'Relais prêt : aucun écran de plateforme ajouté.', missing: [] };
  const st = screens.map((s) => screenStatus(s, now));
  const up = st.filter((s) => s === 'online').length;
  const silent = st.filter((s) => s === 'offline' || s === 'never').length;
  if (up === screens.length) return { key: 'screens', status: 'ok', detail: `${up} screen(s) reporting in.`, detailFr: `${up} écran(s) au rapport.`, missing: [] };
  if (silent === screens.length) return { key: 'screens', status: 'warn', detail: 'No heartbeat from the relay host.', detailFr: 'Aucune nouvelle du serveur relais.', missing: [] };
  const look = screens.length - up;
  return { key: 'screens', status: 'warn', detail: `${up} of ${screens.length} screen(s) fine; ${look} need a look (sign-in, error or silent).`, detailFr: `${up} écran(s) sur ${screens.length} en ordre ; ${look} à vérifier (connexion, erreur ou silence).`, missing: [] };
}

function tgtgRow(inputs: ServiceInputs, now: number): ServiceHealth {
  const r = tgtgEmailReadiness();
  if (inputs.tgtgEnabled === false) return { key: 'tgtg_email', status: 'off', detail: 'Turned off in Settings → Platforms.', detailFr: 'Éteint dans Réglages → Plateformes.', missing: [] };
  if (!r.imapConfigured && !r.webhookConfigured) {
    return { key: 'tgtg_email', status: 'warn', detail: 'The order mailbox is half set up.', detailFr: 'La boîte des commandes est à moitié réglée.', missing: r.missing };
  }
  if (!r.imapConfigured) return { key: 'tgtg_email', status: 'ok', detail: 'Receives the forwarded order e-mails (webhook).', detailFr: 'Reçoit les courriels de commande transférés (webhook).', missing: [] };
  const m = inputs.mailbox ?? {};
  // The error text stays on the Too Good To Go settings page: it can name the mail server.
  if (m.lastError) return { key: 'tgtg_email', status: 'warn', detail: 'The mailbox did not answer the last check.', detailFr: 'La boîte n’a pas répondu à la dernière vérification.', missing: [] };
  if (!m.lastOkAt) return { key: 'tgtg_email', status: 'warn', detail: 'The mailbox has not been read yet.', detailFr: 'La boîte n’a pas encore été lue.', missing: [] };
  const ageMin = Math.max(0, Math.round((now - Date.parse(m.lastOkAt)) / 60_000));
  const when = { en: ageMin < 1 ? 'just now' : `${ageMin} min ago`, fr: ageMin < 1 ? 'à l’instant' : `il y a ${ageMin} min` };
  return now - Date.parse(m.lastOkAt) > MAILBOX_LATE_MS
    ? { key: 'tgtg_email', status: 'warn', detail: `Mailbox last read ${when.en}: late.`, detailFr: `Boîte lue ${when.fr} : en retard.`, missing: [] }
    : { key: 'tgtg_email', status: 'ok', detail: `Mailbox read ${when.en}.`, detailFr: `Boîte lue ${when.fr}.`, missing: [] };
}

/** E-mail, SMS and AI always; the screens relay and the Too Good To Go mailbox once they are set up. */
export function serviceHealth(inputs: ServiceInputs = {}): ServiceHealth[] {
  const now = inputs.now ?? Date.now();
  return [
    emailRow(),
    smsRow(),
    aiRow(),
    ...(screensRelayWanted() ? [screensRow(inputs.screens ?? [], now)] : []),
    ...(tgtgMailWanted() ? [tgtgRow(inputs, now)] : []),
  ];
}

/** The names of missing settings are for the owner only; every other viewer (and the cron secret) gets the states. */
export function forViewer(services: ServiceHealth[], role: Role | null | undefined): ServiceHealth[] {
  return role === 'owner' ? services : services.map((s) => ({ ...s, missing: [] }));
}
