// useCelebrateOnce (components/ui/celebration.tsx): true the first time a moment happens on this device, and only while it
// lasts. Review of PR #135: the Go-live banner « Plus rien à faire » stayed on screen after a Re-check found a step left to
// do. The tests run in node (no DOM), so React's useState / useEffect are replaced by a tiny hook runner that renders,
// runs the effects whose deps changed, and renders again until the state settles, as React does after mount.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Effect = () => void | (() => void);
const slots: unknown[] = [];
const deps: (unknown[] | undefined)[] = [];
let slot = 0;
let effectSlot = 0;
let pending: Effect[] = [];
let dirty = false;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <S,>(init: S) => {
      const i = slot++;
      if (!(i in slots)) slots[i] = init;
      const set = (v: S) => { if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true; } };
      return [slots[i] as S, set];
    },
    useEffect: (fn: Effect, d?: unknown[]) => {
      const i = effectSlot++;
      const prev = deps[i];
      if (!prev || !d || d.some((x, k) => !Object.is(x, prev[k]))) { deps[i] = d; pending.push(fn); }
    },
  };
});

// Renamed: the runner plays React, each pass in render() below is one render of the component that calls the hook.
const { useCelebrateOnce: celebrateOnce } = await import('../components/ui/celebration');
const { CELEBRATION_KEYS } = await import('../lib/ui/celebrate');

/** Render the hook with `when`, run its effects, re-render until settled; returns what the page would show. */
function render(when: boolean): boolean {
  let out = false;
  for (let pass = 0; pass < 5; pass++) {
    slot = 0; effectSlot = 0; dirty = false;
    out = celebrateOnce(CELEBRATION_KEYS.goLive, when);
    const run = pending; pending = [];
    run.forEach((fn) => fn());
    if (!dirty) return out;
  }
  throw new Error('the hook never settled');
}

function freshPage() {
  slots.length = 0; deps.length = 0; pending = [];
}

describe('useCelebrateOnce: one celebration, only while the moment lasts', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } } });
    freshPage();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Go-live at 100 %, then a Re-check finds a step left: the banner goes and does not come back', () => {
    expect(render(true)).toBe(true); // reaches 100 %: celebrated
    expect(render(true)).toBe(true); // still 100 % on the next render
    expect(render(false)).toBe(false); // Re-check → 95 %: « Nothing left to do » must not stay on screen
    expect(render(true)).toBe(false); // back to 100 % on the same page: already celebrated
    freshPage();
    expect(render(true)).toBe(false); // a later visit at 100 %: already celebrated on this device
  });

  it('never celebrates before the moment happens', () => {
    expect(render(false)).toBe(false);
    expect(render(false)).toBe(false);
    expect(render(true)).toBe(true);
  });

  it('blocked storage: never celebrates, on any load', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new Error('SecurityError'); } });
    expect(render(true)).toBe(false);
    freshPage();
    expect(render(true)).toBe(false);
  });
});
