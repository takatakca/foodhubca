import { inScope, withPerm } from '@/lib/foodhub/auth';
import { isChannelKey } from '@/lib/foodhub/adapters';
import { fail, ok } from '@/lib/foodhub/http';
import { statusHistory, toCsv } from '@/lib/foodhub/store-availability/history';

export const dynamic = 'force-dynamic';

const MAX_RANGE_MS = 92 * 86400_000;

// Status history (pauses, resumes, platform changes, busy mode, holidays, guard) — JSON, or ?format=csv.
// ?from=&to= (ISO) or ?days=N (default the last 7 days, at most 92 days) &location= &brand= &channel=
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const toMs = q.get('to') ? Date.parse(String(q.get('to'))) : Date.now();
  const days = Number(q.get('days') || 7);
  const fromMs = q.get('from') ? Date.parse(String(q.get('from'))) : toMs - (Number.isFinite(days) && days > 0 ? days : 7) * 86400_000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return fail('from / to must be dates, from before to');
  if (toMs - fromMs > MAX_RANGE_MS) return fail('At most 92 days at a time');
  const location = q.get('location') || undefined;
  if (location && !inScope(actor, location)) return fail('Not one of your locations.', 403);
  const channel = q.get('channel') || undefined;
  if (channel && !isChannelKey(channel)) return fail('Unknown channel');
  const rows = await statusHistory({
    from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    ...(location ? { locationCode: location } : actor.locations.length ? { locationCodes: actor.locations } : {}),
    ...(q.get('brand') ? { brandName: String(q.get('brand')) } : {}),
    ...(channel && isChannelKey(channel) ? { channel } : {}),
  });
  if (q.get('format') === 'csv') {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="historique-statuts-${day(fromMs)}-${day(toMs)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }
  return ok({ rows: rows.slice(0, 1000), total: rows.length });
});
