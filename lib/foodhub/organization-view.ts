// A read-only projection of this Food Hub instance, not another identity or billing authority.
// V1 owns Client/Membership and master merchant identities. A Food Hub kitchen may serve several brands;
// V1 BusinessLocation (one brand) therefore cannot be inferred from a kitchen code.
import type { Catalog } from './catalog';
import type { ChannelStore } from './types';

const CHANNELS = ['uber_eats', 'doordash', 'skip', 'tgtg'] as const;
type OrganizationStore = Pick<ChannelStore, 'id' | 'channel' | 'brandName' | 'locationCode' | 'cloverMerchantId'>;

export interface OrganizationViewInput {
  /** Comes from server tenantInfo(), never a request query/body. */
  tenantId: string;
  ownerTenant: boolean;
  catalog: Catalog;
  /** Raw persisted catalog is the provenance boundary on a non-owner instance: never inherit owner seed facts. */
  persistedCatalog: Partial<Catalog> | null;
  stores: readonly OrganizationStore[];
  /** Same existing authorization contract as AuthUser: [] means all locations in THIS instance. */
  allowedLocations: readonly string[];
  mode: 'memory' | 'supabase';
  controlPlaneConfigured: boolean;
}

const compare = (a: string, b: string) => a.localeCompare(b, 'fr');

export function buildOrganizationView(input: OrganizationViewInput) {
  // On another merchant's silo, only explicit persisted catalog entries establish ownership. In particular,
  // a legitimate custom brand/location with the same name/code as an owner seed is retained with ITS saved facts.
  const source: Catalog = input.ownerTenant ? input.catalog : {
    brands: input.persistedCatalog?.brands ?? [],
    locations: input.persistedCatalog?.locations ?? [],
  };
  const allLocations = input.allowedLocations.length === 0;
  const locationDefs = [...new Map(source.locations
    .filter((location) => allLocations || input.allowedLocations.includes(location.code))
    .map((location) => [location.code, location])).values()].sort((a, b) => compare(a.name, b.name));
  const visibleLocations = new Set(locationDefs.map((location) => location.code));
  const brandDefs = new Map(source.brands.map((brand) => [brand.name, brand]));
  const candidates = input.stores.filter((store) => visibleLocations.has(store.locationCode));
  const seen = new Set<string>();
  const stores = candidates.filter((store) => {
    if (!brandDefs.has(store.brandName) || !(CHANNELS as readonly string[]).includes(store.channel)) return false;
    if (seen.has(store.id)) return false;
    seen.add(store.id);
    return true;
  });
  const boundBrands = new Set(stores.map((store) => store.brandName));
  // A location-restricted actor never learns names of brands sold only at another kitchen or unassigned brands.
  const brands = [...brandDefs.values()].filter((brand) => allLocations || boundBrands.has(brand.name))
    .sort((a, b) => compare(a.name, b.name)).map((brand) => {
      const brandStores = stores.filter((store) => store.brandName === brand.name);
      return {
        name: brand.name,
        active: brand.active,
        locations: locationDefs.filter((location) => brandStores.some((store) => store.locationCode === location.code))
          .map((location) => {
            const atLocation = brandStores.filter((store) => store.locationCode === location.code);
            return {
              code: location.code, name: location.name, active: location.active,
              platforms: CHANNELS.map((channel) => ({ channel, mappedStores: atLocation.filter((store) => store.channel === channel).length }))
                .filter((platform) => platform.mappedStores > 0),
              mappedStores: atLocation.length,
            };
          }),
        mappedStores: brandStores.length,
      };
    });
  const locations = locationDefs.map((location) => ({
    code: location.code, name: location.name, active: location.active,
    brands: brands.filter((brand) => brand.locations.some((entry) => entry.code === location.code)).map((brand) => brand.name),
    mappedStores: stores.filter((store) => store.locationCode === location.code).length,
  }));
  return {
    organization: {
      id: input.tenantId,
      ownershipModel: 'single_instance' as const,
      identityAuthority: 'takatak-v1' as const,
      externalClientId: null,
      externalLinkStatus: 'unlinked' as const,
    },
    access: { locations: allLocations ? 'all_instance_locations' as const : 'assigned_locations' as const },
    brands,
    locations,
    totals: {
      brands: brands.length,
      locations: locations.length,
      mappedStores: stores.length,
      mappedCloverMerchants: new Set(stores.map((store) => store.cloverMerchantId).filter(Boolean)).size,
    },
    mapping: {
      /** Counts describe authorized saved mappings, not provider approval, fresh online status or order acceptance. */
      basis: 'saved_store_mappings' as const,
      unassignedBrands: allLocations ? brands.filter((brand) => brand.locations.length === 0).map((brand) => brand.name) : [],
      unassignedLocations: locations.filter((location) => location.brands.length === 0).map((location) => location.code),
      invalidMappingsAtVisibleLocations: candidates.filter((store) => !brandDefs.has(store.brandName) || !(CHANNELS as readonly string[]).includes(store.channel)).length,
    },
    readiness: {
      persistence: input.mode === 'supabase' ? 'durable_repository' as const : 'memory_only' as const,
      controlPlane: input.controlPlaneConfigured ? 'configuration_present' as const : 'not_configured' as const,
      identitySynchronization: 'not_verified' as const,
      providerAcceptance: 'not_verified' as const,
      tenantIsolation: 'single_instance' as const,
    },
  };
}

export type OrganizationView = ReturnType<typeof buildOrganizationView>;
