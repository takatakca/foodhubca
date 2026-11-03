import { withPerm } from '@/lib/foodhub/auth';
import { afterCloverPriceUsed } from '@/lib/foodhub/autopilot';
import { listCloverPriceChanges, resolveCloverPriceChange } from '@/lib/foodhub/clover-sync';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Prices changed in Clover that differ from the Food Hub menu.
export const GET = withPerm('view', async (req) => ok({ changes: await listCloverPriceChanges(new URL(req.url).searchParams.get('brand') || undefined) }));

// { brand, ref, accept: true } → use the Clover price in the master menu; accept: false → keep Food Hub price.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.brand || !b.ref) return fail('brand and ref are required');
  const accept = b.accept !== false;
  if (!(await resolveCloverPriceChange(String(b.brand), String(b.ref), accept, actor))) return fail('No pending Clover price change for that item.', 404);
  // Settings → Autopilot « Republier 10 min après un changement » (does nothing while that switch is off).
  const autopilot = accept ? await afterCloverPriceUsed(String(b.brand), actor) : [];
  return ok(autopilot.length ? { autopilot } : {});
});
