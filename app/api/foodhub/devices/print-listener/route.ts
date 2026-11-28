import { fail, ok, readTextOr413 } from '@/lib/foodhub/http';
import { deviceFromRequest } from '@/lib/foodhub/identity/devices';
import { recordPrintListenerObservation } from '@/lib/foodhub/identity/print-listener';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    const device = await deviceFromRequest(req);
    if (!device) return fail('Not an enrolled device', 403);

    const body = await readTextOr413(req, 1024);
    if ('response' in body) return body.response;
    let locationCode: unknown;
    try { locationCode = JSON.parse(body.text)?.locationCode; }
    catch { return fail('Invalid print listener report'); }
    if (typeof locationCode !== 'string' || !locationCode.trim() || locationCode !== locationCode.trim()) {
      return fail('A location code is required');
    }
    if (locationCode !== device.locationCode) return fail('Device belongs to another kitchen', 403);

    const observedAt = await recordPrintListenerObservation(device);
    const response = ok({ locationCode, observedAt });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('[foodhub] print listener report failed:', error);
    return fail('Print listener reporting unavailable', 503);
  }
}
