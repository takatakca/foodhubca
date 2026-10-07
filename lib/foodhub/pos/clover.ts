// Clover POS layer for TAKATAK Food Hub.
//  - injectOrder: creates the delivery order in Clover (atomic order API) so the
//    kitchen sees it on the Clover devices, with the marketplace price and the platform
//    promotion as an order-level discount (so the payment recorded at hand-off closes it).
//  - importMenu: builds a Food Hub master menu from Clover inventory, so menus are
//    managed once and pushed to every channel.
import { fromCents, missingEnv, stripSlash, timedFetch, toCents, MARKETPLACE_LABELS } from '../config';
import type { Marketplace, MasterMenu, StoredOrder } from '../types';
import { cloverAppConfigured, cloverOAuthToken, connectedCloverMerchantIds } from './clover-oauth';
import { buildCloverOrderCart } from './clover-order';
import { buildMenuFromClover, cloverMenuItems, listCloverMenus, type CloverImportReport, type CloverMenuItem } from '../menu/clover-import';

export function cloverBaseUrl() {
  return stripSlash(process.env.CLOVER_BASE_URL || 'https://api.clover.com');
}

/** Token for a merchant: CLOVER_MERCHANT_TOKENS JSON map first, then the default CLOVER_ACCESS_TOKEN for CLOVER_MERCHANT_ID. */
export function cloverTokenFor(merchantId: string): string | null {
  try {
    const map = JSON.parse(process.env.CLOVER_MERCHANT_TOKENS || '{}') as Record<string, string>;
    if (map[merchantId]) return map[merchantId];
  } catch { /* ignore malformed map */ }
  if (process.env.CLOVER_ACCESS_TOKEN && (!process.env.CLOVER_MERCHANT_ID || process.env.CLOVER_MERCHANT_ID === merchantId)) {
    return process.env.CLOVER_ACCESS_TOKEN;
  }
  return null;
}

/** Token for a merchant: env tokens first (CLOVER_MERCHANT_TOKENS / CLOVER_ACCESS_TOKEN), then the Clover app connection (OAuth, auto-refreshed). */
export async function cloverToken(merchantId: string): Promise<string | null> {
  return cloverTokenFor(merchantId) ?? (await cloverOAuthToken(merchantId));
}

export function cloverInjectionEnabled(): boolean {
  return process.env.FOODHUB_POS_INJECTION !== 'off';
}

export function cloverReadiness() {
  const missing = missingEnv(['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN']);
  const app = cloverAppConfigured();
  return {
    // Either a merchant API token in the environment, or the Clover app (merchants connect with one click).
    configured: missing.length === 0 || app,
    appConfigured: app,
    injectionEnabled: cloverInjectionEnabled(),
    missing,
    note: missing.length === 0
      ? 'Orders will be created in Clover automatically. Extra locations: connect them with the Clover app, or add CLOVER_MERCHANT_TOKENS={"MERCHANT_ID":"token"}.'
      : app
        ? 'Clover app keys are set: connect each Clover merchant with "Connect a Clover merchant" (or by opening the app from Clover).'
        : 'Add the Clover app keys (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET), or CLOVER_MERCHANT_ID and CLOVER_ACCESS_TOKEN, to inject orders into Clover.',
    noteFr: missing.length === 0
      ? 'Les commandes sont créées dans Clover automatiquement. Autres succursales : branchez-les avec l’app Clover, ou ajoutez CLOVER_MERCHANT_TOKENS={"MERCHANT_ID":"jeton"}.'
      : app
        ? 'Les clés de l’app Clover sont en place : branchez chaque marchand Clover avec « Brancher un marchand Clover » (ou en ouvrant l’app depuis Clover).'
        : 'Ajoutez les clés de l’app Clover (CLOVER_CLIENT_ID / CLOVER_CLIENT_SECRET), ou CLOVER_MERCHANT_ID et CLOVER_ACCESS_TOKEN, pour envoyer les commandes dans Clover.',
  };
}

/**
 * `skipped` = Clover is deliberately not in the picture (injection off, or no merchant configured anywhere); every other
 * miss is a failure. `uncertain` = the answer was lost (time-out, 5xx): Clover may have created the order anyway.
 * totalCents = Clover's own total for the new order, when Clover returns it (taxes computed by Clover).
 */
export type InjectResult =
  | { ok: true; posOrderId: string; totalCents?: number; lineItems?: number; freeLines?: number; adopted?: boolean }
  | { ok: false; skipped?: boolean; error: string; httpStatus?: number; uncertain?: boolean };

