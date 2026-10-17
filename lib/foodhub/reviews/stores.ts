// Reviews hub: which brand and kitchen a review belongs to, from the platform's store id (Stores → Mapping) or, failing
// that, from a store / brand name (lib/foodhub/brand-match.ts). Also the protected-store rule: a review of a protected
// DoorDash store (Po Poulet NDG, FORBIDDEN_STORE_IDS, and every store the menu lock protects by id) is never kept.
//
// The rule does not trust the platform the file was detected as, nor the column a person mapped:
//   - any cell of a row holding a protected store number drops the row (rowHasForbiddenId, every platform);
//   - the store reference and the store name are both checked, whatever the platform;
//   - a DoorDash (or unknown-platform) row known only by name is dropped when the name resolves to the protected
//     store's brand and kitchen (from its Stores → Mapping entry, else from the built-in menu-lock label).
import rawBrands from '../../../data/actual/brands.json';
import rawLocations from '../../../data/actual/locations.json';
import { matchBrandLocation, normName, type LocationRef } from '../brand-match';
import { isProtectedDoorDashId } from '../doordash/guard';
import { BUILT_IN_MENU_LOCKS } from '../menu/lock';
import { FORBIDDEN_STORE_IDS } from '../public-directory';
import { getRepo } from '../repo';
import type { ChannelStore } from '../types';
import type { ReviewPlatform } from './model';

export const REVIEW_BRANDS = (rawBrands as string[]).filter((b) => b !== 'Too Good To Go');
export const REVIEW_LOCATIONS = rawLocations as Array<LocationRef & { name?: string }>;

const idsOf = (s: Pick<ChannelStore, 'channelStoreId' | 'meta'>) => [s.channelStoreId, s.meta?.platformStoreId].map((v) => String(v ?? '').trim()).filter(Boolean);
const plainId = (v: string) => v.trim().replace(/\.0+$/, '');

/** A DoorDash store id Food Hub must never keep data for. */
export function isForbiddenDoorDashStore(id: string | null | undefined): boolean {
  const v = plainId(String(id ?? ''));
  return Boolean(v) && (FORBIDDEN_STORE_IDS.has(v) || isProtectedDoorDashId(v));
}

/** True when any cell of a raw row holds a protected DoorDash store number (whatever its column or platform). */
export function rowHasForbiddenId(cells: ReadonlyArray<unknown>): boolean {
  return cells.some((c) => {
    const v = String(c ?? '').trim();
    if (!v || v.length > 40) return false;
    return isForbiddenDoorDashStore(v) || v.split(/[^0-9A-Za-z-]+/).some((part) => part.length >= 6 && isForbiddenDoorDashStore(part));
  });
}

/** A protected store's brand and the kitchens it can be (one kitchen when mapped, every candidate from a label). */
interface ProtectedPlace { brand: string; locations: string[] }

export interface StoreResolution { brandName: string | null; locationCode: string | null; forbidden: boolean; mapped: boolean }

export class StoreIndex {
  private places: ProtectedPlace[];

  constructor(private stores: ChannelStore[]) {
    this.places = protectedPlaces(stores);
  }

  static async load(): Promise<StoreIndex> {
    let stores: ChannelStore[] = [];
    try { stores = await getRepo().listStores(); } catch { /* no database: names only */ }
    return new StoreIndex(stores);
  }

  /** Brand + kitchen for a platform store reference (id first, then name). The protected check runs on every platform. */
  resolve(platform: ReviewPlatform, storeRef: string | null | undefined, storeName?: string | null): StoreResolution {
    const ref = plainId(String(storeRef ?? ''));
    const nameIn = String(storeName ?? '').trim();
    const sameId = (s: ChannelStore) => idsOf(s).some((id) => plainId(id) === ref);
    // An unknown-platform file may be a DoorDash export: its ids are looked up on every platform's mapping.
    const store = ref ? (this.stores.find((s) => s.channel === platform && sameId(s)) ?? (platform === 'other' ? this.stores.find(sameId) : undefined)) : undefined;
    let forbidden = isForbiddenDoorDashStore(ref) || isForbiddenDoorDashStore(nameIn) || rowHasForbiddenId([ref, nameIn])
      || Boolean(store && store.channel === 'doordash' && idsOf(store).some(isForbiddenDoorDashStore));
    if (store) return { brandName: store.brandName || null, locationCode: store.locationCode || null, forbidden, mapped: true };
    const name = [...new Set([nameIn, ref].filter(Boolean))].join(' ');
    const m = name ? matchBrandLocation(name, name, REVIEW_BRANDS, REVIEW_LOCATIONS) : {};
    const brandName = m.suggestedBrand ?? null; const locationCode = m.suggestedLocation ?? null;
    if (!forbidden && (platform === 'doordash' || platform === 'other')) forbidden = this.isProtectedPlace(brandName, locationCode);
    return { brandName, locationCode, forbidden, mapped: false };
  }

  /**
   * True when a brand + kitchen known only by name could be the protected DoorDash store: same brand and the same
   * kitchen, or the kitchen is unknown (cannot tell it apart, so it is left out).
   */
  isProtectedPlace(brandName: string | null | undefined, locationCode: string | null | undefined): boolean {
    if (!brandName) return false;
    const b = normName(brandName);
    return this.places.some((p) => normName(p.brand) === b && (!locationCode || !p.locations.length || p.locations.includes(locationCode)));
  }
}

function protectedPlaces(stores: ChannelStore[]): ProtectedPlace[] {
  const out: ProtectedPlace[] = [];
  for (const s of stores) {
    if (s.channel !== 'doordash' || !idsOf(s).some(isForbiddenDoorDashStore) || !s.brandName) continue;
    out.push({ brand: s.brandName, locations: s.locationCode ? [s.locationCode] : [] });
  }
  // Built-in locks ("<brand> <kitchen> (DoorDash)"): the brand from the label, every kitchen whose code or name it names.
  for (const lock of BUILT_IN_MENU_LOCKS) {
    if (lock.channel !== 'doordash') continue;
    const m = matchBrandLocation(lock.label, lock.label, REVIEW_BRANDS, REVIEW_LOCATIONS);
    if (!m.suggestedBrand) continue;
    const brandWords = new Set(m.suggestedBrand.toLowerCase().split(/\s+/));
    const words = lock.label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !brandWords.has(w) && w !== 'doordash');
    const locations = m.suggestedLocation ? [m.suggestedLocation] : REVIEW_LOCATIONS
      .filter((l) => words.some((w) => l.code.toLowerCase().split('_').includes(w) || String(l.name ?? '').toLowerCase().split(/\s+/).includes(w)))
      .map((l) => l.code);
    if (!out.some((p) => p.brand === m.suggestedBrand && p.locations.join() === locations.join())) out.push({ brand: m.suggestedBrand, locations });
  }
  return out;
}
