// Which celebrations already happened on this device (components/ui/celebration.tsx), one localStorage key per moment:
// Go-live reaches 100 %, the first menu publish, Clover connected (docs/MASTER_PLAN.md Phase 3 P2: once each).
// Every storage access is wrapped: in private mode, with blocked storage or a full quota, the moment is remembered in
// this tab's memory instead, so it is still celebrated at most once per tab, never on every visit.
export const CELEBRATION_KEYS = {
  goLive: 'takatak.celebrated.go-live',
  firstPublish: 'takatak.celebrated.first-menu-publish',
  cloverConnected: 'takatak.celebrated.clover-connected',
} as const;

export type CelebrationStore = Pick<Storage, 'getItem' | 'setItem'>;

const seenInTab = new Set<string>();

function deviceStore(): CelebrationStore | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** True the first time only, and remembered; false when this moment was already celebrated on this device. */
export function claimCelebration(key: string, store: CelebrationStore | null = deviceStore()): boolean {
  try {
    if (!store) throw new Error('no storage');
    if (store.getItem(key)) return false;
    store.setItem(key, new Date().toISOString());
    return true;
  } catch {
    if (seenInTab.has(key)) return false;
    seenInTab.add(key);
    return true;
  }
}

/** The moment has passed without a celebration (e.g. this menu was already published before): never celebrate it later. */
export function markCelebrated(key: string, store: CelebrationStore | null = deviceStore()): void {
  seenInTab.add(key);
  try { if (store && !store.getItem(key)) store.setItem(key, new Date().toISOString()); } catch { /* remembered for this tab */ }
}
