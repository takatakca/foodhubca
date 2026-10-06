// One menu for several brands (the UrbanPiper Menu Aggregator way): a brand can follow another brand's master menu.
// The followed brand ("source") is the only menu that is edited, imported from Clover, 86'd and price-checked;
// every brand that follows it publishes that same menu under its own name, hours and stores.
// A follower's own stored menu is never deleted: it simply is not used while the brand follows another one,
// and comes back if the brand stops sharing.
// Stored in fh_kv: { followerBrand: sourceBrand }.
import { getRepo } from '../repo';
import type { MasterMenu } from '../types';

const KEY = 'menu_sharing_v1';

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

export async function getMenuSharing(): Promise<MenuSharing> {
  return cleanSharing(await getRepo().getKv<MenuSharing>(KEY).catch(() => null));
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

/** The menu a brand uses, seen as that brand (its own name — what the platforms show). Null when none is saved. */
export async function getBrandMenu(brandName: string, sharing?: MenuSharing): Promise<MasterMenu | null> {
  const source = sourceOf(sharing ?? (await getMenuSharing()), brandName);
  const menu = await getRepo().getMenu(source);
  return menu ? (source === brandName ? menu : { ...menu, brandName }) : null;
}

/** The stored menus that are in use (a follower's own, unused menu is left out — it must not drive 86s or syncs). */
export async function activeMenus(sharing?: MenuSharing): Promise<MasterMenu[]> {
  const map = sharing ?? (await getMenuSharing());
  return (await getRepo().listMenus()).filter((m) => !isFollower(map, m.brandName));
}
