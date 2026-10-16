// Clover Hosted Checkout (Ecommerce): the payment page behind a phone order's payment link (delivery/paylink.ts).
// Ported from the brand website's server code (pppmtl: providers/clover/checkout.ts + api.server.ts), Food Hub style.
//
//   - Session: POST {CLOVER_HCO_BASE_URL}/invoicingcheckoutservice/v1/checkouts with X-Clover-Merchant-Id and
//     "Authorization: Bearer <ecommerce private key>" (an Ecommerce API token of type "Hosted checkout"). The answer's
//     `href` is Clover's payment page (valid 15 minutes). One line per order line: unit price = item + options (cents),
//     the options in the note, and the merchant's own GST / QST tax rates (Clover charges only rates that exist there).
//   - Webhook: Clover-Signature "t=<seconds>,v1=<hex>" = HMAC-SHA256 of `${t}.${rawBody}` with the Hosted Checkout
//     signing secret (CLOVER_HCO_WEBHOOK_SECRET — not the Clover app's CLOVER_WEBHOOK_AUTH). Older than 5 minutes: refused.
//     Body: { createdTime, message, status APPROVED|DECLINED, type PAYMENT, id (payment id), merchantId, data (session id) }.
//   - A paid session becomes a Clover order (read with the REST token: payments/{id}?expand=order). That order IS the
//     kitchen ticket: Food Hub titles it, notes it and prints it once — it never creates a second Clover order.
// Env: CLOVER_ECOMM_PRIVATE_KEY (for CLOVER_MERCHANT_ID), CLOVER_ECOMM_KEYS={"MID":"key"} (other merchants),
// CLOVER_HCO_WEBHOOK_SECRET, CLOVER_HCO_BASE_URL (default https://api.clover.com; sandbox https://apisandbox.dev.clover.com),
// CLOVER_HCO_PAGE_CONFIG (optional custom page), CLOVER_HCO_FORWARD_URL (optional: sessions Food Hub did not create).
// Nothing here throws: network problems come back as { ok: false }.
import crypto from 'node:crypto';
import { stripSlash, toCents } from '../config';
import type { DirectOrder } from '../delivery/types';
import { cloverBaseUrl, cloverToken } from './clover';
import { cloverFetch } from './clover-http';

export function hcoBaseUrl(): string {
  return stripSlash(process.env.CLOVER_HCO_BASE_URL?.trim() || 'https://api.clover.com');
}

/** The Hosted Checkout private key of a merchant, or null. */
export function ecommKeyFor(merchantId: string | null | undefined): string | null {
  if (!merchantId) return null;
  try {
    const map = JSON.parse(process.env.CLOVER_ECOMM_KEYS || '{}') as Record<string, string>;
    if (map[merchantId]) return String(map[merchantId]).trim() || null;
  } catch { /* ignore a malformed map */ }
  const key = process.env.CLOVER_ECOMM_PRIVATE_KEY?.trim();
  if (key && (!process.env.CLOVER_MERCHANT_ID || process.env.CLOVER_MERCHANT_ID === merchantId)) return key;
  return null;
}

/** Any Hosted Checkout key on this server (without one, phone orders work exactly as before). */
export function ecommConfigured(): boolean {
  if (process.env.CLOVER_ECOMM_PRIVATE_KEY?.trim()) return true;
  try { return Object.values(JSON.parse(process.env.CLOVER_ECOMM_KEYS || '{}') as Record<string, string>).some((v) => String(v).trim()); } catch { return false; }
}

/** Merchants that have a Hosted Checkout key. */
export function ecommMerchants(): string[] {
  const out = new Set<string>();
  try { for (const [mid, v] of Object.entries(JSON.parse(process.env.CLOVER_ECOMM_KEYS || '{}') as Record<string, string>)) if (String(v).trim()) out.add(mid); } catch { /* ignore */ }
  if (process.env.CLOVER_ECOMM_PRIVATE_KEY?.trim() && process.env.CLOVER_MERCHANT_ID) out.add(process.env.CLOVER_MERCHANT_ID);
  return [...out];
}

