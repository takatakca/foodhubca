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
//
// Several Clover apps (clover-apps.ts): every function takes the app as an optional last argument and defaults to
// Food Hub, so Food Hub callers are unchanged. The AI phone app ("phone") has its own keys (CLOVER_PHONE_APP_ID /
// CLOVER_PHONE_APP_SECRET), callback, token store (clover_oauth_merchants:phone) and refresh locks; uninstalling
// one app removes only that app's tokens. Every token-map write goes through one lock per map; the phone's subscription
// status has its own key per merchant (clover_phone_billing:<merchantId>). See docs/CLOVER_MULTI_APP.md.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso, publicBaseUrl, stripSlash } from '../config';
import { legalUrls } from '../legal';
import { emailConfigured, normalizeEmail, postToChat, sendEmail } from '../notify';
import { publicUrlCheck } from '../public-url';
import { getRepo } from '../repo';
import { signWelcome, verifyWelcome } from '../session';
import { cloverApp, cloverAppKeysSet, cloverAppMissing, isCloverAppKey, phoneOwnMerchants, type CloverAppKey } from './clover-apps';
import { cloverFetch, type CloverFetchOptions } from './clover-http';

export const CLOVER_CONNECT_CALLBACK = '/api/foodhub/clover-connect/callback';
export const CLOVER_WEBHOOK_PATH = '/api/foodhub/webhooks/clover';
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
  /** Clover subscription ID (appSubscription.id): maps a tier exactly, whatever its display name. */
  planId?: string | null;
  /** End of the free trial when Clover says it (trial end time, or days left in the trial); absent otherwise. */
  trialEndsAt?: string | null;
  /** Tier price Clover reports (appSubscription.amount, in cents; 0 = a free tier); absent when Clover does not send it. */
  amountCents?: number | null;
  checkedAt: string;
}

/**
 * Subscription status of a sold app (the phone) for one merchant, kept under its OWN key per merchant
 * (clover_<app>_billing:<merchantId>), never inside the token map: the live-call check writes it, and a write there must
 * never put back an older token record of another merchant (Clover refresh tokens are single-use).
 */
