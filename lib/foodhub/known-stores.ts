// Platform store ids the owner already gave us (data/actual), so they can be linked in one click — and
// confirmed against the platform's own address as soon as the API keys are in.
import rawUber from '../../data/actual/platform-stores-uber.json';
import { fetchUberStoreDetails, uberEatsAdapter } from './adapters/uber-eats';
import { suggestMapping } from './adapters/uber-provision';
import { inScope, type AuthUser } from './auth';
import { kitchenAtAddress } from './brand-match';
import { getCatalog } from './catalog';
import { getRepo } from './repo';

export interface KnownStore {
  channel: 'uber_eats';
  storeId: string;
  name: string;
  address: string | null;
  suggestedBrand: string | null;
  suggestedLocation: string | null;
  /** The current Uber address yielded the suggested kitchen. */
  confirmedByPlatform: boolean;
  mapped: { id: string; brandName: string; locationCode: string } | null;
  /** The store's kitchen: Matching live address, or the active recorded kitchen when Uber supplied no address. */
  expectedLocation: string | null;
  /** Mapped to another location than its kitchen (e.g. the Saint-Léonard stores Uber names "(Hochelaga)" put on NDG). */
  locationMismatch: boolean;
}

/** Uber store UUID → kitchen, from Uber's own address (data/actual/platform-stores-uber.json). */
export const KNOWN_UBER_KITCHENS: ReadonlyMap<string, string> = new Map(
  (rawUber.stores as Array<{ store_id: string; location_code?: string }>).filter((s) => s.location_code).map((s) => [s.store_id, s.location_code!]),
);

/** A scoped manager can see an Uber store only through its mapping or recorded kitchen.
 * If the mapping, recorded kitchen or provider address disagree, the manager needs all of the known locations.
 */
export function uberStoreInScope(actor: AuthUser, storeId: string, mappedLocation?: string, addressLocation?: string | null): boolean {
  const recordedLocation = KNOWN_UBER_KITCHENS.get(storeId);
  return inScope(actor, mappedLocation ?? recordedLocation)
    && (!recordedLocation || inScope(actor, recordedLocation))
    && (!addressLocation || inScope(actor, addressLocation));
}

export async function knownStores(): Promise<KnownStore[]> {
  const [rows, catalog] = await Promise.all([getRepo().listStores('uber_eats'), getCatalog({ strict: true })]);
  const mapped = new Map(rows.map((store) => [store.channelStoreId, store]));
  const locations = catalog.locations.filter((place) => place.active);
  const live = uberEatsAdapter.readiness().configured;
  return Promise.all((rawUber.stores as Array<{ store_id: string; uber_name: string }>).map(async (k) => {
    const details = live ? await fetchUberStoreDetails(k.store_id) : null;
    const name = details?.ok && details.name ? details.name : k.uber_name;
    const address = details?.ok ? details.address?.trim() || null : null;
    const s = suggestMapping(name, address ?? '');
    const fromAddress = kitchenAtAddress(address ?? undefined, locations);
    const recorded = KNOWN_UBER_KITCHENS.get(k.store_id);
    const expectedLocation = address ? fromAddress ?? null : locations.find((place) => place.code === recorded)?.code ?? null;
    const m = mapped.get(k.store_id);
    return {
      channel: 'uber_eats' as const, storeId: k.store_id, name, address,
      suggestedBrand: s.suggestedBrand ?? null, suggestedLocation: expectedLocation, confirmedByPlatform: Boolean(fromAddress),
      mapped: m ? { id: m.id, brandName: m.brandName, locationCode: m.locationCode } : null,
      expectedLocation, locationMismatch: Boolean(m && expectedLocation && m.locationCode !== expectedLocation),
    };
  }));
}
