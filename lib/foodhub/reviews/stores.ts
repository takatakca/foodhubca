// Reviews hub: which brand and kitchen a review belongs to, from the platform's store id (Stores → Mapping) or, failing
// that, from a store / brand name (lib/foodhub/brand-match.ts). Also the protected-store rule: a DoorDash review of a
// protected store (Po Poulet NDG, FORBIDDEN_STORE_IDS, and every store the menu lock protects) is never kept.
import rawBrands from '../../../data/actual/brands.json';
import rawLocations from '../../../data/actual/locations.json';
import { matchBrandLocation, type LocationRef } from '../brand-match';
import { isProtectedDoorDashId } from '../doordash/guard';
import { FORBIDDEN_STORE_IDS } from '../public-directory';
import { getRepo } from '../repo';
import type { ChannelStore } from '../types';
import type { ReviewPlatform } from './model';

export const REVIEW_BRANDS = (rawBrands as string[]).filter((b) => b !== 'Too Good To Go');
export const REVIEW_LOCATIONS = rawLocations as LocationRef[];

const idsOf = (s: Pick<ChannelStore, 'channelStoreId' | 'meta'>) => [s.channelStoreId, s.meta?.platformStoreId].map((v) => String(v ?? '').trim()).filter(Boolean);
const plainId = (v: string) => v.trim().replace(/\.0+$/, '');

/** A DoorDash store id Food Hub must never keep data for. */
export function isForbiddenDoorDashStore(id: string | null | undefined): boolean {
  const v = plainId(String(id ?? ''));
  return Boolean(v) && (FORBIDDEN_STORE_IDS.has(v) || isProtectedDoorDashId(v));
}

export interface StoreResolution { brandName: string | null; locationCode: string | null; forbidden: boolean; mapped: boolean }

export class StoreIndex {
  constructor(private stores: ChannelStore[]) {}

  static async load(): Promise<StoreIndex> {
    let stores: ChannelStore[] = [];
    try { stores = await getRepo().listStores(); } catch { /* no database: names only */ }
    return new StoreIndex(stores);
  }

  /** Brand + kitchen for a platform store reference (id first, then name). */
  resolve(platform: ReviewPlatform, storeRef: string | null | undefined, storeName?: string | null): StoreResolution {
    const ref = plainId(String(storeRef ?? ''));
    const store = ref ? this.stores.find((s) => s.channel === platform && idsOf(s).some((id) => plainId(id) === ref)) : undefined;
    const forbidden = platform === 'doordash' && (isForbiddenDoorDashStore(ref) || Boolean(store && idsOf(store).some(isForbiddenDoorDashStore)));
    if (store) return { brandName: store.brandName || null, locationCode: store.locationCode || null, forbidden, mapped: true };
    const name = [...new Set([storeName?.trim(), ref].filter(Boolean))].join(' ');
    const m = name ? matchBrandLocation(name, name, REVIEW_BRANDS, REVIEW_LOCATIONS) : {};
    return { brandName: m.suggestedBrand ?? null, locationCode: m.suggestedLocation ?? null, forbidden, mapped: false };
  }
}
