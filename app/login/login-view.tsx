'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BellRing, ChefHat, Globe, KeyRound, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';

type Step = 'start' | 'code' | 'recovery' | 'setup';
type Sent = { challengeId: string; channel: 'email' | 'sms'; sentTo: string; devCode?: string };

export function LoginView({ next, error, firstRun, recovery, needsKey }: { next: string; error: string | null; firstRun: boolean; recovery: boolean; needsKey: boolean }) {
  const { t, lang, setLang } = useI18n();
  const [step, setStep] = useState<Step>(firstRun ? 'setup' : 'start');
  const [contact, setContact] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  const [resendIn, setResendIn] = useState(0);
  const [setup, setSetup] = useState({ name: '', contact: '', setupKey: '' });
  const [password, setPassword] = useState('');

  useEffect(() => { if (resendIn <= 0) return; const i = setTimeout(() => setResendIn((s) => s - 1), 1000); return () => clearTimeout(i); }, [resendIn]);

  const start = useCallback(async (c = contact) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<Sent>('/api/foodhub/auth/start', { method: 'POST', json: { contact: c, next, lang } });
      setSent(r); setStep('code'); setResendIn(30);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [contact, next, lang]);

  const verify = useCallback(async (code: string) => {
    if (!sent) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ next: string }>('/api/foodhub/auth/verify', { method: 'POST', json: { challengeId: sent.challengeId, code } });
      window.location.href = r.next || next;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }, [sent, next]);

  async function createOwner() {
    setBusy(true); setErr(null);
    const isEmail = setup.contact.includes('@');
    try {
      const r = await api<Sent>('/api/foodhub/auth/setup', { method: 'POST', json: { name: setup.name, email: isEmail ? setup.contact : undefined, phone: isEmail ? undefined : setup.contact, setupKey: setup.setupKey, lang } });
      setSent(r); setContact(setup.contact); setStep('code'); setResendIn(30);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function recover() {
    setBusy(true); setErr(null);
    try { await api('/api/foodhub/auth/login', { method: 'POST', json: { username: 'owner', password } }); window.location.href = next; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  const isPhone = /^[\d\s()+.-]{7,}$/.test(contact.trim());

  return (
    <div className="grid grid-cols-1 min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-rail p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5"><span className="flex size-10 items-center justify-center rounded-lg bg-brand text-lg font-black">T</span><span className="text-lg font-extrabold tracking-[0.16em]">TAKATAK</span></div>
        <div className="mt-auto max-w-md">
          <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-tight">{t('Toutes vos plateformes.', 'Every platform.')}<br /><span className="text-brand">{t('Un seul écran.', 'One screen.')}</span></h1>
          <p className="mt-4 text-white/60">{t('Uber Eats, DoorDash, SkipTheDishes, Too Good To Go et Clover — en direct, sans agrégateur.', 'Uber Eats, DoorDash, SkipTheDishes, Too Good To Go and Clover — live, no aggregator.')}</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            <li className="flex items-center gap-3"><ChefHat className="size-5 text-brand" />{t('Une commande sonne, un geste pour accepter.', 'An order rings, one tap to accept.')}</li>
            <li className="flex items-center gap-3"><ShieldCheck className="size-5 text-brand" />{t('NIP gérant pour tout ce qui touche l’argent.', 'Manager PIN for anything that touches money.')}</li>
            <li className="flex items-center gap-3"><BellRing className="size-5 text-brand" />{t('Une tablette s’éteint ? Vous êtes prévenu.', 'A tablet goes off? You get alerted.')}</li>
          </ul>
        </div>
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-brand/20 blur-3xl" />
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 lg:invisible"><span className="flex size-8 items-center justify-center rounded-md bg-brand text-sm font-black text-white">T</span><span className="font-extrabold tracking-[0.14em]">TAKATAK</span></span>
          <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-bold text-ink-3 hover:bg-sunken"><Globe className="size-4" />{lang === 'fr' ? 'English' : 'Français'}</button>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {step === 'start' && (
            <form onSubmit={(e) => { e.preventDefault(); start(); }} className="animate-rise">
              <h2 className="text-3xl font-extrabold tracking-tight">{t('Connexion', 'Sign in')}</h2>
              <p className="mt-2 text-ink-3">{t('Pas de mot de passe. On vous envoie un code.', 'No password. We send you a code.')}</p>
              <Field label={t('Courriel ou cellulaire', 'Email or cell number')} className="mt-8">
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">{isPhone ? <Smartphone className="size-5" /> : <Mail className="size-5" />}</span>
                  <Input inputSize="lg" className="pl-11" autoFocus autoComplete="username" inputMode={isPhone ? 'tel' : 'email'} placeholder="vous@takatak.ca · 514 555-0123" value={contact} onChange={(e) => setContact(e.target.value)} required />
                </div>
              </Field>
              {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
              <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" loading={busy} disabled={contact.trim().length < 5}>{t('Recevoir mon code', 'Send me a code')}<ArrowRight className="size-4" /></Button>
              {recovery && <button type="button" onClick={() => { setErr(null); setStep('recovery'); }} className="mt-6 flex w-full items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><KeyRound className="size-4" />{t('Connexion de secours du propriétaire', 'Owner recovery sign-in')}</button>}
            </form>
          )}

          {step === 'code' && sent && (
            <div className="animate-rise">
              <button type="button" onClick={() => { setStep(firstRun ? 'setup' : 'start'); setErr(null); }} className="mb-6 flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t('Retour', 'Back')}</button>
              <h2 className="text-3xl font-extrabold tracking-tight">{t('Entrez le code', 'Enter the code')}</h2>
              <p className="mt-2 text-ink-3">{sent.channel === 'sms' ? t('Envoyé par texto à', 'Texted to') : t('Envoyé par courriel à', 'Emailed to')} <strong className="text-ink">{sent.sentTo}</strong>. {t('Vous pouvez aussi toucher le lien reçu.', 'You can also tap the link you got.')}</p>
              <CodeInput onDone={verify} busy={busy} error={Boolean(err)} />
              {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
              {sent.devCode && (
                <Banner tone="info" className="mt-3" action={<Button size="xs" variant="outline" onClick={() => verify(sent.devCode!)}>{t('Utiliser', 'Use')}</Button>}>
                  {t('Mode développement — courriel/texto non configuré. Code :', 'Development mode — email/SMS not set up. Code:')} <strong className="num">{sent.devCode}</strong>
                </Banner>
              )}
              <div className="mt-6 flex items-center justify-between text-[13px]">
                <button type="button" disabled={resendIn > 0 || busy} onClick={() => start(contact)} className="font-semibold text-ink disabled:text-ink-4">{resendIn > 0 ? t(`Renvoyer dans ${resendIn} s`, `Resend in ${resendIn}s`) : t('Renvoyer le code', 'Resend the code')}</button>
                <span className="text-ink-3">{t('Expire dans 10 min', 'Expires in 10 min')}</span>
              </div>
            </div>
          )}

          {step === 'recovery' && (
            <form onSubmit={(e) => { e.preventDefault(); recover(); }} className="animate-rise">
              <button type="button" onClick={() => { setStep('start'); setErr(null); }} className="mb-6 flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t('Retour', 'Back')}</button>
              <h2 className="text-3xl font-extrabold tracking-tight">{t('Connexion de secours', 'Recovery sign-in')}</h2>
              <p className="mt-2 text-ink-3">{t('Mot de passe du propriétaire (DASHBOARD_PASSWORD). À utiliser seulement si le courriel ou le texto ne fonctionne pas.', 'Owner password (DASHBOARD_PASSWORD). Only if email or SMS does not work.')}</p>
              <Field label={t('Mot de passe', 'Password')} className="mt-8"><Input inputSize="lg" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
              <Button type="submit" size="lg" className="mt-4 w-full" loading={busy} disabled={!password}>{t('Entrer', 'Sign in')}</Button>
            </form>
          )}

          {step === 'setup' && (
            <form onSubmit={(e) => { e.preventDefault(); createOwner(); }} className="animate-rise">
              <div className="mb-2 text-xs font-bold tracking-[0.12em] text-brand uppercase">{t('Première ouverture', 'First run')}</div>
              <h2 className="text-3xl font-extrabold tracking-tight">{t('Créer le compte propriétaire', 'Create the owner account')}</h2>
              <p className="mt-2 text-ink-3">{t('Ensuite, vous ajouterez vos gérants et employés en 10 secondes chacun.', 'Then you add managers and staff in 10 seconds each.')}</p>
              <div className="mt-8 space-y-4">
                <Field label={t('Votre nom', 'Your name')}><Input inputSize="lg" autoFocus autoComplete="name" value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
                <Field label={t('Courriel ou cellulaire', 'Email or cell number')} hint={t('Pour recevoir vos codes de connexion et les alertes.', 'For your sign-in codes and alerts.')}><Input inputSize="lg" autoComplete="email" value={setup.contact} onChange={(e) => setSetup({ ...setup, contact: e.target.value })} /></Field>
                {needsKey && <Field label={t('Clé de configuration', 'Setup key')} hint={t('La valeur de DASHBOARD_PASSWORD dans Vercel.', 'The DASHBOARD_PASSWORD value in Vercel.')}><Input inputSize="lg" type="password" value={setup.setupKey} onChange={(e) => setSetup({ ...setup, setupKey: e.target.value })} /></Field>}
              </div>
              {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
              <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={!setup.name.trim() || setup.contact.trim().length < 5}>{t('Créer et recevoir mon code', 'Create and send my code')}<ArrowRight className="size-4" /></Button>
              {recovery && <button type="button" onClick={() => setStep('recovery')} className="mt-6 flex w-full items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><KeyRound className="size-4" />{t('Connexion de secours du propriétaire', 'Owner recovery sign-in')}</button>}
            </form>
          )}
        </div>
        <p className="text-center text-xs text-ink-4">{t('Tablette de cuisine ? Un gérant l’enregistre une fois dans Réglages → Tablettes, puis l’équipe entre avec son NIP.', 'Kitchen tablet? A manager enrols it once in Settings → Tablets, then the team unlocks it with their PIN.')}</p>
      </main>
    </div>
  );
}

/** Six boxes; paste / SMS autofill friendly; submits by itself on the 6th digit. */
function CodeInput({ onDone, busy, error }: { onDone: (code: string) => void; busy: boolean; error: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  useEffect(() => { if (error) { setDigits(Array(6).fill('')); refs.current[0]?.focus(); } }, [error]);
  // WebOTP: Android Chrome reads the code from the SMS by itself.
  useEffect(() => {
    const ac = new AbortController();
    const otp = (navigator as unknown as { credentials?: { get: (o: unknown) => Promise<{ code?: string } | null> } }).credentials;
    if ('OTPCredential' in window && otp) otp.get({ otp: { transport: ['sms'] }, signal: ac.signal }).then((c) => { if (c?.code && /^\d{6}$/.test(c.code)) { setDigits(c.code.split('')); onDone(c.code); } }).catch(() => undefined);
    return () => ac.abort();
  }, [onDone]);
  const set = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '');
    if (clean.length > 1) {
      const next = [...digits];
      clean.slice(0, 6 - i).split('').forEach((d, k) => { next[i + k] = d; });
      setDigits(next);
      const code = next.join('');
      if (code.length === 6) onDone(code); else refs.current[Math.min(5, i + clean.length)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.join('').length === 6) onDone(next.join(''));
  };
  return (
    <div className="mt-8 flex justify-between gap-2" onPaste={(e) => { const s = e.clipboardData.getData('text').replace(/\D/g, ''); if (s.length >= 6) { e.preventDefault(); set(0, s.slice(0, 6)); } }}>
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} disabled={busy} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1} aria-label={`Chiffre ${i + 1}`}
          onChange={(e) => set(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus(); }}
          className={cn('num h-16 w-full min-w-0 rounded-lg border-2 bg-surface text-center text-3xl font-extrabold outline-none transition-colors focus:border-ink', error ? 'border-stop' : d ? 'border-ink' : 'border-line-2')} />
      ))}
    </div>
  );
}
