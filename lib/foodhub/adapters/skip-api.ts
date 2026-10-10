// SkipTheDishes / Just Eat Takeaway "JET Connect": every operation of the published specification that a restaurant
// group can use and that skip.ts does not already cover (the order, menu, item-availability and online/offline calls).
// Specification: https://uk.api.just-eat.io/docs/openapi.yaml — coverage table: docs/SKIP_API_COVERAGE.md.
//
//   Order changes      POST /orders/{id}/modification  (out of stock, substitutions, weighed items)
//                      POST|GET /orders/{brandSlug}/{id}/amend (older, obsolete)
//                      POST /orders/{id}/validation    (dry run of the same body)
//                      GET  /orders/{id}/modification  (state of the change)
//   Opening times      PUT  /restaurants/{ref}/servicetimes
//   Partner onboarding POST /partners/{market}/locations/onboard
//                      PUT  /partners/onboarding/{sessionId}/configuration
//                      POST /partners/locations/{ref}/go-live
//                      + the signed onboarding notification (X-Webhook-Signature)
//
// Every call goes through skipSend: nothing leaves without SKIP_JET_API_KEY and the live switch, and a refusal says why.
import crypto from 'node:crypto';
import { result, safeEqual } from '../config';
import { DAYS, normalizeWeek } from '../hours';
import type { ChannelResult, ChannelStore, StoredOrder, WeeklyHours } from '../types';
import { skipSend } from './skip';

const KEY = 'skip' as const;

// ---------------------------------------------------------------------------------------------------------------------
// Order modifications

export interface SkipRemovedItem { plu: string; missingQuantity: number }
export interface SkipAddedItem { plu: string; quantity: number; /** Grams, weighed substitutes only. */ netQuantity?: number }
export interface SkipAdjustedItem { plu: string; /** Picked weight in grams. */ netQuantity: number }
/** One "modification pair": what was removed, what replaces it, and weighed items picked at another weight. */
export interface SkipModification { removedItems?: SkipRemovedItem[]; addedItems?: SkipAddedItem[]; adjustedItems?: SkipAdjustedItem[] }

const posNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Checks and cleans a modification request before anything is sent. JET's rules: each pair has removedItems or
 * adjustedItems; a substitute only makes sense with a removed item; quantities are positive; weights are whole grams.
 */
export function skipModificationBody(mods: SkipModification[]): { body: { modifications: SkipModification[] } } | { error: string } {
  const clean: SkipModification[] = [];
  for (const m of Array.isArray(mods) ? mods : []) {
    const removed = (m.removedItems ?? []).filter((x) => x && String(x.plu ?? '').trim());
    const added = (m.addedItems ?? []).filter((x) => x && String(x.plu ?? '').trim());
    const adjusted = (m.adjustedItems ?? []).filter((x) => x && String(x.plu ?? '').trim());
    if (!removed.length && !adjusted.length) {
      if (added.length) return { error: 'A substitute needs the removed item it replaces.' };
      continue;
    }
    if (removed.some((x) => !posNum(x.missingQuantity))) return { error: 'Each removed item needs a missing quantity above zero.' };
    if (added.some((x) => !posNum(x.quantity))) return { error: 'Each substitute needs a quantity above zero.' };
    if (adjusted.some((x) => !posNum(x.netQuantity) || !Number.isInteger(x.netQuantity))) return { error: 'A weight adjustment needs the picked weight in whole grams.' };
    const pair: SkipModification = {};
    if (removed.length) pair.removedItems = removed.map((x) => ({ plu: String(x.plu).trim(), missingQuantity: x.missingQuantity }));
    if (added.length) pair.addedItems = added.map((x) => ({ plu: String(x.plu).trim(), quantity: x.quantity, ...(posNum(x.netQuantity) ? { netQuantity: x.netQuantity } : {}) }));
    if (adjusted.length) pair.adjustedItems = adjusted.map((x) => ({ plu: String(x.plu).trim(), netQuantity: x.netQuantity }));
    clean.push(pair);
  }
  if (!clean.length) return { error: 'Nothing to change: name at least one removed item or one weight adjustment.' };
  return { body: { modifications: clean } };
}

