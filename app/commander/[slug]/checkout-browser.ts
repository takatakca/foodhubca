// Ordering on ON2GO.ca through Food Hub's ordering pages (foodhubca lib/foodhub/storefront/*): the live menu of a brand
// (GET /api/storefront/menu/<slug>), the checkout (POST /api/storefront/checkout, CORS for on2go.ca since foodhubca
// feature/storefront-cross-origin-checkout) and the tracking (GET /api/storefront/track/<token>). Pure helpers here
// (unit-tested); the screens are components/order-client.tsx and components/track-client.tsx. Prices shown here are
// for display: Food Hub prices the cart again on its side and its total is the one that counts.
import type { SfLang as Lang } from '@/lib/foodhub/storefront/i18n';
// Native same-origin browser adapter. Kept in contract parity with on2goca/lib/order.ts.
const FOODHUB_URL = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

export const STOREFRONT_API = `${FOODHUB_URL}/api/storefront`;
export const menuUrl = (slug: string) => `${STOREFRONT_API}/menu/${encodeURIComponent(slug)}`;
export const CHECKOUT_URL = `${STOREFRONT_API}/checkout`;
export const QUOTE_URL = `${STOREFRONT_API}/quote`;
export const trackUrl = (token: string, slug?: string) => `${STOREFRONT_API}/track/${encodeURIComponent(token)}${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`;
/** Food Hub answers with relative paths (/p/<token>, /commander/<slug>/suivi/<token>): make them absolute. */
export const foodHubAbsolute = (path: string) => (/^https?:\/\//i.test(path) ? path : `${FOODHUB_URL}${path.startsWith('/') ? '' : '/'}${path}`);
export const ORDER_TIMEOUT_MS = 15_000;
export const MAX_QTY = 20;
export const MAX_LINES = 30;
/** The published Food Hub link takes precedence over the editable brand's default slug. */
export function slugOf(brandId: string, publishedUrl?: string): string {
  if (publishedUrl) {
    try {
      const u = new URL(publishedUrl);
      const match = /^\/commander\/([a-z0-9-]{2,40})\/?$/.exec(u.pathname);
      if (!u.username && !u.password && u.origin === new URL(FOODHUB_URL).origin && match) return match[1];
    } catch { /* fall back to the original directory id */ }
  }
  return brandId;
}

// ---------- what Food Hub publishes ----------

export interface PublicOption { ref: string; name: string; nameFr?: string; price: number }
export interface PublicGroup { ref: string; name: string; nameFr?: string; min: number; max: number; upsell: boolean; options: PublicOption[] }
export interface PublicItem { ref: string; name: string; nameFr?: string; description?: string; descriptionFr?: string; imageUrl?: string; tags: string[]; allergens: string[]; price: number; groups: PublicGroup[] }
export interface PublicCategory { ref: string; name: string; nameFr?: string; available: boolean; availableFrom?: string; items: PublicItem[] }
export interface PublicMenu {
  slug: string;
  brand: { name: string; color: string; cuisine: { fr: string[]; en: string[] }; description: { fr: string; en: string } | null };
  location: { name: { fr: string; en: string }; street: string; city: string; region: string; postalCode: string; geo: { lat: number; lng: number } | null };
  taxes?: { province: string; rate: number; label: { fr: string; en: string } };
  state: { open: boolean; paused: boolean; hoursKnown: boolean; closesAt?: string; nextOpenAt?: string };
  pay: { online: boolean; atPickup: boolean };
  note: { fr?: string; en?: string };
  categories: PublicCategory[];
  generatedAt: string;
}

export const label = (x: { name: string; nameFr?: string }, lang: Lang) => (lang === 'fr' ? x.nameFr || x.name : x.name);
export const describe = (x: { description?: string; descriptionFr?: string }, lang: Lang) => (lang === 'fr' ? x.descriptionFr || x.description : x.description) || '';
/** Photos come as "/media/<file>" on Food Hub. */
export const photoUrl = (u: string | undefined) => (u ? foodHubAbsolute(u) : null);

/** A menu answer: the menu, or null when the page is not live (404) or the body is not a menu. */
export function parseMenu(body: unknown): PublicMenu | null {
  const b = body as { ok?: boolean; menu?: PublicMenu } | null;
  const m = b && b.ok && b.menu;
  return m && typeof m.slug === 'string' && Array.isArray(m.categories) ? m : null;
}

// ---------- the cart ----------

export interface CartOption { group: string; ref: string; qty?: number }
export interface CartLine { id: string; ref: string; qty: number; options: CartOption[]; notes?: string }
export interface Cart { slug: string; lines: CartLine[] }

export const emptyCart = (slug: string): Cart => ({ slug, lines: [] });
export const cartKey = (slug: string) => `on2go_cart_${slug}_v1`;

/** A damaged/older browser cart cannot turn a quantity or modifier into NaN, negative or unbounded checkout data. */
export function parseCart(slug: string, raw: unknown): Cart {
  const c = raw && typeof raw === 'object' ? raw as Partial<Cart> : null;
  if (!c || c.slug !== slug || !Array.isArray(c.lines)) return emptyCart(slug);
  const ref = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 120;
  const qty = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_QTY;
  const lines: CartLine[] = [];
  for (const [n, line] of c.lines.slice(0, MAX_LINES).entries()) {
    if (!line || !ref(line.ref) || !qty(line.qty) || !Array.isArray(line.options) || line.options.length > 40) continue;
    if (!line.options.every((o) => o && ref(o.group) && ref(o.ref) && (o.qty === undefined || qty(o.qty)))) continue;
    lines.push({ id: `saved-${n}`, ref: line.ref, qty: line.qty, options: line.options.map((o) => ({ group: o.group, ref: o.ref, ...(o.qty === undefined ? {} : { qty: o.qty }) })), ...(typeof line.notes === 'string' && line.notes.trim() ? { notes: line.notes.trim().slice(0, 140) } : {}) });
  }
  return { slug, lines };
}

/** Same item with the same options and notes → the same line (quantities add up). */
export function lineSignature(l: Pick<CartLine, 'ref' | 'options' | 'notes'>): string {
  const opts = [...l.options].map((o) => `${o.group}:${o.ref}:${o.qty ?? 1}`).sort().join('|');
  return `${l.ref}#${opts}#${(l.notes ?? '').trim()}`;
}

export function addLine(cart: Cart, line: Omit<CartLine, 'id'>): Cart {
  const sig = lineSignature(line);
  const existing = cart.lines.find((l) => lineSignature(l) === sig);
  if (existing) return { ...cart, lines: cart.lines.map((l) => (l === existing ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l)) };
  if (cart.lines.length >= MAX_LINES) return cart;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { ...cart, lines: [...cart.lines, { ...line, id, qty: Math.min(MAX_QTY, Math.max(1, line.qty)) }] };
}

export function setQty(cart: Cart, id: string, qty: number): Cart {
  if (qty <= 0) return { ...cart, lines: cart.lines.filter((l) => l.id !== id) };
  return { ...cart, lines: cart.lines.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)) };
}

