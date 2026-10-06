import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { getHours, publishContext } from '@/lib/foodhub/hours';
import { getMenuLanguages } from '@/lib/foodhub/menu/language';
import { toDoorDashMenu } from '@/lib/foodhub/menu/translate';
import { menuForLocation } from '@/lib/foodhub/ops';
import { getRepo } from '@/lib/foodhub/repo';
import { unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// DoorDash "Menu Request" (menu pull), required to onboard stores: DoorDash calls
//   GET https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/{location_id}
// where location_id is the store's merchant_supplied_id (the DoorDash store id mapped under Stores → Mapping).
// Developer Portal → Webhook subscriptions → Event type "Menu Request" → URL https://YOUR-DOMAIN/api/foodhub/webhooks/doordash
// (no trailing slash; DoorDash appends /{location_id}), Authorization = DOORDASH_WEBHOOK_SECRET.
// Answers the same menu, hours and holidays a Publish would send, as DoorDash expects: { store, menus: [ ... ] }.
export async function GET(req: NextRequest, ctx: { params: Promise<{ locationId: string }> }) {
  if (!doorDashAdapter.verifyWebhook(req.headers, '')) return unauthorized('doordash');
  const { locationId } = await ctx.params;
  const repo = getRepo();
  const store = await repo.findStore('doordash', decodeURIComponent(locationId));
  if (!store) return NextResponse.json({ error: `Unknown location_id ${locationId} — map it under Food Hub → Stores → Mapping.` }, { status: 404 });
  const menu = await repo.getMenu(store.brandName);
  if (!menu || !menu.items.length) return NextResponse.json({ error: `No menu saved for ${store.brandName} yet.` }, { status: 404 });
  const languages = await getMenuLanguages();
  const publish = { ...(await publishContext(store.brandName, store.locationCode, await getHours())), language: languages.doordash };
  const { reference: _reference, store: storeRef, ...menuBody } = toDoorDashMenu(menuForLocation(menu, store.locationCode), store.channelStoreId, process.env.DOORDASH_PROVIDER_TYPE || '', `takatak-${store.channelStoreId}-pull`, publish);
  const menuId = typeof store.meta?.doordashMenuId === 'string' ? store.meta.doordashMenuId : undefined;
  return NextResponse.json({ store: storeRef, menus: [{ ...(menuId ? { id: menuId } : {}), ...menuBody }] });
}
