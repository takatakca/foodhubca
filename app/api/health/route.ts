import { NextResponse } from 'next/server';
import { checkHealth } from '@/lib/foodhub/health';

export const dynamic = 'force-dynamic';

// For an outside uptime monitor (UptimeRobot, Better Stack…), every 1–5 min — docs/BACK_ONLINE_TODAY.md, Part B.
// Public, without sign-in (proxy.ts, exact path): the body says only up/down, why (fixed codes) and ages in seconds —
// no secret, store, brand, order or count (lib/foodhub/health.ts). HEAD works too (Next answers it with GET).
//   200  healthy
//   503  database unreachable, memory mode in production, the scheduled sync stopped, or the console is locked
export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  try {
    const report = await checkHealth();
    return NextResponse.json(report, { status: report.ok ? 200 : 503, headers });
  } catch (e) {
    // checkHealth does not throw; if it ever does, the reason stays in the server log, never in the public answer.
    console.error('[foodhub] health check crashed —', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
}
