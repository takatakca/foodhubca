// TEST-ONLY hooks for the crash-replay check (`npm run verify:crash`, scripts/foodhub-crash-e2e.mjs,
// docs/CRASH_REPLAY_E2E.md). They let that check stop the server at an exact moment instead of hoping for a race:
//
//   FOODHUB_E2E_PROCESS_DELAY_MS  the webhook inbox waits this long after marking an entry "processing" and before
//                                 processing it, so the check kills the server mid-processing every time;
//   FOODHUB_E2E_INBOX_STUCK_MS    an entry still "received" / "processing" after this long counts as interrupted
//                                 (instead of 2 minutes), so the restarted server replays it within seconds.
//
// They are honoured ONLY when FOODHUB_E2E=1 AND the run-time NODE_ENV is "test" or "development". Anywhere else
// (production, or NODE_ENV not set) they are refused: one warning in the log, then ignored, and Food Hub behaves exactly
// as without them. The Docker image sets NODE_ENV=production, so they can never act in a deployed Food Hub.
// NODE_ENV is read at RUN time through a computed key (same reason as lib/supabase/server.ts): `next build` replaces
// every literal process.env.NODE_ENV with "production", so a literal check would be dead code in the built app the
// crash check starts (`next start` with NODE_ENV=test).

type Env = Record<string, string | undefined>;

const NODE_ENV_KEY = ['NODE', 'ENV'].join('_');
const TEST_NODE_ENVS = new Set(['test', 'development']);
const warned = new Set<string>();

/** May the test-only hooks act in this process? FOODHUB_E2E=1 and a run-time NODE_ENV of test or development. */
export function e2eHooksAllowed(env: Env = process.env as Env): boolean {
  return env.FOODHUB_E2E === '1' && TEST_NODE_ENVS.has(String(env[NODE_ENV_KEY] ?? ''));
}

/**
 * A test-only duration in milliseconds (`name` is one of the FOODHUB_E2E_* variables above), or null when it is not set,
 * not a number, below `min`, or refused because the hooks are not allowed here (warned once per variable).
 * Capped at `max`.
 */
export function e2eHookMs(name: string, opts: { min?: number; max: number }, env: Env = process.env as Env): number | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return null;
  if (!e2eHooksAllowed(env)) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[foodhub] ${name} ignored: it is a test-only hook (needs FOODHUB_E2E=1 and NODE_ENV=test or development, never production)`);
    }
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < (opts.min ?? 0)) return null;
  return Math.min(n, opts.max);
}
