// Release 2026-10-23 verification fixes: real platform exports read as they are downloaded, the reconciliation tiles
// agree with the per-order rows, untaxed platform sales are flagged, and two phone layouts no longer collapse.
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { Segmented } from '../components/ui/tabs';
import { parseFinanceFile } from '../lib/foodhub/finance/formats';
import { isPlaceholder, parseStatement, withoutDescriptionRow } from '../lib/foodhub/recon/statements';

const enc = (s: string) => new TextEncoder().encode(s);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const actor = { username: 't', name: 'Test', source: 'dashboard' as const };

// Uber Eats Manager "Payment details" download: a row of long descriptions above the row of column names.
const UBER_DESC = 'Store name as per Uber Eats manager,Store UUID,Order ID as per Uber Eats manager,Unique ID to identify the order,"Local date the order was placed, or local date of the adjustment",Either: Completed (eater received food) or Cancelled,Total item sales excl tax,Tax on total item sales in the order,Goods and Sales Tax / Harmonized Sales Tax on item Sales,Quebec Sales Tax on item Sales,Merchant promotions applied to the order,Tax on merchant promotions applied to the order,The fee Uber charges to merchant,Total Tax on Uber Service Fee charged to merchant,Marketplace Facilitator Tax,All payouts to the merchant,Date of the payout,Unique ID of the payout';
const UBER_NAMES = 'Store Name,Store UUID,Order ID,Workflow ID,Order Date,Order Status,Sales (excl. tax),Tax on Sales,GST/HST on Sales,QST on Sales,Offers on items,Tax On Offers on items,Marketplace Fee,Tax on Marketplace fee,Marketplace Facilitator Tax,Total payout,Payout Date,Payout reference ID';

describe('Uber Payment Details with its description row', () => {
  const D = '2026-09-10'; const P = '2026-09-15';
  const rows = [
    `Test Kitchen,u-1,A1B2C,wf-a,${D},Completed,20.00,2.99,1.00,1.99,0,0,-5.00,-0.75,0,17.24,${P},PR-1`,
    `Test Kitchen,u-1,D3E4F,wf-b,${D},Completed,30.00,4.49,1.50,2.99,-3.00,-0.45,-6.75,-1.01,0,23.28,${P},PR-1`,
  ];
  it('reads the column names, not the descriptions, as the header', () => {
    const p = parseStatement('uber_payment-details_2026-09.csv', enc([UBER_DESC, UBER_NAMES, ...rows].join('\n')));
    expect(p.format).toBe('uber_payment_details');
    expect(p.channel).toBe('uber_eats');
    expect(p.headers[0]).toBe('Store Name');
    expect(p.lines.map((l) => [l.orderRef, l.orderRef2, l.net])).toEqual([['wf-a', 'A1B2C', 17.24], ['wf-b', 'D3E4F', 23.28]]);
    // "Offers on items" (+ its tax) is the restaurant-funded promotion the reconciliation adds back.
    expect(p.lines[1].promotions).toBe(-3.45);
  });
  it('leaves a file that starts with the names unchanged', () => {
    const t = [UBER_NAMES.split(','), rows[0].split(',')];
    expect(withoutDescriptionRow(t)).toBe(t);
  });
  it('imports through importStatement (upload and Reporting API path) instead of asking for a column mapping', async () => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
    const { importStatement } = await import('../lib/foodhub/recon/engine');
    const out = await importStatement({ fileName: 'uber_payment-details_2026-09.csv', bytes: enc([UBER_DESC, UBER_NAMES, ...rows].join('\n')), channel: 'uber_eats', actor, source: 'uber_reporting_api' });
    expect(out.ok).toBe(true);
    if (out.ok) expect([out.import.format, out.import.lines, out.import.totalNet]).toEqual(['uber_payment_details', 2, 40.52]);
  });
});

