// Which celebrations already happened on this device (components/ui/celebration.tsx), one localStorage key per moment:
// Go-live reaches 100 %, the first menu publish, Clover connected, the Clover wizard all set (docs/MASTER_PLAN.md
// Phase 3 P2: once each). A moment is celebrated only when this device can remember it: every storage access is
// wrapped, and in a browser that blocks site data (or with a full quota) nothing is celebrated at all, because a page
// load could not tell it already happened and the confetti would come back on every visit.
export const CELEBRATION_KEYS = {
  goLive: 'takatak.celebrated.go-live',
  firstPublish: 'takatak.celebrated.first-menu-publish',
  cloverConnected: 'takatak.celebrated.clover-connected',
  cloverAllSet: 'takatak.celebrated.clover-all-set',
} as const;

export type CelebrationStore = Pick<Storage, 'getItem' | 'setItem'>;

function deviceStore(): CelebrationStore | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/**
 * True the first time only, once it is remembered on this device; false when this moment was already celebrated here,
 * or when the device cannot remember it (blocked storage, full quota): then it is never celebrated, never every visit.
 */
export function claimCelebration(key: string, store: CelebrationStore | null = deviceStore()): boolean {
  if (!store) return false;
  try {
    if (store.getItem(key)) return false;
    store.setItem(key, new Date().toISOString());
    return Boolean(store.getItem(key));
  } catch {
    return false;
  }
}

/** The moment has passed without a celebration (e.g. this menu was already published before): never celebrate it later. */
export function markCelebrated(key: string, store: CelebrationStore | null = deviceStore()): void {
  try { if (store && !store.getItem(key)) store.setItem(key, new Date().toISOString()); } catch { /* nothing to remember with */ }
}
