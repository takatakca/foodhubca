import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { buildCommandCenter } from '@/lib/foodhub/command';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// One call = the whole overview. Reads stored data only (no platform calls).
// ?locations=A,B narrows it; people limited to some locations only ever see theirs.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const wanted = (new URL(req.url).searchParams.get('locations') || '').split(',').filter(Boolean);
  const scope = scopeFilter(actor, wanted);
  return ok({ ...(await buildCommandCenter({ locationCodes: scope })) });
});
