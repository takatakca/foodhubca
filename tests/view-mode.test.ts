// Simple view / full view (task 40): kept in the fh_view cookie, read on the server; only owners and managers can keep
// the full view; a kitchen tablet is always in the simple view.
import { describe, expect, it } from 'vitest';
import { canUseFullView, effectiveViewMode, parseViewMode, VIEW_COOKIE, viewCookie } from '../lib/ui/view-mode';
import { ROLE_PERMISSIONS } from '../lib/foodhub/session';

const person = (role: keyof typeof ROLE_PERMISSIONS, device: unknown = null) => ({ device, permissions: ROLE_PERMISSIONS[role] as string[] });

describe('view mode', () => {
  it('reads the cookie: only "full" is the full view', () => {
    expect(parseViewMode('full')).toBe('full');
    expect(parseViewMode('simple')).toBe('simple');
    expect(parseViewMode(undefined)).toBe('simple');
    expect(parseViewMode('FULL')).toBe('simple');
    expect(parseViewMode('')).toBe('simple');
  });

  it('owners and managers get the cookie’s value; everyone else and kitchen tablets get the simple view', () => {
    expect(effectiveViewMode('full', person('owner'))).toBe('full');
    expect(effectiveViewMode('full', person('manager'))).toBe('full');
    expect(effectiveViewMode(undefined, person('owner'))).toBe('simple');
    for (const r of ['operator', 'menu', 'analyst'] as const) expect(effectiveViewMode('full', person(r))).toBe('simple');
    expect(effectiveViewMode('full', person('owner', { id: 'tablet-1' }))).toBe('simple');
    expect(canUseFullView(person('manager'))).toBe(true);
    expect(canUseFullView(person('operator'))).toBe(false);
  });

  it('writes a one-year, site-wide, lax cookie (secure on https)', () => {
    expect(VIEW_COOKIE).toBe('fh_view');
    expect(viewCookie('full', true)).toBe('fh_view=full; path=/; max-age=31536000; samesite=lax; secure');
    expect(viewCookie('simple', false)).toBe('fh_view=simple; path=/; max-age=31536000; samesite=lax');
  });
});
