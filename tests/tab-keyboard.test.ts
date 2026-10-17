import { describe, expect, it } from 'vitest';
import { nextTabIndex } from '../lib/ui/tab-keyboard';

describe('horizontal console tabs: keyboard navigation', () => {
  it('moves right and left to adjacent tabs', () => {
    expect(nextTabIndex(1, 4, 'ArrowRight')).toBe(2);
    expect(nextTabIndex(2, 4, 'ArrowLeft')).toBe(1);
  });
  it('wraps from last to first and first to last', () => {
    expect(nextTabIndex(3, 4, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(0, 4, 'ArrowLeft')).toBe(3);
  });
  it('moves to first/last with Home and End', () => {
    expect(nextTabIndex(2, 5, 'Home')).toBe(0);
    expect(nextTabIndex(2, 5, 'End')).toBe(4);
  });
  it('leaves Tab, Enter and unrelated shortcuts to the browser and callers', () => {
    expect(nextTabIndex(1, 4, 'Tab')).toBeNull();
    expect(nextTabIndex(1, 4, 'Enter')).toBeNull();
    expect(nextTabIndex(1, 4, 'Escape')).toBeNull();
  });
  it('does not navigate an empty or invalid tab list', () => {
    expect(nextTabIndex(0, 0, 'ArrowRight')).toBeNull();
    expect(nextTabIndex(-1, 3, 'ArrowLeft')).toBeNull();
    expect(nextTabIndex(3, 3, 'End')).toBeNull();
    expect(nextTabIndex(0, Number.NaN, 'Home')).toBeNull();
  });
});
