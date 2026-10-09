import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { disconnectUberStore } from '@/lib/foodhub/adapters/uber-provision';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// "Disconnect from Uber": removes this app's integration from one Uber store (DELETE pos_data, merchant token from the
// "Connect Uber Eats" session). The Food Hub mapping is kept, marked disconnected, so the history stays readable.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const id = String(b.id ?? '');
  const storeId = String(b.storeId ?? '');
  if (!id || !storeId) return fail('id and storeId are required');
  const repo = getRepo();
  const existing = await repo.findStore('uber_eats', storeId);
  if (existing && !inScope(actor, existing.locationCode)) return fail(`Store ${storeId} is mapped to ${existing.locationCode}, which is outside your locations.`, 403);
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(`Disconnecting changes your Uber store, so it needs the live switch: ${r.note}`, 409);
  let res;
  try { res = await disconnectUberStore(id, storeId); } catch (e) { return fail(e instanceof Error ? e.message : String(e), 409); }
  if (res.ok && existing) {
    const { awaitingProvision: _a, uberPos: _p, ...meta } = existing.meta ?? {};
    await repo.updateStore(existing.id, { meta: { ...meta, provisioned: false, uberDisconnectedAt: new Date().toISOString() } });
  }
  const where = existing ? `${existing.brandName} · ${existing.locationCode}` : storeId;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_disconnect', status: res.ok ? 'success' : 'failed', channel: 'uber_eats', storeId: existing?.id ?? null,
    brandName: existing?.brandName, locationCode: existing?.locationCode,
    summary: res.ok ? `Disconnected from Uber Eats: ${where} (Uber no longer sends this store's orders to Food Hub)` : `Uber Eats disconnect failed for ${where}: ${res.message}`,
    detail: { storeId, httpStatus: res.httpStatus ?? null } });
  return res.ok
    ? ok({ ok: true, message: 'Disconnected — Uber no longer sends this store’s orders or menu calls to Food Hub. Linking it again needs a new activation.' })
    : fail(res.message, res.httpStatus && res.httpStatus >= 400 && res.httpStatus < 500 ? 409 : 502);
});
