// Uber Eats direct adapter (Marketplace APIs).
// Spec: https://developer.uber.com/docs/eats  — access requires Uber approval of the app's scopes.
import crypto from 'node:crypto';
import { callApi, fromCents, result, safeEqual, stripSlash, timedFetch } from '../config';
import { uberCourierDetails } from '../courier';
import { toUberHolidayHours, toUberMenu } from '../menu/translate';
import { getRepo } from '../repo';
import type { CancelReason, PlatformState, ChannelAdapter, ChannelStore, NormalizedOrder, OrderLine, StoredOrder } from '../types';
import { blockedResult, buildReadiness } from './common';

const KEY = 'uber_eats' as const;

// Hosts. Production apps use auth.uber.com + api.uber.com; a "Testing" (sandbox) app must use sandbox-login.uber.com
// + test-api.uber.com ("Mixing domains will cause authentication failures"): UBER_ENV=sandbox switches all three.
// UBER_AUTH_URL / UBER_LOGIN_URL / UBER_BASE_URL still override each one.
const sandbox = () => process.env.UBER_ENV === 'sandbox';
export function uberApiBase() { return stripSlash(process.env.UBER_BASE_URL || (sandbox() ? 'https://test-api.uber.com' : 'https://api.uber.com')); }
export function uberTokenUrl() { return process.env.UBER_AUTH_URL || (sandbox() ? 'https://sandbox-login.uber.com/oauth/v2/token' : 'https://auth.uber.com/oauth/v2/token'); }
export function uberAuthorizeUrl() { return process.env.UBER_LOGIN_URL || (sandbox() ? 'https://sandbox-login.uber.com/oauth/v2/authorize' : 'https://auth.uber.com/oauth/v2/authorize'); }
const base = uberApiBase;

// Client-credentials tokens, one per scope set: 'orders' (eats.order eats.store eats.store.status.write), 'report'
// (eats.report) and 'poll' (eats.store.orders.read, for the missed-order check). Uber allows 100 token requests per
// hour per app and invalidates the oldest token past 100, and a token lives 30 days — so a token is kept in memory AND
// in the database (fh_kv, server-only), shared by every instance and restart, instead of one new token per cold start.
// While a request is pending its promise is shared, so concurrent callers make ONE token call.
type TokenKind = 'orders' | 'report' | 'poll';
type TokenCache = { value: string; expiresAt: number; fp: string } | null;
const tokens: Record<TokenKind, { cached: TokenCache; inflight: Promise<string> | null }> = { orders: { cached: null, inflight: null }, report: { cached: null, inflight: null }, poll: { cached: null, inflight: null } };
const TOKEN_KV = (kind: TokenKind) => `uber:token:${kind}`;
/** Which app + host a stored token belongs to: a new client id/secret or a sandbox switch never reuses an old token. */
const tokenFp = (kind: TokenKind) => crypto.createHash('sha256').update(`${kind}|${process.env.UBER_CLIENT_ID}|${process.env.UBER_CLIENT_SECRET}|${uberTokenUrl()}`).digest('hex').slice(0, 24);
const fresh = (c: TokenCache, kind: TokenKind): c is NonNullable<TokenCache> => Boolean(c && c.fp === tokenFp(kind) && c.expiresAt > Date.now() + 60_000);

async function fetchClientToken(kind: TokenKind): Promise<string> {
  const slot = tokens[kind];
  if (fresh(slot.cached, kind)) return slot.cached.value;
  if (slot.inflight) return slot.inflight;
  slot.inflight = (async () => {
    const stored = await getRepo().getKv<NonNullable<TokenCache>>(TOKEN_KV(kind)).catch(() => null);
    if (fresh(stored, kind)) { slot.cached = stored; return stored.value; }
    const request = (scope: string) => timedFetch(uberTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.UBER_CLIENT_ID || '', client_secret: process.env.UBER_CLIENT_SECRET || '', grant_type: 'client_credentials', scope }).toString(),
    });
    const wanted = kind === 'report' ? process.env.UBER_REPORT_SCOPE || 'eats.report' : kind === 'poll' ? 'eats.store.orders.read' : process.env.UBER_OAUTH_SCOPE || 'eats.order eats.store eats.store.status.write';
    let res = await request(wanted);
    // eats.store.status.write is approved separately by Uber: without it the combined request is refused (invalid_scope)
    // and NOTHING would work. Fall back to orders + menus so orders keep flowing (pause/resume then fails on its own).
    if (!res.ok && kind === 'orders' && !process.env.UBER_OAUTH_SCOPE && res.status === 400) {
      const body = await res.clone().text().catch(() => '');
      if (/invalid_scope|scope/i.test(body)) res = await request('eats.order eats.store');
    }
    if (!res.ok) {
      // Uber answers { error, error_description } (invalid_scope, invalid_client…): that is what the owner needs to see.
      const detail = await res.json().then((j: any) => [j?.error, j?.error_description].filter(Boolean).join(' — ')).catch(() => '');
      const why = detail ? ` (${String(detail).slice(0, 200)})` : '';
      throw new Error(kind === 'report'
        ? `Uber Reporting token refused: HTTP ${res.status}${why} — ask Uber to add the eats.report scope to your app.`
        : kind === 'poll'
          ? `Uber order-list token refused: HTTP ${res.status}${why} — ask Uber to add the eats.store.orders.read scope (used to catch orders whose webhook never arrived).`
          : `Uber OAuth token refused: HTTP ${res.status}${why}${res.status === 429 ? ' — Uber allows 100 token requests per hour; Food Hub keeps one token for 30 days, so this clears by itself.' : ''}${/scope/i.test(detail) ? ` — UBER_OAUTH_SCOPE must list only scopes Uber granted to your app (now: ${process.env.UBER_OAUTH_SCOPE || 'eats.order eats.store eats.store.status.write'}).` : ''}`);
    }
    const json = await res.json();
    if (!json.access_token) throw new Error('Uber OAuth response had no access_token.');
    slot.cached = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 2592000) * 1000, fp: tokenFp(kind) };
    await getRepo().setKv(TOKEN_KV(kind), slot.cached).catch(() => undefined);
    return slot.cached.value;
  })().finally(() => { slot.inflight = null; });
  return slot.inflight;
}

