import { dialDone } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// <Dial> action after a hand-off: answered, or nobody (the team chat gets the number to call back).
export async function POST(req: Request) {
  return twilioRoute(req, dialDone);
}
