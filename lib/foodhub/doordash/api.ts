// DoorDash Marketplace API, the calls the adapter (adapters/doordash.ts) does not make: the "read what DoorDash really
// has" endpoints. Spec: https://developer.doordash.com/en-US/api/marketplace/ (Store Endpoints).
//   GET /api/v1/stores/{id}/store_details              live store: protocol, auto order release, current deactivations
//   GET /api/v1/stores/{id}/menu_details               live menus: ids, active, last update, regular + special hours
//   GET /api/v1/stores/{id}/store_menu                 the menu JSON DoorDash serves ("Integrated Get Menu")
//   GET /api/v1/stores/{id}/item/availability          one item: is_active, start_time, end_time
//   GET /api/v1/stores/{id}/item_option/availability   one option
// Every call goes through the protected-store guard first (doordash/guard.ts) and DoorDash's retry rules
// (doordash/retry.ts). Reads need the three credentials only (they change nothing on DoorDash); anything that changes
// DoorDash also needs LIVE_CONNECTORS_GLOBAL_ENABLED=true, like the rest of the adapter.
import { doorDashBase, doorDashHeaders, doorDashReadiness, normalizeDoorDashDetails } from '../adapters/doordash';
import { blockedResult } from '../adapters/common';
import { callApi, missingEnv, result } from '../config';
import type { ChannelResult, PlatformState } from '../types';
import { guardDoorDashStore, type DoorDashCallKind } from './guard';
import { withDoorDashRetry } from './retry';

const KEY = 'doordash' as const;
export const DOORDASH_CREDENTIALS = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET'];

export interface DdRequest {
  method: string;
  /** Path under the Marketplace base URL (…/marketplace), or a full URL when `url` is set. */
  path?: string;
  url?: string;
  body?: unknown;
  /** The DoorDash store (merchant_supplied_id) the call is about: protected stores are refused before anything is sent. */
  storeId?: string;
  /** read = GET only (credentials are enough); write/menu change DoorDash (the live switch must be on). Default: read for GET. */
  kind?: DoorDashCallKind;
  /** Background jobs may wait the full minute after a 429. */
  waitOn429?: boolean;
  okStatus?: 'done' | 'queued';
  /** Extra headers (rare). */
  headers?: Record<string, string>;
}

export interface DdResult<T = unknown> extends ChannelResult { data?: T }

/** One DoorDash Marketplace call: guard → readiness → request with DoorDash's retry rules. Never throws. */
export async function ddRequest<T = any>(req: DdRequest): Promise<DdResult<T>> {
  const kind: DoorDashCallKind = req.kind ?? (req.method.toUpperCase() === 'GET' ? 'read' : 'write');
  if (req.storeId !== undefined) {
    const refused = await guardDoorDashStore(req.storeId, kind);
    if (refused) return result(KEY, 'blocked', refused);
  }
  if (kind === 'read') {
    const missing = missingEnv(DOORDASH_CREDENTIALS);
    if (missing.length) return result(KEY, 'blocked', `DoorDash credentials missing: ${missing.join(', ')}.`);
  } else {
    const r = doorDashReadiness();
    if (!r.canSend) return blockedResult(KEY, r);
  }
  const url = req.url ?? `${doorDashBase()}${req.path ?? ''}`;
  const res = await withDoorDashRetry(
    () => callApi(KEY, url, { method: req.method, headers: { ...doorDashHeaders(), ...(req.headers ?? {}) }, body: req.body === undefined ? undefined : JSON.stringify(req.body) }, req.okStatus ?? 'done'),
    { method: req.method, waitOn429: req.waitOn429 },
  );
  return { ...res, data: res.ok ? (res.response as T) : undefined };
}

const enc = encodeURIComponent;
const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const asNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// ---------------------------------------------------------------------------------------------- store_details

export interface DoorDashStoreDetails {
  providerName: string | null;
  merchantSuppliedId: string;
  isActive: boolean | null;
  /** The store takes orders through a POS (true) or a tablet (false). */
  orderProtocolPos: boolean | null;
  autoRelease: { enabled: boolean | null; distance: number | null; fromStoreEnabled: boolean | null };
  specialInstructionsMaxLength: number | null;
  deactivations: Array<{ reason: string; notes: string; createdAt: string | null; endTime: string | null }>;
  state: PlatformState;
  detail?: string;
  until?: string | null;
}

