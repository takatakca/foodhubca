'use client';

// Autosave for every editable screen: no Save button, nothing lost.
//   - The screen keeps its own state; this hook watches it against the last saved value.
//   - Every change is mirrored to a local draft at once (crash, closed tab, dead battery, Wi-Fi gone: it comes back).
//   - Saves 1.2 s after the last change (never more than 5 s while typing), one save at a time, latest value wins.
//   - Problems (validate) block the save, not the typing. Offline → kept here and sent when the network returns.
//   - Failed saves retry after 2 s, 5 s, 15 s, then the chip says "Not saved — Retry". A cancelled manager PIN is
//     never retried on its own.
//   - Leaving the screen, hiding the tab or closing a window sends what is pending first.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/ui/api';
import { clearDraft, readDraft, retryDelayMs, sameValue, writeDraft, type SaveStatus } from '@/lib/ui/autosave-core';

export type { SaveStatus } from '@/lib/ui/autosave-core';

export interface AutosaveOptions<T> {
  /** Screen id for the draft (e.g. 'hours'); the person is added automatically. */
  formKey: string;
  /** Signed-in person: drafts are never shown to someone else on a shared tablet. */
  user: string;
  /** Current editable value (null while loading). */
  value: T | null;
  /** Sends the value; may return the server's canonical copy. */
  save: (value: T) => Promise<T | void>;
  validate?: (value: T) => string[];
  debounceMs?: number;
  maxWaitMs?: number;
  /** false = read-only screen (no saving, no drafts). */
  enabled?: boolean;
  /** Called once after load when a newer local draft exists: the screen puts it back in its state. */
  onRestore?: (draft: T) => void;
  /** Called with the canonical value returned by the server when the person did not type meanwhile. */
  onSaved?: (value: T) => void;
}

export interface Autosave<T> {
  status: SaveStatus;
  problems: string[];
  error: string | null;
  lastSavedAt: number | null;
  dirty: boolean;
  /** The local draft was put back after a reload/crash. */
  draftRestored: boolean;
  /** Call after loading from the server: sets the saved baseline and offers a newer local draft. */
  markLoaded: (serverValue: T) => void;
  /** Save now (Ctrl/⌘+S, the Retry button, before Publish). Resolves true when everything is saved. */
  saveNow: () => Promise<boolean>;
  /** Put the server copy back and forget the local draft. */
  discardDraft: () => void;
}

const hasWindow = () => typeof window !== 'undefined';
const store = () => { try { return hasWindow() ? window.localStorage : null; } catch { return null; } };

