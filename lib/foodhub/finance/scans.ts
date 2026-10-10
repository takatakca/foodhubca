// Portal scans written by Food Hub sessions (read-only summaries of what the merchant portals show), used until the
// platforms' own per-order exports arrive:
//   uber-payouts.csv     weekly payouts per store (May 2026 →) and monthly statements per store (Jan 2025 →)
//   doordash-charges.csv monthly statements per store (2026) + itemized error charges, credits, tablet fees, cancellations
// Statement totals include tax ("earnings", "sales"), so pre-tax sales and GST/QST are estimated and flagged. The P&L
// uses a statement month only while no per-order export covers that platform-month (analysis.finalize).
import crypto from 'node:crypto';
import { parseAmount } from '../recon/statements';
import { GST_RATE, QST_RATE, r2, type FinanceLine, type Platform, type SourceFormat } from './model';

/** Share of the month GST applied to restaurant food (federal GST holiday 2024-12-14 → 2025-02-15). */
export function gstShare(month: string): number {
  if (month === '2024-12') return 13 / 31;
  if (month === '2025-01') return 0;
  if (month === '2025-02') return 13 / 28;
  return 1;
}

/** Tax-included food sales → pre-tax sales, GST, QST (estimates). */
export function splitTaxIncluded(gross: number, month: string): { items: number; gst: number; qst: number } {
  const share = gstShare(month);
  const items = r2(gross / (1 + GST_RATE * share + QST_RATE));
  const gst = r2(items * GST_RATE * share);
  return { items, gst, qst: r2(gross - items - gst) };
}

/** Platform fees with tax included → fee, tax on fee (GST + QST always apply to the platforms' services). */
function splitFee(total: number): { fee: number; tax: number } {
  const fee = r2(total / (1 + GST_RATE + QST_RATE));
  return { fee, tax: r2(total - fee) };
}

const isoOf = (s: string): string | null => {
  const t = String(s ?? '').trim();
  const m = t.match(/(\d{4}-\d{2}-\d{2})\s*$/) ?? t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const ms = Date.parse(t);
  return Number.isFinite(ms) && /\d{4}/.test(t) ? new Date(ms).toLocaleDateString('en-CA') : null;
};

function blank(platform: Platform, format: SourceFormat, source: string, row: number): FinanceLine {
  return {
    key: '', platform, level: 'summary', type: 'order', status: '', mode: '', storeId: '', storeName: '', brand: '', location: '', kitchen: '', mappedBy: 'none',
    orderRef: '', orderRef2: '', orderDate: null, month: '', payoutRef: '', payoutDate: null, payoutStatus: '',
    itemSales: 0, promotions: 0, salesTax: 0, gst: 0, qst: 0, otherTax: 0, taxSplitEstimated: false, tips: 0, commission: 0, commissionTax: 0,
    marketing: 0, fees: 0, errorCharges: 0, refunds: 0, adjustments: 0, other: 0, taxWithheld: 0, net: 0, unexplained: 0,
    infoTaxRemittedByPlatform: 0, infoPlatformFundedDiscounts: 0, printedRate: null, description: '', tender: '',
    inPnl: false, orderCount: 0, cancelledCount: 0, notes: [], source, format, row,
  };
}

function finishKey(l: FinanceLine, seen: Map<string, number>) {
  const base = [l.platform, l.format, l.level, l.type, l.storeId, l.month, l.orderRef, l.payoutRef, l.orderDate ?? '', l.net.toFixed(2), l.description].join('|');
  const n = seen.get(base) ?? 0; seen.set(base, n + 1);
  l.key = crypto.createHash('sha1').update(`${base}|${n}`).digest('hex').slice(0, 20);
}

const UBER_NOTE = 'Uber monthly statement (portal scan): pre-tax sales and GST/QST estimated from tax-included earnings; Uber fees split 5 % + 9.975 %; "Amendments" mix the weekly fee, refunds and error charges';
const DD_NOTE = 'DoorDash monthly statement (portal scan): pre-tax sales and GST/QST estimated from tax-included sales; "DoorDash services" = commission + tablet fee + marketing with tax (split needs the Transactions export)';

