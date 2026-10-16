import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { menuLockOf } from '@/lib/foodhub/menu/lock';
import { setStoresOnline } from '@/lib/foodhub/ops';
import { localDay, splitKitchenRequest } from '@/lib/foodhub/order-tools/kitchen-status';
import { FORBIDDEN_STORE_IDS } from '@/lib/foodhub/public-directory';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// POST /api/foodhub/order-tools/kitchen/status { locationCode, storeIds, online, minutes?, reason? } — pause / reopen
// from the kitchen status sheet. Every store is checked HERE, not only in the tablet: the protected DoorDash store
// (Po Poulet NDG, FORBIDDEN_STORE_IDS or the built-in lock), "Do not touch" stores, stores of another kitchen and, for
// a reopen, holiday and platform closures are never sent; they come back in `notSent`. The rest goes through the same
// store-status logic as POST /api/foodhub/stores/status (same permission, same manager PIN rule "store.pause").
export const POST = withPerm('stores:toggle', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const locationCode = String(b.locationCode ?? '').trim();
  if (!locationCode) return fail('locationCode is required');
  if (!inScope(actor, locationCode)) return fail('Not one of your locations.', 403);
  const storeIds: string[] = Array.isArray(b.storeIds) ? b.storeIds.map(String) : [];
  if (!storeIds.length) return fail('storeIds is required');
  const online = b.online === true;
  const stores = (await getRepo().listStores()).map((s) => ({ ...s, menuLock: menuLockOf(s) }));
  const { send, notSent } = splitKitchenRequest(storeIds, stores, { locationCode, online, forbiddenIds: FORBIDDEN_STORE_IDS, today: localDay() });
  if (!send.length) return ok({ results: [], notSent });
  if (!online) {
    const gate = await approvalGate(req, actor, 'store.pause', locationCode, `${send.length} store(s)`);
    if (gate) return gate;
  }
  const minutes = Number(b.minutes || 0);
  const results = await setStoresOnline(send, online, {
    untilMs: !online && minutes > 0 ? Date.now() + minutes * 60_000 : undefined,
    reason: b.reason ? String(b.reason) : undefined,
    actor,
  });
  return ok({ results: [...results], notSent });
});
