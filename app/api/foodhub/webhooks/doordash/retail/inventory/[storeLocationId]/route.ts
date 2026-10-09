import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { decideAlcohol } from '@/lib/foodhub/alcohol/rules';
import { doorDashAdapter } from '@/lib/foodhub/adapters/doordash';
import { doorDashStoreRefusal } from '@/lib/foodhub/doordash/guard';
import { doorDashRetailEnabled, inventoryPullAnswer } from '@/lib/foodhub/doordash/retail';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { listProducts } from '@/lib/foodhub/retail/catalog';
import { getRepo } from '@/lib/foodhub/repo';
import { unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';

// DoorDash Marketplace for Retailers "Full Inventory Pull": after we create a pull job (POST /api/v2/jobs, createRetailPullJob),
// DoorDash calls  GET https://YOUR-DOMAIN/api/foodhub/webhooks/doordash/retail/inventory/{store_location_id}[?page_num=n]
// (Developer Portal → Webhook subscriptions → event "Full Inventory Pull", URL …/retail/inventory/%s, Authorization =
// DOORDASH_WEBHOOK_SECRET). The answer replaces the store's whole inventory: every product, active or not.
export async function GET(req: NextRequest, ctx: { params: Promise<{ storeLocationId: string }> }) {
  if (!doorDashAdapter.verifyWebhook(req.headers, '')) return unauthorized('doordash');
  const { storeLocationId } = await ctx.params;
  const id = decodeURIComponent(storeLocationId);
  if (!doorDashRetailEnabled() || !(await featureOn('retail'))) return NextResponse.json({ error: 'Retail is not switched on in Food Hub.' }, { status: 404 });
  const store = await getRepo().findStore('doordash', id);
  if (!store) return NextResponse.json({ error: `Unknown store_location_id ${id} — map it under Food Hub → Stores → Mapping.` }, { status: 404 });
  // A protected / locked store is never answered: DoorDash would REPLACE its inventory with ours.
  const refused = doorDashStoreRefusal(store, 'menu');
  if (refused) return NextResponse.json({ error: refused }, { status: 409 });
  const page = new URL(req.url).searchParams.get('page_num');
  const alcohol = await decideAlcohol(store.locationCode, 'doordash', { ignoreHours: true });
  const answer = inventoryPullAnswer(await listProducts(), store.locationCode, alcohol.allowed, page === null ? undefined : Number(page) || 1);
  await logActivity({ actor: 'DoorDash', source: 'platform', kind: 'item_availability', action: 'retail_inventory_pull', status: 'info', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash pulled the retail inventory of ${store.brandName} · ${store.locationCode}: ${answer.items.length} item(s)${page ? ` (page ${page})` : ''}` });
  return NextResponse.json(answer);
}
