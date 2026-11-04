'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import type { Lang } from '@/lib/foodhub/pricing';
import { LEAD_LIMITS, LEAD_PLATFORMS, LEAD_PROVINCES } from '@/lib/foodhub/restaurant-lead-fields';
import { publicSupportHref } from '@/lib/foodhub/public-support';
import shared from './restaurant-landing.module.css';
import styles from './restaurant-contact.module.css';

const REQUEST_KEY = 'foodhub-contact-request-v1';
const FIELD_NAMES = ['restaurant', 'contact', 'email', 'phone', 'city', 'province', 'brands', 'website', 'message'] as const;
const LABELS = {
  fr: { restaurant: 'Nom du restaurant', contact: 'Votre nom', email: 'Courriel', phone: 'Téléphone', city: 'Ville', province: 'Province ou territoire', brands: 'Nombre de marques', website: 'Site web', message: 'Votre projet', channels: 'Vos canaux actuels ou souhaités', optional: 'facultatif', required: 'Les champs marqués d’un astérisque sont requis. Canada seulement.', submit: 'Envoyer ma demande', sending: 'Envoi en cours…', retry: 'Vérifier ma demande', invalid: 'Vérifiez les champs indiqués.', fieldError: 'Vérifiez ce champ.', waiting: 'Patientez avant de réessayer.', unknown: 'Nous ne pouvons pas encore confirmer votre demande. Gardez cette page ouverte et vérifiez-la avec le même bouton, ou écrivez-nous avant d’envoyer une autre demande.', accepted: 'Votre demande est reçue.', acceptedText: 'Elle est enregistrée dans Food Hub. Notre équipe pourra vous contacter pour préparer les prochaines étapes.', permission: 'En envoyant ce formulaire, vous demandez à être contacté au sujet de votre restaurant. Vous ne vous inscrivez pas à des messages promotionnels.', privacy: 'Confidentialité', emailLink: 'Nous écrire', select: 'Choisir', noScript: 'Pour transmettre votre demande, écrivez-nous à l’adresse indiquée.', direct: 'Commande en ligne directe', phoneChannel: 'Commandes par téléphone' },
  en: { restaurant: 'Restaurant name', contact: 'Your name', email: 'Email', phone: 'Phone', city: 'City', province: 'Province or territory', brands: 'Number of brands', website: 'Website', message: 'Your plans', channels: 'Your current or planned channels', optional: 'optional', required: 'Fields marked with an asterisk are required. Canada only.', submit: 'Send my request', sending: 'Sending…', retry: 'Check my request', invalid: 'Check the highlighted fields.', fieldError: 'Check this field.', waiting: 'Please wait before trying again.', unknown: 'We cannot confirm your request yet. Keep this page open and check it with the same button, or email us before sending another request.', accepted: 'Your request has been received.', acceptedText: 'It is saved in Food Hub. Our team can contact you to prepare the next steps.', permission: 'By sending this form, you ask us to contact you about your restaurant. This does not subscribe you to promotional messages.', privacy: 'Privacy', emailLink: 'Email us', select: 'Choose', noScript: 'To send your request, email us at the address provided.', direct: 'Direct online ordering', phoneChannel: 'Phone orders' },
};

function requestKey(): string {
  try { const existing = sessionStorage.getItem(REQUEST_KEY); if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing; } catch { /* in-memory recovery still works */ }
  const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(REQUEST_KEY, key); } catch { /* no contact data is persisted */ }
  return key;
}