/** Editing choices also merges a matching line, just like adding the same item again. */
export function replaceLine(cart: Cart, id: string, line: Omit<CartLine, 'id'>): Cart {
  return addLine({ ...cart, lines: cart.lines.filter((l) => l.id !== id) }, line);
}

export const itemCount = (cart: Cart) => cart.lines.reduce((n, l) => n + l.qty, 0);

/** Items of a menu by ref (what the cart lines point at). */
export function indexMenu(menu: PublicMenu): Map<string, { item: PublicItem; category: PublicCategory }> {
  const m = new Map<string, { item: PublicItem; category: PublicCategory }>();
  for (const category of menu.categories) for (const item of category.items) m.set(item.ref, { item, category });
  return m;
}

/** Display price of one line (item + chosen options) × qty; 0 when the item is no longer on the menu. */
export function linePrice(menu: PublicMenu, line: CartLine): number {
  const hit = indexMenu(menu).get(line.ref);
  if (!hit) return 0;
  let unit = hit.item.price;
  for (const o of line.options) {
    const g = hit.item.groups.find((x) => x.ref === o.group);
    const opt = g?.options.find((x) => x.ref === o.ref);
    if (opt) unit += opt.price * (o.qty ?? 1);
  }
  return Math.round(unit * line.qty * 100) / 100;
}

/** Subtotal before taxes (Food Hub adds GST/QST and tells the real total). */
export function subtotal(menu: PublicMenu, cart: Cart): number {
  return Math.round(cart.lines.reduce((s, l) => s + linePrice(menu, l), 0) * 100) / 100;
}

