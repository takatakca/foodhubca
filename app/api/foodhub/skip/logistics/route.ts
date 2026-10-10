import { buildJetLogisticsRequest, JET_LOGISTICS_OPS, jetLogisticsCall, jetLogisticsReadiness } from '@/lib/foodhub/adapters/jet-logistics';
import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET delivery-supplier operations (delivery pools, pickup ETAs, driver and delivery state per order).
//   GET                                          the 24 operations and whether the partner key is set
//   POST { operation, path?, query?, body?, dryRun? }  run one (dryRun: only show the request that would be sent)
export const GET = withPerm('admin', async () => {
  const r = jetLogisticsReadiness();
  return ok({ ready: r.canSend, note: r.note, missing: r.missing, operations: JET_LOGISTICS_OPS });
});

export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const id = String(b.operation ?? '');
  const input = { path: b.path as Record<string, string>, query: b.query as Record<string, string>, body: b.body };
  if (b.dryRun === true) {
    const built = buildJetLogisticsRequest(id, input);
    return 'error' in built ? fail(built.error) : ok({ request: built });
  }
  const res = await jetLogisticsCall(id, input);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'skip_logistics', status: res.ok ? 'success' : 'failed', channel: 'skip', summary: `Skip / JET ${id}: ${res.message}` });
  return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
});
