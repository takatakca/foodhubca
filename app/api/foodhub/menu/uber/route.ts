import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { planUberPublish, publishAllUber, uberPayloadFor } from '@/lib/foodhub/menu/uber-publish';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
// 17 stores × one menu PUT (+ holiday hours) each.
export const maxDuration = 120;

// Dry run of "Publish to all Uber stores": per store, what would be sent and what blocks it. Calls nothing on Uber.
// ?storeId=<id> → the exact PUT /v2/eats/stores/{id}/menus body for that store ("View JSON").
export const GET = withPerm('menu:edit', async (req, _ctx, actor) => {
  const storeId = new URL(req.url).searchParams.get('storeId');
  if (storeId) {
    const store = await getRepo().getStore(storeId);
    if (!store || store.channel !== 'uber_eats') return fail('No Uber Eats store with that id.', 404);
    if (!inScope(actor, store.locationCode)) return fail('This store is outside your locations.', 403);
    const built = await uberPayloadFor(store);
    if (!built) return fail(`No master menu saved for ${store.brandName}.`, 409);
    return ok({ store: { id: store.id, channelStoreId: store.channelStoreId, brandName: store.brandName, locationCode: store.locationCode }, path: `/v2/eats/stores/${store.channelStoreId}/menus`, body: built.body });
  }
  return ok({ plan: await planUberPublish({ locations: actor.locations }) });
});

// Publish to every Uber store the plan allows (body.storeIds = only those). Do-not-touch stores are never sent.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const storeIds = Array.isArray(b.storeIds) && b.storeIds.length ? b.storeIds.map(String) : undefined;
  const plan = await planUberPublish({ storeIds, locations: actor.locations });
  if (!plan.rows.length) return fail('No Uber Eats store is mapped (at your locations). Connect them under Stores → Connect Uber Eats.', 409);
  if (!plan.summary.publish) return fail('Nothing to publish: every selected Uber store is marked “Do not touch” or its menu has errors.', 409, { plan });
  const gate = await approvalGate(req, actor, 'menu.publish', null, `all Uber Eats stores (${plan.summary.publish})`);
  if (gate) return gate;
  const { results } = await publishAllUber({ storeIds, locations: actor.locations, actor });
  const sent = results.filter((r) => r.result.status === 'done' || r.result.status === 'queued').length;
  const blocked = results.filter((r) => r.result.status === 'blocked').length;
  const untouched = results.filter((r) => r.result.status === 'skipped').length;
  const failed = results.length - sent - blocked - untouched;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'publish_all_uber', status: failed || blocked ? (sent ? 'info' : 'failed') : 'success', channel: 'uber_eats',
    summary: `Publish to all Uber Eats stores: ${sent} received by Uber, ${failed} refused, ${blocked} not sent (blocked), ${untouched} left untouched (“Do not touch”)`, detail: { sent, failed, blocked, untouched } });
  return ok({ results, sent, failed, blocked, untouched });
});
