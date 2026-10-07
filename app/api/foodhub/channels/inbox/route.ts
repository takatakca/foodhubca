import { actorLabel, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { listInboxAttention, replayInbox } from '@/lib/foodhub/inbox';

export const dynamic = 'force-dynamic';
// A replay runs the whole pipeline (Clover ticket, platform accept) inside the request.
export const maxDuration = 60;

// Order inbox (lib/foodhub/inbox.ts): orders saved on arrival that failed, or never finished, processing.
// Location-limited managers see only their locations' records (same rule as the orders list).
export const GET = withPerm('stores:map', async (_req, _ctx, actor) => ok({ inbox: await listInboxAttention(50, Date.now(), actor.locations) }));

// Owner's Replay button: { id } runs the saved order through the pipeline again. Idempotent — an order already in
// Food Hub is never created twice (insertOrderIfNew); the result and who asked go to the activity log.
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const id = String((await readJson(req)).id || '').trim();
  if (!id) return fail('id is required.');
  const res = await replayInbox(id, actorLabel(actor));
  if (!res) return fail('This order is not in the order inbox (already processed and cleared?).', 404);
  return ok({ result: res });
});
