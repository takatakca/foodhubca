import { discoverUberStores, uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { suggestMapping } from '@/lib/foodhub/adapters/uber-provision';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { uberStoreInScope } from '@/lib/foodhub/known-stores';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// One-click store discovery (Uber Eats lists every store provisioned to the app).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (b.channel !== 'uber_eats') return fail('Discovery is available for uber_eats. DoorDash, Skip and TGTG stores are mapped with their store id.');
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(r.note, 409);
  const stores = await discoverUberStores();
  if (!actor.locations.length) return ok({ stores });
  const mappedLocations = new Map((await getRepo().listStores('uber_eats')).map((store) => [store.channelStoreId, store.locationCode]));
  return ok({ stores: stores.filter((store) => {
    // An address suggestion can flag a conflict but cannot authorize an unlinked store.
    const addressLocation = store.address ? suggestMapping('', store.address).suggestedLocation : undefined;
    return uberStoreInScope(actor, store.id, mappedLocations.get(store.id), addressLocation);
  }) });
});
