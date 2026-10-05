// Clover App Market connection (OAuth v2, expiring tokens) for the "TAKATAK Food Hub" Clover app.
//
// How a merchant connects:
//  - From the Clover App Market / Clover dashboard: the merchant installs or opens the app; Clover sends the
//    browser to the app's Site URL + Alternate Launch Path (/api/foodhub/clover-connect/callback) with
//    ?merchant_id=…&client_id=…&code=….
//  - From Food Hub: Settings → Platforms & Clover → "Connect a Clover merchant" → /api/foodhub/clover-connect/start,
//    which sends the owner to Clover's authorize page and back to the same callback.
// The callback exchanges the code (with the app secret, server-side only) for an access token + refresh token,
// stores them per merchant, and refreshes the access token automatically before it expires.
// When the merchant uninstalls the app, Clover's app webhook ("A:<appId>" DELETE) removes the tokens.
//
// Food Hub is one restaurant group's hub, so a merchant that installs the app from the Clover App Market is NOT
// wired in automatically: unless it is already known (CLOVER_MERCHANT_ID, CLOVER_MERCHANT_TOKENS,
// CLOVER_ALLOWED_MERCHANTS, a store mapped to it, or connected before) it stays "pending" — no orders sent, no
// sync — until the owner approves it in Settings → Platforms & Clover. Connections the owner starts from Food Hub
// are approved at once.
//
// Env: CLOVER_CLIENT_ID = Clover App ID, CLOVER_CLIENT_SECRET = App Secret (npm run setup — never in chat).
//      CLOVER_BASE_URL (API) defaults to https://api.clover.com; CLOVER_WEB_URL (authorize page) is derived
//      from it (sandbox → https://sandbox.dev.clover.com, otherwise https://www.clover.com).
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso, publicBaseUrl, stripSlash, timedFetch } from '../config';
import { missingEnv } from '../env-utils';
import { legalUrls } from '../legal';
import { getRepo } from '../repo';

export const CLOVER_CONNECT_CALLBACK = '/api/foodhub/clover-connect/callback';
const STORE_KEY = 'clover_oauth_merchants';
const STATE_KEY = (s: string) => `clover-connect:${s}`;
const STATE_TTL_MS = 15 * 60_000;
const REFRESH_MARGIN_S = 5 * 60; // refresh when less than 5 minutes are left

export interface CloverConnection {
  merchantId: string;
  name?: string | null;
  accessToken: string;
  accessTokenExpiration?: number | null;   // unix seconds
  refreshToken?: string | null;
  refreshTokenExpiration?: number | null;  // unix seconds
  connectedAt: string;
  refreshedAt?: string | null;
  connectedBy?: string | null;
  /** 'pending' = installed from Clover by a merchant the owner has not approved yet (tokens kept, never used). */
  status?: 'active' | 'pending';
  approvedBy?: string | null;
}

/** Public view of a connection — never includes tokens. */
export interface CloverConnectionInfo {
  merchantId: string;
  name: string | null;
  connectedAt: string;
  refreshedAt: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  needsReconnect: boolean;
  status: 'active' | 'pending';
}

function apiBase() { return stripSlash(process.env.CLOVER_BASE_URL || 'https://api.clover.com'); }

export function cloverWebUrl(): string {
  if (process.env.CLOVER_WEB_URL) return stripSlash(process.env.CLOVER_WEB_URL);
  return /sandbox|apisandbox/i.test(apiBase()) ? 'https://sandbox.dev.clover.com' : 'https://www.clover.com';
}

export function cloverRedirectUri() { return `${publicBaseUrl()}${CLOVER_CONNECT_CALLBACK}`; }

export function cloverAppConfigured(): boolean {
  return missingEnv(['CLOVER_CLIENT_ID', 'CLOVER_CLIENT_SECRET']).length === 0;
}

export function cloverAppReadiness() {
  const missing = missingEnv(['CLOVER_CLIENT_ID', 'CLOVER_CLIENT_SECRET']);
  return {
    configured: missing.length === 0,
    appId: process.env.CLOVER_CLIENT_ID || null,
    missing,
    siteUrl: publicBaseUrl(),
    launchPath: CLOVER_CONNECT_CALLBACK,
    redirectUri: cloverRedirectUri(),
    legal: legalUrls(),
    legalStatus: { supportEmailSet: Boolean(process.env.FOODHUB_SUPPORT_EMAIL), approved: process.env.FOODHUB_LEGAL_APPROVED === 'true' },
  };
}

