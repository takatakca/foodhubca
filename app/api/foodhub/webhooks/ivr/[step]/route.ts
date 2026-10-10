import { ivrDialDone, ivrRecording, ivrStatus, ivrTranscript, ivrTurn, ivrVoicemailDone, ivrWait } from '@/lib/foodhub/phone/ivr/engine';
import { twilioRoute } from '@/lib/foodhub/phone/twilio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ step: string }> };
const empty = () => new Response('', { status: 204 });

// Every step of the ON2GO phone menu. The Twilio signature is checked first, whatever the step (403 when unsigned).
//   turn           <Gather> action: words or keys (AI, keypad menu, platform order capture)
//   wait           <Redirect> while a slow AI turn finishes
//   dial-done      <Dial> action (a person or a platform's support line)
//   voicemail-done <Record> action
//   recording      recordingStatusCallback of the voicemail
//   transcript     <Transcription> statusCallbackUrl (live voicemail transcription)
//   status         the number's "Call status changes"
export async function POST(req: Request, ctx: Ctx) {
  const { step } = await ctx.params;
  const query = new URL(req.url).searchParams;
  return twilioRoute(req, async (p) => {
    switch (step) {
      case 'turn': return ivrTurn(p);
      case 'wait': return ivrWait(p, Number(query.get('n')) || 1);
      case 'dial-done': return ivrDialDone(p, query);
      case 'voicemail-done': return ivrVoicemailDone(p);
      case 'recording': await ivrRecording(p); return empty();
      case 'transcript': await ivrTranscript(p); return empty();
      case 'status': await ivrStatus(p); return empty();
      default: return new Response('Not found', { status: 404 });
    }
  });
}
