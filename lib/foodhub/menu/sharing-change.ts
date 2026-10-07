// What has to happen when the menu-sharing map changes, beyond saving it.
//  - A brand that STOPS sharing gets a menu of its own right away (a copy of the shared menu when it has none) carrying
//    the shared menu's 86 state and timers: its platforms still show the shared menu with those 86s until it is
//    published again, so nothing may be left switched off with no way to switch it back on.
//  - A brand that STARTS sharing forgets the Clover price flags / Clover-86 marks of its own (now unused) menu.
//    The timed 86s left on its own menu still finish on its own stores (ops.reenableExpiredItems, ownMenu).
import { forgetCloverStateFor } from '../clover-sync';
import { getRepo } from '../repo';
import type { MasterMenu } from '../types';
import type { MenuSharing } from './shared';

export interface SharingChangeOutcome { gotOwnMenu: string[]; copiedMenu: string[]; startedSharing: string[] }

function mergeOff(own: MasterMenu, shared: MasterMenu): Pick<MasterMenu, 'unavailableByLocation' | 'unavailableUntil'> {
  const byLoc: Record<string, string[]> = { ...(own.unavailableByLocation ?? {}) };
  for (const [loc, refs] of Object.entries(shared.unavailableByLocation ?? {})) byLoc[loc] = [...new Set([...(byLoc[loc] ?? []), ...refs])];
  return { unavailableByLocation: byLoc, unavailableUntil: { ...(own.unavailableUntil ?? {}), ...(shared.unavailableUntil ?? {}) } };
}

export async function applySharingChange(before: MenuSharing, after: MenuSharing): Promise<SharingChangeOutcome> {
  const repo = getRepo();
  const out: SharingChangeOutcome = { gotOwnMenu: [], copiedMenu: [], startedSharing: [] };
  for (const [brand, source] of Object.entries(before)) {
    if (after[brand]) continue; // still shares (possibly another menu)
    const shared = await repo.getMenu(source);
    if (!shared) continue;
    const own = await repo.getMenu(brand);
    if (own) {
      await repo.saveMenu({ ...own, ...mergeOff(own, shared) });
      out.gotOwnMenu.push(brand);
    } else {
      await repo.saveMenu({ ...shared, brandName: brand });
      out.copiedMenu.push(brand);
    }
  }
  // Moved from one shared menu to another: the old menu's timed 86s are still live on this brand's platforms (DoorDash has
  // no native timer). Keep them on the brand's own menu so they finish on its stores (never re-enabling what the new
  // menu has off — see ops.reenableExpiredItems).
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
    if (!Object.keys(until).length) continue;
    const own = (await repo.getMenu(brand)) ?? { ...shared, brandName: brand, unavailableByLocation: {}, unavailableUntil: {} };
    await repo.saveMenu({ ...own, ...mergeOff(own, { ...shared, unavailableByLocation: byLoc, unavailableUntil: until }) });
  }
  for (const [brand, source] of Object.entries(after)) {
    if (before[brand] === source) continue;
    await forgetCloverStateFor(brand);
    out.startedSharing.push(brand);
  }
  return out;
}
