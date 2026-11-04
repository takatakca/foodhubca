'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SfLang as Lang } from '@/lib/foodhub/storefront/i18n';
import {
  buildCheckout, CHECKOUT_URL, money, ORDER_TIMEOUT_MS, parseCheckout, parseQuote, QUOTE_URL,
  readPendingCheckout, validateCustomer, writePendingCheckout,
  type Cart, type CheckoutOutcome, type Customer, type PayMode, type PendingCheckout, type PublicMenu, type QuoteView,
} from './checkout-browser';

type Success = Extract<CheckoutOutcome, { ok: true }>;
interface Props {
  cart: Cart; menu: PublicMenu | null; lang: Lang; src: string | null; recovery?: PendingCheckout | null;
  onBack: () => void; onSuccess: (out: Success) => void; onPendingChange: (pending: boolean) => void;
  onRefreshMenu: () => void; onInvalidLine: (line: number | null, error: string) => void;
}

async function post(url: string, body: unknown) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally { window.clearTimeout(timer); }
}

export function CheckoutReview({ cart, menu, lang, src, recovery, onBack, onSuccess, onPendingChange, onRefreshMenu, onInvalidLine }: Props) {
  const fr = lang === 'fr';
  const [customer, setCustomer] = useState<Customer>(() => recovery ? { ...recovery.request.customer, email: recovery.request.customer.email ?? '' } : { name: '', phone: '', email: '' });
  const [pay, setPay] = useState<PayMode>(recovery?.request.pay ?? (menu?.pay.online ? 'online' : 'pickup'));
  const [quote, setQuote] = useState<QuoteView | null>(recovery?.quote ?? null);
  const [pending, setPending] = useState<PendingCheckout | null>(recovery ?? null);
  const pendingRef = useRef<PendingCheckout | null>(recovery ?? null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState('');
  const [updated, setUpdated] = useState(false);
  const [fields, setFields] = useState<Partial<Record<keyof Customer, string>>>({});
  const alert = useRef<HTMLParagraphElement>(null);
  const cartSignature = JSON.stringify(cart);
  useEffect(() => { if (!pendingRef.current) setQuote(null); }, [cartSignature]);

  useEffect(() => {
    if (pendingRef.current) return;
    try {
      const stored = readPendingCheckout(window.sessionStorage, cart.slug);
      if (stored) { pendingRef.current = stored; setPending(stored); setQuote(stored.quote); setCustomer({ ...stored.request.customer, email: stored.request.customer.email ?? '' }); setPay(stored.request.pay); }
    } catch { /* the in-memory request still protects retries while this page remains open */ }
  }, [cart.slug]);
  useEffect(() => onPendingChange(Boolean(pending)), [pending, onPendingChange]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  const remember = (value: PendingCheckout | null) => {
    pendingRef.current = value; setPending(value);
    try { return writePendingCheckout(window.sessionStorage, cart.slug, value); } catch { return false; }
  };
  const failure = (status: number, body: unknown) => parseCheckout(status, body, lang);
  const review = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateCustomer(customer, lang);
    setFields(invalid);
    if (Object.keys(invalid).length || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const result = await post(QUOTE_URL, { ...buildCheckout(cart, customer, lang, pay, { src: src ?? 'site' }), website });
      const next = result.status >= 200 && result.status < 300 ? parseQuote(result.body) : null;
      if (next) { setQuote(next); setUpdated(false); return; }
      const out = failure(result.status, result.body);
      if (!out.ok) {
        if (out.fallback === 'pay_at_pickup' && menu?.pay.atPickup) setPay('pickup');
        if (out.line !== null) { onInvalidLine(out.line, out.error); return; }
        setError(out.error);
        if (out.reason === 'closed' || out.reason === 'paused') onRefreshMenu();
      }
    } catch { setError(fr ? 'Le récapitulatif ne se charge pas. Réessayez : aucune commande n’a été envoyée.' : 'The review could not load. Try again: no order has been sent.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const place = async () => {
    if (!quote || sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    const approved = pendingRef.current ?? { request: buildCheckout(cart, customer, lang, pay, { quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID(), src: src ?? 'site' }), quote };
    const retrying = Boolean(pendingRef.current);
    if (!remember(approved) && !retrying) {
      remember(null);
      setError(fr ? 'Ce navigateur ne peut pas conserver votre demande. Aucune commande n’a été envoyée. Réessayez ou commandez auprès du restaurant.' : 'This browser could not keep your request. No order was sent. Try again or order from the restaurant.');
      sending.current = false; setBusy(false); return;
    }
    try {
      const result = await post(CHECKOUT_URL, approved.request);
      const out = parseCheckout(result.status, result.body, lang);
      if (out.ok) { remember(null); onSuccess(out); return; }
      const refused = Boolean(result.body && typeof result.body === 'object' && (result.body as { ok?: unknown }).ok === false);
      if (!refused || result.status === 429 || result.status >= 500 || out.reason === 'in_progress' || out.reason === 'idempotency_conflict' || out.reason === 'review_required') {
        setError(result.status === 429 ? `${out.error}${out.retryAfterSec ? ` (${out.retryAfterSec} s)` : ''}` : out.reason === 'review_required' ? (fr ? 'Le restaurant doit vérifier cette demande. Communiquez avec lui avant de créer une autre commande.' : 'The restaurant needs to review this request. Contact them before placing another order.') : out.reason === 'in_progress' ? (fr ? 'La confirmation est en cours. Attendez un instant, puis réessayez cette même demande.' : 'Confirmation is in progress. Wait a moment, then retry this same request.') : (fr ? 'La confirmation n’a pas abouti. Réessayez cette même demande avant de créer une autre commande.' : 'Confirmation could not be completed. Retry this same request before placing another order.'));
        return;
      }
      remember(null);
      if (out.reason === 'quote_changed' && out.quote) { setQuote(out.quote); setUpdated(true); setError(fr ? 'Le restaurant a mis à jour le prix. Vérifiez le nouveau total avant de confirmer.' : 'The restaurant has updated the price. Review the new total before confirming.'); return; }
      setQuote(null); setError(out.error);
      if (out.fallback === 'pay_at_pickup' && menu?.pay.atPickup) setPay('pickup');
      if (out.line !== null) { onInvalidLine(out.line, out.error); return; }
      if (out.reason === 'closed' || out.reason === 'paused') onRefreshMenu();
    } catch { setError(fr ? 'La réponse du restaurant n’est pas arrivée. Gardez cette page ouverte et réessayez cette même demande.' : 'The restaurant’s response did not arrive. Keep this page open and retry this same request.'); }
    finally { sending.current = false; setBusy(false); }
  };

  return <div className="grid gap-4 min-w-0 [&_h4]:text-lg [&_h4]:font-extrabold" aria-busy={busy}>
    {error && <p className="rounded-lg bg-[var(--sf-warn-soft)] px-3 py-2 text-sm font-bold text-[var(--sf-warn)]" role="alert" tabIndex={-1} ref={alert}>{error}</p>}
    {pending && <p className="rounded-lg bg-[var(--sf-sunken)] px-3 py-3 text-sm" role="status">{fr ? 'Une demande attend sa confirmation. Vos choix et coordonnées sont conservés pour réessayer sans envoyer une autre commande.' : 'A request is awaiting confirmation. Your choices and contact details are kept so you can retry without sending another order.'}</p>}
    {!quote ? <form className="grid gap-3" onSubmit={review} noValidate>
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
      <h4>{fr ? 'Vos coordonnées' : 'Your details'}</h4>
      <label className="grid gap-1 text-sm font-bold"><span>{fr ? 'Votre nom' : 'Your name'}</span><input className="sf-input" name="name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" maxLength={60} required aria-invalid={Boolean(fields.name)} />{fields.name && <span className="text-xs font-normal text-[var(--sf-warn)]">{fields.name}</span>}</label>
      <label className="grid gap-1 text-sm font-bold"><span>{fr ? 'Cellulaire' : 'Cell number'}</span><input className="sf-input" name="phone" type="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} autoComplete="tel" maxLength={30} required aria-invalid={Boolean(fields.phone)} />{fields.phone && <span className="text-xs font-normal text-[var(--sf-warn)]">{fields.phone}</span>}</label>
      <label className="grid gap-1 text-sm font-bold"><span>{fr ? 'Courriel (facultatif, pour le reçu)' : 'Email (optional, for the receipt)'}</span><input className="sf-input" name="email" type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} autoComplete="email" maxLength={120} aria-invalid={Boolean(fields.email)} />{fields.email && <span className="text-xs font-normal text-[var(--sf-warn)]">{fields.email}</span>}</label>
      <fieldset className="grid gap-1 text-sm font-bold"><legend>{fr ? 'Paiement' : 'Payment'}</legend><div className="grid gap-2">
        {menu?.pay.online && <label className="sf-card flex min-h-12 items-center gap-3 px-3 py-2 text-sm font-bold"><input type="radio" name="pay" checked={pay === 'online'} onChange={() => setPay('online')} />{fr ? 'En ligne avec Clover' : 'Online with Clover'}</label>}
        {menu?.pay.atPickup && <label className="sf-card flex min-h-12 items-center gap-3 px-3 py-2 text-sm font-bold"><input type="radio" name="pay" checked={pay === 'pickup'} onChange={() => setPay('pickup')} />{fr ? 'Au comptoir' : 'At pickup'}</label>}
      </div></fieldset>
      <button type="submit" className="sf-btn sf-accent-bg w-full" disabled={busy || !cart.lines.length || !menu?.state.open || menu.state.paused}>{busy ? (fr ? 'Vérification…' : 'Checking…') : (fr ? 'Vérifier ma commande' : 'Review my order')}</button>
      <p className="text-sm sf-muted">{fr ? 'Le restaurant calcule le total, taxes comprises, avant votre confirmation.' : 'The restaurant calculates the total, including taxes, before you confirm.'}</p>
    </form> : <section className="grid gap-4" aria-labelledby="review-title">
      <h4 id="review-title">{fr ? 'Vérifiez votre commande' : 'Review your order'}</h4>
      <p className="text-sm sf-muted">{fr ? 'À récupérer au restaurant' : 'Pickup at the restaurant'} · {customer.name} · {customer.phone}</p>
      <ul className="grid gap-3 [&>li]:flex [&>li]:justify-between [&>li]:gap-3 [&_small]:block [&_small]:text-sm">{quote.lines.map((line, n) => <li key={`${line.ref}-${n}`}><div><b>{line.qty} × {line.name}</b>{line.options.map((o, i) => <small key={`${o.ref}-${i}`}>{o.qty > 1 ? `${o.qty} × ` : ''}{o.name}</small>)}</div><span>{money(line.total, lang)}</span></li>)}</ul>
      <dl className="grid gap-2 [&>div]:flex [&>div]:justify-between [&>div]:gap-3"><div><dt>{fr ? 'Sous-total' : 'Subtotal'}</dt><dd>{money(quote.subtotal, lang)}</dd></div><div><dt>{quote.taxes.label[lang]} · {quote.taxes.province}</dt><dd>{money(quote.tax, lang)}</dd></div><div className="border-t border-[var(--sf-line)] pt-3 font-extrabold"><dt>{fr ? 'Total' : 'Total'}</dt><dd>{money(quote.total, lang)}</dd></div></dl>
      <p className="text-sm sf-muted">{pay === 'online' ? (fr ? 'Paiement sécurisé sur Clover après confirmation.' : 'Secure payment on Clover after confirmation.') : (fr ? 'Paiement au comptoir lors du ramassage.' : 'Pay at the counter when you pick up.')}</p>
      <button type="button" className="sf-btn sf-accent-bg w-full" onClick={() => void place()} disabled={busy}>{busy ? (fr ? 'Confirmation…' : 'Confirming…') : pending ? (fr ? 'Réessayer la même demande' : 'Retry same request') : `${updated ? (fr ? 'Confirmer le nouveau total' : 'Confirm updated total') : (fr ? 'Confirmer la commande' : 'Place order')} · ${money(quote.total, lang)}`}</button>
      {!pending && <button type="button" className="sf-btn w-full border border-[var(--sf-line)]" disabled={busy} onClick={() => { setQuote(null); setError(null); }}>{fr ? 'Modifier mes coordonnées' : 'Edit my details'}</button>}
    </section>}
    {!pending && <button type="button" className="sf-btn w-full border border-[var(--sf-line)]" disabled={busy} onClick={onBack}>{fr ? 'Retour au panier' : 'Back to cart'}</button>}
    <p className="text-xs leading-relaxed sf-muted">{fr ? 'Vos coordonnées sont transmises au restaurant pour cette commande. Une demande en attente reste dans cet onglet jusqu’à sa résolution.' : 'Your contact details go to the restaurant for this order. A pending request stays in this tab until it is resolved.'}</p>
  </div>;
}
