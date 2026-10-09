import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { DOORDASH_ACTIONS, doorDashActionById, doorDashApiStatus, runDoorDashAction } from '@/lib/foodhub/doordash/actions';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Settings → DoorDash: every DoorDash API Food Hub can call, as named actions (lib/foodhub/doordash/actions.ts).
// GET lists what this person may run, what is configured and the DoorDash stores / recent orders to pick from.
// POST { action, input } runs one. Permission, location scope and (for pausing, publishing, adjusting) the manager-PIN policy
// are applied here; the protected-store guard is applied inside every call, whatever the input says.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const repo = getRepo();
  const stores = (await repo.listStores('doordash')).filter((s) => inScope(actor, s.locationCode)).map((s) => ({ id: s.id, label: `${s.brandName} · ${s.locationCode} (${s.channelStoreId})` }));
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const orders = (await repo.listOrders({ since, limit: 200 })).filter((o) => o.channel === 'doordash' && inScope(actor, o.locationCode)).slice(0, 40)
    .map((o) => ({ id: o.id, label: `#${o.displayId || o.externalOrderId.slice(0, 8)} · ${o.brandName ?? ''} · ${o.status}` }));
  return ok({
    status: doorDashApiStatus(), stores, orders,
    actions: DOORDASH_ACTIONS.filter((a) => can(actor.role, a.perm)).map(({ run: _run, ...a }) => a),
  });
});

export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const action = doorDashActionById(String(b.action ?? ''));
  if (!action) return fail('Unknown action.', 404);
  if (!can(actor.role, action.perm)) return fail(`Your role (${actor.role}) cannot do this.`, 403);
  const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, any>;
  // Location scope: a person limited to some locations only acts on their stores and orders.
  const repo = getRepo();
  if (input.store) {
    const s = await repo.getStore(String(input.store)).catch(() => null);
    if (s && !inScope(actor, s.locationCode)) return fail('Not your location.', 403);
  }
  if (input.order) {
    const o = await repo.getOrder(String(input.order)).catch(() => null);
    if (o && !inScope(actor, o.locationCode)) return fail('Not your location.', 403);
  }
  if (action.policy) {
    const gate = await approvalGate(req, actor, action.policy, null, `DoorDash · ${action.label}`);
    if (gate) return gate;
  }
  const out = await runDoorDashAction(action, { actor, input });
  return out.ok ? ok({ message: out.message, data: out.data ?? null }) : fail(out.message, 409, { data: out.data ?? null });
});
