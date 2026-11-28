import { isDeepStrictEqual } from 'node:util';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { activateUberStores } from '@/lib/foodhub/adapters/uber-provision';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { defaultCloverMerchant, storeCloverMerchantIdProblem } from '@/lib/foodhub/pos/clover';
import { getRepo } from '@/lib/foodhub/repo';
import type { ChannelStore } from '@/lib/foodhub/types';
import { uberCloverChoice } from '@/lib/foodhub/uber-clover-choice';

export const dynamic = 'force-dynamic';
// 17 stores × (POST pos_data + PATCH + GET).
export const maxDuration = 120;

function sameBinding(before: ChannelStore | null, current: ChannelStore | null): boolean {
  if (!before || !current) return before === current;
  return before.id === current.id && before.channel === current.channel && before.channelStoreId === current.channelStoreId
    && before.brandName === current.brandName && before.locationCode === current.locationCode
    && (before.cloverMerchantId ?? null) === (current.cloverMerchantId ?? null);
}

// Activates the chosen Uber stores for this app and saves each store mapping (brand, location, Clover merchant) in one click.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const picks: Array<{ storeId: string; brandName: string; locationCode: string; cloverMerchantId?: string; cloverSuggested?: boolean }> = Array.isArray(b.stores) ? b.stores : [];
  if (!b.id || !picks.length) return fail('id and at least one store are required');
  if (picks.some((p) => !p.storeId || !p.brandName || !p.locationCode)) return fail('Every store needs a brand and a location');
  const storeIds = new Set(picks.map((pick) => pick.storeId));
  if (storeIds.size !== picks.length) return fail('Select each Uber Eats store only once.');
  // Same rules as POST /api/foodhub/stores: only your locations, only known brands/locations.
  const outside = picks.filter((p) => !inScope(actor, p.locationCode));
  if (outside.length) return fail(`You can only map stores at your locations (${actor.locations.join(', ')}).`, 403);
  const catalog = await getCatalog({ strict: true }).catch(() => null);
  if (!catalog) return fail('The saved kitchen catalog could not be loaded. Try again before activating stores.', 503);
  const badBrand = picks.find((p) => !catalog.brands.some((x) => x.name === p.brandName));
  if (badBrand) return fail(`Unknown brand "${badBrand.brandName}". Add it in Brands & Locations first.`);
  const badLocation = picks.find((p) => !catalog.locations.some((l) => l.code === p.locationCode));
  if (badLocation) return fail(`Unknown location "${badLocation.locationCode}". Add it in Brands & Locations first.`);
  const inactiveLocation = picks.find((p) => catalog.locations.some((l) => l.code === p.locationCode && l.active === false));
  if (inactiveLocation) return fail(`Location "${inactiveLocation.locationCode}" is inactive. Enable it in Brands & Locations before activation.`);
  const repo = getRepo();
  const [mapped, defaultMerchantId] = await Promise.all([repo.listStores(), defaultCloverMerchant()]);
  const bindings = new Map<string, ChannelStore | null>();
  for (const p of picks) {
    const existing = await repo.findStore('uber_eats', p.storeId);
    if (existing && !inScope(actor, existing.locationCode)) return fail(`Store ${p.storeId} is mapped to ${existing.locationCode}, which is outside your locations.`, 403);
    const badMerchant = storeCloverMerchantIdProblem({ channel: 'uber_eats', locationCode: p.locationCode, cloverMerchantId: p.cloverMerchantId }, existing);
    if (badMerchant) return fail(badMerchant.en);
    const choice = uberCloverChoice(p.storeId, p.locationCode, mapped, defaultMerchantId, existing ?? undefined);
    if ((choice.required && !p.cloverMerchantId?.trim())
      || (p.cloverSuggested && (!choice.suggestedClover || p.cloverMerchantId !== choice.suggestedClover))) {
      return fail(`Choose the destination Clover merchant for store ${p.storeId} before activation.`);
    }
    bindings.set(p.storeId, existing);
  }
  const r = uberEatsAdapter.readiness();
  if (!r.canSend) return fail(`Activation changes your Uber stores, so it needs the live switch: ${r.note}`, 409);
  const results = await activateUberStores(String(b.id), picks);
  const mappingConflicts = new Set<string>();
  for (const a of results) {
    if (!a.result.ok) continue;
    const p = picks.find((x) => x.storeId === a.storeId)!;
    const before = bindings.get(a.storeId) ?? null;
    const existing = await repo.findStore('uber_eats', a.storeId);
    if (!sameBinding(before, existing)) {
      mappingConflicts.add(a.storeId);
      continue;
    }
    const newerPos = !isDeepStrictEqual(before?.meta.uberPos, existing?.meta.uberPos);
    const mapping: Omit<ChannelStore, 'id'> = {
      channel: 'uber_eats', channelStoreId: a.storeId, brandName: p.brandName, locationCode: p.locationCode,
      cloverMerchantId: p.cloverMerchantId?.trim() || existing?.cloverMerchantId || null, autoAccept: existing?.autoAccept ?? true,
      online: existing?.online ?? true, pausedUntil: existing?.pausedUntil ?? null, lastStatusSource: existing?.lastStatusSource ?? null,
      // Uber confirms the activation with its store.provisioned webhook; until then the store is "waiting for Uber".
      meta: {
        ...(existing?.meta ?? {}), provisionedAt: new Date().toISOString(), ...(existing?.meta?.provisioned === true ? {} : { awaitingProvision: true }),
        ...(a.pos && !newerPos ? { uberPos: a.pos } : {}),
      },
    };
    const saved = existing ? await repo.updateStore(existing.id, mapping, existing) : await repo.insertStoreIfAbsent(mapping);
    if (!saved) mappingConflicts.add(a.storeId);
  }
  const okCount = results.filter((x) => x.result.ok).length;
  const elsewhere = results.filter((x) => x.pos?.orderManager === 'other').length;
  const reported = results.map((x) => {
    const orderManager = x.pos?.orderManager ?? null;
    const integrationEnabled = x.pos?.integrationEnabled ?? null;
    if (mappingConflicts.has(x.storeId)) return {
      storeId: x.storeId, ok: false, orderManager, integrationEnabled, providerAccepted: true, mappingConflict: true,
      message: 'Uber accepted activation. The Food Hub mapping changed during the request. Review the saved kitchen and Clover register in Stores → Mapping.',
    };
    return { storeId: x.storeId, ok: x.result.ok, orderManager, integrationEnabled, message: x.message };
  });
  const status = mappingConflicts.size || okCount !== results.length ? 'failed' : elsewhere ? 'info' : 'success';
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'uber_activate', status, channel: 'uber_eats',
    summary: `Uber Eats store activation: ${okCount}/${results.length} requests accepted${elsewhere ? `, Uber reports another order manager for ${elsewhere}` : ''}${mappingConflicts.size ? `, ${mappingConflicts.size} local mapping conflict(s)` : ''} (${picks.map((p) => `${p.brandName} · ${p.locationCode}`).join(', ')})`,
    detail: { results: reported } });
  return ok({ results: reported });
});
