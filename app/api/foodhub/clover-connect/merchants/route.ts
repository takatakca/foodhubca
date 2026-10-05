import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { approveCloverMerchant, cloverAppReadiness, disconnectCloverMerchant, listCloverConnections } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

// Clover merchants connected through the TAKATAK Food Hub Clover app (tokens are never returned).
export const GET = withPerm('stores:map', async () => ok({ app: cloverAppReadiness(), merchants: await listCloverConnections() }));

// Owner approves a merchant that installed the app from Clover: { merchantId }.
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string };
  const mid = String(body.merchantId || '').trim();
  if (!mid) return fail('merchantId is required.');
  return (await approveCloverMerchant(mid, actor.name || actor.username)) ? ok({ approved: mid }) : fail('This Clover merchant is not connected.', 404);
});

// Owner disconnects a merchant: { merchantId }.
export const DELETE = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string };
  const mid = String(body.merchantId || '').trim();
  if (!mid) return fail('merchantId is required.');
  const removed = await disconnectCloverMerchant(mid, 'owner', actor.name || actor.username);
  return removed ? ok({ removed: mid }) : fail('This Clover merchant is not connected.', 404);
});
