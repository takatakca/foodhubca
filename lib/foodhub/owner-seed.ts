// The owner's own DoorDash store list (read from his screenshots before the store ids were mapped). It describes the
// owner's group only: another merchant's instance (FOODHUB_TENANT_ID set to something else) must never show those brands
// in its store grid, its scope picker or its counts. Read at call time, so a test can switch the tenant.
import rawDoorDashStores from '../../data/actual/platform-stores-doordash.json';
import { isOwnerTenant } from './tenant';

export interface OwnerSeedStore {
  brand_name: string;
  store_name: string;
  location_code: string;
  activation_status: string;
  open_status: string;
}

const SEED = rawDoorDashStores as OwnerSeedStore[];

/** The owner's DoorDash seed on the owner's own instance; nothing on any other merchant's instance. */
export function ownerSeedStores(env: NodeJS.ProcessEnv = process.env): OwnerSeedStore[] {
  // Fails closed: a mistyped FOODHUB_TENANT_ID is not the owner (lib/foodhub/tenant.ts isOwnerTenant).
  return isOwnerTenant(env) ? SEED : [];
}
