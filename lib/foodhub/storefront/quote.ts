// One shared validation/pricing path for review and placement. A quote is neither
// an order nor a price reservation; placement checks the live menu again.
import crypto from 'node:crypto';
import { prepFor } from '../prep';
import { cartSchema, cleanCustomer, priceCart, type Cart, type PriceResult } from './cart';
import { loadSellableMenu, type SellableMenu } from './catalog';
import { priceLabel, sfLang, sfText } from './i18n';

export const PICKUP_MAX_ITEMS = 25;
export interface StorefrontQuote {
  quoteId: string;
  subtotal: number;
  tax: number;
  total: number;
  taxes: SellableMenu['menu']['taxes'];
  lines: Array<{ ref: string; qty: number; name: string; unitPrice: number; total: number; options: Array<{ ref: string; name: string; qty: number; unitPrice: number }> }>;
}
export type StorefrontFailure = {
  ok: false; status: number; error: string;
  reason?: 'closed' | 'paused' | 'rate_limited' | 'pay' | 'pickup_limit' | 'quote_changed' | 'idempotency_conflict' | 'in_progress' | 'review_required';
  fallback?: 'pay_at_pickup'; retryAfterSec?: number; line?: number; quote?: StorefrontQuote;
};
export type PreparedCart = {
  ok: true; cart: Cart; menu: SellableMenu;
  customer: Extract<ReturnType<typeof cleanCustomer>, { ok: true }>['customer'];
  priced: Extract<PriceResult, { ok: true }>;
};

export async function prepareStorefrontCart(body: unknown, now = Date.now()): Promise<PreparedCart | StorefrontFailure> {
  const lang = sfLang((body as { lang?: unknown } | null)?.lang);
  const t = sfText(lang);
  const parsed = cartSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: t.errors.invalid };
  const cart = parsed.data;
  const menu = await loadSellableMenu(cart.slug, now);
  if (!menu?.live) return { ok: false, status: 404, error: t.errors.notFound };
  if (menu.menu.state.paused) return { ok: false, status: 409, reason: 'paused', error: t.errors.paused };
  if (!menu.menu.state.open) return { ok: false, status: 409, reason: 'closed', error: t.errors.closed };
  if (menu.menu.state.closesAt) {
    const prep = await prepFor(menu.locationCode);
    if (Date.parse(menu.menu.state.closesAt) + 60_000 - now < prep.minutes * 60_000) return { ok: false, status: 409, reason: 'closed', error: t.errors.lastOrder };
  }
  const online = cart.pay === 'online';
  if (online && !menu.cfg.payOnline) return { ok: false, status: 409, reason: 'pay', error: t.errors.payOnlineOff, ...(menu.cfg.payAtPickup ? { fallback: 'pay_at_pickup' as const } : {}) };
  if (!online && !menu.cfg.payAtPickup) return { ok: false, status: 409, reason: 'pay', error: t.errors.payAtPickupOff };
  const who = cleanCustomer(cart.customer, cart.lang);
  if (!who.ok) return { ok: false, status: 400, error: who.error };
  const priced = priceCart(menu, cart);
  if (!priced.ok) return { ok: false, status: 422, error: priced.error, ...(priced.line !== undefined ? { line: priced.line } : {}) };
  if (!online) {
    const items = priced.lines.reduce((sum, line) => sum + line.quantity, 0);
    if (items > PICKUP_MAX_ITEMS) return { ok: false, status: 422, reason: 'pickup_limit', error: t.errors.pickupTooMany(PICKUP_MAX_ITEMS, menu.cfg.payOnline) };
    if (priced.total > menu.cfg.pickupMaxTotal) return { ok: false, status: 422, reason: 'pickup_limit', error: t.errors.pickupTooBig(priceLabel(menu.cfg.pickupMaxTotal, cart.lang), menu.cfg.payOnline) };
  }
  return { ok: true, cart, menu, customer: who.customer, priced };
}

export function quoteFor(prepared: PreparedCart): StorefrontQuote {
  const { menu, cart, priced } = prepared;
  const items = new Map(menu.menu.categories.flatMap((category) => category.items.map((item) => [item.ref, item] as const)));
  const lines = priced.lines.map((line) => ({
    ref: line.externalId!, qty: line.quantity,
    name: cart.lang === 'fr' ? items.get(line.externalId!)?.nameFr || line.name : line.name,
    unitPrice: line.unitPrice, total: line.total,
    options: line.modifiers.map((option) => {
      const label = items.get(line.externalId!)?.groups.flatMap((group) => group.options).find((entry) => entry.ref === option.externalId);
      return { ref: option.externalId!, name: cart.lang === 'fr' ? label?.nameFr || option.name : option.name, qty: option.quantity, unitPrice: option.unitPrice };
    }),
  }));
  const view = { subtotal: priced.subtotal, tax: priced.tax, total: priced.total, taxes: menu.menu.taxes, lines };
  const quoteId = crypto.createHash('sha256').update(JSON.stringify({ slug: cart.slug, brand: menu.brandName, location: menu.locationCode, pay: cart.pay, ...view })).digest('hex');
  return { quoteId, ...view };
}

export async function quoteStorefrontCart(body: unknown, now = Date.now()): Promise<({ ok: true; status: 200 } & StorefrontQuote) | StorefrontFailure> {
  const prepared = await prepareStorefrontCart(body, now);
  return prepared.ok ? { ok: true, status: 200, ...quoteFor(prepared) } : prepared;
}
