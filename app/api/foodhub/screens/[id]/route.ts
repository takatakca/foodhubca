import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getScreen, removeScreen, requestOpen, requestReload, updateScreen } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// { name?, platform?, locationCode?, viewUrl?, storeIds? } — edit a screen.
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
  const r = await updateScreen(id, { name: b.name, platform: b.platform, locationCode: code, viewUrl: b.viewUrl, storeIds: b.storeIds }, actor);
  if (!r) return fail('Screen not found', 404);
  return 'error' in r ? fail(r.error) : ok({ screen: r });
});

// { action: 'reload' | 'open' } — on its next heartbeat the relay agent reloads the page, or opens the platform's start
// (sign-in) page. Anyone on the kitchen team may ask.
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  const b = await readJson(req);
  if (b.action === 'reload') return ok({ screen: await requestReload(id, actor) });
  if (b.action === 'open') {
    const r = await requestOpen(id, actor);
    return !r ? fail('Screen not found', 404) : 'error' in r ? fail(r.error) : ok({ screen: r });
  }
  return fail('Unknown action');
});

export const DELETE = withPerm<Ctx>('stores:map', async (_req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  await removeScreen(id, actor);
  return ok();
});
