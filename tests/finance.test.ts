import { describe, expect, it } from 'vitest';
import { matchBrandLocation } from '../lib/foodhub/brand-match';
import { dedupe, disputeRows, finalize, heldFromData, matchBank, payoutRecords, type Params } from '../lib/foodhub/finance/analysis';
import { DEFAULT_RULES, EXPORTS_CHECKLIST } from '../lib/foodhub/finance/defaults';
import { detectFinanceFormat, maskDigits, parseFinanceFile, taxColumn } from '../lib/foodhub/finance/formats';
import { parseStoreMap, StoreResolver } from '../lib/foodhub/finance/stores';
import { buildFinanceWorkbook } from '../lib/foodhub/finance/workbook';
import { readXlsxSheet } from '../lib/foodhub/finance/xlsx';
import { platformFromLabel } from '../lib/foodhub/pos/platform-labels';

const bytes = (s: string) => new TextEncoder().encode(s);

const UBER = [
  'Store Name,Store ID,Order ID,Workflow ID,Order Date,Dining Mode,Order Status,Sales (excluding tax),Tax on Sales,GST/HST on Sales,QST on Sales,Sales (including tax),Price Adjustments (excluding tax),Tax on Price Adjustments,Offers on items,Tax on Offers on items,Marketplace fee,Tax on Marketplace fee,Tips,Other payments,Other payments description,Total payout,Payout Date,Payout Status,Payout reference ID',
  'Pi pita (NDG),u1,A1,wf-1,2026-08-03,DELIVERY,Completed,40.00,5.99,2.00,3.99,45.99,0,0,-4.00,-0.60,-9.00,-1.35,0,0,,31.04,2026-08-10,Paid,P-1',
  'Pi pita (Hochelaga),u2,A2,wf-2,2026-08-05,DELIVERY,Completed,30.00,4.49,1.50,2.99,34.49,-10.00,-1.50,0,0,-7.50,-1.12,0,0,,14.37,2026-08-10,Paid,P-1',
  'Pi pita (NDG),u1,A3,wf-3,2026-08-06,DELIVERY,Canceled,0,0,0,0,0,0,0,0,0,0,0,0,0,,0,2026-08-10,Paid,P-1',
  'Pi pita (NDG),u1,,,2026-08-07,,,0,0,0,0,0,0,0,0,0,0,0,0,-25.00,Ad Spend,-25.00,2026-08-10,Paid,P-1',
  'Gateaux Montreal (NDG),u3,A4,wf-4,2026-08-12,PICKUP,Completed,50.00,7.49,2.50,4.99,57.49,0,0,0,0,-5.00,-0.75,3.00,0,,54.74,2026-08-17,Rejected by Bank,P-2',
].join('\n');

// DoorDash export printing fees as positive numbers.
const DOORDASH = [
  'Timestamp local date,Payout date,Store ID,Store name,Transaction type,DoorDash order ID,Final order status,Subtotal,Subtotal tax passed to merchant,Commission,Commission tax,Marketing fees | (including any applicable taxes),Customer discounts from marketing | (funded by you),Customer discounts from marketing | (funded by DoorDash),Error charges,Adjustments,Net total,Payout ID',
  '2026-08-04,2026-08-13,27510307,Nutrition Shake,DELIVERY,dd-1,Delivered,30.00,4.49,7.50,1.12,0,0,-3.00,0,0,25.87,PO-1',
  '2026-08-05,2026-08-13,27510307,Nutrition Shake,DELIVERY,dd-2,Delivered,20.00,2.99,5.00,0.75,1.15,-2.00,0,-4.00,0,10.09,PO-1',
].join('\n');

const CLOVER = [
  'Payment ID,Order ID,Payment Date,Tender,Result,Amount,Tip Amount,Tax Amount,Order Type',
  'CP1,CO1,2026-08-03,Credit Card,SUCCESS,23.02,3.00,3.02,Dine In',
  'CP2,CO2,2026-08-04,DoorDash,SUCCESS,34.49,0,4.49,Online Order Delivery',
  'CP3,CO3,2026-08-05,Debit Card,FAIL,10.00,0,1.30,Dine In',
].join('\n');

const params: Params = { unpaidAfterDays: 14, bankWindow: [-3, 10], tolerance: 0.01, disputeDays: { uber_eats: 14, doordash: 14, skip: 7, clover: 14, tgtg: 0 }, asOf: '2026-08-15' };