/** JET modification / validation error codes in plain words (the list may grow: unknown codes are shown as they are). */
export const SKIP_MODIFICATION_ERRORS: Record<string, string> = {
  badRequestFormat: 'the request is malformed',
  orderNotFound: 'Skip does not know this order',
  removedItemNotFound: 'a removed item is not on the order',
  removedItemDuplicate: 'the same item is listed twice as removed',
  removedItemSubstitutionNotEnabled: 'this item cannot be substituted',
  addedItemNotFound: 'a substitute is not on the published menu',
  addedPriceIsGreaterThanRemoved: 'a substitute costs more than the item it replaces',
  newTotalPriceLessThanOrEqualToZero: 'the order would be worth nothing after the change',
  notSupported: 'this kind of substitution is not supported',
  cancelOrderNotAllowed: 'removing every item would cancel the order, which is not allowed',
  upstreamPartner: 'the delivery partner refused the change',
  invalidModificationRequest: 'the change is not valid',
  emptyRequest: 'the change is empty',
  finalOrderAlreadyInjected: 'the final order was already sent to the restaurant system',
  internalServerError: 'Skip had an internal error',
  other: 'another reason',
};

/** "removedItemNotFound (plu 12), addedPriceIsGreaterThanRemoved" → readable text. */
export function describeSkipModificationErrors(errors: unknown): string {
  const list: any[] = Array.isArray(errors) ? errors : [];
  return list.map((e) => {
    const code = String(e?.errorCode ?? 'other');
    const plu = e?.removed?.plu ?? e?.added?.plu;
    return `${SKIP_MODIFICATION_ERRORS[code] ?? code}${plu ? ` (item ${plu})` : ''}`;
  }).join('; ');
}

const orderPath = (order: Pick<StoredOrder, 'externalOrderId'>, tail: string) => `/orders/${encodeURIComponent(order.externalOrderId)}/${tail}`;

/**
 * Tells Skip which items are out of stock (and what replaces them, or the weight a weighed item was picked at).
 * An order can be modified once: a second request is refused by JET with 409 and we say so.
 */
export async function modifySkipOrder(order: Pick<StoredOrder, 'externalOrderId'>, mods: SkipModification[]): Promise<ChannelResult> {
  const built = skipModificationBody(mods);
  if ('error' in built) return result(KEY, 'error', built.error);
  const res = await skipSend('POST', orderPath(order, 'modification'), built.body, 'queued');
  if (res.httpStatus === 409) return result(KEY, 'error', 'Skip already holds a change for this order — an order can only be modified once.', { httpStatus: 409, response: res.response });
  const errors = (res.response as { errors?: unknown } | undefined)?.errors;
  if (!res.ok && Array.isArray(errors) && errors.length) return { ...res, message: `Skip refused the change: ${describeSkipModificationErrors(errors)}.` };
  return res.ok ? { ...res, message: 'Change sent to Skip (the result comes back on the modification callback).' } : res;
}

/** Dry run: JET checks its business rules and returns what the real call would refuse. ok = nothing would be refused. */
export async function validateSkipModification(order: Pick<StoredOrder, 'externalOrderId'>, mods: SkipModification[]): Promise<ChannelResult> {
  const built = skipModificationBody(mods);
  if ('error' in built) return result(KEY, 'error', built.error);
  const res = await skipSend('POST', orderPath(order, 'validation'), built.body);
  if (!res.ok) return res;
  const errors = (res.response as { errors?: unknown } | undefined)?.errors;
  if (Array.isArray(errors) && errors.length) return { ...res, ok: false, status: 'error', message: `Skip would refuse this change: ${describeSkipModificationErrors(errors)}.` };
  return { ...res, message: 'Skip would accept this change.' };
}

export type SkipModificationState = 'initialised' | 'pending' | 'accepted' | 'failed' | 'succeeded';

/** Where a modification stands at Skip (GET /orders/{id}/modification). */
export async function getSkipModificationState(order: Pick<StoredOrder, 'externalOrderId'>): Promise<ChannelResult & { state?: SkipModificationState }> {
  const res = await skipSend('GET', orderPath(order, 'modification'));
  const state = (res.response as { state?: SkipModificationState } | undefined)?.state;
  return res.ok ? { ...res, state, message: state ? `Skip says the change is "${state}".` : 'Skip returned no state.' } : res;
}

