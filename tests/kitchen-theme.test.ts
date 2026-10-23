import { describe, expect, it } from 'vitest';
import { applyKitchenTheme, isKitchenRoute } from '../lib/ui/kitchen-theme';

describe('kitchen theme route scope', () => {
  it('applies only on the kitchen route tree', () => {
    expect(isKitchenRoute('/kitchen')).toBe(true);
    expect(isKitchenRoute('/kitchen/lock')).toBe(true);
    expect(isKitchenRoute('/kitchenette')).toBe(false);
    expect(isKitchenRoute('/orders')).toBe(false);
  });

  it('preserves unrelated classes when leaving the kitchen', () => {
    const classes = new Set(['custom', 'display-large']);
    const classList = {
      toggle(name: string, on: boolean) {
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
    applyKitchenTheme(classList, '/kitchen');
    expect(classes.has('theme-kitchen')).toBe(true);
    applyKitchenTheme(classList, '/orders');
    expect([...classes].sort()).toEqual(['custom', 'display-large']);
  });
});
