import { errorResponse } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { buildPrintQueue, InvalidPrintQueueContinuation, resolvePrintCaller } from '@/lib/foodhub/kitchen/print-queue';

export const dynamic = 'force-dynamic';

// Food Hub tablet app (apps/kitchen-tablet): this kitchen's new orders since the cursor, each with its plain-text
// ticket for the tablet's thermal printer. ?location=<code> (optional for an enrolled tablet or a one-kitchen person),
// ?since=<iso> (default 15 min back, at most 24 h), ?device=<id> (marks what this device already printed and adds the
// « ANNULÉE » tickets), ?paper=58|80, ?lang=fr|en. Staff session or enrolled tablet only (lib/foodhub/kitchen/print-queue.ts).
// Clients that send ?paged=1 pass the returned continuation until the snapshot is drained, then advance since.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const caller = await resolvePrintCaller(req, q.get('location'));
    if (caller instanceof Response) return caller;
    const paging = q.get('paged') === '1';
    if (!paging && q.has('continuation')) return fail('Print queue pagination is required.');
    const queue = await buildPrintQueue({
      location: caller.location, since: q.get('since'), deviceId: q.get('device'), paper: q.get('paper'), lang: q.get('lang'),
      page: paging ? { scope: caller.cursorScope, continuation: q.get('continuation') } : undefined,
    });
    return ok({ location: caller.location, ...queue });
  } catch (error) {
    if (error instanceof InvalidPrintQueueContinuation) return fail('Invalid print queue continuation.');
    return errorResponse(error, 'GET /api/foodhub/kitchen/print-queue');
  }
}
