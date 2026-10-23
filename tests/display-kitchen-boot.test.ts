import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DISPLAY_BOOT_SCRIPT } from '../lib/ui/display';

function boot(pathname: string) {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  runInNewContext(DISPLAY_BOOT_SCRIPT, {
    window: { location: { pathname }, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null },
    document: { documentElement: {
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) },
    } },
  });
  return { attrs, classes };
}

describe('kitchen colour tokens before the first paint', () => {
  it('marks kitchen pages dark before React mounts', () => {
    for (const route of ['/kitchen', '/kitchen/lock']) {
      const result = boot(route);
      expect(result.classes.has('theme-kitchen')).toBe(true);
      expect(result.attrs.get('data-text')).toBe('md');
    }
  });

  it('keeps all unrelated screens light', () => {
    for (const route of ['/orders', '/kitchenette', '/settings']) {
      expect(boot(route).classes.has('theme-kitchen')).toBe(false);
    }
  });
});
