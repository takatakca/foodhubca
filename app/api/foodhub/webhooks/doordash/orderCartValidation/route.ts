import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { cartValidationResponse } from '@/lib/foodhub/doordash/ocv';
import { parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// DoorDash "Order Cart Validation": POST https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/orderCartValidation
// (Developer Portal → Webhook subscriptions → Order Cart Validation, Authorization = DOORDASH_WEBHOOK_SECRET).
// Answered from Food Hub's own data (paused store, hours, 86'd items and options) in well under the 2-3 seconds DoorDash
// allows; nothing is stored and nothing is sent to DoorDash. A protected or unknown store gets 409 / 404, which makes
// DoorDash skip the check for that cart. The same payload posted to /api/foodhub/webhooks/doordash is answered too.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!doorDashAdapter.verifyWebhook(req.headers, raw)) return unauthorized('doordash');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  return cartValidationResponse(body);
}
