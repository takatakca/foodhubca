import { callStatus } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// Twilio "Call status changes": closes the call record (duration, final status).
export async function POST(req: Request) {
  return twilioRoute(req, async (params) => {
    await callStatus(params);
    return new Response('', { status: 204 });
  });
}