async function readAll(): Promise<Record<string, CloverConnection>> {
  return (await getRepo().getKv<Record<string, CloverConnection>>(STORE_KEY)) ?? {};
}
async function writeAll(all: Record<string, CloverConnection>) { await getRepo().setKv(STORE_KEY, all); }

const isoFromUnix = (s?: number | null) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null);

function info(c: CloverConnection, nowS = Math.floor(Date.now() / 1000)): CloverConnectionInfo {
  const refreshDead = Boolean(c.refreshTokenExpiration && c.refreshTokenExpiration <= nowS);
  const accessDead = Boolean(c.accessTokenExpiration && c.accessTokenExpiration <= nowS);
  return {
    merchantId: c.merchantId,
    name: c.name ?? null,
    connectedAt: c.connectedAt,
    refreshedAt: c.refreshedAt ?? null,
    accessExpiresAt: isoFromUnix(c.accessTokenExpiration),
    refreshExpiresAt: isoFromUnix(c.refreshTokenExpiration),
    needsReconnect: accessDead && (!c.refreshToken || refreshDead),
    status: c.status === 'pending' ? 'pending' : 'active',
  };
}

export async function listCloverConnections(): Promise<CloverConnectionInfo[]> {
  return Object.values(await readAll()).map((c) => info(c)).sort((a, b) => a.merchantId.localeCompare(b.merchantId));
}

/** Merchants Food Hub may use (approved). Pending installs are left out. */
export async function connectedCloverMerchantIds(): Promise<string[]> {
  return Object.values(await readAll()).filter((c) => c.status !== 'pending').map((c) => c.merchantId);
}

/** Merchants the owner already trusts: env default + token map + CLOVER_ALLOWED_MERCHANTS + stores mapped to them. */
async function preApproved(mid: string): Promise<boolean> {
  const ids = new Set<string>();
  if (process.env.CLOVER_MERCHANT_ID) ids.add(process.env.CLOVER_MERCHANT_ID);
  try { for (const k of Object.keys(JSON.parse(process.env.CLOVER_MERCHANT_TOKENS || '{}'))) ids.add(k); } catch { /* ignore */ }
  for (const k of String(process.env.CLOVER_ALLOWED_MERCHANTS || '').split(/[\s,;]+/)) if (k) ids.add(k.trim());
  if (ids.has(mid)) return true;
  const stores = await getRepo().listStores().catch(() => []);
  return stores.some((s) => s.cloverMerchantId === mid);
}

/** Owner-initiated connect: returns Clover's authorize URL (state is single-use, 15 minutes). */
export async function startCloverConnect(actor?: string | null): Promise<string> {
  const state = crypto.randomBytes(18).toString('hex');
  await getRepo().setKv(STATE_KEY(state), { createdAt: Date.now(), actor: actor ?? null });
  const qs = new URLSearchParams({ client_id: process.env.CLOVER_CLIENT_ID || '', redirect_uri: cloverRedirectUri(), state });
  return `${cloverWebUrl()}/oauth/v2/authorize?${qs}`;
}

/** Consumes a state created by startCloverConnect. Missing state = launch from Clover itself (allowed). */
async function consumeState(state: string | null | undefined): Promise<{ ok: boolean; actor: string | null; fromClover: boolean }> {
  if (!state) return { ok: true, actor: null, fromClover: true };
  if (!/^[a-f0-9]{36}$/.test(state)) return { ok: false, actor: null, fromClover: false };
  const s = await getRepo().getKv<{ createdAt: number; actor: string | null; used?: boolean }>(STATE_KEY(state));
  if (!s || s.used || Date.now() - s.createdAt > STATE_TTL_MS) return { ok: false, actor: null, fromClover: false };
  await getRepo().setKv(STATE_KEY(state), { ...s, used: true });
  return { ok: true, actor: s.actor, fromClover: false };
}

type TokenResponse = { access_token?: string; access_token_expiration?: number; refresh_token?: string; refresh_token_expiration?: number; message?: string };

