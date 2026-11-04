export const SETUP_PLATFORMS = ['doordash', 'ubereats', 'skip'] as const;
export type ScreenSetupCounts = Record<(typeof SETUP_PLATFORMS)[number], number>;

/** Preserve existing accounts: only propose the missing sessions toward 18 per provider. */
export function missingScreenCounts(screens: ReadonlyArray<{ platform: string }>, target = 18): ScreenSetupCounts {
  return Object.fromEntries(SETUP_PLATFORMS.map((platform) => [platform, Math.max(0, target - screens.filter((s) => s.platform === platform).length)])) as ScreenSetupCounts;
}

/** Append new slots without reassigning the PC's existing browser profile numbers. */
export function nextScreenNumber(screens: ReadonlyArray<{ id: string }>): number {
  const numbers = screens.flatMap((s) => { const match = /^s(\d{2})$/.exec(s.id); return match ? [Number(match[1])] : []; });
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}
