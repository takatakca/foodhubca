import { logActivity } from '@/lib/foodhub/activity';
import { deliverectTgtgChannelIds } from '@/lib/foodhub/adapters/deliverect';
import { buildDeliverectRequest, DELIVERECT_OPS, deliverect, deliverectCall, deliverectReadiness, deliverectUploadCsv } from '@/lib/foodhub/adapters/deliverect-api';
import { withPerm } from '@/lib/foodhub/auth';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { DELIVERECT_EVENTS, DELIVERECT_LOCATIONS, type DeliverectLocationRecord } from '@/lib/foodhub/deliverect-ops';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Deliverect (the Too Good To Go POS route) from the console.
//   GET                                   readiness, the locations Deliverect registered, the 29 outbound operations, recent events
//   POST { action: "channels" }           the channels Deliverect knows, flagging the ones in DELIVERECT_TGTG_CHANNEL_IDS
//   POST { operation, path?, query?, body?, dryRun? }  run one outbound operation (dryRun: only show the request)
//   POST { action: "upload-csv", signedUrl, headers?, csv }  second step of the retail item / inventory upload
export const GET = withPerm('admin', async () => {
  const r = deliverectReadiness();
  const repo = getRepo();
  const [locations, events] = await Promise.all([repo.listDocs<DeliverectLocationRecord>(DELIVERECT_LOCATIONS, {}), repo.listDocs(DELIVERECT_EVENTS, { limit: 30 })]);
  const base = `${publicBaseUrl()}/api/foodhub/webhooks/deliverect`;
  return ok({
    ready: r.canSend, configured: r.configured, environment: r.environment, note: r.note, missing: r.missing,
    registerUrl: `${base}/register`, ordersUrl: `${base}/orders`, hmacSet: Boolean(process.env.DELIVERECT_HMAC_SECRET), tokenSet: Boolean(process.env.DELIVERECT_WEBHOOK_SECRET), tgtgChannelIds: deliverectTgtgChannelIds(),
    locations: locations.map((l) => l.data), operations: DELIVERECT_OPS, recentEvents: events.map((e) => ({ id: e.id, at: e.at, ...(e.data as object) })),
  });
});

export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (b.action === 'channels') {
    const res = await deliverect.channels();
    if (!res.ok) return fail(res.message, 409);
    const ids = deliverectTgtgChannelIds();
    return ok({ channels: res.items.map((c) => ({ ...c, isTgtg: ids.includes(Number(c.channelId ?? c.channel ?? c.id)) || /too\s*good\s*to\s*go|tgtg/i.test(String(c.name ?? '')) })) });
  }
  if (b.action === 'upload-csv') {
    const res = await deliverectUploadCsv({ signedUrl: String(b.signedUrl ?? ''), headers: b.headers }, String(b.csv ?? ''));
    return res.ok ? ok({ result: res }) : fail(res.message, 400, { result: res });
  }
  const id = String(b.operation ?? '');
  const input = { path: b.path as Record<string, string>, query: b.query as Record<string, string>, body: b.body };
  if (b.dryRun === true) {
    const built = buildDeliverectRequest(id, input);
    return 'error' in built ? fail(built.error) : ok({ request: built });
  }
  const res = await deliverectCall(id, input);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'deliverect_call', status: res.ok ? 'success' : 'failed', channel: 'tgtg', summary: `Deliverect ${id}: ${res.message}` });
  return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
});