/**
 * True when this deployment expects orders to reach Clover: injection on and either a merchant in the environment
 * or the Clover app configured (merchants then connect with one click — an order must still never be accepted
 * without Clover just because the merchant came through the app instead of an env token).
 */
export function cloverExpected(): boolean {
  return cloverInjectionEnabled() && (knownCloverMerchants().length > 0 || cloverAppConfigured());
}

/** The merchant to use when a store has none: CLOVER_MERCHANT_ID, else the only merchant connected through the app. */
export async function defaultCloverMerchant(): Promise<string | null> {
  if (process.env.CLOVER_MERCHANT_ID) return process.env.CLOVER_MERCHANT_ID;
  const connected = await connectedCloverMerchantIds().catch(() => [] as string[]);
  return connected.length === 1 ? connected[0] : null;
}

/**
 * Order-level Clover discount for the platform promotion on the order (NormalizedOrder.discount: restaurant-funded,
 * pre-tax, in dollars). It is the same discount the hand-off payment subtracts (cloverPaymentAmounts: subtotal −
 * discount + tax), so Clover's own total matches the payment and the order closes as paid instead of showing a
 * balance due. Clover Discount objects take a NEGATIVE amount in cents and a name of at most 64 characters.
 * Capped at the line items so a Clover total never goes negative; null below one cent (same toCents rounding).
 */
export function cloverOrderDiscount(order: Pick<StoredOrder, 'marketplace' | 'discount'>, lineItemsTotalCents: number): { name: string; amount: number } | null {
  const cents = Math.min(Math.max(0, toCents(order.discount)), Math.max(0, Math.round(Number(lineItemsTotalCents) || 0)));
  if (cents < 1) return null;
  const label = MARKETPLACE_LABELS[order.marketplace] || order.marketplace;
  return { name: `${label} promotion`.slice(0, 64), amount: -cents };
}

export async function injectOrder(order: StoredOrder, merchantId?: string | null, opts: { orderTypeId?: string | null } = {}): Promise<InjectResult> {
  if (!cloverInjectionEnabled()) return { ok: false, skipped: true, error: 'POS injection is turned off (FOODHUB_POS_INJECTION=off).' };
  const mid = merchantId || (await defaultCloverMerchant());
  // No merchant for this store: harmless only when Clover is not configured at all; otherwise the store mapping is incomplete.
  if (!mid) return { ok: false, skipped: !cloverExpected(), error: 'No Clover merchant configured for this store — set it under Stores → Mapping.' };
  const token = await cloverToken(mid);
  // A mapped merchant without a token is a configuration fault, never a reason to accept without Clover.
  if (!token) return { ok: false, skipped: false, error: `No Clover API token for merchant ${mid} (install the Clover app for it, or add it to CLOVER_MERCHANT_TOKENS).` };

  // Lines linked to Clover inventory items with their real modifications, free-text lines flagged (pos/clover-order.ts);
  // the platform promotion as an order-level discount (negative cents) — absent when there is none.
  const draft = buildCloverOrderCart(order, { orderTypeId: opts.orderTypeId });
  if (draft.lineItems === 0) return { ok: false, error: 'Order has no line items to inject.' };
  const discount = cloverOrderDiscount(order, draft.linesCents);
  const body = (discount ? buildCloverOrderCart(order, { orderTypeId: opts.orderTypeId, discount }) : draft).body;

  try {
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/atomic_order/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // 4xx: Clover refused it (nothing created). 5xx: a gateway may have answered after Clover created it — uncertain.
    if (!res.ok) return { ok: false, error: `Clover returned HTTP ${res.status}: ${text.slice(0, 300)}`, httpStatus: res.status, uncertain: res.status >= 500 };
    const json = text ? JSON.parse(text) : {};
    if (!json.id) return { ok: false, error: 'Clover response did not include an order id.', uncertain: true };
    const total = Number(json.total);
    return { ok: true, posOrderId: String(json.id), lineItems: draft.lineItems, freeLines: draft.freeLines, ...(Number.isFinite(total) ? { totalCents: total } : {}) };
  } catch (error) {
    // A time-out or a dropped connection: Clover may or may not have the order — the retry looks before sending again.
    return { ok: false, error: `Clover network error: ${error instanceof Error ? error.message : String(error)}`, uncertain: true };
  }
}

async function cloverGetAll(mid: string, token: string, path: string, expand: string): Promise<any[]> {
  const out: any[] = [];
  const limit = 1000;
  for (let offset = 0; offset < 20000; offset += limit) {
    const url = `${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/${path}?limit=${limit}&offset=${offset}${expand ? `&expand=${expand}` : ''}`;
    const res = await timedFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Clover ${path} returned HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.elements) ? json.elements : [];
    out.push(...rows);
    if (rows.length < limit) break;
  }
  return out;
}

