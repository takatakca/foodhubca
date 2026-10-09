// Clover → Food Hub master menu. Clover is the master menu: names, prices, categories, option groups (with their
// minimum, maximum and "required"), and — when the owner picks one of the merchant's Clover menus (e.g. the
// "DoorDash (Po Poulet +20%)" menu) — which items are sold on delivery and at what price on the platforms.
//
//  - Inventory: GET /v3/merchants/{mId}/items?expand=categories,modifierGroups and /modifier_groups?expand=modifiers.
//    Hidden items, and items filed only in "ARCHIVE · …" categories, are left out (they are the old catalogue).
//  - Clover menus: GET /v3/merchants/{mId}/menus and /menus/{menuId}/items. Clover does not publish a reference for
//    these endpoints, so every field is read defensively (item id, price, photo, description under the names seen so
//    far); when the merchant's token cannot read them, the import says so and uses the inventory alone.
//  - Platform prices: the chosen menu's prices become the platform prices. When most of them are the in-store price
//    plus one percentage (DoorDash menu = Clover × 1.20), Food Hub keeps the in-store price and a +20 % markup, with a
//    per-item price only where the menu differs — so a Clover price change flows to the platforms by itself.
import { fromCents } from '../config';
import { cloverFetch } from '../pos/clover-http';
import type { Marketplace, MasterMenu, MenuCategory, MenuItem, MenuModifierGroup } from '../types';
import { withMarkup } from './translate';

export interface CloverMenuSummary { id: string; name: string; type?: string; channel?: string; status?: string; items?: number }
export interface CloverMenuItem { itemId: string; priceCents?: number; name?: string; description?: string; imageUrl?: string; categoryId?: string; categoryName?: string; sortOrder?: number }

const ARCHIVE = /^\s*archive\b/i;
const CLOVER_STATIC = 'https://cloverstatic.com/menu-assets/items/';

