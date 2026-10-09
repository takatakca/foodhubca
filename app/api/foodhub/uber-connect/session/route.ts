import { uberConnectSession } from '@/lib/foodhub/adapters/uber-provision';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { allCloverMerchants } from '@/lib/foodhub/pos/clover';
import { listCloverConnections } from '@/lib/foodhub/pos/clover-oauth';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// The owner's Uber stores from the Connect flow, with brand / location / Clover suggestions, and the Clover merchants
// a store can be sent to (ids and names only — never tokens).
export const GET = withPerm('stores:map', async (req) => {
  const s = await uberConnectSession(new URL(req.url).searchParams.get('id') || '');
  if (!s) return fail('This Uber connection expired. Click “Connect Uber Eats” again.', 404);
  const names = new Map((await listCloverConnections().catch(() => [])).map((c) => [c.merchantId, c.name]));
  const ids = await allCloverMerchants((await getRepo().listStores().catch(() => [])).map((x) => x.cloverMerchantId)).catch(() => [] as string[]);
  return ok({ ...s, cloverMerchants: ids.map((id) => ({ id, name: names.get(id) ?? null, isDefault: id === process.env.CLOVER_MERCHANT_ID })) });
});
