import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { DEFAULT_OPS_GOALS, getOpsGoals, saveOpsGoals } from '@/lib/foodhub/ops-quality';

export const dynamic = 'force-dynamic';

// Operations quality goals (the owner sets them; everyone with analytics access reads them).
export const GET = withPerm('analytics:view', async () => ok({ goals: await getOpsGoals(), defaults: DEFAULT_OPS_GOALS }));

// A validation error (UserError) → 400 with its message; a database or network failure → generic 500 (withPerm).
export const PUT = withPerm('admin', async (req, _ctx, actor) => ok({ goals: await saveOpsGoals(await readJson(req), actor) }));
