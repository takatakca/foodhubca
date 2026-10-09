// Finance A–Z workbook. Every total is a live formula over the "Lines" tab (SUMIFS), written with the value Food Hub
// computed as its cached result — the verify script recalculates in Excel and compares both.
// Tabs the owner types into (Disputes, Money_Held, To_Do, Payouts_vs_Bank notes) are read back before rebuilding.
import type { DisputeRow, HeldRow } from './analysis';
import type { ParsedFile } from './formats';
import { CLOVER_STRAY_RATE, GST_RATE, PLATFORM_LABEL, QST_RATE, r2, type BankLine, type FinanceLine, type PayoutRecord, type Platform } from './model';
import type { StoreEntry } from './stores';
import { buildXlsx, colName, excelDate, type Cell, type Row, type Sheet, type StyleKey } from './xlsx';

export interface RuleRow { id: string; section: string; label: string; value: number | string; unit: string; source: string; confidence: string }
export interface TodoRow { id: string; priority: 'P1' | 'P2' | 'P3'; area: string; task: string; platform: string; amount: number | null; due: string | null; who: string; status: string; notes: string }
export interface ExportItem {
  id: string; platform: string; report: string; where: string; range: string; format: string; formats: string[];
  /** Formats that cover part of this export (a portal scan: monthly totals instead of order lines). */
  partial?: string[];
}
export interface UnreadableFile { file: string; reason: string }
/** Owner-typed columns from the previous workbook: sheet → row key → column header → value. */
export type OwnerEdits = Record<string, Map<string, Record<string, string>>>;

export interface WorkbookInput {
  asOf: string;
  company: string;
  lines: FinanceLine[];
  bank: BankLine[];
  payouts: PayoutRecord[];
  unmatchedBank: BankLine[];
  disputes: DisputeRow[];
  held: HeldRow[];
  todos: TodoRow[];
  rules: RuleRow[];
  stores: StoreEntry[];
  files: ParsedFile[];
  unreadable: UnreadableFile[];
  exportsChecklist: ExportItem[];
  unknownStores: Array<{ platform: Platform; storeId: string; storeName: string; lines: number }>;
  edits: OwnerEdits;
  duplicates: number;
}

// ---------------------------------------------------------------- Lines tab layout

type NumField = 'orderCount' | 'cancelledCount' | 'itemSales' | 'promotions' | 'gst' | 'qst' | 'otherTax' | 'tips' | 'commission' | 'commissionTax'
  | 'marketing' | 'fees' | 'errorCharges' | 'refunds' | 'adjustments' | 'other' | 'taxWithheld' | 'unexplained' | 'net' | 'infoTaxRemittedByPlatform';

interface LineCol { key: string; h: string; w: number; s?: StyleKey; get: (l: FinanceLine) => Cell['v'] }
const LINE_COLS: LineCol[] = [
  { key: 'key', h: 'Key', w: 12, get: (l) => l.key },
  { key: 'platform', h: 'Platform', w: 13, get: (l) => PLATFORM_LABEL[l.platform] },
  { key: 'brand', h: 'Brand', w: 22, get: (l) => l.brand },
  { key: 'location', h: 'Location', w: 14, get: (l) => l.location },
  { key: 'kitchen', h: 'Kitchen', w: 22, get: (l) => l.kitchen },
  { key: 'store', h: 'Store (as printed)', w: 28, get: (l) => l.storeName },
  { key: 'storeId', h: 'Store ID', w: 14, get: (l) => l.storeId },
  { key: 'month', h: 'Month', w: 9, s: 'month', get: (l) => monthSerial(l.month) },
  { key: 'year', h: 'Year', w: 6, s: 'num', get: (l) => (l.month ? Number(l.month.slice(0, 4)) : null) },
  { key: 'orderDate', h: 'Order date', w: 11, s: 'date', get: (l) => excelDate(l.orderDate) },
  { key: 'orderRef', h: 'Order ref', w: 16, get: (l) => l.orderRef },
  { key: 'type', h: 'Type', w: 14, get: (l) => l.type },
  { key: 'status', h: 'Status', w: 14, get: (l) => l.status },
  { key: 'mode', h: 'Mode', w: 9, get: (l) => l.mode },
  { key: 'inPnl', h: 'In P&L', w: 7, get: (l) => (l.inPnl ? 'Y' : 'N') },
  { key: 'orderCount', h: 'Orders', w: 7, s: 'int', get: (l) => l.orderCount },
  { key: 'cancelledCount', h: 'Cancelled', w: 9, s: 'int', get: (l) => l.cancelledCount },
  { key: 'itemSales', h: 'Item sales (pre-tax)', w: 12, s: 'money', get: (l) => l.itemSales },
  { key: 'promotions', h: 'Promotions you funded', w: 12, s: 'money', get: (l) => l.promotions },
  { key: 'gst', h: 'GST on sales', w: 10, s: 'money', get: (l) => l.gst },
  { key: 'qst', h: 'QST on sales', w: 10, s: 'money', get: (l) => l.qst },
  { key: 'otherTax', h: 'Other tax collected (Clover "Sales Tax")', w: 12, s: 'money', get: (l) => l.otherTax },
  { key: 'tips', h: 'Tips', w: 9, s: 'money', get: (l) => l.tips },
  { key: 'commission', h: 'Commission', w: 11, s: 'money', get: (l) => l.commission },
  { key: 'commissionTax', h: 'GST/QST on commission & fees', w: 12, s: 'money', get: (l) => l.commissionTax },
  { key: 'marketing', h: 'Marketing & ads', w: 11, s: 'money', get: (l) => l.marketing },
  { key: 'fees', h: 'Fees (tablet, processing, other)', w: 11, s: 'money', get: (l) => l.fees },
  { key: 'errorCharges', h: 'Error charges', w: 10, s: 'money', get: (l) => l.errorCharges },
  { key: 'refunds', h: 'Refunds charged to you', w: 10, s: 'money', get: (l) => l.refunds },
  { key: 'adjustments', h: 'Adjustments', w: 10, s: 'money', get: (l) => l.adjustments },
  { key: 'other', h: 'Other', w: 9, s: 'money', get: (l) => l.other },
  { key: 'taxWithheld', h: 'Tax withheld by platform', w: 10, s: 'money', get: (l) => l.taxWithheld },
  { key: 'unexplained', h: 'Unexplained by statement', w: 10, s: 'money', get: (l) => l.unexplained },
  { key: 'net', h: 'Net payout (statement)', w: 12, s: 'money', get: (l) => l.net },
  { key: 'payoutDate', h: 'Payout date', w: 11, s: 'date', get: (l) => excelDate(l.payoutDate) },
  { key: 'payoutRef', h: 'Payout ref', w: 18, get: (l) => l.payoutRef },
  { key: 'payoutStatus', h: 'Payout status', w: 12, get: (l) => l.payoutStatus },
  { key: 'level', h: 'Level', w: 8, get: (l) => l.level },
  { key: 'mappedBy', h: 'Store mapped by', w: 9, get: (l) => l.mappedBy },
  { key: 'description', h: 'Description', w: 40, get: (l) => l.description },
  { key: 'notes', h: 'Notes', w: 40, get: (l) => l.notes.join(' · ') },
  { key: 'infoTaxRemittedByPlatform', h: 'Tax remitted by platform (info)', w: 11, s: 'money', get: (l) => l.infoTaxRemittedByPlatform },
  { key: 'infoPlatformFundedDiscounts', h: 'Platform-funded discounts (info)', w: 11, s: 'money', get: (l) => l.infoPlatformFundedDiscounts },
  { key: 'printedRate', h: 'Printed commission rate', w: 9, s: 'pct', get: (l) => l.printedRate },
  { key: 'source', h: 'Source file', w: 30, get: (l) => l.source },
  { key: 'row', h: 'Row', w: 6, s: 'int', get: (l) => l.row },
];
const LC: Record<string, string> = Object.fromEntries(LINE_COLS.map((c, i) => [c.key, colName(i)]));
const LCOL = (k: string) => { const c = LC[k]; if (!c) throw new Error(`Unknown Lines column ${k}`); return `Lines!$${c}:$${c}`; };

