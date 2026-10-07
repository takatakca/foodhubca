import { NextResponse } from 'next/server';
import { getActor } from '@/lib/foodhub/auth';
import { safeEqual } from '@/lib/foodhub/config';
import { buildHealth } from '@/lib/foodhub/health';

export const dynamic = 'force-dynamic';

// Health for an outside uptime monitor (UptimeRobot, cron-job.org, Better Stack…): GET https://YOUR-DOMAIN/api/health
// every 5 minutes, alert on anything but 200. Public answer: the overall status and each check's status only (no
// store, order or merchant detail). With "Authorization: Bearer <CRON_SECRET>" or a signed-in session: the details
// (ages, counts, last order per platform). 503 = an order could be missed or nobody would be alerted.
export async function GET(req: Request) {
  const h = await buildHealth().catch((error) => ({ status: 'down' as const, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  const httpStatus = h.status === 'down' ? 503 : 200;
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const detailed = (Boolean(process.env.CRON_SECRET) && safeEqual(bearer, process.env.CRON_SECRET!)) || Boolean(await getActor(req).catch(() => null));
  if (!('checks' in h)) return NextResponse.json({ ok: false, status: h.status, at: h.at }, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
  const body = detailed
    ? { ok: h.status !== 'down', ...h }
    : { ok: h.status !== 'down', status: h.status, at: h.at, checks: Object.fromEntries(Object.entries(h.checks).map(([k, c]) => [k, c.status])) };
  return NextResponse.json(body, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
}