describe('finance — tax columns', () => {
  it('recognises Uber and DoorDash tax columns and what they are tax on', () => {
    expect(taxColumn('QST on Sales')).toEqual({ kind: 'qst', base: 'sales', target: 'salesTax' });
    expect(taxColumn('Tax on Marketplace fee')?.target).toBe('commissionTax');
    expect(taxColumn('Subtotal tax passed to merchant (provincial)')?.kind).toBe('qst');
    expect(taxColumn('subtotal_tax_passed_to_merchant_federal_harmonized')?.kind).toBe('gst');
    expect(taxColumn('Commission')).toBeNull();
  });
});

describe('finance — Uber Eats Payment Details', () => {
  const f = parseFinanceFile('uber.csv', bytes(UBER));
  const by = (ref: string) => f.lines.find((l) => l.orderRef === ref)!;
  it('is detected and keeps cancelled orders paid 0', () => {
    expect(f.format).toBe('uber_payment_details');
    expect(f.lines).toHaveLength(5);
    expect(by('A3').type).toBe('cancellation');
  });
  it('uses the GST/QST columns, not the combined "Tax on Sales" as well', () => {
    expect(by('A1').salesTax).toBeCloseTo(5.39); // 5.99 on sales − 0.60 on the offer
    expect(by('A1').gst).toBeCloseTo(1.8);
    expect(by('A1').unexplained).toBeCloseTo(0);
  });
  it('splits commission, tax on it, offers, price adjustments, tips and ads', () => {
    expect(by('A1').commission).toBe(-9);
    expect(by('A1').commissionTax).toBe(-1.35);
    expect(by('A1').promotions).toBe(-4);
    expect(by('A2').adjustments).toBe(-10);
    expect(by('A4').tips).toBe(3);
    expect(f.lines.find((l) => !l.orderRef)!.marketing).toBe(-25);
  });
});

describe('finance — DoorDash transactions', () => {
  const f = parseFinanceFile('dd.csv', bytes(DOORDASH));
  it('flips fees printed as positive numbers so the net adds up', () => {
    expect(f.feesFlipped).toBe(true);
    const l = f.lines.find((x) => x.orderRef === 'dd-2')!;
    expect(l.commission).toBe(-5);
    expect(l.marketing).toBe(-1.15);
    expect(l.errorCharges).toBe(-4);
    expect(l.promotions).toBe(-2);
    expect(l.unexplained).toBeCloseTo(0);
  });
  it('keeps platform-funded discounts as information only', () => {
    expect(f.lines.find((x) => x.orderRef === 'dd-1')!.infoPlatformFundedDiscounts).toBe(-3);
  });
});

describe('finance — Clover', () => {
  const f = parseFinanceFile('clover_payments.csv', bytes(CLOVER));
  it('excludes platform orders recorded in Clover and failed payments', () => {
    expect(f.lines).toHaveLength(2);
    const p = f.lines.find((l) => l.orderRef === 'CO2')!;
    expect(p.type).toBe('platform_in_clover');
    expect(p.inPnl).toBe(false);
  });
  it('separates the stray 0.14975 % "Sales Tax" from GST/QST', () => {
    const l = f.lines.find((x) => x.orderRef === 'CO1')!;
    expect(l.itemSales).toBe(20);
    expect(l.otherTax).toBe(0.03);
    expect(l.gst + l.qst + l.otherTax).toBeCloseTo(3.02);
  });
});

describe('finance — bank, payouts, disputes', () => {
  const bank = parseFinanceFile('bank_bmo_1234.csv', bytes('Date Posted,Description,Transaction Amount\n2026-08-14,DOORDASH CANADA 123456789012,35.96\n2026-08-15,RENT,-2500.00\n'));
  it('reads bank lines and masks account numbers', () => {
    expect(bank.format).toBe('bank');
    expect(bank.bank[0].description).toContain('••9012');
    expect(bank.bank[0].platformGuess).toBe('doordash');
    expect(maskDigits('acct 0012345678')).toBe('acct ••5678');
  });
  it('matches payouts to deposits and flags rejected payouts as held', () => {
    const lines = finalize(dedupe([...parseFinanceFile('uber.csv', bytes(UBER)).lines, ...parseFinanceFile('dd.csv', bytes(DOORDASH)).lines]).kept);
    const recs = payoutRecords(lines);
    matchBank(recs, bank.bank, params);
    expect(recs.find((r) => r.payoutRef === 'PO-1')!.match).toBe('matched');
    expect(recs.find((r) => r.payoutRef === 'P-2')!.match).toBe('failed');
    expect(heldFromData(lines, recs, params).some((h) => h.amount === 54.74)).toBe(true);
    const d = disputeRows(lines, params);
    expect(d.find((x) => x.orderRef === 'dd-2')!.deadline).toBe('2026-08-19');
    expect(lines.filter((l) => l.platform === 'uber_eats').reduce((a, l) => a + l.orderCount, 0)).toBe(4);
  });
  it('dedupes the same row from overlapping exports', () => {
    const a = parseFinanceFile('dd-1.csv', bytes(DOORDASH)).lines; const b = parseFinanceFile('dd-2.csv', bytes(DOORDASH)).lines;
    expect(dedupe([...a, ...b]).kept).toHaveLength(2);
  });
  it('recognises reference-only reports so they are not counted twice', () => {
    expect(detectFinanceFormat(['business_id', 'dd_order_id', 'error_category', 'error_charge']).format).toBe('reference');
  });
});

