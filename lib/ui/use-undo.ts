'use client';

// Undo / redo for a screen's editable document (hours, profile, alert rules…).
//   - Watches the value: every change becomes a step; a typed word (changes within 0.8 s) is one step.
//   - Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y) work when the focus is not in a text field, where the browser's own
//     text undo stays in charge. Touch screens get the Undo button next to the save chip.
//   - Undo changes the value like any edit, so autosave saves the restored state honestly.
//   - Never used for platform actions (86, pause, publish, orders): those have explicit reverse actions with results.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createUndoStack, sameValue } from '@/lib/ui/autosave-core';

export interface Undo {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Forget the history (after loading another document). */
  reset: () => void;
}

function inTextField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes((el as HTMLInputElement).type));
}

export function useUndo<T>(value: T | null, setValue: (v: T) => void, opts: { enabled?: boolean; coalesceMs?: number } = {}): Undo {
  const enabled = opts.enabled !== false;
  const stack = useRef(createUndoStack<T>(60));
  const prev = useRef<T | null>(value);
  const applying = useRef(false);
  const setRef = useRef(setValue);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const bump = useCallback(() => setFlags({ canUndo: stack.current.canUndo(), canRedo: stack.current.canRedo() }), []);

  useEffect(() => { setRef.current = setValue; });

  useEffect(() => {
    if (value === null) { prev.current = null; return; }
    if (applying.current) { applying.current = false; prev.current = value; return; }
    if (prev.current !== null && !sameValue(prev.current, value)) {
      stack.current.push(prev.current, value, 'edit', Date.now(), opts.coalesceMs ?? 800);
      bump();
    }
    prev.current = value;
  }, [value, opts.coalesceMs, bump]);

  const undo = useCallback(() => {
    const e = stack.current.undo();
    if (!e) return;
    applying.current = true;
    setRef.current(e.before);
    bump();
  }, [bump]);
  const redo = useCallback(() => {
    const e = stack.current.redo();
    if (!e) return;
    applying.current = true;
    setRef.current(e.after);
    bump();
  }, [bump]);
  const reset = useCallback(() => { stack.current.clear(); bump(); }, [bump]);

  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || inTextField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [enabled, undo, redo]);

  return { canUndo: flags.canUndo, canRedo: flags.canRedo, undo, redo, reset };
}
