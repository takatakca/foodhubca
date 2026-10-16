// One menu for several brands (the UrbanPiper Menu Aggregator way): a brand can follow another brand's master menu.
// The followed brand ("source") is the only menu that is edited, imported from Clover, 86'd and price-checked;
// every brand that follows it publishes that same menu under its own name, hours and stores.
// A follower's own stored menu is never deleted: it simply is not used while the brand follows another one,
// and comes back if the brand stops sharing.
// Stored in fh_kv: { followerBrand: sourceBrand }.
//
// Per-brand dishes (fh_kv menu_brand_dishes_v1: { followerBrand: [itemRef, …] }): a follower can show only ITS dishes
// of the source menu (each brick-and-mortar brand sells its own 10–12 dishes of the one master menu imported from
// Clover). The list holds item refs (the Clover item id after an import), so a fresh Clover import of the source menu
// refreshes every brand's dishes — names, prices, photos — without touching the lists. Option groups used by a kept
// dish come along (Duo / Trio / Combo upsells included); categories with no kept dish are left out.
// No list (or an empty one) = every dish of the source menu, as before.
import { getRepo } from '../repo';
import type { MasterMenu } from '../types';

const KEY = 'menu_sharing_v1';
const DISHES_KEY = 'menu_brand_dishes_v1';

/** follower brand → source brand. */
export type MenuSharing = Record<string, string>;

/** Drops self-links and chains (a source never follows another brand), so a brand resolves in one step. */
export function cleanSharing(raw: unknown): MenuSharing {
  const entries = Object.entries(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {})
    .map(([k, v]) => [k.trim(), String(v ?? '').trim()] as const)
    .filter(([k, v]) => k && v && k !== v);
  const followers = new Set(entries.map(([k]) => k));
  return Object.fromEntries(entries.filter(([, v]) => !followers.has(v)));
}

/**
 * The sharing map. A read error is NOT turned into "no sharing" (fail closed): treating followers as independent for
 * one run would publish their old menus or let a stale timer on an unused menu undo a live 86 on the shared one.
 */
export async function getMenuSharing(): Promise<MenuSharing> {
  return cleanSharing(await getRepo().getKv<MenuSharing>(KEY));
}

/**
 * Saves the sharing map. Refuses a chain (a brand that others follow cannot itself follow another brand) instead of
 * silently dropping links, so the owner sees why.
 */
export async function saveMenuSharing(next: MenuSharing): Promise<MenuSharing> {
  const entries = Object.entries(next ?? {}).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()] as const).filter(([k, v]) => k && v && k !== v);
  const followers = new Set(entries.map(([k]) => k));
  const chained = entries.find(([, v]) => followers.has(v));
  if (chained) throw new Error(`${chained[1]} follows another brand's menu, so ${chained[0]} cannot follow ${chained[1]}. Point ${chained[0]} at the brand whose menu is edited.`);
  const clean = Object.fromEntries(entries);
  await getRepo().setKv(KEY, clean);
  return clean;
}

/** The brand whose stored menu this brand uses (itself when it does not share). */
export function sourceOf(sharing: MenuSharing, brandName: string): string {
  return sharing[brandName] ?? brandName;
}

/** Every brand using the same menu as this one: the source first, then its followers (alphabetical). */
export function groupOf(sharing: MenuSharing, brandName: string): string[] {
  const source = sourceOf(sharing, brandName);
  const followers = Object.entries(sharing).filter(([, v]) => v === source).map(([k]) => k).sort((a, b) => a.localeCompare(b, 'fr'));
  return [source, ...followers];
}

/** True when this brand's stored menu is not the one in use (it follows another brand). */
export function isFollower(sharing: MenuSharing, brandName: string): boolean {
  return sourceOf(sharing, brandName) !== brandName;
}

export async function menuSourceFor(brandName: string): Promise<string> {
  return sourceOf(await getMenuSharing(), brandName);
}

export async function menuGroupFor(brandName: string): Promise<string[]> {
  return groupOf(await getMenuSharing(), brandName);
}

/** follower brand → item refs of the source menu it shows. */
export type BrandDishes = Record<string, string[]>;

/** Unique, trimmed refs per brand; brands with no ref are dropped (= every dish). */
export function cleanBrandDishes(raw: unknown): BrandDishes {
  const out: BrandDishes = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {})) {
    const brand = k.trim();
    const refs = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean))];
    if (brand && refs.length) out[brand] = refs;
  }
  return out;
}

