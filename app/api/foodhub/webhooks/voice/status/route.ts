import { after } from 'next/server';
import { callStatus, meterEndedCall } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// Twilio "Call status changes": closes the call record (duration, final status), then — after Twilio has its answer —
// meters the minutes the AI handled (TAKATAK Phone; nothing is sent unless FOODHUB_PHONE_METERED_ENABLED=true).
export async function POST(req: Request) {
  return twilioRoute(req, async (params) => {
    const ended = await callStatus(params);
    if (ended) after(() => meterEndedCall(ended));
    return new Response(null, { status: 204 }); // a 204 has no body (a '' body makes the Response constructor throw)
  });
}
