import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { lookupWatchtowerCall } from '@/lib/foodhub/notify';

export const dynamic = 'force-dynamic';

// The messages outbox spans the account. Only an account-wide administrator may query Twilio for a recorded alert.
export const GET = withPerm('admin', async (req, _ctx, actor) => {
  if (actor.locations.length || actor.deviceId) return fail('This check requires account-wide access.', 403);
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return fail('A valid message ID is required.');

  const result = await lookupWatchtowerCall(id);
  if ('status' in result) {
    const response = ok({ status: result.status });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  if (result.error === 'not_found') return fail('No recorded alert call is available for this message.', 404);
  if (result.error === 'not_configured') return fail('Twilio call status is not configured.', 503);
  return fail('Twilio call status is unavailable.', 502);
});
