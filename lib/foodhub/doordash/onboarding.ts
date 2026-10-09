// Getting a store live on DoorDash: every onboarding API.
//   SOW  POST https://openapi.doordash.com/webhooks/stores/onboarding        Store Onboarding Webhook (single merchant, one call per store)
//   SSIO POST/GET/DELETE …/marketplace/api/v2/…                              Self-Serve Integration Onboarding (OAuth by the store's Business Admin)
//   NV   POST …/marketplace/api/v2/managed_merchant_connect_url              hosted onboarding link (retail / new verticals)
//        POST …/marketplace/api/v2/nv_multi_location_onboarding_intent       up to 100 locations in one call
//   GET  …/marketplace/api/v1/store_onboarding/{id}/store_menu               the menu DoorDash already has for an onboarding
// Specs: https://developer.doordash.com/en-US/docs/marketplace/overview/onboarding/sow/ , …/onboarding/ssio/ ,
//        https://developer.doordash.com/en-US/api/marketplace_v2/ (New Verticals Self-Serve Integration Onboarding)
// The status DoorDash reports back (INTEGRATION_REQUESTED → … → INTEGRATION_ACTIVATED, or MENU_BLOCK / ACTIVATION_BLOCK /
// ABANDONED + exclusion code) arrives on the onboarding webhook (webhooks/doordash.ts) and shows on the store row.
import { logActivity, type Actor } from '../activity';
import { nowIso, result, stripSlash } from '../config';
import { getRepo } from '../repo';
import type { ChannelResult, ChannelStore } from '../types';
import { ddRequest, type DdResult } from './api';
import { bodyRefusal, doorDashStoreRefusal } from './guard';

const KEY = 'doordash' as const;
const enc = encodeURIComponent;
const blocked = (message: string): ChannelResult => result(KEY, 'blocked', message);

/** Origin of the DoorDash OpenAPI host (the SOW webhook lives outside /marketplace). */
export const openApiOrigin = () => stripSlash(process.env.DOORDASH_OPENAPI_ORIGIN || 'https://openapi.doordash.com');
export const sowUrl = () => process.env.DOORDASH_SOW_URL || `${openApiOrigin()}/webhooks/stores/onboarding`;

export interface SowKitchen { name: string; address: string; city?: string; postalCode?: string; province?: string }
export interface SowRequestor { firstName: string; lastName: string; email: string; phone?: string }

/** The SOW body, from stored data (DoorDash: required fields must be filled programmatically, not typed by hand). */
export function sowBody(store: Pick<ChannelStore, 'channelStoreId' | 'brandName' | 'meta'>, kitchen: SowKitchen, requestor: SowRequestor, merchantDecisionMakerEmail: string, opts: { expectedGoLive?: string } = {}): { body?: Record<string, unknown>; error?: string } {
  const providerType = (process.env.DOORDASH_PROVIDER_TYPE || '').trim();
  if (!providerType) return { error: 'DOORDASH_PROVIDER_TYPE is missing (DoorDash issues it when the Marketplace integration is approved).' };
  if (!kitchen.address?.trim() || !(kitchen.city || '').trim() || !(kitchen.postalCode || '').trim()) return { error: `The address of ${kitchen.name} is incomplete (street, city and postal code are required: Settings → Business).` };
  if (!requestor.firstName?.trim() || !requestor.lastName?.trim() || !/^\S+@\S+\.\S+$/.test(requestor.email || '')) return { error: 'The person asking needs a first name, a last name and an email (DoorDash sends the status updates there).' };
  if (!/^\S+@\S+\.\S+$/.test(merchantDecisionMakerEmail || '')) return { error: 'The merchant decision maker email is required: a Business Admin of the store in the DoorDash Merchant Portal gets the consent request.' };
  const dd = Number(store.meta?.platformStoreId);
  return { body: {
    partner_store_id: store.channelStoreId,
    partner_business_id: store.brandName,
    ...(Number.isInteger(dd) && dd > 0 ? { doordash_store_id: dd } : {}),
    partner_store_name: store.brandName,
    partner_location_name: kitchen.name,
    provider_type: providerType,
    address_line_1: kitchen.address.trim(),
    address_city: kitchen.city!.trim(),
    address_state: (kitchen.province || 'QC').trim(),
    address_zip: kitchen.postalCode!.trim(),
    requestor_first_name: requestor.firstName.trim(),
    requestor_last_name: requestor.lastName.trim(),
    requestor_email: requestor.email.trim(),
    ...(requestor.phone ? { requestor_phone: requestor.phone } : {}),
    ...(opts.expectedGoLive && /^\d{4}-\d{2}-\d{2}$/.test(opts.expectedGoLive) ? { expected_go_live_date: opts.expectedGoLive } : {}),
    merchant_decision_maker_email: merchantDecisionMakerEmail.trim(),
  } };
}

/**
 * "Request DoorDash activation" for one store: POST the Store Onboarding Webhook. DoorDash emails the Business Admin for consent,
 * pulls the menu (Menu Request), runs QA and activates; the status comes back on the onboarding webhook. One store per call.
 * Our side must be ready within 14 days and menu problems fixed within 48 business hours (SLAs in the SOW spec).
 */
