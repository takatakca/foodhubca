import { errorResponse } from '@/lib/foodhub/auth';
import { fail, ok, readTextOr413 } from '@/lib/foodhub/http';
import { parsePendingPrintRefs, readPendingPrintClaims, resolvePrintCaller, resolvePrintEnrollment, validDeviceId } from '@/lib/foodhub/kitchen/print-queue';

export const dynamic = 'force-dynamic';

// Recheck the exact native device's pending order claims before retrying a printer, including during a queue drain.
export async function POST(req: Request) {
  try {
    const body = await readTextOr413(req, 48 * 1024);
    if ('response' in body) return body.response;
    let input: { location?: unknown; deviceId?: unknown; ids?: unknown } | null;
    try { input = JSON.parse(body.text); } catch { return fail('Invalid pending print request.'); }
    const caller = await resolvePrintCaller(req, typeof input?.location === 'string' ? input.location : null);
    if (caller instanceof Response) return caller;
    const enrollment = await resolvePrintEnrollment(req, caller);
    if (enrollment instanceof Response) return enrollment;
    const refs = parsePendingPrintRefs(input?.ids);
    if (typeof input?.location !== 'string' || !input.location.trim() || !validDeviceId(input.deviceId) || !refs) {
      return fail('A kitchen, deviceId and 1–50 distinct pending order ticket IDs are required.');
    }
    const results = await readPendingPrintClaims({ refs, deviceId: input.deviceId, location: caller.location, enrollmentId: enrollment?.id });
    const response = ok({ location: caller.location, deviceId: input.deviceId, results });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return errorResponse(error, 'POST /api/foodhub/kitchen/print-queue/pending');
  }
}
