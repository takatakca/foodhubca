import { createUberPromotion, fetchUberHolidayDates, fetchUberMenuSummary, fetchUberStoreInfo, listUberPromotions, revokeUberPromotion, setUberByocFulfillment, setUberIntegrationEnabled, setUberItemPrice, setUberPickupInstructions, uberFlatOffPromotion } from '@/lib/foodhub/adapters/uber-api';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { uberEatsAdapter } from '@/lib/foodhub/adapters/uber-eats';
import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, inScope, withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Stores → Uber Eats: what Uber has for one mapped store (Store API: details, prep time, orderability; holiday dates;
// menu summary; promotions created by API), and the few store-level writes Uber offers: courier pickup instructions,
// create / revoke a "$ off" promotion. Reads need only the keys; writes need the live switch (409 otherwise).

async function storeFor(id: string, actor: AuthUser) {
  const s = id ? await getRepo().getStore(id).catch(() => null) : null;
  return s && s.channel === 'uber_eats' && !isRelayStore(s) && inScope(actor, s.locationCode) ? s : null;
}

export const GET = withPerm('stores:map', async (req, _ctx, actor) => {
  const r = uberEatsAdapter.readiness();
  const storeId = new URL(req.url).searchParams.get('storeId') || '';
  const stores = (await getRepo().listStores('uber_eats')).filter((s) => !isRelayStore(s) && inScope(actor, s.locationCode))
    .map((s) => ({ id: s.id, brandName: s.brandName, locationCode: s.locationCode, channelStoreId: s.channelStoreId, orderManager: (s.meta?.uberPos as { orderManager?: string } | undefined)?.orderManager ?? null }));
  if (!storeId) return ok({ configured: r.configured, live: r.canSend, note: r.note, noteFr: r.noteFr, stores });
  const s = await storeFor(storeId, actor);
  if (!s) return fail('Uber Eats store not found.', 404);
  if (!r.configured) return fail(r.note, 409);
  const [info, holidays, menu, promos] = await Promise.all([fetchUberStoreInfo(s.channelStoreId), fetchUberHolidayDates(s.channelStoreId), fetchUberMenuSummary(s.channelStoreId), listUberPromotions(s.channelStoreId)]);
  return ok({ configured: true, live: r.canSend, stores, info, holidays, menu, promotions: promos });
});

export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const s = await storeFor(String(b.storeId || ''), actor);
  if (!s) return fail('Uber Eats store not found.', 404);
  const action = String(b.action || '');
  const tag = `${s.brandName} · ${s.locationCode}`;
  let res;
  if (action === 'pickup') {
    res = await setUberPickupInstructions(s.channelStoreId, String(b.text ?? ''));
  } else if (action === 'promo_create') {
    const gate = await approvalGate(req, actor, 'menu.price', s.locationCode, `Uber Eats promotion ${tag}`);
    if (gate) return gate;
    const discount = Number(b.discount);
    const minSpend = b.minSpend !== undefined && b.minSpend !== '' ? Number(b.minSpend) : undefined;
    if (!(discount > 0 && discount <= 100)) return fail('Discount: 0.01 to 100 $.');
    if (minSpend !== undefined && !(minSpend >= discount)) return fail('The minimum order must be at least the discount.');
    const start = Date.parse(String(b.start ?? ''));
    const end = Date.parse(String(b.end ?? ''));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fail('Choose a start and an end (end after start).');
    res = await createUberPromotion(s, uberFlatOffPromotion({ startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), discount, minSpend, firstTimeOnly: b.firstTimeOnly === true, externalId: `takatak-${Date.now()}` }));
  } else if (action === 'promo_revoke') {
    res = await revokeUberPromotion(String(b.promotionId || ''));
  } else if (action === 'integration') {
    // Order webhooks on / off for this store (Update Integration Config) — off = Uber stops sending its orders here.
    const gate = await approvalGate(req, actor, 'store.pause', s.locationCode, `Uber Eats orders ${b.enabled === true ? 'on' : 'off'} for ${tag}`);
    if (gate) return gate;
    res = await setUberIntegrationEnabled(s.channelStoreId, b.enabled === true);
  } else if (action === 'item_price') {
    const gate = await approvalGate(req, actor, 'menu.price', s.locationCode, `Uber Eats price ${tag}`);
    if (gate) return gate;
    res = await setUberItemPrice(s, String(b.itemId ?? ''), Number(b.price));
  } else if (action === 'byoc_eta') {
    res = await setUberByocFulfillment(s.channelStoreId, { custom_min_etd_minutes: Math.max(1, Math.min(180, Math.round(Number(b.minutes) || 0))) });
  } else return fail('Unknown action.');
  const what: Record<string, string> = { pickup: 'pickup instructions', promo_create: 'promotion created', promo_revoke: 'promotion revoked', integration: `orders ${b.enabled === true ? 'on' : 'off'}`, item_price: `price of ${String(b.itemId ?? '')}`, byoc_eta: 'own-courier minimum delivery time' };
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: `uber_${action}`, status: res.ok ? 'success' : 'failed', channel: 'uber_eats', brandName: s.brandName, locationCode: s.locationCode, storeId: s.id,
    summary: `Uber Eats ${what[action]} for ${tag}: ${res.message}` });
  return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res });
});
