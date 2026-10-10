// Export files → FinanceLine / BankLine. Reuses the statement reader (CSV/XLSX, header detection, amounts, dates)
// from recon/statements.ts and adds the detail Food Hub's payout import does not keep: GST vs QST, tips, marketing,
// error charges vs refunds, cancellations, payout status, payout summaries, Clover payments/deposits, bank statements.
//
// Column names follow the platforms' published reports (checked 2026-10-07):
//   Uber Eats "Payment Details" (help.uber.com — reviewing-payment-details-report): Sales (excluding tax), Tax on Sales,
//     GST/HST · PST · QST · RST on Sales, Offers on items, Marketplace fee (+ tax), Delivery Network Fee, Tips,
//     Other payments (+ description), Marketing Adjustment, Total payout, Payout Date, Payout Status, Payout reference ID…
//   DoorDash Merchant Portal financial CSV / Reporting API TRANSACTION_DETAIL and PAYOUT_SUMMARY (developer.doordash.com):
//     Subtotal, Subtotal tax passed to merchant (federal/harmonized, provincial), Commission, Commission tax, Marketing fees,
//     Customer discounts from marketing (funded by you / DoorDash / third party), Error charges, Adjustments, Net total…
// Columns are recognised by name patterns, so a column the platforms add is reported as "not used" instead of
// silently changing the totals. Tax columns are read per row: split GST/QST columns win over a combined "Tax on …"
// column for the same base, so a file that prints both is never counted twice.
import crypto from 'node:crypto';
import { platformFromLabel } from '../pos/platform-labels';
import { detectFormat, parseAmount, parseDate, readTable, splitHeader } from '../recon/statements';
import { parseScanRows } from './scans';
import { CLOVER_STRAY_RATE, GST_RATE, QST_RATE, r2, splitQuebecTax, type BankLine, type FinanceLine, type LineType, type Mode, type Platform, type SourceFormat } from './model';

/** "Tax on Sales", "TAX_ON_SALES", "Taxe sur ventes " → comparable lower-case text (API exports use snake_case). */
export const normHeader = (h: string) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/_/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

type Field =
  | 'storeName' | 'storeId' | 'storeId2' | 'orderRef' | 'orderRef2' | 'mode' | 'status' | 'txType' | 'description' | 'payoutStatus'
  | 'orderDate' | 'orderDate2' | 'payoutDate' | 'payoutRef' | 'currency' | 'printedRate' | 'tender' | 'account'
  | 'itemSales' | 'promotions' | 'tips' | 'commission' | 'marketing' | 'fees'
  | 'errorCharges' | 'refunds' | 'adjustments' | 'other' | 'otherPayments' | 'taxWithheld' | 'net'
  | 'infoTaxRemitted' | 'infoPlatformDiscounts' | 'gross' | 'tax' | 'amount' | 'credit' | 'debit' | 'ignore'
  // DoorDash columns kept "for historical reference only": for orders before April 2025 they hold the real amounts
  // and the current columns read 0.
  | 'histNet' | 'histMarketingAll' | 'histMarketingTax' | 'histAdFee' | 'histAdFeeTax' | 'histAdjustments' | 'histMerchantDiscount' | 'histDdDiscount';

const SUMMED: ReadonlySet<Field> = new Set<Field>(['itemSales', 'promotions', 'tips', 'commission', 'marketing', 'fees', 'errorCharges', 'refunds', 'adjustments', 'other', 'otherPayments', 'taxWithheld', 'infoTaxRemitted', 'infoPlatformDiscounts', 'gross', 'tax', 'amount', 'credit', 'debit',
  'histNet', 'histMarketingAll', 'histMarketingTax', 'histAdFee', 'histAdFeeTax', 'histAdjustments', 'histMerchantDiscount', 'histDdDiscount']);
const FEE_FIELDS: Field[] = ['commission', 'marketing', 'fees'];

type Rule = [Field, RegExp];

const UBER_RULES: Rule[] = [
  ['promotions', /^delivery offer redemptions/],
  ['ignore', /\((incl|including)\.? tax(es)?\)$|^invoice link|^order channel$|^payment mode$|membership status$|^order accept time$/],
  ['storeName', /^(store|restaurant|location) name$/], ['storeId', /^(store|restaurant|location) id$/], ['storeId2', /^external store id$/],
  ['orderRef', /^order id$/], ['orderRef2', /^workflow id$/],
  ['mode', /^(dining mode|fulfil+ment type|order type|delivery type)$/], ['status', /^order status$/],
  ['orderDate', /^order date$/], ['orderDate2', /^(order time|date)$/],
  ['payoutDate', /^payout date$/], ['payoutRef', /^payout reference id$/], ['payoutStatus', /^payout status$/], ['currency', /^currency$/],
  ['description', /^other payments description$/], ['printedRate', /^marketplace fee ?%$/],
  ['itemSales', /^sales \((excl|excluding)\.? tax(es)?\)$/],
  ['refunds', /^refunds? \((excl|excluding)\.? tax(es)?\)$|^chargeback amount$/],
  ['fees', /^(offer redemption fee|service fee \(markup\)|cost of delivery \((excl|excluding)\.? tax\))$/],
  ['commission', /^marketplace fee discount$/],
  ['other', /^(profit on delivery fee|container deposit fee|capital payments|garnishment)$/],
  ['ignore', /^(sub-total|total order \(incl\.? tax\)|total cost of delivery \(incl\.? tax\)|order count|count of misc payment|store uuid|order completion time|currency code|retailer loyalty id|external store id)$/],
  ['adjustments', /^price adjustments? \((excl|excluding)\.? tax(es)?\)$/],
  ['promotions', /^(promotions?|offers?) on (items|delivery)$/],
  ['commission', /^marketplace fee$/],
  ['fees', /^(delivery network|order processing|merchant|service) fee$/],
  ['tips', /^tips?$/],
  ['other', /^(bag fee|markup amount|markup|delivery fee)$/],
  ['marketing', /^marketing adjustment$/],
  ['otherPayments', /^other payments$/],
  ['taxWithheld', /marketplace facilitator tax|backup withholding/],
  ['net', /^total payout$/],
];

