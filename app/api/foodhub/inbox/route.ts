import { parseUberOrder } from '@/lib/foodhub/adapters/uber-eats';
import { parseGenericOrder } from '@/lib/foodhub/adapters/partner';
import { parseRelayOrder } from '@/lib/foodhub/adapters/relay';
import { parseSkipOrder } from '@/lib/foodhub/adapters/skip';
import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { inboxSummary, inboxVisibleTo, receiveWebhook, replayInboxEntry, runInboxEntry, type InboxKind } from '@/lib/foodhub/inbox';
import { getRepo } from '@/lib/foodhub/repo';
import { can } from '@/lib/foodhub/session';
import type { ChannelKey } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Webhook inbox (lib/foodhub/inbox.ts): what each platform sent that still needs a look, and Replay.
// GET → counts + open entries (payloads only for the owner, with ?bodies=1: they hold customer names and phones).
// A manager limited to some locations sees and replays only their locations' entries (same rule as the orders list).
export const GET = withPerm('stores:map', async (req, _ctx, actor) => {
  const bodies = new URL(req.url).searchParams.get('bodies') === '1' && can(actor.role, 'admin');
  return ok({ inbox: await inboxSummary({ withBodies: bodies, locations: actor.locations }) });
});

/** A kept "unparsed" payload, read again with today's readers: which inbox handler takes it (null = still unreadable). */
function asInbox(channel: ChannelKey, body: any): { kind: InboxKind; body: unknown; reference: string | null } | null {
  if (channel === 'uber_eats') {
    if (body?.event_type) return { kind: 'uber', body, reference: String(body?.meta?.resource_id || '') || null };
    const o = parseUberOrder(body);
    return o ? { kind: 'order', body: o, reference: o.externalOrderId } : null;
  }
  if (channel === 'doordash') return body && typeof body === 'object' && !('raw' in body) ? { kind: 'doordash', body, reference: String(body?.id || body?.external_order_id || '') || null } : null;
  if (body?.order?.details) {
    const r = parseRelayOrder(body);
    return 'order' in r ? { kind: 'order', body: r.order, reference: r.order.externalOrderId } : null;
  }
  const o = channel === 'skip' ? parseSkipOrder(body) : parseGenericOrder(channel, channel, body);
  return o ? { kind: 'order', body: o, reference: o.externalOrderId } : null;
}

// POST { id } → process an inbox entry again now. POST { jobId } → feed a kept "unparsed" payload through the inbox
// (after a reader was fixed, a store was mapped…). Orders are never duplicated: same platform + order id = same order.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (b.id) {
    const e = await replayInboxEntry(String(b.id), actor);
    if (!e) return fail('No inbox entry with that id.', 404);
    return ok({ entry: { ...e, body: undefined } });
  }
  if (b.jobId) {
    const repo = getRepo();
    const job = (await repo.listJobs(500)).find((j) => j.id === String(b.jobId) && j.kind === 'webhook_unparsed');
    if (!job) return fail('No kept payload with that id.', 404);
    const target = asInbox(job.channel, (job.request as { body?: unknown })?.body);
    if (!target) return fail('Food Hub still cannot read this payload — send it to your developer (nothing was lost).', 422);
    if (!(await inboxVisibleTo({ channel: job.channel, ...target }, actor.locations))) return fail('No kept payload with that id.', 404);
    const entry = await receiveWebhook({ channel: job.channel, ...target });
    const done = await runInboxEntry(entry.id, { replayBy: actor.name });
    if (done?.status === 'done') await repo.updateJob(job.id, { status: 'done', result: { ...(job.result ?? {}), replayedAt: new Date().toISOString(), replayedBy: actor.name, outcome: done.result } });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'unparsed_replayed', status: done?.status === 'done' ? 'success' : 'failed', channel: job.channel,
      summary: `Kept ${job.channel} payload replayed: ${done?.status === 'done' ? done.result : done?.lastError ?? 'failed'}` });
    return ok({ entry: done ? { ...done, body: undefined } : null });
  }
  return fail('id or jobId is required');
});
