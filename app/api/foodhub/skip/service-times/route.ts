import { toSkipServiceTimes } from '@/lib/foodhub/adapters/skip-api';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { effectiveHours, getHours } from '@/lib/foodhub/hours';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { pushSkipServiceTimes } from '@/lib/foodhub/skip-ops';
import { foodhubTimeZone } from '@/lib/foodhub/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// JET Connect service times: the Food Hub opening hours sent to Skip, store by store.
//   GET   → what would be sent for each mapped Skip store (nothing is sent)
//   POST  → send it { storeIds? }  (the menu hours on Skip keep applying: JET uses the overlap of both)
export const GET = withPerm('menu:edit', async (_req, _ctx, actor) => {
  const hours = await getHours();
  const stores = (await getRepo().listStores('skip')).filter((s) => inScope(actor, s.locationCode));
  return ok({ timezone: foodhubTimeZone(), stores: stores.map((s) => ({ storeId: s.id, brandName: s.brandName, locationCode: s.locationCode, channelStoreId: s.channelStoreId, body: toSkipServiceTimes(effectiveHours(hours, s.brandName, s.locationCode), foodhubTimeZone()) })) });
});

export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const storeIds: string[] | undefined = Array.isArray(b.storeIds) && b.storeIds.length ? b.storeIds.map(String) : undefined;
  const gate = await approvalGate(req, actor, 'team.manage', null, 'Skip opening hours');
  if (gate) return gate;
  const rows = await pushSkipServiceTimes({ storeIds, inScope: (code) => inScope(actor, code) });
  if (!rows.length) return fail('No mapped Skip store matched.', 404);
  const sent = rows.filter((r) => r.result.ok && r.result.status !== 'skipped').length;
  return ok({ rows, sent, blocked: rows.filter((r) => r.result.status === 'blocked').length, errors: rows.filter((r) => r.result.status === 'error').length });
});