describe('finance — stores and workbook', () => {
  const map = parseStoreMap('platform,store_id,store_name,brand,location_code,address,bank_last4,status,note\nuber_eats,,Pi pita (Hochelaga),Pi Pita,SAINT_LEONARD,5839 Rue Jean-Talon E,,,\n');
  it('maps stores by the owner map first, then by name', () => {
    const r = new StoreResolver(map, ['Pi Pita', 'Gateau Montreal'], [{ code: 'NDG_MAIN', address_line_1: '6280 Av Somerled' }]);
    expect(r.resolve('uber_eats', 'u2', 'Pi pita (Hochelaga)').location).toBe('SAINT_LEONARD');
    expect(r.resolve('uber_eats', 'u3', 'Gateaux Montreal (NDG)').brand).toBe('Gateau Montreal');
    expect(matchBrandLocation('Crèmerie Bin Molle Bin Dure', '', ['Bin molle & Bin Dure', 'Crèmerie Bin Molle Bin Dure'], []).suggestedBrand).toBe('Crèmerie Bin Molle Bin Dure');
    expect(platformFromLabel('DOORDASH')).toBe('doordash');
  });
  it('builds a workbook whose formulas carry the computed values and reads tabs back', () => {
    const lines = finalize(parseFinanceFile('uber.csv', bytes(UBER)).lines);
    const { bytes: x, expected } = buildFinanceWorkbook({
      asOf: '2026-08-15', company: 'Test', lines, bank: [], payouts: payoutRecords(lines), unmatchedBank: [], disputes: disputeRows(lines, params), held: [], todos: [],
      rules: DEFAULT_RULES, stores: [], files: [], unreadable: [], exportsChecklist: EXPORTS_CHECKLIST, unknownStores: [], edits: {}, duplicates: 0,
    });
    expect(Object.keys(expected).length).toBeGreaterThan(50);
    // Item sales of Uber Eats for 2026-08 = 40 + 30 + 50.
    const pnl = readXlsxSheet(x, 'PnL_Monthly');
    expect(pnl[4][0]).toBe('Uber Eats');
    expect(Number(pnl[4][4])).toBe(120);
    expect(readXlsxSheet(x, 'Rules')[4][0]).toBe('gst_rate');
  });
});

describe('finance — dates', () => {
  it('reads 03/04/2026 day-first when the same column has 25/04/2026', () => {
    const f = parseFinanceFile('bank_desjardins_0619.csv', bytes('Date,Description,Amount\n03/04/2026,DOORDASH,10.00\n25/04/2026,DOORDASH,12.00\n'));
    expect(f.bank[0].date).toBe('2026-04-03');
    const g = parseFinanceFile('bank_bmo_8767.csv', bytes('Date,Description,Amount\n03/04/2026,DOORDASH,10.00\n04/25/2026,DOORDASH,12.00\n'));
    expect(g.bank[0].date).toBe('2026-03-04');
  });
});