/** Drops the cached token (Uber answered 401: secret rotated or token revoked) so the next call fetches a fresh one. */
/** Forgets the in-memory tokens only (what a cold start or another server instance sees); the stored ones stay. */
export function forgetUberTokenMemory() {
  for (const k of Object.keys(tokens) as TokenKind[]) tokens[k].cached = null;
}

export async function invalidateUberToken(kind: TokenKind = 'orders'): Promise<void> {
  tokens[kind].cached = null;
  await getRepo().setKv(TOKEN_KV(kind), null).catch(() => undefined);
}

export async function uberAccessToken(): Promise<string> {
  if (process.env.UBER_ACCESS_TOKEN) return process.env.UBER_ACCESS_TOKEN;
  return fetchClientToken('orders');
}

/** Separate token for the Reporting API (scope eats.report), so an app without it keeps working for orders. */
const uberReportToken = () => fetchClientToken('report');

/** fetch with the Uber token; on 401 the cached token is invalidated and the call retried once with a fresh one. */
async function uberFetch(url: string, init: RequestInit = {}, kind: TokenKind = 'orders'): Promise<Response> {
  const token = kind === 'report' ? uberReportToken : kind === 'poll' ? () => fetchClientToken('poll') : uberAccessToken;
  const run = async () => timedFetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await token()}` } });
  const res = await run();
  if (res.status !== 401 || (kind === 'orders' && process.env.UBER_ACCESS_TOKEN)) return res;
  await invalidateUberToken(kind);
  return run();
}

/** The 9 report types of the Reporting API suite (https://developer.uber.com/docs/eats/references/api/reporting_suite). */
export const UBER_REPORT_TYPES = ['PAYMENT_DETAILS_REPORT', 'FINANCE_SUMMARY_REPORT', 'ORDER_HISTORY_REPORT', 'ORDERS_AND_ITEMS_REPORT', 'DOWNTIME_REPORT', 'ORDER_ERRORS_TRANSACTION_REPORT',
  'ORDER_ERRORS_MENU_ITEM_REPORT', 'CUSTOMER_AND_DELIVERY_FEEDBACK_REPORT', 'MENU_ITEM_FEEDBACK_REPORT'] as const;
export type UberReportType = (typeof UBER_REPORT_TYPES)[number];

/**
 * Uber's request constraints (Reporting API suite, "Time Range Constraints"): a maximum range in days for the money
 * reports, a lookback window [T - from, T - to] in days for the others (T = today). Null = the request is fine.
 */
const REPORT_RANGE_DAYS: Partial<Record<UberReportType, number>> = { PAYMENT_DETAILS_REPORT: 30, ORDERS_AND_ITEMS_REPORT: 15, FINANCE_SUMMARY_REPORT: 30 };
const REPORT_LOOKBACK: Partial<Record<UberReportType, [number, number]>> = {
  ORDER_ERRORS_MENU_ITEM_REPORT: [188, 2], ORDER_ERRORS_TRANSACTION_REPORT: [190, 4], ORDER_HISTORY_REPORT: [188, 2], DOWNTIME_REPORT: [188, 2],
  CUSTOMER_AND_DELIVERY_FEEDBACK_REPORT: [188, 2], MENU_ITEM_FEEDBACK_REPORT: [188, 2],
};
export function uberReportRangeError(reportType: UberReportType, startDate: string, endDate: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const day = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 86400_000;
  const [s, e, t] = [day(startDate), day(endDate), day(today)];
  if (![s, e, t].every(Number.isFinite)) return 'Dates must be YYYY-MM-DD.';
  if (s > e) return 'The start date is after the end date.';
  const max = REPORT_RANGE_DAYS[reportType];
  if (max && e - s + 1 > max) return `Uber builds this report for ${max} days at most per request (asked: ${e - s + 1}). Ask for a shorter period.`;
  const back = REPORT_LOOKBACK[reportType];
  if (back && (s < t - back[0] || e > t - back[1])) return `Uber only builds this report between ${back[0]} and ${back[1]} days ago.`;
  return null;
}

/**
 * Uber Eats Reporting API: POST /v1/eats/report { report_type, store_uuids, start_date, end_date } → { workflow_id }.
 * The report is built asynchronously; Uber calls the webhook (eats.report.success) with the download link.
 * It creates a workflow on Uber's side, so it is gated by LIVE_CONNECTORS_GLOBAL_ENABLED like every other write.
 */
export async function requestUberReport(storeUuids: string[], startDate: string, endDate: string, reportType: UberReportType = 'PAYMENT_DETAILS_REPORT'): Promise<{ ok: boolean; status?: 'blocked' | 'error'; workflowId?: string; message: string }> {
  if (!process.env.UBER_CLIENT_ID || !process.env.UBER_CLIENT_SECRET) return { ok: false, status: 'blocked', message: 'Uber Eats is not connected (UBER_CLIENT_ID / UBER_CLIENT_SECRET).' };
  const r = readiness();
  if (!r.canSend) return { ok: false, status: 'blocked', message: blockedResult(KEY, r).message };
  if (!storeUuids.length) return { ok: false, status: 'error', message: 'No Uber Eats stores are mapped yet.' };
  if (!UBER_REPORT_TYPES.includes(reportType)) return { ok: false, status: 'error', message: `Unknown Uber report type ${reportType}.` };
  const rangeError = uberReportRangeError(reportType, startDate, endDate);
  if (rangeError) return { ok: false, status: 'error', message: rangeError };
  try {
    const res = await uberFetch(`${base()}/v1/eats/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_type: reportType, store_uuids: storeUuids, start_date: startDate, end_date: endDate }),
    }, 'report');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: `Uber Reporting API HTTP ${res.status}: ${String(json?.message ?? json?.error ?? '').slice(0, 200)}` };
    const workflowId = json?.workflow_id ?? json?.workflowId ?? json?.id;
    return { ok: true, workflowId: workflowId ? String(workflowId) : undefined, message: 'Report requested — Uber sends it to Food Hub when it is ready (usually minutes).' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Download links inside a report webhook (field names vary by report type, so collect every http link). */
export function reportDownloadLinks(body: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') { if (/^https?:\/\//.test(v) && /url|link|download|href/i.test(key)) out.add(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(body);
  return [...out];
}

function readiness() {
  return buildReadiness(KEY, ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET'], {
    // A static UBER_ACCESS_TOKEN cannot be refreshed (client-credentials tokens expire after 30 days).
    note: `${process.env.UBER_ACCESS_TOKEN ? 'UBER_ACCESS_TOKEN override in use — it expires after 30 days and is never refreshed; remove it to use client credentials. ' : ''}${sandbox() ? 'SANDBOX (UBER_ENV=sandbox: sandbox-login.uber.com + test-api.uber.com). ' : ''}Direct mode. Requires Uber production access with eats.order, eats.store, eats.store.status.write, eats.pos_provisioning (+ eats.store.orders.read, eats.report, eats.store.status.notification; optional: eats.store.orders.restaurantdelivery.status, delivery.multiple.courier, eats.byoc.fulfillment.config). Uber developer dashboard → Webhooks → Primary Webhook, Basic HMAC, Signing Key = the value below. Then: Stores → “Connect Uber Eats”.`,
    noteFr: `${process.env.UBER_ACCESS_TOKEN ? 'UBER_ACCESS_TOKEN est utilisé — il expire après 30 jours et n’est jamais renouvelé ; retirez-le pour utiliser les identifiants client. ' : ''}${sandbox() ? 'BAC À SABLE (UBER_ENV=sandbox : sandbox-login.uber.com + test-api.uber.com). ' : ''}Mode direct. Uber doit accorder l’accès production avec eats.order, eats.store, eats.store.status.write, eats.pos_provisioning (+ eats.store.orders.read, eats.report, eats.store.status.notification ; facultatif : eats.store.orders.restaurantdelivery.status, delivery.multiple.courier, eats.byoc.fulfillment.config). Tableau de bord développeur Uber → Webhooks → Primary Webhook, Basic HMAC, Signing Key = la valeur ci-dessous. Ensuite : Magasins → « Brancher Uber Eats ».`,
    extraWebhooks: [{ label: 'OAuth redirect URI (Uber developer dashboard → your app → Redirect URIs)', path: '/api/foodhub/uber-connect/callback' }],
    handoff: [{ label: 'Webhook Signing Key (Basic HMAC)', envKey: 'UBER_WEBHOOK_SIGNING_KEY' }],
  });
}

