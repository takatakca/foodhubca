import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { getCall, listCalls, maskNumber, type PhoneCall } from '@/lib/foodhub/phone/calls';

export const dynamic = 'force-dynamic';

// The call log. Lists show masked numbers; one call (?id=) shows the transcript and the number (to call back).
// The AI message history is never sent to the browser.
const lite = (c: PhoneCall) => ({ ...c, messages: undefined, from: maskNumber(c.from), transcriptLength: c.transcript.length, transcript: undefined, pending: undefined });

export const GET = withPerm('orders:act', async (req, _ctx, actor) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (id) {
    const call = await getCall(id);
    if (!call || !inScope(actor, call.locationCode)) return fail('Call not found.', 404);
    return ok({ call: { ...call, messages: undefined, pending: undefined } });
  }
  const days = Math.min(60, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const calls = (await listCalls({ since: new Date(Date.now() - days * 86400_000).toISOString(), limit: 1000 }))
    .filter((c) => inScope(actor, c.locationCode) && (url.searchParams.get('tests') === '1' || !c.simulated));
  return ok({ calls: calls.map(lite) });
});
