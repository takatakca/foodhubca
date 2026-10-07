import { callerTurn } from '@/lib/foodhub/phone/voice';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// <Gather> action: one sentence from the caller → the AI agent's answer.
export async function POST(req: Request) {
  return twilioRoute(req, callerTurn);
}
