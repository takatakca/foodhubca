// How a platform order becomes a Clover order the kitchen can trust.
//
//  1. mapOrderLines — every line is linked to a Clover inventory item, and every option to a Clover modifier:
//       by id first (the platform echoes the ref Food Hub published: the Clover item / modifier id after an import),
//       then by name (accents, case, punctuation and plural s/x ignored; "Poulet / Chicken" bilingual titles split),
//       and when nothing matches the line still goes to Clover as a free-text line — with a visible warning on the
//       order, on the kitchen screen and on the Clover ticket. A line is never dropped.
//  2. buildCloverOrderCart — the atomic-order body: inventory items with their real Clover modifications (name +
//       amount override the inventory defaults, so Clover's total equals what the customer paid), the platform
//       promotion as an order-level discount, the order type, a short title and a kitchen note (customer, phone,
//       delivery or pickup, courier, allergies).
//  3. cloverOrderTypeForOrder — "Online Order Delivery" / "Online Order Pick Up" when the merchant has them,
//       otherwise one order type per platform ("Uber Eats", "DoorDash"…, created once).
//
// Clover docs: POST /v3/merchants/{mId}/atomic_order/orders — lineItems[].item.id, lineItems[].modifications[]
// { modifier: { id }, name, amount } ("If you pass both name and amount values, these override default modifiers set
// in the merchant's inventory"). Tax rates come from each inventory item and cannot be overridden on an atomic order.
import { MARKETPLACE_LABELS, timedFetch, toCents } from '../config';
import type { ChannelKey, MasterMenu, MenuItem, MenuModifier, OrderLine, OrderMappingWarning, OrderModifier, StoredOrder } from '../types';
import { customerContact } from '../watch/customer';
import { cloverOrderTypeFor, cloverOrderTypesEnabled } from './clover-books';

// ---------------------------------------------------------------- names

/** "Poutine Moyenne!" ≈ "poutine moyennes" ≈ "POUTINE  MOYENNE": lower case, no accents, no punctuation, no plural s/x. */
export function normName(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w))
    .join(' ');
}

/** Name variants a platform may send back: the published bilingual label "FR / EN" is split into both halves. */
function nameKeys(name: string): string[] {
  const parts = [name, ...name.split(/\s+\/\s+/)];
  return [...new Set(parts.map(normName).filter(Boolean))];
}

// ---------------------------------------------------------------- mapping

export type LineMapping = 'id' | 'name' | 'free';
export type MappingWarning = OrderMappingWarning;
export interface MappingResult {
  lines: OrderLine[];
  warnings: MappingWarning[];
  stats: { items: number; itemsById: number; itemsByName: number; itemsFree: number; modifiers: number; modifiersLinked: number };
}

const strip = (id: unknown) => String(id ?? '').replace(/^mod:/, '').trim();

/**
 * Links each order line (and option) to the Clover inventory through the brand's master menu.
 * `foreign`: the menu was imported from another Clover merchant than the one this store uses — Clover ids from it
 * would be refused, so every line goes as free text (one warning for the whole order).
 */
