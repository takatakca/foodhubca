import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { cleanBrandDishes, dishScope, getBrandDishes, getMenuSharing, saveBrandDishes, saveMenuSharing, type BrandDishes, type MenuSharing } from '@/lib/foodhub/menu/shared';
import { applySharingChange } from '@/lib/foodhub/menu/sharing-change';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

const MAX_DISHES = 500;

// One menu for several brands: { sharing: { followerBrand: sourceBrand }, dishes: { followerBrand: [itemRef, …] } }.
// dishes = the dishes of the shared menu a follower shows (no entry = every dish).
export const GET = withPerm('view', async () => ok({ sharing: await getMenuSharing(), dishes: await getBrandDishes() }));

// Replaces the whole sharing map. Brands must be known (Brands & locations, or an existing menu); the source needs a
// saved menu. `dishes` (optional) replaces the dish lists; without it the saved lists stay, except for a brand that
// stops sharing or moves to another menu (its list named dishes of the old menu).
export const PUT = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const raw = b.sharing && typeof b.sharing === 'object' && !Array.isArray(b.sharing) ? (b.sharing as Record<string, unknown>) : null;
  if (!raw) return fail('sharing ({ brand: sourceBrand }) is required');
  if (b.dishes !== undefined && (!b.dishes || typeof b.dishes !== 'object' || Array.isArray(b.dishes))) return fail('dishes must be { brand: [itemRef, …] }');
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
  const beforeDishes = await getBrandDishes();
  // Dish lists: only for brands that follow a menu, and each must name at least one dish of that menu.
  const wanted: BrandDishes = b.dishes !== undefined ? cleanBrandDishes(b.dishes) : Object.fromEntries(Object.entries(beforeDishes).filter(([k]) => next[k] && next[k] === before[k]));
  const dishes: BrandDishes = {};
  for (const [brand, refs] of Object.entries(wanted)) {
    const from = next[brand];
    if (!from) {
      if (b.dishes !== undefined) return fail(`${brand} does not share another brand's menu — only a brand that shares a menu picks its dishes.`, 422);
      continue;
    }
    if (refs.length > MAX_DISHES) return fail(`${brand}: at most ${MAX_DISHES} dishes.`, 422);
    const source = menus.find((m) => m.brandName === from)!;
    const scope = dishScope(source, refs);
    if (!scope.itemRefs.size) return fail(`None of the dishes picked for ${brand} is on the ${from} menu. Pick at least one, or none to show every dish.`, 422);
    dishes[brand] = refs;
  }

  let saved: MenuSharing;
  try { saved = await saveMenuSharing(next); } catch (e) { return fail(e instanceof Error ? e.message : String(e), 422); }
  const savedDishes = await saveBrandDishes(dishes);
  const same = (x?: string[], y?: string[]) => JSON.stringify([...(x ?? [])].sort()) === JSON.stringify([...(y ?? [])].sort());
  const changed = [...new Set([...Object.keys(before), ...Object.keys(saved)])].filter((k) => before[k] !== saved[k]);
  const dishesChanged = [...new Set([...Object.keys(beforeDishes), ...Object.keys(savedDishes)])].filter((k) => !changed.includes(k) && !same(beforeDishes[k], savedDishes[k]));
  const outcome = await applySharingChange(before, saved);
  if (changed.length || dishesChanged.length) {
    const parts = [
      ...changed.map((k) => (saved[k] ? `${k} uses the ${saved[k]} menu${savedDishes[k] ? ` (${savedDishes[k].length} dishes)` : ''}` : `${k} uses its own menu`)),
      ...dishesChanged.map((k) => (savedDishes[k] ? `${k} shows ${savedDishes[k].length} dishes of the ${saved[k]} menu` : `${k} shows every dish of the ${saved[k]} menu`)),
    ];
    const publish = [...changed, ...dishesChanged];
    await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'menu_sharing', status: 'success',
      summary: `Shared menus changed: ${parts.join(', ')} — publish ${publish.join(', ')} to send it to the platforms`,
      detail: { before, after: saved, dishesBefore: beforeDishes, dishesAfter: savedDishes, ...outcome } });
  }
  // publish = brands whose platforms still show their previous menu until they are published.
  return ok({ sharing: saved, dishes: savedDishes, publish: [...changed, ...dishesChanged], ...outcome });
});
