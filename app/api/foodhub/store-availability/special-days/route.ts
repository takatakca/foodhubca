import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { getHours, localDate } from '@/lib/foodhub/hours';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { addSpecialDays, specialDayPresets } from '@/lib/foodhub/store-availability/special-days';

export const dynamic = 'force-dynamic';

// Special days in one tap (Halloween, Christmas Eve, Mother's Day…). ?year= (default this year).
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const raw = new URL(req.url).searchParams.get('year');
  const year = raw ? Number(raw) : Number(localDate(Date.now()).slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail('year must be between 2020 and 2100');
  const hours = await getHours();
  const presets = specialDayPresets(year).map((p) => ({
    ...p,
    // Already set for one of your kitchens (or for every kitchen)?
    existing: hours.holidays
      .filter((h) => h.date === p.date && (!h.locationCodes.length || h.locationCodes.some((c) => inScope(actor, c))))
      .map((h) => ({ id: h.id, name: h.name, closed: h.closed, slots: h.slots ?? [], locationCodes: h.locationCodes })),
  }));
  return ok({ year, presets });
});

// { ids, year, closed: true } or { ids, year, slots: [{ open, close }] }, locationCodes ([] = every kitchen).
// Saved as holidays; publish from /stores/hours ("Publier sur les plateformes") to send them to the platforms.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : [];
  const codes: string[] = Array.isArray(b.locationCodes) ? b.locationCodes.map(String).filter(Boolean) : [];
  if (actor.locations.length && (!codes.length || codes.some((c) => !inScope(actor, c)))) return fail('Choose only your own locations.', 403);
  const known = new Set((await getCatalog()).locations.map((l) => l.code));
  if (codes.some((c) => !known.has(c))) return fail('Unknown location');
  try {
    const how = b.closed === true ? { closed: true as const } : { slots: Array.isArray(b.slots) ? b.slots : [] };
    const r = await addSpecialDays(ids, Number(b.year), how, codes, actor);
    return ok({ added: r.added, skipped: r.skipped, publishAt: '/stores/hours' });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