/** Lines whose item left the menu since the cart was saved (shown, then dropped). */
export function staleLines(menu: PublicMenu, cart: Cart): CartLine[] {
  const idx = indexMenu(menu);
  return cart.lines.filter((l) => !idx.has(l.ref));
}

/** Does a choice respect the group's min / max? (the same rule Food Hub applies) */
export function groupError(group: PublicGroup, chosen: CartOption[], lang: Lang): string | null {
  const n = chosen.filter((o) => o.group === group.ref).reduce((s, o) => s + (o.qty ?? 1), 0);
  if (n < group.min) return lang === 'fr' ? `Choisissez au moins ${group.min} option${group.min > 1 ? 's' : ''} : ${label(group, lang)}` : `Choose at least ${group.min} option${group.min > 1 ? 's' : ''}: ${label(group, lang)}`;
  if (group.max > 0 && n > group.max) return lang === 'fr' ? `Au plus ${group.max} option${group.max > 1 ? 's' : ''} : ${label(group, lang)}` : `At most ${group.max} option${group.max > 1 ? 's' : ''}: ${label(group, lang)}`;
  return null;
}

/** Keep a saved cart reviewable after menu availability and required options change. Food Hub validates again. */
export function cartIssues(menu: PublicMenu, cart: Cart, lang: Lang): Array<{ id: string; error: string }> {
  const index = indexMenu(menu);
  const fr = lang === 'fr';
  return cart.lines.flatMap((line) => {
    const hit = index.get(line.ref);
    const issue = !hit ? (fr ? 'Ce plat n’est plus au menu.' : 'This item is no longer on the menu.')
      : !hit.category.available ? (fr ? 'Ce plat n’est pas servi en ce moment.' : 'This item is not served right now.')
      : line.options.some((o) => !hit.item.groups.some((g) => g.ref === o.group && g.options.some((v) => v.ref === o.ref))) ? (fr ? 'Une option a changé. Modifiez ce plat.' : 'An option has changed. Edit this item.')
      : hit.item.groups.map((g) => groupError(g, line.options, lang)).find(Boolean)
        ?? (new Set(line.options.filter((o) => hit.item.groups.some((g) => g.ref === o.group && g.upsell)).map((o) => o.group)).size > 1 ? (fr ? 'Choisissez une seule formule repas.' : 'Choose one meal upgrade.') : null);
    return issue ? [{ id: line.id, error: issue }] : [];
  });
}

// ---------- the customer and the checkout ----------

export interface Customer { name: string; phone: string; email: string }
export type PayMode = 'online' | 'pickup';

/** "514 555-0123" → +15145550123 (Canada / US); null otherwise. Food Hub refuses the rest anyway. */
export function normalizePhone(input: string): string | null {
  const text = input.trim();
  let digits = text.replace(/\D/g, '');
  if ((text.startsWith('+') && !digits.startsWith('1')) || digits.startsWith('011') || digits.startsWith('00')) return null;
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[2-9]\d\d[2-9]\d{6}$/.test(digits)) return null;
  const area = digits.slice(0, 3), exchange = digits.slice(3, 6);
  if (area.slice(1) === '11' || exchange.slice(1) === '11') return null;
  if (new Set(['242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721', '758', '767', '784', '809', '829', '849', '868', '869', '876', '900']).has(area)) return null;
  return `+1${digits}`;
}

export function validateCustomer(c: Customer, lang: Lang): Partial<Record<keyof Customer, string>> {
  const fr = lang === 'fr';
  const errors: Partial<Record<keyof Customer, string>> = {};
  if (!c.name.trim() || c.name.trim().length > 60) errors.name = fr ? 'Votre nom, pour l’appeler quand c’est prêt.' : 'Your name, to call out when it is ready.';
  if (!normalizePhone(c.phone)) errors.phone = fr ? 'Un cellulaire canadien à 10 chiffres : on vous texte la confirmation.' : 'A 10-digit Canadian cell number: we text you the confirmation.';
  const email = c.email.trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) errors.email = fr ? 'Courriel invalide (facultatif).' : 'Invalid email (optional).';
  return errors;
}

