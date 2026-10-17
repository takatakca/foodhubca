import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { isCloverAppKey, type CloverAppKey } from '@/lib/foodhub/pos/clover-apps';
import { approveCloverMerchant, cloverAppReadiness, disconnectCloverMerchant, listCloverConnections } from '@/lib/foodhub/pos/clover-oauth';

export const dynamic = 'force-dynamic';

/** Which Clover app a request is about: ?app= or { app } — absent = Food Hub (unchanged behaviour). */
function appOf(v: unknown): CloverAppKey | null {
  if (v === undefined || v === null || v === '') return 'foodhub';
  return isCloverAppKey(v) ? v : null;
}

// Clover merchants connected through one of our Clover apps (tokens are never returned). ?app=phone for the AI phone app.
export const GET = withPerm('stores:map', async (req) => {
  const app = appOf(new URL(req.url).searchParams.get('app'));
  if (!app) return fail('Unknown Clover app.');
  return ok({ app: cloverAppReadiness(app), merchants: await listCloverConnections(app) });
});

// Owner approves a merchant that installed an app from Clover: { merchantId, app? }.
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string; app?: string };
  const mid = String(body.merchantId || '').trim();
  const app = appOf(body.app);
  if (!mid) return fail('merchantId is required.');
  if (!app) return fail('Unknown Clover app.');
  return (await approveCloverMerchant(mid, actor.name || actor.username, app)) ? ok({ approved: mid, app }) : fail('This Clover merchant is not connected.', 404);
});

// Owner disconnects a merchant from one app (the other app's connection is kept): { merchantId, app? }.
export const DELETE = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string; app?: string };
  const mid = String(body.merchantId || '').trim();
  const app = appOf(body.app);
  if (!mid) return fail('merchantId is required.');
  if (!app) return fail('Unknown Clover app.');
  const removed = await disconnectCloverMerchant(mid, 'owner', actor.name || actor.username, app);
  return removed ? ok({ removed: mid, app }) : fail('This Clover merchant is not connected.', 404);
});
