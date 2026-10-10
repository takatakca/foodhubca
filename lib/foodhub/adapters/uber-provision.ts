// Uber Eats store provisioning ("integration activation") — self-serve, no aggregator.
// https://developer.uber.com/docs/eats/guides/integration-activation-flows
//  1. Owner clicks "Connect Uber Eats" → Uber login (scope eats.pos_provisioning, authorization_code).
//  2. Uber redirects back with a code → exchanged for a MERCHANT token (kept 15 min, server-side only).
//  3. GET /v1/eats/stores (every page) with that token lists the owner's stores; Food Hub suggests brand, location
//     and Clover merchant, and shows which app takes each store's orders today (pos_data.order_manager_client_id).
//  4. Owner confirms → per store:
//     a. POST /v1/eats/stores/{id}/pos_data (merchant token): integrator ids, is_order_manager, webhooks_config.
//     b. PATCH …/pos_data {integration_enabled: true} (app token): switches the order webhooks on (Going Live guide).
//     c. GET …/pos_data (app token): who is the order manager now — Food Hub, pending, or still another app.
//  Uber documents no "already integrated" error: promoting Food Hub demotes the previous order manager (UrbanPiper),
//  sometimes only after a delay — step c says so plainly instead of claiming the store is live.
import crypto from 'node:crypto';
import rawBrands from '../../../data/actual/brands.json';
import rawLocations from '../../../data/actual/locations.json';
import { matchBrandLocation, type LocationRef } from '../brand-match';
import { callApi, publicBaseUrl, result, timedFetch } from '../config';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';
import { enableUberIntegration, fetchUberPosData, listUberStorePages, uberApiBase, uberAuthorizeUrl, uberOrderManager, uberTokenUrl, type UberOrderManager, type UberPosState } from './uber-eats';

export const UBER_CONNECT_CALLBACK = '/api/foodhub/uber-connect/callback';
const SESSION_TTL_MS = 15 * 60_000;

type Session = { createdAt: number; token?: string | null; stores?: UberMerchantStore[]; error?: string | null };
export type UberMerchantStore = {
  id: string; name: string; address?: string; suggestedBrand?: string; suggestedLocation?: string;
  /** Who takes this store's orders today, from Uber's pos_data in the store list ('unknown' when Uber does not say). */
  orderManager?: UberOrderManager;
};

function redirectUri() { return `${publicBaseUrl()}${UBER_CONNECT_CALLBACK}`; }
const key = (id: string) => `uber-connect:${id}`;

export async function startUberConnect(): Promise<string> {
  const state = crypto.randomBytes(18).toString('hex');
  await getRepo().setKv(key(state), { createdAt: Date.now() } satisfies Session);
  const qs = new URLSearchParams({ response_type: 'code', client_id: process.env.UBER_CLIENT_ID || '', scope: 'eats.pos_provisioning', redirect_uri: redirectUri(), state });
  return `${uberAuthorizeUrl()}?${qs}`;
}

/**
 * Body of POST /v1/eats/stores/{id}/pos_data. webhooks_version is left unset on purpose: Food Hub reads orders with
 * GET /v2/eats/order/{id}, which is what Uber's resource_href points to without a version ("1.0.0" would point it at
 * /v1/delivery/order/{id}, a different payload). Courier tracking (delivery.state_changed) is switched on.
 */
export function uberPosDataBody(p: { brandName: string; locationCode: string }) {
  return {
    integrator_store_id: `${p.locationCode}:${p.brandName}`.slice(0, 100),
    integrator_brand_id: p.brandName.slice(0, 100),
    is_order_manager: true,
    // Food Hub accepts by API once Clover has the order (never a blind accept): no manual acceptance on Uber's side.
    require_manual_acceptance: false,
    allowed_customer_requests: { allow_single_use_items_requests: true, allow_special_instruction_requests: true },
    webhooks_config: {
      order_release_webhooks: { is_enabled: false },
      schedule_order_webhooks: { is_enabled: false },
      delivery_status_webhooks: { is_enabled: true },
    },
  };
}

