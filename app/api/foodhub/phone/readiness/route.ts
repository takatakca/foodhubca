import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { resetAiHealth } from '@/lib/foodhub/phone/ai-health';
import { phoneReadiness } from '@/lib/foodhub/phone/readiness';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Ready for test calls?" (Settings → Expansion → AI phone): every check of the two phone assistants, read-only.
// POST (owner): { probe: true } opens the pages texted to callers once; { resetAi: true } ends an AI pause now.
export const GET = withPerm('view', async () => ok({ ...(await phoneReadiness()) }));

export const POST = withPerm('admin', async (req) => {
  const b = await readJson(req);
  if (b.resetAi === true) await resetAiHealth();
  return ok({ ...(await phoneReadiness({ probe: b.probe === true })) });
});