/** JET's callback after a modification: { orderId, type: 'success' } or { orderId, type: 'failure', errors[] }. */
export function parseSkipModificationCallback(body: any): { orderId: string; success: boolean; errors: any[]; text: string } | null {
  const orderId = body?.orderId ?? body?.orderID;
  if (!orderId) return null;
  const type = String(body?.type ?? '').toLowerCase();
  const errors: any[] = Array.isArray(body?.errors) ? body.errors : [];
  const success = type === 'success';
  if (!success && type !== 'failure' && !errors.length) return null;
  return { orderId: String(orderId), success, errors, text: success ? 'Skip applied the change.' : `Skip refused the change: ${describeSkipModificationErrors(errors) || 'no reason given'}.` };
}

/**
 * The older amendment calls: POST /orders/{brandSlug}/{orderId}/amend (now marked obsolete by JET — use the modification
 * calls above) and GET for its progress. Kept for brands JET has not moved yet; failures come on the brand's
 * orderAmendmentFailurePath webhook configured at JET.
 */
export async function amendSkipOrderLegacy(brandSlug: string, orderId: string, items: Array<{ plu: string; missingQuantity: number }>): Promise<ChannelResult> {
  if (!String(brandSlug ?? '').trim() || !String(orderId ?? '').trim()) return result(KEY, 'error', 'The brand slug and the order id are required.');
  const clean = items.filter((i) => String(i?.plu ?? '').trim() && posNum(i.missingQuantity));
  if (!clean.length) return result(KEY, 'error', 'Name at least one missing item with a quantity above zero.');
  const res = await skipSend('POST', `/orders/${encodeURIComponent(brandSlug)}/${encodeURIComponent(orderId)}/amend`, { items: clean.map((i) => ({ reason: 'missing', plu: String(i.plu).trim(), missingQuantity: i.missingQuantity })) }, 'queued');
  if (res.httpStatus === 409) return { ...res, message: 'An order can only be amended once; this one already was.' };
  return res;
}

