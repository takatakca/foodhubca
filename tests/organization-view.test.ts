import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrganizationView, type OrganizationViewInput } from '@/lib/foodhub/organization-view';
import type { Catalog } from '@/lib/foodhub/catalog';
import { hashPassword } from '@/lib/foodhub/auth';

const catalog: Catalog = {
  brands: [{ name: 'Pizza', active: true, seed: true }, { name: 'Pita', active: true }, { name: 'Unassigned', active: false }],
  locations: [{ code: 'A', name: 'Kitchen A', address: 'private address A', active: true, seed: true }, { code: 'B', name: 'Kitchen B', address: 'private address B', active: true }],
};
const input = (patch: Partial<OrganizationViewInput> = {}): OrganizationViewInput => ({
  tenantId: 'takatak', ownerTenant: true, catalog, persistedCatalog: null,
  stores: [
    { id: 's1', channel: 'doordash', brandName: 'Pizza', locationCode: 'A', cloverMerchantId: 'private-merchant' },
    { id: 's2', channel: 'uber_eats', brandName: 'Pita', locationCode: 'A', cloverMerchantId: 'private-merchant' },
    { id: 's3', channel: 'skip', brandName: 'Pizza', locationCode: 'B', cloverMerchantId: 'other-merchant' },
  ],
  allowedLocations: [], mode: 'supabase', controlPlaneConfigured: false, ...patch,
});

describe('organization projection', () => {
  it('represents a kitchen hosting several brands and a brand operating several kitchens', () => {
    const view = buildOrganizationView(input());
    expect(view.locations.find((location) => location.code === 'A')?.brands).toEqual(['Pita', 'Pizza']);
    expect(view.brands.find((brand) => brand.name === 'Pizza')?.locations.map((location) => location.code)).toEqual(['A', 'B']);
    expect(view.totals).toEqual({ brands: 3, locations: 2, mappedStores: 3, mappedCloverMerchants: 2 });
    expect(view.mapping.unassignedBrands).toEqual(['Unassigned']);
    expect(JSON.stringify(view)).not.toMatch(/private-merchant|other-merchant|private address|channelStoreId|autoAccept/);
  });

  it('filters a location-restricted viewer before calculating brands, stores and merchant totals', () => {
    const view = buildOrganizationView(input({ allowedLocations: ['B'] }));
    expect(view.locations.map((location) => location.code)).toEqual(['B']);
    expect(view.brands.map((brand) => brand.name)).toEqual(['Pizza']);
    expect(view.totals).toEqual({ brands: 1, locations: 1, mappedStores: 1, mappedCloverMerchants: 1 });
    expect(view.mapping.unassignedBrands).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('Pita');
  });

  it('does not widen an unknown or unmapped location assignment into all locations', () => {
    const view = buildOrganizationView(input({ allowedLocations: ['UNKNOWN'] }));
    expect(view.locations).toEqual([]);
    expect(view.brands).toEqual([]);
    expect(view.totals.mappedStores).toBe(0);
  });

  it('uses only actual persisted catalog membership on another instance and retains a custom seed-name collision', () => {
    const saved: Catalog = { brands: [{ name: 'Pizza', active: true }], locations: [{ code: 'A', name: 'Client kitchen', address: 'client address', active: true }] };
    const view = buildOrganizationView(input({ tenantId: 'client-two', ownerTenant: false, persistedCatalog: saved }));
    expect(view.organization.id).toBe('client-two');
    expect(view.locations).toEqual([{ code: 'A', name: 'Client kitchen', active: true, brands: ['Pizza'], mappedStores: 1 }]);
    expect(view.brands.map((brand) => brand.name)).toEqual(['Pizza']);
    expect(JSON.stringify(view)).not.toMatch(/Pita|Kitchen A|Kitchen B|Unassigned/);
    expect(buildOrganizationView(input({ ownerTenant: false })).brands).toEqual([]);
  });

  it('preserves foreign custom mappings and restricts their user to assigned kitchens', () => {
    const saved: Catalog = { brands: [{ name: 'Client brand', active: true }, { name: 'Hidden brand', active: true }], locations: [{ code: 'C', name: 'Client kitchen', address: '', active: true }, { code: 'D', name: 'Other kitchen', address: '', active: true }] };
    const view = buildOrganizationView(input({ tenantId: 'client-two', ownerTenant: false, persistedCatalog: saved, allowedLocations: ['C'], stores: [
      { id: 'custom', channel: 'skip', brandName: 'Client brand', locationCode: 'C' },
      { id: 'hidden', channel: 'skip', brandName: 'Hidden brand', locationCode: 'D' },
      { id: 'owner', channel: 'skip', brandName: 'Pizza', locationCode: 'A' },
    ] }));
    expect(view.brands.map((brand) => brand.name)).toEqual(['Client brand']);
    expect(view.totals.mappedStores).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/Hidden brand|Pizza|Other kitchen/);
  });

  it('does not invent V1 IDs, provider readiness or distributed tenant isolation from configuration presence', () => {
    const view = buildOrganizationView(input({ mode: 'memory', controlPlaneConfigured: true }));
    expect(view.organization).toEqual({ id: 'takatak', ownershipModel: 'single_instance', identityAuthority: 'takatak-v1', externalClientId: null, externalLinkStatus: 'unlinked' });
    expect(view.readiness).toEqual({ persistence: 'memory_only', controlPlane: 'configuration_present', identitySynchronization: 'not_verified', providerAcceptance: 'not_verified', tenantIsolation: 'single_instance' });
  });

  it('ignores duplicate store rows and reports only invalid mappings inside visible locations', () => {
    const initial = input();
    const view = buildOrganizationView(input({ allowedLocations: ['A'], stores: [...initial.stores, initial.stores[0],
      { id: 'bad', channel: 'skip', brandName: 'Unknown', locationCode: 'A' },
      { id: 'hidden-bad', channel: 'skip', brandName: 'Hidden', locationCode: 'B' },
    ] }));
    expect(view.totals.mappedStores).toBe(2);
    expect(view.mapping.invalidMappingsAtVisibleLocations).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/Unknown|Hidden/);
  });
});