export function mapOrderLines(lines: OrderLine[], menu: MasterMenu | null, opts: { foreign?: boolean } = {}): MappingResult {
  const stats = { items: lines.length, itemsById: 0, itemsByName: 0, itemsFree: 0, modifiers: 0, modifiersLinked: 0 };
  const warnings: MappingWarning[] = [];
  const items = menu?.items ?? [];
  const groups = new Map((menu?.modifierGroups ?? []).map((g) => [g.ref, g]));
  const allMods: MenuModifier[] = (menu?.modifierGroups ?? []).flatMap((g) => g.modifiers);
  const byId = new Map<string, MenuItem>();
  for (const i of items) { byId.set(i.ref, i); if (i.posItemRef) byId.set(i.posItemRef, i); }
  const byName = new Map<string, MenuItem>();
  // Items linked to Clover win a name clash; first one otherwise.
  for (const i of [...items.filter((x) => x.posItemRef), ...items.filter((x) => !x.posItemRef)]) {
    for (const k of nameKeys(i.name).concat(i.nameFr ? nameKeys(i.nameFr) : [])) if (!byName.has(k)) byName.set(k, i);
  }
  const findMod = (m: OrderModifier, pool: MenuModifier[]): MenuModifier | undefined => {
    const id = strip(m.externalId);
    if (id) {
      const hit = pool.find((x) => x.ref === id || x.posModifierRef === id) ?? allMods.find((x) => x.ref === id || x.posModifierRef === id);
      if (hit) return hit;
    }
    const keys = nameKeys(m.name);
    const named = (list: MenuModifier[]) => list.find((x) => nameKeys(x.name).concat(x.nameFr ? nameKeys(x.nameFr) : []).some((k) => keys.includes(k)));
    return named(pool) ?? named(allMods);
  };

  if (opts.foreign && lines.length) warnings.push({ line: -1, kind: 'item', name: '*', reason: 'foreign_menu' });
  if (!menu && lines.length) warnings.push({ line: -1, kind: 'item', name: '*', reason: 'no_menu' });

  const out = lines.map((l, idx): OrderLine => {
    stats.modifiers += l.modifiers.length;
    // Already linked (orders read back from Clover carry their own Clover ids).
    if (l.posItemRef && !opts.foreign) {
      stats.itemsById++;
      stats.modifiersLinked += l.modifiers.filter((m) => m.posModifierRef).length;
      return { ...l, mapping: 'id' };
    }
    const ext = strip(l.externalId);
    let item = ext ? byId.get(ext) : undefined;
    let how: LineMapping = item ? 'id' : 'free';
    if (!item) { item = nameKeys(l.name).map((k) => byName.get(k)).find(Boolean); if (item) how = 'name'; }
    if (!item || opts.foreign || !menu) {
      if (menu && !opts.foreign) warnings.push({ line: idx, kind: 'item', name: l.name, reason: 'no_match' });
      stats.itemsFree++;
      return { ...l, posItemRef: undefined, mapping: 'free', modifiers: l.modifiers.map((m) => ({ ...m, posModifierRef: undefined })) };
    }
    if (!item.posItemRef) {
      warnings.push({ line: idx, kind: 'item', name: l.name, reason: 'no_clover_link' });
      stats.itemsFree++;
      return { ...l, posItemRef: undefined, mapping: 'free', modifiers: l.modifiers.map((m) => ({ ...m, posModifierRef: undefined })) };
    }
    if (how === 'id') stats.itemsById++; else stats.itemsByName++;
    const pool = item.modifierGroupRefs.flatMap((r) => groups.get(r)?.modifiers ?? []);
    const modifiers = l.modifiers.map((m): OrderModifier => {
      const hit = findMod(m, pool);
      if (hit?.posModifierRef) { stats.modifiersLinked++; return { ...m, posModifierRef: hit.posModifierRef }; }
      warnings.push({ line: idx, kind: 'modifier', name: m.name, reason: hit ? 'no_clover_link' : 'no_match' });
      return { ...m, posModifierRef: undefined };
    });
    return { ...l, posItemRef: item.posItemRef, mapping: how, modifiers };
  });
  return { lines: out, warnings, stats };
}

/** One sentence per warning, French and English, for the order page, the kitchen card and the activity log. */
export function describeMappingWarnings(warnings: MappingWarning[]): Array<{ fr: string; en: string }> {
  return warnings.map((w) => {
    if (w.reason === 'foreign_menu') return { fr: 'Le menu vient d’un autre marchand Clover : tous les articles arrivent en texte libre dans Clover.', en: 'The menu comes from another Clover merchant: every item reaches Clover as free text.' };
    if (w.reason === 'no_menu') return { fr: 'Aucun menu Food Hub pour cette marque : tous les articles arrivent en texte libre dans Clover.', en: 'No Food Hub menu for this brand: every item reaches Clover as free text.' };
    const what = w.kind === 'item' ? ['Article', 'Item'] : ['Option', 'Option'];
    return w.reason === 'no_clover_link'
      ? { fr: `${what[0]} « ${w.name} » n’est pas relié à Clover — envoyé en texte libre.`, en: `${what[1]} “${w.name}” is not linked to Clover — sent as free text.` }
      : { fr: `${what[0]} « ${w.name} » introuvable dans le menu — envoyé en texte libre, vérifiez le billet.`, en: `${what[1]} “${w.name}” not found in the menu — sent as free text, check the ticket.` };
  });
}

