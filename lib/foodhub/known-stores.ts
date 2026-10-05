// Platform store ids the owner already gave us (data/actual), so they can be linked in one click — and
// confirmed against the platform's own address as soon as the API keys are in.
import rawUber from '../../data/actual/platform-stores-uber.json';
import { fetchUberStoreDetails, uberEatsAdapter } from './adapters/uber-eats';
import { suggestMapping } from './adapters/uber-provision';
import { getRepo } from './repo';

export interface KnownStore {
  channel: 'uber_eats';
  storeId: string;
  name: string;
  address: string | null;
  suggestedBrand: string | null;
  suggestedLocation: string | null;
  /** Read from Uber (address confirmed) or only from the name the owner gave. */
  confirmedByPlatform: boolean;
  mapped: { id: string; brandName: string; locationCode: string } | null;
}

export async function knownStores(): Promise<KnownStore[]> {
  const mapped = new Map((await getRepo().listStores('uber_eats')).map((s) => [s.channelStoreId, s]));
  const live = uberEatsAdapter.readiness().configured;
  return Promise.all((rawUber.stores as Array<{ store_id: string; uber_name: string }>).map(async (k) => {
    const details = live ? await fetchUberStoreDetails(k.store_id) : null;
    const name = details?.ok && details.name ? details.name : k.uber_name;
    const address = details?.ok ? details.address ?? null : null;
    const s = suggestMapping(name, address ?? '');
    const m = mapped.get(k.store_id);
    return {
      channel: 'uber_eats' as const, storeId: k.store_id, name, address,
      suggestedBrand: s.suggestedBrand ?? null, suggestedLocation: s.suggestedLocation ?? null, confirmedByPlatform: Boolean(details?.ok),
      mapped: m ? { id: m.id, brandName: m.brandName, locationCode: m.locationCode } : null,
    };
  }));
}
