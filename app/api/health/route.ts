import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { safeEqual } from '@/lib/foodhub/config';
import { buildHealth, cachedHealth } from '@/lib/foodhub/health';
import { tenantId } from '@/lib/foodhub/tenant';

export const dynamic = 'force-dynamic';

// Health for an outside uptime monitor (UptimeRobot, cron-job.org, Better Stack…): GET https://YOUR-DOMAIN/api/health
// every 5 minutes, alert on anything but 200. Public answer: the overall status and each check's status only (no
// store, order or merchant detail). With "Authorization: Bearer <CRON_SECRET>" or a signed-in session: the details
// (ages, counts, last order per platform). 503 = an order could be missed or nobody would be alerted.
// Public only on this exact path (proxy.ts). The public answer is shared for 10 s (lib/foodhub/health.ts cachedHealth)
// so anyone hammering it cannot turn it into a load on the database; the detailed one is always fresh.
export async function GET(req: Request) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const detailed = (Boolean(process.env.CRON_SECRET) && safeEqual(bearer, process.env.CRON_SECRET!)) || Boolean(await getActor(req).catch(() => null));
  const h = await (detailed ? buildHealth() : cachedHealth()).catch((error) => {
    console.error('[foodhub] health check crashed —', error instanceof Error ? error.message : error);
    return { status: 'down' as const, at: new Date().toISOString() };
  });
  const httpStatus = h.status === 'down' ? 503 : 200;
  if (!('checks' in h)) return NextResponse.json({ ok: false, status: h.status, at: h.at }, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
  const body = detailed
    ? { ok: h.status !== 'down', ...h, tenant: tenantId() } // which merchant this instance serves (docs/ON2GO_HUB_ECOSYSTEM.md § 4)
    : { ok: h.status !== 'down', status: h.status, at: h.at, checks: Object.fromEntries(Object.entries(h.checks).map(([k, c]) => [k, c.status])) };
  return NextResponse.json(body, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
}
