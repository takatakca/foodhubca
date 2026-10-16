import { checkPayLink, openPayLink, orderForToken, payLinkState } from '@/lib/foodhub/delivery/paylink';
import type { DirectOrder } from '@/lib/foodhub/delivery/types';
import { money } from '@/lib/foodhub/phone/style';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// The payment link texted to a customer: https://<FOODHUB_PUBLIC_URL>/p/<token> (public: the secret token is the
// credential, proxy.ts). GET shows the order (brand, number, items, total, first name only) and a "Pay with Clover"
// button; only the POST of that button makes a Clover session (a link preview in a messaging app never does), then
// sends the customer to Clover's secure page. Clover brings them back with ?r=ok / cancel / fail: "paid" is shown only
// once Clover itself confirms the payment.

type Ctx = { params: Promise<{ token: string }> };
type Lang = 'fr' | 'en' | 'es';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

const W = {
  fr: { title: 'Paiement de votre commande', pay: 'Payer avec Clover', order: 'Commande', total: 'Total (taxes incluses)', hello: 'Bonjour', secure: 'Paiement sécurisé par Clover. Nous ne voyons jamais votre carte.', paid: 'Paiement reçu, merci ! Votre commande est en préparation.', checking: 'Confirmation du paiement en cours…', cancel: 'Paiement annulé. Vous pouvez réessayer.', fail: 'Le paiement n’a pas fonctionné. Vous pouvez réessayer avec une autre carte.', expired: 'Ce lien de paiement a expiré. Aucun montant n’a été prélevé. Rappelez-nous pour passer une nouvelle commande.', cancelled: 'Cette commande est annulée. Aucun montant n’a été prélevé.', unknown: 'Ce lien n’est pas valide.', error: 'Le paiement n’est pas disponible pour le moment. Réessayez dans un instant.', pickup: 'Pour emporter', delivery: 'Livraison', busy: 'Trop d’essais. Réessayez dans une minute.' },
  en: { title: 'Pay for your order', pay: 'Pay with Clover', order: 'Order', total: 'Total (taxes included)', hello: 'Hello', secure: 'Secure payment by Clover. We never see your card.', paid: 'Payment received, thank you! Your order is being prepared.', checking: 'Confirming your payment…', cancel: 'Payment cancelled. You can try again.', fail: 'The payment did not go through. You can try again with another card.', expired: 'This payment link has expired. Nothing was charged. Call us back to place a new order.', cancelled: 'This order is cancelled. Nothing was charged.', unknown: 'This link is not valid.', error: 'Payment is not available right now. Please try again in a moment.', pickup: 'Pickup', delivery: 'Delivery', busy: 'Too many tries. Please try again in a minute.' },
  es: { title: 'Pago de su pedido', pay: 'Pagar con Clover', order: 'Pedido', total: 'Total (impuestos incluidos)', hello: 'Hola', secure: 'Pago seguro con Clover. Nunca vemos su tarjeta.', paid: '¡Pago recibido, gracias! Su pedido está en preparación.', checking: 'Confirmando su pago…', cancel: 'Pago cancelado. Puede intentarlo de nuevo.', fail: 'El pago no se completó. Puede intentarlo de nuevo con otra tarjeta.', expired: 'Este enlace de pago venció. No se le cobró nada. Llámenos para hacer un nuevo pedido.', cancelled: 'Este pedido fue cancelado. No se le cobró nada.', unknown: 'Este enlace no es válido.', error: 'El pago no está disponible en este momento. Intente de nuevo en un momento.', pickup: 'Para recoger', delivery: 'Entrega', busy: 'Demasiados intentos. Intente de nuevo en un minuto.' },
} as const;

function page(lang: Lang, body: string, opts: { refresh?: boolean; status?: number } = {}): Response {
  const w = W[lang];
  return new Response(`<!doctype html><html lang="${lang === 'fr' ? 'fr-CA' : lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${opts.refresh ? '<meta http-equiv="refresh" content="5">' : ''}<title>${esc(w.title)}</title>
<style>:root{color-scheme:light dark;--bg:#0b1530;--card:#13214a;--ink:#f4f7ff;--muted:#a9b6d8;--brand:#2f7bff;--go:#2fbf71;--stop:#ff6b6b}
@media (prefers-color-scheme: light){:root{--bg:#f3f6fc;--card:#fff;--ink:#0b1530;--muted:#51607f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px}.card{background:var(--card);border-radius:14px;padding:20px;box-shadow:0 4px 18px rgba(0,0,0,.18)}
h1{font-size:20px;margin:0 0 4px}.muted{color:var(--muted);font-size:14px}ul{padding:0;list-style:none;margin:16px 0}li{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.2)}
.total{display:flex;justify-content:space-between;font-weight:700;font-size:18px;margin-top:8px}button{width:100%;margin-top:20px;padding:14px;border:0;border-radius:10px;background:var(--brand);color:#fff;font-size:17px;font-weight:700;cursor:pointer}
.ok{color:var(--go);font-weight:700}.err{color:var(--stop);font-weight:700}</style></head><body><main><div class="card">${body}</div><p class="muted" style="text-align:center;margin-top:16px">${esc(w.secure)}</p></main></body></html>`, { status: opts.status ?? 200, headers: HEADERS });
}

