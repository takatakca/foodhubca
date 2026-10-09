import { withPerm } from '@/lib/foodhub/auth';
import { fail } from '@/lib/foodhub/http';
import { getIvrCall } from '@/lib/foodhub/phone/ivr/records';

export const dynamic = 'force-dynamic';

// Plays a voicemail in the console: Twilio recordings need the account's credentials, so the browser never gets them —
// this route fetches the MP3 from api.twilio.com (and only from there) for a signed-in team member.
export const GET = withPerm('orders:act', async (req, _ctx, actor) => {
  if (actor.locations.length) return fail('The ON2GO line serves every location: ask the owner.', 403);
  const call = await getIvrCall(new URL(req.url).searchParams.get('id') || '');
  const url = call?.voicemail?.recordingUrl;
  if (!url) return fail('No recording for this call.', 404);
  let u: URL;
  try { u = new URL(url); } catch { return fail('Bad recording address.', 400); }
  if (u.protocol !== 'https:' || u.hostname !== 'api.twilio.com') return fail('Bad recording address.', 400);
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return fail('Twilio is not set up.', 503);
  const auth = `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
  const res = await fetch(`${u.toString().replace(/\.(mp3|wav)$/, '')}.mp3`, { headers: { Authorization: auth } });
  if (!res.ok || !res.body) return fail(`Twilio answered ${res.status}.`, 502);
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=300' } });
});
