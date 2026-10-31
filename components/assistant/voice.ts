'use client';

// Voice input with the browser's Web Speech API (Chrome, Edge, Safari): French (Canada) by default, English on demand.
// Where the browser has no speech recognition the mic button is not shown and typing stays the way in.
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceLang = 'fr-CA' | 'en-CA';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput(opts: { onText: (text: string, final: boolean) => void }) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onText = useRef(opts.onText);
  useEffect(() => { onText.current = opts.onText; });
  useEffect(() => { setSupported(Boolean(recognitionCtor())); return () => rec.current?.abort(); }, []);

  const start = useCallback((lang: VoiceLang) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let text = ''; let final = false;
      for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript; if (e.results[i].isFinal) final = true; }
      onText.current(text.trim(), final);
    };
    r.onerror = (e) => { setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'silence' : 'error'); setRecording(false); };
    r.onend = () => setRecording(false);
    rec.current = r;
    setError(null);
    try { r.start(); setRecording(true); } catch { setRecording(false); setError('error'); }
  }, []);

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  return { supported, recording, error, start, stop };
}
