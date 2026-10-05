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
  return isViaClover(normalized) ? viaCloverAdapter(adapter) : adapter;
}

export function isChannelKey(key: string): key is ChannelKey {
  return key in ADAPTERS;
}
