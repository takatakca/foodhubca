'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 640px)';

function subscribe(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const m = window.matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

/**
 * Is the screen at least `sm` (640 px) wide? Pickers open as a dropdown there, and as a bottom sheet on a phone.
 * The server and the first render say "phone"; pickers only open after a tap, so nothing jumps.
 */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : true), () => false);
}