describe('DoorDash "NULL" placeholders', () => {
  const H = 'Timestamp local date,Payout date,Store ID,Store name,Transaction type,DoorDash order ID,Merchant delivery ID,Description,Final order status,Subtotal,Subtotal tax passed to merchant,Commission,Commission tax,Tablet fee,Tablet fee tax,Error charges,Adjustments,Net total,Payout ID';
  const D = ymd(Date.now() - 20 * 86400_000);
  const P = ymd(Date.now() - 13 * 86400_000);
  const rows = [
    `${D},${P},st-1,Test Kitchen,Order,dd-1,NULL,NULL,Delivered,20,2.99,-5,-0.75,0,0,0,0,17.24,PO-1`,
    `${D},${P},st-1,Test Kitchen,Fee,NULL,NULL,Tablet fee,NULL,0,0,0,0,-3,0,0,0,-3.00,PO-1`,
    `${D},${P},st-1,Test Kitchen,Fee,NULL,NULL,Tablet fee tax,NULL,0,0,0,0,0,-0.45,0,0,-0.45,PO-1`,
    `${D},${P},st-1,Test Kitchen,Adjustment,NULL,NULL,Equipment fee rebate,NULL,0,0,0,0,0,0,0,3,3.00,PO-1`,
  ];
  const file = () => enc([H, ...rows].join('\n'));

  it('reads "NULL" as an empty cell: no order called NULL, fee rows are fees', () => {
    expect(['NULL', 'null', 'N/A', '-', ' none '].every(isPlaceholder)).toBe(true);
    expect(['dd-1', '0', '', 'Nullam'].some(isPlaceholder)).toBe(false);
    const p = parseStatement('FINANCIAL_DETAILED_TRANSACTIONS.csv', file());
    expect(p.lines.map((l) => [l.orderRef, l.orderRef2, l.kind, l.description])).toEqual([
      ['dd-1', null, 'order', 'Order'],
      [null, null, 'fee', 'Fee — Tablet fee'],
      [null, null, 'fee', 'Fee — Tablet fee tax'],
      [null, null, 'adjustment', 'Adjustment — Equipment fee rebate'],
    ]);
  });

  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
  });

  it('tablet fees and rebates are other charges, never "paid but unknown" orders or a case', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { importStatement, reconcile, syncCases, listCases, payoutBatches } = await import('../lib/foodhub/recon/engine');
    const at = `${D}T16:00:00.000Z`;
    const { order } = await getRepo().insertOrderIfNew({ channel: 'doordash', marketplace: 'doordash', channelStoreId: 'st-1', fulfillment: 'delivery', placedAt: at, currency: 'CAD', deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {}, createdAt: at, externalOrderId: 'dd-1', displayId: 'DD1', subtotal: 20, tax: 2.99, total: 22.99 } as any);
    await getRepo().updateOrder(order.id, { status: 'completed' });
    expect((await importStatement({ fileName: 'dd.csv', bytes: file(), actor })).ok).toBe(true);
    const from = new Date(Date.parse(`${D}T00:00:00Z`) - 86400_000).toISOString();
    const to = new Date(Date.parse(`${P}T00:00:00Z`) + 2 * 86400_000).toISOString();
    const r = await reconcile({ from, to });
    expect(r.orders.map((o) => [o.ref, o.lines])).toEqual([['dd-1', 1]]);
    expect(r.unmatched).toEqual([]);
    expect(r.totals.unknownOrders).toBe(0);
    expect(r.other.map((l) => l.kind).sort()).toEqual(['adjustment', 'fee', 'fee']);
    expect(r.totals.otherCharges).toBe(-0.45);
    await syncCases(r);
    expect((await listCases({ status: ['open'] })).some((c) => c.type === 'unknown_order')).toBe(false);
    const [batch] = await payoutBatches({ from, to });
    expect([batch.refunds, batch.orders]).toEqual([0, 1]);
  });

  it('lines saved with "NULL" references are replaced on re-import, never counted twice; the phantom case closes', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { COL, importStatement, listCases, reconcile, syncCases } = await import('../lib/foodhub/recon/engine');
    const repo = getRepo();
    const base = { importId: 'old', importIds: ['old'], channel: 'doordash' as const, storeRef: 'st-1', orderDate: D, payoutDate: P, payoutRef: 'PO-1', sales: 0, tax: 0, commission: 0, commissionTax: 0, promotions: 0, adjustments: 0, otherFees: 0, hasBreakdown: true, row: 1 };
    await repo.putDocs(COL.lines, [
      { id: 'legacy-order', key: 'dd-1', at: `${D}T12:00:00.000Z`, data: { ...base, id: 'legacy-order', orderRef: 'dd-1', orderRef2: 'NULL', kind: 'order', description: 'Order — NULL', net: 17.24 } },
      { id: 'legacy-fee', key: 'null', at: `${D}T12:00:00.000Z`, data: { ...base, id: 'legacy-fee', orderRef: 'NULL', orderRef2: 'NULL', kind: 'refund', description: 'Fee — Tablet fee', net: -3 } },
    ]);
    await repo.putDocs(COL.cases, [{ id: 'doordash:unknown:NULL', key: 'doordash', at: `${D}T12:00:00.000Z`, data: { id: 'doordash:unknown:NULL', type: 'unknown_order', channel: 'doordash', ref: 'NULL', orderId: null, brandName: null, locationCode: null, orderDate: D, amount: 3, status: 'open', notes: [], openedAt: `${D}T12:00:00.000Z`, updatedAt: `${D}T12:00:00.000Z` } }]);
    const out = await importStatement({ fileName: 'dd-again.csv', bytes: file(), actor });
    expect(out.ok && [out.import.lines, out.import.newLines]).toEqual([4, 2]);
    const lines = (await repo.listDocs<any>(COL.lines, {})).map((d) => d.data);
    expect(lines).toHaveLength(4);
    expect(lines.some((l) => l.orderRef === 'NULL' || l.orderRef2 === 'NULL')).toBe(false);
    const order = lines.find((l) => l.orderRef === 'dd-1');
    expect(order.importIds).toEqual(['old', out.ok ? out.import.id : '']);
    const from = new Date(Date.parse(`${D}T00:00:00Z`) - 86400_000).toISOString();
    const to = new Date(Date.parse(`${P}T00:00:00Z`) + 2 * 86400_000).toISOString();
    expect((await syncCases(await reconcile({ from, to }))).closed).toBe(1);
    expect((await listCases({ status: ['open'] })).filter((c) => c.ref === 'NULL')).toEqual([]);
    expect((await listCases({ status: ['resolved'] })).map((c) => [c.id, c.autoClosed])).toEqual([['doordash:unknown:NULL', true]]);
  });
});

