import { pushPrepTimeToUber } from '@/lib/foodhub/adapters/uber-api';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getPrepSettings, savePrep } from '@/lib/foodhub/prep';

export const dynamic = 'force-dynamic';

export const GET = withPerm('view', async () => ok({ prep: await getPrepSettings() }));

// Busy mode on/off, or change normal/busy prep minutes, for one location. The prep time now in force also goes to the
// location's Uber Eats stores (Store API "Update Prep Time"; only where Food Hub takes the orders, only when live).
export const POST = withPerm('stores:toggle', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const loc = String(b.locationCode || '');
  if (!loc) return fail('locationCode is required');
  if (!inScope(actor, loc)) return fail('Not one of your locations.', 403);
  const gate = await approvalGate(req, actor, 'store.busy', loc);
  if (gate) return gate;
  const prep = await savePrep(loc, {
    ...(b.isBusy !== undefined ? { isBusy: Boolean(b.isBusy) } : {}),
    ...(b.normal !== undefined ? { normal: Number(b.normal) } : {}),
    ...(b.busy !== undefined ? { busy: Number(b.busy) } : {}),
  }, actor);
  const uber = await pushPrepTimeToUber(loc, prep.isBusy ? prep.busy : prep.normal, actor).catch(() => []);
  return ok({ prep, uber: uber.map((u) => ({ storeId: u.storeId, ok: u.result.ok, message: u.result.message })) });
});