// ---------------------------------------------------------------- the Clover order body

/** Kitchen-ticket note for a line that is not a Clover inventory item (visible on the Clover order and printout). */
export const FREE_TEXT_NOTE = '⚠ Hors inventaire Clover / not in Clover inventory';

export interface CloverCart {
  body: { orderCart: Record<string, unknown> };
  /** Sum of line prices + modification amounts, in cents (before discount and Clover's own tax). */
  linesCents: number;
  lineItems: number;
  freeLines: number;
}

function scheduledLabel(iso: string) {
  return `SCHEDULED ${new Date(iso).toLocaleString('fr-CA', { timeZone: process.env.FOODHUB_TIMEZONE || 'America/Toronto', weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

const FULFILLMENT_NOTE: Record<StoredOrder['fulfillment'], string> = { delivery: 'LIVRAISON / DELIVERY', pickup: 'CUEILLETTE / PICKUP', dine_in: 'SUR PLACE / DINE IN' };

/** The note Clover shows (and prints) with the order: when, who, how it leaves, the customer's own words. Max 255. */
export function cloverOrderNote(order: StoredOrder, freeLines = 0): string {
  const c = customerContact(order);
  const courier = order.timeline?.courier?.name ? `Livreur/Courier: ${order.timeline.courier.name}` : '';
  const parts = [
    order.timeline?.scheduledFor ? scheduledLabel(order.timeline.scheduledFor) : '',
    FULFILLMENT_NOTE[order.fulfillment] ?? order.fulfillment.toUpperCase(),
    order.customerName ? `Client: ${order.customerName}` : '',
    c.phone ? `Tél: ${c.phone}${c.code ? ` code ${c.code}` : ''}` : '',
    courier,
    order.notes || '',
    freeLines ? `⚠ ${freeLines} article(s) hors inventaire Clover` : '',
  ].filter(Boolean);
  return parts.join(' | ').slice(0, 255);
}

/**
 * The atomic-order body. Prices are the platform's (what the customer paid), in cents:
 *  - inventory item: price = item unit price (+ options Clover does not know), modifications carry their own amounts;
 *  - free-text line: price = unit price + every option, options listed in the note.
 * One Clover line per unit (Clover's own convention for items sold by the piece).
 */
export function buildCloverOrderCart(order: StoredOrder, opts: { orderTypeId?: string | null; discount?: { name: string; amount: number } | null } = {}): CloverCart {
  const lineItems: Record<string, unknown>[] = [];
  let linesCents = 0;
  let freeLines = 0;
  for (const line of order.lines) {
    const linked = Boolean(line.posItemRef);
    const mods = line.modifiers.map((m) => ({ ...m, qty: Math.max(1, Math.round(m.quantity || 1)) }));
    const asModification = (m: (typeof mods)[number]) => linked && Boolean(m.posModifierRef);
    const looseCents = mods.filter((m) => !asModification(m)).reduce((s, m) => s + toCents(m.unitPrice) * m.qty, 0);
    const modifications = mods.filter(asModification).flatMap((m) => Array.from({ length: m.qty }, () => ({ modifier: { id: m.posModifierRef }, name: m.name.slice(0, 127), amount: toCents(m.unitPrice) })));
    const note = [
      ...mods.filter((m) => !asModification(m)).map((m) => `${m.qty > 1 ? `${m.qty}x ` : ''}${m.name}`),
      line.notes ? `Note: ${line.notes}` : '',
      linked ? '' : FREE_TEXT_NOTE,
    ].filter(Boolean).join(', ').slice(0, 255);
    const price = toCents(line.unitPrice) + looseCents;
    const base: Record<string, unknown> = { name: line.name.slice(0, 127), price };
    if (linked) base.item = { id: line.posItemRef };
    if (modifications.length) base.modifications = modifications;
    if (note) base.note = note;
    const qty = Math.max(1, Math.min(Math.round(line.quantity || 1), 99));
    if (!linked) freeLines++;
    for (let i = 0; i < qty; i += 1) {
      lineItems.push(modifications.length ? { ...base, modifications: modifications.map((x) => ({ ...x })) } : { ...base });
      linesCents += price + modifications.reduce((s, x) => s + x.amount, 0);
    }
  }
  const scheduled = Boolean(order.timeline?.scheduledFor);
  return {
    body: {
      orderCart: {
        title: cloverOrderTitle(order, scheduled ? '⏰ ' : ''),
        note: cloverOrderNote(order, freeLines),
        lineItems,
        ...(opts.discount ? { discounts: [opts.discount] } : {}),
        ...(opts.orderTypeId ? { orderType: { id: opts.orderTypeId } } : {}),
      },
    },
    linesCents,
    lineItems: lineItems.length,
    freeLines,
  };
}

/** "<Platform> #<short id>" — also how Food Hub recognises its own orders when it reads Clover back. */
export function cloverOrderTitle(order: Pick<StoredOrder, 'marketplace' | 'displayId' | 'externalOrderId'>, prefix = ''): string {
  const label = MARKETPLACE_LABELS[order.marketplace] || order.marketplace;
  return `${prefix}${label} #${order.displayId || order.externalOrderId.slice(0, 8)}`.slice(0, 127);
}