/** The checkout body Food Hub expects (cartSchema): refs, quantities, options, the customer, the language, the pay mode. */
export function buildCheckout(cart: Cart, customer: Customer, lang: Lang, pay: PayMode, intent?: { quoteId?: string; idempotencyKey?: string; src?: string }) {
  const phone = normalizePhone(customer.phone) ?? customer.phone.trim();
  const email = customer.email.trim();
  return {
    slug: cart.slug,
    lines: cart.lines.map((l) => ({ ref: l.ref, qty: l.qty, options: l.options.map((o) => ({ group: o.group, ref: o.ref, ...(o.qty && o.qty > 1 ? { qty: o.qty } : {}) })), ...(l.notes?.trim() ? { notes: l.notes.trim().slice(0, 140) } : {}) })),
    customer: { name: customer.name.trim().slice(0, 60), phone, ...(email ? { email } : {}) },
    lang,
    pay,
    src: intent?.src ?? 'site',
    website: '',
    ...(intent?.quoteId ? { quoteId: intent.quoteId } : {}),
    ...(intent?.idempotencyKey ? { idempotencyKey: intent.idempotencyKey } : {}),
  };
}

export interface QuoteLine { ref: string; qty: number; name: string; unitPrice: number; total: number; options: Array<{ ref: string; name: string; qty: number; unitPrice: number }> }
export interface QuoteView { quoteId: string; subtotal: number; tax: number; total: number; taxes: { province: string; rate: number; label: { fr: string; en: string } }; lines: QuoteLine[] }
/** Only a complete server-priced review can authorize the final confirmation button. */
export function parseQuote(body: unknown): QuoteView | null {
  const q = body as Partial<QuoteView> & { ok?: boolean } | null;
  const amount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100_000;
  if (!q || q.ok === false || !/^[a-f0-9]{64}$/.test(q.quoteId ?? '') || !amount(q.subtotal) || !amount(q.tax) || !amount(q.total)) return null;
  if (Math.abs(Math.round((q.subtotal + q.tax) * 100) - Math.round(q.total * 100)) > 1) return null;
  if (!q.taxes || typeof q.taxes.province !== 'string' || !amount(q.taxes.rate) || typeof q.taxes.label?.fr !== 'string' || typeof q.taxes.label?.en !== 'string') return null;
  if (!Array.isArray(q.lines) || !q.lines.length || q.lines.length > MAX_LINES) return null;
  if (!q.lines.every((l) => l && typeof l.ref === 'string' && typeof l.name === 'string' && Number.isInteger(l.qty) && l.qty > 0 && l.qty <= MAX_QTY && amount(l.unitPrice) && amount(l.total) && Array.isArray(l.options) && l.options.every((o) => o && typeof o.ref === 'string' && typeof o.name === 'string' && Number.isInteger(o.qty) && o.qty > 0 && o.qty <= MAX_QTY && amount(o.unitPrice)))) return null;
  return q as QuoteView;
}

export interface PendingCheckout { request: ReturnType<typeof buildCheckout>; quote: QuoteView }
export const pendingKey = (slug: string) => `sf_pending:${slug}`;
type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Tab-scoped approved request survives a refresh. Never rotate its key after an uncertain result. */
export function readPendingCheckout(storage: CheckoutStorage, slug: string): PendingCheckout | null {
  try {
    const raw = storage.getItem(pendingKey(slug));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingCheckout;
    const r = value?.request, quote = parseQuote(value?.quote);
    if (!r || r.slug !== slug || !quote || r.quoteId !== quote.quoteId || !/^[A-Za-z0-9_-]{16,128}$/.test(r.idempotencyKey ?? '') || (r.lang !== 'fr' && r.lang !== 'en') || (r.pay !== 'online' && r.pay !== 'pickup')) return null;
    const cart = parseCart(slug, { slug, lines: r.lines });
    if (!cart.lines.length || cart.lines.length !== r.lines.length || !r.customer || Object.keys(validateCustomer({ ...r.customer, email: r.customer.email ?? '' }, r.lang)).length) return null;
    return { request: buildCheckout(cart, { ...r.customer, email: r.customer.email ?? '' }, r.lang, r.pay, { quoteId: quote.quoteId, idempotencyKey: r.idempotencyKey, src: r.src }), quote };
  } catch { return null; }
}
export function writePendingCheckout(storage: CheckoutStorage, slug: string, value: PendingCheckout | null): boolean {
  try { if (value) storage.setItem(pendingKey(slug), JSON.stringify(value)); else storage.removeItem(pendingKey(slug)); return true; } catch { return false; }
}

