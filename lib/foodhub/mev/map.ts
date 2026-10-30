// Food Hub order → foodhub.sale.v1 (docs/MEV_INTEGRATION.md § mapping). Pure functions: no I/O, so every rule is
// unit-tested with fixtures per channel (tests/mev-map.test.ts).
//
// Which orders: platform orders once accepted (or ready with FOODHUB_MEV_TRIGGER=ready), Skip orders handed to the
// Skip tablet (still made and sold), direct orders once paid (online, or at the counter / pickup).
// The Too Good To Go daily bag log too, as one LVT sale not printed (formImpr NON), only on a day with no per-order
// feed: the bags were sold, so Revenu Québec gets them (see docs/MEV_INTEGRATION.md § Too Good To Go).
// Never: dry-run (simulator) orders, kitchens not switched to QCMEV.
// Never invented: a line that is not a real item. When the platform's numbers do not add up, the order waits for a
// person (needs_human, reason amounts_mismatch / description_missing / no_lines): no « ÉCART », no « COMMANDE », no
// « divers », and « Rabais » only for a discount the restaurant really gave (Revenu Québec, « Description détaillée »).
// Money: integer cents; the restaurant's own supply only (no platform courier tip, platform delivery / service fee or
// platform-funded promotion); GST and QST rounded one by one; the tip (pourb) only when the restaurant keeps it, and
// never inside the total.
import crypto from 'node:crypto';
import type { DirectOrder } from '../delivery/types';
import type { OrderLine, StoredOrder } from '../types';
import { cents, preTaxFromIncluded, qty, reconcileTax, roundHalfUpDiv, taxByCode } from './money';
import type { FoodHubCreditV1, FoodHubPrintV1, FoodHubSaleV1, MevChannel, MevCreditReason, MevOrderModel, MevPayMode, MevReview, MevSaleLine, MevServiceType, MevTaxCode, MevTrigger, RegisterSale } from './types';

export const AUTO_USER = { id: 'FOODHUB-AUTO', name: 'FOODHUB-AUTO' } as const;
export const MEV_TZ = 'America/Montreal';

// ---------- canonical JSON, hashes, keys ----------

/** JSON with keys sorted at every level and undefined dropped: the same object always gives the same text. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** sha256 of the canonical JSON of a payload without its own payloadHash. */
export function payloadHashOf(p: Record<string, unknown>): string {
  const { payloadHash: _drop, ...rest } = p;
  void _drop;
  return sha256(canonicalJson(rest));
}

/**
 * fh:{tenant}:{model}:{channel}:{external id | direct order id}. Keys use only A-Z a-z 0-9 . _ # - and ":" (QCMEV's
 * key rule) and stay short enough for ":r1:cn:1" / ":pr:dup1" to fit in 160 characters.
 */
export function saleKeyFor(tenant: string, model: MevOrderModel, channel: MevChannel, ref: string): string {
  return `fh:${tenant}:${model}:${channel}:${String(ref).replace(/[^A-Za-z0-9._#-]+/g, '-').slice(0, 90)}`;
}
/** The credit note of one sale (each sale is credited at most once: a change is credit + corrected receipt). */
export const creditKeyFor = (saleKey: string, seq: number) => `${saleKey}:cn:${seq}`;
export const reissueKeyFor = (baseKey: string, seq: number) => `${baseKey}:r${seq}`;
export const printKeyFor = (saleKey: string, mode: 'RPR' | 'DUP', seq: number) => `${saleKey}:pr:${mode.toLowerCase()}${seq}`;
/** X-Event-Id = sha256(key + payloadHash): the same request always has the same event id. */
export const eventIdFor = (key: string, payloadHash: string) => sha256(`${key}${payloadHash}`);

// ---------- time ----------