/** GET store_details, normalized (the adapter's fetchDoorDashStoreStatus keeps only the state). */
export function normalizeStoreDetails(storeId: string, body: any): DoorDashStoreDetails {
  const list: any[] = Array.isArray(body?.current_deactivations) ? body.current_deactivations : [];
  const state = normalizeDoorDashDetails(body);
  return {
    providerName: body?.provider_name ? String(body.provider_name) : null,
    merchantSuppliedId: String(body?.merchant_supplied_id ?? storeId),
    isActive: asBool(body?.is_active),
    orderProtocolPos: asBool(body?.is_order_protocol_pos),
    autoRelease: { enabled: asBool(body?.auto_release_enabled), distance: asNum(body?.auto_release_distance), fromStoreEnabled: asBool(body?.auto_release_from_store_enabled) },
    specialInstructionsMaxLength: asNum(body?.special_instructions_max_length),
    deactivations: list.map((d) => ({ reason: String(d?.reason ?? ''), notes: String(d?.notes ?? ''), createdAt: d?.created_at ? String(d.created_at) : null, endTime: d?.end_time ? String(d.end_time) : null })),
    ...state,
  };
}

export async function getDoorDashStoreDetails(storeId: string): Promise<DdResult<DoorDashStoreDetails>> {
  const res = await ddRequest({ method: 'GET', path: `/api/v1/stores/${enc(storeId)}/store_details`, storeId });
  return res.ok ? { ...res, data: normalizeStoreDetails(storeId, res.response) } : { ...res, data: undefined };
}

// ---------------------------------------------------------------------------------------------- menu_details

export interface DoorDashHoursSlot { day: string; start: string; end: string }
export interface DoorDashSpecialSlot { date: string; start: string; end: string; closed: boolean }
export interface DoorDashLiveMenu {
  id: string; name: string; subtitle: string; active: boolean | null; isPosMenu: boolean | null; url: string | null;
  lastUpdateStatus: string | null; lastUpdateAt: string | null; lastSuccessAt: string | null;
  openHours: DoorDashHoursSlot[]; specialHours: DoorDashSpecialSlot[];
}

/** "08:00:00" → "08:00" (DoorDash sends both forms). */
export const hhmm = (v: unknown): string => String(v ?? '').slice(0, 5);

export function normalizeMenuDetails(body: any): DoorDashLiveMenu[] {
  const menus: any[] = Array.isArray(body?.menus) ? body.menus : [];
  return menus.map((m) => ({
    id: String(m?.menu_id ?? m?.id ?? ''),
    name: String(m?.name ?? ''),
    subtitle: String(m?.subtitle ?? ''),
    active: asBool(m?.is_active),
    isPosMenu: asBool(m?.is_pos_menu),
    url: m?.url ? String(m.url) : null,
    lastUpdateStatus: m?.latest_menu_update?.status ? String(m.latest_menu_update.status) : null,
    lastUpdateAt: m?.latest_menu_update?.created_at ? String(m.latest_menu_update.created_at) : null,
    lastSuccessAt: m?.last_successful_menu_update_at ? String(m.last_successful_menu_update_at) : null,
    openHours: (Array.isArray(m?.open_hours) ? m.open_hours : []).map((h: any) => ({ day: String(h?.day_index ?? '').toUpperCase(), start: hhmm(h?.start_time), end: hhmm(h?.end_time) })),
    specialHours: (Array.isArray(m?.special_hours) ? m.special_hours : []).map((h: any) => ({ date: String(h?.date ?? ''), start: hhmm(h?.start_time), end: hhmm(h?.end_time), closed: h?.closed === true })),
  }));
}

export async function getDoorDashMenuDetails(storeId: string): Promise<DdResult<DoorDashLiveMenu[]>> {
  const res = await ddRequest({ method: 'GET', path: `/api/v1/stores/${enc(storeId)}/menu_details`, storeId });
  return res.ok ? { ...res, data: normalizeMenuDetails(res.response) } : { ...res, data: undefined };
}

// ---------------------------------------------------------------------------------------------- store_menu

export interface DoorDashLiveEntry {
  id: string; name: string; type: 'item' | 'item_option';
  active: boolean; suspended: boolean;
  /** Delivery price and pickup price, in cents, as DoorDash serves them. */
  price: number | null; basePrice: number | null;
  menuId?: string;
}
export interface DoorDashLiveMenuJson { menus: Array<{ id: string; reference: string; name: string; active: boolean | null }>; entries: DoorDashLiveEntry[] }