export type CheckoutOutcome =
  | { ok: true; number: string; track: string; trackUrl: string; payUrl: string | null; total: number }
  | { ok: false; status: number; error: string; reason: 'closed' | 'paused' | 'rate_limited' | 'pay' | 'pickup_limit' | 'quote_changed' | 'idempotency_conflict' | 'in_progress' | 'review_required' | null; fallback: 'pay_at_pickup' | null; retryAfterSec: number | null; line: number | null; quote?: QuoteView };

/** Food Hub's answer, whatever its status; the message is already in the customer's language. */
export function parseCheckout(status: number, body: unknown, lang: Lang): CheckoutOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  if (status >= 200 && status < 300 && b.ok === true && str(b.track) && str(b.number)) {
    return { ok: true, number: String(b.number), track: String(b.track), trackUrl: foodHubAbsolute(str(b.trackUrl) ?? `/commander/${''}`), payUrl: str(b.payUrl) ? foodHubAbsolute(String(b.payUrl)) : null, total: typeof b.total === 'number' ? b.total : 0 };
  }
  const reasons = ['closed', 'paused', 'rate_limited', 'pay', 'pickup_limit', 'quote_changed', 'idempotency_conflict', 'in_progress', 'review_required'] as const;
  const reason = reasons.find((r) => r === b.reason) ?? null;
  const generic = lang === 'fr' ? 'La commande n’a pas pu être envoyée. Réessayez, ou commandez sur la page du restaurant.' : 'The order could not be sent. Try again, or order on the restaurant’s page.';
  return {
    ok: false, status, error: str(b.error) ?? (status === 404 ? (lang === 'fr' ? 'Ce restaurant ne prend pas de commandes en ligne pour le moment.' : 'This restaurant is not taking online orders right now.') : generic),
    reason, fallback: b.fallback === 'pay_at_pickup' ? 'pay_at_pickup' : null,
    retryAfterSec: typeof b.retryAfterSec === 'number' ? b.retryAfterSec : null, line: typeof b.line === 'number' ? b.line : null,
    ...(parseQuote(b.quote) ? { quote: parseQuote(b.quote)! } : {}),
  };
}

// ---------- tracking ----------

export type OrderStatus = 'awaiting_payment' | 'new' | 'in_kitchen' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
export interface TrackView { number: string; status: OrderStatus; brand: string; readyAt: string | null; payUrl?: string }

export function parseTrack(body: unknown): TrackView | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.ok !== true || typeof b.number !== 'string' || typeof b.status !== 'string' || !Object.hasOwn(STATUS_TEXT, b.status)) return null;
  let payUrl: string | undefined;
  if (b.status === 'awaiting_payment' && typeof b.payUrl === 'string') {
    try { const u = new URL(foodHubAbsolute(b.payUrl)); if (u.origin === new URL(FOODHUB_URL).origin && /^\/p\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) && !u.username && !u.password) payUrl = u.toString(); } catch { /* invalid resume link is omitted */ }
  }
  return { number: b.number, status: b.status as OrderStatus, brand: typeof b.brand === 'string' ? b.brand : '', readyAt: typeof b.readyAt === 'string' && !Number.isNaN(Date.parse(b.readyAt)) ? b.readyAt : null, ...(payUrl ? { payUrl } : {}) };
}

export const STATUS_TEXT: Record<OrderStatus, { fr: string; en: string }> = {
  awaiting_payment: { fr: 'En attente du paiement', en: 'Awaiting payment' },
  new: { fr: 'Reçue par le restaurant', en: 'Received by the restaurant' },
  in_kitchen: { fr: 'En préparation', en: 'Being prepared' },
  ready: { fr: 'Prête : venez la chercher', en: 'Ready: come and get it' },
  out_for_delivery: { fr: 'En route', en: 'On its way' },
  completed: { fr: 'Terminée. Bon appétit !', en: 'Done. Enjoy!' },
  cancelled: { fr: 'Annulée', en: 'Cancelled' },
};
export const STATUS_STEP: Record<OrderStatus, number> = { awaiting_payment: 0, new: 1, in_kitchen: 2, ready: 3, out_for_delivery: 3, completed: 4, cancelled: -1 };

/** The tracking token must look like Food Hub's (18 random bytes, base64url). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export function money(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format(n);
}
