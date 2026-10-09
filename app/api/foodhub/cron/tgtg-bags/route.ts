import type { NextRequest } from 'next/server';
import { safeEqual } from '@/lib/foodhub/config';
import { fail, guard, ok } from '@/lib/foodhub/http';
import { syncAllFeedBagDays } from '@/lib/foodhub/tgtg-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// End of day for Too Good To Go: counts the day's feed orders per location (reserved, collected, no-show, cancelled) and
// writes yesterday and today into the bag log (Money → TGTG). Run it daily after closing with "Authorization: Bearer <CRON_SECRET>".
export const GET = guard(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const header = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(header, secret)) return fail('Unauthorized', 401);
  const days = await syncAllFeedBagDays();
  return ok({ days, synced: days.filter((d) => d.synced).length });
});
