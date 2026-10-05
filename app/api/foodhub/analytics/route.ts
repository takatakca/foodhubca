import { withPerm } from '@/lib/foodhub/auth';
import { buildAnalytics } from '@/lib/foodhub/analytics';
import { fail, ok } from '@/lib/foodhub/http';
import { parseFilters, parseRange } from '@/lib/foodhub/report-filter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/foodhub/analytics?from=2026-09-01&to=2026-09-30&locations=NDG_MAIN&channels=uber_eats&brands=Po%20Poulet
export const GET = withPerm('analytics:view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  let range: { from: string; to: string };
  try { range = parseRange(q, 7); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); } // a bad date picker value is a 400, not a 500
  const f = parseFilters(q, actor);
  return ok({ ...(await buildAnalytics({ ...range, locationCodes: f.locationCodes, channels: f.channels, brands: f.brands })) });
});
