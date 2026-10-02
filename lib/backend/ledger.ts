export type LedgerDraftLine = { account: string; debit: number; credit: number; memo?: string };
export type LedgerDraft = { source: string; source_id: string; lines: LedgerDraftLine[]; status: 'draft_review_required' };

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
  const taxes = input.taxes ?? 0;
  const tips = input.tips ?? 0;
  const refunds = input.refunds ?? 0;
  const fees = input.fees ?? 0;
  const adjustments = input.adjustments ?? 0;
  const expected = input.gross_sales + taxes + tips - refunds - fees + adjustments;
  const actual = input.actual_payout ?? expected;
  return {
    source: input.platform,
    source_id: input.source_id,
    status: 'draft_review_required',
    lines: [
      { account: `${input.platform}: expected payout receivable`, debit: expected, credit: 0, memo: 'Expected payout from platform data' },
      { account: `${input.platform}: sales clearing`, debit: 0, credit: input.gross_sales, memo: 'Gross platform sales' },
      { account: `${input.platform}: taxes/tips clearing`, debit: 0, credit: taxes + tips, memo: 'Taxes and tips' },
      { account: `${input.platform}: refunds`, debit: refunds, credit: 0, memo: 'Refunds/chargebacks' },
      { account: `${input.platform}: fees`, debit: fees, credit: 0, memo: 'Platform fees' },
      { account: `${input.platform}: payout difference`, debit: Math.max(expected - actual, 0), credit: Math.max(actual - expected, 0), memo: 'Actual vs expected payout difference' }
    ]
  };
}
