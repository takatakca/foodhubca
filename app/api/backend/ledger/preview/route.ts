import { createPayoutLedgerPreview } from '@/lib/backend/ledger';
import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Draft journal preview from payout figures. Nothing is posted; review is always required.
export const POST = withPerm('admin', async (req) => {
  const body = await readJson(req);
  const draft = createPayoutLedgerPreview({
    platform: String(body.platform ?? 'unknown'),
    gross_sales: Number(body.gross_sales ?? 0),
    taxes: Number(body.taxes ?? 0),
    tips: Number(body.tips ?? 0),
    refunds: Number(body.refunds ?? 0),
    fees: Number(body.fees ?? 0),
    adjustments: Number(body.adjustments ?? 0),
    // Absent = deposit not received yet (the receivable stays open); never default to a 0 payout.
    actual_payout: body.actual_payout == null || body.actual_payout === '' ? undefined : Number(body.actual_payout),
    source_id: String(body.source_id ?? 'manual-preview')
  });
  return ok({ draft });
});