/** What a refused activation means for the owner (Uber's own reason is kept at the end). */
export function explainActivationError(res: ChannelResult): string {
  const why = res.message;
  if (/already|integrat|order.?manager|conflict|another|existing/i.test(why) || res.httpStatus === 409) {
    return `Uber says this store is still linked to another integration (e.g. UrbanPiper) — that integration must disconnect it first, or ask Uber (merchants@uber.com) to move it. Uber: ${why}`;
  }
  if (res.httpStatus === 403 || res.httpStatus === 401) return `Your Uber login cannot manage this store — sign in with the Uber Eats Manager owner account, then “Connect Uber Eats” again. Uber: ${why}`;
  if (res.httpStatus === 404) return `Uber does not show this store to this app (production access not granted yet, or the store belongs to another account). Uber: ${why}`;
  return why;
}

async function getSession(id: string): Promise<Session | null> {
  if (!/^[a-f0-9]{36}$/.test(id)) return null;
  const s = await getRepo().getKv<Session>(key(id));
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    // Expired: never keep the merchant's provisioning token around.
    if (s.token) await getRepo().setKv(key(id), { createdAt: s.createdAt, token: null }).catch(() => undefined);
    return null;
  }
  return s;
}

// Brand / address matching lives in lib/foodhub/brand-match.ts (shared with the finance report); re-exported here.
export { BRAND_ALIASES, LOCATION_NUMBER_ALIASES } from '../brand-match';

/**
 * Suggests the brand (longest brand name or alias found in the store name) and location (civic number in the address,
 * then a street that only one location is on, then the neighbourhood name). The owner always confirms.
 */
export function suggestMapping(name: string, address = ''): { suggestedBrand?: string; suggestedLocation?: string } {
  return matchBrandLocation(name, address, rawBrands as string[], rawLocations as LocationRef[]);
}