const routeState = vi.hoisted(() => ({ failStores: false, strict: false, passwordHash: '' }));
vi.mock('@/lib/foodhub/catalog', () => ({ getCatalog: async (options: { strict?: boolean }) => { routeState.strict = options.strict === true; return catalog; } }));
vi.mock('@/lib/foodhub/repo', () => ({ getRepo: () => ({ mode: 'supabase', getKv: async () => null,
  getUser: async (username: string) => username === 'organization-manager' ? { username, name: 'Test manager', role: 'manager', locations: ['B'], active: true, passwordHash: routeState.passwordHash } : null,
  listStores: async () => { if (routeState.failStores) throw new Error('Supabase: database unavailable'); return input().stores; },
}) }));
vi.mock('@/lib/foodhub/tenant', () => ({ isOwnerTenant: () => true, tenantInfo: () => ({ id: 'server-tenant', controlPlane: { configured: false } }) }));
const managerRequest = (query = '') => new Request(`https://foodhub.example/api/foodhub/organization${query}`, {
  headers: { Authorization: `Basic ${Buffer.from('organization-manager:isolated-org-test-password').toString('base64')}` },
});

describe('organization GET contract', () => {
  beforeEach(() => { routeState.failStores = false; routeState.strict = false; routeState.passwordHash = hashPassword('isolated-org-test-password'); });

  it('uses the actual existing authentication guard, denying anonymous requests', async () => {
    const { GET } = await import('@/app/api/foodhub/organization/route');
    expect((await GET(new Request('https://foodhub.example/api/foodhub/organization'), undefined)).status).toBe(401);
  });

  it('takes tenant and location authorization only from server context and disables caching', async () => {
    const { GET } = await import('@/app/api/foodhub/organization/route');
    const response = await GET(managerRequest('?tenant=foreign&locations=A'), undefined);
    const data = await response.json();
    expect(data.organization.id).toBe('server-tenant');
    expect(data.locations.map((location: { code: string }) => location.code)).toEqual(['B']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(routeState.strict).toBe(true);
  });

  it('fails a storage read instead of presenting a successful empty organization', async () => {
    routeState.failStores = true;
    const { GET } = await import('@/app/api/foodhub/organization/route');
    expect((await GET(managerRequest(), undefined)).status).toBe(500);
  });
});
