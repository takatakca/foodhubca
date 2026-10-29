// Platform screens ("Écrans des plateformes"): the Uber Eats Orders and DoorDash Order Manager screens, shown live inside
// Food Hub. Each screen is a real browser running on the screen relay host (deploy/screens/), signed in ONCE by the
// owner, inside the screen itself. Food Hub never stores, sees or types a platform password: it only keeps the screen's
// view address and the relay agent's heartbeat (is the screen up, is it still signed in, page title).
//
// Why: without an order integration, the platform tablet is the only place orders arrive, and a tablet that drops its
// Wi-Fi or its sign-in loses orders silently. The relay host keeps the sessions on a wired server, the agent reloads a
// frozen page by itself, and the Watchtower rings (screen → SMS → call) when a screen goes down or asks to sign in again.
//
// What the agent reads from each page: its address host and its title (for example "(2) Orders"), nothing else.
// In Android mode (heartbeat v2) it reads which app is in front and how many notifications the order app shows, never
// their text. It never clicks, accepts or reads orders: orders keep reaching Clover through the platform's own path.
import crypto from 'node:crypto';
import { z } from 'zod';
import { logActivity, type Actor } from './activity';
import { isProtectedDoorDashId } from './doordash/guard';
import { FORBIDDEN_STORE_IDS } from './public-directory';
import { getAdapter } from './adapters';
import { lastOrderTimes } from './order-retry';
import { cloverReadiness } from './pos/clover';
import type { ChannelKey } from './types';
import { parseWall, type WallState } from '../ui/screens-layout';
import { getRepo } from './repo';
import { safeEqual } from './session';

export const SCREENS = 'platform_screens';
/** A screen whose agent has not reported for this long is offline. The agent reports every 20 s. */
export const SCREEN_OFFLINE_AFTER_MS = 120_000;
/** Shorter tokens are refused: the token is the only lock on the heartbeat route. */
export const MIN_AGENT_TOKEN = 24;

export const SCREEN_PLATFORMS = ['ubereats', 'doordash', 'skip', 'other'] as const;
export type ScreenPlatform = (typeof SCREEN_PLATFORMS)[number];
export const SCREEN_PLATFORM_LABEL: Record<ScreenPlatform, string> = { ubereats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', other: 'Autre / Other' };

/** What the agent saw on the page: ok, the platform's sign-in page, a crashed / error page, or an empty page. */
export const SCREEN_STATES = ['ok', 'login', 'crashed', 'blank'] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

/** web = the platform's merchant web page in a browser; android = the platform's Android app (heartbeat v2). */
export const SCREEN_MODES = ['web', 'android'] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];

/** reload = reload the page (Android: bring the order app back); open = go to the platform's start page (`url`). */
export interface ScreenCommand { kind: 'reload' | 'open'; url?: string; at: string; by: string }

/** Each platform's merchant page a screen opens on (its sign-in page while signed out). Override per environment. */
const DEFAULT_START: Record<ScreenPlatform, string | null> = {
  doordash: 'https://order.doordash.com/',
  ubereats: 'https://merchants.ubereats.com/manager/orders',
  skip: 'https://restaurants.skipthedishes.com/',
  other: null,
};
const START_ENV: Record<ScreenPlatform, string> = {
  doordash: 'FOODHUB_SCREEN_START_DOORDASH', ubereats: 'FOODHUB_SCREEN_START_UBEREATS', skip: 'FOODHUB_SCREEN_START_SKIP', other: 'FOODHUB_SCREEN_START_OTHER',
};
/** A screen is only ever sent to the platforms' own sites (the relay agent checks the same list). */
export const SCREEN_ALLOWED_HOSTS = ['doordash.com', 'ubereats.com', 'uber.com', 'skipthedishes.com'] as const;

