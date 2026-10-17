import { describe, expect, it } from 'vitest';
import { createOverlayStack, tabWrapTarget } from '../lib/ui/overlay-focus';

describe('overlay dialog stack', () => {
  it('only the most recently mounted dialog owns Escape and Tab', () => {
    const stack = createOverlayStack();
    const first = Symbol('modal'), second = Symbol('drawer');
    expect(stack.push(first)).toBe(1);
    expect(stack.isTop(first)).toBe(true);
    expect(stack.push(second)).toBe(2);
    expect(stack.isTop(first)).toBe(false);
    expect(stack.isTop(second)).toBe(true);
    expect(stack.remove(second)).toBe(1);
    expect(stack.isTop(first)).toBe(true);
    expect(stack.remove(first)).toBe(0);
    expect(stack.isTop(first)).toBe(false);
  });

  it('handles duplicate registration and out-of-order cleanup without losing the active overlay', () => {
    const stack = createOverlayStack();
    const first = Symbol('first'), second = Symbol('second');
    expect(stack.push(first)).toBe(1);
    expect(stack.push(first)).toBe(1);
    expect(stack.push(second)).toBe(2);
    expect(stack.remove(first)).toBe(1);
    expect(stack.isTop(second)).toBe(true);
    expect(stack.remove(first)).toBe(1);
    expect(stack.remove(second)).toBe(0);
  });
});

describe('dialog keyboard Tab wrapping', () => {
  const fields = ['close', 'first-input', 'submit'];

  it('wraps forward at last and backward at first control', () => {
    expect(tabWrapTarget(fields, 'submit', false)).toBe('close');
    expect(tabWrapTarget(fields, 'close', true)).toBe('submit');
  });

  it('lets browser handle normal interior Tab movement', () => {
    expect(tabWrapTarget(fields, 'first-input', false)).toBeNull();
    expect(tabWrapTarget(fields, 'first-input', true)).toBeNull();
  });

  it('returns focus to the dialog when the current focus escaped', () => {
    expect(tabWrapTarget(fields, 'outside', false)).toBe('close');
    expect(tabWrapTarget(fields, 'outside', true)).toBe('submit');
    expect(tabWrapTarget(fields, null, false)).toBe('close');
    expect(tabWrapTarget([], null, false)).toBeNull();
  });
});
