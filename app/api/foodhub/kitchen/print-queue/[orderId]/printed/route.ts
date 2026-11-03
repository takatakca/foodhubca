import { errorResponse } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { claimTabletPrint, resolvePrintCaller, validDeviceId } from '@/lib/foodhub/kitchen/print-queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ orderId: string }> };

// The tablet app claims a ticket BEFORE printing it: { deviceId, source?: 'platform'|'direct', kind?: 'order'|'cancel' }.
// { claimed: true } = print it now; { claimed: false, reason } = do not print (already printed on this device,
// cancelled, …). Written once and read back (lib/foodhub/kitchen/print-queue.ts claimTabletPrint): never twice.
export async function POST(req: Request, ctx: Ctx) {
  try {
    const b = await readJson(req);
    const caller = await resolvePrintCaller(req, typeof b.location === 'string' ? b.location : null);
    if (caller instanceof Response) return caller;
    if (!validDeviceId(b.deviceId)) return fail('deviceId is required (8–64 letters, digits, - or _).', 400);
    const { orderId } = await ctx.params;
    let id = String(orderId || '').trim();
    try { id = decodeURIComponent(id); } catch { /* already plain */ }
    if (!id || id.length > 120) return fail('Order id missing.', 400);
    const source = b.source === 'platform' || b.source === 'direct' ? b.source : null;
    const kind = b.kind === 'cancel' ? 'cancel' : 'order';
    const result = await claimTabletPrint({ orderId: id, deviceId: b.deviceId, location: caller.location, by: caller.label, source, kind });
    if (!result.claimed && (result.reason === 'not_found' || result.reason === 'other_kitchen')) return fail('Order not found in this kitchen.', 404, { claimed: false, reason: result.reason });
    return ok({ ...result });
  } catch (error) {
    return errorResponse(error, 'POST /api/foodhub/kitchen/print-queue/[orderId]/printed');
  }
}