const DOORDASH_RULES: Rule[] = [
  ['histNet', /^net total \(for historical reference only\)$/],
  ['histMarketingAll', /^marketing fees \(for historical reference only\)/],
  ['histMarketingTax', /^marketing fee tax \(for historical reference only\)/],
  ['histAdFee', /^ad fee \(for historical reference only\)$/],
  ['histAdFeeTax', /^ad fee tax \(for historical reference only\)$/],
  ['histAdjustments', /^adjustments \(for historical reference only\)$/],
  ['histMerchantDiscount', /^merchant funded subtotal discount amount/],
  ['histDdDiscount', /^doordash funded subtotal discount amount/],
  ['ignore', /^(tax \()?customer fees?\)?$|^consumer (delivery|service|small order|legislative) fee$|^consumer tip$|^customer fee tax remitted/],
  ['storeName', /^store name$/], ['storeId', /^store id$/], ['storeId2', /^merchant store id$/],
  ['orderRef', /^(doordash|dd) order id$/], ['orderRef2', /^(merchant delivery id|external id)$/],
  ['txType', /^transaction type$/], ['status', /^final order status$/], ['description', /^description$/],
  ['mode', /^(fulfil+ment|order|delivery) (type|method)$|^is pickup$|^channel$/],
  ['orderDate', /^timestamp local date$/], ['orderDate2', /^(timestamp utc date|order date|date|transaction date)$/],
  ['payoutDate', /^payout date$/], ['payoutRef', /^payout id$/], ['payoutStatus', /^payout status$/], ['currency', /^currency$/], ['printedRate', /^commission rate$/],
  ['itemSales', /^subtotal$/],
  ['infoTaxRemitted', /^tax remitted by doordash/],
  ['commission', /^commission$/],
  ['fees', /^(payment processing fee|merchant fees?|tablet( and printer)? fees?|printer fees?|tablet subscription( fee)?|drive charge|other fees?)$/],
  // DoorDash- or third-party-funded discounts and the credits that repay them are both inside the net total:
  // together they are the net marketing cost (a credit larger than the discount offsets your own promotion cost).
  ['marketing', /^marketing fees?|^ads? fees?$|^sponsored listing|^doordash marketing credit$|^customer discounts? from marketing.*funded by (doordash|a third.party)|^third.party contribution$/],
  ['promotions', /^customer discounts? from marketing.*funded by you|^merchant funded (subtotal )?discount/],
  ['infoPlatformDiscounts', /^doordash funded (subtotal )?discount/],
  ['errorCharges', /^error charges?$/],
  ['adjustments', /^adjustments?$/],
  ['tips', /^(merchant )?tips?$/],
  ['net', /^(net total|net payout)$/],
  ['ignore', /^(pre-adjusted subtotal|pre-adjusted subtotal tax|subtotal for tax|credit|debit|discounts|total before adjustments|order cart id|doordash transaction id|business id|transaction id|timestamp (local|utc) time|payout time)$/],
];

// DoorDash / Uber / Skip payout lists: one row per payout.
const PAYOUT_RULES: Rule[] = [
  ['ignore', /for historical reference only|^(total before adjustments|discounts|currency|business id)$/],
  ['storeName', /^(store|restaurant) name$/], ['storeId', /^(store|restaurant) id$/], ['storeId2', /^merchant store id$/],
  ['payoutRef', /^(payout|payment|transfer|statement) (id|reference( id)?|ref|number)$/], ['payoutDate', /^(payout|payment|transfer|deposit|paid) (date|time|on)$|^date$/],
  ['orderDate', /^(period|week|start|from|period start)( date)?$|^transaction start (local|utc) date$/], ['orderDate2', /^(period end|end|to|end date)( date)?$|^transaction end (local|utc) date$/],
  ['status', /^(payout |payment |transfer )?status$/], ['account', /^(bank )?account|last 4|^bank$/],
  ['itemSales', /^(subtotal|sales|gross sales|food sales)( \((excl|excluding)\.? tax\))?$/],
  ['infoTaxRemitted', /^tax remitted by doordash/],
  ['commission', /^(commission|commissions|marketplace fee)$/],
  ['fees', /^(fees|other fees|tablet fee|processing fees?|drive charge|merchant fees?)$/], ['marketing', /^(marketing|marketing fees?|ads|ad spend)/],
  ['errorCharges', /^error charges?$/], ['adjustments', /^adjustments?$/], ['refunds', /^refunds?$/], ['tips', /^tips?$/],
  ['net', /^(net payout|payout amount|net total|amount|total payout|net amount|amount paid|payout)$/],
];