// ---------------------------------------------------------------- totals and tips

/** What the platform says the customer paid for the food, in cents: subtotal − promotion + tax (same as the payment). */
export function platformFoodCents(order: Pick<StoredOrder, 'subtotal' | 'discount' | 'tax'>): number {
  return Math.max(0, toCents((Number(order.subtotal) || 0) - (Number(order.discount) || 0) + (Number(order.tax) || 0)));
}

/**
 * Clover's total after injection vs the platform's, in cents. Clover computes its own tax from each item's tax rates:
 * a different total almost always means a Clover tax setting (e.g. the stray default "Sales Tax" 0.14975 %), which
 * Food Hub flags but never changes. Tolerance: 1 cent per line (per-line rounding).
 */
export function cloverTotalGap(order: StoredOrder, cloverTotalCents: number, lineItems: number): { gapCents: number; flagged: boolean } {
  const expected = platformFoodCents(order);
  const gapCents = Math.round(cloverTotalCents - expected);
  return { gapCents, flagged: expected > 0 && Math.abs(gapCents) > Math.max(2, lineItems) };
}

/**
 * Tips the restaurant keeps go on the Clover payment (tip-outs, "Quebec Pourboire"); a delivery tip belongs to the
 * courier and never does. Pickup / dine-in, and Uber's "delivery by restaurant", keep their tip. Off with
 * FOODHUB_CLOVER_RECORD_TIPS=off.
 */
export function cloverTipCents(order: Pick<StoredOrder, 'tip' | 'fulfillment' | 'raw'>): number {
  if (process.env.FOODHUB_CLOVER_RECORD_TIPS === 'off') return 0;
  const ownDelivery = String((order.raw as { type?: unknown } | null)?.type ?? '').toUpperCase() === 'DELIVERY_BY_RESTAURANT';
  if (order.fulfillment === 'delivery' && !ownDelivery) return 0;
  return Math.max(0, toCents(order.tip));
}

// ---------------------------------------------------------------- idempotency

/**
 * An order Food Hub may already have created in Clover (the answer was lost: time-out, 5xx): looked up by its title
 * among the orders created since `sinceMs`, so a retry adopts it instead of printing a second kitchen ticket.
 */
export async function findCloverOrderByTitle(mid: string, token: string, base: string, order: Pick<StoredOrder, 'marketplace' | 'displayId' | 'externalOrderId'>, sinceMs: number): Promise<{ id: string; totalCents?: number } | null> {
  const want = cloverOrderTitle(order).toLowerCase();
  const qs = new URLSearchParams({ filter: `createdTime>=${Math.floor(sinceMs)}`, limit: '100' });
  const res = await timedFetch(`${base}/v3/merchants/${encodeURIComponent(mid)}/orders?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Clover orders HTTP ${res.status}`);
  const rows: any[] = (await res.json())?.elements ?? [];
  const hit = rows.find((o) => String(o?.title ?? '').replace(/^⏰\s*/, '').trim().toLowerCase() === want && !/^cancel/i.test(String(o?.title ?? '')));
  if (!hit?.id) return null;
  const total = Number(hit.total);
  return { id: String(hit.id), ...(Number.isFinite(total) ? { totalCents: total } : {}) };
}

