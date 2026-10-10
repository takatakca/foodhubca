import { NextResponse, type NextRequest } from 'next/server';
import { parseSkipOnboardingNotice, verifySkipOnboardingSignature } from '@/lib/foodhub/adapters/skip-api';
import { recordSkipOnboarding } from '@/lib/foodhub/skip-ops';
import { background, keepUnparsed, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect partner onboarding notification: { eventType, sessionId, stage, timestamp, referenceId, restaurantMetadata }.
// Signed: X-Webhook-Signature = sha256=<hex HMAC-SHA256(SKIP_ONBOARDING_HMAC_SECRET, X-Webhook-Timestamp + "\n" + body)>,
// and older than 5 minutes is refused. JET does not retry, so the notification is kept as soon as it is accepted.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySkipOnboardingSignature(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  const notice = parseSkipOnboardingNotice(body);
  if (!notice) {
    background('keep unparsed skip onboarding', () => keepUnparsed('skip', body, 'Skip onboarding notification not recognized'));
    return NextResponse.json({ ok: false, error: 'Not an onboarding notification' }, { status: 400 });
  }
  background(`skip onboarding ${notice.sessionId}`, () => recordSkipOnboarding(notice), { channel: 'skip', body, reference: notice.sessionId, kind: 'settings' });
  return NextResponse.json({ ok: true }, { status: 200 });
}