async function headers() {
  return { Authorization: `Bearer ${await uberAccessToken()}`, 'Content-Type': 'application/json' };
}

/** Is Food Hub allowed to change things on Uber now (keys + live switch)? */
export function uberCanSend(): boolean { return readiness().canSend; }
/** The honest "nothing was sent" result while Uber Eats is not live (keys or live switch missing). */
export function uberBlockedResult() { return blockedResult(KEY, readiness()); }

/** Read-only GET on the Uber API with the app token ('poll' = eats.store.orders.read). Never throws. */
export async function uberGetJson(path: string, kind: TokenKind = 'orders'): Promise<{ ok: boolean; status: number; json: any; error?: string }> {
  if (!readiness().configured) return { ok: false, status: 0, json: null, error: 'Uber Eats credentials missing' };
  try {
    const res = await uberFetch(`${base()}${path}`, {}, kind);
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, json, error: `Uber ${path.split('?')[0]} HTTP ${res.status}${json?.message ? `: ${String(json.message).slice(0, 200)}` : ''}` };
    return { ok: true, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, json: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A write on the Uber API (app token, live switch, one retry on 401). Never throws; 'blocked' when nothing was sent. */
export function uberSend(method: string, path: string, body?: unknown) { return send(method, path, body); }

async function send(method: string, path: string, body?: unknown, okStatus: 'done' | 'queued' = 'done') {
  const r = readiness();
  if (!r.canSend) return blockedResult(KEY, r);
  try {
    const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };
    const first = await callApi(KEY, `${base()}${path}`, { ...init, headers: await headers() }, okStatus);
    // 401 = the cached token died (secret rotated / revoked): refresh once and retry.
    if (first.httpStatus !== 401 || process.env.UBER_ACCESS_TOKEN) return first;
    await invalidateUberToken();
    return await callApi(KEY, `${base()}${path}`, { ...init, headers: await headers() }, okStatus);
  } catch (error) {
    return result(KEY, 'error', error instanceof Error ? error.message : String(error));
  }
}

const UBER_CANCEL: Record<CancelReason, string> = {
  out_of_stock: 'OUT_OF_ITEMS',
  store_closed: 'KITCHEN_CLOSED',
  too_busy: 'RESTAURANT_TOO_BUSY',
  customer_request: 'CUSTOMER_CALLED_TO_CANCEL',
  pos_issue: 'OTHER',
  other: 'OTHER',
};

const DENY_CODES: Array<[RegExp, string]> = [
  [/stock|86|unavailable|item/i, 'ITEM_AVAILABILITY'],
  [/closed/i, 'STORE_CLOSED'],
  [/busy|capacity/i, 'CAPACITY'],
  [/pos|offline|connect/i, 'POS_OFFLINE'],
];

/**
 * UBER_ORDER_API=current: accept / deny / cancel through the Order Fulfillment API suite (/v1/delivery/order/…).
 * Default: the previous-version endpoints (Food Hub reads orders with GET /v2/eats/order, see uberPosDataBody).
 */
const currentOrderApi = () => process.env.UBER_ORDER_API === 'current';
/** Deny / cancel reason types of the current suite (deny_reason.type, cancellation_reason.type). */
const CURRENT_REASON: Array<[RegExp, string]> = [
  [/stock|86|unavailable|item/i, 'ITEM_ISSUE'], [/closed/i, 'STORE_CLOSED'], [/busy|capacity/i, 'CAPACITY'], [/pos|offline|connect/i, 'POS_OFFLINE'], [/address/i, 'ADDRESS'], [/instruction|note/i, 'SPECIAL_INSTRUCTIONS'], [/price|pricing/i, 'PRICING'],
];
const CURRENT_CANCEL: Record<CancelReason, string> = {
  out_of_stock: 'ITEM_ISSUE', store_closed: 'KITCHEN_CLOSED', too_busy: 'RESTAURANT_TOO_BUSY', customer_request: 'CUSTOMER_CALLED_TO_CANCEL', pos_issue: 'POS_OFFLINE', other: 'OTHER',
};

export const uberEatsAdapter: ChannelAdapter = {
  key: KEY,
  label: 'Uber Eats (direct)',
  readiness,
  verifyWebhook(h, rawBody) {
    // Uber signs the raw body: lowercase hex HMAC-SHA256. New developer dashboards ask for a "Signing Key"
    // (and an optional secondary one for rotation) on the webhook; older apps sign with the client secret.
    const sig = h.get('x-uber-signature');
    if (!sig) return false;
    const keys = [process.env.UBER_WEBHOOK_SIGNING_KEY, process.env.UBER_WEBHOOK_SIGNING_KEY_2, process.env.UBER_CLIENT_SECRET].filter((k): k is string => Boolean(k));
    return keys.some((key) => safeEqual(crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest('hex'), sig.toLowerCase()));
  },
  // Store prep time: Uber's Store API suite now documents "Update Prep Time" (POST /v1/delivery/store/{id}/
  // update-store-prep-time) — sent from Settings → prep time (lib/foodhub/adapters/uber-api.ts, pushPrepTimeToUber).
  // Per order, the ready time still goes with the accept (pickup_time) and with "+5 min" (updateReadyTime below).
  acceptOrder: (order, posRef) => {
    // pickup_time (Unix seconds) = when the food will be ready, from the location's normal/busy prep time or the cook's
    // estimate — Uber dispatches the courier on it instead of its own default.
    const ready = Date.parse(order.timeline?.readyTarget ?? '');
    const future = Number.isFinite(ready) && ready > Date.now();
    if (currentOrderApi()) {
      // Order Fulfillment suite: POST /v1/delivery/order/{id}/accept (ready_for_pickup_time RFC 3339).
      return send('POST', `/v1/delivery/order/${encodeURIComponent(order.externalOrderId)}/accept`, {
        accepted_by: 'TAKATAK Food Hub', ...(posRef ? { external_reference_id: posRef } : {}), ...(future ? { ready_for_pickup_time: new Date(ready).toISOString() } : {}),
      });
    }
    return send('POST', `/v1/eats/orders/${encodeURIComponent(order.externalOrderId)}/accept_pos_order`, {
      reason: 'Accepted by TAKATAK Food Hub',
      ...(posRef ? { external_reference_id: posRef } : {}),
      ...(future ? { pickup_time: Math.floor(ready / 1000) } : {}),
    });
  },
  denyOrder: (order, reason) => currentOrderApi()
    ? send('POST', `/v1/delivery/order/${encodeURIComponent(order.externalOrderId)}/deny`, { deny_reason: { info: (reason || 'Rejected by restaurant').slice(0, 200), type: CURRENT_REASON.find(([re]) => re.test(reason))?.[1] ?? 'OTHER' } })
    : send('POST', `/v1/eats/orders/${encodeURIComponent(order.externalOrderId)}/deny_pos_order`, {
      reason: { explanation: reason || 'Rejected by restaurant', code: DENY_CODES.find(([re]) => re.test(reason))?.[1] ?? 'OTHER' },
    }),
  async markReady(order) {
    // Order Fulfillment API suite: POST /v1/delivery/order/{id}/ready ("Mark an order as ready for pickup"; helps Uber
    // time the courier). The kitchen's "Ready" never waits on Uber: without the live switch, or when Uber refuses the
    // signal (store still on the previous order API, scope missing), the order is ready in Food Hub and the reason is
    // said. UBER_MARK_READY=off stops the call.
    if (process.env.UBER_MARK_READY === 'off' || !readiness().canSend) return result(KEY, 'skipped', 'Ready in Food Hub; the courier follows the pickup time sent to Uber Eats at acceptance.');
    const r = await send('POST', `/v1/delivery/order/${encodeURIComponent(order.externalOrderId)}/ready`, {});
    return r.ok ? { ...r, message: 'Uber Eats was told the order is ready.' } : result(KEY, 'skipped', `Ready in Food Hub; Uber Eats did not take the ready signal (${r.message}).`, { httpStatus: r.httpStatus });
  },
  // "+5 min" in the kitchen → Update Order Ready Time (POST /v1/delivery/order/{id}/update-ready-time, RFC 3339), so the
  // courier and the customer see the new time. Uber refuses it once the order is ready or the courier is on the way.
  updateReadyTime: (order, readyAtIso) => send('POST', `/v1/delivery/order/${encodeURIComponent(order.externalOrderId)}/update-ready-time`, { ready_for_pickup_time: new Date(readyAtIso).toISOString() }),
  // POST /v1/eats/orders/{id}/cancel — reasons: OUT_OF_ITEMS, KITCHEN_CLOSED, CUSTOMER_CALLED_TO_CANCEL, RESTAURANT_TOO_BUSY, CANNOT_COMPLETE_CUSTOMER_NOTE, OTHER
  cancelOrder: (order, reason, details) => currentOrderApi()
    ? send('POST', `/v1/delivery/order/${encodeURIComponent(order.externalOrderId)}/cancel`, { cancellation_reason: { info: (details || 'Cancelled by restaurant').slice(0, 200), type: CURRENT_CANCEL[reason] ?? 'OTHER' } })
    : send('POST', `/v1/eats/orders/${encodeURIComponent(order.externalOrderId)}/cancel`, {
      reason: UBER_CANCEL[reason] ?? 'OTHER',
      ...(UBER_CANCEL[reason] === 'OTHER' || details ? { details: (details || 'Cancelled by restaurant').slice(0, 200) } : {}),
    }),
  async publishMenu(store: ChannelStore, menu, ctx) {
    const res = await send('PUT', `/v2/eats/stores/${encodeURIComponent(store.channelStoreId)}/menus`, toUberMenu(menu, ctx));
    const holidays = ctx?.holidays ?? [];
    const sentBefore = Array.isArray(store.meta?.uberHolidayDates) ? (store.meta.uberHolidayDates as string[]) : [];
    // POST holiday-hours REPLACES all of Uber's holiday dates: send them whenever there are some, and also when every
    // date was removed since the last publish (an empty map), so a deleted closure does not stay on Uber.
    if (!res.ok || (!holidays.length && !sentBefore.length)) return res;
    const h = await send('POST', `/v1/eats/stores/${encodeURIComponent(store.channelStoreId)}/holiday-hours`, toUberHolidayHours(holidays));
    if (h.ok) await getRepo().updateStore(store.id, { meta: { ...store.meta, uberHolidayDates: holidays.map((x) => x.date) } }).catch(() => undefined);
    return h.ok ? { ...res, message: holidays.length ? `Menu updated + ${holidays.length} holiday date(s) sent` : 'Menu updated + old holiday dates cleared' } : { ...h, message: `Menu updated, but holiday hours failed: ${h.message}` };
  },
  async setItemAvailability(store, refs, available, untilMs, kind = 'item') {
    const r = readiness();
    if (!r.canSend) return blockedResult(KEY, r);
    const suspendUntil = available ? 0 : Math.floor((untilMs ?? 8640000000 * 1000) / 1000);
    if (!refs.length) return result(KEY, 'skipped', 'No items to update.');
    // Modifiers are menu items too on Uber (id "mod:<ref>" in our menus). One refused item (e.g. not on Uber's menu yet)
    // must not leave the others on sale: every item is sent, failures are reported together.
    const failed: Array<{ ref: string; res: ReturnType<typeof result> }> = [];
    let last = result(KEY, 'skipped', 'No items to update.');
    for (const ref of refs.map((x) => (kind === 'modifier' ? `mod:${x}` : x))) {
      last = await send('POST', `/v2/eats/stores/${encodeURIComponent(store.channelStoreId)}/menus/items/${encodeURIComponent(ref)}`, {
        suspension_info: { suspension: { suspend_until: suspendUntil, reason: available ? '' : 'Sold out' } },
      });
      if (!last.ok) failed.push({ ref, res: last });
    }
    if (!failed.length) return last;
    if (failed.length === refs.length) return failed[0].res;
    return result(KEY, 'error', `${failed.length}/${refs.length} item(s) refused by Uber Eats (${failed.map((f) => f.ref).join(', ')}): ${failed[0].res.message}`, { httpStatus: failed[0].res.httpStatus });
  },
  // Set Restaurant Status: POST /v1/eats/store/{store_id}/status (singular "store" — unlike menus, holiday hours, pos_data).
  setStoreOnline: (store, online, untilMs, reason) => send('POST', `/v1/eats/store/${encodeURIComponent(store.channelStoreId)}/status`, online
    ? { status: 'ONLINE' }
    : { status: 'PAUSED', reason: reason || 'Paused from TAKATAK Food Hub', ...(untilMs ? { paused_until: new Date(untilMs).toISOString().replace(/\.\d{3}Z$/, 'Z') } : {}) }),
};

/** GET order details from the resource_href in the orders.notification webhook. */
export async function fetchUberOrder(resourceHrefOrId: string): Promise<any> {
  // A resource_href is only followed on the Uber API origin: the bearer token never goes anywhere else.
  const sameOrigin = (u: string) => { try { return new URL(u).origin === new URL(base()).origin; } catch { return false; } };
  const url = resourceHrefOrId.startsWith('http') && sameOrigin(resourceHrefOrId) ? resourceHrefOrId : `${base()}/v2/eats/order/${encodeURIComponent(resourceHrefOrId.startsWith('http') ? (resourceHrefOrId.split('/').pop() || '') : resourceHrefOrId)}`;
  const res = await uberFetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Uber order fetch failed: HTTP ${res.status}`);
  return res.json();
}

/** Normalizes GET /v1/eats/store/{store_id}/status → { status: ONLINE|OFFLINE|PAUSED, offlineReason }. */
export function normalizeUberStatus(body: any): { state: PlatformState; detail?: string; until?: string | null } {
  const status = String(body?.status ?? '').toUpperCase();
  const reason = String(body?.offlineReason ?? body?.offline_reason ?? '').toUpperCase();
  const until = body?.paused_until ?? body?.is_offline_until ?? body?.offlineUntil ?? null;
  if (status === 'ONLINE') return { state: 'online' };
  if (status === 'PAUSED' || /PAUSE/.test(reason)) return { state: 'paused', detail: reason || 'PAUSED', until };
  if (/MENU_HOURS|OUT_OF_HOURS|HOURS|HOLIDAY|CLOSED/.test(reason)) return { state: 'closed', detail: reason };
  if (/INVISIBLE|DEACTIVAT|INACTIVE|NOT_ACTIVE|SUSPEND|REMOVED|CHURN/.test(reason)) return { state: 'deactivated', detail: reason };
  if (status === 'OFFLINE') return { state: 'paused', detail: reason || 'OFFLINE', until };
  return { state: 'unknown', detail: status || 'No status in Uber response' };
}

/** Read-only status check (GET /v1/eats/store/{store_id}/status). Runs whenever credentials exist — see LOCKED_DECISIONS (it changes nothing on Uber). */
export async function fetchUberStoreStatus(storeId: string): Promise<{ ok: boolean; state: PlatformState; detail?: string; until?: string | null; error?: string }> {
  if (!readiness().configured) return { ok: false, state: 'unknown', error: 'Uber Eats credentials missing' };
  try {
    const res = await uberFetch(`${base()}/v1/eats/store/${encodeURIComponent(storeId)}/status`);
    // Any HTTP error (incl. 404) is 'unknown': the last good state is kept. Deactivation only comes from an explicit offlineReason.
    if (!res.ok) return { ok: false, state: 'unknown', error: `Uber status HTTP ${res.status}` };
    return { ok: true, ...normalizeUberStatus(await res.json()) };
  } catch (error) {
    return { ok: false, state: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

/** One store's details (name + address) — read-only; used to confirm which kitchen a known store UUID belongs to. */
export async function fetchUberStoreDetails(storeId: string): Promise<{ ok: boolean; name?: string; address?: string; error?: string }> {
  if (!readiness().configured) return { ok: false, error: 'Uber Eats credentials missing' };
  try {
    const res = await timedFetch(`${base()}/v1/eats/stores/${encodeURIComponent(storeId)}`, { headers: await headers() });
    if (!res.ok) return { ok: false, error: `Uber store HTTP ${res.status}` };
    const s = await res.json();
    const address = [s?.location?.address, s?.location?.address_2, s?.location?.city].filter(Boolean).join(', ') || undefined;
    return { ok: true, name: s?.name ? String(s.name) : undefined, address };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Every page of GET /v1/eats/stores ({stores[], next_key}; limit / start_key), with a merchant token (provisioning)
 * or the app token (discovery). Stops after 40 pages (2,000 stores) so a looping next_key cannot hang a request.
 */
export async function listUberStorePages(get: (url: string) => Promise<Response>): Promise<any[]> {
  const out: any[] = [];
  let key = '';
  for (let page = 0; page < 40; page++) {
    const res = await get(`${base()}/v1/eats/stores?limit=50${key ? `&start_key=${encodeURIComponent(key)}` : ''}`);
    if (!res.ok) {
      const why = await res.json().then((j: any) => String(j?.message ?? j?.error_description ?? j?.error ?? '')).catch(() => '');
      throw new Error(`Uber store list failed (HTTP ${res.status}${why ? `: ${why.slice(0, 160)}` : ''}).`);
    }
    const json = await res.json();
    out.push(...(Array.isArray(json?.stores) ? json.stores : Array.isArray(json?.data) ? json.data : []));
    const next = json?.next_key ? String(json.next_key) : '';
    if (!next || next === key) break;
    key = next;
  }
  return out;
}

/** Lists stores provisioned to this app — used for one-click store discovery. */
export async function discoverUberStores(): Promise<Array<{ id: string; name: string; address?: string }>> {
  const rows = await listUberStorePages((url) => uberFetch(url));
  return rows.map((s) => ({ id: String(s.store_id ?? s.id), name: String(s.name ?? ''), address: s.location?.address ?? undefined }));
}

/** Who takes this store's orders, from its pos_data: Food Hub, Food Hub once Uber finishes switching, or another app. */
export type UberOrderManager = 'foodhub' | 'pending' | 'other' | 'unknown';

/**
 * GET /v1/eats/stores/{id}/pos_data answers for THIS app: is_order_manager is what Food Hub asked for, while
 * order_manager_client_id is the app that really receives the orders (UrbanPiper until it lets go).
 */
export function uberOrderManager(pos: any, clientId = process.env.UBER_CLIENT_ID || ''): UberOrderManager {
  if (!pos || typeof pos !== 'object') return 'unknown';
  const manager = pos.order_manager_client_id ? String(pos.order_manager_client_id) : '';
  if (manager) return manager !== clientId ? 'other' : pos.is_order_manager_pending ? 'pending' : 'foodhub';
  // Without order_manager_client_id nothing proves Food Hub gets the orders: never guess 'foodhub' (the missed-order
  // check only runs for confirmed stores, so a wrong guess could put UrbanPiper's orders in Clover twice).
  return pos.is_order_manager_pending ? 'pending' : 'unknown';
}

export interface UberPosState { orderManager: UberOrderManager; integrationEnabled: boolean | null; orderManagerClientId: string | null; checkedAt: string }

/** Read-only: this app's pos_data for one store (scope eats.store). Runs whenever credentials exist (LOCKED_DECISIONS). */
export async function fetchUberPosData(storeId: string): Promise<{ ok: boolean; state?: UberPosState; raw?: unknown; error?: string; httpStatus?: number }> {
  if (!readiness().configured) return { ok: false, error: 'Uber Eats credentials missing' };
  try {
    const res = await uberFetch(`${base()}/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`);
    if (!res.ok) return { ok: false, httpStatus: res.status, error: `Uber pos_data HTTP ${res.status}` };
    const raw = await res.json();
    const enabled = raw?.integration_enabled ?? raw?.pos_integration_enabled;
    return { ok: true, raw, state: { orderManager: uberOrderManager(raw), integrationEnabled: typeof enabled === 'boolean' ? enabled : null, orderManagerClientId: raw?.order_manager_client_id ? String(raw.order_manager_client_id) : null, checkedAt: new Date().toISOString() } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * PATCH /v1/eats/stores/{id}/pos_data {integration_enabled: true} — "toggles on order fulfillment webhooks including
 * orders.notification" (Uber Going Live guide). A write: needs the live switch like every other change on Uber.
 */
export function enableUberIntegration(storeId: string) {
  return send('PATCH', `/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, { integration_enabled: true });
}

