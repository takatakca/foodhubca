import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { can } from '@/lib/foodhub/session';
import { lastSyncReport, runSync } from '@/lib/foodhub/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Dashboard-triggered sync. runSync is not read-only (re-opens pauses, settles orders in Clover, runs due
// publishes/reports), so POST needs "stores:toggle"; { force: true } skips the FOODHUB_SYNC_MIN_INTERVAL_S
// rate limit (default 60 s) and is honoured for admins only. The cron route calls runSync directly.
export const POST = withPerm('stores:toggle', async (req, _ctx, actor) => {
  const body = await readJson(req);
  const res = await runSync({ trigger: body.trigger === 'auto' ? 'dashboard-auto' : 'dashboard', force: body.force === true && can(actor.role, 'admin') });
  return ok({ ran: res.ran, reason: res.reason ?? null, report: res.report });
});

export const GET = withPerm('view', async () => ok({ report: await lastSyncReport() }));
