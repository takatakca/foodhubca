// Finance A–Z: one normalized line per row of any platform / Clover / bank export.
//
// Sign convention: every amount is signed as it moves the restaurant's money — income +, deductions −
// (commission, marketing, fees, error charges, refunds and promotions you funded are negative).
// For a complete statement row:  net = itemSales + promotions + salesTax + tips + commission + commissionTax
//                                     + marketing + fees + errorCharges + refunds + adjustments + other + taxWithheld
// and `unexplained` holds whatever the file does not break down.

export type Platform = 'uber_eats' | 'doordash' | 'skip' | 'clover' | 'tgtg';

export const PLATFORM_LABEL: Record<Platform, string> = {
  uber_eats: 'Uber Eats', doordash: 'DoorDash', skip: 'SkipTheDishes', clover: 'Clover (direct)', tgtg: 'Too Good To Go',
};

export type LineType =
  | 'order' | 'cancellation' | 'refund' | 'error_charge' | 'adjustment' | 'marketing' | 'fee' | 'other'
  /** A transfer to the bank printed inside a transactions file: never income. */
  | 'payout'
  /** A platform order recorded in Clover (Food Hub / UrbanPiper settle platform orders with a platform tender). */
  | 'platform_in_clover';

export type SourceFormat =
  | 'uber_payment_details' | 'uber_payouts' | 'doordash_transactions' | 'doordash_payouts' | 'skip_statement'
  | 'clover_payments' | 'clover_orders' | 'clover_deposits' | 'bank' | 'generic'
  /** Portal scans written by Food Hub sessions (private/uber/uber-payouts.csv, private/doordash/doordash-charges.csv). */
  | 'uber_scan_payouts' | 'doordash_scan_charges';

export type Mode = 'delivery' | 'pickup' | 'dine_in' | 'in_store' | 'online' | '';

export interface FinanceLine {
  key: string;
  platform: Platform;
  /**
   * detail = one order / transaction · summary = one payout or period total (used only when no detail exists) ·
   * reference = an itemized line the period totals already include (error charge, tablet fee seen in a portal scan):
   * listed in the registers, never added to the P&L.
   */
  level: 'detail' | 'summary' | 'reference';
  type: LineType;
  status: string;
  mode: Mode;
  storeId: string;
  storeName: string;
  brand: string;
  location: string;
  kitchen: string;
  /** How brand/location were found: map (store-map.csv), name (matched from the store name), none. */
  mappedBy: 'map' | 'name' | 'none';
  orderRef: string;
  orderRef2: string;
  orderDate: string | null;
  month: string;
  payoutRef: string;
  payoutDate: string | null;
  /** As printed: Uber "Paid / Pending / Rejected by Bank", DoorDash payout status. */
  payoutStatus: string;
  itemSales: number;
  promotions: number;
  /** All tax on sales passed to you = gst + qst + otherTax. */
  salesTax: number;
  gst: number;
  qst: number;
  /** Tax collected that is neither GST nor QST (Clover's stray default "Sales Tax" 0.14975 %). */
  otherTax: number;
  /** GST/QST split computed 5 : 9.975 because the file only had a combined tax column. */
  taxSplitEstimated: boolean;
  tips: number;
  commission: number;
  commissionTax: number;
  marketing: number;
  fees: number;
  errorCharges: number;
  refunds: number;
  adjustments: number;
  other: number;
  /** Tax the platform kept to remit itself (marketplace-facilitator style); part of the net computation. */
  taxWithheld: number;
  net: number;
  unexplained: number;
  /** Information only (not in net): tax the platform says it remitted, discounts funded by the platform. */
  infoTaxRemittedByPlatform: number;
  infoPlatformFundedDiscounts: number;
  /** Pre-tax sales on which the platform charged the customer QST only (no GST) outside the GST holiday. */
  qstOnlySales: number;
  /** GST owed on those sales anyway (5 % of the pre-tax price): not collected, so it comes out of the proceeds. */
  gstNotCharged: number;
  /** Commission rate printed on the statement (fraction), when given. */
  printedRate: number | null;
  description: string;
  /** Tender for Clover payments; account last 4 for summaries. */
  tender: string;
  inPnl: boolean;
  /** 1 on the first line of each distinct order (so sums count orders, not lines). */
  orderCount: number;
  cancelledCount: number;
  notes: string[];
  source: string;
  format: SourceFormat;
  row: number;
}

export interface BankLine {
  key: string;
  date: string | null;
  month: string;
  description: string;
  amount: number;
  account: string;
  bank: string;
  platformGuess: Platform | '';
  source: string;
  row: number;
}

export interface PayoutRecord {
  key: string;
  platform: Platform;
  payoutRef: string;
  payoutDate: string | null;
  storeId: string;
  storeName: string;
  brand: string;
  location: string;
  /** Sum of the statement lines paid in this payout (detail files). */
  linesNet: number | null;
  lines: number;
  /** Amount printed by a payout summary file. */
  summaryAmount: number | null;
  status: string;
  account: string;
  /** Best statement figure: summary amount when present, else the detail sum. */
  amount: number;
  bank: { date: string | null; amount: number; description: string; account: string; key: string } | null;
  gap: number | null;
  match: 'matched' | 'amount_differs' | 'not_in_bank' | 'bank_not_loaded' | 'unpaid' | 'failed';
}

export const COMPONENTS = [
  'itemSales', 'promotions', 'salesTax', 'tips', 'commission', 'commissionTax', 'marketing', 'fees',
  'errorCharges', 'refunds', 'adjustments', 'other', 'taxWithheld',
] as const;
export type Component = (typeof COMPONENTS)[number];

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100 || 0;

export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;
/** Clover tax rate "Sales Tax" set as default on the On2GO.CA merchant (Clover stores 14975 = 0.14975 %). */
export const CLOVER_STRAY_RATE = 0.0014975;

/** Splits a combined GST+QST amount into its two parts (Québec, 5 : 9.975). */
export function splitQuebecTax(total: number): { gst: number; qst: number } {
  const gst = r2((total * GST_RATE) / (GST_RATE + QST_RATE));
  return { gst, qst: r2(total - gst) };
}

/** Kitchens: 6280 + 6284 Somerled are one kitchen (NDG); 5837 + 5839 Jean-Talon E are one (Saint-Léonard); 6241 Boul. Léger (Montréal-Nord) is closed. */
export const KITCHEN_OF: Record<string, string> = {
  NDG_MAIN: 'NDG (Somerled)', NDG_6284: 'NDG (Somerled)', SAINT_LEONARD: 'Saint-Léonard (Jean-Talon E)', HOCHELAGA: 'Hochelaga (Ste-Catherine E)',
  MONTREAL_NORD: 'Montréal-Nord (6241 Léger, old)',
};