/**
 * Orders still waiting for an accept on Uber (GET /v1/eats/stores/{id}/created-orders, scope eats.store.orders.read).
 * Read-only; used to catch an order whose webhook never reached Food Hub.
 */
export async function listUberCreatedOrders(storeId: string): Promise<Array<{ id: string; placedAt: string | null }>> {
  const res = await uberFetch(`${base()}/v1/eats/stores/${encodeURIComponent(storeId)}/created-orders?limit=50`, {}, 'poll');
  if (!res.ok) throw new Error(`Uber created-orders HTTP ${res.status}`);
  const json = await res.json();
  return (Array.isArray(json?.orders) ? json.orders : []).filter((o: any) => o?.id).map((o: any) => ({ id: String(o.id), placedAt: o.placed_at ? String(o.placed_at) : null }));
}

const money = (m: any) => (m && typeof m === 'object' ? (typeof m.amount_e5 === 'number' ? m.amount_e5 / 100000 : fromCents(m.amount)) : 0);
/** Restaurant-funded promotion on the order (payment.charges.total_promo_applied, or the promotions list), in dollars; 0 when absent. */
function uberDiscount(payment: any): number {
  const charges = payment?.charges ?? {};
  const direct = money(charges.total_promo_applied) || money(charges.promotion) || money(charges.promo) || money(charges.discount);
  if (direct) return Math.abs(direct);
  const promos: any[] = Array.isArray(payment?.promotions) ? payment.promotions : Array.isArray(charges.promotions) ? charges.promotions : [];
  return Math.round(promos.reduce((s, p) => s + Math.abs(money(p?.promo_discount_value ?? p?.discount_value ?? p?.amount ?? p?.value)), 0) * 100) / 100;
}

