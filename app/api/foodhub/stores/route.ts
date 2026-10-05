import { isChannelKey } from '@/lib/foodhub/adapters';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

/** A manager limited to some locations may only map stores at those locations. */
function scopeError(actor: AuthUser, locationCode: string): string | null {
  return inScope(actor, locationCode) ? null : `You can only map stores at your locations (${actor.locations.join(', ')}).`;
}

/** brand + location must exist in Brands & Locations, so a typo cannot create an orphan mapping. */
async function catalogError(brandName: string, locationCode: string): Promise<string | null> {
  const catalog = await getCatalog();
  if (!catalog.brands.some((b) => b.name === brandName)) return `Unknown brand "${brandName}". Add it in Brands & Locations first.`;
  if (!catalog.locations.some((l) => l.code === locationCode)) return `Unknown location "${locationCode}". Add it in Brands & Locations first.`;
  return null;
}

export const dynamic = 'force-dynamic';

export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const repo = getRepo();
  return ok({ mode: repo.mode, stores: (await repo.listStores()).filter((s) => inScope(actor, s.locationCode)) });
});

// Create or update a store mapping (channel store id → brand + location + Clover merchant).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const channel = String(b.channel);
  if (!isChannelKey(channel)) return fail('channel must be one of uber_eats, doordash, skip, tgtg');
  if (!b.channelStoreId || !b.brandName || !b.locationCode) return fail('channelStoreId, brandName and locationCode are required');
  const brandName = String(b.brandName).trim();
  const locationCode = String(b.locationCode).trim();
  const scoped = scopeError(actor, locationCode);
  if (scoped) return fail(scoped, 403);
  const unknown = await catalogError(brandName, locationCode);
  if (unknown) return fail(unknown);
  const repo = getRepo();
  const existing = b.id ? await repo.getStore(String(b.id)) : await repo.findStore(channel, String(b.channelStoreId).trim());
  // Re-mapping a store that belongs to another location is out of scope too.
  if (existing && !inScope(actor, existing.locationCode)) return fail(scopeError(actor, existing.locationCode)!, 403);
  const store = await repo.upsertStore({
    id: existing?.id,
    channel,
    channelStoreId: String(b.channelStoreId).trim(),
    brandName,
    locationCode,
    cloverMerchantId: b.cloverMerchantId ? String(b.cloverMerchantId).trim() : existing?.cloverMerchantId ?? null,
    autoAccept: b.autoAccept === undefined ? existing?.autoAccept ?? true : Boolean(b.autoAccept),
    online: existing?.online ?? true,
    pausedUntil: existing?.pausedUntil ?? null,
    lastStatusSource: existing?.lastStatusSource ?? null,
    meta: existing?.meta ?? {},
  });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: existing ? 'store_mapping_updated' : 'store_mapped', status: 'success', channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `${existing ? 'Updated' : 'Mapped'} ${store.channel} store ${store.channelStoreId} → ${store.brandName} · ${store.locationCode}` });
  return ok({ store });
});

export const DELETE = withPerm('stores:map', async (req, _ctx, actor) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('id is required');
  const store = await getRepo().getStore(id);
  if (store && !inScope(actor, store.locationCode)) return fail(scopeError(actor, store.locationCode)!, 403);
  await getRepo().deleteStore(id);
  if (store) await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'store_unmapped', status: 'success', channel: store.channel, brandName: store.brandName, locationCode: store.locationCode, summary: `Removed ${store.channel} store ${store.channelStoreId} (${store.brandName} · ${store.locationCode})` });
  return ok();
});