export function useAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  const { formKey, user, value, enabled = true } = opts;
  const debounceMs = opts.debounceMs ?? 1200;
  const maxWaitMs = opts.maxWaitMs ?? 5000;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [baselineTick, setBaselineTick] = useState(0);

  const baseline = useRef<T | null>(null);
  const latest = useRef<T | null>(value);
  const optsRef = useRef(opts);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAt = useRef<number | null>(null);
  const attempts = useRef(0);
  const holdRetry = useRef(false);
  /** Latest `run`, so a save can schedule the next one (retry, pending changes) without referring to itself. */
  const runRef = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => { optsRef.current = opts; latest.current = value; });

  const isDirty = useCallback(() => latest.current !== null && baseline.current !== null && !sameValue(latest.current, baseline.current), []);

  const run = useCallback(async (): Promise<boolean> => {
    if (inflight.current) { await inflight.current; return runRef.current(); }
    if (!isDirty()) { setStatus((s) => (s === 'saving' || s === 'dirty' ? 'saved' : s)); return true; }
    const sending = latest.current as T;
    const found = optsRef.current.validate?.(sending) ?? [];
    setProblems(found);
    if (found.length) { setStatus('invalid'); return false; }
    if (hasWindow() && navigator.onLine === false) { setStatus('offline'); return false; }
    setStatus('saving');
    setError(null);
    const p = (async () => {
      try {
        const canonical = await optsRef.current.save(sending);
        attempts.current = 0;
        holdRetry.current = false;
        baseline.current = sending;
        firstDirtyAt.current = null;
        setLastSavedAt(Date.now());
        // Adopt the server's copy (sorted, normalised) only when the screen asks for it and the person did not type
        // meanwhile — otherwise what was sent stays the baseline (never a save loop on a cosmetic difference).
        const onSaved = optsRef.current.onSaved;
        if (onSaved && canonical !== undefined && sameValue(latest.current, sending) && !sameValue(canonical, sending)) {
          baseline.current = canonical as T;
          latest.current = canonical as T;
          onSaved(canonical as T);
        }
        if (sameValue(latest.current, baseline.current)) clearDraft(store(), optsRef.current.user, optsRef.current.formKey);
        setStatus(isDirty() ? 'dirty' : 'saved');
        return true;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        setError(e instanceof Error ? e.message : String(e));
        if (status === 499) { holdRetry.current = true; setStatus('cancelled'); return false; } // manager PIN cancelled
        if (hasWindow() && navigator.onLine === false) { setStatus('offline'); return false; }
        setStatus('error');
        // Validation / permission answers (4xx) wait for the next change; network and server errors retry.
        if (status >= 400 && status < 500) return false;
        attempts.current += 1;
        const wait = retryDelayMs(attempts.current);
        if (wait !== null) { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void runRef.current(); }, wait); }
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = p;
    const ok = await p;
    // Changes made while saving: one more save with the latest value.
    if (ok && isDirty()) return runRef.current();
    return ok;
  }, [isDirty]);
  useEffect(() => { runRef.current = run; }, [run]);

  const saveNow = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    holdRetry.current = false;
    attempts.current = 0;
    return run();
  }, [run]);

  // Every change: draft first (synchronous, before any network), then a debounced save.
  useEffect(() => {
    if (!enabled || value === null || baseline.current === null) return;
    if (sameValue(value, baseline.current)) {
      clearDraft(store(), user, formKey);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setProblems([]);
      setStatus((s) => (s === 'dirty' || s === 'invalid' || s === 'error' || s === 'offline' ? 'saved' : s));
      return;
    }
    writeDraft(store(), user, formKey, value);
    const found = optsRef.current.validate?.(value) ?? [];
    setProblems(found);
    if (found.length) { setStatus('invalid'); if (timer.current) clearTimeout(timer.current); return; }
    if (holdRetry.current) { setStatus('cancelled'); return; }
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    const now = Date.now();
    if (firstDirtyAt.current === null) firstDirtyAt.current = now;
    const wait = Math.max(0, Math.min(debounceMs, firstDirtyAt.current + maxWaitMs - now));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void run(); }, wait);
  }, [value, enabled, user, formKey, debounceMs, maxWaitMs, run, baselineTick]);

  // Back online → send what was kept. Tab hidden / window closing → send now.
  useEffect(() => {
    if (!enabled) return;
    const online = () => { if (isDirty()) void saveNow(); };
    const hidden = () => { if (document.visibilityState === 'hidden' && isDirty() && !holdRetry.current) void run(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', hidden);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', hidden);
    };
  }, [enabled, isDirty, run, saveNow]);

  // Leaving the screen: send what is pending (the draft stays as a safety net until it is saved).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (isDirty() && !holdRetry.current) void run();
  }, [isDirty, run]);

  // Ctrl/⌘+S saves now (and never opens the browser's "Save page").
  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [enabled, saveNow]);

  const markLoaded = useCallback((serverValue: T) => {
    baseline.current = serverValue;
    firstDirtyAt.current = null;
    attempts.current = 0;
    holdRetry.current = false;
    setStatus('idle');
    setError(null);
    setProblems([]);
    const d = readDraft<T>(store(), optsRef.current.user, optsRef.current.formKey);
    if (d && !sameValue(d.value, serverValue) && optsRef.current.enabled !== false) {
      setDraftRestored(true);
      optsRef.current.onRestore?.(d.value);
    } else {
      setDraftRestored(false);
      if (d) clearDraft(store(), optsRef.current.user, optsRef.current.formKey);
    }
    setBaselineTick((n) => n + 1);
  }, []);

  const discardDraft = useCallback(() => {
    clearDraft(store(), optsRef.current.user, optsRef.current.formKey);
    setDraftRestored(false);
    if (baseline.current !== null) optsRef.current.onRestore?.(baseline.current);
  }, []);

  return { status, problems, error, lastSavedAt, dirty: status === 'dirty' || status === 'invalid' || status === 'error' || status === 'offline' || status === 'cancelled', draftRestored, markLoaded, saveNow, discardDraft };
}