export function hcoWebhookSecret(): string | undefined {
  return process.env.CLOVER_HCO_WEBHOOK_SECRET?.trim() || undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Taxes

/** A Clover tax rate: `rate` 10 % = 1 000 000 (Clover's unit). */
export interface CloverTaxRate { id?: string; name: string; rate: number }

const GST = 500_000;
const QST = 997_500;

/** GST and QST rounded one by one (Clover shows each tax on its page): cents. */
export function hcoTaxCents(subtotalCents: number, rates: CloverTaxRate[]): number {
  return rates.reduce((sum, r) => sum + Math.round((subtotalCents * r.rate) / 10_000_000), 0);
}

const taxCache = new Map<string, { at: number; rates: CloverTaxRate[] | null }>();
const TAX_OK_MS = 10 * 60_000;
/** A merchant without the rates (or Clover unreadable) is asked again after a minute, not on every phone turn. */
const TAX_MISS_MS = 60_000;

/** Tests: forget the merchants' tax rates read so far. */
export function clearTaxCache(): void { taxCache.clear(); }

/**
 * The merchant's GST (5 %) and QST (9.975 %) tax rates, with their Clover ids. Null when they cannot be read or one is
 * missing (Hosted Checkout would then charge the wrong amount: the payment link is not offered).
 */
export async function merchantQcTaxRates(mid: string, now = Date.now()): Promise<CloverTaxRate[] | null> {
  const hit = taxCache.get(mid);
  if (hit && now - hit.at < (hit.rates ? TAX_OK_MS : TAX_MISS_MS)) return hit.rates;
  const miss = () => { taxCache.set(mid, { at: now, rates: null }); return null; };
  const token = await cloverToken(mid);
  if (!token) return null;
  try {
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/tax_rates?limit=100`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return miss();
    const rows: Array<{ id?: string; name?: string; rate?: number }> = (await res.json())?.elements ?? [];
    const pick = (rate: number, names: RegExp) => rows.find((r) => Number(r.rate) === rate) ?? rows.find((r) => names.test(String(r.name ?? '')));
    const gst = pick(GST, /\b(tps|gst)\b/i);
    const qst = pick(QST, /\b(tvq|qst)\b/i);
    if (!gst || !qst || Number(gst.rate) !== GST || Number(qst.rate) !== QST) return miss();
    const rates = [gst, qst].map((r) => ({ ...(r.id ? { id: String(r.id) } : {}), name: String(r.name ?? (r === gst ? 'TPS' : 'TVQ')), rate: Number(r.rate) }));
    taxCache.set(mid, { at: now, rates });
    return rates;
  } catch {
    return miss();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Session request

export interface HostedCheckoutLineItem { name: string; price: number; unitQty: number; note?: string; taxRates?: CloverTaxRate[] }
export interface HostedCheckoutRequest {
  customer: { firstName?: string; lastName?: string; email?: string; phoneNumber?: string };
  redirectUrls: { success: string; failure: string; cancel: string };
  shoppingCart: { lineItems: HostedCheckoutLineItem[] };
  pageConfigUuid?: string;
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function splitName(full: string | null | undefined): { firstName?: string; lastName?: string } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  const [first, ...rest] = parts;
  return { firstName: cut(first, 60), ...(rest.length ? { lastName: cut(rest.join(' '), 60) } : {}) };
}

/** Our mark on the first line of a session ("Réf. IA-1043"): how the poller finds the Clover order when a webhook is lost. */
export const payMarker = (number: string) => `Réf. ${number}`;

/** The whole mark, not a prefix: "Réf. IA-104" never matches "Réf. IA-1043". */
export function hasMarker(note: string, marker: string): boolean {
  return new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'u').test(note);
}

/**
 * The Hosted Checkout body for a held order. Every line carries the GST / QST rates; the delivery fee is a line of its
 * own (taxed, like in Food Hub's totals). Only first name, last name and phone go to Clover (no email on phone orders).
 */
export function buildCheckoutRequest(order: Pick<DirectOrder, 'number' | 'lines' | 'deliveryFee' | 'customer'> & { tip?: number }, taxRates: CloverTaxRate[], urls: HostedCheckoutRequest['redirectUrls']): HostedCheckoutRequest {
  const phone = String(order.customer.phone ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const rates = taxRates.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, rate: r.rate }));
  const lineItems: HostedCheckoutLineItem[] = order.lines.map((l, i) => {
    const mods = l.modifiers.reduce((s, m) => s + m.unitPrice * (m.quantity || 1), 0);
    const note = [i === 0 ? payMarker(order.number) : '', ...l.modifiers.map((m) => `${(m.quantity || 1) > 1 ? `${m.quantity}x ` : ''}${m.name}`), l.notes ? `Note: ${l.notes}` : '', l.alcohol ? 'ALCOOL — ID 18+' : ''].filter(Boolean).join(' · ');
    return { name: cut(l.name, 127), price: toCents(l.unitPrice + mods), unitQty: Math.max(1, Math.round(l.quantity || 1)), ...(note ? { note: cut(note, 255) } : {}), ...(rates.length ? { taxRates: rates } : {}) };
  });
  if (order.deliveryFee > 0) lineItems.push({ name: 'Livraison / Delivery', price: toCents(order.deliveryFee), unitQty: 1, ...(rates.length ? { taxRates: rates } : {}) });
  // The courier tip is part of Food Hub's total: the customer pays it here, untaxed (no tax rates on this line).
  if ((order.tip ?? 0) > 0) lineItems.push({ name: 'Pourboire livreur / Courier tip', price: toCents(order.tip!), unitQty: 1 });
  const page = process.env.CLOVER_HCO_PAGE_CONFIG?.trim();
  return {
    customer: { ...splitName(order.customer.name), ...(phone ? { phoneNumber: phone } : {}) },
    redirectUrls: urls,
    shoppingCart: { lineItems },
    ...(page ? { pageConfigUuid: page } : {}),
  };
}

/** What Clover will charge for this request (cents): line totals + GST and QST (on the taxed lines) rounded one by one. */
export function checkoutTotalCents(req: HostedCheckoutRequest): number {
  const items = req.shoppingCart.lineItems;
  const sub = items.reduce((s, l) => s + l.price * l.unitQty, 0);
  const taxed = items.filter((l) => l.taxRates?.length);
  const taxedSub = taxed.reduce((s, l) => s + l.price * l.unitQty, 0);
  return sub + hcoTaxCents(taxedSub, taxed[0]?.taxRates ?? []);
}

export type CreateCheckoutResult = { ok: true; href: string; sessionId: string; expiresAt: number | null } | { ok: false; status: number; error: string };

export async function createHostedCheckout(mid: string, body: HostedCheckoutRequest): Promise<CreateCheckoutResult> {
  const key = ecommKeyFor(mid);
  if (!key) return { ok: false, status: 0, error: 'No Clover Hosted Checkout key for this merchant (CLOVER_ECOMM_PRIVATE_KEY).' };
  try {
    const res = await cloverFetch(`${hcoBaseUrl()}/invoicingcheckoutservice/v1/checkouts`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Clover-Merchant-Id': mid, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    const href = typeof json?.href === 'string' ? json.href : '';
    const id = typeof json?.checkoutSessionId === 'string' ? json.checkoutSessionId : '';
    if (!res.ok || !href || !id) return { ok: false, status: res.status, error: `Clover Hosted Checkout HTTP ${res.status}${json?.message ? `: ${String(json.message).slice(0, 200)}` : ''}` };
    const exp = Number(json?.expirationTime);
    return { ok: true, href, sessionId: id, expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null };
  } catch (e) {
    return { ok: false, status: 0, error: `Clover Hosted Checkout network error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Webhook

export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
export type CloverSignatureCheck = 'ok' | 'missing_secret' | 'missing_signature' | 'invalid_signature' | 'stale_timestamp';

/** `Clover-Signature: t=1642599079,v1=<hex>` = HMAC-SHA256 of `${t}.${rawBody}` with the signing secret, constant-time. */
export function verifyCloverSignature(rawBody: string, header: string | null, secret: string | undefined, now = Date.now()): CloverSignatureCheck {
  if (!secret) return 'missing_secret';
  if (!header) return 'missing_signature';
  const parts = Object.fromEntries(header.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; })) as Record<string, string | undefined>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return 'missing_signature';
  const seconds = Number(t);
  if (!Number.isFinite(seconds)) return 'invalid_signature';
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  if (Math.abs(now - ms) > WEBHOOK_TOLERANCE_MS) return 'stale_timestamp';
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(v1.toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid_signature';
}

/** For tests and the local mock: the header Clover would send. */
export function cloverSignatureHeader(rawBody: string, secret: string, now = Date.now()): string {
  const t = String(Math.floor(now / 1000));
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export interface HostedCheckoutEvent { status: string; type: string; paymentId: string | null; sessionId: string | null; merchantId: string | null; message: string | null }

export function parseHostedCheckoutEvent(rawBody: string): HostedCheckoutEvent | null {
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const lower = Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]));
  const s = (k: string) => { const v = lower[k]; return typeof v === 'string' && v.trim() ? v.trim() : null; };
  const status = (s('status') ?? '').toUpperCase();
  if (!status) return null;
  return { status, type: (s('type') ?? '').toUpperCase(), paymentId: s('id'), sessionId: s('data'), merchantId: s('merchantid'), message: s('message') };
}