/** ISO-8601 with the Montréal offset (-04:00 / -05:00), e.g. 2026-10-24T23:30:00-04:00. */
export function isoWithOffset(ms: number, timeZone = MEV_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offMin = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = offMin < 0 ? '-' : '+';
  const a = Math.abs(offMin);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${z(Math.floor(a / 60))}:${z(a % 60)}`;
}

// ---------- context ----------

export interface MapCtx {
  tenantId: string;
  /** Simulator mode: training transactions (modTrans FOR). */
  testMode: boolean;
  trigger: MevTrigger;
  /** Line tax code from the menu (MenuItem.mevTax); default FP. */
  taxCodeOf?: (line: OrderLine) => MevTaxCode | undefined;
  /** The kitchen holds a bar permit: alcohol lines are BAR, otherwise RES. */
  barPermit?: boolean;
  /** Keep the first mapping's moment (a re-mapping never moves the sale in time). */
  occurredAt?: string;
  /** Staff-chosen or Clover-read tender for a pay-at-pickup order. */
  tender?: MevPayMode | null;
  /** user: FOODHUB-AUTO always (default, until staff are registered in QCMEV), or the staff member who accepted. */
  userMode?: 'auto' | 'staff';
  /** A corrected receipt replacing a credited one: its own key and the key it replaces. */
  saleKey?: string;
  referenceSaleKey?: string;
}

export type Exclusion = 'log_order' | 'dry_run' | 'not_final' | 'cancelled_before_sale' | 'awaiting_payment' | 'tender_unknown' | MevReview;
export type MapResult = { ok: true; sale: FoodHubSaleV1; contentHash: string } | { ok: false; reason: Exclusion; detail?: string };

/** Exclusions a person must look at (the order's data cannot make a truthful invoice). */
export const REVIEW_REASONS: readonly MevReview[] = ['amounts_mismatch', 'description_missing', 'no_lines'];
export const isReview = (r: Exclusion): r is MevReview => (REVIEW_REASONS as readonly string[]).includes(r);

const LOG_ORDER = (o: Pick<StoredOrder, 'raw' | 'externalOrderId'>) => (o.raw as { source?: string } | undefined)?.source === 'daily_log' || o.externalOrderId.startsWith('tgtg-log-');

/** The fiscal content (lines + amounts + type): what a credit note must follow when it changes after the receipt. */
export function contentHashOf(s: Pick<FoodHubSaleV1, 'lines' | 'amounts' | 'fees' | 'discountCents' | 'serviceType'>): string {
  return sha256(canonicalJson({ lines: s.lines, amounts: s.amounts, fees: s.fees, discountCents: s.discountCents, serviceType: s.serviceType }));
}

/** unit × quantity in cents, halves away from zero (quantities up to 3 decimals) — QCMEV's lineTotal. */
export function lineCents(unitPriceCents: number, quantity: number): number {
  return roundHalfUpDiv(unitPriceCents * Math.round(quantity * 1000), 1000);
}

/**
 * Food Hub lines → MEV items. QCMEV's rule: an item's total is quantity × unit price (± 1 cent), and each option is its
 * own item (same tax code). So the option totals come out of the line total; amounts are never negative (an option
 * that lowers the price stays inside its line).
 */
function mapLines(lines: OrderLine[], ctx: MapCtx, alcoholOf: (l: OrderLine) => boolean, taxIncluded = false): MevSaleLine[] | { review: MevReview; detail: string } {
  const out: MevSaleLine[] = [];
  const named = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // A price that includes the taxes (Too Good To Go): the pre-tax price, worked out per unit.
  const pre = (c: number) => (taxIncluded ? preTaxFromIncluded(c) : c);
  for (const l of lines.filter((x) => (Number(x.quantity) || 0) > 0)) {
    const q = Math.round((Number(l.quantity) || 1) * 1000) / 1000;
    if (!named(l.name)) return { review: 'description_missing', detail: 'an item has no name' };
    const modifiers: MevSaleLine['modifiers'] = [];
    let modsAsCharged = 0;
    for (const m of l.modifiers ?? []) {
      const mq = Math.round((Number(m.quantity) || 1) * q * 1000) / 1000;
      const charged = Math.max(0, cents(m.unitPrice));
      // An unnamed option that costs nothing describes nothing: it is left out. One that costs something needs a person.
      if (!named(m.name)) {
        if (charged === 0) continue;
        return { review: 'description_missing', detail: `an option of « ${named(l.name).slice(0, 40)} » has no name` };
      }
      modsAsCharged += lineCents(charged, mq);
      const unit = pre(charged);
      modifiers.push({ description: named(m.name).slice(0, 100), quantity: qty(mq), unitPriceCents: unit, totalCents: lineCents(unit, mq) });
    }
    const unit = pre(Math.max(0, Math.round((cents(l.total) - modsAsCharged) / q)));
    out.push({
      ...(l.posItemRef || l.externalId ? { ref: String(l.posItemRef || l.externalId).slice(0, 60) } : {}),
      description: named(l.name).slice(0, 100),
      quantity: qty(q),
      unitPriceCents: unit,
      totalCents: lineCents(unit, q),
      taxCode: ctx.taxCodeOf?.(l) ?? 'FP',
      activity: alcoholOf(l) && ctx.barPermit ? 'BAR' : 'RES',
      modifiers,
    });
  }
  return out;
}

/** An item with its options (what it adds to the subtotal). */
const itemCents = (l: MevSaleLine) => l.totalCents + l.modifiers.reduce((s, m) => s + m.totalCents, 0);

interface Money { lines: MevSaleLine[]; deliveryCents: number; serviceFeeCents: number; discountCents: number; tipCents: number; platformTaxCents: number | null }

/** avantTax = items + options + the restaurant's fees − its discount; TPS / TVQ each rounded; apresTax = the sum exactly. */
function amountsFor(m: Money): { amounts: FoodHubSaleV1['amounts']; flags: NonNullable<FoodHubSaleV1['flags']> } {
  const parts = [
    ...m.lines.map((l) => ({ cents: itemCents(l), taxCode: l.taxCode })),
    { cents: m.deliveryCents, taxCode: 'FP' as const },
    { cents: m.serviceFeeCents, taxCode: 'FP' as const },
    // SPEC: the restaurant-funded discount lowers the fully taxable base (FP) first.
    { cents: -m.discountCents, taxCode: 'FP' as const },
  ];
  const subtotalCents = parts.reduce((s, p) => s + p.cents, 0);
  const computed = taxByCode(parts);
  const tax = reconcileTax({ gstCents: Math.max(0, computed.gstCents), qstCents: Math.max(0, computed.qstCents) }, m.platformTaxCents);
  return {
    amounts: { subtotalCents, gstCents: tax.gstCents, qstCents: tax.qstCents, totalCents: subtotalCents + tax.gstCents + tax.qstCents, tipCents: m.tipCents },
    flags: { ...(tax.taxGap ? { taxGap: true } : {}), ...(m.platformTaxCents === null ? { taxComputed: true } : {}) },
  };
}

/** How far the platform's subtotal may differ from its own lines (rounding): the lines are then the receipt. */
export const SUBTOTAL_ROUNDING_CENTS = 2;

/**
 * The receipt is the items. When the order's own subtotal is not the sum of its items by more than a rounding cent or
 * two (tax-included prices, a fee or a promotion folded in…), nothing is invented to make it add up: the sale waits
 * for a person. No item at all → waits too (QCMEV refuses an empty receipt, and « COMMANDE » describes nothing).
 */
function checkLines(mapped: MevSaleLine[] | { review: MevReview; detail: string }, subtotalCents: number | null): { lines: MevSaleLine[]; rounded: boolean } | { review: MevReview; detail: string } {
  if (!Array.isArray(mapped)) return mapped;
  if (!mapped.length) return { review: 'no_lines', detail: 'the order has no item' };
  if (subtotalCents === null) return { lines: mapped, rounded: false };
  const sum = mapped.reduce((s, l) => s + itemCents(l), 0);
  const gap = subtotalCents - sum;
  if (Math.abs(gap) > SUBTOTAL_ROUNDING_CENTS) return { review: 'amounts_mismatch', detail: `items ${(sum / 100).toFixed(2)} $ ≠ subtotal ${(subtotalCents / 100).toFixed(2)} $` };
  return { lines: mapped, rounded: gap !== 0 };
}

function finish(sale: Omit<FoodHubSaleV1, 'payloadHash'>): MapResult {
  const full = { ...sale, payloadHash: '' } as FoodHubSaleV1;
  full.payloadHash = payloadHashOf(full as unknown as Record<string, unknown>);
  return { ok: true, sale: full, contentHash: contentHashOf(full) };
}

// ---------- platform orders (StoredOrder) ----------

export function storedChannel(o: Pick<StoredOrder, 'channel' | 'viaHub'>): MevChannel {
  return o.viaHub === 'relay' ? 'relay' : o.channel;
}

/** Has the platform order become a sale? accept trigger: accepted or later; ready trigger: ready or later. Skip tablet orders count. */
export function storedIsFinal(o: Pick<StoredOrder, 'status' | 'channel'>, trigger: MevTrigger): boolean {
  if (o.status === 'failed') return o.channel === 'skip';
  return trigger === 'ready' ? ['ready', 'dispatched', 'completed'].includes(o.status) : ['accepted', 'ready', 'dispatched', 'completed'].includes(o.status);
}

export function storedExclusion(o: StoredOrder, opts: { dryRun?: boolean } = {}): Exclusion | null {
  if (opts.dryRun) return 'dry_run';
  // The Too Good To Go daily bag count is never a sale: it is typed after the day, for many customers at once, with no
  // customer left to hand an invoice to. Revenu Québec wants each meal's invoice at payment and each sale sent « sans
  // délai ». Each bag is its own LVT sale, printed at pickup: a TGTG e-mail order, or « Sac remis » (tgtg.ts).
  if (LOG_ORDER(o)) return 'log_order';
  return null;
}

/** The Too Good To Go daily bag count (lib/foodhub/tgtg.ts): for Food Hub's reports only, never sent to Takatak MEV. */
export const isBagLog = LOG_ORDER;

/** The moment the platform order became a sale (stable across re-mappings). */
export function storedOccurredMs(o: StoredOrder, trigger: MevTrigger): number {
  const t = o.timeline ?? {};
  const pick = trigger === 'ready' ? t.readyAt ?? t.dispatchedAt ?? t.completedAt : t.acceptedAt;
  const ms = Date.parse(pick ?? '') || Date.parse(o.createdAt) || Date.now();
  return ms;
}

export function toMevSaleFromStored(o: StoredOrder, ctx: MapCtx): MapResult {
  const ex = storedExclusion(o);
  if (ex) return { ok: false, reason: ex };
  if (!storedIsFinal(o, ctx.trigger)) return { ok: false, reason: o.status === 'cancelled' ? 'cancelled_before_sale' : 'not_final' };
  const channel = storedChannel(o);
  // Ordered on a digital platform → LVT, picked up or delivered (mention "COMMANDE PAR UNE PLATEFORME NUMÉRIQUE").
  const serviceType: MevServiceType = 'LVT';
  // Restaurant-funded discount only: DoorDash says who funds each promotion; the others record the restaurant's.
  const discount = o.channel === 'doordash' ? (o.doorDash?.merchantFundedDiscount ?? o.discount ?? 0) : (o.discount || 0);
  // Skip tablet orders arrive with tax 0 hard-coded: the tax is computed from the base.
  const skipTablet = o.channel === 'skip' && o.status === 'failed' && !o.tax;
  // Too Good To Go shows its price taxes included and sends no tax: the pre-tax prices are worked out, the tax computed.
  const taxIncluded = o.channel === 'tgtg' && !o.tax;
  // The items are the receipt; the platform's subtotal must agree with them (Skip: JET Connect item prices are before
  // tax, items_in_cart.inc_tax − tax = their sum). A restaurant-funded discount is the only « Rabais ».
  const discountCents = Math.max(0, cents(discount));
  const b = checkLines(mapLines(o.lines, ctx, () => false, taxIncluded), taxIncluded ? null : cents(o.subtotal));
  if ('review' in b) return { ok: false, reason: b.review, detail: b.detail };
  // No tip (pourb) on a platform order: the platform pays its courier, and an LVT receipt never carries one.
  const money = amountsFor({ lines: b.lines, deliveryCents: 0, serviceFeeCents: 0, discountCents, tipCents: 0, platformTaxCents: skipTablet || taxIncluded ? null : cents(o.tax) });
  if (taxIncluded) money.flags.taxIncluded = true;
  if (b.rounded) money.flags.subtotalRounded = true;
  const user = ctx.userMode === 'staff' && o.timeline?.acceptedBy && !['auto', 'clover'].includes(o.timeline.acceptedBy) ? { id: o.timeline.acceptedBy, name: o.timeline.acceptedBy } : { ...AUTO_USER };
  const saleKey = ctx.saleKey ?? saleKeyFor(ctx.tenantId, 'stored', channel, o.externalOrderId);
  return finish({
    schema: 'foodhub.sale.v1', tenantId: ctx.tenantId, locationId: o.locationCode ?? '', saleKey,
    occurredAt: ctx.occurredAt ?? isoWithOffset(storedOccurredMs(o, ctx.trigger)),
    source: { model: 'stored', channel, orderId: o.id, externalOrderId: o.externalOrderId, ...(o.displayId ? { displayId: o.displayId } : {}), ...(o.posOrderId ? { posOrderId: o.posOrderId } : {}), ...(o.brandName ? { brand: o.brandName } : {}) },
    serviceType, ecommerce: false, user,
    lines: b.lines,
    fees: { deliveryCents: 0, serviceFeeCents: 0 },
    discountCents,
    amounts: money.amounts,
    // Collected by the platform (SPEC: AUT until Revenu Québec answers); nothing to collect → AUC.
    payment: { mode: money.amounts.totalCents === 0 ? 'AUC' : 'AUT', collectedBy: 'platform' },
    // Platforms mask the customer's contact: the paper copy goes in the bag (or in the hand, for a Too Good To Go bag).
    receipt: { format: 'PAP', deliver: 'print' },
    ...(ctx.referenceSaleKey ? { referenceSaleKey: ctx.referenceSaleKey } : {}),
    testMode: ctx.testMode,
    ...(Object.keys(money.flags).length ? { flags: money.flags } : {}),
  });
}

// ---------- own orders (DirectOrder) ----------

export function directChannel(o: Pick<DirectOrder, 'source' | 'sourceRef'>): MevChannel {
  if (o.source === 'phone' || o.source === 'phone_ai') return 'phone';
  if (o.source === 'website') return String(o.sourceRef ?? '').startsWith('sf_') ? 'storefront' : 'website';
  if (o.source === 'clover_online') return 'clover_online';
  return 'manual';
}

/** Paid by Interac e-Transfer before the kitchen: a person confirmed the transfer arrived (delivery/interac.ts). */
export function interacPaid(o: Pick<DirectOrder, 'interac' | 'payment'>): boolean {
  return Boolean(o.interac?.receivedAt) && o.payment === 'paid';
}

/** The restaurant's own declared fees (the Interac e-Transfer fee), before tax, in cents. */
export function directFeeCents(o: Pick<DirectOrder, 'fees'>): number {
  return (o.fees ?? []).reduce((s, f) => s + Math.max(0, cents(Number(f.amount) || 0)), 0);
}

/** Paid online before the kitchen: paylink, our website marked paid, Clover Online Ordering, an Interac e-Transfer. */
export function paidOnline(o: Pick<DirectOrder, 'paylink' | 'source' | 'payment' | 'events'> & Partial<Pick<DirectOrder, 'interac'>>): boolean {
  if (o.paylink?.paidAt) return true;
  if (interacPaid(o)) return true;
  if (o.payment !== 'paid') return false;
  if (o.source === 'clover_online') return true;
  // Website / storefront orders that arrived already paid (no "Payment taken" by a person).
  return o.source === 'website' && !(o.events ?? []).some((e) => e.type === 'paid');
}

/** A direct order becomes a sale once paid online, or paid / handed over at the counter. */
export function directIsFinal(o: Pick<DirectOrder, 'status' | 'payment'>): boolean {
  if (o.status === 'awaiting_payment' || o.status === 'cancelled') return false;
  return o.payment === 'paid' || o.status === 'completed';
}

export function directOccurredMs(o: DirectOrder): number {
  const paidEv = [...(o.events ?? [])].find((e) => e.type === 'paid' || e.type === 'paylink_paid');
  const doneEv = [...(o.events ?? [])].reverse().find((e) => e.type === 'picked_up' || e.type === 'completed');
  const pick = o.paylink?.paidAt ?? (o.payment === 'paid' ? paidEv?.at ?? (o.source === 'website' || o.source === 'clover_online' ? o.placedAt : undefined) : undefined) ?? doneEv?.at;
  return Date.parse(pick ?? '') || Date.parse(o.updatedAt) || Date.now();
}

export function toMevSaleFromDirect(o: DirectOrder, ctx: MapCtx & { dryRun?: boolean }): MapResult {
  if (ctx.dryRun) return { ok: false, reason: 'dry_run' };
  if (o.status === 'awaiting_payment') return { ok: false, reason: 'awaiting_payment' };
  if (!directIsFinal(o)) return { ok: false, reason: o.status === 'cancelled' ? 'cancelled_before_sale' : 'not_final' };
  const channel = directChannel(o);
  const online = paidOnline(o);
  // Our own delivery (our couriers or a fleet the restaurant hires) → LVR; pickup → CMP (SPEC for phone / website pickup).
  const serviceType: MevServiceType = o.fulfillment === 'delivery' ? 'LVR' : 'CMP';
  const b = checkLines(mapLines(o.lines, ctx, (l) => Boolean((l as { alcohol?: boolean }).alcohol)), cents(o.subtotal));
  if ('review' in b) return { ok: false, reason: b.review, detail: b.detail };
  const deliveryCents = o.fulfillment === 'delivery' ? Math.max(0, cents(o.deliveryFee)) : 0;
  // The restaurant's own declared fee (Interac e-Transfer) is taxed and paid by the customer: part of avantTax (QCMEV
  // adds the service fee for every service type), so the invoice total is what the customer paid.
  const serviceFeeCents = directFeeCents(o);
  // The tax the customer was charged (Food Hub / Clover computed it); the split follows the base when it agrees.
  const money = amountsFor({ lines: b.lines, deliveryCents, serviceFeeCents, discountCents: 0, tipCents: Math.max(0, cents(o.tip)), platformTaxCents: cents(o.tax) });
  if (b.rounded) money.flags.subtotalRounded = true;
  let mode: MevPayMode | null;
  let collectedBy: FoodHubSaleV1['payment']['collectedBy'];
  let reference = o.paylink?.paymentId;
  if (money.amounts.totalCents === 0) { mode = 'AUC'; collectedBy = 'clover_tender'; }
  else if (o.paylink?.paidAt) { mode = 'CRE'; collectedBy = 'paylink'; }
  // Interac e-Transfer: a bank transfer, not a card → « Autre » (AUT), collected by the restaurant itself before the
  // kitchen. The foodhub.sale.v1 contract has no Interac value for collectedBy: 'paylink' (= paid to the restaurant
  // online, outside the register) is the closest; the transfer's reference identifies it.
  else if (interacPaid(o)) { mode = 'AUT'; collectedBy = 'paylink'; reference = o.interac!.reference; }
  else if (online) { mode = 'CRE'; collectedBy = o.source === 'clover_online' ? 'clover_tender' : 'paylink'; }
  else { mode = ctx.tender ?? null; collectedBy = mode === 'ARG' ? 'cash' : 'clover_tender'; }
  // A pay-at-pickup order whose tender is unknown waits (never "INC"): a person picks it, or Clover's payment is read.
  if (!mode) return { ok: false, reason: 'tender_unknown' };
  // E-commerce: paid online → O, and then cash / cheque are not allowed (PROVEN). Ordered by phone, paid at the counter → N (SPEC).
  if (online && (mode === 'ARG')) mode = 'CRE';
  const saleKey = ctx.saleKey ?? saleKeyFor(ctx.tenantId, 'direct', channel, o.id);
  const contact = online && (o.customer.email || o.customer.phone);
  return finish({
    schema: 'foodhub.sale.v1', tenantId: ctx.tenantId, locationId: o.locationCode, saleKey,
    occurredAt: ctx.occurredAt ?? isoWithOffset(directOccurredMs(o)),
    source: { model: 'direct', channel, orderId: o.id, externalOrderId: o.sourceRef ?? o.id, displayId: o.number, ...(o.posOrderId ? { posOrderId: o.posOrderId } : {}), brand: o.brandName },
    serviceType, ecommerce: online, user: { ...AUTO_USER },
    lines: b.lines,
    fees: { deliveryCents, serviceFeeCents },
    discountCents: 0,
    amounts: money.amounts,
    payment: { mode, collectedBy, ...(reference ? { reference: reference.slice(0, 40) } : {}) },
    // Paper with the order; an electronic copy too when the customer ordered online with a contact (SMS / e-mail).
    receipt: contact ? { format: 'PEL', deliver: o.customer.email ? 'email' : 'sms' } : { format: 'PAP', deliver: 'print' },
    ...(ctx.referenceSaleKey ? { referenceSaleKey: ctx.referenceSaleKey } : {}),
    testMode: ctx.testMode,
    ...(Object.keys(money.flags).length ? { flags: money.flags } : {}),
  });
}

// ---------- Clover register sales (RegisterSale, model pos) ----------

/** How far Clover's own tax may differ from TPS + TVQ of the receipt (rounding): beyond, a tax rate in Clover is wrong. */
export const REGISTER_TAX_TOLERANCE_CENTS = 1;
/** Order types that mean table service (TBL) unless FOODHUB_MEV_REGISTER_TABLE_TYPES says otherwise; else counter (CMP). */
export const REGISTER_TABLE_TYPE = /\btables?\b|service aux tables|table service/i;

/**
 * The Clover register's tenders → one MEV payment mode. Known labels as tenderMode(); a tender Clover names otherwise
 * (a house account, a custom tender) is « Autre » (AUT), never guessed as card or cash; several modes → MIX.
 */
export function registerTender(labels: string[], totalCents: number): MevPayMode | null {
  if (totalCents === 0) return 'AUC';
  if (!labels.length) return null;
  const known = tenderMode(labels);
  if (known) return known;
  const modes = new Set(labels.map((l) => tenderMode([l]) ?? 'AUT'));
  return modes.size > 1 ? 'MIX' : 'AUT';
}

/**
 * A sale rung up on the restaurant's Clover register → foodhub.sale.v1. Clover is the cash register: its lines are the
 * receipt, its payment the tender, its tip the pourb. Nothing is invented: when Clover's own numbers (total, tax) do not
 * agree with the lines and TPS + TVQ, the sale waits for a person (a wrong tax rate in Clover, an amount-only refund).
 */
export function toMevSaleFromRegister(r: RegisterSale, ctx: MapCtx & { tableTypes?: RegExp }): MapResult {
  if (r.refunded) return { ok: false, reason: 'cancelled_before_sale' };
  if (!r.paid) return { ok: false, reason: 'not_final' };
  if (r.partlyRefundedByAmount) {
    return { ok: false, reason: 'amounts_mismatch', detail: 'partly refunded in Clover by an amount, not by items: credit the items in Clover, or a person corrects the invoice' };
  }
  const mapped = mapLines(r.lines as unknown as OrderLine[], ctx, () => false);
  if (!Array.isArray(mapped)) return { ok: false, reason: mapped.review, detail: mapped.detail };
  if (!mapped.length) return { ok: false, reason: 'no_lines', detail: 'the Clover order has no item' };
  const itemsCents = mapped.reduce((s, l) => s + itemCents(l), 0);
  const serviceFeeCents = Math.max(0, r.serviceChargeCents);
  // Clover's total includes its taxes (not the tip): the pre-tax amount it charged is total − tax.
  const preTaxCents = r.totalCents - r.taxCents;
  let discountCents = itemsCents + serviceFeeCents - preTaxCents;
  let rounded = false;
  if (Math.abs(discountCents) <= SUBTOTAL_ROUNDING_CENTS) {
    rounded = discountCents !== 0;
    discountCents = 0;
  } else if (!(discountCents > 0 && r.hasDiscount)) {
    return { ok: false, reason: 'amounts_mismatch', detail: `Clover charged ${(preTaxCents / 100).toFixed(2)} $ before tax; the items come to ${((itemsCents + serviceFeeCents) / 100).toFixed(2)} $` };
  }
  const money = amountsFor({ lines: mapped, deliveryCents: 0, serviceFeeCents, discountCents, tipCents: Math.max(0, r.tipCents), platformTaxCents: null });
  delete money.flags.taxComputed;
  if (rounded) money.flags.subtotalRounded = true;
  const taxGap = money.amounts.gstCents + money.amounts.qstCents - r.taxCents;
  if (Math.abs(taxGap) > REGISTER_TAX_TOLERANCE_CENTS) {
    return { ok: false, reason: 'amounts_mismatch', detail: `Clover charged ${(r.taxCents / 100).toFixed(2)} $ of tax; TPS + TVQ of the receipt = ${((money.amounts.gstCents + money.amounts.qstCents) / 100).toFixed(2)} $ (check the tax rates in Clover)` };
  }
  const mode = registerTender(r.tenders, money.amounts.totalCents);
  if (!mode) return { ok: false, reason: 'tender_unknown' };
  const serviceType: MevServiceType = (ctx.tableTypes ?? REGISTER_TABLE_TYPE).test(r.orderTypeLabel ?? '') ? 'TBL' : 'CMP';
  const saleKey = ctx.saleKey ?? saleKeyFor(ctx.tenantId, 'pos', 'clover_pos', r.id);
  return finish({
    schema: 'foodhub.sale.v1', tenantId: ctx.tenantId, locationId: r.locationCode, saleKey,
    occurredAt: ctx.occurredAt ?? isoWithOffset(r.paidAtMs ?? (Date.parse(r.updatedAt) || Date.now())),
    source: {
      model: 'pos', channel: 'clover_pos', orderId: r.id, externalOrderId: r.cloverOrderId, posOrderId: r.cloverOrderId,
      ...(r.title ? { displayId: r.title.slice(0, 20) } : {}), ...(r.brandName ? { brand: r.brandName } : {}),
    },
    serviceType, ecommerce: false, user: { ...AUTO_USER },
    lines: mapped,
    fees: { deliveryCents: 0, serviceFeeCents },
    discountCents,
    amounts: money.amounts,
    payment: { mode, collectedBy: mode === 'ARG' ? 'cash' : 'clover_tender' },
    // Printed at the register by the TAKATAK MEV app on the Clover device.
    receipt: { format: 'PAP', deliver: 'print' },
    ...(ctx.referenceSaleKey ? { referenceSaleKey: ctx.referenceSaleKey } : {}),
    testMode: ctx.testMode,
    ...(Object.keys(money.flags).length ? { flags: money.flags } : {}),
  });
}

// ---------- credit notes and prints ----------

export function creditFor(sale: FoodHubSaleV1, creditKey: string, reason: MevCreditReason, occurredMs: number, user: { id: string; name: string } = { ...AUTO_USER }): FoodHubCreditV1 {
  const a = sale.amounts;
  // A full credit note: QCMEV writes the negative transaction from the original; the amounts sent are its magnitudes.
  const c: FoodHubCreditV1 = {
    schema: 'foodhub.credit.v1', tenantId: sale.tenantId, locationId: sale.locationId, saleKey: sale.saleKey, creditKey, reason, full: true,
    amounts: { subtotalCents: Math.abs(a.subtotalCents), gstCents: Math.abs(a.gstCents), qstCents: Math.abs(a.qstCents), totalCents: Math.abs(a.totalCents), tipCents: Math.abs(a.tipCents) },
    occurredAt: isoWithOffset(occurredMs), user, testMode: sale.testMode, payloadHash: '',
  };
  c.payloadHash = payloadHashOf(c as unknown as Record<string, unknown>);
  return c;
}

export function printFor(sale: Pick<FoodHubSaleV1, 'tenantId' | 'saleKey'>, printKey: string, mode: 'RPR' | 'DUP', user: { id: string; name: string } = { ...AUTO_USER }): FoodHubPrintV1 {
  const p: FoodHubPrintV1 = { schema: 'foodhub.print.v1', tenantId: sale.tenantId, saleKey: sale.saleKey, printKey, mode, user, payloadHash: '' };
  p.payloadHash = payloadHashOf(p as unknown as Record<string, unknown>);
  return p;
}

/** Why an order's content changed after its receipt (credit note reason). */
export function changeReason(o: Pick<StoredOrder, 'timeline'>): MevCreditReason {
  return (o.timeline?.missingItems?.length ?? 0) > 0 ? 'missing_items' : 'adjusted';
}

/** Clover tender label → MEV payment mode (null = unknown: the sale waits). */
export function tenderMode(labels: string[]): MevPayMode | null {
  const modes = [...new Set(labels.map((raw) => {
    const l = String(raw ?? '').toLowerCase();
    if (/cash|comptant|espèce|espece|argent/.test(l)) return 'ARG';
    if (/debit|débit|interac/.test(l)) return 'DEB';
    if (/gift|cadeau/.test(l)) return 'CPR';
    if (/credit|crédit|visa|master|amex|card|carte/.test(l)) return 'CRE';
    return null;
  }))];
  if (!labels.length || modes.includes(null)) return null;
  return modes.length > 1 ? 'MIX' : (modes[0] as MevPayMode);
}
