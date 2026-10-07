// Uber Eats store provisioning ("integration activation") — self-serve, no aggregator.
// https://developer.uber.com/docs/eats/guides/integration-activation-flows
//  1. Owner clicks "Connect Uber Eats stores" → Uber login (scope eats.pos_provisioning).
//  2. Uber redirects back with a code → exchanged for a MERCHANT token (kept 15 min, server-side only).
//  3. GET /v1/eats/stores with that token lists the owner's stores; Food Hub suggests brand + location.
//  4. Owner confirms → POST /v1/eats/stores/{id}/pos_data activates each store for this app.
//  After that, the normal client-credentials token can read orders and manage the store.
import crypto from 'node:crypto';
import rawBrands from '../../../data/actual/brands.json';
import rawLocations from '../../../data/actual/locations.json';
import { callApi, publicBaseUrl, stripSlash, timedFetch } from '../config';
import { getRepo } from '../repo';
import type { ChannelResult } from '../types';

export const UBER_CONNECT_CALLBACK = '/api/foodhub/uber-connect/callback';
const SESSION_TTL_MS = 15 * 60_000;

type Session = { createdAt: number; token?: string | null; stores?: UberMerchantStore[]; error?: string | null };
export type UberMerchantStore = { id: string; name: string; address?: string; suggestedBrand?: string; suggestedLocation?: string };

function apiBase() { return stripSlash(process.env.UBER_BASE_URL || 'https://api.uber.com'); }
function redirectUri() { return `${publicBaseUrl()}${UBER_CONNECT_CALLBACK}`; }
const key = (id: string) => `uber-connect:${id}`;

