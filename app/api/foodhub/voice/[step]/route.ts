import { dialDone, incomingCall, recordingResponse, smsReceived, voicemailDone, whisperCall } from '@/lib/foodhub/phone/brand-lines';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';

// Brand phone lines (see lib/foodhub/phone/brand-lines.ts). In Twilio → Phone Numbers → each brand number:
//   "A call comes in"    → Webhook, POST, https://<FOODHUB_PUBLIC_URL>/api/foodhub/voice/incoming
//   "A message comes in" → Webhook, POST, https://<FOODHUB_PUBLIC_URL>/api/foodhub/voice/sms
// The other steps (whisper, dial-done, voicemail) are called by Twilio from the TwiML that "incoming" returns.
// Every POST is verified with TWILIO_AUTH_TOKEN; GET /recording is the signed voicemail listen link.
type Step = (params: URLSearchParams, query: URLSearchParams) => Promise<Response>;
const STEPS: Record<string, Step> = {
  incoming: (params) => incomingCall(params),
  whisper: whisperCall,
  'dial-done': dialDone,
  voicemail: voicemailDone,
  sms: smsReceived,
};

type Ctx = { params: Promise<{ step: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const step = STEPS[(await ctx.params).step];
  if (!step) return new Response('Not found', { status: 404 });
  const query = new URL(req.url).searchParams;
  return twilioRoute(req, (params) => step(params, query));
}

export async function GET(req: Request, ctx: Ctx) {
  if ((await ctx.params).step !== 'recording') return new Response('Not found', { status: 404 });
  return recordingResponse(new URL(req.url).searchParams);
}