async function get(base: string, mid: string, token: string, path: string, qs: Record<string, string> = {}): Promise<any> {
  const q = new URLSearchParams(qs);
  const res = await cloverFetch(`${base}/v3/merchants/${encodeURIComponent(mid)}/${path}${q.toString() ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`Clover ${path.split('?')[0]} HTTP ${res.status}`), { status: res.status });
  return res.json();
}

async function getAll(base: string, mid: string, token: string, path: string, qs: Record<string, string> = {}): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const json = await get(base, mid, token, path, { ...qs, limit: '1000', offset: String(offset) });
    const rows: any[] = Array.isArray(json?.elements) ? json.elements : Array.isArray(json) ? json : [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** The merchant's Clover menus (Default POS Menu, Online menu, "DoorDash (Po Poulet +20%)"…). */
export async function listCloverMenus(base: string, mid: string, token: string): Promise<{ ok: boolean; menus: CloverMenuSummary[]; error?: string }> {
  try {
    const rows = await getAll(base, mid, token, 'menus');
    const menus = rows.filter((m) => m?.id).map((m): CloverMenuSummary => ({
      id: String(m.id), name: String(m.name ?? m.label ?? m.id),
      ...(m.type ?? m.menuType ? { type: String(m.type ?? m.menuType) } : {}),
      ...(m.channel ?? m.channels?.elements?.[0]?.name ?? m.orderingChannel ? { channel: String(m.channel ?? m.channels?.elements?.[0]?.name ?? m.orderingChannel) } : {}),
      ...(m.status ?? m.state ? { status: String(m.status ?? m.state).toLowerCase() } : m.published !== undefined ? { status: m.published ? 'published' : 'draft' } : {}),
      ...(Number.isFinite(Number(m.itemCount ?? m.items?.elements?.length)) ? { items: Number(m.itemCount ?? m.items?.elements?.length) } : {}),
    }));
    return { ok: true, menus };
  } catch (error) {
    return { ok: false, menus: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads one Clover menu item row whatever its shape (inventory item reference, menu price, photo, category). */
export function parseCloverMenuItem(e: any): CloverMenuItem | null {
  const itemId = e?.item?.id ?? e?.itemId ?? e?.inventoryItemId ?? e?.item_id ?? e?.itemRef?.id ?? e?.id;
  if (!itemId) return null;
  const rawPrice = e?.price ?? e?.menuPrice ?? e?.priceOverride ?? e?.overridePrice ?? e?.menu_price;
  const priceCents = rawPrice === undefined || rawPrice === null || rawPrice === '' ? undefined : Number(rawPrice);
  const img = e?.imageUrl ?? e?.image_url ?? e?.image?.url ?? e?.image_filename ?? e?.imageFilename;
  const imageUrl = typeof img === 'string' && img.trim() ? (/^https?:\/\//.test(img) ? img : `${CLOVER_STATIC}${img.replace(/^\/+/, '')}`) : undefined;
  const cat = e?.category ?? e?.categories?.elements?.[0] ?? e?.menuCategory;
  return {
    itemId: String(itemId),
    ...(Number.isFinite(priceCents) ? { priceCents } : {}),
    ...(e?.name ?? e?.item?.name ? { name: String(e.name ?? e.item.name) } : {}),
    ...(typeof e?.description === 'string' && e.description.trim() ? { description: e.description.trim() } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(cat?.id ? { categoryId: String(cat.id), categoryName: cat.name ? String(cat.name) : undefined } : {}),
    ...(Number.isFinite(Number(e?.sortOrder)) ? { sortOrder: Number(e.sortOrder) } : {}),
  };
}

export async function cloverMenuItems(base: string, mid: string, token: string, menuId: string): Promise<CloverMenuItem[]> {
  const id = encodeURIComponent(menuId);
  // Two spellings have been seen for the same list; the second is tried only when the first does not exist.
  const rows = await getAll(base, mid, token, `menus/${id}/items`, { expand: 'item,category' })
    .catch((e) => ((e as { status?: number }).status === 404 ? getAll(base, mid, token, `menus/${id}/menu_items`, { expand: 'item,category' }) : Promise.reject(e)));
  return rows.map(parseCloverMenuItem).filter((x): x is CloverMenuItem => Boolean(x));
}

export interface PlatformPriceResult { markupPct: number | null; overrides: number; items: number }
export interface CloverImportReport {
  items: number;
  categories: number;
  modifierGroups: number;
  requiredGroups: number;
  skipped: { hidden: number; archived: number; notInMenu: number; variablePrice: number };
  menu?: { id: string; name: string; items: number; missingFromInventory: number };
  platformPrices?: Partial<Record<Marketplace, PlatformPriceResult>>;
}

/**
 * The percentage most menu prices add to the in-store price (e.g. 20 for Clover × 1.20), when at least 70 % of the
 * priced items (and at least 3) agree to the cent; otherwise null (each item then keeps its own platform price).
 * The items that disagree keep their own price, so nothing on the platform changes either way.
 */
export function detectMarkupPct(pairs: Array<{ base: number; platform: number }>): number | null {
  const priced = pairs.filter((p) => p.base > 0 && p.platform > 0);
  if (priced.length < 3) return null;
  const counts = new Map<number, number>();
  for (const p of priced) {
    const pct = Math.round(((p.platform / p.base) - 1) * 1000) / 10; // to 0.1 %
    if (pct <= -50 || pct > 200) continue;
    counts.set(pct, (counts.get(pct) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const pct = best[0];
  // Confirm with Food Hub's own rounding (base × (1 + pct) to the cent).
  const agree = priced.filter((p) => Math.abs(withMarkup(p.base, pct) - p.platform) < 0.005).length;
  return agree >= 3 && agree / priced.length >= 0.7 ? pct : null;
}

export interface BuildOptions {
  /** Items of one Clover menu: only these are imported, with the menu's photos, descriptions and prices. */
  menuItems?: CloverMenuItem[];
  menuInfo?: { id: string; name: string };
  /** Platforms that get the chosen menu's prices (e.g. ["doordash", "uber_eats"]). */
  platformPrices?: Marketplace[];
  includeArchived?: boolean;
}

/** Builds the master menu from raw Clover inventory rows (pure: the route fetches, this decides). */
export function buildMenuFromClover(brandName: string, items: any[], groups: any[], opts: BuildOptions = {}): { menu: MasterMenu; report: CloverImportReport } {
  const skipped = { hidden: 0, archived: 0, notInMenu: 0, variablePrice: 0 };
  const inMenu = opts.menuItems ? new Map(opts.menuItems.map((m) => [m.itemId, m])) : null;
  const categories = new Map<string, MenuCategory>();
  const uncategorized: MenuCategory = { ref: 'uncategorized', name: 'Other', sortOrder: 999 };
  const platformPairs: Array<{ ref: string; base: number; platform: number }> = [];

  const menuItems: MenuItem[] = [];
  for (const it of items) {
    if (!it?.id || !it.name) continue;
    if (it.hidden) { skipped.hidden++; continue; }
    const cats: any[] = (it.categories?.elements ?? []).filter((c: any) => c?.id);
    const live = cats.filter((c) => !ARCHIVE.test(String(c.name ?? '')));
    if (!opts.includeArchived && cats.length && !live.length) { skipped.archived++; continue; }
    const m = inMenu?.get(String(it.id));
    if (inMenu && !m) { skipped.notInMenu++; continue; }
    const cat = (opts.includeArchived ? cats : live)[0] ?? (m?.categoryId ? { id: m.categoryId, name: m.categoryName, sortOrder: m.sortOrder } : undefined);
    if (cat?.id && !categories.has(String(cat.id))) categories.set(String(cat.id), { ref: String(cat.id), name: String(cat.name || 'Category'), sortOrder: Number(cat.sortOrder ?? categories.size) });
    // VARIABLE / PER_UNIT items have no fixed price in Clover: never publish them as $0 — import them unavailable with a note.
    const fixedPrice = !it.priceType || String(it.priceType).toUpperCase() === 'FIXED';
    if (!fixedPrice) skipped.variablePrice++;
    const base = fixedPrice ? fromCents(it.price) : 0;
    const name = String(it.onlineName || it.name).trim();
    const description = m?.description ?? (typeof it.description === 'string' && it.description.trim() ? it.description.trim() : undefined) ?? (it.alternateName || undefined);
    const item: MenuItem = {
      ref: String(it.id),
      posItemRef: String(it.id),
      name,
      ...(description ? { description } : {}),
      price: base,
      ...(fixedPrice ? {} : { note: `Clover price type ${String(it.priceType).toUpperCase()} (no fixed price) — set a price in Food Hub before making it available.` }),
      ...(m?.imageUrl ? { imageUrl: m.imageUrl } : {}),
      categoryRef: cat?.id ? String(cat.id) : uncategorized.ref,
      available: fixedPrice && it.available !== false,
      modifierGroupRefs: (it.modifierGroups?.elements ?? []).map((g: any) => String(g.id)),
    };
    if (m?.priceCents !== undefined && fixedPrice) platformPairs.push({ ref: item.ref, base, platform: fromCents(m.priceCents) });
    menuItems.push(item);
  }
  if (menuItems.some((i) => i.categoryRef === uncategorized.ref)) categories.set(uncategorized.ref, uncategorized);

  const used = new Set(menuItems.flatMap((i) => i.modifierGroupRefs));
  const modifierGroups: MenuModifierGroup[] = groups.filter((g) => used.has(String(g.id))).map((g) => {
    const mods = (g.modifiers?.elements ?? []).filter((m: any) => m?.id);
    const min = Math.max(0, Number(g.minRequired ?? 0) || 0);
    // Clover: no maximum (null / 0) = any number of the options.
    const maxRaw = Number(g.maxAllowed ?? 0) || 0;
    const max = maxRaw > 0 ? maxRaw : Math.max(mods.length, 1);
    return {
      ref: String(g.id),
      name: String(g.name || 'Options'),
      min: Math.min(min, max),
      max,
      modifiers: mods.map((m: any) => ({ ref: String(m.id), posModifierRef: String(m.id), name: String(m.name), price: fromCents(m.price), available: m.available !== false })),
    };
  });
  // Items only point at groups that exist (a group Clover did not return would block the publish).
  const groupRefs = new Set(modifierGroups.map((g) => g.ref));
  for (const i of menuItems) i.modifierGroupRefs = i.modifierGroupRefs.filter((r) => groupRefs.has(r));

  // Platform prices from the chosen Clover menu: a markup when the prices agree, per-item prices otherwise / where they differ.
  const report: CloverImportReport = {
    items: menuItems.length, categories: categories.size, modifierGroups: modifierGroups.length, requiredGroups: modifierGroups.filter((g) => g.min > 0).length, skipped,
    ...(opts.menuInfo ? { menu: { ...opts.menuInfo, items: opts.menuItems?.length ?? 0, missingFromInventory: (opts.menuItems ?? []).filter((m) => !items.some((it) => String(it?.id) === m.itemId)).length } } : {}),
  };
  const channelMarkupPct: Partial<Record<Marketplace, number>> = {};
  if (platformPairs.length && opts.platformPrices?.length) {
    const pct = detectMarkupPct(platformPairs);
    report.platformPrices = {};
    for (const mk of opts.platformPrices) {
      let overrides = 0;
      if (pct !== null) channelMarkupPct[mk] = pct;
      for (const p of platformPairs) {
        const viaMarkup = pct !== null ? withMarkup(p.base, pct) : p.base;
        if (Math.abs(viaMarkup - p.platform) < 0.005) continue;
        const item = menuItems.find((i) => i.ref === p.ref)!;
        item.channelPrices = { ...(item.channelPrices ?? {}), [mk]: p.platform };
        overrides++;
      }
      report.platformPrices[mk] = { markupPct: pct, overrides, items: platformPairs.length };
    }
  }

  return {
    menu: {
      brandName,
      categories: [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder),
      items: menuItems,
      modifierGroups,
      ...(Object.keys(channelMarkupPct).length ? { channelMarkupPct } : {}),
      updatedAt: new Date().toISOString(),
    },
    report,
  };
}

/** Which platform a Clover menu is for, from its name or channel ("DoorDash (Po Poulet +20%)" → doordash). */
export function platformOfCloverMenu(m: Pick<CloverMenuSummary, 'name' | 'channel'>): Marketplace | null {
  const s = `${m.name} ${m.channel ?? ''}`;
  if (/door\s*dash/i.test(s)) return 'doordash';
  if (/uber/i.test(s)) return 'uber_eats';
  if (/skip/i.test(s)) return 'skip';
  return null;
}
