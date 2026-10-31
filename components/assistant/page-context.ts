'use client';

// Optional page extras for the assistant. A page may share a few numbers it already shows (short scalars only):
//   useAssistantPageContext({ selectedBrand: 'Pi Pita', filterDays: 7 });
// The panel sends them with the route; the server keeps at most 12 short keys (lib/foodhub/assistant/snapshot.ts
// cleanExtra) and still computes the real numbers itself.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type Extra = Record<string, string | number | boolean | null>;
const byPath = new Map<string, Extra>();

export function setAssistantPageContext(pathname: string, extra: Extra | null): void {
  if (extra && Object.keys(extra).length) byPath.set(pathname, extra); else byPath.delete(pathname);
}

export function getAssistantPageContext(pathname: string): Extra | undefined {
  return byPath.get(pathname);
}

export function useAssistantPageContext(extra: Extra | null): void {
  const pathname = usePathname();
  const key = JSON.stringify(extra ?? null);
  useEffect(() => {
    setAssistantPageContext(pathname, extra);
    return () => setAssistantPageContext(pathname, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialized extra
  }, [pathname, key]);
}
