import { logActivity } from '@/lib/foodhub/activity';
import { withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { getCatalog, saveBrand, saveLocation } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Brands and locations (seed data + anything added in Brands & Locations).
export const GET = withPerm('view', async () => ok({ ...(await getCatalog()) }));

export const POST = withPerm('admin', async (req, _ctx, actor) => {
  try {
    return await save(await readJson(req), actor);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});

async function save(b: Record<string, any>, actor: AuthUser) {
  if (b.location) {
    const l = b.location;
    const catalog = await saveLocation({ code: String(l.code || '').toUpperCase().trim(), name: String(l.name || ''), address: String(l.address || ''), city: l.city, province: l.province, postalCode: l.postalCode, phone: l.phone ? String(l.phone) : null, active: l.active !== false });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'location_saved', status: 'success', locationCode: String(l.code).toUpperCase(), summary: `Location ${String(l.code).toUpperCase()} saved (${l.name}${l.active === false ? ', deactivated' : ''})` });
    return ok({ ...catalog });
  }
  if (b.brand) {
    // Brand kit (docs/BRAND_KIT.md): accent and logo are validated in saveBrand (hex only; https or a media photo only).
    // Left out = kept as saved, so turning a brand off or on never loses its colour or logo.
    const catalog = await saveBrand({ name: String(b.brand.name || ''), active: b.brand.active !== false, accent: b.brand.accent, logo: b.brand.logo });
    const saved = catalog.brands.find((x) => x.name === String(b.brand.name || '').trim());
    const kit = [
      b.brand.accent === undefined ? null : saved?.accent ? `colour ${saved.accent}` : 'colour removed',
      b.brand.logo === undefined ? null : saved?.logo ? 'logo set' : 'logo removed',
    ].filter(Boolean);
    await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'brand_saved', status: 'success', brandName: String(b.brand.name), summary: `Brand ${b.brand.name} saved${b.brand.active === false ? ' (deactivated)' : ''}${kit.length ? ` (${kit.join(', ')})` : ''}` });
    return ok({ ...catalog });
  }
  return fail('Send { location: {...} } or { brand: {...} }');
}