async function postJson(path: string, body: Record<string, string>): Promise<{ ok: boolean; status: number; json: TokenResponse }> {
  const res = await timedFetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, status: res.status, json };
}

async function merchantName(mid: string, token: string): Promise<string | null> {
  try {
    const res = await timedFetch(`${apiBase()}/v3/merchants/${encodeURIComponent(mid)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { name?: string };
    return j.name ? String(j.name).slice(0, 120) : null;
  } catch { return null; }
}

export type CloverConnectResult = { ok: true; merchantId: string; name: string | null; pending: boolean } | { ok: false; error: string };

/** Callback: exchange the code for tokens and store them for this merchant. */
export async function finishCloverConnect(params: { code?: string | null; merchantId?: string | null; clientId?: string | null; state?: string | null }): Promise<CloverConnectResult> {
  if (!cloverAppConfigured()) return { ok: false, error: 'Clover app keys are missing (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET — npm run setup).' };
  const code = String(params.code || '');
  const mid = String(params.merchantId || '').trim();
  if (!code) return { ok: false, error: 'Clover did not return a code.' };
  if (!/^[A-Z0-9]{8,20}$/i.test(mid)) return { ok: false, error: 'Clover did not return a valid merchant ID.' };
  if (params.clientId && params.clientId !== process.env.CLOVER_CLIENT_ID) return { ok: false, error: 'This Clover link is for a different app.' };
  const st = await consumeState(params.state);
  if (!st.ok) return { ok: false, error: 'This connection link expired or was already used. Start again from Food Hub.' };

  const r = await postJson('/oauth/v2/token', { client_id: process.env.CLOVER_CLIENT_ID || '', client_secret: process.env.CLOVER_CLIENT_SECRET || '', code });
  if (!r.ok || !r.json.access_token) {
    return { ok: false, error: `Clover refused the code (HTTP ${r.status}${r.json.message ? `: ${String(r.json.message).slice(0, 120)}` : ''}).` };
  }
  const name = await merchantName(mid, r.json.access_token);
  const all = await readAll();
  const prev = all[mid];
  // Owner-started connections and already-trusted merchants are active; a new install from Clover waits for the owner.
  const approved = !st.fromClover || prev?.status === 'active' || (prev && prev.status === undefined) || (await preApproved(mid));
  all[mid] = {
    merchantId: mid,
    name: name ?? prev?.name ?? null,
    accessToken: r.json.access_token,
    accessTokenExpiration: r.json.access_token_expiration ?? null,
    refreshToken: r.json.refresh_token ?? null,
    refreshTokenExpiration: r.json.refresh_token_expiration ?? null,
    connectedAt: prev?.connectedAt ?? nowIso(),
    refreshedAt: nowIso(),
    connectedBy: st.actor ?? (st.fromClover ? 'Clover App Market' : null),
    status: approved ? 'active' : 'pending',
    approvedBy: approved ? (st.actor ?? prev?.approvedBy ?? (st.fromClover ? 'allow-list' : null)) : null,
  };
  await writeAll(all);
  const label = name ? `${name} (${mid})` : mid;
  await logActivity(approved
    ? { actor: st.actor || 'Clover', source: st.fromClover ? 'platform' : 'dashboard', kind: 'settings', action: 'clover_connected', status: 'success',
        summary: `Clover merchant ${label} connected to Food Hub${st.fromClover ? ' from Clover' : ''}.` }
    : { actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_pending', status: 'info',
        summary: `Clover merchant ${label} opened the TAKATAK Food Hub app from Clover. It is waiting for your approval (Settings → Platforms & Clover) — nothing is sent to it until then.` });
  return { ok: true, merchantId: mid, name: all[mid].name ?? null, pending: !approved };
}

/** Owner approves a merchant that installed the app from Clover. */
export async function approveCloverMerchant(merchantId: string, actor: string): Promise<boolean> {
  const all = await readAll();
  const c = all[merchantId];
  if (!c) return false;
  if (c.status !== 'pending') return true;
  all[merchantId] = { ...c, status: 'active', approvedBy: actor };
  await writeAll(all);
  await logActivity({ actor, source: 'dashboard', kind: 'settings', action: 'clover_approved', status: 'success',
    summary: `Clover merchant ${c.name || merchantId} approved — Food Hub now sends its orders to Clover and syncs it.` });
  return true;
}

const inflight = new Map<string, Promise<string | null>>();

async function refresh(c: CloverConnection): Promise<string | null> {
  if (!c.refreshToken) return null;
  const r = await postJson('/oauth/v2/refresh', { client_id: process.env.CLOVER_CLIENT_ID || '', refresh_token: c.refreshToken });
  if (!r.ok || !r.json.access_token) {
    await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_refresh_failed', status: 'failed',
      summary: `Clover token refresh failed for merchant ${c.name || c.merchantId} (HTTP ${r.status}). Reconnect it in Settings → Platforms & Clover.` });
    return null;
  }
  const all = await readAll();
  const cur = all[c.merchantId] ?? c;
  all[c.merchantId] = {
    ...cur,
    accessToken: r.json.access_token,
    accessTokenExpiration: r.json.access_token_expiration ?? null,
    refreshToken: r.json.refresh_token ?? cur.refreshToken ?? null,
    refreshTokenExpiration: r.json.refresh_token_expiration ?? cur.refreshTokenExpiration ?? null,
    refreshedAt: nowIso(),
  };
  await writeAll(all);
  return r.json.access_token;
}

/** Access token for a merchant connected through the Clover app (refreshed when close to expiry). */
export async function cloverOAuthToken(merchantId: string, nowS = Math.floor(Date.now() / 1000)): Promise<string | null> {
  if (!merchantId) return null;
  const c = (await readAll())[merchantId];
  if (!c || c.status === 'pending') return null;
  const exp = c.accessTokenExpiration ?? 0;
  if (!exp || exp - nowS > REFRESH_MARGIN_S) return c.accessToken;
  if (!cloverAppConfigured()) return exp > nowS ? c.accessToken : null;
  // One refresh at a time per merchant (refresh tokens are single-use).
  let p = inflight.get(merchantId);
  if (!p) {
    p = refresh(c).finally(() => inflight.delete(merchantId));
    inflight.set(merchantId, p);
  }
  const fresh = await p;
  return fresh ?? (exp > nowS ? c.accessToken : null);
}

/** Merchant uninstalled the app (or owner disconnected it): forget its tokens. */
export async function disconnectCloverMerchant(merchantId: string, reason: 'uninstalled' | 'owner' = 'owner', actor = 'Clover'): Promise<boolean> {
  const all = await readAll();
  const c = all[merchantId];
  if (!c) return false;
  delete all[merchantId];
  await writeAll(all);
  await logActivity({
    actor, source: reason === 'uninstalled' ? 'platform' : 'dashboard', kind: 'settings', action: 'clover_disconnected', status: 'info',
    summary: reason === 'uninstalled'
      ? `Clover merchant ${c.name || merchantId} uninstalled the TAKATAK Food Hub app — its orders will no longer be sent to Clover.`
      : `Clover merchant ${c.name || merchantId} disconnected from Food Hub.`,
  });
  return true;
}

/** App webhook events: { appId, merchants: { MID: [{ objectId: "A:<appId>", type: "DELETE" | "CREATE" | "UPDATE" }] } } */
export async function handleCloverAppEvents(body: any): Promise<{ uninstalled: string[]; installed: string[] }> {
  const out = { uninstalled: [] as string[], installed: [] as string[] };
  const appId = process.env.CLOVER_CLIENT_ID || String(body?.appId || '');
  for (const [mid, events] of Object.entries((body?.merchants ?? {}) as Record<string, any[]>)) {
    for (const ev of Array.isArray(events) ? events : []) {
      const [kind, id] = String(ev?.objectId ?? '').split(':');
      if (kind !== 'A' || (appId && id && id !== appId)) continue;
      const type = String(ev?.type || '').toUpperCase();
      if (type === 'DELETE') {
        if (await disconnectCloverMerchant(mid, 'uninstalled')) out.uninstalled.push(mid);
      } else if (type === 'CREATE') {
        out.installed.push(mid);
        await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_app_installed', status: 'info',
          summary: `Clover merchant ${mid} installed the TAKATAK Food Hub app — it connects the first time the merchant opens the app.` });
      }
    }
  }
  return out;
}
