import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { buildCommandCenter } from '@/lib/foodhub/command';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

// One call = the whole overview. Reads stored data only (no platform calls).
// ?locations=A,B narrows it; people limited to some locations only ever see theirs.
// ?brands=X narrows it to brands (the console's brand scope): orders, stores and the store grid of those brands only.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const scope = scopeFilter(actor, list(q.get('locations')));
  return ok({ ...(await buildCommandCenter({ locationCodes: scope, brandNames: list(q.get('brands')) })) });
});
