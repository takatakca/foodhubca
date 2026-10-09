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
