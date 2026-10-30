import { fail, ok } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { authenticateApp, signedPath } from '@/lib/foodhub/suite/auth';
import { orderView } from '@/lib/foodhub/suite/bus';

export const dynamic = 'force-dynamic';

// GET /api/suite/v1/orders?since=<ISO>&limit=<1..500> — catch-up for a suite app that was down or just connected.
// Same order shape as the events (no customer name, phone, email or address). At most 7 days back.
export async function GET(req: Request) {
  const a = authenticateApp(req, signedPath(req));
  if ('error' in a) return fail(a.error, a.status);
  const u = new URL(req.url);
  const floor = Date.now() - 7 * 86400_000;
  const asked = Date.parse(u.searchParams.get('since') ?? '');
  const since = new Date(Number.isFinite(asked) ? Math.max(asked, floor) : Date.now() - 86400_000).toISOString();
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 200));
  const repo = getRepo();
  const [orders, stores] = await Promise.all([repo.listOrders({ since, limit }), repo.listStores()]);
  const byStore = new Map(stores.map((s) => [`${s.channel}|${s.channelStoreId}`, s.cloverMerchantId ?? null]));
  return ok({ since, orders: orders.map((o) => orderView(o, (x) => byStore.get(`${x.channel}|${x.channelStoreId}`) ?? null)) });
}
