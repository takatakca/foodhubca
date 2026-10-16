// What has to happen when the menu-sharing map changes, beyond saving it.
//  - A brand that STOPS sharing gets a menu of its own right away (a copy of the shared menu when it has none) carrying
//    the shared menu's 86 state and timers: its platforms still show the shared menu with those 86s until it is
//    published again, so nothing may be left switched off with no way to switch it back on.
//    A brand that showed only ITS dishes of the shared menu (dish list) gets a copy of those dishes only — never the
//    whole master menu, which its next publish would send to its platforms under a restaurant that does not sell them.
//    When its list matches nothing any more, no copy is made (noDishesLeft): import or build its menu first.
//  - A brand that STARTS sharing forgets the Clover price flags / Clover-86 marks of its own (now unused) menu.
//    The timed 86s left on its own menu still finish on its own stores (ops.reenableExpiredItems, ownMenu).
import { forgetCloverStateFor } from '../clover-sync';
import { getRepo } from '../repo';
import type { MasterMenu } from '../types';
import { filterMenuToDishes, type BrandDishes, type MenuSharing } from './shared';

export interface SharingChangeOutcome { gotOwnMenu: string[]; copiedMenu: string[]; startedSharing: string[]; noDishesLeft: string[] }

function mergeOff(own: MasterMenu, shared: MasterMenu): Pick<MasterMenu, 'unavailableByLocation' | 'unavailableUntil'> {
  const byLoc: Record<string, string[]> = { ...(own.unavailableByLocation ?? {}) };
  for (const [loc, refs] of Object.entries(shared.unavailableByLocation ?? {})) byLoc[loc] = [...new Set([...(byLoc[loc] ?? []), ...refs])];
  return { unavailableByLocation: byLoc, unavailableUntil: { ...(own.unavailableUntil ?? {}), ...(shared.unavailableUntil ?? {}) } };
}

/** The shared menu as this brand saw it: only its dishes (and their options, categories, 86s) when it had a list. */
function brandCopy(shared: MasterMenu, brand: string, dishes: string[] | undefined): MasterMenu {
  const copy = { ...shared, brandName: brand };
  if (!dishes?.length) return copy;
  const { sharedDishes: _narrowed, ...own } = filterMenuToDishes(copy, dishes, shared.brandName);
  return own;
}

export async function applySharingChange(before: MenuSharing, after: MenuSharing, beforeDishes: BrandDishes = {}): Promise<SharingChangeOutcome> {
  const repo = getRepo();
  const out: SharingChangeOutcome = { gotOwnMenu: [], copiedMenu: [], startedSharing: [], noDishesLeft: [] };
  for (const [brand, source] of Object.entries(before)) {
    if (after[brand]) continue; // still shares (possibly another menu)
    const shared = await repo.getMenu(source);
    if (!shared) continue;
    const seen = brandCopy(shared, brand, beforeDishes[brand]);
    const own = await repo.getMenu(brand);
    if (own) {
      await repo.saveMenu({ ...own, ...mergeOff(own, seen) });
      out.gotOwnMenu.push(brand);
    } else if (seen.items.length) {
      await repo.saveMenu(seen);
      out.copiedMenu.push(brand);
    } else {
      // Its dish list matches nothing on the shared menu: an empty menu must never be saved (a publish would wipe its stores).
      out.noDishesLeft.push(brand);
    }
  }
  // Moved from one shared menu to another: the old menu's timed 86s are still live on this brand's platforms (DoorDash has
  // no native timer). Keep them on the brand's own menu so they finish on its stores (never re-enabling what the new
  // menu has off — see ops.reenableExpiredItems). Only the timers of this brand's own dishes count.
  for (const [brand, oldSource] of Object.entries(before)) {
    const newSource = after[brand];
    if (!newSource || newSource === oldSource) continue;
    const shared = await repo.getMenu(oldSource);
    if (!shared) continue;
    const until = { ...(shared.unavailableUntil ?? {}) };
    const byLoc: Record<string, string[]> = {};
    for (const key of Object.keys(until)) {
      const [loc, ref] = key.split('|');
      if ((shared.unavailableByLocation?.[loc] ?? []).includes(ref)) byLoc[loc] = [...(byLoc[loc] ?? []), ref];
      else delete until[key];
    }
    const timed = brandCopy({ ...shared, unavailableByLocation: byLoc, unavailableUntil: until }, brand, beforeDishes[brand]);
    if (!Object.keys(timed.unavailableUntil ?? {}).length) continue;
    const own = (await repo.getMenu(brand)) ?? { ...timed, unavailableByLocation: {}, unavailableUntil: {} };
    await repo.saveMenu({ ...own, ...mergeOff(own, timed) });
  }
  for (const [brand, source] of Object.entries(after)) {
    if (before[brand] === source) continue;
    await forgetCloverStateFor(brand);
    out.startedSharing.push(brand);
  }
  return out;
}
