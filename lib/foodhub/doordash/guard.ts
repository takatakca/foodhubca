// Protected DoorDash stores: the owner's standing order is that Po Poulet NDG (DoorDash store 27982486) is never
// touched, and a manager can lock more stores (menu/lock.ts: built-in list, FOODHUB_MENU_LOCKED_STORES, Stores →
// Mapping). Every DoorDash call written for the API-coverage work goes through this guard FIRST, before a token is
// even signed: a protected store gets no read, no write, no webhook answer.
//   - a LOCKED store (built-in, env or Stores → Mapping): refused for every kind of call, reads included;
//   - a store marked "Do not touch" (store.meta.doNotTouch): refused for menu / hours / availability changes only
//     (kind "menu"), exactly like the publish path (orders, pause and resume keep working).
// The older calls (accept, reject, ready, menu publish, 86, pause) keep their own locks and are unchanged.
import { menuLockOf } from '../menu/lock';
import { getRepo } from '../repo';
import type { ChannelStore } from '../types';

/** read = GET only; write = changes something on DoorDash; menu = changes the menu, its hours or item availability. */
export type DoorDashCallKind = 'read' | 'write' | 'menu';

type StoreLike = Pick<ChannelStore, 'channelStoreId' | 'meta'>;

/** Why a call about this store must not be made (null = allowed). Pure: pass the stored row when there is one. */
export function doorDashStoreRefusal(store: StoreLike, kind: DoorDashCallKind = 'read'): string | null {
  const lock = menuLockOf({ channel: 'doordash', channelStoreId: store.channelStoreId, meta: store.meta ?? {} });
  if (lock.locked) return `Not sent: DoorDash store ${store.channelStoreId} is protected (${lock.reason ?? 'locked'}). Food Hub never touches it.`;
  if (kind === 'menu' && store.meta?.doNotTouch === true) return `Not sent: DoorDash store ${store.channelStoreId} is marked “Do not touch” (Stores → edit the store to change it).`;
  return null;
}

/** True when this id is a protected DoorDash store (its mapping id or DoorDash's own store number). */
export function isProtectedDoorDashId(id: string | number | null | undefined): boolean {
  const v = String(id ?? '').trim();
  return Boolean(v) && menuLockOf({ channel: 'doordash', channelStoreId: v, meta: {} }).locked;
}

/**
 * Async guard for a store known only by its DoorDash id (merchant_supplied_id): looks the mapping up, so a store
 * mapped under another id but carrying the protected DoorDash number is caught too. Null = allowed.
 */
export async function guardDoorDashStore(channelStoreId: string, kind: DoorDashCallKind = 'read'): Promise<string | null> {
  const id = String(channelStoreId ?? '').trim();
  if (!id) return 'No DoorDash store id.';
  let store: ChannelStore | null = null;
  try { store = await getRepo().findStore('doordash', id); } catch { /* no database: the id alone is checked */ }
  return doorDashStoreRefusal(store ?? { channelStoreId: id, meta: {} }, kind);
}

/** Same guard for an order: it belongs to the store it was placed at. */
export function guardDoorDashOrder(order: { channelStoreId?: string | null }, kind: DoorDashCallKind = 'write'): Promise<string | null> {
  return order.channelStoreId ? guardDoorDashStore(order.channelStoreId, kind) : Promise.resolve(null);
}

/** Drops protected stores from a list of DoorDash store ids (report requests, discovery lists). */
export function withoutProtectedIds<T extends string | number>(ids: T[]): { kept: T[]; dropped: T[] } {
  const kept: T[] = []; const dropped: T[] = [];
  for (const id of ids) (isProtectedDoorDashId(id) ? dropped : kept).push(id);
  return { kept, dropped };
}

const STORE_KEYS = new Set(['location_id', 'store_location_id', 'partner_store_id', 'merchant_supplied_id', 'doordash_store_id', 'store_id', 'location', 'return_location_id', 'external_store_id', 'pickup_external_store_id', 'merchant_supplied_store_id']);

/**
 * A protected DoorDash store id anywhere in a request body (store keys only, any depth), or null. For the calls that take
 * the store inside the body (onboarding, retail inventory, returns, Drive pickup ids) instead of in the URL.
 */
export function protectedIdInBody(body: unknown, depth = 0): string | null {
  if (!body || typeof body !== 'object' || depth > 6) return null;
  if (Array.isArray(body)) {
    for (const v of body) { const hit = protectedIdInBody(v, depth + 1); if (hit) return hit; }
    return null;
  }
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (STORE_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number') && isProtectedDoorDashId(v)) return String(v);
    if (v && typeof v === 'object') { const hit = protectedIdInBody(v, depth + 1); if (hit) return hit; }
  }
  return null;
}

/** The refusal text for a body that names a protected store, or null. */
export function bodyRefusal(body: unknown): string | null {
  const id = protectedIdInBody(body);
  return id ? `Not sent: DoorDash store ${id} is protected. Food Hub never touches it.` : null;
}

/** A protected store id used as a path segment of a DoorDash URL (e.g. /stores/27982486/items), or null. */
export function pathRefusal(urlOrPath: string): string | null {
  const path = urlOrPath.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  for (const seg of path.split('/')) {
    let v = seg;
    try { v = decodeURIComponent(seg); } catch { /* keep raw */ }
    if (v && isProtectedDoorDashId(v)) return `Not sent: DoorDash store ${v} is protected. Food Hub never touches it.`;
  }
  return null;
}
