// Food Hub order → foodhub.sale.v1 (docs/MEV_INTEGRATION.md § mapping). Pure functions: no I/O, so every rule is
// unit-tested with fixtures per channel (tests/mev-map.test.ts).
//
// Which orders: platform orders once accepted (or ready with FOODHUB_MEV_TRIGGER=ready), Skip orders handed to the
// Skip tablet (still made and sold), direct orders once paid (online, or at the counter / pickup).
// Never: the Too Good To Go daily bag log, dry-run (simulator) orders, kitchens not switched to QCMEV.
// Money: integer cents; the restaurant's own supply only (no platform courier tip, platform delivery / service fee or
// platform-funded promotion); GST and QST rounded one by one; the tip (pourb) only when the restaurant keeps it, and
// never inside the total.
import crypto from 'node:crypto';
import type { DirectOrder } from '../delivery/types';
import type { OrderLine, StoredOrder } from '../types';
import { cents, qty, reconcileTax, roundHalfUpDiv, taxByCode } from './money';
import type { FoodHubCreditV1, FoodHubPrintV1, FoodHubSaleV1, MevChannel, MevCreditReason, MevPayMode, MevSaleLine, MevServiceType, MevTaxCode, MevTrigger } from './types';

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
export function saleKeyFor(tenant: string, model: 'stored' | 'direct', channel: MevChannel, ref: string): string {
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
  replacesSaleKey?: string;
}

export type Exclusion = 'log_order' | 'dry_run' | 'not_final' | 'cancelled_before_sale' | 'awaiting_payment' | 'tender_unknown';
export type MapResult = { ok: true; sale: FoodHubSaleV1; contentHash: string } | { ok: false; reason: Exclusion };

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
function mapLines(lines: OrderLine[], ctx: MapCtx, alcoholOf: (l: OrderLine) => boolean): MevSaleLine[] {
  return lines.filter((l) => (Number(l.quantity) || 0) > 0).map((l) => {
    const q = Math.round((Number(l.quantity) || 1) * 1000) / 1000;
    const modifiers = (l.modifiers ?? []).map((m) => {
      const mq = Math.round((Number(m.quantity) || 1) * q * 1000) / 1000;
      const unit = Math.max(0, cents(m.unitPrice));
      return { description: String(m.name || 'Option').slice(0, 100), quantity: qty(mq), unitPriceCents: unit, totalCents: lineCents(unit, mq) };
    });
    const modsCents = modifiers.reduce((s, m) => s + m.totalCents, 0);
    const unit = Math.max(0, Math.round((cents(l.total) - modsCents) / q));
    return {
      ...(l.posItemRef || l.externalId ? { ref: String(l.posItemRef || l.externalId).slice(0, 60) } : {}),
      description: String(l.name || 'Article').slice(0, 100),
      quantity: qty(q),
      unitPriceCents: unit,
      totalCents: lineCents(unit, q),
      taxCode: ctx.taxCodeOf?.(l) ?? 'FP',
      activity: alcoholOf(l) && ctx.barPermit ? 'BAR' : 'RES',
      modifiers,
    };
  });
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

/**
 * When the order's subtotal is not the sum of its items (platform rounding, tax-included prices…), the receipt still
 * adds up: a missing amount becomes one more item, an extra amount a price difference counted with the discount.
 */
function balance(lines: MevSaleLine[], subtotalCents: number): { lines: MevSaleLine[]; extraDiscountCents: number } {
  const gap = subtotalCents - lines.reduce((s, l) => s + itemCents(l), 0);
  if (gap > 0) return { lines: [...lines, { description: 'ÉCART DE PRIX / PRICE DIFFERENCE', quantity: '1', unitPriceCents: gap, totalCents: gap, taxCode: 'FP', activity: 'RES', modifiers: [] }], extraDiscountCents: 0 };
  return { lines, extraDiscountCents: -gap };
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
  if (LOG_ORDER(o)) return 'log_order';
  if (opts.dryRun) return 'dry_run';
  return null;
}

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
  const b = balance(mapLines(o.lines, ctx, () => false), cents(o.subtotal));
  const discountCents = Math.max(0, cents(discount)) + b.extraDiscountCents;
  // No tip (pourb) on a platform order: the platform pays its courier, and an LVT receipt never carries one.
  const money = amountsFor({ lines: b.lines, deliveryCents: 0, serviceFeeCents: 0, discountCents, tipCents: 0, platformTaxCents: skipTablet ? null : cents(o.tax) });
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
    // Platforms mask the customer's contact: the paper copy goes in the bag.
    receipt: { format: 'PAP', deliver: 'print' },
    ...(ctx.replacesSaleKey ? { replacesSaleKey: ctx.replacesSaleKey } : {}),
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

/** Paid online before the kitchen: paylink, our website marked paid, Clover Online Ordering. */
export function paidOnline(o: Pick<DirectOrder, 'paylink' | 'source' | 'payment' | 'events'>): boolean {
  if (o.paylink?.paidAt) return true;
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
  const b = balance(mapLines(o.lines, ctx, (l) => Boolean((l as { alcohol?: boolean }).alcohol)), cents(o.subtotal));
  const deliveryCents = o.fulfillment === 'delivery' ? Math.max(0, cents(o.deliveryFee)) : 0;
  // The tax the customer was charged (Food Hub / Clover computed it); the split follows the base when it agrees.
  const money = amountsFor({ lines: b.lines, deliveryCents, serviceFeeCents: 0, discountCents: b.extraDiscountCents, tipCents: Math.max(0, cents(o.tip)), platformTaxCents: cents(o.tax) });
  let mode: MevPayMode | null;
  let collectedBy: FoodHubSaleV1['payment']['collectedBy'];
  if (money.amounts.totalCents === 0) { mode = 'AUC'; collectedBy = 'clover_tender'; }
  else if (o.paylink?.paidAt) { mode = 'CRE'; collectedBy = 'paylink'; }
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
    fees: { deliveryCents, serviceFeeCents: 0 },
    discountCents: b.extraDiscountCents,
    amounts: money.amounts,
    payment: { mode, collectedBy, ...(o.paylink?.paymentId ? { reference: o.paylink.paymentId.slice(0, 40) } : {}) },
    // Paper with the order; an electronic copy too when the customer ordered online with a contact (SMS / e-mail).
    receipt: contact ? { format: 'PEL', deliver: o.customer.email ? 'email' : 'sms' } : { format: 'PAP', deliver: 'print' },
    ...(ctx.replacesSaleKey ? { replacesSaleKey: ctx.replacesSaleKey } : {}),
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
