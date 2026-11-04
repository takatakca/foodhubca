import type { Scope } from '../foodhub/scope';
import { ringDecision, type RingMemory, type RingScreen } from './screens-ring';
import { defaultCustom, type CustomTile } from './screens-layout';

export type ScopedScreen = RingScreen & { platform: string; locationCode: string };

/** API orders use uber_eats; relay screens use ubereats. Unknown channels match no screen. */
export function screenChannel(platform: string): string | undefined {
  if (platform === 'ubereats') return 'uber_eats';
  return platform === 'doordash' || platform === 'skip' ? platform : undefined;
}

/** Account screens may cover several brands: only the location and platform narrow this wall. */
export function screenInScope(screen: ScopedScreen, scope: Pick<Scope, 'kitchen' | 'channel'>): boolean {
  return (!scope.kitchen || screen.locationCode === scope.kitchen)
    && (!scope.channel || screenChannel(screen.platform) === scope.channel);
}

/** Viewing one platform never silences waiting orders or dropped screens on the others. */
export function screenWallState<T extends ScopedScreen>(screens: T[], scope: Pick<Scope, 'kitchen' | 'channel'>, prev: RingMemory) {
  return { visible: screens.filter((screen) => screenInScope(screen, scope)), ring: ringDecision(screens, prev) };
}

/** Jump only to an already-authorized screen; clear a previous brand and an unsupported platform filter. */
export function revealScreenScope(screen: ScopedScreen): Scope {
  return { kitchen: screen.locationCode, brand: null, channel: screenChannel(screen.platform) };
}

/** Rearrange this view without deleting the saved positions of screens hidden by its filters. */
export function resetVisibleScreenTiles(saved: CustomTile[], visibleIds: string[]): CustomTile[] {
  const visible = new Set(visibleIds);
  return [...saved.filter((tile) => !visible.has(tile.id)), ...defaultCustom(visibleIds)];
}
