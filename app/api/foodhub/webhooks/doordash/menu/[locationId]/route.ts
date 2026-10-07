import { NextResponse, type NextRequest } from 'next/server';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { isRelayStore } from '@/lib/foodhub/adapters/relay';
import { getHours, publishContext } from '@/lib/foodhub/hours';
import { getMenuLanguages } from '@/lib/foodhub/menu/language';
import { getBrandMenu } from '@/lib/foodhub/menu/shared';
import { toDoorDashMenu } from '@/lib/foodhub/menu/translate';
import { menuForLocation } from '@/lib/foodhub/ops';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// DoorDash "Menu Request" (menu pull): GET /api/foodhub/webhooks/doordash/menu/<location id>, where the location id is
// the store's merchant_supplied_id. DoorDash calls it to onboard a store or refresh its menu, with the same
// Authorization header as the other DoorDash webhooks. The answer is the store's current menu (its brand's menu, or the
// menu that brand shares), with hours, holidays and today's 86s — the same payload Food Hub POSTs when it publishes —
// as an array, carrying DoorDash's menu id when Food Hub knows it (so DoorDash updates that menu).
export async function GET(req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  if (!doorDashAdapter.verifyWebhook(req.headers, '')) return NextResponse.json({ ok: false, error: 'Webhook token check failed for DoorDash.' }, { status: 401 });
  const { locationId } = await params;
  const store = await getRepo().findStore('doordash', decodeURIComponent(locationId));
  if (!store || isRelayStore(store)) return NextResponse.json({ ok: false, error: `No DoorDash store ${locationId} is mapped in Food Hub.` }, { status: 404 });
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return NextResponse.json({ ok: false, error: `No menu saved for ${store.brandName}.` }, { status: 404 });
  const ctx = { ...(await publishContext(store.brandName, store.locationCode, await getHours())), language: (await getMenuLanguages()).doordash };
  const body = toDoorDashMenu(menuForLocation(menu, store.locationCode), store.channelStoreId, process.env.DOORDASH_PROVIDER_TYPE || '', `takatak-${store.channelStoreId}-${Date.now()}`, ctx);
  const menuId = typeof store.meta?.doordashMenuId === 'string' ? store.meta.doordashMenuId : null;
  return NextResponse.json([{ ...body, ...(menuId ? { id: menuId } : {}) }]);
}
