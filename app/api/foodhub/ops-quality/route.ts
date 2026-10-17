import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { buildOpsQuality } from '@/lib/foodhub/ops-quality';
import { parseFilters, parseRange } from '@/lib/foodhub/report-filter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

// GET /api/foodhub/ops-quality?from=2026-09-01&to=2026-09-28&locations=&channels=&brands=&stores=<ChannelStore ids>
// Operations quality (missing / incorrect, ready late, avoidable cancellations, downtime) vs the owner's goals.
// Read-only: computed from Food Hub's own data, no platform call.
export const GET = withPerm('analytics:view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  let range: { from: string; to: string };
  try { range = parseRange(q, 28); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); } // a bad date picker value is a 400, not a 500
  const f = parseFilters(q, actor);
  return ok({ ...(await buildOpsQuality({ ...range, locationCodes: f.locationCodes, channels: f.channels, brands: f.brands, storeIds: list(q.get('stores')) })) });
});
