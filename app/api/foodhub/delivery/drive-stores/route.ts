import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { driveBusinessId, getDriveStores, registerDriveStores } from '@/lib/foodhub/delivery/doordash-drive';
import { fail, ok } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DoorDash Drive: one Drive store per kitchen (Business + Store APIs), so quotes and deliveries send
// pickup_external_business_id + pickup_external_store_id (required with more than one location).
export const GET = withPerm('view', async () => ok({ businessId: driveBusinessId(), registry: await getDriveStores() }));

export const POST = withPerm('stores:map', async (_req, _ctx, actor) => {
  const kitchens = (await getCatalog()).locations.filter((l) => l.active);
  if (!kitchens.length) return fail('No active kitchen in Brands & Locations.');
  const res = await registerDriveStores(kitchens.map((l) => ({ code: l.code, name: l.name, address: l.address, city: l.city, postalCode: l.postalCode, phone: l.phone })));
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'drive_stores_registered', status: res.ok ? 'success' : 'failed', summary: res.message, detail: { rows: res.rows } });
  return res.rows.length ? ok({ ...res, registry: await getDriveStores() }) : fail(res.message, 409);
});
