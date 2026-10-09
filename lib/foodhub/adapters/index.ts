import { isMenuLocked, menuLockedResult } from '../menu/lock';
import type { ChannelAdapter, ChannelKey } from '../types';
import { doorDashAdapter } from './doordash';
import { tgtgAdapter } from './partner';
import { skipAdapter } from './skip';
import { uberEatsAdapter } from './uber-eats';
import { isViaClover, viaCloverAdapter } from './via-clover';

export const ADAPTERS: Record<ChannelKey, ChannelAdapter> = {
  uber_eats: uberEatsAdapter,
  doordash: doorDashAdapter,
  skip: skipAdapter,
  tgtg: tgtgAdapter,
};

export const CHANNEL_KEYS = Object.keys(ADAPTERS) as ChannelKey[];

export function getAdapter(key: string): ChannelAdapter {
  const normalized = key.replace('-', '_') as ChannelKey;
  const adapter = ADAPTERS[normalized];
  if (!adapter) throw new Error(`Unknown channel: ${key}`);
  // Linked to Clover directly (FOODHUB_VIA_CLOVER): Food Hub only reads its orders from Clover.
  return withMenuLock(isViaClover(normalized) ? viaCloverAdapter(adapter) : adapter);
}

/** Last line of defence for "do not touch this store's menu" (menu/lock.ts): whoever calls, a locked store gets nothing. */
function withMenuLock(a: ChannelAdapter): ChannelAdapter {
  return {
    ...a,
    publishMenu: (store, menu, ctx) => (isMenuLocked(store) ? Promise.resolve(menuLockedResult(store, 'menu publish')) : a.publishMenu(store, menu, ctx)),
    setItemAvailability: (store, refs, available, untilMs, kind) => (isMenuLocked(store) ? Promise.resolve(menuLockedResult(store, available ? 'back in stock' : '86')) : a.setItemAvailability(store, refs, available, untilMs, kind)),
  };
}

export function isChannelKey(key: string): key is ChannelKey {
  // Own keys only: `in` also accepts 'constructor' / 'toString' from Object.prototype.
  return Object.prototype.hasOwnProperty.call(ADAPTERS, key);
}
