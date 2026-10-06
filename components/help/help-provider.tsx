'use client';

// TakTak's help state for the signed-in person on this screen: which tips were already shown, whether the welcome
// was seen, the help drawer, the coach mark (one at a time) and the guided tour.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { hintFor, pageHelpFor, type PageHelp } from '@/lib/help/content';
import { useDisplay, type Tips } from '@/lib/ui/display';

type HelpState = { seen: string[]; welcomed: boolean; toursDone: string[] };
type Mark = { id: string; anchor: HTMLElement | null; onContinue?: () => void };
type Ctx = {
  page: PageHelp;
  tips: Tips;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** Bumped every time TakTak should spin (opening help, finishing a tour…). */
  spin: number;
  mark: Mark | null;
  showMark: (id: string, anchor: HTMLElement | null, onContinue?: () => void) => void;
  closeMark: (seen?: boolean) => void;
  seen: (id: string) => boolean;
  markSeen: (id: string) => void;
  resetTips: () => void;
  tour: { page: PageHelp; step: number } | null;
  startTour: () => void;
  setTourStep: (step: number) => void;
  endTour: (completed: boolean) => void;
  welcomed: boolean;
  setWelcomed: () => void;
};

const HelpCtx = createContext<Ctx | null>(null);
const keyFor = (user: string) => `takatak.help.v1:${user || 'anon'}`;

function load(user: string): HelpState {
  try {
    const s = JSON.parse(localStorage.getItem(keyFor(user)) || '{}') as Partial<HelpState>;
    return { seen: Array.isArray(s.seen) ? s.seen.slice(-300) : [], welcomed: Boolean(s.welcomed), toursDone: Array.isArray(s.toursDone) ? s.toursDone : [] };
  } catch {
    return { seen: [], welcomed: false, toursDone: [] };
  }
}

export function HelpProvider({ user, children }: { user: string; children: ReactNode }) {
  const pathname = usePathname();
  const page = useMemo(() => pageHelpFor(pathname), [pathname]);
  const [display] = useDisplay();
  const [state, setState] = useState<HelpState>({ seen: [], welcomed: true, toursDone: [] });
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mark, setMark] = useState<Mark | null>(null);
  const [tour, setTour] = useState<{ page: PageHelp; step: number } | null>(null);
  const [spin, setSpin] = useState(0);
  const stateRef = useRef(state);
  const markRef = useRef(mark);
  const tourRef = useRef(tour);

  useEffect(() => { stateRef.current = state; markRef.current = mark; tourRef.current = tour; });
  useEffect(() => { setState(load(user)); setLoaded(true); }, [user]);
  const persist = useCallback((next: HelpState) => {
    setState(next);
    try { localStorage.setItem(keyFor(user), JSON.stringify(next)); } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { setMark(null); setTour(null); }, [pathname]);
  // "?" on a keyboard opens help (outside text fields).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '?' || el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return;
      setDrawerOpen(true); setSpin((n) => n + 1);
    };
    window.addEventListener('keydown', k);
    const open = () => { setDrawerOpen(true); setSpin((n) => n + 1); };
    window.addEventListener('takatak:help', open);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('takatak:help', open); };
  }, []);

  const value = useMemo<Ctx>(() => ({
    page,
    tips: display.tips,
    drawerOpen,
    openDrawer: () => { setDrawerOpen(true); setSpin((n) => n + 1); },
    closeDrawer: () => setDrawerOpen(false),
    spin,
    mark,
    showMark: (id, anchor, onContinue) => { if (hintFor(id)) setMark({ id, anchor, onContinue }); },
    closeMark: (seen = true) => {
      const m = markRef.current;
      if (m && seen && !stateRef.current.seen.includes(m.id)) persist({ ...stateRef.current, seen: [...stateRef.current.seen, m.id] });
      setMark(null);
    },
    seen: (id) => stateRef.current.seen.includes(id),
    markSeen: (id) => { if (!stateRef.current.seen.includes(id)) persist({ ...stateRef.current, seen: [...stateRef.current.seen, id] }); },
    resetTips: () => persist({ ...stateRef.current, seen: [], toursDone: [] }),
    tour,
    startTour: () => { setDrawerOpen(false); setMark(null); setTour({ page, step: 0 }); setSpin((n) => n + 1); },
    setTourStep: (step) => setTour((t) => (t ? { ...t, step } : t)),
    endTour: (completed) => {
      const t = tourRef.current;
      if (t && completed && !stateRef.current.toursDone.includes(t.page.match)) persist({ ...stateRef.current, toursDone: [...stateRef.current.toursDone, t.page.match] });
      setTour(null);
      if (completed) setSpin((n) => n + 1);
    },
    welcomed: !loaded || state.welcomed,
    setWelcomed: () => persist({ ...stateRef.current, welcomed: true }),
  }), [page, display.tips, drawerOpen, spin, mark, tour, loaded, state.welcomed, persist]);

  return <HelpCtx.Provider value={value}>{children}</HelpCtx.Provider>;
}

export function useHelp(): Ctx {
  const c = useContext(HelpCtx);
  if (!c) throw new Error('useHelp outside HelpProvider');
  return c;
}

/** Same as useHelp, but null outside the console (sign-in page, legal pages). */
export function useOptionalHelp(): Ctx | null {
  return useContext(HelpCtx);
}
