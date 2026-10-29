'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { applyKitchenTheme } from '@/lib/ui/kitchen-theme';

/** Keep the kitchen theme across SPA navigation, including the standalone PIN lock page. */
export function RouteTheme() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    applyKitchenTheme(root.classList, pathname);
    return () => root.classList.remove('theme-kitchen');
  }, [pathname]);
  return null;
}