/** Unrounded like Excel (rounding cached values to the cent would differ from the recalculated sum by half a cent). */
const raw = (n: number) => Math.round(n * 1e9) / 1e9;

function monthSerial(month: string): number | null { return month ? excelDate(`${month}-01`) : null; }

// ---------------------------------------------------------------- SUMIFS with cached values

type Crit = { col: string; ref: string; test: (l: FinanceLine) => boolean };
const critPlatform = (ref: string, p: Platform): Crit => ({ col: 'platform', ref, test: (l) => l.platform === p });
const critMonth = (ref: string, m: string): Crit => ({ col: 'month', ref, test: (l) => l.month === m });
const critYear = (ref: string, y: number): Crit => ({ col: 'year', ref, test: (l) => Number(l.month.slice(0, 4)) === y });
const critText = (col: 'brand' | 'location' | 'kitchen' | 'mode' | 'type', ref: string, v: string): Crit => ({ col, ref, test: (l) => String(l[col as keyof FinanceLine] ?? '') === v });

class Summer {
  private pnl: FinanceLine[];
  constructor(lines: FinanceLine[]) { this.pnl = lines.filter((l) => l.inPnl); }
  cell(field: NumField, crits: Crit[], s: StyleKey = 'money'): Cell {
    const f = `SUMIFS(${LCOL(field)},${LCOL('inPnl')},"Y"${crits.map((c) => `,${LCOL(c.col)},${c.ref}`).join('')})`;
    const v = r2(this.pnl.filter((l) => crits.every((c) => c.test(l))).reduce((a, l) => a + (Number(l[field as keyof FinanceLine]) || 0), 0));
    return { f, v, s };
  }
}

