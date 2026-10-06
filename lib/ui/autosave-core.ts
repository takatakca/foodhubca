// Pure core of the console's autosave, drafts and undo (no React, no DOM) — unit-tested in node.
//   - Drafts: every edit is mirrored to local storage right away, keyed by person + screen, so closing a window,
//     a crash, a dead battery or a lost connection never loses work. A draft is only offered back when it differs
//     from what the server holds.
//   - Undo: snapshot history with coalescing (a typed word is one step, not one step per key).
//   - Retry: a failed save is retried after 2 s, 5 s, 15 s, then the screen says "Not saved — Retry".

/** Anything shaped like localStorage (tests pass a Map-backed fake). */
export interface DraftStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number }
export interface Draft<T> { v: 1; at: string; value: T }

const PREFIX = 'takatak.draft.v1:';
const MAX_AGE_MS = 7 * 86400_000;

export function draftKey(user: string, form: string): string {
  return `${PREFIX}${user || 'anon'}:${form}`;
}

export function readDraft<T>(store: DraftStore | null, user: string, form: string, now = Date.now()): Draft<T> | null {
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(user, form));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    if (d?.v !== 1 || !d.at || now - Date.parse(d.at) > MAX_AGE_MS) { store.removeItem(draftKey(user, form)); return null; }
    return d;
  } catch {
    return null;
  }
}

export function writeDraft<T>(store: DraftStore | null, user: string, form: string, value: T, now = Date.now()): boolean {
  if (!store) return false;
  try {
    store.setItem(draftKey(user, form), JSON.stringify({ v: 1, at: new Date(now).toISOString(), value } satisfies Draft<T>));
    return true;
  } catch {
    return false; // private mode / quota: autosave still works, only the crash safety net is missing
  }
}

export function clearDraft(store: DraftStore | null, user: string, form: string): void {
  try { store?.removeItem(draftKey(user, form)); } catch { /* ignore */ }
}

/** Every draft of a person (or of everyone): cleared on sign-out and when a tablet locks. */
export function clearAllDrafts(store: DraftStore | null, user?: string): number {
  if (!store) return 0;
  const prefix = user ? `${PREFIX}${user}:` : PREFIX;
  const keys: string[] = [];
  try { for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(prefix)) keys.push(k); } } catch { return 0; }
  for (const k of keys) { try { store.removeItem(k); } catch { /* ignore */ } }
  return keys.length;
}

/** Deterministic JSON (sorted keys) so two equal documents compare equal whatever the key order. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Delay before retry n (1-based) of a failed save; null = stop retrying, ask the person. */
export function retryDelayMs(attempt: number): number | null {
  return [2000, 5000, 15000][attempt - 1] ?? null;
}

/** Statuses the save chip shows. */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'invalid' | 'offline' | 'error' | 'cancelled';

export interface UndoEntry<T> { before: T; after: T; label: string; at: number }
export interface UndoStack<T> {
  /** Records one change. Changes with the same label within `coalesceMs` merge into one step. */
  push(before: T, after: T, label: string, now?: number, coalesceMs?: number): void;
  undo(): UndoEntry<T> | undefined;
  redo(): UndoEntry<T> | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  peek(): UndoEntry<T> | undefined;
  clear(): void;
  size(): number;
}

export function createUndoStack<T>(limit = 50): UndoStack<T> {
  let past: UndoEntry<T>[] = [];
  let future: UndoEntry<T>[] = [];
  return {
    push(before, after, label, now = Date.now(), coalesceMs = 800) {
      if (sameValue(before, after)) return;
      const last = past[past.length - 1];
      if (last && last.label === label && now - last.at <= coalesceMs) past[past.length - 1] = { ...last, after, at: now };
      else past.push({ before, after, label, at: now });
      if (past.length > limit) past = past.slice(past.length - limit);
      future = [];
    },
    undo() { const e = past.pop(); if (e) future.push(e); return e; },
    redo() { const e = future.pop(); if (e) past.push(e); return e; },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    peek: () => past[past.length - 1],
    clear() { past = []; future = []; },
    size: () => past.length,
  };
}