/** Items and options of GET store_menu (one menu object, or a menus[] list), flattened. */
export function flattenStoreMenu(body: any): DoorDashLiveMenuJson {
  const menuObjects: any[] = Array.isArray(body?.menus) ? body.menus : body?.menu ? [body] : [];
  const entries: DoorDashLiveEntry[] = [];
  const menus: DoorDashLiveMenuJson['menus'] = [];
  const walkOptions = (extras: any, menuId: string) => {
    for (const ex of Array.isArray(extras) ? extras : []) {
      for (const op of Array.isArray(ex?.options) ? ex.options : []) {
        if (op?.merchant_supplied_id !== undefined) {
          entries.push({ id: String(op.merchant_supplied_id), name: String(op.name ?? ''), type: 'item_option', active: op.active !== false, suspended: op.is_suspended === true, price: asNum(op.price), basePrice: asNum(op.base_price), menuId });
        }
        walkOptions(op?.extras, menuId);
      }
    }
  };
  for (const m of menuObjects) {
    const inner = m?.menu ?? {};
    const menuId = String(m?.id ?? m?.menu_id ?? inner?.merchant_supplied_id ?? '');
    menus.push({ id: menuId, reference: String(m?.reference ?? ''), name: String(inner?.name ?? ''), active: asBool(inner?.active) });
    for (const cat of Array.isArray(inner?.categories) ? inner.categories : []) {
      for (const it of Array.isArray(cat?.items) ? cat.items : []) {
        if (it?.merchant_supplied_id !== undefined) {
          entries.push({ id: String(it.merchant_supplied_id), name: String(it.name ?? ''), type: 'item', active: it.active !== false, suspended: it.is_suspended === true, price: asNum(it.price), basePrice: asNum(it.base_price), menuId });
        }
        walkOptions(it?.extras, menuId);
      }
    }
  }
  return { menus, entries };
}

export async function getDoorDashStoreMenu(storeId: string): Promise<DdResult<DoorDashLiveMenuJson>> {
  const res = await ddRequest({ method: 'GET', path: `/api/v1/stores/${enc(storeId)}/store_menu`, storeId });
  return res.ok ? { ...res, data: flattenStoreMenu(res.response) } : { ...res, data: undefined };
}

// ---------------------------------------------------------------------------------------------- item availability

export interface DoorDashAvailability { id: string; active: boolean; start: string | null; end: string | null }

export function normalizeAvailability(id: string, body: any): DoorDashAvailability {
  return { id: String(body?.merchant_supplied_id ?? id), active: body?.is_active !== false, start: body?.start_time ? String(body.start_time) : null, end: body?.end_time ? String(body.end_time) : null };
}

/**
 * The path of GET …/item/availability and …/item_option/availability. DoorDash's reference writes
 * `/api/v1/stores/{merchant_supplied_id}/item/availability` and describes that path parameter as the "Item ID in your
 * system" (not the store id), with no query parameter. Food Hub follows the reference literally by default;
 * DOORDASH_AVAILABILITY_STYLE=store makes it `/stores/{store id}/item/availability?merchant_supplied_id={item id}` if
 * the sandbox turns out to want that (docs/DOORDASH_API_COVERAGE.md lists it as a question for DoorDash).
 */
export function availabilityPath(storeId: string, id: string, type: 'item' | 'item_option'): string {
  return process.env.DOORDASH_AVAILABILITY_STYLE === 'store'
    ? `/api/v1/stores/${enc(storeId)}/${type}/availability?merchant_supplied_id=${enc(id)}`
    : `/api/v1/stores/${enc(id)}/${type}/availability`;
}

/** GET …/item/availability or …/item_option/availability (one id per call; 404 = DoorDash does not know the id). */
export async function getDoorDashAvailability(storeId: string, id: string, type: 'item' | 'item_option' = 'item', waitOn429 = false): Promise<DdResult<DoorDashAvailability>> {
  // The guard looks at OUR store, whatever the URL style: a protected store is never asked about, not even for one item.
  const res = await ddRequest({ method: 'GET', path: availabilityPath(storeId, id, type), storeId, waitOn429 });
  return res.ok ? { ...res, data: normalizeAvailability(id, res.response) } : { ...res, data: undefined };
}