describe('reconciliation tiles agree with the per-order rows', () => {
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    (globalThis as any).__foodhubMem = undefined;
  });

  it('a promotion the order already carries is not subtracted a second time in "Expected" and "Difference"', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { importStatement, reconcile } = await import('../lib/foodhub/recon/engine');
    const { expectedPayout, getFees, planFor } = await import('../lib/foodhub/recon/fees');
    const repo = getRepo();
    const D = ymd(Date.now() - 20 * 86400_000); const P = ymd(Date.now() - 13 * 86400_000);
    const at = `${D}T16:00:00.000Z`;
    const base = { channel: 'uber_eats' as const, marketplace: 'uber_eats' as const, channelStoreId: 'u-1', fulfillment: 'delivery' as const, placedAt: at, currency: 'CAD', deliveryFee: 0, tip: 0, lines: [], raw: {}, createdAt: at };
    const plan = planFor(await getFees(), 'uber_eats', null);
    const rows: string[] = [];
    for (const [id, subtotal, discount, tax, short] of [['wf-p1', 20, 3.5, 2.47, 0], ['wf-p2', 30, 5, 3.74, 0], ['wf-p3', 25, 0, 3.74, 2]] as const) {
      const { order } = await repo.insertOrderIfNew({ ...base, externalOrderId: id, displayId: id.toUpperCase(), subtotal, discount, tax, total: subtotal - discount + tax } as any);
      await repo.updateOrder(order.id, { status: 'completed' });
      const exp = expectedPayout({ ...order, status: 'completed' }, plan);
      rows.push(`Test Kitchen,u-1,${id.toUpperCase()},${id},${D},Completed,${subtotal},${tax},0,0,${-discount},0,0,0,0,${(exp.net - short).toFixed(2)},${P},PR-9`);
    }
    expect((await importStatement({ fileName: 'uber_payment-details.csv', bytes: enc([UBER_DESC, UBER_NAMES, ...rows].join('\n')), actor })).ok).toBe(true);
    const from = new Date(Date.parse(`${D}T00:00:00Z`) - 86400_000).toISOString();
    const to = new Date(Date.parse(`${P}T00:00:00Z`) + 2 * 86400_000).toISOString();
    const r = await reconcile({ from, to });
    const uber = r.channels.find((c) => c.channel === 'uber_eats')!;
    const rs = r.orders.filter((o) => o.channel === 'uber_eats');
    expect(Object.fromEntries(rs.map((o) => [o.ref, o.status]))).toEqual({ 'wf-p1': 'matched', 'wf-p2': 'matched', 'wf-p3': 'short_paid' });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(uber.expected).toBeCloseTo(r2(rs.reduce((s, o) => s + o.expected.net, 0)), 2);
    expect(uber.diff).toBeCloseTo(r2(rs.reduce((s, o) => s + (o.diff ?? 0), 0)), 2);
    expect(uber.diff).toBeCloseTo(-2, 2); // before: +6.50 "paid more" (the two promotions taken off a second time)
    expect(uber.missingMoney).toBe(2);
  });
});