const GENERIC_RULES: Rule[] = [
  ['storeName', /^(store|restaurant|location)( name)?$|^restaurant$/], ['storeId', /^(store|restaurant|location) id$/],
  ['orderRef', /^(order (id|number|no\.?|#|reference|ref)|numero de commande|no de commande|commande|order)$/],
  ['orderDate', /^(order date|date|order time|created|transaction date|date de commande|date de la commande)$/],
  ['payoutDate', /^(payout date|deposit date|payment date|paid on|date de paiement|date du depot)$/], ['payoutRef', /^(payout id|statement id|deposit id|statement|invoice|releve)$/],
  ['status', /^(type|transaction type|kind|category|status|order status|statut)$/], ['description', /^(description|details|memo|notes?|reason|raison)$/],
  ['mode', /^(fulfil+ment|order type|delivery type|mode)$/],
  ['itemSales', /^(subtotal|sub-total|sous-total|food sales|sales|gross sales|item total|order subtotal|food total|ventes)$/],
  ['commission', /^(commission|commissions|platform fee|service fee)$/],
  ['fees', /^(fees?|frais|processing fees?)$/], ['marketing', /^(marketing|promotion fees?|ads?)$/],
  ['errorCharges', /^(error charges?|frais d'erreur)$/], ['adjustments', /^(adjustments?|ajustements?)$/], ['refunds', /^(refunds?|remboursements?)$/],
  ['promotions', /^(discount|discounts|promotions?|rabais)$/], ['tips', /^(tips?|pourboires?)$/],
  ['net', /^(net payout|net|net total|total payout|payout|payout amount|amount paid|total paid|paid|amount|net amount|earnings|montant net|montant verse|montant)$/],
];

const CLOVER_PAY_RULES: Rule[] = [
  ['payoutRef', /^payment id$/], ['orderRef', /^order id$/], ['orderRef2', /^(order number|invoice number|receipt number)$/],
  ['orderDate', /^(payment date|date|created|created date|transaction date|paid on|order date|date \/ time|date\/time)$/],
  ['tender', /^(tender|payment type|tender type|payment method|tender name)$/], ['status', /^(result|status|payment status|state|payment state)$/],
  ['mode', /^(order type|dining option)$/], ['description', /^(note|order note|title|order title)$/],
  ['tips', /^tips?( amount)?$/], ['tax', /^(tax|taxes|tax amount)$/], ['other', /^service charges?( amount)?$/],
  ['refunds', /^(refund(ed)? amount|refunds?|amount refunded)$/], ['promotions', /^(discounts?|discount amount)$/],
  ['amount', /^(amount|payment amount|total|amount paid|order total|total amount)$/],
  ['ignore', /^(card (brand|type)|last 4|employee|device|card number|auth|currency)/],
];

const CLOVER_DEPOSIT_RULES: Rule[] = [
  ['payoutRef', /^(deposit|batch|funding|settlement) (id|number|reference)$/], ['payoutDate', /^(deposit|funding|settlement|batch|transfer|payout)? ?date$/],
  ['account', /account|last 4/], ['status', /^status$/],
  ['gross', /^(gross|gross sales|total sales|sales amount|amount processed|amount submitted|card sales|batch amount)$/],
  ['fees', /^(fees?|processing fees?|discount fees?|total fees|fees\/adjustments)$/], ['refunds', /^(refunds?|returns?)$/], ['adjustments', /^(adjustments?|chargebacks?|chargebacks\/reversals)$/],
  ['net', /^(net|net amount|deposit amount|net deposit|amount deposited|amount transferred|deposit|amount)$/],
];

const BANK_RULES: Rule[] = [
  ['orderDate', /^(date|date posted|posting date|transaction date|date de transaction|date d'inscription|date de l'operation|value date)$/],
  ['description', /^(description|details|memo|payee|libelle|transaction|narrative|transaction type|description 1|type)$/],
  ['orderRef', /^(description 2|reference|cheque number|numero de cheque)$/],
  ['amount', /^((transaction )?amount|montant)$/], ['credit', /^(credit|credits|deposits?|depot|depots|money in)$/], ['debit', /^(debit|debits|withdrawals?|retrait|retraits|money out)$/],
  ['account', /^(account|account number|compte|first bank card|card number|numero de compte)$/],
];

// ---------------------------------------------------------------- tax columns

type TaxKind = 'combined' | 'gst' | 'qst' | 'other';
interface TaxCol { idx: number; kind: TaxKind; base: string; target: 'salesTax' | 'commissionTax' }

const FEE_BASE = /marketplace fee|merchant fees?|delivery network fee|order processing fee|service fee|commission|ads? (spend|credit)|advertising|cost of delivery|offer redemption fee/;

/** Recognises a tax column and what it is tax on: "QST on Sales", "Tax on Marketplace fee", "Subtotal tax passed to merchant (provincial)"… */
export function taxColumn(header: string): Omit<TaxCol, 'idx'> | null {
  const h = normHeader(header);
  const kindOf = (p: string): TaxKind => (/^(gst|hst|gst\/hst|tps)$/.test(p) ? 'gst' : /^(qst|tvq)$/.test(p) ? 'qst' : /^(pst|rst)$/.test(p) ? 'other' : 'combined');
  let m = h.match(/^(tax|taxes|gst\/hst|gst|hst|pst|qst|rst|tps|tvq) on (.+)$/);
  if (m) return { kind: kindOf(m[1]), base: m[2].replace(/^(promotions?|offers?)/, 'offers'), target: FEE_BASE.test(m[2]) ? 'commissionTax' : 'salesTax' };
  m = h.match(/^subtotal tax passed (?:by doordash )?to merchant\s*\(?([a-z /]*)\)?$/);
  if (m) return { kind: /federal|harmonized/.test(m[1]) ? 'gst' : /provincial/.test(m[1]) ? 'qst' : 'combined', base: 'subtotal', target: 'salesTax' };
  if (/^(tax \(subtotal\)|tax subtotal|subtotal tax)$/.test(h)) return { kind: 'combined', base: 'subtotal', target: 'salesTax' };
  if (/^(commission tax( amount)?|tax on commission|tax \(commission\))$/.test(h)) return { kind: 'combined', base: 'commission', target: 'commissionTax' };
  if (/^tax \(merchant fees?\)$/.test(h)) return { kind: 'combined', base: 'merchant fees', target: 'commissionTax' };
  // "Tablet fee tax", "Payment processing fee tax"… (DoorDash): GST + QST on a platform fee, recoverable like commission tax.
  if (/^(tablet( and printer)?|printer|merchant|processing|payment processing|drive|other|data|service) fees? tax$/.test(h)) return { kind: 'combined', base: h.replace(/ tax$/, ''), target: 'commissionTax' };
  if (/^(tax|taxes|sales tax|gst\/qst|tps\/tvq|tps \+ tvq|gst \+ qst|total tax)$/.test(h)) return { kind: 'combined', base: 'sales', target: 'salesTax' };
  if (/^(gst|tps|hst|gst\/hst)$/.test(h)) return { kind: 'gst', base: 'sales', target: 'salesTax' };
  if (/^(qst|tvq)$/.test(h)) return { kind: 'qst', base: 'sales', target: 'salesTax' };
  return null;
}

interface RowTax { salesTax: number; gst: number; qst: number; otherTax: number; commissionTax: number; estimated: boolean }

/** Per base: split columns (GST, QST, other) when any is non-zero, else the combined column (split 5 : 9.975). First non-zero column of each kind wins. */
/** Federal GST holiday on restaurant food: no GST charged on orders in this window (QST still applied). */
const GST_HOLIDAY: [string, string] = ['2024-12-14', '2025-02-15'];

/**
 * One tax total on a sale → GST and QST. The printed rate decides when the pre-tax amount is known (Uber Eats
 * charged QST only on some stores and during the GST holiday); otherwise the holiday calendar, then the 5 : 9.975 split.
 */
function splitSalesTax(total: number, ctx?: { itemSales?: number; date?: string | null }): { gst: number; qst: number; estimated: boolean } {
  const base = ctx?.itemSales ?? 0;
  if (base > 0 && total > 0) {
    const rate = total / base;
    const near = (r: number) => Math.abs(rate - r) <= 0.0035;
    if (near(QST_RATE)) return { gst: 0, qst: total, estimated: false };
    if (near(GST_RATE)) return { gst: total, qst: 0, estimated: false };
    if (near(GST_RATE + QST_RATE)) return { ...splitQuebecTax(total), estimated: false };
  }
  const d = ctx?.date ?? '';
  if (d && d >= GST_HOLIDAY[0] && d <= GST_HOLIDAY[1]) return { gst: 0, qst: total, estimated: true };
  return { ...splitQuebecTax(total), estimated: true };
}

interface TaxCtx { itemSales?: number; promotions?: number; refunds?: number; adjustments?: number; date?: string | null }
const isSalesBase = (base: string) => /^(sales|subtotal|sub-total)$/.test(base);
/** The pre-tax amount a tax column applies to, for the rate test. */
function baseAmount(base: string, ctx?: TaxCtx): number {
  if (!ctx) return 0;
  if (isSalesBase(base)) return Math.abs(ctx.itemSales ?? 0);
  if (/offer|promo|discount/.test(base)) return Math.abs(ctx.promotions ?? 0);
  if (/chargeback|refund/.test(base)) return Math.abs(ctx.refunds ?? 0);
  if (/adjust/.test(base)) return Math.abs(ctx.adjustments ?? 0);
  return 0;
}

function rowTax(row: string[], cols: TaxCol[], ctx?: TaxCtx): RowTax {
  const out: RowTax = { salesTax: 0, gst: 0, qst: 0, otherTax: 0, commissionTax: 0, estimated: false };
  const bases = new Map<string, TaxCol[]>();
  for (const c of cols) bases.set(`${c.target}|${c.base}`, [...(bases.get(`${c.target}|${c.base}`) ?? []), c]);
  // The tax on the sale first: the tax on an offer, a refund or a price adjustment of the same order follows its GST : QST ratio.
  const groups = [...bases.values()].sort((a, b) => Number(!isSalesBase(a[0].base)) - Number(!isSalesBase(b[0].base)));
  let refShare: number | null = null;
  for (const group of groups) {
    const first = (k: TaxKind) => { for (const c of group) if (c.kind === k) { const v = parseAmount(row[c.idx]); if (v) return v; } return 0; };
    const g = first('gst'); const q = first('qst'); const o = first('other'); const comb = first('combined');
    const { target, base } = group[0];
    // Uber Eats Manager prints the whole tax in "GST/HST on Sales" and leaves "QST on Sales" empty: that is a total, not a split.
    const degenerate = target === 'salesTax' && g !== 0 && !q && !o && comb !== 0 && Math.abs(comb - g) < 0.005;
    if ((g || q || o) && !degenerate) {
      if (target === 'salesTax') { out.gst += g; out.qst += q; out.otherTax += o; out.salesTax += g + q + o; if (isSalesBase(base) && g + q) refShare = g / (g + q); } else out.commissionTax += g + q + o;
    } else if (comb) {
      if (target === 'salesTax') {
        let s = splitSalesTax(comb, { itemSales: baseAmount(base, ctx), date: ctx?.date });
        if (s.estimated && refShare !== null) { const gst = r2(comb * refShare); s = { gst, qst: r2(comb - gst), estimated: false }; }
        if (isSalesBase(base) && !s.estimated) refShare = s.gst / comb;
        out.gst += s.gst; out.qst += s.qst; out.salesTax += comb; out.estimated = out.estimated || s.estimated;
      } else out.commissionTax += comb;
    }
  }
  return { salesTax: r2(out.salesTax), gst: r2(out.gst), qst: r2(out.qst), otherTax: r2(out.otherTax), commissionTax: r2(out.commissionTax), estimated: out.estimated };
}

// ---------------------------------------------------------------- detection

export interface Detected { format: SourceFormat | 'reference'; platform: Platform | null; rules: Rule[]; note?: string }

export function detectFinanceFormat(headers: string[], fileName = ''): Detected {
  const H = headers.map(normHeader);
  const has = (re: RegExp) => H.some((h) => re.test(h));
  const f = fileName.toLowerCase();
  // Portal scans written by Food Hub sessions (private/uber, private/doordash).
  if (has(/^section$/) && has(/^earnings cad$/) && has(/^net payout cad$/)) return { format: 'uber_scan_payouts', platform: 'uber_eats', rules: [] };
  if (has(/^type$/) && has(/^doordash services$/) && has(/^amendments$/)) return { format: 'doordash_scan_charges', platform: 'doordash', rules: [] };
  if (has(/^uber uuid$/) && has(/^kitchen$/)) return { format: 'reference', platform: 'uber_eats', rules: [], note: 'Uber store list (portal scan): used for the store map (store-map.csv), not for amounts.' };
  // Reports that repeat what the transactions export already counts: kept as reference, never added to totals.
  if (has(/^error charges$/) && has(/^adjustments$/) && !has(/^subtotal$/) && !has(/^net total$/)) return { format: 'reference', platform: 'doordash', rules: [], note: 'DoorDash error charges & adjustments list: reference only (these rows are already in the Transactions export).' };
  if (/SIMPLIFIED_TRANSACTIONS/i.test(fileName)) return { format: 'reference', platform: 'doordash', rules: [], note: 'DoorDash simplified transactions: reference only (the detailed transactions file is used).' };
  if (has(/^error category$/) && has(/^error charge$/)) return { format: 'reference', platform: 'doordash', rules: [], note: 'DoorDash menu-item error report: reference only (error charges are counted from the Transactions export).' };
  if (has(/^cancellation category$/) && has(/^is paid$/)) return { format: 'reference', platform: 'doordash', rules: [], note: 'DoorDash cancelled-orders report: reference only (cancellations are counted from the Transactions export).' };
  const base = detectFormat(headers.map((h) => h.replace(/_/g, ' ')));
  if (base.format === 'uber_payment_details') return { format: 'uber_payment_details', platform: 'uber_eats', rules: UBER_RULES };
  if (base.format === 'doordash_transactions' || (has(/^(doordash|dd) order id$/) && has(/^(net total|net payout|subtotal)$/))) return { format: 'doordash_transactions', platform: 'doordash', rules: DOORDASH_RULES };
  // Clover exports beside the payments list: the orders list (open / unpaid orders are not sales; the payments file carries
  // every amount), the refunds list (refunds are also columns of the payments file) and the Sales Overview report (totals).
  if (has(/^order payment state$/) || (has(/^order id$/) && has(/^payments total$/))) return { format: 'reference', platform: 'clover', rules: [], note: 'Clover orders list: reference only (amounts come from the payments export; open or unpaid orders are not sales).' };
  if (has(/^refund id$/) && has(/^refund amount$/)) return { format: 'reference', platform: 'clover', rules: [], note: 'Clover refunds list: reference only (refunds are already in the payments export).' };
  if (/sales[ _-]?overview/i.test(f)) return { format: 'reference', platform: 'clover', rules: [], note: 'Clover Sales Overview report: totals only (the payments export is used).' };
  if (has(/^payment id$/) || (has(/^tender/) && has(/^(amount|payment amount|total)$/))) return { format: 'clover_payments', platform: 'clover', rules: CLOVER_PAY_RULES };
  if (has(/^(order total|total)$/) && has(/^(payment state|order state|state)$/) && has(/^order id$/)) return { format: 'clover_orders', platform: 'clover', rules: CLOVER_PAY_RULES };
  if ((/clover|fiserv|deposit|funding/.test(f) || has(/^(amount submitted|amount transferred)$/)) && has(/(net|deposit|amount)/) && !has(/order/)) return { format: 'clover_deposits', platform: 'clover', rules: CLOVER_DEPOSIT_RULES };
  const payoutish = has(/payout|transfer/) && has(/^(net payout|payout amount|amount|net total|total payout)$/) && !has(/order (id|number)/);
  if (payoutish && (/doordash|dd[_-]/.test(f) || has(/merchant store id/) || has(/^transaction start (local|utc) date$/))) return { format: 'doordash_payouts', platform: 'doordash', rules: PAYOUT_RULES };
  if (payoutish && /uber/.test(f)) return { format: 'uber_payouts', platform: 'uber_eats', rules: PAYOUT_RULES };
  if (/skip/.test(f) || has(/skip/)) return { format: 'skip_statement', platform: 'skip', rules: payoutish ? PAYOUT_RULES : GENERIC_RULES };
  const bankish = has(BANK_RULES[0][1]) && (has(BANK_RULES[3][1]) || (has(BANK_RULES[4][1]) && has(BANK_RULES[5][1]))) && has(BANK_RULES[1][1]);
  if (bankish || /bank|bmo|desjardins|rbc|banque|releve/.test(f)) return { format: 'bank', platform: null, rules: BANK_RULES };
  return { format: 'generic', platform: null, rules: GENERIC_RULES };
}

/** Header index → field (first matching rule wins; amount fields may take several columns). Tax columns are returned apart. */
export function mapColumns(headers: string[], rules: Rule[], withTax = true): { map: Partial<Record<Field, number[]>>; tax: TaxCol[]; unmapped: string[] } {
  const map: Partial<Record<Field, number[]>> = {};
  const tax: TaxCol[] = [];
  const unmapped: string[] = [];
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;
    const ignored = rules.find(([f, re]) => f === 'ignore' && re.test(n));
    if (ignored) return;
    const t = withTax ? taxColumn(h) : null;
    if (t) { tax.push({ idx: i, ...t }); return; }
    const rule = rules.find(([, re]) => re.test(n));
    if (!rule) { unmapped.push(h); return; }
    const [field] = rule;
    if (field === 'ignore') return;
    if (!SUMMED.has(field) && map[field]?.length) return; // first column wins for ids, names, dates
    (map[field] ??= []).push(i);
  });
  return { map, tax, unmapped };
}

// ---------------------------------------------------------------- helpers

const txt = (row: string[], idx: number[] | undefined) => (idx?.length ? String(row[idx[0]] ?? '').trim() : '');
const amt = (row: string[], idx: number[] | undefined) => r2((idx ?? []).reduce((s, i) => s + parseAmount(row[i]), 0));

/** Day-first or month-first for a file's slash dates ("03/04/2026"), decided from the values that are not ambiguous. */
export function slashDateOrder(values: string[]): 'dmy' | 'mdy' | null {
  let dmy = 0; let mdy = 0;
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++; else if (Number(m[2]) > 12) mdy++;
  }
  return dmy > mdy ? 'dmy' : mdy > dmy ? 'mdy' : null;
}

/** Excel serials and ISO stay as is; "2026/09/14" and D/M/Y with day > 12 are handled too; `order` settles 03/04/2026. */
export function isoDay(v: string, order: 'dmy' | 'mdy' | null = null): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const sl = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (sl && order) {
    const [d, mo] = order === 'dmy' ? [sl[1], sl[2]] : [sl[2], sl[1]];
    const y = sl[3].length === 2 ? `20${sl[3]}` : sl[3];
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = parseDate(s);
  return d ? d.slice(0, 10) : null;
}

/** Long digit runs (account / card numbers) → last 4 only. */
export const maskDigits = (s: string) => s.replace(/\d[\d -]{4,}\d/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 5 ? `••${d.slice(-4)}` : m; });

function modeOf(text: string, platform: Platform): Mode {
  const t = text.toLowerCase();
  if (/pick ?up|emporter|takeout|take-out|ramassage/.test(t)) return 'pickup';
  if (/dine|sur place/.test(t)) return platform === 'clover' ? 'in_store' : 'dine_in';
  if (/deliver|livraison/.test(t)) return 'delivery';
  if (platform === 'clover') return /online/.test(t) ? 'online' : t ? 'in_store' : '';
  return '';
}

type OtherBucket = 'marketing' | 'errorCharges' | 'fees' | 'adjustments' | 'other';
function classifyOtherPayment(desc: string): OtherBucket {
  const t = desc.toLowerCase();
  if (/\bads?\b|advert|sponsor|marketing|campaign|promo|offer/.test(t)) return 'marketing';
  if (/error|missing|incorrect|wrong|refund|inaccura|quality/.test(t)) return 'errorCharges';
  if (/tablet|device|subscription|fee|frais/.test(t)) return 'fees';
  if (/adjust|correction|ajust/.test(t)) return 'adjustments';
  return 'other';
}

export function classifyLine(text: string, hasOrder: boolean, c: { itemSales: number; net: number; errorCharges: number; refunds: number }): LineType {
  const t = text.toLowerCase();
  if (/payout|transfer to (your )?bank|direct deposit|virement/.test(t) && !hasOrder && !c.itemSales) return 'payout';
  if (/cancel|annul/.test(t)) return 'cancellation';
  if (/error/.test(t) || (c.errorCharges && !c.itemSales)) return 'error_charge';
  if (/refund|rembours/.test(t) || (c.refunds && !c.itemSales)) return 'refund';
  if (/adjust|correction|ajust/.test(t) && !c.itemSales) return 'adjustment';
  if (/\bads?\b|advert|sponsor|marketing|promo|campaign/.test(t) && !hasOrder) return 'marketing';
  if (/tablet|subscription|fee|frais/.test(t) && !hasOrder) return 'fee';
  if (hasOrder || c.itemSales) return 'order';
  return 'other';
}

function lineKey(parts: Array<string | number | null>, occurrence: number) {
  return crypto.createHash('sha1').update([...parts, occurrence].join('|')).digest('hex').slice(0, 20);
}

// ---------------------------------------------------------------- parse

export interface ParsedFile {
  file: string;
  format: SourceFormat | 'reference';
  platform: Platform | null;
  headers: string[];
  unmapped: string[];
  lines: FinanceLine[];
  bank: BankLine[];
  rows: number;
  skipped: number;
  /** Fee columns were positive in this file (costs printed as positive numbers) and were negated. */
  feesFlipped: boolean;
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

const COMPONENT_KEYS = ['itemSales', 'promotions', 'salesTax', 'tips', 'commission', 'commissionTax', 'marketing', 'fees', 'errorCharges', 'refunds', 'adjustments', 'other', 'taxWithheld'] as const;
type Comp = Record<(typeof COMPONENT_KEYS)[number], number>;

export function parseFinanceFile(fileName: string, bytes: Uint8Array, opts: { platform?: Platform | null; account?: string } = {}): ParsedFile {
  const table = readTable(fileName, bytes);
  // Uber Eats Manager downloads print two header rows: long descriptions, then the column names. Use the names.
  const named = table.findIndex((r, i) => i < 3 && r.some((c) => /^workflow id$/i.test(c.trim())) && r.some((c) => /^(total payout|order id)$/i.test(c.trim())));
  const { headers, rows } = splitHeader(named > 0 ? table.slice(named) : table);
  const det = detectFinanceFormat(headers, fileName);
  const platform = opts.platform ?? det.platform;
  const isClover = det.format === 'clover_payments' || det.format === 'clover_orders' || det.format === 'clover_deposits';
  const { map, tax, unmapped } = mapColumns(headers, det.rules, !isClover && det.format !== 'bank');
  const out: ParsedFile = { file: fileName, format: det.format, platform, headers, unmapped, lines: [], bank: [], rows: rows.length, skipped: 0, feesFlipped: false, warnings: [], dateFrom: null, dateTo: null };

  if (det.format === 'reference') { out.warnings.push(det.note ?? 'Reference report'); out.skipped = rows.length; return out; }
  const format: SourceFormat = det.format;
  if (format === 'uber_scan_payouts' || format === 'doordash_scan_charges') {
    out.lines = parseScanRows(format, headers, rows, fileName);
    out.skipped = rows.length - out.lines.length;
    finishDates(out, out.lines.map((l) => l.orderDate ?? l.payoutDate));
    out.warnings.push('Portal scan: statement totals include tax, so pre-tax sales and GST/QST are estimated until the per-order export arrives.');
    return out;
  }
  const dateCols = (['orderDate', 'orderDate2', 'payoutDate'] as Field[]).flatMap((f) => map[f] ?? []);
  const order = slashDateOrder(rows.flatMap((r) => dateCols.map((i) => r[i])));
  const day = (v: string) => isoDay(v, order);

  if (det.format === 'bank') {
    const acct = opts.account ?? (fileName.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/)?.[1] ?? '');
    const seen = new Map<string, number>();
    rows.forEach((row, i) => {
      const date = day(txt(row, map.orderDate));
      const amount = map.amount?.length ? amt(row, map.amount) : r2(Math.abs(amt(row, map.credit)) - Math.abs(amt(row, map.debit)));
      if (!date || !amount) { out.skipped++; return; }
      const description = maskDigits([txt(row, map.description), txt(row, map.orderRef)].filter(Boolean).join(' · ')).slice(0, 160);
      const account = (txt(row, map.account).replace(/\D/g, '').slice(-4)) || acct;
      const k = [date, amount.toFixed(2), description, account].join('|');
      const n = seen.get(k) ?? 0; seen.set(k, n + 1);
      out.bank.push({ key: lineKey(['bank', date, amount.toFixed(2), description, account], n), date, month: date.slice(0, 7), description, amount, account, bank: bankName(fileName), platformGuess: platformInText(description), source: fileName, row: i + 1 });
    });
    finishDates(out, out.bank.map((b) => b.date));
    if (!out.bank.length) out.warnings.push('No dated amounts found: check the date / amount columns.');
    return out;
  }

  if (!platform) {
    out.warnings.push('Platform not recognised: put the platform in the file name (uber_, doordash_, skip_, clover_, bank_) or tell Claude which report it is.');
    out.skipped = rows.length;
    return out;
  }

  // Which sign do fee columns use in this file? Pick the convention that explains the net column best.
  const feeIdx = FEE_FIELDS.flatMap((f) => map[f] ?? []);
  if (map.net?.length && (feeIdx.length || tax.some((t) => t.target === 'commissionTax')) && !isClover) {
    let errNeg = 0; let errPos = 0;
    for (const row of rows.slice(0, 500)) {
      const t = rowTax(row, tax);
      const fees = feeIdx.reduce((s, i) => s + parseAmount(row[i]), 0) + t.commissionTax;
      if (!fees) continue;
      const rest = (['itemSales', 'promotions', 'tips', 'errorCharges', 'refunds', 'adjustments', 'other', 'otherPayments', 'taxWithheld'] as Field[]).reduce((s, f) => s + amt(row, map[f]), 0) + t.salesTax;
      const net = amt(row, map.net);
      errNeg += Math.abs(net - (rest + fees)); errPos += Math.abs(net - (rest - fees));
    }
    out.feesFlipped = errPos < errNeg;
  }
  const feeSign = out.feesFlipped ? -1 : 1;

  const occurrences = new Map<string, number>();
  rows.forEach((row, i) => {
    const storeName = txt(row, map.storeName);
    const storeId = txt(row, map.storeId) || txt(row, map.storeId2);
    let orderRef = txt(row, map.orderRef);
    const orderRef2 = txt(row, map.orderRef2);
    const statusText = [txt(row, map.status), txt(row, map.txType)].filter(Boolean).join(' / ');
    let description = txt(row, map.description);
    const orderDate = day(txt(row, map.orderDate)) ?? day(txt(row, map.orderDate2));
    let payoutDate = day(txt(row, map.payoutDate));
    let payoutRef = txt(row, map.payoutRef);
    const payoutStatus = txt(row, map.payoutStatus);
    const currency = txt(row, map.currency);
    const t = rowTax(row, tax, { itemSales: amt(row, map.itemSales), promotions: amt(row, map.promotions), refunds: amt(row, map.refunds), adjustments: amt(row, map.adjustments), date: orderDate });
    const c: Comp = {
      itemSales: amt(row, map.itemSales), promotions: amt(row, map.promotions), salesTax: t.salesTax, tips: amt(row, map.tips),
      commission: r2(feeSign * amt(row, map.commission)), commissionTax: r2(feeSign * t.commissionTax),
      marketing: r2(feeSign * amt(row, map.marketing)), fees: r2(feeSign * amt(row, map.fees)),
      errorCharges: amt(row, map.errorCharges), refunds: amt(row, map.refunds), adjustments: amt(row, map.adjustments), other: amt(row, map.other),
      taxWithheld: amt(row, map.taxWithheld),
    };
    let gst = t.gst; let qst = t.qst; let otherTax = t.otherTax; let taxSplitEstimated = t.estimated;
    // Uber "Other payments": ads, error charges, tablet fees… by their description.
    const otherPayments = amt(row, map.otherPayments);
    if (otherPayments) { const b = classifyOtherPayment(description || statusText); c[b] = r2(c[b] + otherPayments); }

    let net: number;
    let infoDiscountsExtra = 0;
    let tender = '';
    let type: LineType;
    let level: FinanceLine['level'] = 'detail';
    let mode: Mode = modeOf([txt(row, map.mode), statusText].join(' '), platform);

    if (det.format === 'clover_payments' || det.format === 'clover_orders') {
      tender = txt(row, map.tender);
      const amount = amt(row, map.amount); const taxAmt = amt(row, map.tax);
      c.salesTax = taxAmt;
      // Clover payment amount includes tax; the tip is a separate column; refunds are their own rows or column.
      c.itemSales = r2(amount - taxAmt - c.other);
      // Items carry TPS 5 % + TVQ 9.975 % + a stray default "Sales Tax" 0.14975 %: when the tax charged fits the
      // three rates better than the two, the stray part is kept apart (it is not GST or QST).
      otherTax = 0;
      const withStray = Math.abs(taxAmt - c.itemSales * (GST_RATE + QST_RATE + CLOVER_STRAY_RATE));
      const without = Math.abs(taxAmt - c.itemSales * (GST_RATE + QST_RATE));
      if (taxAmt && c.itemSales > 0 && withStray <= without) otherTax = r2((taxAmt * CLOVER_STRAY_RATE) / (GST_RATE + QST_RATE + CLOVER_STRAY_RATE));
      const s = splitQuebecTax(r2(taxAmt - otherTax)); gst = s.gst; qst = s.qst; taxSplitEstimated = !!taxAmt;
      c.refunds = c.refunds ? -Math.abs(c.refunds) : 0;
      // Payment amounts are already after discounts; an orders export gives the discount separately.
      c.promotions = det.format === 'clover_orders' && c.promotions ? -Math.abs(c.promotions) : 0;
      if (det.format === 'clover_orders') c.itemSales = r2(c.itemSales - c.promotions); // back to the pre-discount price
      net = r2(amount + c.tips + c.refunds);
      if (/fail|declin|void|auth only|pending/i.test(statusText) && !/success|paid|approved/i.test(statusText)) { out.skipped++; return; }
      const viaPlatform = platformFromLabel(tender) ?? platformFromLabel(txt(row, map.mode)) ?? platformFromLabel(description, true);
      type = viaPlatform ? 'platform_in_clover' : amount < 0 || /refund/i.test(statusText) ? 'refund' : 'order';
      if (type === 'refund' && amount < 0) { c.refunds = r2(c.refunds + c.itemSales); c.itemSales = 0; }
      if (viaPlatform) description = `${description ? `${description} · ` : ''}Paid with "${tender || txt(row, map.mode)}" — platform order recorded in Clover; counted from the ${viaPlatform} statement instead`;
      if (!mode) mode = /online/i.test(txt(row, map.mode)) ? 'online' : 'in_store';
      payoutRef = /cash|espece/i.test(tender) ? 'cash' : '';
      payoutDate = null;
    } else if (det.format === 'clover_deposits') {
      // Deposit file → the deposit itself is a payout (bank reconciliation); only its fees are P&L lines.
      level = 'summary';
      payoutDate = day(txt(row, map.payoutDate)) ?? orderDate;
      const gross = amt(row, map.gross);
      const fees = -Math.abs(amt(row, map.fees));
      net = map.net?.length ? amt(row, map.net) : r2(gross + fees + c.refunds + c.adjustments);
      for (const k of COMPONENT_KEYS) c[k] = 0;
      c.fees = fees;
      gst = 0; qst = 0; otherTax = 0;
      type = 'payout';
      tender = txt(row, map.account).replace(/\D/g, '').slice(-4);
      description = [statusText, gross ? `gross ${gross.toFixed(2)}` : '', fees ? `fees ${fees.toFixed(2)}` : ''].filter(Boolean).join(' · ');
    } else {
      net = map.net?.length ? amt(row, map.net) : r2(Object.values(c).reduce((s, v) => s + v, 0));
      // DoorDash before April 2025: the current columns are 0 and the "(for historical reference only)" ones are real.
      if (det.format === 'doordash_transactions') {
        const histNet = amt(row, map.histNet);
        const merchantDiscount = Math.abs(amt(row, map.histMerchantDiscount));
        const marketingAll = amt(row, map.histMarketingAll); // discounts you funded + promotion fees, as one negative number
        const adFee = amt(row, map.histAdFee);
        // The historical "Adjustments" column: on an adjustment / error row it is the live adjustment (the live column
        // is empty before 2025); on an order row it is the credit that repaid a promotion or ad fee — the current
        // layout prints that one as "DoorDash marketing credit", so it belongs with marketing.
        const histAdj = c.adjustments === 0 ? amt(row, map.histAdjustments) : 0;
        const adjustmentRow = /adjustment|error/i.test(statusText);
        if (histAdj && adjustmentRow) c.adjustments = r2(c.adjustments + histAdj);
        const histCredit = histAdj && !adjustmentRow ? histAdj : 0;
        // Marketing and discounts lived in the historical columns until the spring 2025 layout, and some rows of the
        // transition carry both sets. Keep whichever set makes the row add up to its net total.
        const target = net !== 0 ? net : histNet;
        if ((marketingAll || merchantDiscount || adFee || histCredit) && target !== 0) {
          const sumWith = (promo: number, mkt: number, ctax: number) => r2(Object.values({ ...c, promotions: promo, marketing: mkt, commissionTax: ctax }).reduce((s, v) => s + v, 0));
          const histPromo = r2(-merchantDiscount), histMkt = r2((marketingAll + merchantDiscount) + adFee + histCredit);
          const histTax = r2(c.commissionTax + amt(row, map.histMarketingTax) + amt(row, map.histAdFeeTax));
          const resCurrent = Math.abs(target - sumWith(c.promotions, c.marketing, c.commissionTax));
          const resHist = Math.abs(target - sumWith(histPromo, histMkt, histTax));
          if (resHist < resCurrent) { c.promotions = histPromo; c.marketing = histMkt; c.commissionTax = histTax; infoDiscountsExtra = -Math.abs(amt(row, map.histDdDiscount)); }
        }
        if (net === 0 && histNet !== 0) net = histNet;
      }
      if (det.format === 'doordash_payouts' || det.format === 'uber_payouts' || (det.format === 'skip_statement' && det.rules === PAYOUT_RULES)) {
        level = 'summary'; type = 'payout';
        tender = txt(row, map.account).replace(/\D/g, '').slice(-4);
        payoutDate = payoutDate ?? day(txt(row, map.orderDate2)) ?? orderDate;
      } else {
        const hasOrder = Boolean(orderRef || orderRef2);
        type = classifyLine([statusText, description].join(' '), hasOrder, { itemSales: c.itemSales, net, errorCharges: c.errorCharges, refunds: c.refunds });
        // Generic statements (Skip…): an "error charge" / "adjustment" amount is only in the net column.
        if (det.format !== 'uber_payment_details' && det.format !== 'doordash_transactions' && !map.errorCharges && !map.adjustments && !map.refunds && !c.itemSales) {
          if (type === 'error_charge') c.errorCharges = net; else if (type === 'refund') c.refunds = net; else if (type === 'adjustment') c.adjustments = net;
          else if (type === 'marketing') c.marketing = net; else if (type === 'fee') c.fees = net;
        }
      }
    }
    // A cancelled order paid 0 is kept: it is a lost order (cancellation count and cost).
    if (!net && !Object.values(c).some(Boolean) && !(type === 'cancellation' && (orderRef || orderRef2))) { out.skipped++; return; }
    if (/^(total|totals|sum|subtotal|grand total)$/i.test(orderRef || statusText)) { out.skipped++; return; }
    if (currency && !/^(cad|ca\$|\$)$/i.test(currency)) out.warnings.push(`Row ${i + 1}: currency ${currency} (amounts assumed CAD).`);
    if (!gst && !qst && !otherTax && c.salesTax) { const s = splitQuebecTax(c.salesTax); gst = s.gst; qst = s.qst; taxSplitEstimated = true; }
    // Uber "Other payments" (data fee, tablet fee, ads…) are printed before tax; the GST+QST on them is inside the
    // total payout but in no column. When the residual is exactly that tax, book it as recoverable tax on fees.
    if (platform === 'uber_eats' && otherPayments) {
      const provisional = r2(net - r2(Object.values(c).reduce((s, v) => s + v, 0)));
      if (provisional !== 0 && Math.abs(provisional - r2(otherPayments * (GST_RATE + QST_RATE))) <= 0.02) c.commissionTax = r2(c.commissionTax + provisional);
    }
    const explained = r2(Object.values(c).reduce((s, v) => s + v, 0));
    const unexplained = level === 'summary' || isClover ? 0 : r2(net - explained);
    const rateText = txt(row, map.printedRate);
    const rateNum = rateText ? parseAmount(rateText) : NaN;
    if (!orderRef && orderRef2) orderRef = orderRef2;
    const keyParts = [platform, det.format, orderRef, orderRef2, payoutRef, type, net.toFixed(2), orderDate ?? '', payoutDate ?? '', storeId || storeName, orderRef || orderRef2 ? '' : description];
    const base = keyParts.join('|');
    const n = occurrences.get(base) ?? 0; occurrences.set(base, n + 1);
    const status = /cancel|annul/i.test(statusText) ? 'cancelled' : /refund/i.test(statusText) ? 'refunded' : statusText.toLowerCase().slice(0, 40);
    // The platform charged the customer QST only (no GST) outside the GST holiday: GST is still owed on the pre-tax price.
    const inHoliday = !!orderDate && orderDate >= GST_HOLIDAY[0] && orderDate <= GST_HOLIDAY[1];
    const qstOnly = level === 'detail' && platform !== 'clover' && (type === 'order' || type === 'cancellation') && c.salesTax > 0 && r2(gst) === 0 && !inHoliday;
    const qstOnlySales = qstOnly ? r2(c.itemSales + c.promotions > 0 ? c.itemSales + c.promotions : c.itemSales) : 0;
    const line: FinanceLine = {
      key: lineKey(keyParts, n), platform, level, type, status, mode, storeId, storeName,
      brand: '', location: '', kitchen: '', mappedBy: 'none',
      orderRef, orderRef2: orderRef2 === orderRef ? '' : orderRef2, orderDate, month: (orderDate ?? payoutDate ?? '').slice(0, 7),
      payoutRef, payoutDate, payoutStatus: level === 'summary' ? statusText : payoutStatus,
      ...c, gst: r2(gst), qst: r2(c.salesTax - r2(gst) - otherTax), otherTax, taxSplitEstimated, net, unexplained,
      infoTaxRemittedByPlatform: amt(row, map.infoTaxRemitted), infoPlatformFundedDiscounts: r2(amt(row, map.infoPlatformDiscounts) + infoDiscountsExtra),
      qstOnlySales, gstNotCharged: r2(qstOnlySales * GST_RATE),
      printedRate: Number.isFinite(rateNum) ? (Math.abs(rateNum) > 1 ? rateNum / 100 : rateNum) : null,
      description: [statusText, description].filter(Boolean).join(' — ').slice(0, 220), tender,
      inPnl: type !== 'payout' && type !== 'platform_in_clover', orderCount: 0, cancelledCount: 0, notes: [],
      source: fileName, format, row: i + 1,
    };
    if (Math.abs(unexplained) >= 0.05) line.notes.push(`Statement net differs from its components by ${unexplained.toFixed(2)}`);
    if (/reject|fail|return/i.test(payoutStatus)) line.notes.push(`Payout status: ${payoutStatus}`);
    out.lines.push(line);
  });
  finishDates(out, out.lines.map((l) => l.orderDate ?? l.payoutDate));
  if (unmapped.length) out.warnings.push(`Columns not used: ${unmapped.slice(0, 25).join(', ')}${unmapped.length > 25 ? '…' : ''}`);
  return out;
}

function finishDates(out: ParsedFile, dates: Array<string | null>) {
  const ds = dates.filter((d): d is string => Boolean(d)).sort();
  out.dateFrom = ds[0] ?? null; out.dateTo = ds[ds.length - 1] ?? null;
}

export function platformInText(s: string): Platform | '' {
  const t = s.toLowerCase();
  if (/uber/.test(t)) return 'uber_eats';
  if (/door ?dash/.test(t)) return 'doordash';
  if (/skip ?the ?dishes|skipthedishes|\bskip\b|just ?eat/.test(t)) return 'skip';
  if (/clover|fiserv|first ?data|fdms|bams|merch(ant)? dep/.test(t)) return 'clover';
  if (/too ?good/.test(t)) return 'tgtg';
  return '';
}

function bankName(file: string): string {
  const f = file.toLowerCase();
  if (/bmo|montreal/.test(f)) return 'BMO';
  if (/desjardins|caisse/.test(f)) return 'Desjardins';
  if (/rbc|royal/.test(f)) return 'RBC';
  if (/\btd\b|_td_/.test(f)) return 'TD';
  if (/national|bnc/.test(f)) return 'National Bank';
  return '';
}
