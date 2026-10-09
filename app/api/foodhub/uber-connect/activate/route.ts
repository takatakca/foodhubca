import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { activateUberStores } from '@/lib/foodhub/adapters/uber-provision';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { cloverMerchantIdProblem } from '@/lib/foodhub/pos/clover';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
// 17 stores × (POST pos_data + PATCH + GET).
export const maxDuration = 120;

// Activates the chosen Uber stores for this app and saves each store mapping (brand, location, Clover merchant) in one click.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const picks: Array<{ storeId: string; brandName: string; locationCode: string; cloverMerchantId?: string }> = Array.isArray(b.stores) ? b.stores : [];
  if (!b.id || !picks.length) return fail('id and at least one store are required');
  if (picks.some((p) => !p.storeId || !p.brandName || !p.locationCode)) return fail('Every store needs a brand and a location');
  // Same rules as POST /api/foodhub/stores: only your locations, only known brands/locations.
  const outside = picks.filter((p) => !inScope(actor, p.locationCode));
  if (outside.length) return fail(`You can only map stores at your locations (${actor.locations.join(', ')}).`, 403);
  const catalog = await getCatalog();
  const badBrand = picks.find((p) => !catalog.brands.some((x) => x.name === p.brandName));
  if (badBrand) return fail(`Unknown brand "${badBrand.brandName}". Add it in Brands & Locations first.`);
  const badLocation = picks.find((p) => !catalog.locations.some((l) => l.code === p.locationCode));
  if (badLocation) return fail(`Unknown location "${badLocation.locationCode}". Add it in Brands & Locations first.`);
  const badMerchant = picks.map((p) => cloverMerchantIdProblem(p.cloverMerchantId)).find(Boolean);
  if (badMerchant) return fail(badMerchant.en);
  const repo = getRepo();
  for (const p of picks) {
    const existing = await repo.findStore('uber_eats', p.storeId);
    if (existing && !inScope(actor, existing.locationCode)) return fail(`Store ${p.storeId} is mapped to ${existing.locationCode}, which is outside your locations.`, 403);
  }
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(`Activation changes your Uber stores, so it needs the live switch: ${r.note}`, 409);
  const results = await activateUberStores(String(b.id), picks);
  for (const a of results) {
    if (!a.result.ok) continue;
    const p = picks.find((x) => x.storeId === a.storeId)!;
    const existing = await repo.findStore('uber_eats', a.storeId);
    await repo.upsertStore({
      id: existing?.id, channel: 'uber_eats', channelStoreId: a.storeId, brandName: p.brandName, locationCode: p.locationCode,
      cloverMerchantId: p.cloverMerchantId?.trim() || existing?.cloverMerchantId || null, autoAccept: existing?.autoAccept ?? true,
      online: existing?.online ?? true, pausedUntil: existing?.pausedUntil ?? null, lastStatusSource: existing?.lastStatusSource ?? null,
      // Uber confirms the activation with its store.provisioned webhook; until then the store is "waiting for Uber".
      meta: {
        ...(existing?.meta ?? {}), provisionedAt: new Date().toISOString(), ...(existing?.meta?.provisioned === true ? {} : { awaitingProvision: true }),
        ...(a.pos ? { uberPos: a.pos } : {}),
      },
    });
  }
  const okCount = results.filter((x) => x.result.ok).length;
  const elsewhere = results.filter((x) => x.pos?.orderManager === 'other').length;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_activate', status: okCount === results.length ? (elsewhere ? 'info' : 'success') : 'failed', channel: 'uber_eats',
    summary: `Uber Eats store activation: ${okCount}/${results.length} activated${elsewhere ? `, ${elsewhere} still taking orders through another integration (UrbanPiper)` : ''} (${picks.map((p) => `${p.brandName} · ${p.locationCode}`).join(', ')})`,
    detail: { results: results.map((x) => ({ storeId: x.storeId, ok: x.result.ok, orderManager: x.pos?.orderManager ?? null, message: x.message })) } });
  return ok({ results: results.map((x) => ({ storeId: x.storeId, ok: x.result.ok, orderManager: x.pos?.orderManager ?? null, message: x.message })) });
});