export async function startUberConnect(): Promise<string> {
  const state = crypto.randomBytes(18).toString('hex');
  await getRepo().setKv(key(state), { createdAt: Date.now() } satisfies Session);
  const qs = new URLSearchParams({ response_type: 'code', client_id: process.env.UBER_CLIENT_ID || '', scope: 'eats.pos_provisioning', redirect_uri: redirectUri(), state });
  return `${process.env.UBER_LOGIN_URL || 'https://auth.uber.com/oauth/v2/authorize'}?${qs}`;
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

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Other names the platforms use for your brands (Uber Eats store names differ from DoorDash ones). */
export const BRAND_ALIASES: Record<string, string[]> = {
  'Gateau Montreal': ['Gateaux Montreal', 'Gateaux Montréal', 'Gâteau Montréal'],
  'Nutrition Shake': ['Nutri Shake', 'Nutrishake'],
  'Cafe Bolon': ['Bolon Cafe', 'Bolon Café', 'Café Bolon'],
  OOeuf: ["O'Oeufs", 'O Oeufs', 'OOeufs', 'Ooeuf'],
  'Bin molle & Bin Dure': ['Bin Molle Bin Dure', 'Binmolle Bindure'],
  'Dejeuner & Dinner': ['Dejeuner et Dinner', 'Déjeuner & Dîner'],
};

/**
 * Other civic numbers the platforms use for a location's building: Uber lists the Saint-Léonard kitchen at
 * 5839 Rue Jean-Talon E, Food Hub's record says 5837.
 */
export const LOCATION_NUMBER_ALIASES: Record<string, string[]> = { SAINT_LEONARD: ['5839'] };

/** "6280 Av Somerled" → "somerled": the street name without the number or the street type, for a fallback match. */
const streetOf = (line: string) => norm(line.replace(/^\s*\d+[a-z]?\s+/i, '').replace(/\b(av|ave|avenue|rue|boul|boulevard|ch|chemin|e|o|est|ouest)\b\.?/gi, ' '));

/**
 * Suggests the brand (longest brand name or alias found in the store name) and location (civic number in the address,
 * then a street that only one location is on, then the neighbourhood name). The owner always confirms.
 */
export function suggestMapping(name: string, address = ''): { suggestedBrand?: string; suggestedLocation?: string } {
  const n = norm(name);
  const names = (rawBrands as string[]).filter((b) => b !== 'Too Good To Go').flatMap((b) => [b, ...(BRAND_ALIASES[b] ?? [])].map((alias) => ({ brand: b, alias: norm(alias) })));
  // "Crèmerie Bin Molle Bin Dure" must win over "Bin molle & Bin Dure" when both match: longest match first.
  const brand = names.filter((x) => x.alias && n.includes(x.alias)).sort((a, b) => b.alias.length - a.alias.length)[0]?.brand;
  const text = `${address} ${name}`;
  const locations = rawLocations as Array<{ code: string; address_line_1: string }>;
  const numbers = (l: { code: string; address_line_1: string }) => [l.address_line_1.split(' ')[0], ...(LOCATION_NUMBER_ALIASES[l.code] ?? [])];
  let suggestedLocation = locations.find((l) => numbers(l).some((num) => new RegExp(`\\b${num}\\b`).test(text)))?.code;
  if (!suggestedLocation && address) {
    // Same street, unknown number: only when a single location is on that street (two kitchens share Somerled).
    const a = norm(address);
    const onStreet = locations.filter((l) => streetOf(l.address_line_1) && a.includes(streetOf(l.address_line_1)));
    if (onStreet.length === 1) suggestedLocation = onStreet[0].code;
  }
  if (!suggestedLocation && /hochelaga/i.test(text)) suggestedLocation = 'HOCHELAGA';
  if (!suggestedLocation && /l[eé]onard/i.test(text)) suggestedLocation = 'SAINT_LEONARD';
  return { suggestedBrand: brand, suggestedLocation };
}

/** Callback: validates state, exchanges the code, lists the owner's stores. Returns the session id to show in the UI. */
export async function finishUberConnect(state: string, code: string): Promise<{ ok: boolean; id: string; error?: string }> {
  const session = await getSession(state);
  if (!session || session.token !== undefined) return { ok: false, id: state, error: 'This Uber connection link expired or was already used. Click “Connect Uber Eats stores” again.' };
  const save = (s: Session) => getRepo().setKv(key(state), s);
  try {
    const res = await timedFetch(process.env.UBER_AUTH_URL || 'https://auth.uber.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.UBER_CLIENT_ID || '', client_secret: process.env.UBER_CLIENT_SECRET || '', grant_type: 'authorization_code', redirect_uri: redirectUri(), code }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Uber did not return a merchant token (HTTP ${res.status}).`);
    const token = String(json.access_token);
    const list = await timedFetch(`${apiBase()}/v1/eats/stores`, { headers: { Authorization: `Bearer ${token}` } });
    if (!list.ok) throw new Error(`Uber store list failed (HTTP ${list.status}).`);
    const body = await list.json();
    const rows: any[] = Array.isArray(body?.stores) ? body.stores : Array.isArray(body?.data) ? body.data : [];
    const stores: UberMerchantStore[] = rows.map((s) => {
      const address = [s.location?.address, s.location?.address_2, s.location?.city].filter(Boolean).join(', ') || undefined;
      const name = String(s.name ?? s.store_name ?? s.store_id);
      return { id: String(s.store_id ?? s.id), name, address, ...suggestMapping(name, address) };
    });
    await save({ ...session, token, stores, error: null });
    return { ok: true, id: state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await save({ ...session, token: null, stores: [], error: message });
    return { ok: false, id: state, error: message };
  }
}

export async function uberConnectSession(id: string): Promise<{ stores: UberMerchantStore[]; error: string | null; active: boolean } | null> {
  const s = await getSession(id);
  if (!s) return null;
  return { stores: s.stores ?? [], error: s.error ?? null, active: Boolean(s.token) };
}

/** Activates the selected stores for this app (merchant token) — the token is discarded afterwards. */
export async function activateUberStores(id: string, picks: Array<{ storeId: string; brandName: string; locationCode: string }>): Promise<Array<{ storeId: string; result: ChannelResult }>> {
  const s = await getSession(id);
  if (!s?.token) throw new Error('Uber connection expired. Click “Connect Uber Eats stores” again.');
  const out: Array<{ storeId: string; result: ChannelResult }> = [];
  for (const p of picks) {
    const result = await callApi('uber_eats', `${apiBase()}/v1/eats/stores/${encodeURIComponent(p.storeId)}/pos_data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_order_manager: true, integrator_store_id: `${p.locationCode}:${p.brandName}`.slice(0, 100), integrator_brand_id: p.brandName.slice(0, 100) }),
    });
    out.push({ storeId: p.storeId, result });
  }
  // Keep the token (until the session expires) only while some store still failed, so it can be retried.
  if (out.every((r) => r.result.ok)) await getRepo().setKv(key(id), { ...s, token: null });
  return out;
}
