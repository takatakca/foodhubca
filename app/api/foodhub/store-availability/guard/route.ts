import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { DEFAULT_GUARD, getGuardConfigs, getGuardState, saveGuardConfig } from '@/lib/foodhub/store-availability/downtime-guard';
import { foodhubTimeZone } from '@/lib/foodhub/time';

export const dynamic = 'force-dynamic';

// "Garde tablette éteinte": per-kitchen settings (OFF by default) and what it has paused right now.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const [catalog, configs, state] = await Promise.all([getCatalog(), getGuardConfigs(), getGuardState()]);
  const locs = catalog.locations.filter((l) => l.active && inScope(actor, l.code)).map((l) => l.code);
  return ok({
    guard: Object.fromEntries(locs.map((c) => [c, configs[c] ?? { ...DEFAULT_GUARD }])),
    state: Object.fromEntries(Object.entries(state).filter(([c]) => locs.includes(c))),
    timeZone: foodhubTimeZone(),
  });
});

// { locationCode, config: { enabled, graceMin 3–30, pauseMin 15–120, channels } }
export const PUT = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const loc = String(b.locationCode || '');
  if (!loc) return fail('locationCode is required');
  if (!inScope(actor, loc)) return fail('Not one of your locations.', 403);
  if (!(await getCatalog()).locations.some((l) => l.code === loc)) return fail('Unknown location');
  try {
    return ok({ locationCode: loc, guard: await saveGuardConfig(loc, b.config, actor) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