export function parseUberOrder(o: any, storeIdFallback?: string): NormalizedOrder | null {
  if (!o?.id) return null;
  const items: any[] = Array.isArray(o.cart?.items) ? o.cart.items : [];
  const lines: OrderLine[] = items.map((it) => {
    const qty = Number(it.quantity || 1);
    const modifiers = (Array.isArray(it.selected_modifier_groups) ? it.selected_modifier_groups : [])
      .flatMap((g: any) => (Array.isArray(g.selected_items) ? g.selected_items : []))
      .map((m: any) => ({
        externalId: m.external_data || (m.id ? String(m.id).replace(/^mod:/, '') : undefined),
        name: String(m.title ?? ''),
        quantity: Number(m.quantity || 1),
        unitPrice: money(m.price?.unit_price),
      }));
    const unitBase = money(it.price?.base_unit_price) || money(it.price?.unit_price);
    return {
      externalId: it.external_data || String(it.id ?? ''),
      name: String(it.title ?? 'Item'),
      quantity: qty,
      unitPrice: unitBase,
      total: money(it.price?.total_price) || unitBase * qty,
      notes: it.special_instructions || undefined,
      modifiers,
    };
  });
  const charges = o.payment?.charges ?? {};
  const type = String(o.type || '');
  return {
    channel: KEY,
    marketplace: 'uber_eats',
    externalOrderId: String(o.id),
    displayId: o.display_id ? String(o.display_id) : undefined,
    channelStoreId: String(o.store?.id ?? storeIdFallback ?? ''),
    customerName: o.eater?.first_name || undefined,
    fulfillment: type === 'PICK_UP' ? 'pickup' : type === 'DINE_IN' ? 'dine_in' : 'delivery',
    placedAt: o.placed_at || new Date().toISOString(),
    readyBy: o.estimated_ready_for_pickup_at || undefined,
    currency: charges.total?.currency_code || process.env.FOODHUB_CURRENCY || 'CAD',
    subtotal: money(charges.sub_total),
    tax: money(charges.tax),
    deliveryFee: money(charges.delivery_fee),
    tip: money(charges.tip),
    discount: uberDiscount(o.payment),
    total: money(charges.total),
    notes: o.cart?.special_instructions || undefined,
    lines,
    courier: uberCourierDetails(o),
    raw: o,
  };
}

export type _UberStoredOrder = StoredOrder;
