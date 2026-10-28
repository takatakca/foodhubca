// TAKATAK Suite: the Clover App Market apps (one GitHub repo each, a "4" in the name) that work alone AND together.
// Each app is its own Clover app (own App ID, listing, price, OAuth tokens, database) and works without Food Hub.
// When a merchant also runs Food Hub, the app is connected here: Food Hub sends it signed events (lib/foodhub/suite/bus.ts)
// and accepts its signed calls (/api/suite/v1/*). Contract: docs/TAKATAK_SUITE.md.
//
// Connecting an app = two server variables, nothing else (nothing in git):
//   FOODHUB_SUITE_<KEY>_URL      https address where the app receives Food Hub events
//   FOODHUB_SUITE_<KEY>_SECRET   shared signing secret, 32+ characters, the same value in the app
// Optional: FOODHUB_SUITE_<KEY>_EVENTS  comma-separated event types (default: the app's own list below).

export const SUITE_EVENT_TYPES = ['order.created', 'order.status_changed', 'app.event'] as const;
export type SuiteEventType = (typeof SUITE_EVENT_TYPES)[number];

export interface SuiteAppDef {
  key: string;
  /** GitHub repository (takatakca/<repo>). */
  repo: string;
  name: string;
  fr: string;
  en: string;
  /** Events the app gets by default. */
  events: SuiteEventType[];
}

// Purposes are read from the app names (owner to confirm, docs/TAKATAK_SUITE.md § 3).
export const SUITE_APPS: SuiteAppDef[] = [
  { key: 'c4isse', repo: 'C4ISSE', name: 'C4ISSE', fr: 'Caisse : tiroir-caisse, fonds de caisse, fermeture du jour', en: 'Cash: drawer, float, end-of-day close', events: ['order.created', 'order.status_changed'] },
  { key: 't4ctile', repo: 'T4CTILE', name: 'T4CTILE', fr: 'Borne tactile de commande en magasin', en: 'In-store self-order touch kiosk', events: ['order.status_changed'] },
  { key: '4ccounting', repo: '4CCOUNTING', name: '4CCOUNTING', fr: 'Comptabilité : ventes, taxes, exports', en: 'Accounting: sales, taxes, exports', events: ['order.created', 'order.status_changed'] },
  { key: 'tr4cker', repo: 'TR4CKER', name: 'TR4CKER', fr: 'Suivi de commande et de livraison pour le client', en: 'Order and delivery tracking for the customer', events: ['order.created', 'order.status_changed'] },
  { key: 'st4ff', repo: 'ST4FF', name: 'ST4FF', fr: 'Personnel : horaires, pointage, main-d’œuvre', en: 'Staff: schedules, time clock, labour', events: ['order.created'] },
  { key: 'm4rketing', repo: 'M4RKETING', name: 'M4RKETING', fr: 'Marketing : campagnes, promotions', en: 'Marketing: campaigns, promotions', events: ['order.created', 'app.event'] },
  { key: 'loy4lty', repo: 'LOY4LTY', name: 'LOY4LTY', fr: 'Fidélité : points par commande', en: 'Loyalty: points per order', events: ['order.status_changed', 'app.event'] },
  { key: 'rew4rd', repo: 'REW4RD', name: 'REW4RD', fr: 'Récompenses : catalogue et échanges', en: 'Rewards: catalogue and redemptions', events: ['app.event'] },
  { key: 'ch4t', repo: 'CH4T', name: 'CH4T', fr: 'Messages clients : clavardage, texto', en: 'Customer messages: chat, text', events: ['order.status_changed', 'app.event'] },
];

/** Shorter secrets are refused: the secret is the only lock on the app's calls. */
export const MIN_SUITE_SECRET = 32;

export interface SuiteAppConfig extends SuiteAppDef { url: string | null; secret: string | null; connected: boolean; subscribed: SuiteEventType[]; problem: string | null }

const envName = (key: string, part: string) => `FOODHUB_SUITE_${key.toUpperCase()}_${part}`;

export function suiteApp(key: string): SuiteAppConfig | null {
  const def = SUITE_APPS.find((a) => a.key === key);
  if (!def) return null;
  const rawUrl = (process.env[envName(def.key, 'URL')] ?? '').trim();
  const rawSecret = (process.env[envName(def.key, 'SECRET')] ?? '').trim();
  let url: string | null = null;
  let problem: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.username || u.password) problem = 'URL must not carry a user name or password';
      else if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) problem = 'URL must be https';
      else url = u.toString();
    } catch { problem = 'URL is not valid'; }
  }
  const secret = rawSecret.length >= MIN_SUITE_SECRET ? rawSecret : null;
  if (rawSecret && !secret) problem = problem ?? `secret shorter than ${MIN_SUITE_SECRET} characters`;
  const custom = (process.env[envName(def.key, 'EVENTS')] ?? '').split(',').map((s) => s.trim()).filter((s): s is SuiteEventType => (SUITE_EVENT_TYPES as readonly string[]).includes(s));
  return { ...def, url, secret, connected: !!url && !!secret && !problem, subscribed: custom.length ? custom : def.events, problem };
}

export function suiteApps(): SuiteAppConfig[] {
  return SUITE_APPS.map((a) => suiteApp(a.key)!);
}

export function connectedSuiteApps(): SuiteAppConfig[] {
  return suiteApps().filter((a) => a.connected);
}
