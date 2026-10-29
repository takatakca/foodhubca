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

export interface ScreenCommand { kind: 'reload'; at: string; by: string }

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
export function checkViewUrl(raw: unknown): { url: string } | { error: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Adresse de l’écran requise. / Screen address required.' };
  if (text.length > 500) return { error: 'Adresse trop longue. / Address too long.' };
  let u: URL;
  try { u = new URL(text); } catch { return { error: 'Adresse invalide. / Invalid address.' }; }
  if (u.username || u.password) return { error: 'Ne mettez jamais de nom d’utilisateur ni de mot de passe dans l’adresse. / Never put a user name or password in the address.' };
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { error: 'L’adresse doit commencer par https://. / The address must start with https://.' };
  return { url: u.toString() };
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
export async function recordHeartbeat(hb: Heartbeat, now = new Date()): Promise<{ commands: Array<{ id: string; kind: ScreenCommand['kind'] }>; unknown: string[] }> {
  const commands: Array<{ id: string; kind: ScreenCommand['kind'] }> = [];
  const unknown: string[] = [];
  for (const r of hb.screens) {
    const s = await getScreen(r.id);
    if (!s) { unknown.push(r.id); continue; }
    const title = r.title ? r.title.slice(0, 120) : null;
    const wasLogin = s.state === 'login';
    if (s.command) commands.push({ id: s.id, kind: s.command.kind });
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
