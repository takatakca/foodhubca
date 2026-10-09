import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { menuWithAlcoholRules } from '@/lib/foodhub/alcohol/rules';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { isMenuLocked, menuLockOf } from '@/lib/foodhub/menu/lock';
import { getHours, publishContext } from '@/lib/foodhub/hours';
import { getMenuLanguages } from '@/lib/foodhub/menu/language';
import { getBrandMenu } from '@/lib/foodhub/menu/shared';
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
  // A relay store ("relay:<id>") is not a DoorDash API store: it never receives a menu.
  if (!store || isRelayStore(store)) return NextResponse.json({ error: `Unknown location_id ${locationId} — map it under Food Hub → Stores → Mapping.` }, { status: 404 });
  // A locked store's menu is never sent, not even when DoorDash pulls it: DoorDash keeps the menu it already has.
  if (isMenuLocked(store)) {
    await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'menu_publish', action: 'menu_pull_refused', status: 'info', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
      summary: `DoorDash asked for the menu of ${store.brandName} · ${store.locationCode} — not sent: this store's menu is locked (${menuLockOf(store).reason ?? ''})` });
    return NextResponse.json({ error: `The menu of location_id ${locationId} is managed outside Food Hub (locked) — keep the current DoorDash menu.` }, { status: 409 });
  }
  // The menu this brand uses: its own, or the one it shares with other brands (under this brand's name).
  const menu = await getBrandMenu(store.brandName);
  if (!menu || !menu.items.length) return NextResponse.json({ error: `No menu saved for ${store.brandName} yet.` }, { status: 404 });
  const languages = await getMenuLanguages();
  const publish = { ...(await publishContext(store.brandName, store.locationCode, await getHours())), language: languages.doordash };
  // The same menu publishMenu sends: alcohol only where the permit and the alcohol rules allow DoorDash.
  const local = await menuWithAlcoholRules(menuForLocation(menu, store.locationCode), store.locationCode, 'doordash');
  const { reference: _reference, store: storeRef, ...menuBody } = toDoorDashMenu(local, store.channelStoreId, process.env.DOORDASH_PROVIDER_TYPE || '', `takatak-${store.channelStoreId}-pull`, publish);
  const menuId = typeof store.meta?.doordashMenuId === 'string' ? store.meta.doordashMenuId : undefined;
  return NextResponse.json({ store: storeRef, menus: [{ ...(menuId ? { id: menuId } : {}), ...menuBody }] });
}
