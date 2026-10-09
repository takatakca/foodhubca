import { waitTurn } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// <Redirect> after "one moment": picks up the AI turn that took longer than Twilio's 15-second limit.
export async function POST(req: Request) {
  const n = Number(new URL(req.url).searchParams.get('n')) || 1;
  return twilioRoute(req, (params) => waitTurn(params, n));
}
