'use client';

// Kitchen sounds with the Web Audio API (no files to download, works offline).
// Browsers only allow sound after a first tap: unlockAudio() is called on the first interaction.
type Tone = 'order' | 'alert' | 'cancel' | 'soft' | 'ready';
let ctx: AudioContext | null = null;
let volume = 0.9;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => undefined);
}
export function audioReady() { return Boolean(ctx && ctx.state === 'running'); }
export function setVolume(v: number) { volume = Math.max(0, Math.min(1, v)); }

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
  for (const [f, start, len] of PATTERNS[tone]) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = tone === 'alert' ? 'square' : 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    // An exponential ramp to exactly 0 throws (RangeError) and would take the whole console down: floor it.
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.32 * volume), t0 + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
    osc.connect(gain).connect(a.destination);
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