export function RestaurantContactForm({ lang, supportEmail, interest }: { lang: Lang; supportEmail: string; interest?: 'phone' }) {
  const w = LABELS[lang];
  const [phase, setPhase] = useState<'idle' | 'sending' | 'uncertain' | 'accepted'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [ready, setReady] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const flight = useRef(false);
  const pending = useRef<{ raw: string; key: string } | null>(null);
  const live = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { live.current = true; setReady(true); return () => { live.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!retryAt) return; const timer = setTimeout(() => { setRetryAt(0); setNotice(''); }, Math.max(0, retryAt - Date.now())); return () => clearTimeout(timer); }, [retryAt]);
  useEffect(() => { const first = FIELD_NAMES.find((name) => errors[name]); if (first) form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); }, [errors]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current || retryAt > Date.now()) return;
    if (!pending.current) {
      const data = new FormData(event.currentTarget);
      const body: Record<string, unknown> = { lang, source: 'foodhub', company: String(data.get('company') ?? ''), platforms: data.getAll('platforms') };
      for (const name of FIELD_NAMES) body[name] = String(data.get(name) ?? '');
      pending.current = { raw: JSON.stringify(body), key: requestKey() };
    }
    const attempt = pending.current;
    flight.current = true; setPhase('sending'); setNotice(''); setErrors({});
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 25_000);
    try {
      const response = await fetch('/api/public/restaurant-leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key }, body: attempt.raw, signal: abort.signal, credentials: 'omit', redirect: 'error' });
      const result = await response.json().catch(() => null);
      if (!live.current) return;
      if (response.status === 202 && result?.ok === true) {
        setPhase('accepted');
        try { if (sessionStorage.getItem(REQUEST_KEY) === attempt.key) sessionStorage.removeItem(REQUEST_KEY); } catch { /* nothing sensitive was saved */ }
        return;
      }
      if (response.status === 400 && result?.errors && typeof result.errors === 'object') {
        pending.current = null; setPhase('idle'); setErrors(result.errors); setNotice(w.invalid); return;
      }
      if (response.status === 429) {
        pending.current = null; setPhase('idle'); setNotice(w.waiting);
        const seconds = Number(response.headers.get('retry-after')); setRetryAt(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) * 1000); return;
      }
      setPhase('uncertain'); setNotice(w.unknown);
    } catch { if (live.current) { setPhase('uncertain'); setNotice(w.unknown); } }
    finally { clearTimeout(timer); flight.current = false; if (controller.current === abort) controller.current = null; }
  }

  if (phase === 'accepted') return <div className={styles.accepted} role="status"><Check size={28} aria-hidden /><h3>{w.accepted}</h3><p>{w.acceptedText}</p><a href={publicSupportHref(supportEmail)}>{supportEmail}</a></div>;
  const field = (name: Exclude<(typeof FIELD_NAMES)[number], 'province' | 'message'>, required = false, type = 'text', autoComplete?: string) => <label className={styles.field} key={name} htmlFor={`enquiry-${name}`}><span>{w[name]}{required ? ' *' : ` · ${w.optional}`}</span><input id={`enquiry-${name}`} name={name} type={type} autoComplete={autoComplete} required={required} maxLength={name in LEAD_LIMITS ? LEAD_LIMITS[name as keyof typeof LEAD_LIMITS] : undefined} min={name === 'brands' ? 1 : undefined} max={name === 'brands' ? 50 : undefined} minLength={required && ['restaurant', 'contact', 'city'].includes(name) ? 2 : undefined} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `enquiry-${name}-error` : undefined} />{errors[name] && <small className={styles.fieldError} id={`enquiry-${name}-error`}>{w.fieldError}</small>}</label>;
  return <form ref={form} onSubmit={submit} action="/api/public/restaurant-leads" method="post" aria-label={lang === 'fr' ? 'Demande pour mon restaurant' : 'Restaurant enquiry'}>
    <p className={styles.required}>{w.required}</p>
    {notice && <div className={styles.notice} role="alert">{notice}</div>}
    <fieldset className={styles.fields} aria-label={lang === 'fr' ? 'Coordonnées du restaurant' : 'Restaurant contact details'} disabled={!ready || phase === 'sending' || phase === 'uncertain'}>
      {field('restaurant', true, 'text', 'organization')}{field('contact', true, 'text', 'name')}{field('email', true, 'email', 'email')}{field('phone', true, 'tel', 'tel')}{field('city', true, 'text', 'address-level2')}
      <label className={styles.field} htmlFor="enquiry-province"><span>{w.province} · {w.optional}</span><select id="enquiry-province" name="province" autoComplete="address-level1" aria-invalid={Boolean(errors.province)} aria-describedby={errors.province ? 'enquiry-province-error' : undefined}><option value="">{w.select}</option>{LEAD_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}</select>{errors.province && <small className={styles.fieldError} id="enquiry-province-error">{w.fieldError}</small>}</label>
      {field('brands', false, 'number')}{field('website', false, 'text', 'url')}
      <fieldset className={styles.channels}><legend>{w.channels} · {w.optional}</legend>{LEAD_PLATFORMS.filter((channel) => channel !== 'tgtg').map((channel) => <label key={channel}><input type="checkbox" name="platforms" value={channel} defaultChecked={interest === 'phone' && channel === 'phone'} /><span>{({ uber: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', direct: w.direct, phone: w.phoneChannel } as Record<string, string>)[channel]}</span></label>)}</fieldset>
      <label className={`${styles.field} ${styles.message}`} htmlFor="enquiry-message"><span>{w.message} · {w.optional}</span><textarea id="enquiry-message" name="message" rows={5} maxLength={LEAD_LIMITS.message} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'enquiry-message-error' : undefined} />{errors.message && <small className={styles.fieldError} id="enquiry-message-error">{w.fieldError}</small>}</label>
      <div className={styles.honeypot} aria-hidden="true"><label htmlFor="enquiry-company">Company<input id="enquiry-company" name="company" tabIndex={-1} autoComplete="off" /></label></div>
    </fieldset>
    <p className={styles.permission}>{w.permission} <a href="/legal/privacy">{w.privacy}</a>.</p>
    <div className={styles.submit}><button type="submit" disabled={!ready || phase === 'sending' || Boolean(retryAt)} className={shared.primary}>{phase === 'sending' ? w.sending : phase === 'uncertain' ? w.retry : w.submit}<ArrowUpRight size={18} aria-hidden /></button><a href={publicSupportHref(supportEmail)}>{w.emailLink}</a></div>
    <noscript><p>{w.noScript} <a href={publicSupportHref(supportEmail)}>{supportEmail}</a></p></noscript>
  </form>;
}
