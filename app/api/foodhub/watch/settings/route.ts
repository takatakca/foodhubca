import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { channelsStatus } from '@/lib/foodhub/notify';
import { getWatchSettings, saveWatchSettings } from '@/lib/foodhub/watch/engine';
import { INCIDENT_KINDS, KIND_LABEL } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

// Watchtower rules: what to watch, when to text / call / wake the owner, quiet hours, chat, AI.
export const GET = withPerm('view', async () => ok({ settings: await getWatchSettings(), kinds: INCIDENT_KINDS.map((k) => ({ kind: k, ...KIND_LABEL[k] })), channels: channelsStatus() }));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'alert rules');
  if (gate) return gate;
  const b = await readJson(req);
  return ok({ settings: await saveWatchSettings(b.settings ?? {}, actor) });
});
