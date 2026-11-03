import { errorResponse } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { buildPrintQueue, resolvePrintCaller } from '@/lib/foodhub/kitchen/print-queue';

export const dynamic = 'force-dynamic';

// Food Hub tablet app (apps/kitchen-tablet): this kitchen's new orders since the cursor, each with its plain-text
// ticket for the tablet's thermal printer. ?location=<code> (optional for an enrolled tablet or a one-kitchen person),
// ?since=<iso> (default 15 min back, at most 24 h), ?device=<id> (marks what this device already printed and adds the
// « ANNULÉE » tickets), ?paper=58|80, ?lang=fr|en. Staff session or enrolled tablet only (lib/foodhub/kitchen/print-queue.ts).
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const caller = await resolvePrintCaller(req, q.get('location'));
    if (caller instanceof Response) return caller;
    const queue = await buildPrintQueue({ location: caller.location, since: q.get('since'), deviceId: q.get('device'), paper: q.get('paper'), lang: q.get('lang') });
    return ok({ location: caller.location, ...queue });
  } catch (error) {
    return errorResponse(error, 'GET /api/foodhub/kitchen/print-queue');
  }
}
