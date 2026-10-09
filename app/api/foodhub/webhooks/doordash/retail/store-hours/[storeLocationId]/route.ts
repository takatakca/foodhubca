import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { doorDashStoreRefusal } from '@/lib/foodhub/doordash/guard';
import { doorDashRetailEnabled, storeHoursPullAnswer } from '@/lib/foodhub/doordash/retail';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { getRepo } from '@/lib/foodhub/repo';
import { unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// DoorDash Marketplace for Retailers "Store Hours Pull": DoorDash calls
//   GET https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/retail/store-hours/{store_location_id}
// (event "Store Hours Pull", URL …/retail/store-hours, Authorization = DOORDASH_WEBHOOK_SECRET; DoorDash appends the id).
// The answer is the Store model — every regular and special (holiday) hour; DoorDash replaces the store's hours with it.
export async function GET(req: NextRequest, ctx: { params: Promise<{ storeLocationId: string }> }) {
  if (!doorDashAdapter.verifyWebhook(req.headers, '')) return unauthorized('doordash');
  const { storeLocationId } = await ctx.params;
  const id = decodeURIComponent(storeLocationId);
  if (!doorDashRetailEnabled() || !(await featureOn('retail'))) return NextResponse.json({ error: 'Retail is not switched on in Food Hub.' }, { status: 404 });
  const store = await getRepo().findStore('doordash', id);
  if (!store) return NextResponse.json({ error: `Unknown store_location_id ${id} — map it under Food Hub → Stores → Mapping.` }, { status: 404 });
  const refused = doorDashStoreRefusal(store, 'menu');
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });
  const answer = await storeHoursPullAnswer(id, store.brandName, store.locationCode);
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'hours', action: 'retail_store_hours_pull', status: 'info', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash pulled the store hours of ${store.brandName} · ${store.locationCode}: ${answer.open_hours.length} regular, ${answer.special_hours.length} special` });
  return NextResponse.json(answer);
}
