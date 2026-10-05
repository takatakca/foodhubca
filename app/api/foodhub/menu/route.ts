import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import type { MasterMenu } from '@/lib/foodhub/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

function emptyMenu(brandName: string): MasterMenu {
  return { brandName, categories: [], items: [], modifierGroups: [], updatedAt: new Date().toISOString() };
}

// ---- Editor payload: an explicit allow-list (zod strips unknown keys). 86 state is never taken from the editor. ----
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const ref = z.string().trim().min(1).max(120);
const name = z.string().trim().min(1).max(200);
const text = (max: number) => z.string().max(max).optional();
const price = z.number().finite().min(0);
const slot = z.object({ open: z.string().regex(TIME, 'HH:MM'), close: z.string().regex(TIME, 'HH:MM') });
const day = z.array(slot).max(10).default([]);
const week = z.object({ monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day });
const marketplace = z.enum(['uber_eats', 'doordash', 'skip', 'tgtg', 'other']);
const categorySchema = z.object({ ref, name, nameFr: text(200), sortOrder: z.number().int().min(0).max(100_000).default(0), hours: week.nullable().optional() });
const modifierSchema = z.object({ ref, name, nameFr: text(200), price, available: z.boolean().default(true), posModifierRef: text(120) });
const groupSchema = z.object({ ref, name, nameFr: text(200), min: z.number().int().min(0).max(100).default(0), max: z.number().int().min(0).max(100).default(1), modifiers: z.array(modifierSchema).max(200) });
const itemSchema = z.object({
  ref, name, description: text(2000), nameFr: text(200), descriptionFr: text(2000),
  tags: z.array(z.string().max(40)).max(20).optional(), allergens: z.array(z.string().max(60)).max(40).optional(), calories: z.number().min(0).max(100_000).optional(),
  price, imageUrl: text(2000), categoryRef: ref, available: z.boolean().default(true), posItemRef: text(120), note: text(500),
  channelPrices: z.partialRecord(marketplace, price).optional(), modifierGroupRefs: z.array(z.string().max(120)).max(50).default([]),
});
const menuSchema = z.object({ brandName: z.string().trim().min(1).max(80), categories: z.array(categorySchema).max(200), items: z.array(itemSchema).max(2000), modifierGroups: z.array(groupSchema).max(500).default([]) });

function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}` : 'Invalid menu';
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
  if (!b.menu || typeof b.menu !== 'object') return fail('menu with brandName, categories and items is required');
  const parsed = menuSchema.safeParse(b.menu);
  if (!parsed.success) return fail(`Invalid menu — ${firstIssue(parsed.error)}`);
  const menu = parsed.data;
  // A brand must exist in Brands & locations (or already have a menu) — no menus for unknown brands.
  const current = await getRepo().getMenu(menu.brandName);
  if (!current && !(await getCatalog()).brands.some((x) => x.name === menu.brandName)) return fail(`Unknown brand "${menu.brandName}". Add it in Brands & locations first.`, 422);
  for (const [what, list] of [['item', menu.items], ['category', menu.categories], ['modifier group', menu.modifierGroups], ['option', menu.modifierGroups.flatMap((g) => g.modifiers)]] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.ref)) return fail(`Duplicate ${what} ref: ${x.ref}`);
      seen.add(x.ref);
    }
  }
  // Keep what the editor does not own: the 86 state managed on the 86 Board (the editor may hold an older copy)
  // and the stored hours/Clover merchant. Nothing else from the request body reaches the stored menu.
  const kept = current as (MasterMenu & { posMerchantId?: string }) | null;
  const saved = await getRepo().saveMenu({
    brandName: menu.brandName, categories: menu.categories, items: menu.items, modifierGroups: menu.modifierGroups,
    hours: kept?.hours, unavailableByLocation: kept?.unavailableByLocation, unavailableUntil: kept?.unavailableUntil,
    ...(kept?.posMerchantId ? { posMerchantId: kept.posMerchantId } : {}),
    updatedAt: new Date().toISOString(),
  } as MasterMenu);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'menu_saved', status: 'success', brandName: menu.brandName, summary: `Menu saved for ${menu.brandName} (${menu.items.length} items, ${menu.categories.length} categories)` });
  return ok({ menu: saved });
});
