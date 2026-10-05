import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import type { MasterMenu } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

function emptyMenu(brandName: string): MasterMenu {
  return { brandName, categories: [], items: [], modifierGroups: [], updatedAt: new Date().toISOString() };
}

export const GET = withPerm('view', async (req) => {
  const repo = getRepo();
  const brand = new URL(req.url).searchParams.get('brand');
  if (brand) return ok({ menu: (await repo.getMenu(brand)) ?? emptyMenu(brand) });
  const menus = await repo.listMenus();
  const catalog = await getCatalog();
  const brands = [...new Set([...catalog.brands.filter((b) => b.active).map((b) => b.name), ...menus.map((m) => m.brandName)])];
  return ok({ brands, summary: menus.map((m) => ({ brandName: m.brandName, items: m.items.length, updatedAt: m.updatedAt })) });
});

// Save the full master menu for a brand.
export const PUT = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const menu = b.menu as MasterMenu | undefined;
  if (!menu?.brandName || !Array.isArray(menu.items) || !Array.isArray(menu.categories)) return fail('menu with brandName, categories and items is required');
  const refs = new Set<string>();
  for (const item of menu.items) {
    if (!item.ref || !item.name) return fail('Every item needs a ref and a name');
    if (refs.has(item.ref)) return fail(`Duplicate item ref: ${item.ref}`);
    refs.add(item.ref);
    if (!(Number(item.price) >= 0)) return fail(`Invalid price for ${item.name}`);
  }
  for (const [k, v] of Object.entries(menu.channelMarkupPct ?? {})) {
    if (!['uber_eats', 'doordash', 'skip'].includes(k) || !Number.isFinite(Number(v)) || Number(v) < -50 || Number(v) > 200) return fail(`Invalid markup for ${k}: use a percentage between -50 and 200.`);
  }
  // Keep the 86 state managed on the 86 Board (the editor may hold an older copy).
  const current = await getRepo().getMenu(menu.brandName);
  const priceOf = (i: { price: number; channelPrices?: Record<string, number | undefined> }) => JSON.stringify([Number(i.price), i.channelPrices ?? {}]);
  const before = new Map((current?.items ?? []).map((i) => [i.ref, priceOf(i)]));
  const repriced = menu.items.filter((i) => before.has(i.ref) && before.get(i.ref) !== priceOf(i));
  const modPrice = new Map((current?.modifierGroups ?? []).flatMap((g) => g.modifiers.map((m) => [m.ref, Number(m.price)] as [string, number])));
  const modRepriced = (menu.modifierGroups ?? []).flatMap((g) => g.modifiers).filter((m) => modPrice.has(m.ref) && modPrice.get(m.ref) !== Number(m.price));
  const markupChanged = JSON.stringify(current?.channelMarkupPct ?? {}) !== JSON.stringify(menu.channelMarkupPct ?? {});
  if (repriced.length || modRepriced.length || (current && markupChanged)) {
    const what = [...repriced, ...modRepriced].slice(0, 3).map((i) => i.name);
    if (markupChanged) what.unshift(`markup ${Object.entries(menu.channelMarkupPct ?? {}).map(([k, v]) => `${k} +${v}%`).join(', ') || 'removed'}`);
    const gate = await approvalGate(req, actor, 'menu.price', null, `${menu.brandName}: ${what.join(', ')}`);
    if (gate) return gate;
  }
  const saved = await getRepo().saveMenu({ ...menu, modifierGroups: menu.modifierGroups ?? [], unavailableByLocation: current?.unavailableByLocation ?? menu.unavailableByLocation, unavailableUntil: current?.unavailableUntil ?? menu.unavailableUntil });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'menu_saved', status: 'success', brandName: menu.brandName, summary: `Menu saved for ${menu.brandName} (${menu.items.length} items, ${menu.categories.length} categories)` });
  return ok({ menu: saved });
});
