/** Horizontal WAI-ARIA tablist keyboard navigation. Null lets unrelated keys act normally. */
export function nextTabIndex(current: number, count: number, key: string): number | null {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(current) || current < 0 || current >= count) return null;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
