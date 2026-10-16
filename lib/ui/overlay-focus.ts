/**
 * Pure focus and stacking rules shared by the console's modal and drawer.
 * Keep this independent of the DOM so nested overlay behavior is unit-testable.
 */
export function createOverlayStack() {
  const ids: symbol[] = [];
  return {
    push(id: symbol): number {
      if (!ids.includes(id)) ids.push(id);
      return ids.length;
    },
    remove(id: symbol): number {
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1);
      return ids.length;
    },
    isTop(id: symbol): boolean { return ids[ids.length - 1] === id; },
    get size(): number { return ids.length; },
  };
}

export const dialogStack = createOverlayStack();

/** Return a wrap destination only at a boundary or when focus escaped. */
export function tabWrapTarget<T>(focusables: readonly T[], active: T | null, backward: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (active === null || !focusables.includes(active)) return backward ? last : first;
  if (backward && active === first) return last;
  if (!backward && active === last) return first;
  return null;
}