describe('finance — portal scans', () => {
  const UBER_SCAN = [
    'section,store,uuid8,period,status,deposit_date,earnings_cad,uber_fees_cad,marketing_cad,amendments_cad,net_payout_cad,bank_last_digits,note',
    'monthly,"Nutri Shake (NDG)",58f2a0dd,2026-09,STATEMENT,,142.75,-45.36,-13.56,0.00,83.83,,',
    'weekly,Nutri Shake (NDG),58f2a0dd,Sep 14–20 2026,SETTLED,Sep 21 2026,20.99,-7.25,0.00,0.00,13.74,••67,',
    'weekly,PPP Pizzeria (Hochelaga),627d09f0,(none shown),NO PAYOUT,,46.18,0.00,0.00,0.00,46.18,••48,"ON HOLD: PAYOUT_ON_HOLD_REASON_FRAUD_TAG_APPLIED"',
    'weekly,Bolon Café (Hochelaga),8179598e,(none shown),NO PAYOUT,,0.00,0.00,0.00,0.00,0.00,••48,no sales',
  ].join('\n');
  const DD_SCAN = [
    'type,store_id,store_name,business_id,order_protocol,store_status,period,date,time,order_id,description,sales,doordash_services,amendments,net,amount,payout_id,status',
    'statement,27510307,Nutrition Shake (6284 Somerled),12606537,IPAD (tablet),Active,2026-06,,,,Monthly statement,53.81,-15.49,0.00,38.32,,,',
    'error_charge,30831008,Taco Mexican NDG (6284 Somerled),13080099,POINT_OF_SALE,Deactivated,,2026-09-21,06:56,4095A506,1 Quesadillas missing,,,,,-13.90,,open',
    'error_charge,27510307,Nutrition Shake (6284 Somerled),12606537,IPAD (tablet),Active,,2026-07-06,19:12,9EFC073D,Trio missing,,,,,-12.43,594617122,reversed 2026-07-17 (+12.43)',
  ].join('\n');
  it('reads Uber monthly statements as P&L totals (tax estimated) and weekly rows as payouts', () => {
    const f = parseFinanceFile('uber/uber-payouts.csv', bytes(UBER_SCAN));
    expect(f.format).toBe('uber_scan_payouts');
    expect(f.lines).toHaveLength(3); // the "no sales" row is dropped
    const m = f.lines.find((l) => l.status === 'monthly statement')!;
    expect(m.itemSales + m.salesTax).toBeCloseTo(142.75);
    expect(m.unexplained).toBeCloseTo(0);
    const lines = finalize(f.lines);
    expect(lines.filter((l) => l.inPnl)).toHaveLength(1);
    const recs = payoutRecords(lines);
    expect(recs.find((r) => r.storeId === '627d09f0')!.match).toBe('failed');
    expect(heldFromData(lines, recs, params).find((h) => h.amount === 46.18)).toBeTruthy();
  });
  it('keeps DoorDash itemized charges out of the P&L but in the dispute register', () => {
    const lines = finalize(parseFinanceFile('doordash/doordash-charges.csv', bytes(DD_SCAN)).lines);
    expect(lines.filter((l) => l.inPnl)).toHaveLength(1);
    expect(lines.filter((l) => l.level === 'reference')).toHaveLength(2);
    const d = disputeRows(lines, { ...params, asOf: '2026-10-07' });
    expect(d).toHaveLength(2);
    expect(d.find((x) => x.orderRef === '9EFC073D')!.defaultStatus).toBe('Won');
    expect(d.find((x) => x.orderRef === '4095A506')!.daysLeft).toBe(-2);
  });
});

describe('finance — Uber Manager download with two header rows', () => {
  it('uses the column-name row, not the description row', () => {
    const csv = [
      'Store name as per Uber Eats manager,Store UUID,Order ID as per Uber Eats manager,Unique ID to identify the order ,"Local date the order was placed, or refund date",Total item sales excl tax ,Tax on total item sales in the order,GST on item Sales,QST on item Sales,The fee Uber charges,Total Tax on Uber Service Fee,Total payout associated with this order,Date payout initiated by Uber,Payout status,The reference ID for the payout',
      'Store Name,Store UUID,Order ID,Workflow ID,Order Date,Sales (excl. tax),Tax on Sales,GST/HST on Sales,QST on Sales,Marketplace Fee,Tax on Marketplace Fee,Total payout,Payout Date,Payout Status,Payout Reference ID',
      'Pi pita (NDG),u1,A9,wf-9,2026-05-03,40.00,5.99,2.00,3.99,-12.00,-1.80,32.19,2026-05-11,Paid,P-9',
    ].join('\n');
    const f = parseFinanceFile('uber_2026-05.csv', bytes(csv));
    expect(f.format).toBe('uber_payment_details');
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0].itemSales).toBe(40);
    expect(f.lines[0].qst).toBeCloseTo(3.99);
    expect(f.lines[0].commission).toBe(-12);
    expect(f.lines[0].payoutStatus).toBe('Paid');
  });
});