/**
 * Build a master menu from Clover. Clover stays the source of truth for item ids, names, base prices and option
 * groups (menu/clover-import.ts). opts.cloverMenuId = one of the merchant's Clover menus (e.g. the DoorDash +20 %
 * menu): only its items, with its photos and descriptions, and its prices as platform prices (opts.platformPrices).
 * The import report rides along as `importReport` (the caller keeps it out of the saved menu).
 */
export async function importMenuFromClover(brandName: string, merchantId?: string | null, opts: { cloverMenuId?: string | null; platformPrices?: Marketplace[]; includeArchived?: boolean } = {}): Promise<MasterMenu & { importReport?: CloverImportReport }> {
  const mid = merchantId || process.env.CLOVER_MERCHANT_ID;
  if (!mid) throw new Error('No Clover merchant id. Set CLOVER_MERCHANT_ID or pass a merchant id.');
  const token = await cloverToken(mid);
  if (!token) throw new Error(`No Clover API token for merchant ${mid}.`);

  const [items, groups] = await Promise.all([
    cloverGetAll(mid, token, 'items', 'categories,modifierGroups'),
    cloverGetAll(mid, token, 'modifier_groups', 'modifiers'),
  ]);
  let menuItems: CloverMenuItem[] | undefined;
  let menuInfo: { id: string; name: string } | undefined;
  if (opts.cloverMenuId) {
    const menus = await listCloverMenus(cloverBaseUrl(), mid, token);
    if (!menus.ok) throw new Error(`Clover menus could not be read for merchant ${mid} (${menus.error}) — import the inventory instead (no Clover menu chosen).`);
    const chosen = menus.menus.find((m) => m.id === opts.cloverMenuId);
    if (!chosen) throw new Error(`Clover menu ${opts.cloverMenuId} not found on merchant ${mid}.`);
    menuItems = await cloverMenuItems(cloverBaseUrl(), mid, token, chosen.id);
    menuInfo = { id: chosen.id, name: chosen.name };
  }
  const { menu, report } = buildMenuFromClover(brandName, items, groups, { menuItems, menuInfo, platformPrices: opts.platformPrices, includeArchived: opts.includeArchived });
  return { ...menu, importReport: report };
}

/**
 * Prints the order on the Clover device's order (kitchen) printer:
 * POST /v3/merchants/{mId}/print_event  { orderRef: { id } }  — needs "Write orders" permission.
 * Orders created through the API do not print by themselves, so Food Hub fires this right after injection
 * (FOODHUB_CLOVER_AUTOPRINT=off to disable; CLOVER_PRINT_DEVICE_ID targets one device of CLOVER_MERCHANT_ID,
 * CLOVER_PRINT_DEVICES={"MERCHANT_ID":"deviceId"} one device per merchant — a device belongs to a single merchant).
 */
export function cloverAutoPrintEnabled(): boolean {
  return process.env.FOODHUB_CLOVER_AUTOPRINT !== 'off';
}

/** Kitchen printer device for a merchant, or null = the merchant's default printer. */
export function cloverPrintDeviceFor(merchantId: string): string | null {
  try {
    const map = JSON.parse(process.env.CLOVER_PRINT_DEVICES || '{}') as Record<string, string>;
    if (map[merchantId]) return String(map[merchantId]);
  } catch { /* ignore malformed map */ }
  const single = process.env.CLOVER_PRINT_DEVICE_ID;
  if (single && (!process.env.CLOVER_MERCHANT_ID || process.env.CLOVER_MERCHANT_ID === merchantId)) return single;
  return null;
}