/** Callback: validates state, exchanges the code, lists the owner's stores. Returns the session id to show in the UI. */
export async function finishUberConnect(state: string, code: string): Promise<{ ok: boolean; id: string; error?: string }> {
  const session = await getSession(state);
  if (!session || session.token !== undefined) return { ok: false, id: state, error: 'This Uber connection link expired or was already used. Click “Connect Uber Eats stores” again.' };
  const save = (s: Session) => getRepo().setKv(key(state), s);
  try {
    const res = await timedFetch(uberTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.UBER_CLIENT_ID || '', client_secret: process.env.UBER_CLIENT_SECRET || '', grant_type: 'authorization_code', redirect_uri: redirectUri(), code }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Uber did not return a merchant token (HTTP ${res.status}${json?.error ? `: ${[json.error, json.error_description].filter(Boolean).join(' — ')}` : ''}).`);
    const token = String(json.access_token);
    const rows = await listUberStorePages((url) => timedFetch(url, { headers: { Authorization: `Bearer ${token}` } }));
    const stores: UberMerchantStore[] = rows.map((s) => {
      const address = [s.location?.address, s.location?.address_2, s.location?.city].filter(Boolean).join(', ') || undefined;
      const name = String(s.name ?? s.store_name ?? s.store_id);
      return { id: String(s.store_id ?? s.id), name, address, ...suggestMapping(name, address), orderManager: uberOrderManager(s.pos_data) };
    });
    await save({ ...session, token, stores, error: null });
    return { ok: true, id: state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await save({ ...session, token: null, stores: [], error: message });
    return { ok: false, id: state, error: message };
  }
}

export async function uberConnectSession(id: string): Promise<{ stores: Array<UberMerchantStore & { suggestedClover?: string }>; error: string | null; active: boolean } | null> {
  const s = await getSession(id);
  if (!s) return null;
  // Clover merchant suggestion: the register the other stores at that location already use (most common one).
  const mapped = await getRepo().listStores().catch(() => []);
  const cloverAt = (loc?: string) => {
    const counts = new Map<string, number>();
    for (const m of mapped) if (loc && m.locationCode === loc && m.cloverMerchantId) counts.set(m.cloverMerchantId, (counts.get(m.cloverMerchantId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return { stores: (s.stores ?? []).map((x) => ({ ...x, suggestedClover: cloverAt(x.suggestedLocation) })), error: s.error ?? null, active: Boolean(s.token) };
}

export interface UberActivation {
  storeId: string;
  /** The activation itself (POST pos_data). */
  result: ChannelResult;
  /** Order webhooks switched on (PATCH integration_enabled); null when the activation failed. */
  enabled: ChannelResult | null;
  /** Who takes the orders now, read right after (GET pos_data); null when it could not be read. */
  pos: UberPosState | null;
  /** One sentence for the owner. */
  message: string;
}

export function activationMessage(a: Pick<UberActivation, 'result' | 'enabled' | 'pos'>): string {
  if (!a.result.ok) return explainActivationError(a.result);
  const notOn = a.enabled && !a.enabled.ok ? ` Order webhooks are not switched on yet (${a.enabled.message}) — use “Check with Uber” to retry.` : '';
  switch (a.pos?.orderManager) {
    case 'foodhub': return `Activated — Food Hub now receives this store’s orders.${notOn}`;
    case 'pending': return `Activated — Uber is moving this store’s orders to Food Hub (pending). Keep the tablet on until “Check with Uber” says Food Hub.${notOn}`;
    case 'other': return `Activated, but another integration (e.g. UrbanPiper) still receives this store’s orders — they keep going there until it disconnects the store (or Uber moves it: merchants@uber.com).${notOn}`;
    default: return `Sent to Uber — waiting for Uber to confirm (store.provisioned). Use “Check with Uber” to see who receives the orders.${notOn}`;
  }
}

/**
 * Activates the selected stores for this app: POST pos_data (merchant token), then switches the order webhooks on and
 * reads back who is the order manager (app token). The merchant token is discarded once every store went through.
 */
export async function activateUberStores(id: string, picks: Array<{ storeId: string; brandName: string; locationCode: string }>): Promise<UberActivation[]> {
  const s = await getSession(id);
  if (!s?.token) throw new Error('Uber connection expired. Click “Connect Uber Eats” again.');
  const out: UberActivation[] = [];
  for (const p of picks) {
    const res = await callApi('uber_eats', `${uberApiBase()}/v1/eats/stores/${encodeURIComponent(p.storeId)}/pos_data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(uberPosDataBody(p)),
    });
    const enabled = res.ok ? await enableUberIntegration(p.storeId).catch((e) => result('uber_eats', 'error', e instanceof Error ? e.message : String(e))) : null;
    const read = res.ok ? await fetchUberPosData(p.storeId) : null;
    const a = { storeId: p.storeId, result: res, enabled, pos: read?.ok ? read.state ?? null : null };
    out.push({ ...a, message: activationMessage(a) });
  }
  // Keep the token (until the session expires) only while some store still failed, so it can be retried.
  if (out.every((r) => r.result.ok)) await getRepo().setKv(key(id), { ...s, token: null });
  return out;
}

/**
 * "Disconnect from Uber" (store offboarding): DELETE /v1/eats/stores/{id}/pos_data, "delete a store's app
 * integration" (https://developer.uber.com/docs/eats/references/api/v1/delete-eats-stores-storeid-posdata). Uber's
 * POS provisioning guide: de-provisioning uses the MERCHANT token (authorization_code, eats.pos_provisioning), so it
 * runs inside a "Connect Uber Eats" session. Permanent: linking the store again means a new activation.
 * (A temporary stop is PATCH pos_data integration_enabled: false, not this.)
 */
export async function disconnectUberStore(id: string, storeId: string): Promise<ChannelResult> {
  const s = await getSession(id);
  if (!s?.token) throw new Error('Uber connection expired. Click “Connect Uber Eats” again, then Disconnect.');
  if (!(s.stores ?? []).some((x) => x.id === storeId)) throw new Error('This store is not on the Uber Eats account you signed in with.');
  return callApi('uber_eats', `${uberApiBase()}/v1/eats/stores/${encodeURIComponent(storeId)}/pos_data`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${s.token}` },
  });
}
