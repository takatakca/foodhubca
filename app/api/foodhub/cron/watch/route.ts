import type { NextRequest } from 'next/server';
import { safeEqual } from '@/lib/foodhub/config';
import { fail, guard, ok } from '@/lib/foodhub/http';
import { reopenExpiredPauses } from '@/lib/foodhub/ops';
import { runOrderRecovery } from '@/lib/foodhub/recovery';
import { runWatch } from '@/lib/foodhub/watch/engine';
import { tickExpansion } from '@/lib/foodhub/expansion/tick';
import { tickCloverWebsiteOrders } from '@/lib/foodhub/pos/clover-website-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The Watchtower heartbeat for when no screen is open — exactly when "your tablet is off" matters.
// Call it every minute from any scheduler with "Authorization: Bearer <CRON_SECRET>"
// (Vercel Pro cron, Supabase pg_cron + pg_net, cron-job.org, GitHub Actions…). Open screens already
// trigger it every 20 s through the live pulse; on a long-running server (`next start`)
// instrumentation.ts runs it on a timer too.
export const GET = guard(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const header = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(header, secret)) return fail('Unauthorized', 401);
  const reopened = await reopenExpiredPauses().catch(() => []);
  // Clover retries + the webhook inbox (an interrupted or failed webhook is processed again), then the Watchtower.
  const recovery = await runOrderRecovery({ trigger: 'cron', force: true }).catch(() => null);
  const report = await runWatch({ trigger: 'cron' });
  // Expansion features (courier auto-dispatch, Clover delivery orders, stale calls) — only those switched on.
  const expansion = await tickExpansion();
  // Website orders taken by Clover Online Ordering → kitchen screen (Clover stays the source of truth).
  const websiteOrders = await tickCloverWebsiteOrders();
  return ok({ report, reopened: reopened.length, recovery, expansion, websiteOrders });
});
