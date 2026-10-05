import { discoverUberStores } from '@/lib/foodhub/adapters/uber-eats';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// One-click store discovery (Uber Eats lists every store provisioned to the app).
export const POST = withPerm('stores:map', async (req) => {
  const b = await readJson(req);
  if (b.channel !== 'uber_eats') return fail('Discovery is available for uber_eats. DoorDash, Skip and TGTG stores are mapped with their store id.');
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(r.note, 409);
  return ok({ stores: await discoverUberStores() });
});