// P&L column set shared by the summary tables. `sum` columns are SUMIFS; `calc` columns are formulas on the same row.
interface PCol { key: string; h: string; w?: number; s?: StyleKey; sum?: NumField; calc?: (ref: (k: string) => string) => string; val?: (v: (k: string) => number) => number }
const PNL_COLS: PCol[] = [
  { key: 'orders', h: 'Orders', s: 'int', sum: 'orderCount' },
  { key: 'cancelled', h: 'Cancelled orders', s: 'int', sum: 'cancelledCount' },
  { key: 'sales', h: 'Item sales (pre-tax)', sum: 'itemSales' },
  { key: 'promo', h: 'Promotions you funded', sum: 'promotions' },
  { key: 'netFood', h: 'Net food sales', calc: (r) => `${r('sales')}+${r('promo')}`, val: (v) => v('sales') + v('promo') },
  { key: 'gst', h: 'GST collected', sum: 'gst' },
  { key: 'qst', h: 'QST collected', sum: 'qst' },
  { key: 'otax', h: 'Other tax collected (Clover "Sales Tax")', sum: 'otherTax' },
  { key: 'tips', h: 'Tips', sum: 'tips' },
  { key: 'gross', h: 'Gross receipts (food + tax + tips)', calc: (r) => `${r('netFood')}+${r('gst')}+${r('qst')}+${r('otax')}+${r('tips')}`, val: (v) => v('netFood') + v('gst') + v('qst') + v('otax') + v('tips') },
  { key: 'comm', h: 'Commission', sum: 'commission' },
  { key: 'commTax', h: 'GST/QST on commission & fees (recoverable)', sum: 'commissionTax' },
  { key: 'mkt', h: 'Marketing & ads', sum: 'marketing' },
  { key: 'fees', h: 'Fees (tablet, processing, other)', sum: 'fees' },
  { key: 'err', h: 'Error charges', sum: 'errorCharges' },
  { key: 'ref', h: 'Refunds charged to you', sum: 'refunds' },
  { key: 'adj', h: 'Adjustments', sum: 'adjustments' },
  { key: 'oth', h: 'Other', sum: 'other' },
  { key: 'wh', h: 'Tax withheld by platform', sum: 'taxWithheld' },
  { key: 'unex', h: 'Unexplained by statement', sum: 'unexplained' },
  { key: 'net', h: 'Net payout (statement)', sum: 'net', s: 'moneyBold' },
  { key: 'check', h: 'Check (must be 0)', calc: (r) => `ROUND(${r('net')}-(${['gross', 'comm', 'commTax', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth', 'wh', 'unex'].map(r).join('+')}),2)`, val: (v) => r2(v('net') - ['gross', 'comm', 'commTax', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth', 'wh', 'unex'].reduce((a, k) => a + v(k), 0)) },
  { key: 'netRev', h: 'Net revenue after platform costs (ex-tax)', s: 'moneyBold', calc: (r) => ['netFood', 'comm', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth'].map(r).join('+'), val: (v) => ['netFood', 'comm', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth'].reduce((a, k) => a + v(k), 0) },
  { key: 'commPct', h: 'Commission %', s: 'pct', calc: (r) => `IF(${r('sales')}=0,0,-${r('comm')}/${r('sales')})`, val: (v) => (v('sales') ? -v('comm') / v('sales') : 0) },
  { key: 'allInPct', h: 'All-in platform cost %', s: 'pct', calc: (r) => `IF(${r('sales')}=0,0,-(${['promo', 'comm', 'mkt', 'fees', 'err', 'ref'].map(r).join('+')})/${r('sales')})`, val: (v) => (v('sales') ? -['promo', 'comm', 'mkt', 'fees', 'err', 'ref'].reduce((a, k) => a + v(k), 0) / v('sales') : 0) },
  { key: 'perOrder', h: 'Net revenue per order', calc: (r) => `IF(${r('orders')}=0,0,${r('netRev')}/${r('orders')})`, val: (v) => (v('orders') ? v('netRev') / v('orders') : 0) },
];

/** Cells for one P&L row starting at column index `c0` (labels before it). */
function pnlCells(sm: Summer, cols: PCol[], c0: number, rowNum: number, crits: Crit[], total = false): Cell[] {
  const idx = new Map(cols.map((c, i) => [c.key, i]));
  const ref = (k: string) => `${colName(c0 + idx.get(k)!)}${rowNum}`;
  const vals = new Map<string, number>();
  const v = (k: string) => vals.get(k) ?? 0;
  return cols.map((c) => {
    const style: StyleKey = total ? (c.s === 'int' ? 'intBold' : c.s === 'pct' ? 'pctBold' : 'moneyTotal') : c.s ?? 'money';
    if (c.sum) { const cell = sm.cell(c.sum, crits, style); vals.set(c.key, Number(cell.v)); return cell; }
    const raw = c.val!(v);
    // Unrounded, like Excel (a rounded cached value could differ from the recalculated one by half a cent).
    const value = Math.round(raw * 1e9) / 1e9;
    vals.set(c.key, value);
    return { f: c.calc!(ref), v: value, s: style };
  });
}

const hdr = (labels: string[]): Cell[] => labels.map((h) => ({ v: h, s: 'header' }));
const T = (v: string, s: StyleKey = 'title'): Cell => ({ v, s });

// ---------------------------------------------------------------- build

export function buildFinanceWorkbook(input: WorkbookInput): { bytes: Uint8Array; expected: Record<string, number | string> } {
  const sm = new Summer(input.lines);
  const platforms = (Object.keys(PLATFORM_LABEL) as Platform[]).filter((p) => input.lines.some((l) => l.platform === p && l.inPnl));
  const months = [...new Set(input.lines.filter((l) => l.inPnl && l.month).map((l) => l.month))].sort();
  const sheets: Sheet[] = [];

  // ---------- README
  const coverage = platforms.map((p) => {
    const ls = input.lines.filter((l) => l.platform === p && l.inPnl && l.month);
    const ms = ls.map((l) => l.month).sort();
    return [PLATFORM_LABEL[p], ms[0] ?? '', ms[ms.length - 1] ?? '', ls.length, new Set(ls.map((l) => l.source)).size];
  });
  sheets.push({
    name: 'README', widths: [34, 22, 16, 16, 12, 60], tabColor: '1F3864',
    rows: [
      [T(`Finance A–Z — ${input.company}`)],
      [T(`Built ${input.asOf} by TAKATAK Food Hub (scripts/finance-report.ts). PRIVATE — never commit or share publicly.`, 'caption')],
      [],
      [T('What this workbook answers', 'subtitle')],
      ['Monthly P&L per platform, brand, location (PnL_Monthly, PnL_Brand_Location)'],
      ['Which platform costs the most (Commission_Compare: effective commission %, all-in cost %, net per order, cancellations)'],
      ['GST/QST collected, GST/QST paid on platform fees, Clover stray "Sales Tax" (Tax_Summary — verify with the accountant)'],
      ['Every error charge / refund / cancellation and its dispute deadline (Disputes)'],
      ['Statement payouts vs bank deposits (Payouts_vs_Bank), money still held by a platform (Money_Held), actions (To_Do)'],
      [],
      [T('Data loaded', 'subtitle')],
      hdr(['Platform', 'First month', 'Last month', 'P&L lines', 'Files']),
      ...(coverage.length ? coverage : [['No platform export loaded yet — see the Exports tab', '', '', '', '']]),
      [],
      [`Files read: ${input.files.length} · unreadable: ${input.unreadable.length} · duplicate lines removed (overlapping exports): ${input.duplicates} · bank lines: ${input.bank.length}`],
      [],
      [T('How to read the numbers', 'subtitle')],
      [{ v: 'Signs: money in is positive, money taken by the platform is negative (commission, marketing, fees, error charges, refunds, promotions you funded).', s: 'wrap' }],
      [{ v: 'Item sales = menu prices before tax and before promotions. Net food sales = item sales + promotions you funded. Gross receipts = net food sales + GST + QST + tips.', s: 'wrap' }],
      [{ v: 'Net payout = what the statement says the platform pays you. Check column = net payout − all components; it must be 0 (a non-zero value means a statement column is not mapped).', s: 'wrap' }],
      [{ v: 'Net revenue after platform costs = net food sales + commission + marketing + fees + error charges + refunds + adjustments + other (tax you collected is owed to Revenu Québec, tax on fees is recoverable, tips belong to staff).', s: 'wrap' }],
      [{ v: 'Commission % = −commission ÷ item sales. All-in platform cost % = −(promotions + commission + marketing + fees + error charges + refunds) ÷ item sales.', s: 'wrap' }],
      [{ v: 'Platform orders that Food Hub / UrbanPiper recorded in Clover (tender "DoorDash", "Uber Eats"…) are NOT counted as Clover sales: they come from the platform statements (Lines type platform_in_clover, In P&L = N).', s: 'wrap' }],
      [{ v: 'Payout summary files are used for the P&L only for months without a per-order export, so nothing is counted twice.', s: 'wrap' }],
      [],
      [T('Colours', 'subtitle')],
      [{ v: 'Blue text', s: 'input' }, 'a value you can change (Rules tab)'],
      [{ v: 'Yellow cell', s: 'fill' }, 'for you to fill in (status, case number, amount recovered, notes) — kept when the workbook is rebuilt'],
      [{ v: 'Green', s: 'good' }, 'matched / OK'],
      [{ v: 'Red', s: 'bad' }, 'problem to act on'],
    ],
  });

  // ---------- Exports checklist
  const present = new Set(input.files.map((f) => f.format));
  sheets.push({
    name: 'Exports', widths: [5, 13, 34, 52, 18, 9, 16], freeze: { row: 4, col: 0 }, tabColor: 'C00000',
    rows: [
      [T('Exports needed from the owner')],
      [T('Drop files in private/finance/inbox/ (CSV whenever offered) and run the report again. Status is detected from the files read.', 'caption')],
      [],
      hdr(['#', 'Platform', 'Report', 'Where (menu path)', 'Range', 'Format', 'Status']),
      ...input.exportsChecklist.map((e) => {
        const got = e.formats.some((f) => present.has(f as ParsedFile['format']));
        const part = !got && (e.partial ?? []).some((f) => present.has(f as ParsedFile['format']));
        const status: Cell = got ? { v: 'Received', s: 'good' } : part ? { v: 'Partly covered (portal scan) — export still needed', s: 'warn' }
          : e.formats.length ? { v: 'Waiting', s: 'bad' } : { v: input.edits.Exports?.get(e.id)?.Status || 'Owner to confirm', s: 'fill' };
        return [e.id, e.platform, { v: e.report, s: 'wrap' }, { v: e.where, s: 'wrap' }, { v: e.range, s: 'wrap' }, e.format, status] as Row;
      }),
    ],
    validations: [{ range: `G5:G${4 + input.exportsChecklist.length}`, list: ['Received', 'Waiting', 'Owner to confirm', 'Not available', 'Partly covered (portal scan) — export still needed'] }],
  });

  // ---------- PnL_Monthly
  {
    const labels = ['Platform', 'Month'];
    const rows: Row[] = [[T('Monthly P&L per platform')], [T('All amounts CAD. Formulas over the Lines tab (In P&L = Y). Signs: + money in, − money taken.', 'caption')], [], hdr([...labels, ...PNL_COLS.map((c) => c.h)])];
    for (const p of platforms) {
      for (const m of months.filter((m) => input.lines.some((l) => l.inPnl && l.platform === p && l.month === m))) {
        const rn = rows.length + 1;
        rows.push([PLATFORM_LABEL[p], { v: monthSerial(m), s: 'month' }, ...pnlCells(sm, PNL_COLS, 2, rn, [critPlatform(`$A${rn}`, p), critMonth(`$B${rn}`, m)])]);
      }
      const rn = rows.length + 1;
      rows.push([{ v: PLATFORM_LABEL[p], s: 'bold' }, { v: 'Total', s: 'bold' }, ...pnlCells(sm, PNL_COLS, 2, rn, [critPlatform(`$A${rn}`, p)], true)]);
      rows.push([]);
    }
    if (platforms.length) {
      rows.push([T('All platforms by month', 'subtitle')]);
      for (const m of months) {
        const rn = rows.length + 1;
        rows.push(['All platforms', { v: monthSerial(m), s: 'month' }, ...pnlCells(sm, PNL_COLS, 2, rn, [critMonth(`$B${rn}`, m)])]);
      }
      const rn = rows.length + 1;
      rows.push([{ v: 'All platforms', s: 'bold' }, { v: 'Total', s: 'bold' }, ...pnlCells(sm, PNL_COLS, 2, rn, [], true)]);
    } else rows.push(['No data yet — waiting for exports (see Exports tab).']);
    sheets.push({ name: 'PnL_Monthly', rows, widths: [14, 9, ...PNL_COLS.map((c) => (c.s === 'pct' ? 9 : c.s === 'int' ? 8 : 12))], freeze: { row: 4, col: 2 }, tabColor: '2F75B5' });
  }

  // ---------- PnL_Brand_Location
  {
    const cols: PCol[] = PNL_COLS.filter((c) => ['orders', 'cancelled', 'sales', 'promo', 'netFood', 'gst', 'qst', 'tips', 'comm', 'commTax', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth', 'net', 'netRev', 'commPct', 'perOrder'].includes(c.key));
    const rows: Row[] = [[T('P&L per platform × brand × location × month')], [T('Use the filters on the header row. Brand/location come from the Stores tab (store-map.csv) or the store name.', 'caption')], [], hdr(['Platform', 'Brand', 'Location', 'Kitchen', 'Month', ...cols.map((c) => c.h)])];
    const combos = new Map<string, FinanceLine>();
    for (const l of input.lines) if (l.inPnl && l.month) combos.set([l.platform, l.brand, l.location, l.month].join('|'), l);
    const keys = [...combos.keys()].sort();
    for (const k of keys) {
      const l = combos.get(k)!; const rn = rows.length + 1;
      rows.push([PLATFORM_LABEL[l.platform], l.brand, l.location, l.kitchen, { v: monthSerial(l.month), s: 'month' },
        ...pnlCells(sm, cols, 5, rn, [critPlatform(`$A${rn}`, l.platform), critText('brand', `$B${rn}`, l.brand), critText('location', `$C${rn}`, l.location), critMonth(`$E${rn}`, l.month)])]);
    }
    if (!keys.length) rows.push(['No data yet — waiting for exports (see Exports tab).']);
    sheets.push({ name: 'PnL_Brand_Location', rows, widths: [12, 24, 14, 22, 9, ...cols.map((c) => (c.s === 'pct' ? 9 : c.s === 'int' ? 8 : 12))], freeze: { row: 4, col: 5 }, filterRow: keys.length ? 4 : undefined, tabColor: '2F75B5' });
  }

  // ---------- Commission_Compare
  {
    const cols: PCol[] = PNL_COLS.filter((c) => ['orders', 'cancelled', 'sales', 'promo', 'netFood', 'comm', 'mkt', 'fees', 'err', 'ref', 'adj', 'oth', 'net', 'netRev', 'commPct', 'allInPct', 'perOrder'].includes(c.key));
    const rows: Row[] = [[T('Platform comparison')], [T('Effective rates from the statements (not the advertised plan). Published plan rates are on the Rules tab.', 'caption')], []];
    const section = (title: string, label2: string, groups: Array<{ p: Platform; second: string; crit2: Crit | null }>) => {
      rows.push([T(title, 'subtitle')]);
      rows.push(hdr(['Platform', label2, ...cols.map((c) => c.h), 'Avg item sales per order', 'Cancellation rate', 'Marketing % of sales', 'Errors + refunds % of sales']));
      for (const g of groups) {
        const rn = rows.length + 1;
        // A blank criterion cell matches nothing in SUMIFS; "" matches the blank cells.
        const crits = [critPlatform(`$A${rn}`, g.p), ...(g.crit2 ? [{ ...g.crit2, ref: g.second === '(not given)' ? '""' : `$B${rn}` }] : [])];
        const cells = pnlCells(sm, cols, 2, rn, crits);
        const at = (k: string) => `${colName(2 + cols.findIndex((c) => c.key === k))}${rn}`;
        const num = (k: string) => Number(cells[cols.findIndex((c) => c.key === k)].v) || 0;
        const sales = num('sales'); const orders = num('orders');
        rows.push([PLATFORM_LABEL[g.p], /^\d{4}$/.test(g.second) ? Number(g.second) : g.second, ...cells,
          { f: `IF(${at('orders')}=0,0,${at('sales')}/${at('orders')})`, v: orders ? r2(sales / orders) : 0, s: 'money' },
          { f: `IF(${at('orders')}=0,0,${at('cancelled')}/${at('orders')})`, v: orders ? Math.round((num('cancelled') / orders) * 1e6) / 1e6 : 0, s: 'pct' },
          { f: `IF(${at('sales')}=0,0,-${at('mkt')}/${at('sales')})`, v: sales ? Math.round((-num('mkt') / sales) * 1e6) / 1e6 : 0, s: 'pct' },
          { f: `IF(${at('sales')}=0,0,-(${at('err')}+${at('ref')})/${at('sales')})`, v: sales ? Math.round((-(num('err') + num('ref')) / sales) * 1e6) / 1e6 : 0, s: 'pct' },
        ]);
      }
      rows.push([]);
    };
    const nonClover = platforms;
    section('By platform (all time)', '—', nonClover.map((p) => ({ p, second: 'All', crit2: null })));
    const years = (p: Platform) => [...new Set(input.lines.filter((l) => l.inPnl && l.platform === p && l.month).map((l) => Number(l.month.slice(0, 4))))].sort();
    section('By platform × year (compare the same period)', 'Year', nonClover.flatMap((p) => years(p).map((y) => ({ p, second: String(y), crit2: critYear('', y) }))));
    const modes = (p: Platform) => [...new Set(input.lines.filter((l) => l.inPnl && l.platform === p).map((l) => l.mode))].sort();
    section('By platform × delivery / pickup', 'Mode', nonClover.flatMap((p) => modes(p).map((m) => ({ p, second: m || '(not given)', crit2: { ...critText('mode', '', m) } }))));
    const kitchens = (p: Platform) => [...new Set(input.lines.filter((l) => l.inPnl && l.platform === p).map((l) => l.kitchen))].sort();
    section('By platform × kitchen', 'Kitchen', nonClover.flatMap((p) => kitchens(p).map((k) => ({ p, second: k, crit2: critText('kitchen', '', k) }))));
    const brands = (p: Platform) => [...new Set(input.lines.filter((l) => l.inPnl && l.platform === p).map((l) => l.brand))].sort();
    section('By platform × brand', 'Brand', nonClover.flatMap((p) => brands(p).map((b) => ({ p, second: b, crit2: critText('brand', '', b) }))));
    if (!platforms.length) rows.push(['No data yet — waiting for exports (see Exports tab).']);
    sheets.push({ name: 'Commission_Compare', rows, widths: [13, 24, ...cols.map((c) => (c.s === 'pct' ? 9 : c.s === 'int' ? 8 : 12)), 11, 10, 10, 10], freeze: { row: 0, col: 2 }, tabColor: '2F75B5' });
  }

  // ---------- Tax_Summary
  {
    const ruleRow = (id: string) => 5 + input.rules.findIndex((r) => r.id === id);
    const rGst = `Rules!$D$${ruleRow('gst_rate')}`; const rQst = `Rules!$D$${ruleRow('qst_rate')}`;
    const taxPlatforms = platforms;
    const head = ['Month', ...taxPlatforms.flatMap((p) => [`${PLATFORM_LABEL[p]} GST collected`, `${PLATFORM_LABEL[p]} QST collected`]), 'Total GST collected', 'Total QST collected',
      'Clover stray "Sales Tax" collected', 'GST paid on platform fees (ITC, est.)', 'QST paid on platform fees (ITR, est.)', 'Tax the platforms say they remitted (info)'];
    const rows: Row[] = [[T('GST / QST summary (for the accountant — verify before filing)')], [T('Collected = tax on sales passed to you by the platform / charged in Clover. Paid on fees = the platforms\' GST/QST on commission and fees, split 5 : 9.975 when the statement gives one total. Requires the platforms\' tax invoices to claim.', 'caption')], [], hdr(head)];
    const startRow = rows.length + 1;
    for (const m of months) {
      const rn = rows.length + 1;
      const cells: Cell[] = [];
      const mc = critMonth(`$A${rn}`, m);
      for (const p of taxPlatforms) {
        cells.push(sm.cell('gst', [{ ...critPlatform(`"${PLATFORM_LABEL[p]}"`, p) }, mc]));
        cells.push(sm.cell('qst', [{ ...critPlatform(`"${PLATFORM_LABEL[p]}"`, p) }, mc]));
      }
      const gCols = taxPlatforms.map((_, i) => colName(1 + i * 2)); const qCols = taxPlatforms.map((_, i) => colName(2 + i * 2));
      const gV = cells.filter((_, i) => i % 2 === 0).reduce((a, c) => a + Number(c.v), 0); const qV = cells.filter((_, i) => i % 2 === 1).reduce((a, c) => a + Number(c.v), 0);
      cells.push({ f: gCols.length ? gCols.map((c) => `${c}${rn}`).join('+') : '0', v: r2(gV), s: 'moneyBold' });
      cells.push({ f: qCols.length ? qCols.map((c) => `${c}${rn}`).join('+') : '0', v: r2(qV), s: 'moneyBold' });
      cells.push(sm.cell('otherTax', [mc]));
      const ct = sm.cell('commissionTax', [mc]);
      const ctv = Number(ct.v);
      cells.push({ f: `-${ct.f}*${rGst}/(${rGst}+${rQst})`, v: raw((-ctv * GST_RATE) / (GST_RATE + QST_RATE)), s: 'money' });
      cells.push({ f: `-${ct.f}*${rQst}/(${rGst}+${rQst})`, v: raw((-ctv * QST_RATE) / (GST_RATE + QST_RATE)), s: 'money' });
      cells.push(sm.cell('infoTaxRemittedByPlatform', [mc]));
      rows.push([{ v: monthSerial(m), s: 'month' }, ...cells]);
    }
    if (months.length) {
      const rn = rows.length + 1; const width = head.length;
      rows.push([{ v: 'Total', s: 'bold' }, ...Array.from({ length: width - 1 }, (_, i) => {
        const col = colName(i + 1);
        const v = rows.slice(startRow - 1, rn - 1).reduce((a, r) => a + (Number((r[i + 1] as Cell)?.v) || 0), 0);
        return { f: `SUM(${col}${startRow}:${col}${rn - 1})`, v: raw(v), s: 'moneyTotal' } as Cell;
      })]);
    } else rows.push(['No data yet — waiting for exports.']);
    rows.push([], [T('Notes for the accountant', 'subtitle')]);
    for (const n of [
      'Food sold through Uber Eats / DoorDash / Skip: the platforms pass GST/QST on the food to the restaurant, which remits it (see FINANCE_A_TO_Z.md §Rules — confirm per platform).',
      `Clover stray tax: items carry a default "Sales Tax" of ${(CLOVER_STRAY_RATE * 100).toFixed(5)} % on top of TPS + TVQ. Amounts collected as tax are to be remitted or refunded — ask the accountant how to report them, then remove the tax in Clover.`,
      'ITC/ITR on platform fees can only be claimed with the platform tax invoices (supplier GST/QST numbers): download them (Exports U3, D4).',
    ]) rows.push([{ v: n, s: 'wrap' }]);
    sheets.push({ name: 'Tax_Summary', rows, widths: [10, ...head.slice(1).map(() => 13)], freeze: { row: 4, col: 1 }, tabColor: '548235' });
  }

  // ---------- Disputes
  {
    const ED = input.edits.Disputes;
    const rulesStart = 5 + input.rules.findIndex((r) => r.id.startsWith('dispute_'));
    const rulesEnd = 5 + input.rules.map((r) => r.id.startsWith('dispute_')).lastIndexOf(true);
    const head = ['Key', 'Platform', 'Brand', 'Location', 'Store', 'Order / charge date', 'Order ref', 'What', 'Amount', 'Description', 'Dispute window (days)', 'Deadline', 'Days left', 'Status', 'Platform case #', 'Recovered $', 'Notes', 'Source'];
    const rows: Row[] = [[T('Refunds, error charges, adjustments and cancellations — dispute register')], [T('Window and deadline come from the Rules tab. Yellow columns are yours (kept when the workbook is rebuilt).', 'caption')], [], hdr(head)];
    for (const d of input.disputes) {
      const rn = rows.length + 1; const e = ED?.get(d.key) ?? {};
      const winRange = rulesStart >= 5 ? `IFERROR(INDEX(Rules!$D$${rulesStart}:$D$${rulesEnd},MATCH($B${rn},Rules!$G$${rulesStart}:$G$${rulesEnd},0)),0)` : '0';
      const od = excelDate(d.orderDate);
      rows.push([d.key, PLATFORM_LABEL[d.platform], d.brand, d.location, d.store, { v: od, s: 'date' }, d.orderRef, d.kind, { v: d.amount, s: 'money' }, d.description,
        { f: winRange, v: d.windowDays, s: 'int' },
        { f: `IF(OR(F${rn}="",K${rn}=0),"",F${rn}+K${rn})`, v: od !== null && d.windowDays ? od + d.windowDays : '', s: 'date' },
        { f: `IF(L${rn}="","",L${rn}-TODAY())`, v: d.daysLeft ?? '', s: 'int' },
        { v: e['Status'] || (d.defaultStatus && d.defaultStatus !== 'To review' ? d.defaultStatus : d.daysLeft !== null && d.daysLeft < 0 ? 'Window passed' : 'To review'), s: 'fill' }, { v: e['Platform case #'] ?? '', s: 'fill' },
        { v: e['Recovered $'] ? Number(e['Recovered $']) || e['Recovered $'] : null, s: 'fillMoney' }, { v: e['Notes'] ?? '', s: 'fill' }, d.source]);
    }
    if (input.disputes.length) {
      const rn = rows.length + 1;
      rows.push(['', { v: 'Total', s: 'bold' }, '', '', '', '', '', '', { f: `SUM(I5:I${rn - 1})`, v: r2(input.disputes.reduce((a, d) => a + d.amount, 0)), s: 'moneyTotal' }, '', '', '', '', '', '',
        { f: `SUM(P5:P${rn - 1})`, v: r2(input.disputes.reduce((a, d) => a + (Number(ED?.get(d.key)?.['Recovered $']) || 0), 0)), s: 'moneyTotal' }]);
    } else rows.push(['', 'No refunds / error charges yet — waiting for exports.']);
    sheets.push({
      name: 'Disputes', rows, widths: [12, 12, 20, 13, 24, 11, 14, 18, 10, 40, 9, 11, 8, 14, 14, 10, 30, 26], freeze: { row: 4, col: 2 }, filterRow: input.disputes.length ? 4 : undefined, tabColor: 'C00000',
      validations: input.disputes.length ? [{ range: `N5:N${4 + input.disputes.length}`, list: ['To review', 'Disputed', 'Won', 'Partly won', 'Lost', 'Accepted (our error)', 'Window passed', 'Not disputable'] }] : undefined,
    });
  }

  // ---------- Payouts_vs_Bank
  {
    const ED = input.edits.Payouts_vs_Bank;
    const head = ['Key', 'Platform', 'Store / payee', 'Brand', 'Location', 'Payout date', 'Payout ref', 'Statement lines', 'Lines net', 'Payout summary amount', 'Statement amount', 'Platform status', 'Bank date', 'Bank amount', 'Bank account', 'Gap (bank − statement)', 'Result', 'Your note'];
    const rows: Row[] = [[T('Platform payouts vs bank deposits')], [T(input.bank.length ? `Bank lines loaded: ${input.bank.length}. A payout matches a deposit of the same amount (± tolerance on Rules) within the date window.` : 'No bank statement loaded yet (Exports B1): payouts are listed but cannot be matched.', 'caption')], [], hdr(head)];
    const label: Record<PayoutRecord['match'], [string, StyleKey]> = {
      matched: ['Matched', 'good'], amount_differs: ['Amount differs', 'bad'], not_in_bank: ['Not found in bank', 'bad'], bank_not_loaded: ['Bank period not loaded', 'text'], unpaid: ['Not paid yet (no payout date)', 'warn'], failed: ['Payout failed / held', 'bad'],
    };
    for (const r of input.payouts) {
      const rn = rows.length + 1;
      rows.push([r.key, PLATFORM_LABEL[r.platform], r.storeName || r.storeId, r.brand, r.location, { v: excelDate(r.payoutDate), s: 'date' }, r.payoutRef, { v: r.lines, s: 'int' },
        { v: r.linesNet, s: 'money' }, { v: r.summaryAmount, s: 'money' },
        { f: `IF(J${rn}<>"",J${rn},I${rn})`, v: r.amount, s: 'moneyBold' }, r.status,
        { v: excelDate(r.bank?.date), s: 'date' }, { v: r.bank?.amount ?? null, s: 'money' }, r.bank?.account ? `••${r.bank.account}` : '',
        { f: `IF(N${rn}="","",N${rn}-K${rn})`, v: r.bank ? r2(r.bank.amount - r.amount) : '', s: 'money' },
        { v: label[r.match][0], s: label[r.match][1] }, { v: ED?.get(r.key)?.['Your note'] ?? '', s: 'fill' }]);
    }
    if (!input.payouts.length) rows.push(['', 'No payouts yet — waiting for exports.']);
    if (input.unmatchedBank.length) {
      rows.push([], [T('Bank deposits naming a platform that match no statement payout', 'subtitle')], hdr(['', 'Platform (from description)', 'Description', '', '', 'Date', '', '', '', '', '', '', '', 'Amount', 'Account']));
      for (const b of input.unmatchedBank) rows.push(['', b.platformGuess ? PLATFORM_LABEL[b.platformGuess] : '', b.description, '', '', { v: excelDate(b.date), s: 'date' }, '', '', '', '', '', '', '', { v: b.amount, s: 'money' }, b.account ? `••${b.account}` : '']);
    }
    sheets.push({ name: 'Payouts_vs_Bank', rows, widths: [10, 12, 26, 18, 13, 11, 22, 8, 11, 11, 12, 14, 11, 11, 9, 12, 22, 30], freeze: { row: 4, col: 2 }, filterRow: input.payouts.length ? 4 : undefined, tabColor: '7030A0' });
  }

  // ---------- Money_Held
  {
    const ED = input.edits.Money_Held;
    const head = ['ID', 'Platform', 'Store / account', 'What', 'Amount held', 'Since', 'Evidence', 'Action to clear it', 'Who', 'Status', 'Notes'];
    const rows: Row[] = [[T('Money held or not received — recoverable list')], [T('Known holds from the ops notes + what the exports show (unpaid statement lines, failed payouts, payouts absent from the bank). Blank amount = unknown until the export / platform page shows it.', 'caption')], [], hdr(head)];
    const start = rows.length + 1;
    for (const h of input.held) {
      const e = ED?.get(h.id) ?? {};
      const amount = h.amount ?? (e['Amount held'] ? Number(e['Amount held']) || null : null);
      rows.push([h.id, h.platform, h.where, { v: h.what, s: 'wrap' }, { v: amount, s: h.amount === null ? 'fillMoney' : 'money' }, { v: excelDate(h.since), s: 'date' }, { v: h.evidence, s: 'wrap' }, { v: h.action, s: 'wrap' }, h.who, { v: e['Status'] || 'Open', s: 'fill' }, { v: e['Notes'] ?? '', s: 'fill' }]);
    }
    const end = rows.length;
    rows.push(['', { v: 'Total known', s: 'bold' }, '', '', { f: end >= start ? `SUM(E${start}:E${end})` : '0', v: r2(input.held.reduce((a, h) => a + (h.amount ?? (Number(ED?.get(h.id)?.['Amount held']) || 0)), 0)), s: 'moneyTotal' }]);
    sheets.push({ name: 'Money_Held', rows, widths: [16, 12, 26, 46, 12, 11, 26, 50, 8, 12, 30], freeze: { row: 4, col: 0 }, tabColor: 'C00000', validations: input.held.length ? [{ range: `J${start}:J${end}`, list: ['Open', 'Requested', 'Released', 'Received', 'Written off'] }] : undefined });
  }

  // ---------- To_Do
  {
    const ED = input.edits.To_Do;
    const head = ['ID', 'Priority', 'Area', 'Task', 'Platform', 'Amount', 'Due', 'Who', 'Status', 'Notes'];
    const rows: Row[] = [[T('To do — disputes, holds, tax, data')], [T('P1 = money at risk or a deadline; P2 = recover / fix soon; P3 = housekeeping. Status and notes are kept when the workbook is rebuilt.', 'caption')], [], hdr(head)];
    for (const t of input.todos) {
      const e = ED?.get(t.id) ?? {};
      rows.push([t.id, { v: t.priority, s: t.priority === 'P1' ? 'bad' : t.priority === 'P2' ? 'warn' : 'text' }, t.area, { v: t.task, s: 'wrap' }, t.platform, { v: t.amount, s: 'money' }, { v: excelDate(t.due), s: 'date' }, { v: e['Who'] || t.who, s: 'fill' }, { v: e['Status'] || t.status, s: 'fill' }, { v: e['Notes'] || t.notes, s: 'fill' }]);
    }
    sheets.push({ name: 'To_Do', rows, widths: [14, 8, 12, 70, 12, 11, 11, 10, 12, 34], freeze: { row: 4, col: 0 }, filterRow: 4, tabColor: 'C00000', validations: input.todos.length ? [{ range: `I5:I${4 + input.todos.length}`, list: ['Open', 'In progress', 'Waiting on platform', 'Done', 'Not needed'] }] : undefined });
  }

  // ---------- Rules
  sheets.push({
    name: 'Rules', widths: [22, 16, 52, 12, 10, 60, 14, 12], freeze: { row: 4, col: 0 }, tabColor: '808080',
    rows: [
      [T('Rules & parameters')], [T('Blue values are inputs used by the formulas (change them here). Sources and confidence: see FINANCE_A_TO_Z.md §Rules & law.', 'caption')], [],
      hdr(['ID', 'Section', 'Rule / parameter', 'Value', 'Unit', 'Source', 'Applies to', 'Confidence']),
      ...input.rules.map((r) => {
        const pct = r.unit === '%';
        return [r.id, r.section, { v: r.label, s: 'wrap' }, { v: typeof r.value === 'number' && pct ? r.value / 100 : r.value, s: typeof r.value === 'number' ? (pct ? 'inputPct' : 'input') : 'input' }, r.unit, { v: r.source, s: 'note' },
          r.id.startsWith('dispute_') ? PLATFORM_LABEL[r.id.replace('dispute_', '') as Platform] ?? '' : '', r.confidence] as Row;
      }),
    ],
  });

  // ---------- Stores
  sheets.push({
    name: 'Stores', widths: [12, 40, 34, 24, 14, 32, 9, 22, 40], freeze: { row: 4, col: 0 }, filterRow: 4, tabColor: '808080',
    rows: [
      [T('Store map — platform store → brand → location')], [T('Edit private/finance/store-map.csv (not this tab) to change a mapping, then run the report again. Stores seen in exports but not in the map are listed at the bottom.', 'caption')], [],
      hdr(['Platform', 'Store ID', 'Store name', 'Brand', 'Location', 'Address', 'Bank ••', 'Status', 'Note']),
      ...input.stores.map((s) => [PLATFORM_LABEL[s.platform], s.storeId, s.storeName, s.brand, s.location, s.address, s.bankLast4 ? `••${s.bankLast4}` : '', s.status, s.note] as Row),
      ...(input.unknownStores.length ? [[], [T('Seen in exports, not in the store map (mapped from the name, or not at all)', 'subtitle')], hdr(['Platform', 'Store ID', 'Store name', 'Lines'])] : []),
      ...input.unknownStores.map((u) => [PLATFORM_LABEL[u.platform], u.storeId, u.storeName, { v: u.lines, s: 'int' }] as Row),
    ],
  });

  // ---------- Lines
  sheets.push({
    name: 'Lines', widths: LINE_COLS.map((c) => c.w), freeze: { row: 1, col: 2 }, filterRow: 1, tabColor: 'A6A6A6',
    rows: [hdr(LINE_COLS.map((c) => c.h)), ...input.lines.map((l) => LINE_COLS.map((c) => ({ v: c.get(l), s: c.s ?? 'text' })))],
  });

  // ---------- Bank
  sheets.push({
    name: 'Bank', widths: [11, 9, 60, 12, 10, 12, 16, 30, 6], freeze: { row: 1, col: 0 }, filterRow: 1, tabColor: 'A6A6A6',
    rows: [hdr(['Date', 'Month', 'Description (numbers masked)', 'Amount', 'Account ••', 'Bank', 'Platform (from description)', 'Source file', 'Row']),
      ...input.bank.map((b) => [{ v: excelDate(b.date), s: 'date' }, { v: monthSerial(b.month), s: 'month' }, b.description, { v: b.amount, s: 'money' }, b.account, b.bank, b.platformGuess ? PLATFORM_LABEL[b.platformGuess] : '', b.source, { v: b.row, s: 'int' }] as Row)],
  });

  // ---------- Files
  sheets.push({
    name: 'Files', widths: [44, 22, 12, 7, 7, 7, 11, 11, 9, 80], freeze: { row: 1, col: 0 }, tabColor: 'A6A6A6',
    rows: [hdr(['File', 'Format detected', 'Platform', 'Rows', 'Lines', 'Skipped', 'From', 'To', 'Fees sign flipped', 'Warnings / columns not used']),
      ...input.files.map((f) => [f.file, f.format, f.platform ? PLATFORM_LABEL[f.platform] : '', { v: f.rows, s: 'int' }, { v: f.lines.length + f.bank.length, s: 'int' }, { v: f.skipped, s: 'int' }, { v: excelDate(f.dateFrom), s: 'date' }, { v: excelDate(f.dateTo), s: 'date' }, f.feesFlipped ? 'yes' : '', { v: f.warnings.join(' | '), s: 'note' }] as Row),
      ...input.unreadable.map((u) => [u.file, 'not readable', '', '', '', '', '', '', '', { v: u.reason, s: 'note' }] as Row)],
  });

  const expected: Record<string, number | string> = {};
  for (const sh of sheets) sh.rows.forEach((row, ri) => row.forEach((c, ci) => {
    if (c && typeof c === 'object' && c.f && (typeof c.v === 'number' || typeof c.v === 'string')) expected[`${sh.name}!${colName(ci)}${ri + 1}`] = c.v;
  }));
  return { bytes: buildXlsx(sheets, { title: `Finance A–Z — ${input.company}` }), expected };
}
