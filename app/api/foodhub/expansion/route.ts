import { withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { FEATURE_KEYS, setFeature, type FeatureKey } from '@/lib/foodhub/expansion/features';
import { expansionSummary } from '@/lib/foodhub/expansion/summary';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Expansion features: switches, what each still needs, today's numbers (Overview tiles, Settings → Expansion).
export const GET = withPerm('view', async (_req, _ctx, actor) => ok({ ...(await expansionSummary(actor.locations)), baseUrl: publicBaseUrl() }));

// Owner only: turn a feature on or off (logged).
export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!FEATURE_KEYS.includes(b.key)) return fail('Unknown feature.');
  await setFeature(b.key as FeatureKey, b.on === true, actor);
  return ok({ ...(await expansionSummary(actor.locations)), baseUrl: publicBaseUrl() });
});
