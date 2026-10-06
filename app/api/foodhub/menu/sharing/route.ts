import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getMenuSharing, saveMenuSharing, type MenuSharing } from '@/lib/foodhub/menu/shared';
import { applySharingChange } from '@/lib/foodhub/menu/sharing-change';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// One menu for several brands: { sharing: { followerBrand: sourceBrand } }.
export const GET = withPerm('view', async () => ok({ sharing: await getMenuSharing() }));

// Replaces the whole map. Brands must be known (Brands & locations, or an existing menu); the source needs a saved menu.
export const PUT = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const raw = b.sharing && typeof b.sharing === 'object' && !Array.isArray(b.sharing) ? (b.sharing as Record<string, unknown>) : null;
  if (!raw) return fail('sharing ({ brand: sourceBrand }) is required');
  const menus = await getRepo().listMenus();
  const known = new Set([...(await getCatalog()).brands.map((x) => x.name), ...menus.map((m) => m.brandName)]);
  const next: MenuSharing = {};
  for (const [brand, source] of Object.entries(raw)) {
    const from = String(source ?? '').trim();
    if (!from || from === brand) continue;
    if (!known.has(brand)) return fail(`Unknown brand "${brand}". Add it in Brands & locations first.`, 422);
    if (!known.has(from)) return fail(`Unknown brand "${from}". Add it in Brands & locations first.`, 422);
    if (!menus.some((m) => m.brandName === from)) return fail(`${from} has no saved menu yet — import it from Clover or create it before other brands share it.`, 409);
    next[brand] = from;
  }
  const before = await getMenuSharing();
  let saved: MenuSharing;
  try { saved = await saveMenuSharing(next); } catch (e) { return fail(e instanceof Error ? e.message : String(e), 422); }
  const changed = [...new Set([...Object.keys(before), ...Object.keys(saved)])].filter((k) => before[k] !== saved[k]);
  const outcome = await applySharingChange(before, saved);
  if (changed.length) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'menu_sharing', status: 'success',
      summary: `Shared menus changed: ${changed.map((k) => (saved[k] ? `${k} uses the ${saved[k]} menu` : `${k} uses its own menu`)).join(', ')} — publish ${changed.join(', ')} to send it to the platforms`,
      detail: { before, after: saved, ...outcome } });
  }
  // publish = brands whose platforms still show their previous menu until they are published.
  return ok({ sharing: saved, publish: changed, ...outcome });
});
