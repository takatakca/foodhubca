import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getScreen, removeScreen, requestReload, updateScreen } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// { name?, platform?, locationCode?, viewUrl? } — edit a screen.
export const PATCH = withPerm<Ctx>('stores:map', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  const b = await readJson(req);
  const code = b.locationCode ? String(b.locationCode) : undefined;
  if (code) {
    const catalog = await getCatalog();
    if (!catalog.locations.some((l) => l.code === code && l.active)) return fail('Choisissez une succursale. / Choose a location.');
    if (!inScope(actor, code)) return fail('Not one of your locations.', 403);
  }
  const r = await updateScreen(id, { name: b.name, platform: b.platform, locationCode: code, viewUrl: b.viewUrl }, actor);
  if (!r) return fail('Screen not found', 404);
  return 'error' in r ? fail(r.error) : ok({ screen: r });
});

// { action: 'reload' } — the relay agent reloads the page on its next heartbeat. Anyone on the kitchen team may ask.
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  const b = await readJson(req);
  if (b.action !== 'reload') return fail('Unknown action');
  return ok({ screen: await requestReload(id, actor) });
});

export const DELETE = withPerm<Ctx>('stores:map', async (_req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  await removeScreen(id, actor);
  return ok();
});
