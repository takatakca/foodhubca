import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { setupScreens } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';

// { baseUrl, locationCode, counts: { doordash, ubereats, skip } } — numbered screens s01, s02… on the relay host, each
// opening its platform's sign-in page (docs/ORDER_SCREENS_RESCUE.md). Existing numbers are kept.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const code = String(b.locationCode || '');
  const catalog = await getCatalog();
  if (!catalog.locations.some((l) => l.code === code && l.active)) return fail('Choisissez une succursale. / Choose a location.');
  if (!inScope(actor, code)) return fail('Not one of your locations.', 403);
  const counts = b.counts && typeof b.counts === 'object' ? b.counts as Record<string, unknown> : {};
  const r = await setupScreens({ baseUrl: b.baseUrl, locationCode: code, counts: { doordash: Number(counts.doordash ?? 0), ubereats: Number(counts.ubereats ?? 0), skip: Number(counts.skip ?? 0) } }, actor);
  return 'error' in r ? fail(r.error) : ok({ created: r.created.length, kept: r.kept });
});
