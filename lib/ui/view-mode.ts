// Simple view and full view of the console. Everyone starts in the simple view (6 menu entries, plain words, one action
// per screen). Owners and managers (permission stores:map) may switch to the full view, which is today's console,
// unchanged. Kept in a cookie so the server draws the same menu the browser shows (no flash). The mode only hides links:
// permissions, APIs and addresses do not change, every page still opens by its address and through search.
// Pure functions: no React, no Node APIs.

export type ViewMode = 'simple' | 'full';
export const VIEW_COOKIE = 'fh_view';
/** One year: a preference, not a session. */
export const VIEW_COOKIE_MAX_AGE = 31_536_000;

/** The cookie's value → a mode. Anything but "full" is the simple view. */
export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === 'full' ? 'full' : 'simple';
}

/** Who may use the full view: owners and managers, never a kitchen tablet. */
export function canUseFullView(who: { device?: unknown; permissions: readonly string[] }): boolean {
  return !who.device && who.permissions.includes('stores:map');
}

/** The mode a person actually gets: a kitchen tablet, or anyone without stores:map, always gets the simple view. */
export function effectiveViewMode(raw: string | null | undefined, who: { device?: unknown; permissions: readonly string[] }): ViewMode {
  return canUseFullView(who) ? parseViewMode(raw) : 'simple';
}

/** The cookie text the browser writes when the person flips the switch. */
export function viewCookie(mode: ViewMode, secure: boolean): string {
  return `${VIEW_COOKIE}=${mode}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; samesite=lax${secure ? '; secure' : ''}`;
}