// ---------------------------------------------------------------------------------------------------------------
// REST: the paid order

export interface PaidCloverOrder { paymentId: string; cloverOrderId: string; amountCents: number; result: string }

/** payments/{id}?expand=order → the Clover order a payment created. Null when it cannot be read (retry later). */
export async function paymentWithOrder(mid: string, paymentId: string): Promise<PaidCloverOrder | null> {
  const token = await cloverToken(mid);
  if (!token) return null;
  try {
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/payments/${encodeURIComponent(paymentId)}?expand=order`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const p = await res.json();
    const orderId = p?.order?.id;
    if (typeof orderId !== 'string') return null;
    return { paymentId, cloverOrderId: orderId, amountCents: Number(p.amount) || 0, result: String(p.result ?? '') };
  } catch {
    return null;
  }
}

/**
 * Poller: the Clover orders created since `sinceMs` whose first line carries our marker and that have a successful
 * payment. Used when a webhook is late or lost (Clover documents no retry log). Null = Clover could not be read.
 */
export async function findPaidByMarker(mid: string, marker: string, sinceMs: number): Promise<PaidCloverOrder[] | null> {
  const token = await cloverToken(mid);
  if (!token) return null;
  try {
    const q = new URLSearchParams({ filter: `createdTime>=${Math.floor(sinceMs)}`, expand: 'lineItems,payments', limit: '100', orderBy: 'createdTime DESC' });
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/orders?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows: any[] = (await res.json())?.elements ?? [];
    const out: PaidCloverOrder[] = [];
    for (const o of rows) {
      const notes: string[] = (o?.lineItems?.elements ?? []).map((li: any) => String(li?.note ?? ''));
      if (!notes.some((n) => hasMarker(n, marker))) continue;
      for (const p of o?.payments?.elements ?? []) {
        if (String(p?.result ?? '').toUpperCase() === 'SUCCESS' && p?.id) out.push({ paymentId: String(p.id), cloverOrderId: String(o.id), amountCents: Number(p.amount) || 0, result: 'SUCCESS' });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Clover "update an order": POST /v3/merchants/{mId}/orders/{orderId} (title, note, order type). */
export async function updateCloverOrder(mid: string, orderId: string, patch: { title?: string; note?: string; orderTypeId?: string | null }): Promise<boolean> {
  const token = await cloverToken(mid);
  if (!token) return false;
  try {
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/orders/${encodeURIComponent(orderId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...(patch.title ? { title: cut(patch.title, 127) } : {}), ...(patch.note ? { note: cut(patch.note, 255) } : {}), ...(patch.orderTypeId ? { orderType: { id: patch.orderTypeId } } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
