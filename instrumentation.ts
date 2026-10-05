// Runs once when the server starts.
// 1. Internal secrets (webhook signing keys, cron key) missing from the environment are loaded from the database or
//    created once (lib/foodhub/runtime-secrets.ts) — hosts such as Coolify need no setup wizard.
// 2. On a long-running Node server (`next start` on a VM, Coolify, Render, Railway, Fly…) the Watchtower checks every
//    30 s even when no screen is open — so "the tablet is off" or "an order is waiting" still texts and calls the
//    managers. On serverless hosts (Vercel) this timer does not survive between requests: call /api/foodhub/cron/watch
//    every minute instead (see docs/FOODHUB.md). FOODHUB_WATCH_INTERVAL_S=0 turns the timer off.
// 3. FOODHUB_INTERNAL_SYNC_MIN=5 runs the platform sync (orders, payouts, timed pauses, due reports and scheduled
//    publishes) every 5 minutes inside the server, for hosts without a system cron. Off by default (the VPS installer
//    uses cron).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureGeneratedSecrets } = await import('./lib/foodhub/runtime-secrets');
    const r = await ensureGeneratedSecrets();
    if (r.created.length) console.log(`[foodhub] internal secrets created: ${r.created.join(', ')}`);
  } catch (e) {
    console.error('[foodhub] internal secrets not ready', e instanceof Error ? e.message : e);
  }
  if (process.env.VERCEL) return;
  const g = globalThis as unknown as { __takatakWatchTimer?: ReturnType<typeof setInterval>; __takatakSyncTimer?: ReturnType<typeof setInterval> };

  const seconds = Number(process.env.FOODHUB_WATCH_INTERVAL_S ?? 30);
  if (Number.isFinite(seconds) && seconds > 0 && !g.__takatakWatchTimer) {
    const { runWatch } = await import('./lib/foodhub/watch/engine');
    g.__takatakWatchTimer = setInterval(() => {
      runWatch({ trigger: 'timer' }).catch((e) => console.error('[foodhub] watch timer failed', e instanceof Error ? e.message : e));
    }, Math.max(15, seconds) * 1000);
    g.__takatakWatchTimer.unref?.();
  }

  const syncMin = Number(process.env.FOODHUB_INTERNAL_SYNC_MIN ?? 0);
  if (Number.isFinite(syncMin) && syncMin > 0 && !g.__takatakSyncTimer) {
    const { runSync } = await import('./lib/foodhub/sync');
    g.__takatakSyncTimer = setInterval(() => {
      runSync({ trigger: 'timer', force: true }).catch((e) => console.error('[foodhub] sync timer failed', e instanceof Error ? e.message : e));
    }, Math.max(1, syncMin) * 60_000);
    g.__takatakSyncTimer.unref?.();
  }
}
