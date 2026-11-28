import type { ChannelStore } from './types';

type StoreRoute = Pick<ChannelStore, 'channel' | 'channelStoreId' | 'locationCode' | 'cloverMerchantId'>;

/** Resolve the register shown in Uber Connect from the store's route and the destination kitchen's mappings. */
export function uberCloverChoice(
  storeId: string, locationCode: string | undefined, stores: StoreRoute[], defaultMerchantId: string | null,
  existing = stores.find((store) => store.channel === 'uber_eats' && store.channelStoreId === storeId),
): { required: boolean; suggestedClover?: string } {
  if (!locationCode) return { required: false };
  if (existing) {
    if (existing.locationCode !== locationCode) return { required: true };
    return { required: false, suggestedClover: existing.cloverMerchantId || undefined };
  }

  const peers = stores.filter((store) => store.locationCode === locationCode);
  const destinations = new Set(peers.map((store) => store.cloverMerchantId || defaultMerchantId));
  if (destinations.size > 1) return { required: true };
  // Keep an implicit default implicit when every peer uses it.
  return { required: false, suggestedClover: peers.find((store) => store.cloverMerchantId)?.cloverMerchantId || undefined };
}
