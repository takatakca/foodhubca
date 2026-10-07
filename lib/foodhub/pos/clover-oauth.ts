// Clover App Market connection (OAuth v2, expiring tokens) for the "TAKATAK Food Hub" Clover app.
//
// How a merchant connects:
//  - From the Clover App Market / Clover dashboard: the merchant installs or opens the app; Clover sends the
//    browser to the app's Site URL + Alternate Launch Path (/api/foodhub/clover-connect/callback).
//      · With "Default OAuth response = CODE" Clover adds ?merchant_id=…&client_id=…&code=… and we exchange the code.
//      · Without a code (launch from the dashboard's left navigation, install from the App Market), Clover expects the
//        app to call /oauth/v2/authorize itself: the callback sends the browser there with a single-use "launch"
//        state, and Clover comes back to the same callback with the code (docs.clover.com → Merchant Dashboard
//        left navigation OAuth flow).
//  - From Food Hub: Settings → Platforms & Clover → "Connect a Clover merchant" → /api/foodhub/clover-connect/start,
//    which sends the owner to Clover's authorize page and back to the same callback.
// The callback exchanges the code (with the app secret, server-side only) for an access token + refresh token,
// stores them per merchant, and refreshes the access token automatically before it expires.
// When the merchant uninstalls the app, Clover's app webhook ("A:<appId>" DELETE) removes the tokens.
//
// Food Hub is one restaurant group's hub, so a merchant that installs the app from the Clover App Market is NOT
// wired in automatically: unless it is already known (CLOVER_MERCHANT_ID, CLOVER_MERCHANT_TOKENS,
// CLOVER_ALLOWED_MERCHANTS, a store mapped to it, or connected before) it stays "pending" — no orders sent, no
// sync, nothing written to its Clover — until the owner approves it in Settings → Platforms & Clover. The owner is
// told at once (team chat + email). Connections the owner starts from Food Hub are approved at once.
//
// At connect time only, Food Hub reads (never writes) the merchant's profile, a count of its items, categories,
// order types, tenders and devices, and its Clover App Market subscription (billing_info). That snapshot fills in
// the merchant's welcome page (/welcome/clover) — Clover expects onboarding pre-filled from the merchant's data.
//
// Env: CLOVER_CLIENT_ID = Clover App ID, CLOVER_CLIENT_SECRET = App Secret (npm run setup — never in chat).
//      CLOVER_BASE_URL (API) defaults to https://api.clover.com; CLOVER_WEB_URL (authorize page) is derived
//      from it (sandbox → https://sandbox.dev.clover.com, otherwise https://www.clover.com).
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso, publicBaseUrl, stripSlash } from '../config';
import { missingEnv } from '../env-utils';
import { legalUrls } from '../legal';
import { emailConfigured, normalizeEmail, postToChat, sendEmail } from '../notify';
import { publicUrlCheck } from '../public-url';
import { getRepo } from '../repo';
import { signWelcome, verifyWelcome } from '../session';
import { cloverFetch } from './clover-http';

export const CLOVER_CONNECT_CALLBACK = '/api/foodhub/clover-connect/callback';
export const CLOVER_WEBHOOK_PATH = '/api/foodhub/webhooks/clover';
const STORE_KEY = 'clover_oauth_merchants';
const STATE_KEY = (s: string) => `clover-connect:${s}`;
const STATE_TTL_MS = 15 * 60_000;
const REFRESH_MARGIN_S = 5 * 60; // refresh when less than 5 minutes are left
/** Owner-started states are 36 hex characters; launch states (Clover → authorize → back) start with "L". */
const OWNER_STATE = /^[a-f0-9]{36}$/;
const LAUNCH_STATE = /^L[a-f0-9]{36}$/;

/** What Food Hub read from the merchant's Clover when it connected (read-only; null = not readable with this plan). */
export interface CloverMerchantProfile {
  city: string | null;
  region: string | null;
  country: string | null;
  items: number | null;
  categories: number | null;
  orderTypes: number | null;
  tenders: number | null;
  devices: number | null;
  /** Clover modules the app needs but could not read (plan without Inventory / Orders, or permission missing). */
  missing: Array<'inventory' | 'orders' | 'merchant'>;
  readAt: string;
}

