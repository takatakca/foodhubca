import rawLocations from '@/data/actual/locations.json';
import rawBrands from '@/data/actual/brands.json';
import rawDoorDashStores from '@/data/actual/platform-stores-doordash.json';
import rawUrbanpiperLocations from '@/data/actual/urbanpiper-confirmed-locations.json';
import { PlatformStore } from '@/lib/types';

const locations = rawLocations as Array<any>;
const brands = rawBrands as string[];
const urbanpiperLocations = rawUrbanpiperLocations as Array<any>;

const locationByCode = new Map(locations.map(l => [l.code, l]));
const doordashStores: PlatformStore[] = (rawDoorDashStores as Array<any>).map((s) => {
  const loc = locationByCode.get(s.location_code) ?? {};
  return {
    platform: 'doordash',
    brand_name: s.brand_name,
    location_code: s.location_code,
    store_name: s.store_name,
    address_line_1: s.address_line_1 ?? loc.address_line_1 ?? '',
    city: loc.city ?? 'Montréal',
    province: loc.province ?? 'QC',
    postal_code: loc.postal_code ?? '',
    activation_status: s.activation_status,
    open_status: s.open_status,
    external_business_id: s.external_business_id ?? null,
    external_store_id: s.external_store_id ?? null,
    status_symbol: s.status_symbol ?? null,
    needs_fix: s.activation_status === 'deactivated',
    ...(s.needs_review ? { needs_review: true, review_note: s.review_note } : {})
  } as PlatformStore & { needs_review?: boolean; review_note?: string };
});

export const localSeed = {
  company: { name: 'Quadro Holdings LTEE' },
  locations,
  brands,
  doordashStores,
  urbanpiperLocations
};

export function seedStats() {
  const stores = doordashStores;
  return {
    companies: 1,
    locations: locations.length,
    brands: brands.length,
    doordashStores: stores.length,
    activeStores: stores.filter(s => s.activation_status === 'active').length,
    closedStores: stores.filter(s => s.activation_status === 'active' && s.open_status === 'closed').length,
    deactivatedStores: stores.filter(s => s.activation_status === 'deactivated').length,
    urbanpiperConfirmedLocations: urbanpiperLocations.length
  };
}