function summary(o: DirectOrder, lang: Lang): string {
  const w = W[lang];
  const first = String(o.customer.name ?? '').trim().split(/\s+/)[0] ?? '';
  const items = o.lines.map((l) => `<li><span>${l.quantity} × ${esc(l.name)}</span><span>${esc(money(l.total, lang))}</span></li>`).join('');
  return `<h1>${esc(o.brandName)}</h1><div class="muted">${esc(w.order)} ${esc(o.number)} · ${esc(o.fulfillment === 'delivery' ? w.delivery : w.pickup)}${first ? ` · ${esc(w.hello)} ${esc(first)}` : ''}</div><ul>${items}${o.deliveryFee > 0 ? `<li><span>${esc(w.delivery)}</span><span>${esc(money(o.deliveryFee, lang))}</span></li>` : ''}</ul><div class="total"><span>${esc(w.total)}</span><span>${esc(money(o.total, lang))}</span></div>`;
}

const payButton = (lang: Lang) => `<form method="post"><button type="submit">${esc(W[lang].pay)}</button></form>`;

export async function GET(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const r = new URL(req.url).searchParams.get('r');
  let o = await orderForToken(token);
  if (!o?.paylink) return page('fr', `<p class="err">${esc(W.fr.unknown)}</p>`, { status: 404 });
  const lang = o.paylink.lang;
  const w = W[lang];
  // Back from Clover: Clover itself is asked (the query string is never trusted).
  if (r === 'ok' && payLinkState(o) === 'pending') o = (await checkPayLink(o.id, 'page')).order ?? o;
  const state = payLinkState(o);
  if (state === 'paid') return page(lang, `${summary(o, lang)}<p class="ok">${esc(w.paid)}</p>`);
  if (state === 'expired') return page(lang, `${summary(o, lang)}<p class="err">${esc(w.expired)}</p>`);
  if (state === 'cancelled') return page(lang, `${summary(o, lang)}<p class="err">${esc(w.cancelled)}</p>`);
  if (r === 'ok') return page(lang, `${summary(o, lang)}<p>${esc(w.checking)}</p>`, { refresh: true });
  const note = r === 'cancel' ? `<p class="muted">${esc(w.cancel)}</p>` : r === 'fail' ? `<p class="err">${esc(w.fail)}</p>` : '';
  return page(lang, `${summary(o, lang)}${note}${payButton(lang)}`);
}

// A light per-address limit on session creation (each POST can create a Clover session).
const hits = (): Map<string, number[]> => {
  const g = globalThis as unknown as { __fhPayHits?: Map<string, number[]> };
  g.__fhPayHits ??= new Map();
  return g.__fhPayHits;
};

export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits().get(ip) ?? []).filter((t) => now - t < 60_000);
  const o = await orderForToken(token);
  const lang: Lang = o?.paylink?.lang ?? 'fr';
  if (recent.length >= 10) return page(lang, `<p class="err">${esc(W[lang].busy)}</p>`, { status: 429 });
  hits().set(ip, [...recent, now]);
  if (!o?.paylink) return page('fr', `<p class="err">${esc(W.fr.unknown)}</p>`, { status: 404 });
  const r = await openPayLink(token, now);
  if (r.ok) return new Response(null, { status: 303, headers: { Location: r.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const w = W[lang];
  const msg = r.state === 'paid' ? `<p class="ok">${esc(w.paid)}</p>` : r.state === 'expired' ? `<p class="err">${esc(w.expired)}</p>` : r.state === 'cancelled' ? `<p class="err">${esc(w.cancelled)}</p>` : `<p class="err">${esc(w.error)}</p>${payButton(lang)}`;
  return page(lang, `${summary(o, lang)}${msg}`, { status: r.state === 'error' ? 503 : 200 });
}