/** The merchant's Clover App Market subscription to this app (GET /v3/apps/{appId}/merchants/{mId}/billing_info). */
export interface CloverBilling {
  /** ACTIVE, LAPSED, SUPPRESSED, INACTIVE… as Clover sends it; null = Clover did not say. */
  status: string | null;
  inTrial: boolean;
  plan: string | null;
  daysLapsed: number | null;
  checkedAt: string;
}

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
  profile?: CloverMerchantProfile | null;
  billing?: CloverBilling | null;
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
  profile: CloverMerchantProfile | null;
  billing: CloverBilling | null;
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
  const appId = process.env.CLOVER_CLIENT_ID || null;
  return {
    configured: missing.length === 0,
    appId,
    missing,
    siteUrl: publicBaseUrl(),
    launchPath: CLOVER_CONNECT_CALLBACK,
    redirectUri: cloverRedirectUri(),
    webhookUrl: `${publicBaseUrl()}${CLOVER_WEBHOOK_PATH}`,
    sandbox: /sandbox/i.test(apiBase()),
    domain: publicUrlCheck(),
    legal: legalUrls(),
    // Public contact (also on /legal/support), for the functional description Clover reviewers read.
    supportEmail: process.env.FOODHUB_SUPPORT_EMAIL || null,
    legalStatus: {
      supportEmailSet: Boolean(process.env.FOODHUB_SUPPORT_EMAIL),
      supportPhoneSet: Boolean(process.env.FOODHUB_SUPPORT_PHONE),
      approved: process.env.FOODHUB_LEGAL_APPROVED === 'true',
    },
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
    profile: c.profile ?? null,
    billing: c.billing ?? null,
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

async function authorizeUrl(state: string): Promise<string> {
  const qs = new URLSearchParams({ client_id: process.env.CLOVER_CLIENT_ID || '', redirect_uri: cloverRedirectUri(), state });
  return `${cloverWebUrl()}/oauth/v2/authorize?${qs}`;
}

/** Owner-initiated connect: returns Clover's authorize URL (state is single-use, 15 minutes). */
export async function startCloverConnect(actor?: string | null): Promise<string> {
  const state = crypto.randomBytes(18).toString('hex');
  await getRepo().setKv(STATE_KEY(state), { createdAt: Date.now(), actor: actor ?? null });
  return authorizeUrl(state);
}

/** Launch state = "L" + 8 random bytes + expiry (unix seconds, 8 hex) + 6-byte HMAC with the app secret. Stateless:
 *  the callback is public, so a launch must not write anything to the database. */
function launchSig(body: string): string {
  return crypto.createHmac('sha256', process.env.CLOVER_CLIENT_SECRET || '').update(`clover-launch:${body}`).digest('hex').slice(0, 12);
}
function launchStateValid(state: string, nowMs = Date.now()): boolean {
  const body = state.slice(1, 25);
  const sig = state.slice(25);
  const expected = launchSig(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return parseInt(body.slice(16), 16) * 1000 > nowMs;
}

/**
 * Launch from Clover without a code (dashboard left navigation, App Market install): Clover expects the app to call
 * /oauth/v2/authorize. The "launch" state marks the round trip as coming from Clover (same approval rules as a
 * direct launch) and makes sure we only send the browser to Clover once — a second visit without a code is an error.
 */
export async function startCloverLaunch(nowMs = Date.now()): Promise<string> {
  const body = `${crypto.randomBytes(8).toString('hex')}${Math.floor((nowMs + STATE_TTL_MS) / 1000).toString(16).padStart(8, '0')}`;
  return authorizeUrl(`L${body}${launchSig(body)}`);
}

/** True for a state made by startCloverLaunch (the callback then answers on the public welcome page). */
export function isLaunchState(state: string | null | undefined): boolean {
  return LAUNCH_STATE.test(String(state || ''));
}

/** Consumes a state created by startCloverConnect / startCloverLaunch. Missing state = launch from Clover itself (allowed). */
async function consumeState(state: string | null | undefined): Promise<{ ok: boolean; actor: string | null; fromClover: boolean }> {
  if (!state) return { ok: true, actor: null, fromClover: true };
  if (LAUNCH_STATE.test(state)) return { ok: launchStateValid(state), actor: null, fromClover: true };
  if (!OWNER_STATE.test(state)) return { ok: false, actor: null, fromClover: false };
  const s = await getRepo().getKv<{ createdAt: number; actor: string | null; used?: boolean }>(STATE_KEY(state));
  if (!s || s.used || Date.now() - s.createdAt > STATE_TTL_MS) return { ok: false, actor: null, fromClover: false };
  await getRepo().setKv(STATE_KEY(state), { ...s, used: true }); // single use (fh_kv.value is NOT NULL: mark, never null)
  return { ok: true, actor: s.actor, fromClover: false };
}

type TokenResponse = { access_token?: string; access_token_expiration?: number; refresh_token?: string; refresh_token_expiration?: number; message?: string };

async function postJson(path: string, body: Record<string, string>): Promise<{ ok: boolean; status: number; json: TokenResponse }> {
  const res = await cloverFetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, status: res.status, json };
}

async function cloverGet(token: string, path: string): Promise<{ status: number; json: any }> {
  try {
    const res = await cloverFetch(`${apiBase()}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    return { status: res.status, json: res.ok ? await res.json().catch(() => ({})) : null };
  } catch {
    return { status: 0, json: null };
  }
}

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const count = (r: { status: number; json: any }) => (r.json && Array.isArray(r.json.elements) ? r.json.elements.length : null);
const denied = (r: { status: number }) => r.status === 401 || r.status === 403;

/** Merchant profile + register snapshot — read-only, a handful of GETs, only when the merchant connects. */
async function readMerchant(mid: string, token: string): Promise<{ name: string | null; profile: CloverMerchantProfile }> {
  const m = encodeURIComponent(mid);
  const merchant = await cloverGet(token, `/v3/merchants/${m}?expand=address`);
  // Five reads at once at most: Clover allows 5 concurrent requests per token.
  const [items, categories, orderTypes, tenders, devices] = await Promise.all([
    cloverGet(token, `/v3/merchants/${m}/items?limit=1000`),
    cloverGet(token, `/v3/merchants/${m}/categories?limit=1000`),
    cloverGet(token, `/v3/merchants/${m}/order_types?limit=100`),
    cloverGet(token, `/v3/merchants/${m}/tenders?limit=100`),
    cloverGet(token, `/v3/merchants/${m}/devices?limit=100`),
  ]);
  const missing: CloverMerchantProfile['missing'] = [];
  if (denied(items) || denied(categories)) missing.push('inventory');
  if (denied(orderTypes)) missing.push('orders');
  if (denied(merchant)) missing.push('merchant');
  const a = merchant.json?.address ?? {};
  return {
    name: str(merchant.json?.name, 120),
    profile: {
      city: str(a.city), region: str(a.state), country: str(a.country, 4),
      items: count(items), categories: count(categories), orderTypes: count(orderTypes), tenders: count(tenders), devices: count(devices),
      missing, readAt: nowIso(),
    },
  };
}

/** The merchant's App Market subscription (free apps report a subscription too). Null when Clover does not answer. */
async function readBilling(mid: string, token: string): Promise<CloverBilling | null> {
  const appId = process.env.CLOVER_CLIENT_ID;
  if (!appId) return null;
  const r = await cloverGet(token, `/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(mid)}/billing_info`);
  if (!r.json) return null;
  const j = r.json as { status?: string; isInTrial?: boolean; appSubscription?: { name?: string }; daysLapsed?: number };
  return {
    status: str(j.status, 30)?.toUpperCase() ?? null,
    inTrial: Boolean(j.isInTrial),
    plan: str(j.appSubscription?.name, 80),
    daysLapsed: typeof j.daysLapsed === 'number' ? j.daysLapsed : null,
    checkedAt: nowIso(),
  };
}

/** Why a connection failed — a stable code the welcome page turns into French / English. */
export type CloverConnectError = 'not_configured' | 'no_code' | 'bad_merchant' | 'wrong_app' | 'state_expired' | 'code_refused' | 'clover_denied';

export const CLOVER_CONNECT_ERRORS: Record<CloverConnectError, { fr: string; en: string }> = {
  not_configured: { fr: 'L’application n’est pas encore configurée sur notre serveur. Écrivez-nous : nous la réglons rapidement.', en: 'The app is not set up on our server yet. Contact us and we will fix it quickly.' },
  no_code: { fr: 'Clover n’a pas renvoyé d’autorisation. Rouvrez l’application depuis votre tableau de bord Clover.', en: 'Clover did not send an authorization back. Open the app again from your Clover dashboard.' },
  bad_merchant: { fr: 'Clover n’a pas indiqué de marchand valide. Rouvrez l’application depuis votre tableau de bord Clover.', en: 'Clover did not identify a valid merchant. Open the app again from your Clover dashboard.' },
  wrong_app: { fr: 'Ce lien Clover appartient à une autre application.', en: 'This Clover link belongs to a different app.' },
  state_expired: { fr: 'Ce lien de branchement a expiré ou a déjà servi. Recommencez depuis Clover.', en: 'This connection link expired or was already used. Start again from Clover.' },
  code_refused: { fr: 'Clover a refusé l’autorisation. Rouvrez l’application depuis Clover dans quelques minutes.', en: 'Clover refused the authorization. Open the app again from Clover in a few minutes.' },
  clover_denied: { fr: 'L’accès a été refusé dans Clover. Pour brancher Food Hub, acceptez les autorisations demandées.', en: 'Access was declined in Clover. To connect Food Hub, accept the requested permissions.' },
};

export type CloverConnectResult =
  | { ok: true; merchantId: string; name: string | null; pending: boolean; fromClover: boolean }
  | { ok: false; error: string; code: CloverConnectError; fromClover: boolean };

/** Callback: exchange the code for tokens and store them for this merchant. */
export async function finishCloverConnect(params: { code?: string | null; merchantId?: string | null; clientId?: string | null; state?: string | null }): Promise<CloverConnectResult> {
  const launch = !params.state || isLaunchState(params.state);
  const fail = (code: CloverConnectError, error: string): CloverConnectResult => ({ ok: false, code, error, fromClover: launch });
  if (!cloverAppConfigured()) return fail('not_configured', 'Clover app keys are missing (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET — npm run setup).');
  const code = String(params.code || '');
  const mid = String(params.merchantId || '').trim();
  if (!code) return fail('no_code', 'Clover did not return a code.');
  if (!/^[A-Z0-9]{8,20}$/i.test(mid)) return fail('bad_merchant', 'Clover did not return a valid merchant ID.');
  if (params.clientId && params.clientId !== process.env.CLOVER_CLIENT_ID) return fail('wrong_app', 'This Clover link is for a different app.');
  const st = await consumeState(params.state);
  if (!st.ok) return fail('state_expired', 'This connection link expired or was already used. Start again from Food Hub.');

  const r = await postJson('/oauth/v2/token', { client_id: process.env.CLOVER_CLIENT_ID || '', client_secret: process.env.CLOVER_CLIENT_SECRET || '', code });
  if (!r.ok || !r.json.access_token) {
    return fail('code_refused', `Clover refused the code (HTTP ${r.status}${r.json.message ? `: ${String(r.json.message).slice(0, 120)}` : ''}).`);
  }
  const { name, profile } = await readMerchant(mid, r.json.access_token);
  const billing = await readBilling(mid, r.json.access_token);
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
    profile,
    billing: billing ?? prev?.billing ?? null,
  };
  await writeAll(all);
  const label = all[mid].name ? `${all[mid].name} (${mid})` : mid;
  await logActivity(approved
    ? { actor: st.actor || 'Clover', source: st.fromClover ? 'platform' : 'dashboard', kind: 'settings', action: 'clover_connected', status: 'success',
        summary: `Clover merchant ${label} connected to Food Hub${st.fromClover ? ' from Clover' : ''}.` }
    : { actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_pending', status: 'info',
        summary: `Clover merchant ${label} opened the TAKATAK Food Hub app from Clover. It is waiting for your approval (Settings → Platforms & Clover) — nothing is sent to it until then.` });
  // Tell the owner once per new request (not on every re-open), without holding up the merchant's browser.
  if (!approved && prev?.status !== 'pending') void tellOwnerPending(label).catch(() => undefined);
  return { ok: true, merchantId: mid, name: all[mid].name ?? null, pending: !approved, fromClover: st.fromClover };
}

/** Team chat + owner email: a Clover merchant is waiting for approval (Clover reviewers install the app this way too). */
async function tellOwnerPending(label: string): Promise<void> {
  const link = `${publicBaseUrl()}/settings/clover-app`;
  const fr = `Le marchand Clover ${label} a ouvert TAKATAK Food Hub depuis Clover et attend votre approbation. Rien ne lui est envoyé avant.`;
  const en = `Clover merchant ${label} opened TAKATAK Food Hub from Clover and is waiting for your approval. Nothing is sent to it until then.`;
  await postToChat({ title: 'Clover — marchand en attente · merchant waiting', text: `${fr}\n${en}`, severity: 'warning', link }, { purpose: 'clover_pending' });
  const owner = normalizeEmail(process.env.FOODHUB_OWNER_EMAIL);
  if (owner && emailConfigured()) {
    await sendEmail({ to: owner, subject: `Clover : ${label} attend votre approbation · is waiting for your approval`, text: `${fr}\n\n${en}\n\n${link}` }, { purpose: 'clover_pending' });
  }
}

/** Link for the public welcome page: a signed ticket for this merchant, or the plain status when no ticket can be signed. */
export async function cloverWelcomeQuery(r: CloverConnectResult): Promise<Record<string, string>> {
  if (!r.ok) return { status: 'error', err: r.code };
  const t = await signWelcome(r.merchantId);
  if (t) return { t };
  return { status: r.pending ? 'pending' : 'connected' };
}

export interface CloverWelcome {
  merchantId: string;
  name: string | null;
  /** 'gone' = the ticket is valid but the merchant was declined or uninstalled the app since. */
  status: 'active' | 'pending' | 'gone';
  profile: CloverMerchantProfile | null;
  billing: CloverBilling | null;
}

/** What the welcome page may show for a ticket: that merchant's own connection, live (never tokens). */
export async function cloverWelcome(ticket: string | null | undefined): Promise<CloverWelcome | null> {
  const p = await verifyWelcome(ticket);
  if (!p?.m) return null;
  const c = (await readAll())[p.m];
  if (!c) return { merchantId: p.m, name: null, status: 'gone', profile: null, billing: null };
  return { merchantId: c.merchantId, name: c.name ?? null, status: c.status === 'pending' ? 'pending' : 'active', profile: c.profile ?? null, billing: c.billing ?? null };
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

/** Subscription changed in Clover (App webhook UPDATE): read the merchant's billing_info again (approved merchants only). */
export async function refreshCloverBilling(merchantId: string): Promise<CloverBilling | null> {
  const token = await cloverOAuthToken(merchantId);
  if (!token) return null;
  const billing = await readBilling(merchantId, token);
  if (!billing) return null;
  const all = await readAll();
  if (!all[merchantId]) return null;
  all[merchantId] = { ...all[merchantId], billing };
  await writeAll(all);
  return billing;
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
      } else if (type === 'UPDATE') {
        await refreshCloverBilling(mid);
      }
    }
  }
  return out;
}
