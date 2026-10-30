'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, KeyRound, Mail, Smartphone, UserPlus } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/ui/api';
import { useI18n, useProduct } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { CloverAppBadges } from '@/components/clover-app-badges';
import type { CloverAppListing } from '@/lib/foodhub/clover-apps';

type Step = 'start' | 'code' | 'recovery' | 'setup';
type Sent = { challengeId: string; channel: 'email' | 'sms'; sentTo: string; devCode?: string };
/** Why the Google round trip came back to /login (app/api/auth/google/callback). */
export type GoogleNotice = 'not_on_team' | 'unverified' | 'off' | 'state' | 'google' | 'locked' | 'disabled';

export function LoginView({ next, error, firstRun, recovery, needsKey, googleEnabled = false, google = null, cloverApps = [] }: {
  next: string; error: string | null; firstRun: boolean; recovery: boolean; needsKey: boolean; googleEnabled?: boolean; google?: GoogleNotice | null; cloverApps?: readonly CloverAppListing[];
}) {
  const { t, lang, setLang } = useI18n();
  const product = useProduct();
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
  const googleHref = `/api/auth/google/start?next=${encodeURIComponent(next)}&lang=${lang}`;
  const back = (to: Step) => <button type="button" onClick={() => { setStep(to); setErr(null); }} className="mb-6 flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t('Retour', 'Back')}</button>;

  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_80%_at_50%_0%,var(--color-brand-soft),transparent)]" aria-hidden />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-lg bg-rail text-base font-black text-white">T</span><span className="text-[15px] font-extrabold tracking-tight">{product.fullName}</span></span>
        <button type="button" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} className="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-[13px] font-bold text-ink-3 hover:bg-sunken hover:text-ink"><Globe className="size-4" />{lang === 'fr' ? 'English' : 'Français'}</button>
      </header>

      <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-8 sm:px-0">
        {step === 'start' && (
          <div className="animate-rise">
            <h1 className="text-3xl font-extrabold tracking-tight">{t('Connexion', 'Sign in')}</h1>
            <p className="mt-2 text-ink-3">{t(`Bienvenue dans ${product.name}. Pas de mot de passe à retenir.`, `Welcome to ${product.name}. No password to remember.`)}</p>

            {google === 'not_on_team' && (
              <div className="mt-6 rounded-lg border border-line-2 bg-surface p-4" role="status">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand"><UserPlus className="size-5" /></span>
                  <div>
                    <div className="font-bold">{t('Ce compte Google n’est pas encore dans une équipe Food Hub.', 'This Google account is not on a Food Hub team yet.')}</div>
                    <p className="mt-1 text-[13px] text-ink-3">{t('Demandez à votre gérant de vous inviter avec cette adresse (Réglages → Équipe), puis réessayez. Vous pouvez aussi entrer avec le courriel ou le cellulaire déjà inscrit.', 'Ask your manager to invite you with this address (Settings → Team), then try again. You can also sign in with the email or cell number already on file.')}</p>
                  </div>
                </div>
              </div>
            )}
            {google && google !== 'not_on_team' && !err && (
              <Banner tone={google === 'locked' ? 'stop' : 'info'} className="mt-6">
                {google === 'off' || google === 'disabled' ? t('La connexion Google n’est pas activée ici. Entrez avec votre courriel ou votre cellulaire.', 'Google sign-in is not enabled here. Sign in with your email or cell number.')
                  : google === 'unverified' ? t('Ce compte Google n’a pas de courriel vérifié. Entrez avec votre courriel ou votre cellulaire.', 'This Google account has no verified email. Sign in with your email or cell number.')
                  : google === 'locked' ? t('Trop d’essais. Attendez une minute, puis réessayez.', 'Too many tries. Wait a minute, then try again.')
                  : t('La connexion Google n’a pas abouti. Réessayez ou entrez avec votre courriel.', 'The Google sign-in did not go through. Try again or sign in with your email.')}
              </Banner>
            )}
            {err && <Banner tone="stop" className="mt-6">{err}</Banner>}

            {googleEnabled && (
              <>
                <a href={googleHref} className={buttonClass('primary', 'xl', 'mt-8 w-full text-base')} data-testid="google-signin">
                  <GoogleMark />{t('Continuer avec Google', 'Continue with Google')}
                </a>
                <div className="my-6 flex items-center gap-3 text-xs font-semibold tracking-wide text-ink-3 uppercase" aria-hidden><span className="h-px flex-1 bg-line" />{t('ou par code', 'or with a code')}<span className="h-px flex-1 bg-line" /></div>
              </>
            )}

            <form onSubmit={(e) => { e.preventDefault(); start(); }} className={googleEnabled ? '' : 'mt-8'}>
              <Field label={t('Courriel ou cellulaire', 'Email or cell number')} hint={t('On vous envoie un code à 6 chiffres.', 'We send you a 6-digit code.')}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">{isPhone ? <Smartphone className="size-5" /> : <Mail className="size-5" />}</span>
                  <Input inputSize="lg" className="pl-11" autoFocus={!googleEnabled} autoComplete="username" inputMode={isPhone ? 'tel' : 'email'} placeholder="vous@takatak.ca · 514 555-0123" value={contact} onChange={(e) => setContact(e.target.value)} required />
                </div>
              </Field>
              <Button type="submit" variant={googleEnabled ? 'outline' : 'primary'} size="lg" className="mt-3 w-full" loading={busy} disabled={contact.trim().length < 5}>{t('Recevoir mon code', 'Send me a code')}<ArrowRight className="size-4" /></Button>
            </form>
            {recovery && <button type="button" onClick={() => { setErr(null); setStep('recovery'); }} className="mx-auto mt-8 flex min-h-11 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-ink-3 hover:text-ink"><KeyRound className="size-3.5" />{t('Connexion de secours du propriétaire', 'Owner recovery sign-in')}</button>}
          </div>
        )}

        {step === 'code' && sent && (
          <div className="animate-rise">
            {back(firstRun ? 'setup' : 'start')}
            <h1 className="text-3xl font-extrabold tracking-tight">{t('Entrez le code', 'Enter the code')}</h1>
            <p className="mt-2 text-ink-3">{sent.channel === 'sms' ? t('Envoyé par texto à', 'Texted to') : t('Envoyé par courriel à', 'Emailed to')} <strong className="text-ink">{sent.sentTo}</strong>. {t('Vous pouvez aussi toucher le lien reçu.', 'You can also tap the link you got.')}</p>
            <CodeInput onDone={verify} busy={busy} error={Boolean(err)} />
            {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
            {sent.devCode && (
              <Banner tone="info" className="mt-3" action={<Button size="xs" variant="outline" onClick={() => verify(sent.devCode!)}>{t('Utiliser', 'Use')}</Button>}>
                {t('Mode développement — courriel/texto non configuré. Code :', 'Development mode — email/SMS not set up. Code:')} <strong className="num">{sent.devCode}</strong>
              </Banner>
            )}
            <div className="mt-6 flex items-center justify-between text-[13px]">
              <button type="button" disabled={resendIn > 0 || busy} onClick={() => start(contact)} className="min-h-11 font-semibold text-ink disabled:text-ink-4">{resendIn > 0 ? t(`Renvoyer dans ${resendIn} s`, `Resend in ${resendIn}s`) : t('Renvoyer le code', 'Resend the code')}</button>
              <span className="text-ink-3">{t('Expire dans 10 min', 'Expires in 10 min')}</span>
            </div>
          </div>
        )}

        {step === 'recovery' && (
          <form onSubmit={(e) => { e.preventDefault(); recover(); }} className="animate-rise">
            {back('start')}
            <h1 className="text-3xl font-extrabold tracking-tight">{t('Connexion de secours', 'Recovery sign-in')}</h1>
            <p className="mt-2 text-ink-3">{t('Mot de passe du propriétaire (DASHBOARD_PASSWORD). À utiliser seulement si le courriel, le texto ou Google ne fonctionne pas.', 'Owner password (DASHBOARD_PASSWORD). Only if email, SMS or Google does not work.')}</p>
            <Field label={t('Mot de passe', 'Password')} className="mt-8"><Input inputSize="lg" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
            <Button type="submit" size="lg" className="mt-4 w-full" loading={busy} disabled={!password}>{t('Entrer', 'Sign in')}</Button>
          </form>
        )}

        {step === 'setup' && (
          <form onSubmit={(e) => { e.preventDefault(); createOwner(); }} className="animate-rise">
            <div className="mb-2 text-xs font-bold tracking-[0.12em] text-brand uppercase">{t('Première ouverture', 'First run')}</div>
            <h1 className="text-3xl font-extrabold tracking-tight">{t('Créer le compte propriétaire', 'Create the owner account')}</h1>
            <p className="mt-2 text-ink-3">{t('Ensuite, vous ajouterez vos gérants et employés en 10 secondes chacun.', 'Then you add managers and staff in 10 seconds each.')}</p>
            <div className="mt-8 space-y-4">
              <Field label={t('Votre nom', 'Your name')}><Input inputSize="lg" autoFocus autoComplete="name" value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
              <Field label={t('Courriel ou cellulaire', 'Email or cell number')} hint={t('Pour recevoir vos codes de connexion et les alertes.', 'For your sign-in codes and alerts.')}><Input inputSize="lg" autoComplete="email" value={setup.contact} onChange={(e) => setSetup({ ...setup, contact: e.target.value })} /></Field>
              {needsKey && <Field label={t('Clé de configuration', 'Setup key')} hint={t('La valeur de DASHBOARD_PASSWORD sur le serveur.', 'The DASHBOARD_PASSWORD value on the server.')}><Input inputSize="lg" type="password" value={setup.setupKey} onChange={(e) => setSetup({ ...setup, setupKey: e.target.value })} /></Field>}
            </div>
            {err && <Banner tone="stop" className="mt-3">{err}</Banner>}
            <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={!setup.name.trim() || setup.contact.trim().length < 5}>{t('Créer et recevoir mon code', 'Create and send my code')}<ArrowRight className="size-4" /></Button>
            {recovery && <button type="button" onClick={() => setStep('recovery')} className="mx-auto mt-8 flex min-h-11 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-ink-3 hover:text-ink"><KeyRound className="size-3.5" />{t('Connexion de secours du propriétaire', 'Owner recovery sign-in')}</button>}
          </form>
        )}
      </main>

      <footer className="relative mx-auto w-full max-w-md px-5 pb-6">
        <p className="text-center text-xs text-ink-3">{t('Tablette de cuisine ? Un gérant l’enregistre une fois dans Réglages → Tablettes, puis l’équipe entre avec son NIP.', 'Kitchen tablet? A manager enrols it once in Settings → Tablets, then the team unlocks it with their PIN.')}</p>
        <CloverAppBadges apps={cloverApps} lang={lang} variant="compact" className="mt-4 justify-center" />
      </footer>
    </div>
  );
}

/** Google's "G", as the sign-in branding guidelines draw it. */
function GoogleMark() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white" aria-hidden>
      <svg viewBox="0 0 18 18" className="size-[18px]">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
      </svg>
    </span>
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