export async function getSkipAmendmentLegacy(brandSlug: string, orderId: string): Promise<ChannelResult & { state?: string }> {
  const res = await skipSend('GET', `/orders/${encodeURIComponent(brandSlug)}/${encodeURIComponent(orderId)}/amend`);
  const state = (res.response as { state?: string } | undefined)?.state;
  return res.ok ? { ...res, state, message: state ? `Skip says the amendment is "${state}".` : 'Skip returned no state.' } : res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Service times (opening hours)

export type SkipServiceType = 'Delivery' | 'Collection';
export interface SkipServiceTimesBody {
  timezone: string;
  serviceTimes: Array<{ serviceType: SkipServiceType; openingTimes: Partial<Record<(typeof DAYS)[number], Array<{ openingTime: string; closingTime: string }>>> }>;
}

/**
 * Food Hub weekly hours → JET service times. A day with no slot is left out (JET: "omitted = closed"); JET needs at
 * least one open day, so a week with no opening hours returns null (nothing is sent: use "offline" instead).
 */
export function toSkipServiceTimes(week: Partial<WeeklyHours> | null | undefined, timezone: string, services: SkipServiceType[] = ['Delivery', 'Collection']): SkipServiceTimesBody | null {
  const clean = normalizeWeek(week);
  const openingTimes: SkipServiceTimesBody['serviceTimes'][number]['openingTimes'] = {};
  for (const day of DAYS) {
    const slots = clean[day].map((s) => ({ openingTime: s.open, closingTime: s.close }));
    if (slots.length) openingTimes[day] = slots;
  }
  if (!Object.keys(openingTimes).length || !services.length) return null;
  return { timezone, serviceTimes: services.map((serviceType) => ({ serviceType, openingTimes })) };
}

/** PUT /restaurants/{ref}/servicetimes. JET intersects these with the menu hours and the delivery-pool hours. */
export function setSkipServiceTimes(store: Pick<ChannelStore, 'channelStoreId'>, week: Partial<WeeklyHours> | null | undefined, timezone: string, services?: SkipServiceType[]): Promise<ChannelResult> {
  const body = toSkipServiceTimes(week, timezone, services);
  if (!body) return Promise.resolve(result(KEY, 'skipped', 'No opening hours to send (set the store hours first) — nothing was changed on Skip.'));
  return skipSend('PUT', `/restaurants/${encodeURIComponent(store.channelStoreId)}/servicetimes`, body, 'queued');
}

// ---------------------------------------------------------------------------------------------------------------------
// Partner onboarding (JET claims a location for this integrator, then it goes live)

/** Two-letter market code, upper-cased ("ca"). JET lists UK and IE in its examples; the Canadian code is confirmed by Skip. */
export function skipMarket(market: unknown): string | null {
  const m = String(market ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(m) ? m : null;
}

/** 202 = accepted. 409 = the location is live with another integrator (switching is not supported yet) or being onboarded by one. */
export async function onboardSkipLocation(market: string, jetLocationId: string): Promise<ChannelResult> {
  const code = skipMarket(market);
  if (!code) return result(KEY, 'error', 'The market is a two-letter code (for example UK, IE).');
  if (!String(jetLocationId ?? '').trim()) return result(KEY, 'error', 'The JET location id is required.');
  const res = await skipSend('POST', `/partners/${code}/locations/onboard`, { locationId: String(jetLocationId).trim() }, 'queued');
  if (res.httpStatus === 409) return { ...res, message: 'Skip refused: this location is already live (switching an integrator is not supported yet) or another integrator is onboarding it. Ask your Skip contact to release it first.' };
  return res.ok ? { ...res, message: 'Onboarding accepted — Skip sends a notification with the session id (Settings → Platforms → Skip).' } : res;
}

export interface SkipOnboardingConfig {
  /** Catalogue contract: the POS location id JET uses to fetch the menu. */
  catalogueLocationId?: string;
  /** Order contract: base URL where JET sends orders, and the POS location id that routes them. */
  order?: { orderInjectionUrl: string; locationId: string };
}

export function skipOnboardingConfigurationBody(cfg: SkipOnboardingConfig): { body: Record<string, unknown> } | { error: string } {
  const body: Record<string, unknown> = {};
  if (cfg.catalogueLocationId?.trim()) body.catalogue = { contract: 'universal', config: { locationId: cfg.catalogueLocationId.trim() } };
  if (cfg.order) {
    const url = String(cfg.order.orderInjectionUrl ?? '').trim();
    if (!/^https:\/\//i.test(url)) return { error: 'The order address must be an https:// URL (JET only calls HTTPS).' };
    if (!String(cfg.order.locationId ?? '').trim()) return { error: 'The order configuration needs the POS location id.' };
    body.order = { contract: 'universal', config: { orderInjectionUrl: url, locationId: cfg.order.locationId.trim() } };
  }
  return Object.keys(body).length ? { body } : { error: 'Send the catalogue location id, the order configuration, or both.' };
}

/** PUT /partners/onboarding/{sessionId}/configuration — 202 = queued; 409 = the session is not waiting for it. */
export async function submitSkipOnboardingConfiguration(sessionId: string, cfg: SkipOnboardingConfig): Promise<ChannelResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId ?? '').trim())) return result(KEY, 'error', 'The session id is a UUID (it comes with the onboarding notification).');
  const built = skipOnboardingConfigurationBody(cfg);
  if ('error' in built) return result(KEY, 'error', built.error);
  const res = await skipSend('PUT', `/partners/onboarding/${encodeURIComponent(sessionId.trim())}/configuration`, built.body, 'queued');
  if (res.httpStatus === 409) return { ...res, message: 'Skip is not waiting for a configuration on this session (wrong stage).' };
  return res;
}

/** POST /partners/locations/{ref}/go-live — only succeeds from READY_TO_GO_LIVE (409 otherwise). `ref` is OUR POS location id. */
export async function goLiveSkipLocation(locationReference: string): Promise<ChannelResult> {
  if (!String(locationReference ?? '').trim()) return result(KEY, 'error', 'The POS location id is required.');
  const res = await skipSend('POST', `/partners/locations/${encodeURIComponent(locationReference.trim())}/go-live`, undefined, 'queued');
  if (res.httpStatus === 409) return { ...res, message: 'Skip says this location is not ready to go live yet (finish the configuration and the menu push first).' };
  return res.ok ? { ...res, message: 'Go-live requested — Skip confirms with an "onboardingLocationLive" notification.' } : res;
}

