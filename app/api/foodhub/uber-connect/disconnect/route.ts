import { isDeepStrictEqual } from 'node:util';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { disconnectUberStore } from '@/lib/foodhub/adapters/uber-provision';
import { UBER_LINK_STATUS_FIELDS } from '@/lib/foodhub/adapters/uber-link';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo, type FoodHubRepo } from '@/lib/foodhub/repo';
import type { ChannelStore } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

async function saveDisconnect(repo: FoodHubRepo, before: ChannelStore): Promise<boolean> {
  const disconnectedAt = new Date().toISOString();
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await repo.getStore(before.id);
    if (!current || current.channel !== before.channel || current.channelStoreId !== before.channelStoreId
      || current.locationCode !== before.locationCode || current.brandName !== before.brandName
      || current.cloverMerchantId !== before.cloverMerchantId) return false;
    if (!UBER_LINK_STATUS_FIELDS.every((key) => current.meta[key] === before.meta[key])
      || !isDeepStrictEqual(current.meta.uberPos, before.meta.uberPos)) return false;
    const { awaitingProvision: _awaiting, uberPos: _pos, ...meta } = current.meta;
    if (await repo.updateStore(current.id, { meta: { ...meta, provisioned: false, uberDisconnectedAt: disconnectedAt } }, current)) return true;
  }
  return false;
}

// "Disconnect from Uber": removes this app's integration from one Uber store (DELETE pos_data, merchant token from the
// "Connect Uber Eats" session). The Food Hub mapping is kept, marked disconnected, so the history stays readable.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const id = String(b.id ?? '');
  const storeId = String(b.storeId ?? '');
  if (!id || !storeId) return fail('id and storeId are required');
  const repo = getRepo();
  const existing = await repo.findStore('uber_eats', storeId);
  if (!existing && actor.locations.length) return fail('This store has no mapping within your locations.', 403);
  if (existing && !inScope(actor, existing.locationCode)) return fail(`Store ${storeId} is mapped to ${existing.locationCode}, which is outside your locations.`, 403);
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(`Disconnecting changes your Uber store, so it needs the live switch: ${r.note}`, 409);
  let res;
  try { res = await disconnectUberStore(id, storeId); } catch (e) { return fail(e instanceof Error ? e.message : String(e), 409); }
  const mappingConflict = Boolean(res.ok && existing && !(await saveDisconnect(repo, existing).catch(() => false)));
  const reviewMessage = 'Uber accepted the disconnect. The Food Hub link could not be confirmed locally. Review the saved link in Stores → Mapping.';
  const where = existing ? `${existing.brandName} · ${existing.locationCode}` : storeId;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_disconnect',
    status: res.ok ? (mappingConflict ? 'info' : 'success') : 'failed', channel: 'uber_eats',
    storeId: mappingConflict ? null : existing?.id ?? null, brandName: existing?.brandName, locationCode: existing?.locationCode,
    summary: mappingConflict ? reviewMessage : res.ok
      ? `Disconnected from Uber Eats: ${where} (Uber no longer sends this store's orders to Food Hub)`
      : `Uber Eats disconnect failed for ${where}: ${res.message}`,
    detail: { storeId, httpStatus: res.httpStatus ?? null, ...(mappingConflict ? { mappingConflict: true } : {}) } });
  if (!res.ok) return fail(res.message, res.httpStatus && res.httpStatus >= 400 && res.httpStatus < 500 ? 409 : 502);
  if (mappingConflict) return ok({ ok: true, mappingConflict: true, message: reviewMessage });
  return ok({ ok: true, message: 'Disconnected — Uber no longer sends this store’s orders or menu calls to Food Hub. Linking it again needs a new activation.' });
});
