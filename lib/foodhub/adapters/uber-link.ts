import type { ChannelStore } from '../types';
import type { UberPosState } from './uber-eats';

export const UBER_LINK_STATUS_FIELDS = [
  'awaitingProvision', 'provisioned', 'provisionedAt', 'provisionChangedAt', 'uberDisconnectedAt', 'menuRefreshRequested',
] as const;

/** Configuration reported by Uber. Kitchen receipt requires a separate order. */
export function uberRoutingConfirmed(state?: {
  orderManager?: UberPosState['orderManager'] | null;
  integrationEnabled?: UberPosState['integrationEnabled'];
} | null): boolean {
  return state?.orderManager === 'foodhub' && state.integrationEnabled === true;
}

/** Earlier checks lacked a store ID. Remaps clear those records; explicit conflicting IDs are always ignored. */
export function uberPosForStore(store: Pick<ChannelStore, 'channelStoreId' | 'meta'>): UberPosState | undefined {
  const pos = store.meta?.uberPos as UberPosState | undefined;
  return pos && (pos.storeId === undefined || pos.storeId === store.channelStoreId) ? pos : undefined;
}