/**
 * X-Webhook-Signature: "sha256=<hex HMAC-SHA256(secret, timestamp + "\n" + raw body)>", timestamp from X-Webhook-Timestamp.
 * Requests older than 5 minutes are refused (replay). No secret configured = nothing can be checked = refused.
 */
export function verifySkipOnboardingSignature(headers: Headers, rawBody: string, secret: string | undefined = process.env.SKIP_ONBOARDING_HMAC_SECRET, nowMs = Date.now()): boolean {
  const timestamp = headers.get('x-webhook-timestamp');
  const signature = headers.get('x-webhook-signature');
  if (!secret || !timestamp || !signature) return false;
  const at = /^\d+$/.test(timestamp.trim()) ? Number(timestamp.trim()) * (timestamp.trim().length > 11 ? 1 : 1000) : Date.parse(timestamp);
  if (!Number.isFinite(at) || Math.abs(nowMs - at) > 5 * 60_000) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}\n${rawBody}`, 'utf8').digest('hex')}`;
  return safeEqual(expected, signature.trim().toLowerCase());
}

export type SkipOnboardingEvent = 'onboardingActionRequired' | 'onboardingTimeout' | 'onboardingFailed' | 'onboardingLocationLive';
export type SkipOnboardingStage = 'awaitingConfiguration' | 'awaitingMenuPush' | 'live';
export interface SkipOnboardingNotice {
  eventType: SkipOnboardingEvent; sessionId: string; stage: SkipOnboardingStage; timestamp: string; referenceId?: string;
  restaurant?: { name?: string; city?: string; postcode?: string; country?: string };
}

const EVENTS: SkipOnboardingEvent[] = ['onboardingActionRequired', 'onboardingTimeout', 'onboardingFailed', 'onboardingLocationLive'];
const STAGES: SkipOnboardingStage[] = ['awaitingConfiguration', 'awaitingMenuPush', 'live'];

/** The onboarding notification body, or null when it is not one. */
export function parseSkipOnboardingNotice(body: any): SkipOnboardingNotice | null {
  if (!body || typeof body !== 'object') return null;
  const eventType = EVENTS.find((e) => e === body.eventType);
  const stage = STAGES.find((s) => s === body.stage);
  if (!eventType || !stage || !body.sessionId) return null;
  const meta = body.restaurantMetadata && typeof body.restaurantMetadata === 'object' ? body.restaurantMetadata : undefined;
  return {
    eventType, stage, sessionId: String(body.sessionId), timestamp: String(body.timestamp ?? ''), referenceId: body.referenceId ? String(body.referenceId) : undefined,
    restaurant: meta ? { name: meta.name ? String(meta.name) : undefined, city: meta.city ? String(meta.city) : undefined, postcode: meta.postcode ? String(meta.postcode) : undefined, country: meta.country ? String(meta.country) : undefined } : undefined,
  };
}

/** What the person has to do next, in plain words (shown in the activity log and on the onboarding screen). */
export function skipOnboardingNextStep(n: Pick<SkipOnboardingNotice, 'eventType' | 'stage'>): string {
  if (n.eventType === 'onboardingLocationLive') return 'The location is live on Skip and takes orders.';
  if (n.eventType === 'onboardingTimeout') return 'Skip stopped waiting: a required step was not done in time. Start the onboarding again.';
  if (n.eventType === 'onboardingFailed') return 'Skip reports that the onboarding failed. Ask your Skip contact.';
  return n.stage === 'awaitingMenuPush' ? 'Publish the menu to Skip for this store, then ask for go-live.' : 'Send the configuration (catalogue and order addresses) for this session.';
}

// ---------------------------------------------------------------------------------------------------------------------
// Other notifications JET sends to us

/** "Order time updated": { restaurantId, serviceType, dayOfWeek, lowerBoundMinutes, upperBoundMinutes }. */
export function parseSkipOrderTime(body: any): { restaurantId: string; serviceType: string; dayOfWeek: string; lowerBoundMinutes: number; upperBoundMinutes: number } | null {
  if (!body?.restaurantId || !body?.serviceType || !body?.dayOfWeek) return null;
  return { restaurantId: String(body.restaurantId), serviceType: String(body.serviceType), dayOfWeek: String(body.dayOfWeek), lowerBoundMinutes: Number(body.lowerBoundMinutes) || 0, upperBoundMinutes: Number(body.upperBoundMinutes) || 0 };
}
