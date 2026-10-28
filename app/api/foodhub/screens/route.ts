import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { addScreen, agentToken, listScreens, screenStatus } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';

// Platform screens (Uber Eats / DoorDash order screens on the relay host): list with live status, add one.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const now = Date.now();
  const screens = (await listScreens()).filter((s) => inScope(actor, s.locationCode)).map((s) => ({ ...s, status: screenStatus(s, now) }));
  return ok({ screens, agentConfigured: !!agentToken() });
});

// { name, platform, locationCode, viewUrl }
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const code = String(b.locationCode || '');
  const catalog = await getCatalog();
  if (!catalog.locations.some((l) => l.code === code && l.active)) return fail('Choisissez une succursale. / Choose a location.');
  if (!inScope(actor, code)) return fail('Not one of your locations.', 403);
  const r = await addScreen({ name: b.name, platform: b.platform, locationCode: code, viewUrl: b.viewUrl }, actor);
  return 'error' in r ? fail(r.error) : ok({ screen: r });
});