/** Rows of a scan file (header row already split off) → finance lines. */
export function parseScanRows(format: 'uber_scan_payouts' | 'doordash_scan_charges', headers: string[], rows: string[][], source: string): FinanceLine[] {
  const H = headers.map((h) => h.toLowerCase().replace(/_/g, ' ').trim());
  const col = (name: string) => H.indexOf(name);
  const get = (r: string[], name: string) => (col(name) >= 0 ? String(r[col(name)] ?? '').trim() : '');
  const num = (r: string[], name: string) => parseAmount(get(r, name));
  const out: FinanceLine[] = []; const seen = new Map<string, number>();

  rows.forEach((r, i) => {
    if (format === 'uber_scan_payouts') {
      const section = get(r, 'section');
      const l = blank('uber_eats', format, source, i + 1);
      l.storeName = get(r, 'store'); l.storeId = get(r, 'uuid8');
      const net = num(r, 'net payout cad');
      if (section === 'monthly') {
        const month = get(r, 'period').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        const earnings = num(r, 'earnings cad'); const fees = num(r, 'uber fees cad');
        if (!earnings && !fees && !num(r, 'marketing cad') && !num(r, 'amendments cad') && !net) return;
        const t = splitTaxIncluded(earnings, month); const f = splitFee(fees);
        Object.assign(l, {
          type: 'order', status: 'monthly statement', month, orderDate: `${month}-01`,
          itemSales: t.items, gst: t.gst, qst: t.qst, salesTax: r2(t.gst + t.qst), taxSplitEstimated: true,
          commission: f.fee, commissionTax: f.tax, marketing: num(r, 'marketing cad'), adjustments: num(r, 'amendments cad'), net,
          description: `Monthly statement ${month}`,
        });
        l.unexplained = r2(net - (l.itemSales + l.salesTax + l.commission + l.commissionTax + l.marketing + l.adjustments));
        l.notes.push(UBER_NOTE);
      } else if (section === 'weekly') {
        const status = get(r, 'status'); const note = get(r, 'note');
        if (!net && /no payout|ongoing/i.test(status) && !/hold/i.test(note)) return; // nothing earned / nothing pending
        const deposit = isoOf(get(r, 'deposit date'));
        Object.assign(l, {
          type: 'payout', status: [status, note].filter(Boolean).join(' — '), payoutStatus: status,
          payoutRef: `${l.storeId} ${get(r, 'period')}`.trim(), payoutDate: /settled/i.test(status) ? deposit : null,
          month: (deposit ?? '').slice(0, 7), net, tender: get(r, 'bank last digits').replace(/\D/g, ''),
          description: `Weekly payout ${get(r, 'period')}${deposit && !/settled/i.test(status) ? ` (expected ${deposit})` : ''}`,
        });
      } else return;
      l.notes.push('Portal scan: private/uber/uber-payouts.csv');
      out.push(l); finishKey(l, seen);
    } else {
      const type = get(r, 'type');
      const l = blank('doordash', format, source, i + 1);
      l.storeId = get(r, 'store id'); l.storeName = get(r, 'store name');
      const date = isoOf(get(r, 'date')) ?? isoOf(get(r, 'period'));
      const amount = num(r, 'amount');
      if (type === 'statement') {
        const month = get(r, 'period').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        const t = splitTaxIncluded(num(r, 'sales'), month); const f = splitFee(num(r, 'doordash services'));
        Object.assign(l, {
          type: 'order', status: 'monthly statement', month, orderDate: `${month}-01`,
          itemSales: t.items, gst: t.gst, qst: t.qst, salesTax: r2(t.gst + t.qst), taxSplitEstimated: true,
          commission: f.fee, commissionTax: f.tax, adjustments: num(r, 'amendments'), net: num(r, 'net'),
          description: `${get(r, 'description')} ${month} · ${get(r, 'order protocol')} · ${get(r, 'store status')}`.trim(),
        });
        l.unexplained = r2(l.net - (l.itemSales + l.salesTax + l.commission + l.commissionTax + l.adjustments));
        l.notes.push(DD_NOTE);
      } else {
        // Itemized lines: the monthly statements already include them → registers only.
        l.level = 'reference';
        l.orderRef = get(r, 'order id'); l.orderDate = date; l.month = (date ?? '').slice(0, 7);
        l.payoutRef = get(r, 'payout id'); l.status = get(r, 'status');
        l.description = [get(r, 'description'), get(r, 'period')].filter(Boolean).join(' · ');
        if (type === 'error_charge') { l.type = 'error_charge'; l.errorCharges = amount; }
        else if (type === 'adjustment') { l.type = 'adjustment'; l.adjustments = amount; }
        else if (type === 'tablet_fee' || type === 'tablet_fee_rebate') { l.type = 'fee'; l.fees = amount; }
        else if (type === 'cancelled_order') { l.type = 'cancellation'; l.status = 'cancelled — not paid'; }
        else { l.type = 'other'; l.other = amount; }
        l.net = amount;
      }
      l.notes.push('Portal scan: private/doordash/doordash-charges.csv');
      out.push(l); finishKey(l, seen);
    }
  });
  return out;
}
