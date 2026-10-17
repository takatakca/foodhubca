import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { SANDBOX_AUTH_REASON, doorDashSandboxReason, verifyDoorDashSandboxWebhook } from '@/lib/foodhub/doordash/sandbox';
import { cartValidationResponse } from '@/lib/foodhub/doordash/ocv';
import { classifyDoorDash, isCartValidation } from '@/lib/foodhub/webhooks/doordash';
import { background, keepUnparsed, parseJson, retryLater, saveThenProcess, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash webhook subscriptions (Developer Portal): Order Create, Menu Status, Dasher Status — and ask DoorDash to point the
// Order Cancellation webhook here too. Menu Request (menu pull) is GET /api/foodhub/webhooks/doordash/<location id>.
// Point all of them at this URL with Authorization header = DOORDASH_WEBHOOK_SECRET.
// A Sandbox subscription uses its own value, DOORDASH_SANDBOX_WEBHOOK_SECRET: what it sends is always a TEST
// (docs/DOORDASH_SANDBOX.md), whatever DOORDASH_ENV says.
//
// Order Create is answered 202 (asynchronous confirmation): DoorDash treats a 200 as "order confirmed", which must
// only happen after Clover has the order — the pipeline confirms with PATCH /api/v1/orders/{id} once it does
// (DoorDash fails an order that is not confirmed within 3–8 minutes).
// Every payload is SAVED in the webhook inbox before the answer, then processed (lib/foodhub/webhooks/doordash.ts);
// shapes Food Hub does not know are kept under Channels → Unparsed payloads (200, so DoorDash does not retry —
// 202 when it may be an order). Only invalid JSON gets 400; a database that cannot be written gets 503 (resend).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  // The production secret first; the sandbox secret only when it did not match (it can never equal it).
  const productionAuth = doorDashAdapter.verifyWebhook(req.headers, raw);
  const sandboxAuth = !productionAuth && verifyDoorDashSandboxWebhook(req.headers);
  if (!productionAuth && !sandboxAuth) return unauthorized('doordash');
  const body = parseJson(raw);
  if (body === undefined) {
    if (!sandboxAuth) background('keep unparsed doordash', () => keepUnparsed('doordash', { raw: raw.slice(0, 20_000) }, 'Invalid JSON'));
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Order Cart Validation is a question DoorDash waits on: answered here, never stored.
  if (isCartValidation(body)) return cartValidationResponse(body, { sandboxAuth });
  const c = classifyDoorDash(body);
  // Sandbox or not is decided NOW and saved on the inbox entry: a retry or a Replay after DOORDASH_ENV changed stays a test.
  const sandbox = sandboxAuth ? SANDBOX_AUTH_REASON : await doorDashSandboxReason(body).catch(() => null);
  if (!(await saveThenProcess({ channel: 'doordash', kind: 'doordash', body, reference: c.reference, sandbox }))) return retryLater('doordash');
  return NextResponse.json({ ok: true, ...(c.kind === 'unparsed' ? { stored: 'unparsed' } : {}) }, { status: c.httpStatus });
}
