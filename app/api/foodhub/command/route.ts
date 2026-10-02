import { withPerm } from '@/lib/foodhub/auth';
import { buildCommandCenter } from '@/lib/foodhub/command';
import { ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// One call = the whole Command Center screen. Reads stored data only (no platform calls).
// Store operators only see their own locations.
export const GET = withPerm('view', async (_req, _ctx, actor) => ok({ ...(await buildCommandCenter({ locationCodes: actor.locations })) }));
