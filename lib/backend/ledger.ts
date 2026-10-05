export type LedgerDraftLine = { account: string; debit: number; credit: number; memo?: string };
export type LedgerDraft = { source: string; source_id: string; lines: LedgerDraftLine[]; totals: { debit: number; credit: number }; status: 'draft_review_required' };

// Money is computed in integer cents so every line is exact and the journal balances to the cent.
const cents = (n: number | undefined) => Math.round((Number(n) || 0) * 100);
const money = (c: number) => c / 100;

export function createPayoutLedgerPreview(input: {
  platform: string;
  gross_sales: number;
  taxes?: number;
  tips?: number;
  refunds?: number;
  fees?: number;
  adjustments?: number;
  actual_payout?: number;
  source_id: string;
}): LedgerDraft {
  const p = input.platform;
  const gross = cents(input.gross_sales);
  const taxes = cents(input.taxes);
  const tips = cents(input.tips);
  const refunds = cents(input.refunds);
  const fees = cents(input.fees);
  const adjustments = cents(input.adjustments);
  const expected = gross + taxes + tips - refunds - fees + adjustments;
  // No actual payout yet → the receivable stays open; nothing is booked as received.
  const hasActual = typeof input.actual_payout === 'number' && Number.isFinite(input.actual_payout);
  const actual = hasActual ? cents(input.actual_payout) : expected;
  const line = (account: string, debit: number, credit: number, memo: string): LedgerDraftLine => ({ account: `${p}: ${account}`, debit: money(debit), credit: money(credit), memo });
  const lines: LedgerDraftLine[] = [
    line('expected payout receivable', expected, 0, hasActual ? 'Expected payout from platform data' : 'Expected payout from platform data (deposit not received yet)'),
    line('sales clearing', 0, gross, 'Gross platform sales'),
    line('taxes/tips clearing', 0, taxes + tips, 'Taxes and tips'),
    line('refunds', refunds, 0, 'Refunds/chargebacks'),
    line('fees', fees, 0, 'Platform fees'),
    line('adjustments', Math.max(-adjustments, 0), Math.max(adjustments, 0), 'Platform adjustments (credit = paid to you, debit = charged to you)'),
  ];
  if (hasActual) {
    // Deposit received: bank takes the actual amount, the receivable is cleared at the expected
    // amount and the difference lands on a variance line (debit = shortfall, credit = overage).
    lines.push(
      line('bank deposit', actual, 0, 'Actual payout received'),
      line('expected payout receivable', 0, expected, 'Receivable cleared by the deposit'),
      line('payout variance', Math.max(expected - actual, 0), Math.max(actual - expected, 0), 'Actual vs expected payout difference'),
    );
  }
  const totals = lines.reduce((t, l) => ({ debit: t.debit + cents(l.debit), credit: t.credit + cents(l.credit) }), { debit: 0, credit: 0 });
  return {
    source: p,
    source_id: input.source_id,
    status: 'draft_review_required',
    lines,
    totals: { debit: money(totals.debit), credit: money(totals.credit) },
  };
}
