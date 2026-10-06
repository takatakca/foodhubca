'use client';

// Display settings of THIS screen (not of the person): a wall tablet keeps big text whoever signs in with a PIN.
//   text: md (normal) · lg (+12.5 %) · xl (+25 %) — scales every rem-based size and the pixel text sizes (globals.css)
//   density: comfortable (bigger touch targets) · compact (more rows on an office screen)
//   tips: full (explain things the first time) · light (only before actions that reach a platform) · off
// Stored in localStorage and applied to <html data-text data-density> before the page paints (see DISPLAY_BOOT_SCRIPT).
import { useCallback, useEffect, useState } from 'react';

export type TextSize = 'md' | 'lg' | 'xl';
export type Density = 'comfortable' | 'compact';
export type Tips = 'full' | 'light' | 'off';
export type DisplayPrefs = { text: TextSize; density: Density; tips: Tips; reduceMotion: boolean };

export const DISPLAY_KEY = 'takatak.display.v1';
export const DISPLAY_EVENT = 'takatak:display';

const TEXTS: TextSize[] = ['md', 'lg', 'xl'];

/** Touch screens (kitchen tablets) start with bigger text; a mouse screen with normal text. */
export function defaultDisplay(coarse: boolean): DisplayPrefs {
  return { text: coarse ? 'lg' : 'md', density: coarse ? 'comfortable' : 'compact', tips: 'full', reduceMotion: false };
}

export function parseDisplay(raw: string | null, coarse: boolean): DisplayPrefs {
  const d = defaultDisplay(coarse);
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<DisplayPrefs>;
    return {
      text: TEXTS.includes(p.text as TextSize) ? (p.text as TextSize) : d.text,
      density: p.density === 'compact' || p.density === 'comfortable' ? p.density : d.density,
      tips: p.tips === 'full' || p.tips === 'light' || p.tips === 'off' ? p.tips : d.tips,
      reduceMotion: typeof p.reduceMotion === 'boolean' ? p.reduceMotion : d.reduceMotion,
    };
  } catch {
    return d;
  }
}

function isCoarse() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

export function readDisplay(): DisplayPrefs {
  if (typeof window === 'undefined') return defaultDisplay(false);
  let raw: string | null = null;
  try { raw = localStorage.getItem(DISPLAY_KEY); } catch { /* ignore */ }
  return parseDisplay(raw, isCoarse());
}

export function applyDisplay(p: DisplayPrefs) {
  const el = document.documentElement;
  el.dataset.text = p.text;
  el.dataset.density = p.density;
  if (p.reduceMotion) el.dataset.motion = 'reduce'; else delete el.dataset.motion;
}

export function saveDisplay(p: DisplayPrefs) {
  try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(p)); } catch { /* private mode: applies for this visit only */ }
  applyDisplay(p);
  window.dispatchEvent(new Event(DISPLAY_EVENT));
}

export function useDisplay(): [DisplayPrefs, (patch: Partial<DisplayPrefs>) => void] {
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => defaultDisplay(false));
  useEffect(() => {
    const sync = () => setPrefs(readDisplay());
    sync();
    window.addEventListener(DISPLAY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(DISPLAY_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const update = useCallback((patch: Partial<DisplayPrefs>) => saveDisplay({ ...readDisplay(), ...patch }), []);
  return [prefs, update];
}

/** Next text size up (A → A+ → A++ → A). */
export function nextTextSize(t: TextSize): TextSize {
  return TEXTS[(TEXTS.indexOf(t) + 1) % TEXTS.length];
}

/** Runs before the first paint (inline in <head>) so big text never "jumps" after loading. */
export const DISPLAY_BOOT_SCRIPT = `(function(){try{var c=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;var p={};try{p=JSON.parse(localStorage.getItem('${DISPLAY_KEY}')||'{}')||{}}catch(e){}var t=['md','lg','xl'].indexOf(p.text)>=0?p.text:(c?'lg':'md');var d=p.density==='compact'||p.density==='comfortable'?p.density:(c?'comfortable':'compact');var e=document.documentElement;e.setAttribute('data-text',t);e.setAttribute('data-density',d);if(p.reduceMotion)e.setAttribute('data-motion','reduce')}catch(e){}})();`;
