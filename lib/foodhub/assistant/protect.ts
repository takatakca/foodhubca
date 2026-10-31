// Owner's standing order: Po Poulet NDG (DoorDash store 27982486) is never touched — no price, no 86, no pause, no
// campaign, nothing. The assistant refuses any proposal that would reach it, BEFORE a card is shown, and checks again
// when the person taps Approve. The store is recognised three ways, any one is enough:
//   1. a mapped store carrying the built-in lock (menu/lock.ts BUILT_IN_MENU_LOCKS — mapping id or DoorDash's own number);
//   2. the protected DoorDash number appearing anywhere in what the model asked for;
//   3. the words themselves: brand "Po Poulet" + an NDG kitchen (or no kitchen) + DoorDash (or every platform).
import { BUILT_IN_MENU_LOCKS, menuLockOf } from '../menu/lock';
import type { ChannelStore } from '../types';

export const PROTECTED_IDS: ReadonlySet<string> = new Set(BUILT_IN_MENU_LOCKS.map((l) => l.id));
export const PROTECTED_LABEL = BUILT_IN_MENU_LOCKS.map((l) => l.label).join(', ');

export const REFUSAL = {
  fr: `${PROTECTED_LABEL} est protégé : Food Hub n’y touche jamais (ordre du propriétaire). Rien n’a été préparé pour ce magasin.`,
  en: `${PROTECTED_LABEL} is protected: Food Hub never touches it (owner’s order). Nothing was prepared for that store.`,
};

/** A mapped store with the built-in lock (Po Poulet NDG on DoorDash). Other locks are handled by the gated routes. */
export function isProtectedStore(store: Pick<ChannelStore, 'channel' | 'channelStoreId' | 'meta'>): boolean {
  return menuLockOf({ channel: store.channel, channelStoreId: store.channelStoreId, meta: store.meta ?? {} }).source === 'built_in';
}

const PO_POULET = /po[\s_-]*poulet/i;
const NDG = /(^|[^a-z])ndg([^a-z]|$)|notre[\s-]*dame[\s-]*de[\s-]*gr/i;

/** Words that name the protected store: Po Poulet + NDG (or no kitchen) + DoorDash (or all / unspecified platforms). */
export function namesProtectedStore(t: { brand?: string | null; location?: string | null; platforms?: ReadonlyArray<string> | null }): boolean {
  if (!t.brand || !PO_POULET.test(t.brand)) return false;
  if (t.location && !NDG.test(t.location)) return false;
  if (t.platforms && t.platforms.length && !t.platforms.some((p) => p === 'doordash' || p === 'all')) return false;
  return true;
}

/** The protected DoorDash number anywhere in a tool input (any depth, strings and numbers). */
export function mentionsProtectedId(input: unknown, depth = 0): boolean {
  if (input === null || input === undefined || depth > 6) return false;
  if (typeof input === 'string' || typeof input === 'number') {
    const s = String(input);
    for (const id of PROTECTED_IDS) if (s.includes(id)) return true;
    return false;
  }
  if (Array.isArray(input)) return input.some((v) => mentionsProtectedId(v, depth + 1));
  if (typeof input === 'object') return Object.values(input as Record<string, unknown>).some((v) => mentionsProtectedId(v, depth + 1));
  return false;
}
