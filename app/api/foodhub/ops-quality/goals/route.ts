import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { DEFAULT_OPS_GOALS, getOpsGoals, saveOpsGoals, type OpsGoals } from '@/lib/foodhub/ops-quality';

export const dynamic = 'force-dynamic';

// Operations quality goals (the owner sets them; everyone with analytics access reads them).
export const GET = withPerm('analytics:view', async () => ok({ goals: await getOpsGoals(), defaults: DEFAULT_OPS_GOALS }));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  let goals: OpsGoals;
  try { goals = await saveOpsGoals(await readJson(req), actor); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  return ok({ goals });
});
