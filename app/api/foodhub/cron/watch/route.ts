import type { NextRequest } from 'next/server';
import { safeEqual } from '@/lib/foodhub/config';
import { fail, guard, ok } from '@/lib/foodhub/http';
import { reopenExpiredPauses } from '@/lib/foodhub/ops';
import { runOrderRecovery } from '@/lib/foodhub/recovery';
import { runWatch } from '@/lib/foodhub/watch/engine';
import { tickExpansion } from '@/lib/foodhub/expansion/tick';
import { tickCloverWebsiteOrders } from '@/lib/foodhub/pos/clover-website-orders';
import { tickCloverRegister } from '@/lib/foodhub/mev/clover-register';
import { tickTgtgEmail } from '@/lib/foodhub/tgtg-email/imap';
import { tickAvailability } from '@/lib/foodhub/store-availability/tick';
import { tickSuite } from '@/lib/foodhub/suite/bus';

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
  // Sales rung up on the Clover register → Takatak MEV invoices (FOODHUB_MEV_CLOVER_REGISTER=on only; catch-up poll).
  const registerSales = await tickCloverRegister();
  // Too Good To Go order e-mails (IMAP mailbox) → kitchen + Clover. Only when a mailbox is configured and switched on.
  const tgtgEmails = await tickTgtgEmail();
  // Store availability center: busy schedule + tablet-off guard (throttled, never throws).
  const availability = await tickAvailability();
  // TAKATAK Suite apps: order changes → signed events (off until an app is connected, never throws).
  const suite = await tickSuite();
  return ok({ report, reopened: reopened.length, recovery, expansion, websiteOrders, registerSales, tgtgEmails, availability, suite });
});
