import { isChannelKey } from '@/lib/foodhub/adapters';
import { ok } from '@/lib/foodhub/http';
import { reconcile } from '@/lib/foodhub/recon/engine';
import { withFinance } from '@/lib/foodhub/recon/http';
import { parseRange } from '@/lib/foodhub/report-filter';
import type { ChannelKey } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/foodhub/recon?from=2026-09-01&to=2026-09-30&channels=uber_eats&locations=NDG_MAIN
export const GET = withFinance('analytics:view', async (req) => {
  const q = new URL(req.url).searchParams;
  const range = parseRange(q, 30);
  const channels = (q.get('channels') || '').split(',').filter(isChannelKey) as ChannelKey[];
  const locationCodes = (q.get('locations') || '').split(',').filter(Boolean);
  return ok({ ...(await reconcile({ ...range, channels, locationCodes })) });
});