export async function printCloverOrder(posOrderId: string, merchantId?: string | null): Promise<{ ok: boolean; message: string; printEventId?: string }> {
  const mid = merchantId || process.env.CLOVER_MERCHANT_ID;
  if (!mid) return { ok: false, message: 'No Clover merchant configured.' };
  const token = await cloverToken(mid);
  if (!token) return { ok: false, message: `No Clover API token for merchant ${mid}.` };
  const device = cloverPrintDeviceFor(mid);
  try {
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(mid)}/print_event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderRef: { id: posOrderId }, ...(device ? { deviceRef: { id: device } } : {}) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: `Clover print HTTP ${res.status}` };
    return { ok: json?.state !== 'FAILED', message: json?.state === 'FAILED' ? 'Clover reported the print failed' : 'Sent to the Clover kitchen printer', printEventId: json?.id };
  } catch (error) {
    return { ok: false, message: `Clover print error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface CloverSales {
  merchantId: string;
  ok: boolean;
  /** Successful payments taken on this Clover merchant since `sinceMs` (incl. tax, excl. tips). */
  gross: number;
  tips: number;
  tax: number;
  refunds: number;
  net: number;
  payments: number;
  error?: string;
}

// Payments recorded with a platform tender ("Uber Eats", "DoorDash", "DoorDash Payment"…) are delivery sales,
// never in-store — whether Food Hub recorded them or Clover's own platform integration did.

// Payments recorded with a platform tender ("Uber Eats", "DoorDash"…) are delivery sales, never in-store.
const PLATFORM_TENDERS = new Set(['uber eats', 'doordash', 'skipthedishes', 'skip the dishes', 'skip', 'too good to go', 'tgtg', 'uber']);

async function cloverPaged(merchantId: string, token: string, resource: 'payments' | 'refunds', sinceMs: number): Promise<any[]> {
  const out: any[] = [];
  const limit = 1000;
  for (let page = 0; page < 20; page++) {
    // Refunds carry a bare orderRef { id }; the payment is expanded for the fallback order/tender lookup.
    const qs = new URLSearchParams({ filter: `createdTime>=${sinceMs}`, limit: String(limit), offset: String(page * limit), expand: resource === 'payments' ? 'tender' : 'payment' });
    const res = await timedFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(merchantId)}/${resource}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Clover ${resource} HTTP ${res.status}`);
    const json = await res.json();
    const rows: any[] = Array.isArray(json?.elements) ? json.elements : [];
    out.push(...rows);
    if (rows.length < limit) break;
  }
  return out;
}

/**
 * In-store sales for one Clover merchant since `sinceMs` (usually local midnight).
 * Delivery orders that Food Hub injected are excluded (their order ids are passed in),
 * so delivery revenue is never counted twice.
 */
export async function cloverSalesSince(merchantId: string, sinceMs: number, excludeOrderIds: Set<string> = new Set()): Promise<CloverSales> {
  const empty = { merchantId, gross: 0, tips: 0, tax: 0, refunds: 0, net: 0, payments: 0 };
  const token = await cloverToken(merchantId);
  if (!token) return { ...empty, ok: false, error: `No Clover API token for merchant ${merchantId}` };
  try {
    const platformTender = (tender: any) => PLATFORM_TENDERS.has(String(tender?.label ?? '').trim().toLowerCase());
    // Voided payments keep result SUCCESS with voided:true — they are not sales.
    const payments = (await cloverPaged(merchantId, token, 'payments', sinceMs))
      .filter((p) => (p.result ?? 'SUCCESS') === 'SUCCESS' && !p.voided && !(p.order?.id && excludeOrderIds.has(String(p.order.id))) && !platformTender(p.tender));
    // Clover v3 Refund references the order as orderRef { id } (payment.order.id only when the payment is expanded).
    const refunds = (await cloverPaged(merchantId, token, 'refunds', sinceMs).catch(() => []))
      .filter((r) => { const oid = r.orderRef?.id ?? r.payment?.order?.id; return !(oid && excludeOrderIds.has(String(oid))) && !platformTender(r.payment?.tender); });
    const sum = (rows: any[], f: string) => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const gross = fromCents(sum(payments, 'amount'));
    const refundTotal = fromCents(sum(refunds, 'amount'));
    return {
      merchantId,
      ok: true,
      gross,
      tips: fromCents(sum(payments, 'tipAmount')),
      tax: fromCents(sum(payments, 'taxAmount')),
      refunds: refundTotal,
      net: Math.round((gross - refundTotal) * 100) / 100,
      payments: payments.length,
    };
  } catch (error) {
    return { ...empty, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Same as knownCloverMerchants, plus every merchant connected through the Clover app. */
export async function allCloverMerchants(storeMerchantIds: Array<string | null | undefined> = []): Promise<string[]> {
  const set = new Set(knownCloverMerchants(storeMerchantIds));
  for (const m of await connectedCloverMerchantIds().catch(() => [] as string[])) set.add(m);
  return [...set];
}

/** Every Clover merchant Food Hub knows about: the default one, the token map, and store mappings. */
export function knownCloverMerchants(storeMerchantIds: Array<string | null | undefined> = []): string[] {
  const set = new Set<string>();
  if (process.env.CLOVER_MERCHANT_ID) set.add(process.env.CLOVER_MERCHANT_ID);
  try { for (const k of Object.keys(JSON.parse(process.env.CLOVER_MERCHANT_TOKENS || '{}'))) set.add(k); } catch { /* ignore */ }
  for (const m of storeMerchantIds) if (m) set.add(m);
  return [...set];
}
