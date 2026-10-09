import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { menuWithAlcoholRules } from '@/lib/foodhub/alcohol/rules';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { isMenuLocked } from '@/lib/foodhub/menu/lock';
import { getBrandMenu } from '@/lib/foodhub/menu/shared';
import { toDoorDashItemPolling } from '@/lib/foodhub/menu/translate';
import { menuForLocation } from '@/lib/foodhub/ops';
import { getRepo } from '@/lib/foodhub/repo';
import { unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// DoorDash "Automatic Item Availability Polling" (certification: required). DoorDash calls, after each menu pull or
// push:  GET https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/item-polling/{location_id}
// where location_id is the store's merchant_supplied_id. Developer Portal → Webhook subscriptions → event type
// "Item Polling" (or ask DoorDash support / the TAM to add it) → URL https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/item-polling
// (DoorDash appends /{location_id}), Authorization = DOORDASH_WEBHOOK_SECRET.
// Answer: the 86'd items and options only, [{ merchant_supplied_id, is_active: false, type: "item" | "item_option" }];
// [] = everything in stock. DoorDash only DEACTIVATES from this answer: Food Hub still pushes every 86 / back-in-stock
// in real time (setItemAvailability), and polling catches what a lost push missed.
export async function GET(req: NextRequest, ctx: { params: Promise<{ locationId: string }> }) {
  if (!doorDashAdapter.verifyWebhook(req.headers, '')) return unauthorized('doordash');
  const { locationId } = await ctx.params;
  const store = await getRepo().findStore('doordash', decodeURIComponent(locationId));
  if (!store || isRelayStore(store)) return NextResponse.json({ error: `Unknown location_id ${locationId} — map it under Food Hub → Stores → Mapping.` }, { status: 404 });
  // A locked store's menu is managed outside Food Hub: never answer for it (an answer could 86 its items).
  if (isMenuLocked(store)) return NextResponse.json({ error: `The menu of location_id ${locationId} is managed outside Food Hub (locked).` }, { status: 409 });
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return NextResponse.json({ error: `No menu saved for ${store.brandName} yet.` }, { status: 404 });
  // The same location menu publishMenu sends (86 at this location, alcohol rules for DoorDash).
  const local = await menuWithAlcoholRules(menuForLocation(menu, store.locationCode), store.locationCode, 'doordash');
  const off = toDoorDashItemPolling(local);
  // Logged so the polling request/answer can be shown next to DoorDash's event logs (certification evidence).
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'item_availability', action: 'item_polling', status: 'info', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash polled item availability for ${store.brandName} · ${store.locationCode}: ${off.length ? `${off.filter((o) => o.type === 'item').length} item(s), ${off.filter((o) => o.type === 'item_option').length} option(s) off` : 'everything in stock'}`,
    detail: { off: off.map((o) => o.merchant_supplied_id).slice(0, 200) } });
  return NextResponse.json(off);
}
