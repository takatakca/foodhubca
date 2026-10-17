// Shared bits of the store availability center: who paused, which stores are never touched, the channel list.
import type { Actor } from '../activity';
import { isDoNotTouch, menuLockOf } from '../menu/lock';
import { FORBIDDEN_STORE_IDS } from '../public-directory';
import type { ChannelKey, ChannelStore, PlatformStatus } from '../types';

export const AVAILABILITY_CHANNELS: ChannelKey[] = ['uber_eats', 'doordash', 'skip', 'tgtg'];

/** The reason the tablet-off guard writes on its pauses (meta.platformStatus.detail): how it recognises its own pauses. */
export const GUARD_REASON = 'Tablette de cuisine éteinte';
export const GUARD_ACTOR: Actor = { username: 'guard', name: 'Garde tablette', source: 'automation' };

/** Ids a store is known by on its platform: the mapping id and the platform's own store number. */
function idsOf(store: Pick<ChannelStore, 'channelStoreId' | 'meta'>): string[] {
  const own = store.meta?.platformStoreId;
  return [store.channelStoreId, ...(own ? [String(own)] : [])].map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Owner's order: these DoorDash stores are never touched by any automation — FORBIDDEN_STORE_IDS and every DoorDash
 * lock (built in, FOODHUB_MENU_LOCKED_STORES, or Stores → Mapping), the same rule as the DoorDash guard
 * (doorDashStoreRefusal: a locked DoorDash store is never touched by Food Hub).
 */
export function isForbiddenStore(store: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): boolean {
  if (store.channel !== 'doordash') return false;
  if (idsOf(store).some((id) => FORBIDDEN_STORE_IDS.has(id))) return true;
  return menuLockOf(store).locked;
}

/** Never paused or resumed by an automation of this center ("do not touch", or a forbidden DoorDash store). */
export function isLockedStore(store: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): boolean {
  return isDoNotTouch(store) || isForbiddenStore(store);
}

export function platformStatusOf(store: Pick<ChannelStore, 'meta'>): PlatformStatus | undefined {
  return store.meta?.platformStatus as PlatformStatus | undefined;
}

/** Online on its platform right now (the same reading as the Stores page). */
export function isStoreOnline(store: Pick<ChannelStore, 'online' | 'meta'>): boolean {
  return (platformStatusOf(store)?.state ?? (store.online ? 'online' : 'paused')) === 'online';
}

/** An error with its French text, for the French console (the routes answer { error, errorFr }). */
export class BilingualError extends Error {
  constructor(message: string, public messageFr: string) { super(message); }
}

/** { error, errorFr } of any error (a plain error has no French text: the English one is used for both). */
export function errorFields(e: unknown): { error: string; errorFr: string } {
  const error = e instanceof Error ? e.message : String(e);
  return { error, errorFr: e instanceof BilingualError ? e.messageFr : error };
}

/** Never throws: the heartbeat must keep running whatever one part does. */
export async function safely<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[foodhub] ${what} failed`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** Activity action of a busy-schedule change (kind "hours"): shown in the status history. */
export const BUSY_SCHEDULE_ACTION = 'busy_schedule_saved';

/** Who the busy schedule writes as (prep changes, history): its own name, so it recognises its own busy mode. */
export const BUSY_ACTOR: Actor = { username: 'busy-schedule', name: 'Calendrier occupé', source: 'schedule' };

/** Activity action (kind "hours"): a window ended but busy mode stayed on, because a person changed it meanwhile. */
export const BUSY_KEPT_ACTION = 'busy_schedule_kept';
