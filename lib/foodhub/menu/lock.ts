// "Do not touch this store's menu": a store whose menu Food Hub must never change — no publish (manual, scheduled,
// "publish every brand", Uber menu refresh), no DoorDash Menu Request answer, no 86 / back-in-stock (by staff, by the
// Clover inventory sync or by a timed 86 ending). Pausing, prep time and orders are not menu changes and still work.
//
// Three sources, any one locks the store:
//   1. Built in: stores the owner said must never be changed by any automation (Po Poulet NDG on DoorDash). They
//      cannot be unlocked from the console.
//   2. FOODHUB_MENU_LOCKED_STORES: "doordash:27982486,uber_eats:<store uuid>" (or bare ids), for the hosting setup.
//   3. Stores → Mapping → "Never change this store's menu" (meta.menuLocked), set by a manager.
// A store matches on its Food Hub store id on the platform (channelStoreId) or on the platform's own store number
// (meta.platformStoreId — DoorDash's store number differs from the merchant_supplied_id Food Hub maps it with).
import { result } from '../config';
import type { ChannelResult, ChannelStore } from '../types';

/** Owner instruction: DoorDash store 27982486 (Po Poulet NDG) is never changed by any automation. */
export const BUILT_IN_MENU_LOCKS: ReadonlyArray<{ channel: ChannelStore['channel']; id: string; label: string }> = [
  { channel: 'doordash', id: '27982486', label: 'Po Poulet NDG (DoorDash)' },
];

export type MenuLockSource = 'built_in' | 'env' | 'store';
export interface MenuLock { locked: boolean; source?: MenuLockSource; reason?: string; reasonFr?: string }

function envLocks(): Array<{ channel: string | null; id: string }> {
  return String(process.env.FOODHUB_MENU_LOCKED_STORES || '')
    .split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
    .map((x) => {
      const m = x.match(/^(uber_eats|uber-eats|doordash|skip|tgtg):(.+)$/i);
      return m ? { channel: m[1].toLowerCase().replace('-', '_'), id: m[2] } : { channel: null, id: x };
    });
}

/** Ids a store is known by: its mapping id and the platform's own store number. */
function idsOf(store: Pick<ChannelStore, 'channelStoreId' | 'meta'>): string[] {
  const own = store.meta?.platformStoreId;
  return [store.channelStoreId, ...(own ? [String(own)] : [])].map((x) => String(x).trim()).filter(Boolean);
}

export function menuLockOf(store: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): MenuLock {
  const ids = idsOf(store);
  const builtIn = BUILT_IN_MENU_LOCKS.find((l) => l.channel === store.channel && ids.includes(l.id));
  if (builtIn) return { locked: true, source: 'built_in', reason: `${builtIn.label}: the owner asked that its menu is never changed by Food Hub.`, reasonFr: `${builtIn.label} : le propriétaire a demandé que Food Hub ne change jamais son menu.` };
  if (envLocks().some((l) => (!l.channel || l.channel === store.channel) && ids.includes(l.id))) {
    return { locked: true, source: 'env', reason: 'Listed in FOODHUB_MENU_LOCKED_STORES.', reasonFr: 'Inscrit dans FOODHUB_MENU_LOCKED_STORES.' };
  }
  if (store.meta?.menuLocked === true) {
    const own = typeof store.meta.menuLockedReason === 'string' && store.meta.menuLockedReason.trim() ? store.meta.menuLockedReason.trim() : null;
    return { locked: true, source: 'store', reason: own ?? 'Locked under Stores → Mapping.', reasonFr: own ?? 'Verrouillé sous Magasins → Branchements.' };
  }
  return { locked: false };
}

export function isMenuLocked(store: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): boolean {
  return menuLockOf(store).locked;
}

/** The honest result for a menu action on a locked store: nothing was sent (status skipped, never "done"). */
export function menuLockedResult(store: ChannelStore, what = 'menu change'): ChannelResult {
  const lock = menuLockOf(store);
  return result(store.channel, 'skipped', `Not sent — this store's menu is locked (${what} never sent by Food Hub). ${lock.reason ?? ''} · Non envoyé — le menu de ce magasin est verrouillé.`.trim());
}