/** The per-brand dish lists. Like the sharing map, a read error is not turned into "every dish" (fail closed). */
export async function getBrandDishes(): Promise<BrandDishes> {
  return cleanBrandDishes(await getRepo().getKv<BrandDishes>(DISHES_KEY));
}

export async function saveBrandDishes(next: BrandDishes): Promise<BrandDishes> {
  const clean = cleanBrandDishes(next);
  await getRepo().setKv(DISHES_KEY, clean);
  return clean;
}

/** The dish list that applies to this brand: only a follower's own list counts (null = every dish). */
export function dishesOf(sharing: MenuSharing, dishes: BrandDishes, brandName: string): string[] | null {
  if (!isFollower(sharing, brandName)) return null;
  const refs = dishes[brandName];
  return refs?.length ? refs : null;
}

export interface DishScope { itemRefs: Set<string>; modifierRefs: Set<string>; groupRefs: Set<string>; missing: string[] }

/** What a dish list keeps of a menu: its item refs, the groups those items use and their options, the refs not found. */
export function dishScope(menu: Pick<MasterMenu, 'items' | 'modifierGroups'>, refs: string[]): DishScope {
  const wanted = new Set(refs);
  const kept = menu.items.filter((i) => wanted.has(i.ref) || (i.posItemRef !== undefined && wanted.has(i.posItemRef)));
  const groupRefs = new Set(kept.flatMap((i) => i.modifierGroupRefs ?? []));
  const modifierRefs = new Set(menu.modifierGroups.filter((g) => groupRefs.has(g.ref)).flatMap((g) => g.modifiers.map((m) => m.ref)));
  const found = new Set(kept.flatMap((i) => [i.ref, ...(i.posItemRef ? [i.posItemRef] : [])]));
  return { itemRefs: new Set(kept.map((i) => i.ref)), modifierRefs, groupRefs, missing: refs.filter((r) => !found.has(r)) };
}

/**
 * The part of a menu a dish list shows (pure): the listed dishes (by ref or Clover id), the option groups they use, the
 * categories that still hold a dish, and the 86 state of what is kept. `sharedDishes` says the menu was narrowed.
 */
export function filterMenuToDishes(menu: MasterMenu, refs: string[], from = menu.brandName): MasterMenu {
  const scope = dishScope(menu, refs);
  const items = menu.items.filter((i) => scope.itemRefs.has(i.ref));
  const cats = new Set(items.map((i) => i.categoryRef));
  const keep = (r: string) => scope.itemRefs.has(r) || scope.modifierRefs.has(r);
  const byLoc = Object.fromEntries(Object.entries(menu.unavailableByLocation ?? {}).map(([loc, list]) => [loc, list.filter(keep)]));
  const until = Object.fromEntries(Object.entries(menu.unavailableUntil ?? {}).filter(([k]) => keep(k.split('|').slice(1).join('|'))));
  return {
    ...menu,
    items,
    categories: menu.categories.filter((c) => cats.has(c.ref)),
    modifierGroups: menu.modifierGroups.filter((g) => scope.groupRefs.has(g.ref)),
    ...(menu.unavailableByLocation ? { unavailableByLocation: byLoc } : {}),
    ...(menu.unavailableUntil ? { unavailableUntil: until } : {}),
    sharedDishes: { from, listed: refs.length, shown: items.length, missing: scope.missing },
  };
}

/**
 * The menu a brand uses, seen as that brand (its own name — what the platforms show). Null when none is saved.
 * A follower with its own dish list sees only those dishes. allDishes: the whole shared menu (an order line is matched
 * to its Clover id whatever the brand shows today).
 */
export async function getBrandMenu(brandName: string, sharing?: MenuSharing, opts: { allDishes?: boolean; dishes?: BrandDishes } = {}): Promise<MasterMenu | null> {
  const map = sharing ?? (await getMenuSharing());
  const source = sourceOf(map, brandName);
  const menu = await getRepo().getMenu(source);
  if (!menu) return null;
  if (source === brandName) return menu;
  const seen = { ...menu, brandName };
  if (opts.allDishes) return seen;
  const refs = dishesOf(map, opts.dishes ?? (await getBrandDishes()), brandName);
  return refs ? filterMenuToDishes(seen, refs, source) : seen;
}

/** The stored menus that are in use (a follower's own, unused menu is left out — it must not drive 86s or syncs). */
export async function activeMenus(sharing?: MenuSharing): Promise<MasterMenu[]> {
  const map = sharing ?? (await getMenuSharing());
  return (await getRepo().listMenus()).filter((m) => !isFollower(map, m.brandName));
}
