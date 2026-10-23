/** Match only the kitchen route family, never /kitchenette or /orders. */
export function isKitchenRoute(pathname: string): boolean {
  return pathname === '/kitchen' || pathname.startsWith('/kitchen/');
}

/** Apply to document root so portaled dialogs inherit kitchen tokens. */
export function applyKitchenTheme(classList: Pick<DOMTokenList, 'toggle'>, pathname: string): void {
  classList.toggle('theme-kitchen', isKitchenRoute(pathname));
}
