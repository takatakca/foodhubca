import { startCall } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// Twilio → Phone Numbers → your number → "A call comes in": Webhook, this URL, HTTP POST.
// Also set "Call status changes" to .../webhooks/voice/status. Requests are signed with TWILIO_AUTH_TOKEN.
export async function POST(req: Request) {
  return twilioRoute(req, startCall);
}
