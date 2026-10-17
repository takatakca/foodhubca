import { z } from 'zod';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { getHours, localDate } from '@/lib/foodhub/hours';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { errorFields } from '@/lib/foodhub/store-availability/common';
import { addSpecialDays, specialDayPresets } from '@/lib/foodhub/store-availability/special-days';

export const dynamic = 'force-dynamic';

/** Special hours as typed: 1 to 6 slots of exactly { open, close } (anything else is refused, never stored). */
const slotsSchema = z.array(z.object({ open: z.string().max(5), close: z.string().max(5) }).strict()).min(1).max(6);

// Special days in one tap (Halloween, Christmas Eve, Mother's Day…). ?year= (default this year).
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const raw = new URL(req.url).searchParams.get('year');
  const year = raw ? Number(raw) : Number(localDate(Date.now()).slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail('year must be between 2020 and 2100', 400, { errorFr: 'L’année doit être entre 2020 et 2100' });
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
  if (actor.locations.length && (!codes.length || codes.some((c) => !inScope(actor, c)))) return fail('Choose only your own locations.', 403, { errorFr: 'Choisissez seulement vos propres cuisines.' });
  const known = new Set((await getCatalog()).locations.map((l) => l.code));
  if (codes.some((c) => !known.has(c))) return fail('Unknown location', 400, { errorFr: 'Cuisine inconnue' });
  try {
    let how: { closed: true } | { slots: Array<{ open: string; close: string }> } = { closed: true };
    if (b.closed !== true) {
      const slots = slotsSchema.safeParse(b.slots);
      if (!slots.success) return fail('slots: 1 to 6 slots of { open, close } (HH:MM), or closed: true', 400, { errorFr: 'Heures spéciales : 1 à 6 créneaux (ouverture, fermeture en HH:MM), ou « Fermé »' });
      how = { slots: slots.data.map(({ open, close }) => ({ open, close })) };
    }
    const r = await addSpecialDays(ids, Number(b.year), how, codes, actor);
    return ok({ added: r.added, skipped: r.skipped, publishAt: '/stores/hours' });
  } catch (e) {
    const { error, errorFr } = errorFields(e);
    return fail(error, 400, { errorFr });
  }
});