export interface CloverBillingState {
  billing: CloverBilling | null;
  /** Last time Clover answered ACTIVE or "in trial" for this app (entitlement grace when Clover does not answer). */
  billingLastGoodAt?: string | null;
  /** First time Clover answered LAPSED in a row (grace for live calls); cleared by any other answer. */
  lapsedSince?: string | null;
  /** The saved billing must be read again (an App event arrived for this app). */
  billingStale?: boolean;
  /** Last time asking Clover failed or ran out of time: Clover is not asked again for a few minutes. */
  checkFailedAt?: string | null;
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
  /** Clover App ID the tokens were issued for (absent on connections saved before several apps existed). */
  appId?: string | null;
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

export function cloverRedirectUri(app: CloverAppKey = 'foodhub') { return `${publicBaseUrl()}${cloverApp(app).callbackPath}`; }

export function cloverAppConfigured(app: CloverAppKey = 'foodhub'): boolean {
  return cloverAppKeysSet(app);
}

export function cloverAppReadiness(app: CloverAppKey = 'foodhub') {
  const def = cloverApp(app);
  const missing = cloverAppMissing(app);
  const appId = def.appId;
  return {
    configured: missing.length === 0,
    appId,
    missing,
    siteUrl: publicBaseUrl(),
    launchPath: def.callbackPath,
    redirectUri: cloverRedirectUri(app),
    webhookUrl: `${publicBaseUrl()}${def.webhookPath}`,
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

async function readAll(app: CloverAppKey = 'foodhub'): Promise<Record<string, CloverConnection>> {
  return (await getRepo().getKv<Record<string, CloverConnection>>(cloverApp(app).tokenStoreKey)) ?? {};
}

/**
 * One read-modify-write at a time per KV key in this process. Every change to a token map (connect, refresh, approve,
 * patch, disconnect, billing refresh) goes through it, so two merchants' writes never undo each other. Across server
 * instances the token map is only written on rare events (connect, token refresh, approve, uninstall); the per-call
 * subscription check writes its own per-merchant key instead (CloverBillingState).
 */
const kvLocks = new Map<string, Promise<unknown>>();
function withKvLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = kvLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  kvLocks.set(key, next);
  void next.finally(() => { if (kvLocks.get(key) === next) kvLocks.delete(key); }).catch(() => undefined);
  return next;
}

/** Change one app's token map under its lock: `change` gets a fresh copy and returns what to give back; `write` false = leave it. */
async function updateAll<T>(app: CloverAppKey, change: (all: Record<string, CloverConnection>) => Promise<{ write: boolean; result: T }> | { write: boolean; result: T }): Promise<T> {
  const key = cloverApp(app).tokenStoreKey;
  return withKvLock(key, async () => {
    const all = await readAll(app);
    const { write, result } = await change(all);
    if (write) await getRepo().setKv(key, all);
    return result;
  });
}

const billingKey = (app: CloverAppKey, mid: string) => `clover_${app}_billing:${mid}`;
const EMPTY_BILLING_STATE: CloverBillingState = { billing: null, billingLastGoodAt: null, lapsedSince: null, billingStale: false, checkFailedAt: null };

/** A sold app's saved subscription status for a merchant (its own key; empty when never read). Food Hub keeps it on the connection. */
export async function readCloverBillingState(merchantId: string, app: CloverAppKey): Promise<CloverBillingState> {
  if (!merchantId) return { ...EMPTY_BILLING_STATE };
  const s = await getRepo().getKv<CloverBillingState>(billingKey(app, merchantId)).catch(() => null);
  return { ...EMPTY_BILLING_STATE, ...(s ?? {}) };
}

/** Merge fields into a sold app's subscription status for a merchant (its own key: the token map is never rewritten). */
export async function patchCloverBillingState(merchantId: string, patch: Partial<CloverBillingState>, app: CloverAppKey): Promise<CloverBillingState> {
  const key = billingKey(app, merchantId);
  return withKvLock(key, async () => {
    const cur = { ...EMPTY_BILLING_STATE, ...((await getRepo().getKv<CloverBillingState>(key).catch(() => null)) ?? {}) };
    const next = { ...cur, ...patch };
    await getRepo().setKv(key, next);
    return next;
  });
}

/**
 * One app's saved connection for a merchant, tokens included (server-side only — never return it from an API).
 * Tokens are kept per (app, merchant). For a sold app (not Food Hub), a connection issued to another Clover App ID
 * (the App ID env was changed since) is ignored. Food Hub connections saved before several apps existed have no
 * appId and are read as Food Hub's, exactly as before.
 */
export async function readCloverConnection(merchantId: string, app: CloverAppKey = 'foodhub'): Promise<CloverConnection | null> {
  if (!merchantId) return null;
  const c = (await readAll(app))[merchantId];
  if (!c) return null;
  if (app !== 'foodhub' && c.appId && c.appId !== cloverApp(app).appId) return null;
  return c;
}

/** Merge fields into one app's connection for a merchant (re-read first; false = not connected any more). */
export async function patchCloverConnection(merchantId: string, patch: Partial<CloverConnection>, app: CloverAppKey = 'foodhub'): Promise<boolean> {
  return updateAll(app, (all) => {
    if (!all[merchantId]) return { write: false, result: false };
    all[merchantId] = { ...all[merchantId], ...patch };
    return { write: true, result: true };
  });
}

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

/** The subscription to show for a connection: Food Hub's is on the record; a sold app's latest is in its own key. */
async function shownBilling(c: CloverConnection, app: CloverAppKey): Promise<CloverBilling | null> {
  if (app === 'foodhub') return c.billing ?? null;
  return (await readCloverBillingState(c.merchantId, app)).billing ?? c.billing ?? null;
}

export async function listCloverConnections(app: CloverAppKey = 'foodhub'): Promise<CloverConnectionInfo[]> {
  const list = await Promise.all(Object.values(await readAll(app)).map(async (c) => ({ ...info(c), billing: await shownBilling(c, app) })));
  return list.sort((a, b) => a.merchantId.localeCompare(b.merchantId));
}

/** Merchants Food Hub may use (approved). Pending installs are left out. */
export async function connectedCloverMerchantIds(app: CloverAppKey = 'foodhub'): Promise<string[]> {
  return Object.values(await readAll(app)).filter((c) => c.status !== 'pending').map((c) => c.merchantId);
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

/** The phone app also trusts our own restaurants (PHONE_OWN_MERCHANTS) and merchants already approved in Food Hub. */
async function preApprovedFor(mid: string, app: CloverAppKey): Promise<boolean> {
  if (await preApproved(mid)) return true;
  if (app === 'foodhub') return false;
  if (phoneOwnMerchants().has(mid)) return true;
  return (await connectedCloverMerchantIds('foodhub').catch(() => [] as string[])).includes(mid);
}

async function authorizeUrl(state: string, app: CloverAppKey = 'foodhub'): Promise<string> {
  const qs = new URLSearchParams({ client_id: cloverApp(app).appId || '', redirect_uri: cloverRedirectUri(app), state });
  return `${cloverWebUrl()}/oauth/v2/authorize?${qs}`;
}

/** Owner-initiated connect: returns Clover's authorize URL (state is single-use, 15 minutes, for this app only). */
export async function startCloverConnect(actor?: string | null, app: CloverAppKey = 'foodhub'): Promise<string> {
  const state = crypto.randomBytes(18).toString('hex');
  await getRepo().setKv(STATE_KEY(state), app === 'foodhub' ? { createdAt: Date.now(), actor: actor ?? null } : { createdAt: Date.now(), actor: actor ?? null, app });
  return authorizeUrl(state, app);
}

/** Launch state = "L" + 8 random bytes + expiry (unix seconds, 8 hex) + 6-byte HMAC with the app secret. Stateless:
 *  the callback is public, so a launch must not write anything to the database. */
function launchSig(body: string, app: CloverAppKey = 'foodhub'): string {
  // Each app signs with its own secret and label: a launch state of one app is refused by the other app's callback.
  const label = app === 'foodhub' ? 'clover-launch' : `clover-launch:${app}`;
  return crypto.createHmac('sha256', cloverApp(app).secret || '').update(`${label}:${body}`).digest('hex').slice(0, 12);
}
function launchStateValid(state: string, nowMs = Date.now(), app: CloverAppKey = 'foodhub'): boolean {
  const body = state.slice(1, 25);
  const sig = state.slice(25);
  const expected = launchSig(body, app);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return parseInt(body.slice(16), 16) * 1000 > nowMs;
}

/**
 * Launch from Clover without a code (dashboard left navigation, App Market install): Clover expects the app to call
 * /oauth/v2/authorize. The "launch" state marks the round trip as coming from Clover (same approval rules as a
 * direct launch) and makes sure we only send the browser to Clover once — a second visit without a code is an error.
 */
export async function startCloverLaunch(nowMs = Date.now(), app: CloverAppKey = 'foodhub'): Promise<string> {
  const body = `${crypto.randomBytes(8).toString('hex')}${Math.floor((nowMs + STATE_TTL_MS) / 1000).toString(16).padStart(8, '0')}`;
  return authorizeUrl(`L${body}${launchSig(body, app)}`, app);
}

/** True for a state made by startCloverLaunch (the callback then answers on the public welcome page). */
export function isLaunchState(state: string | null | undefined): boolean {
  return LAUNCH_STATE.test(String(state || ''));
}

/** Consumes a state created by startCloverConnect / startCloverLaunch. Missing state = launch from Clover itself (allowed). */
async function consumeState(state: string | null | undefined, app: CloverAppKey = 'foodhub'): Promise<{ ok: boolean; actor: string | null; fromClover: boolean }> {
  if (!state) return { ok: true, actor: null, fromClover: true };
  if (LAUNCH_STATE.test(state)) return { ok: launchStateValid(state, Date.now(), app), actor: null, fromClover: true };
  if (!OWNER_STATE.test(state)) return { ok: false, actor: null, fromClover: false };
  const s = await getRepo().getKv<{ createdAt: number; actor: string | null; used?: boolean; app?: CloverAppKey }>(STATE_KEY(state));
  if (!s || s.used || Date.now() - s.createdAt > STATE_TTL_MS) return { ok: false, actor: null, fromClover: false };
  if ((s.app ?? 'foodhub') !== app) return { ok: false, actor: null, fromClover: false }; // started for the other app
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

async function cloverGet(token: string, path: string, opts: CloverFetchOptions = {}): Promise<{ status: number; json: any }> {
  try {
    const res = await cloverFetch(`${apiBase()}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, opts);
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

/**
 * The merchant's App Market subscription to one app (free apps report a subscription too). Null when Clover does not
 * answer. `opts` = a short timeout and no 429 retry for a caller with a time budget (the live-call check).
 */
export async function readCloverBilling(mid: string, token: string, app: CloverAppKey = 'foodhub', opts: CloverFetchOptions = {}): Promise<CloverBilling | null> {
  const appId = cloverApp(app).appId;
  if (!appId) return null;
  const r = await cloverGet(token, `/v3/apps/${encodeURIComponent(appId)}/merchants/${encodeURIComponent(mid)}/billing_info`, opts);
  if (!r.json) return null;
  const j = r.json as { status?: string; isInTrial?: boolean; appSubscription?: { id?: string; name?: string; amount?: number }; daysLapsed?: number };
  const planId = str(j.appSubscription?.id, 40);
  const trialEndsAt = j.isInTrial ? trialEndOf(r.json as Record<string, unknown>) : null;
  const amount = j.appSubscription?.amount;
  return {
    status: str(j.status, 30)?.toUpperCase() ?? null,
    inTrial: Boolean(j.isInTrial),
    plan: str(j.appSubscription?.name, 80),
    daysLapsed: typeof j.daysLapsed === 'number' ? j.daysLapsed : null,
    ...(planId ? { planId } : {}),
    ...(trialEndsAt ? { trialEndsAt } : {}),
    ...(typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? { amountCents: Math.round(amount) } : {}),
    checkedAt: nowIso(),
  };
}

/**
 * The trial end in a billing_info answer, when Clover sends one: an end time (epoch seconds or milliseconds, or an ISO
 * date) or a number of days left. Null when it says nothing (the console then estimates it from the install date).
 */
export function trialEndOf(j: Record<string, unknown>, now = Date.now()): string | null {
  for (const k of ['trialEndTime', 'trialEndDate', 'trialEnd', 'trialEndsAt', 'trialExpirationTime']) {
    const v = j[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
    if (typeof v === 'string' && v.trim()) {
      const t = /^\d+$/.test(v.trim()) ? Number(v.trim()) : Date.parse(v);
      if (Number.isFinite(t) && t > 0) return new Date(t < 1e12 ? t * 1000 : t).toISOString();
    }
  }
  for (const k of ['trialDaysRemaining', 'daysLeftInTrial', 'remainingTrialDays', 'trialDaysLeft']) {
    const v = j[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return new Date(now + v * 24 * 3600_000).toISOString();
  }
  return null;
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
  | { ok: true; merchantId: string; name: string | null; pending: boolean; fromClover: boolean; app?: CloverAppKey }
  | { ok: false; error: string; code: CloverConnectError; fromClover: boolean; app?: CloverAppKey };

/** Callback: exchange the code for tokens and store them for this merchant (in the app's own token store). */
export async function finishCloverConnect(params: { code?: string | null; merchantId?: string | null; clientId?: string | null; state?: string | null; app?: CloverAppKey }): Promise<CloverConnectResult> {
  const app: CloverAppKey = params.app ?? 'foodhub';
  const def = cloverApp(app);
  const tag = app === 'foodhub' ? {} : { app };
  const launch = !params.state || isLaunchState(params.state);
  const fail = (code: CloverConnectError, error: string): CloverConnectResult => ({ ok: false, code, error, fromClover: launch, ...tag });
  if (!cloverAppConfigured(app)) return fail('not_configured', `Clover app keys are missing (${def.env.appId} / ${def.env.secret} — npm run setup).`);
  const code = String(params.code || '');
  const mid = String(params.merchantId || '').trim();
  if (!code) return fail('no_code', 'Clover did not return a code.');
  if (!/^[A-Z0-9]{8,20}$/i.test(mid)) return fail('bad_merchant', 'Clover did not return a valid merchant ID.');
  if (params.clientId && params.clientId !== def.appId) return fail('wrong_app', 'This Clover link is for a different app.');
  const st = await consumeState(params.state, app);
  if (!st.ok) return fail('state_expired', 'This connection link expired or was already used. Start again from Food Hub.');

  const r = await postJson('/oauth/v2/token', { client_id: def.appId || '', client_secret: def.secret || '', code });
  if (!r.ok || !r.json.access_token) {
    return fail('code_refused', `Clover refused the code (HTTP ${r.status}${r.json.message ? `: ${String(r.json.message).slice(0, 120)}` : ''}).`);
  }
  const { name, profile } = await readMerchant(mid, r.json.access_token);
  const billing = await readCloverBilling(mid, r.json.access_token, app);
  const tokens = r.json;
  const { prev, approved, saved } = await updateAll(app, async (all) => {
    const prev = all[mid];
    // Owner-started connections and already-trusted merchants are active; a new install from Clover waits for the owner.
    const approved = Boolean(!st.fromClover || prev?.status === 'active' || (prev && prev.status === undefined) || (await preApprovedFor(mid, app)));
    all[mid] = {
      merchantId: mid,
      name: name ?? prev?.name ?? null,
      accessToken: tokens.access_token!,
      accessTokenExpiration: tokens.access_token_expiration ?? null,
      refreshToken: tokens.refresh_token ?? null,
      refreshTokenExpiration: tokens.refresh_token_expiration ?? null,
      connectedAt: prev?.connectedAt ?? nowIso(),
      refreshedAt: nowIso(),
      connectedBy: st.actor ?? (st.fromClover ? 'Clover App Market' : null),
      status: approved ? 'active' : 'pending',
      approvedBy: approved ? (st.actor ?? prev?.approvedBy ?? (st.fromClover ? 'allow-list' : null)) : null,
      profile,
      billing: billing ?? prev?.billing ?? null,
      ...(app === 'foodhub' ? {} : { appId: def.appId }),
    };
    return { write: true, result: { prev, approved, saved: all[mid] } };
  });
  // A sold app's subscription status lives in its own key (the live-call check reads and writes it there).
  if (app !== 'foodhub') {
    const prevState = await readCloverBillingState(mid, app);
    await patchCloverBillingState(mid, billing ? { ...billingPatch(prevState, billing), checkFailedAt: null } : { billingStale: true }, app);
  }
  const label = saved.name ? `${saved.name} (${mid})` : mid;
  const target = app === 'foodhub' ? 'Food Hub' : def.name;
  await logActivity(approved
    ? { actor: st.actor || 'Clover', source: st.fromClover ? 'platform' : 'dashboard', kind: 'settings', action: 'clover_connected', status: 'success',
        summary: `Clover merchant ${label} connected to ${target}${st.fromClover ? ' from Clover' : ''}.` }
    : { actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_pending', status: 'info',
        summary: `Clover merchant ${label} opened the ${def.name} app from Clover. It is waiting for your approval (Settings → Platforms & Clover) — nothing is sent to it until then.` });
  // Tell the owner once per new request (not on every re-open), without holding up the merchant's browser.
  if (!approved && prev?.status !== 'pending') void tellOwnerPending(label, def.name).catch(() => undefined);
  return { ok: true, merchantId: mid, name: saved.name ?? null, pending: !approved, fromClover: st.fromClover, ...tag };
}

/** Team chat + owner email: a Clover merchant is waiting for approval (Clover reviewers install the app this way too). */
async function tellOwnerPending(label: string, appName = 'TAKATAK Food Hub'): Promise<void> {
  const link = `${publicBaseUrl()}/settings/clover-app`;
  const fr = `Le marchand Clover ${label} a ouvert ${appName} depuis Clover et attend votre approbation. Rien ne lui est envoyé avant.`;
  const en = `Clover merchant ${label} opened ${appName} from Clover and is waiting for your approval. Nothing is sent to it until then.`;
  await postToChat({ title: 'Clover — marchand en attente · merchant waiting', text: `${fr}\n${en}`, severity: 'warning', link }, { purpose: 'clover_pending' });
  const owner = normalizeEmail(process.env.FOODHUB_OWNER_EMAIL);
  if (owner && emailConfigured()) {
    await sendEmail({ to: owner, subject: `Clover : ${label} attend votre approbation · is waiting for your approval`, text: `${fr}\n\n${en}\n\n${link}` }, { purpose: 'clover_pending' });
  }
}

/** Link for the public welcome page: a signed ticket for this merchant, or the plain status when no ticket can be signed. */
export async function cloverWelcomeQuery(r: CloverConnectResult): Promise<Record<string, string>> {
  const phone = r.app && r.app !== 'foodhub' ? r.app : undefined;
  const appTag: Record<string, string> = phone ? { app: phone } : {};
  if (!r.ok) return { status: 'error', err: r.code, ...appTag };
  const t = await signWelcome(r.merchantId, undefined, phone);
  if (t) return { t, ...appTag };
  return { status: r.pending ? 'pending' : 'connected', ...appTag };
}

export interface CloverWelcome {
  merchantId: string;
  name: string | null;
  /** 'gone' = the ticket is valid but the merchant was declined or uninstalled the app since. */
  status: 'active' | 'pending' | 'gone';
  profile: CloverMerchantProfile | null;
  billing: CloverBilling | null;
  /** Which app the ticket was issued for (absent = Food Hub). */
  app?: CloverAppKey;
}

/** What the welcome page may show for a ticket: that merchant's own connection, live (never tokens). */
export async function cloverWelcome(ticket: string | null | undefined): Promise<CloverWelcome | null> {
  const p = await verifyWelcome(ticket);
  if (!p?.m) return null;
  const app: CloverAppKey = p.a && isCloverAppKey(p.a) ? p.a : 'foodhub';
  const tag = app === 'foodhub' ? {} : { app };
  const c = (await readAll(app))[p.m];
  if (!c) return { merchantId: p.m, name: null, status: 'gone', profile: null, billing: null, ...tag };
  return { merchantId: c.merchantId, name: c.name ?? null, status: c.status === 'pending' ? 'pending' : 'active', profile: c.profile ?? null, billing: await shownBilling(c, app), ...tag };
}

/** Owner approves a merchant that installed the app from Clover. */
export async function approveCloverMerchant(merchantId: string, actor: string, app: CloverAppKey = 'foodhub'): Promise<boolean> {
  const r = await updateAll(app, (all) => {
    const c = all[merchantId];
    if (!c) return { write: false, result: { found: false, changed: false, c } };
    if (c.status !== 'pending') return { write: false, result: { found: true, changed: false, c } };
    all[merchantId] = { ...c, status: 'active', approvedBy: actor };
    return { write: true, result: { found: true, changed: true, c } };
  });
  if (!r.found || !r.c) return false;
  if (!r.changed) return true;
  const c = r.c;
  await logActivity({ actor, source: 'dashboard', kind: 'settings', action: 'clover_approved', status: 'success',
    summary: app === 'foodhub'
      ? `Clover merchant ${c.name || merchantId} approved — Food Hub now sends its orders to Clover and syncs it.`
      : `Clover merchant ${c.name || merchantId} approved for ${cloverApp(app).name}.` });
  return true;
}

/** One refresh at a time per (app, merchant): refresh tokens are single-use, and each app has its own. */
const inflight = new Map<string, Promise<string | null>>();
const lockKey = (app: CloverAppKey, merchantId: string) => `${app}:${merchantId}`;

/** A sold app's failed refresh is written to the activity log at most once per merchant in this window. */
const REFRESH_FAIL_LOG_MS = 10 * 60_000;
const refreshFailLogged = new Map<string, number>();

async function refresh(c: CloverConnection, app: CloverAppKey = 'foodhub'): Promise<string | null> {
  if (!c.refreshToken) return null;
  // A refresh is never cut short: Clover may already have used up the single-use refresh token, and the answer
  // carries the only copy of the new one. A caller with a time budget stops waiting instead (clover-entitlement.ts).
  const r = await postJson('/oauth/v2/refresh', { client_id: cloverApp(app).appId || '', refresh_token: c.refreshToken });
  if (!r.ok || !r.json.access_token) {
    // Food Hub logs every failure, as before; a sold app (asked on every live call) at most once per window.
    const key = lockKey(app, c.merchantId);
    const last = app === 'foodhub' ? 0 : refreshFailLogged.get(key) ?? 0;
    if (Date.now() - last >= REFRESH_FAIL_LOG_MS) {
      refreshFailLogged.set(key, Date.now());
      await logActivity({ actor: 'Clover', source: 'automation', kind: 'settings', action: 'clover_refresh_failed', status: 'failed',
        summary: `Clover token refresh failed for merchant ${c.name || c.merchantId}${app === 'foodhub' ? '' : ` (${cloverApp(app).name})`} (HTTP ${r.status}). Reconnect it in Settings → Platforms & Clover.` });
    }
    return null;
  }
  refreshFailLogged.delete(lockKey(app, c.merchantId));
  const tokens = r.json;
  await updateAll(app, (all) => {
    const cur = all[c.merchantId] ?? c;
    all[c.merchantId] = {
      ...cur,
      accessToken: tokens.access_token!,
      accessTokenExpiration: tokens.access_token_expiration ?? null,
      refreshToken: tokens.refresh_token ?? cur.refreshToken ?? null,
      refreshTokenExpiration: tokens.refresh_token_expiration ?? cur.refreshTokenExpiration ?? null,
      refreshedAt: nowIso(),
    };
    return { write: true, result: null };
  });
  return tokens.access_token!;
}

/** Access token for a merchant connected through the Clover app (refreshed when close to expiry). */
export async function cloverOAuthToken(merchantId: string, nowS = Math.floor(Date.now() / 1000), app: CloverAppKey = 'foodhub'): Promise<string | null> {
  if (!merchantId) return null;
  const c = await readCloverConnection(merchantId, app);
  if (!c || c.status === 'pending') return null;
  const exp = c.accessTokenExpiration ?? 0;
  if (!exp || exp - nowS > REFRESH_MARGIN_S) return c.accessToken;
  if (!cloverAppConfigured(app)) return exp > nowS ? c.accessToken : null;
  // One refresh at a time per app and merchant (refresh tokens are single-use).
  const key = lockKey(app, merchantId);
  let p = inflight.get(key);
  if (!p) {
    p = refresh(c, app).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const fresh = await p;
  return fresh ?? (exp > nowS ? c.accessToken : null);
}

/** The access token one Clover app holds for a merchant (app first; same rules as cloverOAuthToken). */
export function cloverAppToken(app: CloverAppKey, merchantId: string, nowS?: number): Promise<string | null> {
  return cloverOAuthToken(merchantId, nowS, app);
}

/** Merchant uninstalled the app (or owner disconnected it): forget its tokens — that app's only, never another app's. */
export async function disconnectCloverMerchant(merchantId: string, reason: 'uninstalled' | 'owner' = 'owner', actor = 'Clover', app: CloverAppKey = 'foodhub'): Promise<boolean> {
  const c = await updateAll(app, (all) => {
    const cur = all[merchantId];
    if (!cur) return { write: false, result: null };
    delete all[merchantId];
    return { write: true, result: cur };
  });
  if (!c) return false;
  // A sold app also forgets the merchant's saved subscription status (a reinstall starts fresh).
  if (app !== 'foodhub') await patchCloverBillingState(merchantId, { ...EMPTY_BILLING_STATE }, app).catch(() => undefined);
  const name = cloverApp(app).name;
  await logActivity({
    actor, source: reason === 'uninstalled' ? 'platform' : 'dashboard', kind: 'settings', action: 'clover_disconnected', status: 'info',
    summary: app === 'foodhub'
      ? reason === 'uninstalled'
        ? `Clover merchant ${c.name || merchantId} uninstalled the TAKATAK Food Hub app — its orders will no longer be sent to Clover.`
        : `Clover merchant ${c.name || merchantId} disconnected from Food Hub.`
      : reason === 'uninstalled'
        ? `Clover merchant ${c.name || merchantId} uninstalled the ${name} app — its AI phone lines stop and calls go to the restaurant's own number. Food Hub is not affected.`
        : `Clover merchant ${c.name || merchantId} disconnected from ${name}. Food Hub is not affected.`,
  });
  return true;
}

/** Saved billing + grace markers after a fresh answer from Clover (apps other than Food Hub). */
export function billingPatch(prev: Pick<CloverBillingState, 'billingLastGoodAt' | 'lapsedSince'> | null | undefined, billing: CloverBilling): Partial<CloverBillingState> {
  const good = billing.inTrial || billing.status === 'ACTIVE';
  return {
    billing,
    billingStale: false,
    billingLastGoodAt: good ? billing.checkedAt : prev?.billingLastGoodAt ?? null,
    lapsedSince: billing.status === 'LAPSED' ? prev?.lapsedSince ?? billing.checkedAt : null,
  };
}

/** Subscription changed in Clover (App webhook UPDATE): read the merchant's billing_info again (approved merchants only). */
export async function refreshCloverBilling(merchantId: string, app: CloverAppKey = 'foodhub'): Promise<CloverBilling | null> {
  const token = await cloverOAuthToken(merchantId, undefined, app);
  if (!token) return null;
  const billing = await readCloverBilling(merchantId, token, app);
  if (!billing) return null;
  if (app !== 'foodhub') {
    // A sold app: its own per-merchant key only (the token map is not rewritten).
    if (!(await readCloverConnection(merchantId, app))) return null;
    const prev = await readCloverBillingState(merchantId, app);
    await patchCloverBillingState(merchantId, { ...billingPatch(prev, billing), checkFailedAt: null }, app);
    return billing;
  }
  const saved = await updateAll(app, (all) => {
    if (!all[merchantId]) return { write: false, result: false };
    all[merchantId] = { ...all[merchantId], billing };
    return { write: true, result: true };
  });
  return saved ? billing : null;
}

/** App webhook events: { appId, merchants: { MID: [{ objectId: "A:<appId>", type: "DELETE" | "CREATE" | "UPDATE" }] } } */
export async function handleCloverAppEvents(body: any, app: CloverAppKey = 'foodhub'): Promise<{ uninstalled: string[]; installed: string[] }> {
  const out = { uninstalled: [] as string[], installed: [] as string[] };
  // Food Hub keeps its original rule (falls back to the event's appId); another app only takes events for its own App ID.
  // Same App ID value as its OAuth flow (cloverApp; Food Hub's is read raw, as before).
  const appId = app === 'foodhub' ? cloverApp('foodhub').appId || String(body?.appId || '') : cloverApp(app).appId || '';
  if (app !== 'foodhub' && (!appId || (body?.appId && String(body.appId) !== appId))) return out;
  const name = cloverApp(app).name;
  for (const [mid, events] of Object.entries((body?.merchants ?? {}) as Record<string, any[]>)) {
    for (const ev of Array.isArray(events) ? events : []) {
      const [kind, id] = String(ev?.objectId ?? '').split(':');
      if (kind !== 'A' || (appId && id && id !== appId)) continue;
      const type = String(ev?.type || '').toUpperCase();
      // Any event from a sold app makes its saved subscription answer stale: the entitlement check asks Clover again.
      // Written to the merchant's own subscription key, never to the token map.
      if (app !== 'foodhub' && type !== 'DELETE' && (await readCloverConnection(mid, app).catch(() => null))) {
        await patchCloverBillingState(mid, { billingStale: true }, app).catch(() => undefined);
      }
      if (type === 'DELETE') {
        if (await disconnectCloverMerchant(mid, 'uninstalled', 'Clover', app)) out.uninstalled.push(mid);
      } else if (type === 'CREATE') {
        out.installed.push(mid);
        await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_app_installed', status: 'info',
          summary: `Clover merchant ${mid} installed the ${name} app — it connects the first time the merchant opens the app.` });
      } else if (type === 'UPDATE') {
        await refreshCloverBilling(mid, app);
      }
    }
  }
  return out;
}