describe('finance: platform sales with no tax charged at all', () => {
  const rows = [
    'Test Kitchen,u-1,A1,wf-1,2026-09-05,Completed,40.00,0,0,0,0,0,-10.00,-1.50,0,28.50,2026-09-10,P1', // no tax at all → flagged
    'Test Kitchen,u-1,A2,wf-2,2026-09-06,Completed,40.00,5.99,2.00,3.99,0,0,-10.00,-1.50,0,34.49,2026-09-10,P1', // taxed → not flagged
    'Test Kitchen,u-1,A3,wf-3,2026-09-07,Completed,40.00,0,0,0,0,0,-10.00,-1.50,-5.99,22.51,2026-09-10,P1', // Uber withheld the tax itself
    'Test Kitchen,u-1,A4,wf-4,2025-01-10,Completed,40.00,0,0,0,-5.00,0,-10.00,-1.50,0,23.50,2025-01-13,P0', // GST holiday: QST still owed
  ];
  it('flags the GST + QST still owed, beside the existing QST-only flag', () => {
    const [none, taxed, withheld, holiday] = parseFinanceFile('uber_payment-details_test.csv', enc([UBER_DESC, UBER_NAMES, ...rows].join('\n'))).lines;
    expect([none.untaxedSales, none.taxNotCharged, none.gstNotCharged]).toEqual([40, 5.99, 0]);
    expect([taxed.untaxedSales, taxed.taxNotCharged]).toEqual([0, 0]);
    expect([withheld.untaxedSales, withheld.taxNotCharged]).toEqual([0, 0]);
    expect([holiday.untaxedSales, holiday.taxNotCharged]).toEqual([35, 3.49]);
  });
});

describe('phone layouts (390 px)', () => {
  it('the status filter pills wrap instead of squeezing their labels or scrolling the page sideways', () => {
    const html = renderToStaticMarkup(createElement(Segmented<string>, { value: 'a', onChange: () => undefined, options: ['À suivre (3)', 'Nouvelle (2)', 'Contactée (1)', 'Gagnée (0)', 'Perdue (0)', 'Toutes (3)'].map((label, i) => ({ key: String.fromCharCode(97 + i), label })) }));
    const group = html.match(/<div class="([^"]+)" role="group"/)?.[1] ?? '';
    expect(group.split(' ')).toContain('flex-wrap');
    const buttons = [...html.matchAll(/<button[^>]*class="([^"]+)"/g)].map((m) => m[1].split(' '));
    expect(buttons).toHaveLength(6);
    for (const b of buttons) expect(b).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
  });
  it('the kitchen card title keeps its width and the badges wrap under it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/(console)/stores/availability/availability-view.tsx'), 'utf8');
    const header = src.slice(src.indexOf('border-b border-line px-5 py-4'), src.indexOf('<h2 className="text-heading'));
    expect(header).toMatch(/className="min-w-0 grow basis-48"/);
    expect(header).not.toMatch(/min-w-0 flex-1/);
  });
});