export function allowedScreenUrl(raw: string | null | undefined): boolean {
  try {
    const u = new URL(String(raw ?? ''));
    return u.protocol === 'https:' && !u.username && !u.password && SCREEN_ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

export function screenStartUrl(platform: ScreenPlatform, env: Record<string, string | undefined> = process.env): string | null {
  const v = env[START_ENV[platform]]?.trim() || DEFAULT_START[platform];
  return v && allowedScreenUrl(v) ? v : null;
}

/** Numbered screens made by "Set up screens": ids s01, s02… so the relay host's list uses the same ids (no copying). */
export const SLOT_ID = /^s\d{2}$/;
export const MAX_SLOTS = 32;
export const slotId = (n: number) => `s${String(n).padStart(2, '0')}`;

export interface PlatformScreen {
  id: string;
  name: string;
  platform: ScreenPlatform;
  locationCode: string;
  /** The screen's live view on the relay host (https). Never carries a user name or password. */
  viewUrl: string;
  createdBy: string;
  createdAt: string;
  lastSeenAt?: string | null;
  state?: ScreenState | null;
  /** Page title as the agent read it, e.g. "(2) Orders". */
  pageTitle?: string | null;
  /** Host of the page the browser shows (e.g. merchants.ubereats.com). */
  pageHost?: string | null;
  /** Number in brackets at the start of the page title, when the platform shows one. */
  titleCount?: number | null;
  /** Reloads the agent made by itself since it started (frozen / crashed page). */
  autoReloads?: number | null;
  agentVersion?: string | null;
  /** Waiting for the agent's next heartbeat. */
  command?: ScreenCommand | null;
  /** How the agent runs this screen (heartbeat v2). A v1 agent is web. */
  mode?: ScreenMode | null;
  /** Android: the package of the app in front (e.g. the order app). Never any text from the screen. */
  app?: string | null;
  /** Since when orders have been waiting on this screen (the count went up from 0, or dropped and stayed above 0). */
  waitingSince?: string | null;
  /** The platform's own store ids this screen shows: one account often shows several stores. */
  storeIds?: string[];
}

export type ScreenStatus = 'online' | 'login_required' | 'error' | 'offline' | 'never';

export function screenStatus(s: PlatformScreen, now = Date.now()): ScreenStatus {
  if (!s.lastSeenAt) return 'never';
  if (now - Date.parse(s.lastSeenAt) > SCREEN_OFFLINE_AFTER_MS) return 'offline';
  if (s.state === 'login') return 'login_required';
  if (s.state === 'crashed' || s.state === 'blank') return 'error';
  return 'online';
}

/**
 * The view address must be https (http only for this machine), and never carry a user name or password: anyone who
 * can read Food Hub settings would see them. The relay host is protected by its own sign-in or access policy.
 */
export function checkViewUrl(raw: unknown, env: Record<string, string | undefined> = process.env): { url: string } | { error: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Adresse de l’écran requise. / Screen address required.' };
  if (text.length > 500) return { error: 'Adresse trop longue. / Address too long.' };
  let u: URL;
  try { u = new URL(text); } catch { return { error: 'Adresse invalide. / Invalid address.' }; }
  if (u.username || u.password) return { error: 'Ne mettez jamais de nom d’utilisateur ni de mot de passe dans l’adresse. / Never put a user name or password in the address.' };
  const hosts = viewHosts(env);
  // Owners type their platform passwords inside these frames: once the relay host is named, a screen can only show it
  // (a fake "sign-in" page elsewhere can never be put on the wall).
  if (hosts.length) {
    if (u.protocol !== 'https:' || !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
      return { error: `L’écran doit être sur le serveur relais (${hosts.join(', ')}). / The screen must be on the relay host (${hosts.join(', ')}).` };
    }
    return { url: u.toString() };
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { error: 'L’adresse doit commencer par https://. / The address must start with https://.' };
  return { url: u.toString() };
}

/** FOODHUB_SCREENS_VIEW_HOSTS: the relay host name(s), comma-separated (e.g. "ecrans.on2go.ca"). Empty = any https. */
export function viewHosts(env: Record<string, string | undefined> = process.env): string[] {
  return String(env.FOODHUB_SCREENS_VIEW_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
}

export async function listScreens(): Promise<PlatformScreen[]> {
  return (await getRepo().listDocs<PlatformScreen>(SCREENS, { limit: 200 })).map((d) => d.data)
    .sort((a, b) => (a.locationCode + a.platform + a.name).localeCompare(b.locationCode + b.platform + b.name));
}

export async function getScreen(id: string): Promise<PlatformScreen | null> {
  return (await getRepo().getDoc<PlatformScreen>(SCREENS, id))?.data ?? null;
}

async function save(s: PlatformScreen) {
  await getRepo().putDocs<PlatformScreen>(SCREENS, [{ id: s.id, key: s.locationCode, at: s.createdAt, data: s }]);
  return s;
}

const cleanName = (v: unknown, platform: ScreenPlatform) => String(v ?? '').trim().slice(0, 60) || SCREEN_PLATFORM_LABEL[platform];
const asPlatform = (v: unknown): ScreenPlatform | null => (SCREEN_PLATFORMS as readonly string[]).includes(String(v)) ? (v as ScreenPlatform) : null;

/** "27870472, 28040070" or ['27870472'] → unique store ids. Store ids only: digits, letters, ':', '_' or '-'. */
export function cleanStoreIds(v: unknown): { ids: string[] } | { error: string } {
  const parts = (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (parts.length > 30) return { error: '30 magasins au plus par écran. / 30 stores at most per screen.' };
  const bad = parts.find((x) => !/^[A-Za-z0-9:_-]{1,40}$/.test(x));
  if (bad) return { error: `Numéro de magasin invalide : ${bad.slice(0, 40)} / Invalid store id.` };
  return { ids: [...new Set(parts)] };
}

/** Store ids on this screen that nobody may act on from Food Hub (Po Poulet NDG and every locked DoorDash store). */
export function protectedStoreIds(s: Pick<PlatformScreen, 'storeIds'>): string[] {
  return (s.storeIds ?? []).filter((id) => FORBIDDEN_STORE_IDS.has(id) || isProtectedDoorDashId(id));
}

export async function addScreen(input: { name?: unknown; platform?: unknown; locationCode: string; viewUrl?: unknown; storeIds?: unknown }, actor: Actor): Promise<PlatformScreen | { error: string }> {
  const platform = asPlatform(input.platform);
  if (!platform) return { error: 'Choisissez la plateforme. / Choose the platform.' };
  const url = checkViewUrl(input.viewUrl);
  if ('error' in url) return url;
  const stores = cleanStoreIds(input.storeIds);
  if ('error' in stores) return stores;
  const screen: PlatformScreen = {
    id: crypto.randomUUID(), name: cleanName(input.name, platform), platform, locationCode: input.locationCode, viewUrl: url.url,
    createdBy: actor.name, createdAt: new Date().toISOString(), lastSeenAt: null, state: null, storeIds: stores.ids,
  };
  await save(screen);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screen_added', status: 'success', locationCode: screen.locationCode, summary: `Platform screen "${screen.name}" (${SCREEN_PLATFORM_LABEL[platform]}) added` });
  return screen;
}

export async function updateScreen(id: string, patch: { name?: unknown; platform?: unknown; locationCode?: string; viewUrl?: unknown; storeIds?: unknown }, actor: Actor): Promise<PlatformScreen | { error: string } | null> {
  const s = await getScreen(id);
  if (!s) return null;
  const next = { ...s };
  if (patch.platform !== undefined) {
    const p = asPlatform(patch.platform);
    if (!p) return { error: 'Choisissez la plateforme. / Choose the platform.' };
    // A new channel: the relay host opens that platform's page (its sign-in page) on the next heartbeat.
    const url = p !== s.platform ? screenStartUrl(p) : null;
    if (url) next.command = { kind: 'open', url, at: new Date().toISOString(), by: actor.name };
    next.platform = p;
  }
  if (patch.name !== undefined) next.name = cleanName(patch.name, next.platform);
  if (patch.locationCode) next.locationCode = patch.locationCode;
  if (patch.viewUrl !== undefined) {
    const url = checkViewUrl(patch.viewUrl);
    if ('error' in url) return url;
    next.viewUrl = url.url;
  }
  if (patch.storeIds !== undefined) {
    const stores = cleanStoreIds(patch.storeIds);
    if ('error' in stores) return stores;
    next.storeIds = stores.ids;
  }
  await save(next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screen_updated', status: 'success', locationCode: next.locationCode, summary: `Platform screen "${next.name}" updated` });
  return next;
}

export async function removeScreen(id: string, actor: Actor): Promise<boolean> {
  const s = await getScreen(id);
  if (!s) return false;
  await getRepo().deleteDocs(SCREENS, [id]);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screen_removed', status: 'success', locationCode: s.locationCode, summary: `Platform screen "${s.name}" removed` });
  return true;
}

/** "Go to the sign-in page" from the console: the agent opens the platform's start page on its next heartbeat. */
export async function requestOpen(id: string, actor: Actor): Promise<PlatformScreen | { error: string } | null> {
  const s = await getScreen(id);
  if (!s) return null;
  const url = screenStartUrl(s.platform);
  if (!url) return { error: 'Aucune page de départ pour cette plateforme. / No start page for this platform.' };
  const next = { ...s, command: { kind: 'open' as const, url, at: new Date().toISOString(), by: actor.name } };
  await save(next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screen_open', status: 'queued', locationCode: s.locationCode, summary: `Start page asked for platform screen "${s.name}"` });
  return next;
}

export type SetupCounts = Partial<Record<Exclude<ScreenPlatform, 'other'>, number>>;

/**
 * "Set up screens": numbered screens s01, s02… for one location, so many DoorDash, so many Uber Eats, so many Skip.
 * Each one's view address is <base>/sNN/ on the relay host, and each opens its platform's sign-in page. Existing ids are
 * kept as they are (run it again to add more).
 */
export async function setupScreens(input: { baseUrl?: unknown; locationCode: string; counts?: SetupCounts }, actor: Actor): Promise<{ created: PlatformScreen[]; kept: string[] } | { error: string }> {
  const base = checkViewUrl(input.baseUrl);
  if ('error' in base) return base;
  const plan: ScreenPlatform[] = [];
  for (const p of ['doordash', 'ubereats', 'skip'] as const) {
    const n = Math.floor(Number(input.counts?.[p] ?? 0));
    if (!Number.isFinite(n) || n < 0) return { error: 'Nombre d’écrans invalide. / Invalid number of screens.' };
    for (let i = 0; i < n; i++) plan.push(p);
  }
  if (!plan.length) return { error: 'Choisissez au moins un écran. / Choose at least one screen.' };
  if (plan.length > MAX_SLOTS) return { error: `${MAX_SLOTS} écrans au plus. / ${MAX_SLOTS} screens at most.` };
  const root = base.url.endsWith('/') ? base.url : `${base.url}/`;
  const created: PlatformScreen[] = [];
  const kept: string[] = [];
  const perPlatform: Partial<Record<ScreenPlatform, number>> = {};
  const now = new Date().toISOString();
  for (let i = 0; i < plan.length; i++) {
    const id = slotId(i + 1);
    const platform = plan[i];
    perPlatform[platform] = (perPlatform[platform] ?? 0) + 1;
    if (await getScreen(id)) { kept.push(id); continue; }
    const url = screenStartUrl(platform);
    const screen: PlatformScreen = {
      id, name: `${SCREEN_PLATFORM_LABEL[platform]} ${perPlatform[platform]}`, platform, locationCode: input.locationCode, viewUrl: new URL(`${id}/`, root).toString(),
      createdBy: actor.name, createdAt: now, lastSeenAt: null, state: null, storeIds: [],
      command: url ? { kind: 'open', url, at: now, by: actor.name } : null,
    };
    await save(screen);
    created.push(screen);
  }
  if (created.length) await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screens_setup', status: 'success', locationCode: input.locationCode, summary: `${created.length} platform screen(s) set up (${created.map((x) => x.id).join(', ')})` });
  return { created, kept };
}

/** "Reload" from the console: the agent picks it up on its next heartbeat (≤ 20 s). */
export async function requestReload(id: string, actor: Actor): Promise<PlatformScreen | null> {
  const s = await getScreen(id);
  if (!s) return null;
  const next = { ...s, command: { kind: 'reload' as const, at: new Date().toISOString(), by: actor.name } };
  await save(next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screen_reload', status: 'queued', locationCode: s.locationCode, summary: `Reload asked for platform screen "${s.name}"` });
  return next;
}

// ---- Relay agent (deploy/screens/agent.mjs) ----

export function agentToken(): string | null {
  const t = (process.env.FOODHUB_SCREENS_AGENT_TOKEN ?? '').trim();
  return t.length >= MIN_AGENT_TOKEN ? t : null;
}

/** Authorization: Bearer <FOODHUB_SCREENS_AGENT_TOKEN>. Off (always false) until the token is set. */
export function agentAuthorized(req: Request): boolean {
  const token = agentToken();
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return !!token && !!m && safeEqual(m[1].trim(), token);
}

const reportSchema = z.object({
  id: z.string().min(1).max(64),
  state: z.enum(SCREEN_STATES),
  title: z.string().max(500).optional().nullable(),
  url: z.string().max(2000).optional().nullable(),
  autoReloads: z.number().int().min(0).max(1_000_000).optional().nullable(),
  // v2 (optional, so a v1 agent keeps working): Android mode, the package in front, and a count of waiting orders.
  mode: z.enum(SCREEN_MODES).optional().nullable(),
  app: z.string().max(150).regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/).optional().nullable(),
  waiting: z.number().int().min(0).max(999).optional().nullable(),
});
export const heartbeatSchema = z.object({
  version: z.string().max(40).optional().nullable(),
  screens: z.array(reportSchema).max(50),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

/** "(3) Orders" → 3. Platforms put the count of waiting orders first in the tab title. */
export function titleCount(title: string | null | undefined): number | null {
  const m = /^\s*\((\d{1,3})\+?\)/.exec(title ?? '');
  return m ? Number(m[1]) : null;
}

const hostOf = (url: string | null | undefined) => { try { return url ? new URL(url).hostname : null; } catch { return null; } };

/**
 * Since when orders wait: set when the count rises from 0, kept while it holds or rises, restarted when it drops but
 * stays above 0 (someone is answering the screen), cleared at 0.
 */
export function nextWaitingSince(prev: Pick<PlatformScreen, 'titleCount' | 'waitingSince'>, count: number | null, now: Date): string | null {
  if (!count) return null;
  const before = prev.titleCount ?? 0;
  if (before <= 0 || count < before || !prev.waitingSince) return now.toISOString();
  return prev.waitingSince;
}

/** Save each screen's report and hand back the commands waiting for it (each command is given once). */
export type AgentCommand = { id: string; kind: ScreenCommand['kind']; url?: string };

export async function recordHeartbeat(hb: Heartbeat, now = new Date()): Promise<{ commands: AgentCommand[]; unknown: string[] }> {
  const commands: AgentCommand[] = [];
  const unknown: string[] = [];
  for (const r of hb.screens) {
    const s = await getScreen(r.id);
    if (!s) { unknown.push(r.id); continue; }
    const title = r.title ? r.title.slice(0, 120) : null;
    const wasLogin = s.state === 'login';
    if (s.command?.kind === 'open' && allowedScreenUrl(s.command.url)) commands.push({ id: s.id, kind: 'open', url: s.command.url });
    else if (s.command?.kind === 'reload') commands.push({ id: s.id, kind: 'reload' });
    const mode: ScreenMode = r.mode ?? 'web';
    const count = titleCount(title) ?? r.waiting ?? null;
    await save({
      ...s, lastSeenAt: now.toISOString(), state: r.state, pageTitle: title, pageHost: hostOf(r.url), titleCount: count,
      waitingSince: nextWaitingSince(s, count, now), mode, app: mode === 'android' ? r.app ?? null : null,
      autoReloads: r.autoReloads ?? s.autoReloads ?? null, agentVersion: hb.version ?? s.agentVersion ?? null, command: null,
    });
    if (r.state === 'login' && !wasLogin) {
      await logActivity({ actor: 'Screen relay', source: 'automation', kind: 'device', action: 'screen_signed_out', status: 'failed', locationCode: s.locationCode, summary: `Platform screen "${s.name}" asks to sign in again` });
    }
  }
  return { commands, unknown };
}

// ---- How each platform's orders reach Food Hub and Clover (shown above the screens wall) ----

const CHANNEL_OF: Record<Exclude<ScreenPlatform, 'other'>, ChannelKey> = { doordash: 'doordash', ubereats: 'uber_eats', skip: 'skip' };

export interface OrderPath {
  platform: ScreenPlatform;
  /** via_clover = the platform's own Clover link, Food Hub reads the orders from Clover; direct = Food Hub's own
   *  connection sends them to Clover; none = only the screen (the tablet's printer or a person enters them). */
  mode: 'via_clover' | 'direct' | 'none';
  /** Food Hub can write orders into Clover (merchant token or the Clover app). */
  cloverReady: boolean;
  lastOrderAt: string | null;
}

export async function orderPaths(): Promise<OrderPath[]> {
  const last = await lastOrderTimes().catch(() => ({} as Partial<Record<ChannelKey, string>>));
  const clover = cloverReadiness().configured;
  return (Object.keys(CHANNEL_OF) as Array<keyof typeof CHANNEL_OF>).map((p) => {
    const r = getAdapter(CHANNEL_OF[p]).readiness();
    return { platform: p, mode: r.viaClover ? 'via_clover' : r.configured ? 'direct' : 'none', cloverReady: clover, lastOrderAt: last[CHANNEL_OF[p]] ?? null };
  });
}

// ---- The wall layout shared by every device (a device's own layout wins once it has one) ----

const WALL_KEY = 'screens:wall:shared';

export async function getSharedWall(): Promise<(WallState & { savedBy?: string; savedAt?: string }) | null> {
  const v = await getRepo().getKv<{ wall: string; by: string; at: string }>(WALL_KEY).catch(() => null);
  return v?.wall ? { ...parseWall(v.wall), savedBy: v.by, savedAt: v.at } : null;
}

export async function saveSharedWall(raw: unknown, actor: Actor): Promise<WallState> {
  const wall = parseWall(typeof raw === 'string' ? raw : JSON.stringify(raw ?? null));
  await getRepo().setKv(WALL_KEY, { wall: JSON.stringify(wall), by: actor.name, at: new Date().toISOString() });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'screens_wall_shared', status: 'success', summary: `Screens wall layout shared with every device (${wall.view})` });
  return wall;
}
