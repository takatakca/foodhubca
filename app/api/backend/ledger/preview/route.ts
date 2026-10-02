import { NextRequest, NextResponse } from 'next/server';
import { createPayoutLedgerPreview } from '@/lib/backend/ledger';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const draft = createPayoutLedgerPreview({
    platform: String(body.platform ?? 'unknown'),
    gross_sales: Number(body.gross_sales ?? 0),
    taxes: Number(body.taxes ?? 0),
    tips: Number(body.tips ?? 0),
    refunds: Number(body.refunds ?? 0),
    fees: Number(body.fees ?? 0),
    adjustments: Number(body.adjustments ?? 0),
    actual_payout: Number(body.actual_payout ?? 0),
    source_id: String(body.source_id ?? 'manual-preview')
  });
  return NextResponse.json({ ok: true, draft });
}
