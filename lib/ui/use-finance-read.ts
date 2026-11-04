'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Finance reads belong to the selection that requested them. A late previous-platform response cannot replace it. */
export function useFinanceRead<T>(key: string, read: () => Promise<T>) {
  const sequence = useRef(0);
  const active = useRef<string | null>(null);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string } | null>(null);
  const load = useCallback(async () => {
    // A mutation started in an older workspace may finish after a switch. Its old refresh must stay inert.
    if (active.current !== key) return;
    const id = ++sequence.current;
    try {
      const data = await read();
      if (id === sequence.current) setResult({ key, data, error: '' });
    } catch (e) {
      if (id === sequence.current) setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) });
    }
  }, [key, read]);
  useEffect(() => {
    const selection = active;
    const requests = sequence;
    selection.current = key;
    void load();
    return () => { selection.current = null; requests.current++; };
  }, [key, load]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, err: current?.error ?? '', loaded: !!current, load };
}