export async function requestDoorDashActivation(store: ChannelStore, kitchen: SowKitchen, requestor: SowRequestor, merchantDecisionMakerEmail: string, actor: Actor, opts: { expectedGoLive?: string } = {}): Promise<DdResult> {
  const refused = doorDashStoreRefusal(store, 'write');
  if (refused) return blocked(refused);
  const built = sowBody(store, kitchen, requestor, merchantDecisionMakerEmail, opts);
  if (!built.body) return blocked(built.error!);
  const res = await ddRequest({ method: 'POST', url: sowUrl(), body: built.body, storeId: store.channelStoreId, kind: 'write' });
  if (res.ok) {
    await getRepo().updateStore(store.id, { meta: { ...store.meta, doordashOnboarding: { status: 'INTEGRATION_REQUESTED', requestedAt: nowIso(), requestedBy: actor.name, requestorEmail: requestor.email, at: nowIso() } } });
  }
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'doordash_activation_request', status: res.ok ? 'success' : 'failed', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash activation requested for ${store.brandName} · ${store.locationCode}${res.ok ? '' : ` (${res.message})`}` });
  return res;
}

// ---------------------------------------------------------------------------------------------- SSIO (OAuth, Business Admin)

const v2 = (path: string) => `/api/v2${path}`;

/** Merchant JWT header of the SSIO calls that act for the store owner. */
const mx = (merchantJwt?: string) => (merchantJwt ? { MxAuthorization: merchantJwt } : undefined);

export const ssio = {
  /** POST /tokens — exchange the OAuth code the store's Business Admin granted for a Merchant JWT. */
  exchangeToken: (body: { code: string; [k: string]: unknown }) => ddRequest({ method: 'POST', path: v2('/tokens'), body, kind: 'write' }),
  /** GET /store_candidates — the DoorDash stores this Business Admin owns (limit ≤ 100). */
  storeCandidates: (merchantJwt: string, limit = 100, offset = 0) => ddRequest({ method: 'GET', path: v2(`/store_candidates?limit=${Math.min(100, Math.max(1, limit))}&offset=${Math.max(0, offset)}`), headers: mx(merchantJwt) }),
  /** POST /store_onboarding — start the onboarding of one store. */
  initialize: (merchantJwt: string, body: Record<string, unknown>) => ddRequest({ method: 'POST', path: v2('/store_onboarding'), body, headers: mx(merchantJwt), kind: 'write' }),
  /** GET /store_onboarding/{id} — optional: the webhook is the required way to follow the status. */
  status: (onboardingId: string) => ddRequest({ method: 'GET', path: v2(`/store_onboarding/${enc(onboardingId)}`) }),
  /** POST /store_onboarding/{id}/menus — create or update the menu for this onboarding. */
  putMenu: (onboardingId: string, menu: Record<string, unknown>) => ddRequest({ method: 'POST', path: v2(`/store_onboarding/${enc(onboardingId)}/menus`), body: menu, kind: 'write' }),
  /** POST /store_onboarding/{id}/enable — activate the integration once the menu is MENU_QUALIFIED. */
  enable: (onboardingId: string) => ddRequest({ method: 'POST', path: v2(`/store_onboarding/${enc(onboardingId)}/enable`), kind: 'write' }),
  /** POST /signup_url — sign-up link for a merchant that is new to DoorDash. */
  signupUrl: (body: Record<string, unknown>) => ddRequest({ method: 'POST', path: v2('/signup_url'), body, kind: 'write' }),
  /** DELETE /store_onboarding/{id} — reset (testing only). */
  reset: (onboardingId: string) => ddRequest({ method: 'DELETE', path: v2(`/store_onboarding/${enc(onboardingId)}`), kind: 'write' }),
  /** GET /api/v1/store_onboarding/{id}/store_menu — the menu DoorDash already has for this onboarding. */
  onboardingMenu: (onboardingId: string) => ddRequest({ method: 'GET', path: `/api/v1/store_onboarding/${enc(onboardingId)}/store_menu` }),
};

// ---------------------------------------------------------------------------------------------- New Verticals self-serve

export interface ManagedMerchantConnect {
  location_id: string; location_group_id: string; store_name: string; location_name?: string;
  address: { line_1: string; line_2?: string; city: string; state: string; zip: string };
  first_name: string; last_name: string; email: string; business_phone?: string; expected_go_live_date?: string;
  merchant_decision_maker_email: string; order_protocol: 'POS' | 'TABLET'; fulfillment_protocol: 'MERCHANT_PICK' | 'DASHER_PICK'; locale: 'en-US';
}

/** POST /managed_merchant_connect_url — a DoorDash-hosted onboarding link for one location (retail / new verticals). 409 = the store exists. */
export async function managedMerchantConnectUrl(req: ManagedMerchantConnect): Promise<DdResult<{ managed_merchant_connect_url?: string }>> {
  const refused = bodyRefusal(req);
  if (refused) return blocked(refused);
  const res = await ddRequest({ method: 'POST', path: v2('/managed_merchant_connect_url'), body: req, kind: 'write' });
  return res.httpStatus === 409 ? { ...res, message: 'DoorDash already has this store.' } : res;
}

/** POST /nv_multi_location_onboarding_intent — onboarding intent for 1 to 100 locations; each is processed alone (see `results`). */
export async function nvMultiLocationOnboardingIntent(requests: ManagedMerchantConnect[]): Promise<DdResult> {
  if (!requests.length || requests.length > 100) return blocked('Send between 1 and 100 locations.');
  const refused = bodyRefusal(requests);
  if (refused) return blocked(refused);
  return ddRequest({ method: 'POST', path: v2('/nv_multi_location_onboarding_intent'), body: { requests }, kind: 'write' });
}
