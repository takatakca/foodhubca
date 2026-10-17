import { withPerm } from '@/lib/foodhub/auth';
import { buildCustomerInsights, DIRECT_MODES, type DirectMode } from '@/lib/foodhub/customer-insights';
import { fail, ok } from '@/lib/foodhub/http';
import { parseFilters, parseRange } from '@/lib/foodhub/report-filter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/foodhub/customer-insights?from=2026-09-01&to=2026-09-30&locations=…&channels=uber_eats&brands=…&direct=include|exclude|only
// Aggregates and anonymous c_ ids only: no name, phone, e-mail or address ever leaves the server.
export const GET = withPerm('analytics:view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  let range: { from: string; to: string };
  try { range = parseRange(q, 30); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); } // a bad date picker value is a 400, not a 500
  const directQ = (q.get('direct') ?? '').trim();
  if (directQ && !DIRECT_MODES.includes(directQ as DirectMode)) return fail('direct must be include, exclude or only.');
  const f = parseFilters(q, actor);
  return ok({ ...(await buildCustomerInsights({ ...range, locationCodes: f.locationCodes, channels: f.channels, brands: f.brands, direct: (directQ || undefined) as DirectMode | undefined })) });
});
