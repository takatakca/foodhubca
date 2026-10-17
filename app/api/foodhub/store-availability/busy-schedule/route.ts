import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { errorFields } from '@/lib/foodhub/store-availability/common';
import { getBusySchedule, getBusyState, saveBusySchedule } from '@/lib/foodhub/store-availability/busy-schedule';

export const dynamic = 'force-dynamic';

function visible<T>(all: Record<string, T>, locations: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(all).filter(([loc]) => !locations.length || locations.includes(loc)));
}

// "Calendrier occupé": busy mode by the clock, per kitchen.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const [schedule, state] = await Promise.all([getBusySchedule(), getBusyState()]);
  return ok({ schedule: visible(schedule, actor.locations), state: visible(state, actor.locations) });
});

// Replaces one kitchen's windows: { locationCode, windows: [{ id?, days, start, end, extraMin }] }. Same approval as busy mode.
export const PUT = withPerm('stores:toggle', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const loc = String(b.locationCode || '');
  if (!loc) return fail('locationCode is required', 400, { errorFr: 'Choisissez une cuisine' });
  if (!inScope(actor, loc)) return fail('Not one of your locations.', 403, { errorFr: 'Ce n’est pas une de vos cuisines.' });
  if (!(await getCatalog()).locations.some((l) => l.code === loc)) return fail('Unknown location', 400, { errorFr: 'Cuisine inconnue' });
  if (!Array.isArray(b.windows)) return fail('windows must be a list', 400, { errorFr: 'Les plages doivent être une liste' });
  const gate = await approvalGate(req, actor, 'store.busy', loc, 'busy schedule');
  if (gate) return gate;
  try {
    const windows = await saveBusySchedule(loc, b.windows, actor);
    return ok({ locationCode: loc, windows });
  } catch (e) {
    const { error, errorFr } = errorFields(e);
    return fail(error, 400, { errorFr });
  }
});
