'use client';

import { useEffect, useRef } from 'react';
import { audioReady } from '@/lib/ui/sound';

type Battery = { level: number; charging: boolean };

/**
 * Kitchen tablet heartbeat: every 30 s tells the server "I'm on, sound on, screen visible, battery x %".
 * The Watchtower raises "your tablet is off" when it stops. Also keeps the screen awake.
 */
export function DeviceHeartbeat({ screen = 'console', onBeat }: { screen?: string; onBeat?: (r: { waiting?: number; cancelled?: number }) => void }) {
  const onBeatRef = useRef(onBeat);
  useEffect(() => { onBeatRef.current = onBeat; });
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try { if (document.visibilityState === 'visible' && 'wakeLock' in navigator) lock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen'); } catch { /* not allowed */ }
    };
    const beat = async () => {
      let battery: Battery | null = null;
      try { battery = await (navigator as unknown as { getBattery?: () => Promise<Battery> }).getBattery?.() ?? null; } catch { /* not supported */ }
      fetch('/api/foodhub/devices/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ soundOn: audioReady(), visible: document.visibilityState === 'visible', battery: battery?.level ?? null, charging: battery?.charging ?? null, screen }),
      }).then((r) => r.json()).then((r) => onBeatRef.current?.(r)).catch(() => undefined);
    };
    beat();
    wake();
    const i = setInterval(beat, screen === 'lock' ? 10_000 : 30_000);
    const v = () => { beat(); wake(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', v); lock?.release().catch(() => undefined); };
  }, [screen]);
  return null;
}
