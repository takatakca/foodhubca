'use client';

// Kitchen sounds with the Web Audio API (no files to download, works offline).
// Browsers only allow sound after a first tap: unlockAudio() is called on the first interaction.
type Tone = 'order' | 'alert' | 'cancel' | 'soft' | 'ready';
let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let volume = 0.9;
/**
 * "Extra loud" (default on, per screen): square waves near full scale through a limiter, each pattern played twice.
 * Normal mode stays the soft beep (peak 32 %) for office screens.
 */
let loud = true;

/** Saved per screen in components/live/incoming.tsx (AlertSettings); read here too so every alarm — the locked PIN screen included — uses it. */
function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('takatak.alerts.v1') || '{}');
    if (typeof p.volume === 'number') volume = Math.max(0, Math.min(1, p.volume));
    if (typeof p.loud === 'boolean') loud = p.loud;
  } catch { /* private mode: defaults */ }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    readPrefs();
    // A limiter in front of the speaker: loud mode can push near full scale without crackling.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    limiter.connect(ctx.destination);
    out = limiter;
  }
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => undefined);
}
export function audioReady() { return Boolean(ctx && ctx.state === 'running'); }
export function setVolume(v: number) { volume = Math.max(0, Math.min(1, v)); }
export function setLoud(v: boolean) { loud = v; }

const PATTERNS: Record<Tone, Array<[number, number, number]>> = {
  // [frequency, start (s), length (s)]
  order: [[988, 0, 0.14], [1319, 0.16, 0.14], [988, 0.42, 0.14], [1319, 0.58, 0.22]],
  alert: [[740, 0, 0.18], [554, 0.22, 0.18], [740, 0.44, 0.18], [554, 0.66, 0.24]],
  cancel: [[523, 0, 0.2], [392, 0.24, 0.32]],
  soft: [[880, 0, 0.12]],
  ready: [[784, 0, 0.1], [1047, 0.12, 0.16]],
};

export function playSound(tone: Tone = 'order') {
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => undefined);
  const t0 = a.currentTime + 0.02;
  const strong = loud && tone !== 'soft' && tone !== 'ready';
  // Loud: the pattern twice in a row (a single burst is easy to miss over a hood fan), 40 % longer notes.
  const notes = strong ? [...PATTERNS[tone], ...PATTERNS[tone].map(([f, s, l]) => [f, s + 0.95, l] as [number, number, number])] : PATTERNS[tone];
  for (const [f, start, len0] of notes) {
    const len = strong ? len0 * 1.4 : len0;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = strong || tone === 'alert' ? 'square' : 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, (strong ? 0.95 : 0.32) * volume), t0 + start + 0.012);
    if (strong) gain.gain.setValueAtTime(Math.max(0.0002, 0.95 * volume), t0 + start + len * 0.7); // hold the note at full level
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
    osc.connect(gain).connect(out ?? a.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + len + 0.02);
  }
}

/** Repeats a sound every `everyMs` until the returned stop() is called. */
export function loopSound(tone: Tone, everyMs = 2500): () => void {
  playSound(tone);
  const id = setInterval(() => playSound(tone), everyMs);
  return () => clearInterval(id);
}
