'use client';

// Client supervisor: watches this screen for problems and reports them, so nothing breaks silently.
//   - page crashes (error boundary), uncaught errors and rejected promises
//   - server calls that fail (network, 5xx) or are slow (> 6 s); 401/428/499 are normal flows and never reported;
//     a 4xx only counts when the same call fails 3 times in 5 minutes
//   - connection: offline, and "stale" (no successful live refresh for 45 s while the screen is visible)
// Issues are de-duplicated (same kind + message + path within 5 min → count++), kept in a small ring for the help
// drawer, and sent in batches to POST /api/foodhub/client-report (every 30 s, at once for a crash, and with
// sendBeacon when the tab is hidden). No form values, no customer data, messages ≤ 300 chars.
import { setApiObserver, type ApiEvent } from '@/lib/ui/api';

export type IssueKind = 'crash' | 'error' | 'api_fail' | 'api_slow' | 'offline' | 'stale';
export interface Issue { kind: IssueKind; message: string; path?: string; count: number; firstAt: number; lastAt: number }
export type Health = 'good' | 'slow' | 'stale' | 'offline';

type Listener = () => void;
const ring: Issue[] = [];
const outbox: Issue[] = [];
const listeners = new Set<Listener>();
const fourxx = new Map<string, number[]>();
let installed = false;
let lastPulseOk = Date.now();
let lastSlowAt = 0;
let online = true;
let screen = '';
let flushTimer: ReturnType<typeof setInterval> | null = null;

const clip = (s: unknown, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const emit = () => { for (const l of listeners) l(); };

export function subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function recentIssues(): Issue[] { return [...ring].reverse(); }

export function health(now = Date.now()): Health {
  if (!online) return 'offline';
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && now - lastPulseOk > 45_000) return 'stale';
  if (now - lastSlowAt < 60_000) return 'slow';
  return 'good';
}

export function lastRefreshAt(): number { return lastPulseOk; }

export function report(kind: IssueKind, message: string, path?: string, now = Date.now()) {
  const msg = clip(message);
  const existing = ring.find((i) => i.kind === kind && i.message === msg && i.path === path && now - i.lastAt < 5 * 60_000);
  if (existing) { existing.count += 1; existing.lastAt = now; }
  else {
    const issue: Issue = { kind, message: msg, path, count: 1, firstAt: now, lastAt: now };
    ring.push(issue);
    if (ring.length > 50) ring.shift();
    outbox.push(issue);
    if (outbox.length > 50) outbox.shift();
  }
  emit();
  if (kind === 'crash') void flush();
}

function onApi(e: ApiEvent) {
  const now = Date.now();
  if (e.path.startsWith('/api/foodhub/pulse')) { if (e.ok) { lastPulseOk = now; emit(); } }
  if (e.path.startsWith('/api/foodhub/client-report')) return;
  if (e.ms > 6000) { lastSlowAt = now; report('api_slow', `${e.method} ${e.path} took ${Math.round(e.ms / 1000)} s`, e.path); }
  if (e.ok || [401, 428, 499].includes(e.status)) return;
  if (e.status === 0 || e.status >= 500) { report('api_fail', `${e.method} ${e.path} → ${e.status || 'network error'}${e.error ? `: ${e.error}` : ''}`, e.path); return; }
  const key = `${e.method} ${e.path} ${e.status}`;
  const hits = (fourxx.get(key) ?? []).filter((t) => now - t < 5 * 60_000).concat(now);
  fourxx.set(key, hits);
  if (hits.length === 3) report('api_fail', `${key} (3 times in 5 min)${e.error ? `: ${e.error}` : ''}`, e.path);
}

export async function flush(note?: string): Promise<boolean> {
  if (!outbox.length && !note) return true;
  const batch = outbox.splice(0, outbox.length);
  try {
    const res = await fetch('/api/foodhub/client-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ screen, note: note ? clip(note, 500) : undefined, issues: batch }) });
    if (!res.ok) throw new Error(String(res.status));
    return true;
  } catch {
    outbox.unshift(...batch.slice(-20));
    return false;
  }
}

export function setScreen(path: string) { screen = clip(path, 120); }

/** Installs once per page load (the console shell calls it). */
export function installSupervisor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  online = navigator.onLine !== false;
  setApiObserver(onApi);
  window.addEventListener('error', (e) => report('error', e.message || 'Script error', screen));
  window.addEventListener('unhandledrejection', (e) => report('error', e.reason instanceof Error ? e.reason.message : clip(e.reason), screen));
  let offSince = 0;
  window.addEventListener('offline', () => { online = false; offSince = Date.now(); emit(); });
  window.addEventListener('online', () => {
    online = true;
    if (offSince) report('offline', `Offline for ${Math.round((Date.now() - offSince) / 1000)} s`, screen);
    offSince = 0;
    void flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !outbox.length) return;
    const body = JSON.stringify({ screen, issues: outbox.splice(0, outbox.length) });
    try { navigator.sendBeacon?.('/api/foodhub/client-report', new Blob([body], { type: 'application/json' })); } catch { /* ignore */ }
  });
  let staleReported = false;
  flushTimer = setInterval(() => {
    const h = health();
    if (h === 'stale' && !staleReported) { staleReported = true; report('stale', 'Live data not refreshed for 45 s', screen); }
    if (h !== 'stale') staleReported = false;
    emit();
    void flush();
  }, 30_000);
  void flushTimer;
}
