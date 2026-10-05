'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, BellRing, Lock } from 'lucide-react';
import { PinPad } from '@/components/ui/pin-pad';
import { DeviceHeartbeat } from '@/components/live/device-heartbeat';
import { useNow } from '@/components/ui/timer';
import { loopSound, unlockAudio } from '@/lib/ui/sound';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Person = { username: string; name: string; role: string };
type Info = { device: { id: string; name: string; locationCode: string }; people: Person[]; locked: number };

/** Kitchen tablet lock screen: tap your name, type your PIN. Beeps when orders wait. */
export function KitchenLock({ next }: { next: string }) {
  const { t, lang, setLang, loc } = useI18n();
  const now = useNow(1000);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notDevice, setNotDevice] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [cancelled, setCancelled] = useState(0);

  const load = useCallback(() => api<Info>('/api/foodhub/auth/pin').then((d) => { setInfo(d); setErr(null); }).catch((e) => { if (e.status === 403) setNotDevice(true); else setErr(e.message); }), []);
  useEffect(() => { load(); const i = setInterval(load, 60_000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    if (!waiting && !cancelled) return;
    const stop = loopSound(cancelled ? 'cancel' : 'order', 3500);
    return stop;
  }, [waiting, cancelled]);

  async function unlock(pin: string) {
    if (!who) return;
    setBusy(true); setPinErr(null);
    try { await api('/api/foodhub/auth/pin', { method: 'POST', json: { username: who.username, pin } }); window.location.href = next; }
    catch (e) { setPinErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  const time = new Date(now).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const date = new Date(now).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="theme-kitchen flex min-h-dvh flex-col bg-canvas text-ink" onPointerDown={() => unlockAudio()}>
      <DeviceHeartbeat screen="lock" onBeat={(r) => { setWaiting(r.waiting ?? 0); setCancelled(r.cancelled ?? 0); }} />
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-md bg-brand text-base font-black text-white">T</span><span className="font-extrabold tracking-[0.14em]">TAKATAK</span></div>
        <div className="text-right">
          <div className="num text-3xl font-extrabold">{time}</div>
          <div className="text-sm text-ink-3 capitalize">{date}</div>
        </div>
      </header>

      {cancelled > 0 && (
        <div className="mx-6 mb-3 flex items-center justify-center gap-3 rounded-xl bg-stop px-5 py-4 text-lg font-extrabold text-white animate-pulse-soft">
          <Ban className="size-6" />{t(`${cancelled} commande(s) ANNULÉE(S) — entrez votre NIP pour voir laquelle`, `${cancelled} order(s) CANCELLED — enter your PIN to see which`)}
        </div>
      )}
      {waiting > 0 && (
        <div className="mx-6 flex items-center justify-center gap-3 rounded-xl bg-brand px-5 py-4 text-lg font-extrabold text-white animate-pulse-soft">
          <BellRing className="size-6" />{t(`${waiting} commande(s) attendent — entrez votre NIP`, `${waiting} order(s) waiting — enter your PIN`)}
        </div>
      )}

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
        {notDevice && (
          <div className="max-w-md text-center">
            <Lock className="mx-auto mb-4 size-10 text-ink-3" />
            <h1 className="text-2xl font-extrabold">{t('Cet écran n’est pas une tablette de cuisine', 'This screen is not a kitchen tablet')}</h1>
            <p className="mt-2 text-ink-3">{t('Un gérant peut l’enregistrer dans Réglages → Tablettes.', 'A manager can enrol it in Settings → Tablets.')}</p>
            <a href="/login" className="mt-6 inline-flex h-12 items-center rounded-md bg-ink px-6 font-bold text-canvas">{t('Se connecter', 'Sign in')}</a>
          </div>
        )}
        {err && <div className="text-stop">{err}</div>}
        {info && !who && (
          <div className="w-full max-w-3xl animate-rise">
            <div className="mb-1 text-center text-sm font-bold tracking-[0.14em] text-brand uppercase">{info.device.name}</div>
            <h1 className="mb-8 text-center text-3xl font-extrabold">{t('Qui commence ?', 'Who is starting?')}</h1>
            <div className="flex flex-wrap justify-center gap-3">
              {info.people.map((p) => (
                <button key={p.username} type="button" onClick={() => { setWho(p); setPinErr(null); }} className="flex w-[calc(50%-0.375rem)] flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-ink-4 active:scale-[0.98] sm:w-40">
                  <span className="flex size-16 items-center justify-center rounded-full bg-raised text-xl font-extrabold">{p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                  <span className="text-center text-base font-bold leading-tight">{p.name}</span>
                </button>
              ))}
              {info.people.length === 0 && <p className="w-full text-center text-ink-3">{t('Personne n’a encore de NIP pour cette succursale. Ajoutez des NIP dans Réglages → Équipe.', 'Nobody has a PIN for this location yet. Add PINs in Settings → Team.')}</p>}
            </div>
          </div>
        )}
        {info && who && (
          <div className="w-full max-w-sm animate-rise">
            <button type="button" onClick={() => setWho(null)} className="mb-6 flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t('Changer de personne', 'Someone else')}</button>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-raised text-xl font-extrabold">{who.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div className="text-2xl font-extrabold">{who.name}</div>
              <div className="text-sm text-ink-3">{t('Entrez votre NIP', 'Enter your PIN')}</div>
            </div>
            <PinPad dark onDone={unlock} busy={busy} error={pinErr} />
          </div>
        )}
      </main>
      <footer className={cn('flex items-center justify-between px-6 py-4 text-sm text-ink-3')}>
        <span>{info ? info.device.locationCode : ''}</span>
        <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="font-bold hover:text-ink">{lang === 'fr' ? 'English' : 'Français'}</button>
      </footer>
    </div>
  );
}