// ---------------------------------------------------------------- order types

type OrderTypeRow = { id: string; label: string; hidden?: boolean };
const typeCache = new Map<string, { at: number; rows: OrderTypeRow[] }>();

async function listOrderTypes(mid: string, token: string, base: string): Promise<OrderTypeRow[]> {
  const hit = typeCache.get(mid);
  // Order types change rarely: read once every 10 minutes per merchant (FOODHUB_CLOVER_ORDER_TYPES_TTL_S).
  const ttl = Number(process.env.FOODHUB_CLOVER_ORDER_TYPES_TTL_S ?? 600) * 1000;
  if (hit && Date.now() - hit.at < ttl) return hit.rows;
  const res = await timedFetch(`${base}/v3/merchants/${encodeURIComponent(mid)}/order_types?limit=200`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Clover order_types HTTP ${res.status}`);
  const rows = ((await res.json())?.elements ?? []).filter((e: any) => e?.id).map((e: any) => ({ id: String(e.id), label: String(e.label ?? e.labelKey ?? ''), hidden: e.hidden === true }));
  typeCache.set(mid, { at: Date.now(), rows });
  return rows;
}

/** The merchant's own "delivery" / "pickup" order type, visible ones first. */
export function pickFulfillmentType(rows: OrderTypeRow[], fulfillment: StoredOrder['fulfillment']): string | null {
  const tests: RegExp[] = fulfillment === 'pickup'
    ? [/online\s*order\s*pick\s*-?\s*up/i, /^(pick\s*-?\s*up|cueillette|pour\s+emporter|take\s*-?\s*out|à\s*emporter)$/i]
    : fulfillment === 'delivery'
      ? [/online\s*order\s*delivery/i, /^(delivery|livraison)$/i]
      : [];
  for (const re of tests) {
    const hits = rows.filter((r) => re.test(r.label.trim()));
    const best = hits.find((r) => !r.hidden) ?? hits[0];
    if (best) return best.id;
  }
  return null;
}

/** CLOVER_ORDER_TYPES={"delivery":"…","pickup":"…"} or per merchant {"MID":{"delivery":"…","pickup":"…"}}. */
function envOrderType(mid: string, fulfillment: StoredOrder['fulfillment']): string | null {
  try {
    const map = JSON.parse(process.env.CLOVER_ORDER_TYPES || '{}') as Record<string, unknown>;
    const scoped = (map[mid] && typeof map[mid] === 'object' ? map[mid] : map) as Record<string, unknown>;
    const v = scoped[fulfillment];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch { return null; }
}

/**
 * Order type for a delivery order in this merchant's Clover. FOODHUB_CLOVER_ORDER_TYPE_MODE=platform keeps the
 * one-type-per-platform behaviour; the default uses the merchant's delivery / pickup types when it has them.
 */
export async function cloverOrderTypeForOrder(mid: string | null | undefined, order: Pick<StoredOrder, 'channel' | 'fulfillment'>, auth?: { token: string | null; base: string }): Promise<string | null> {
  if (!mid || !cloverOrderTypesEnabled()) return null;
  if (process.env.FOODHUB_CLOVER_ORDER_TYPE_MODE !== 'platform') {
    const fromEnv = envOrderType(mid, order.fulfillment);
    if (fromEnv) return fromEnv;
    if (auth?.token) {
      const rows = await listOrderTypes(mid, auth.token, auth.base).catch(() => [] as OrderTypeRow[]);
      const hit = pickFulfillmentType(rows, order.fulfillment);
      if (hit) return hit;
    }
  }
  return cloverOrderTypeFor(mid, order.channel as ChannelKey);
}

/** Tests: forget cached order types. */
export function _resetOrderTypeCache() { typeCache.clear(); }
