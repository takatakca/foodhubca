import type { NextRequest } from 'next/server';
import { safeEqual } from '@/lib/foodhub/config';
import { fail, guard, ok } from '@/lib/foodhub/http';
import { runExtraBrandBilling } from '@/lib/foodhub/pos/clover-extra-brands';

export const dynamic = 'force-dynamic';

// Clover extra-brand billing: records this month's count and sends last month's once (idempotent per merchant and
// month). Off unless FOODHUB_CLOVER_METERED_ENABLED=true. The sync also runs it, at most once an hour.
// "Authorization: Bearer <CRON_SECRET>".
export const GET = guard(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const header = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(header, secret)) return fail('Unauthorized', 401);
  return ok({ result: await runExtraBrandBilling() });
});
