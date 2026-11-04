import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog, type Catalog } from '@/lib/foodhub/catalog';
import { buildOrganizationView } from '@/lib/foodhub/organization-view';
import { getRepo } from '@/lib/foodhub/repo';
import { isOwnerTenant, tenantInfo } from '@/lib/foodhub/tenant';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// No tenant, merchant or location parameter can widen this request. Existing staff/session authorization is reused.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const repo = getRepo();
  const tenant = tenantInfo();
  const [catalog, persistedCatalog, stores] = await Promise.all([
    getCatalog({ strict: true }), repo.getKv<Partial<Catalog>>('catalog'), repo.listStores(),
  ]);
  return NextResponse.json({ ok: true, ...buildOrganizationView({
    tenantId: tenant.id, ownerTenant: isOwnerTenant(), catalog, persistedCatalog, stores,
    allowedLocations: actor.locations, mode: repo.mode, controlPlaneConfigured: tenant.controlPlane.configured,
  }) }, { headers: { 'Cache-Control': 'no-store', Vary: 'Cookie, Authorization' } });
});
