import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getHours } from '@/lib/foodhub/hours';
import { fail, ok } from '@/lib/foodhub/http';
import { minutesUntilClose } from '@/lib/foodhub/order-tools/line-refs';
import { FORBIDDEN_STORE_IDS } from '@/lib/foodhub/public-directory';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// GET /api/foodhub/order-tools/kitchen?locationCode=NDG_MAIN — what the kitchen status sheet needs besides the store
// list (GET /api/foodhub/stores) and the prep times (GET /api/foodhub/prep): minutes until each brand closes here
// ("Pause until close") and the protected store ids, which the sheet shows locked and never sends.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const loc = String(new URL(req.url).searchParams.get('locationCode') || '').trim();
  if (!loc) return fail('locationCode is required');
  if (!inScope(actor, loc)) return fail('Not one of your locations.', 403);
  const [stores, hours] = await Promise.all([getRepo().listStores(), getHours()]);
  const brands = [...new Set(stores.filter((s) => s.locationCode === loc && !isRelayStore(s)).map((s) => s.brandName))].sort();
  const closes = Object.fromEntries(brands.map((b) => [b, minutesUntilClose(hours, b, loc)]));
  const known = Object.values(closes).filter((m): m is number => typeof m === 'number');
  return ok({
    locationCode: loc,
    brandsCloseInMin: closes,
    // "Until close" = until the last brand open here closes (a brand already closed stays closed anyway).
    closesInMin: known.length ? Math.max(...known) : null,
    forbiddenStoreIds: [...FORBIDDEN_STORE_IDS],
  });
});
