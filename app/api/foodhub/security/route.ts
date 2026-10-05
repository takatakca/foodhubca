import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { ACTIONS, getPolicy, savePolicy } from '@/lib/foodhub/policy';

export const dynamic = 'force-dynamic';

// Manager-PIN rules per action (who can reject, cancel, refund, pause… without a manager).
export const GET = withPerm('view', async () => ok({ policy: await getPolicy(), actions: ACTIONS }));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'security rules');
  if (gate) return gate;
  const b = await readJson(req);
  const before = await getPolicy();
  const policy = await savePolicy(b.policy ?? {});
  const changed = (Object.keys(policy) as Array<keyof typeof policy>).filter((k) => policy[k] !== before[k]);
  if (changed.length) {
    await logActivity({ actor: actor.name, source: actor.source, kind: 'security', action: 'policy_saved', status: 'success', summary: `Manager PIN rules changed: ${changed.map((k) => `${ACTIONS[k].en} → ${policy[k]}`).join(', ')}` });
  }
  return ok({ policy });
});
