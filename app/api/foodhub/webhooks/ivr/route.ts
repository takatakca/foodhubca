import { ivrStart } from '@/lib/foodhub/phone/ivr/engine';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// ON2GO main line (FOODHUB_IVR_NUMBER) → Twilio → "A call comes in": Webhook, this URL, HTTP POST.
// "Call status changes": .../webhooks/ivr/status. Every request is signed with TWILIO_AUTH_TOKEN (refused otherwise).
export async function POST(req: Request) {
  return twilioRoute(req, ivrStart);
}
