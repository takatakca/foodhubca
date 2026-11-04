import { describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]> }));
vi.mock('../lib/supabase/server', () => ({
  hasSupabaseEnv: () => true,
  createServiceClient: () => ({ from: (table: string) => {
    fixture.calls.push(['from', table]);
    const q = Object.fromEntries(['select', 'order', 'range', 'in', 'gte', 'lt'].map((method) => [method, (...args: unknown[]) => { fixture.calls.push([method, ...args]); return q; }])) as Record<string, unknown> & { then: (resolve: (v: unknown) => unknown) => unknown };
    q.then = (resolve) => resolve({ data: [], error: null });
    return q;
  } }),
}));
describe('database order scope pushdown', () => {
  it('includes status, kitchen, provider and brand in the bounded database query', async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    try {
      const { getRepo } = await import('../lib/foodhub/repo');
      const rows = await getRepo().listOrders({ limit: 12, statuses: ['accepted'], locationCodes: ['NDG'], channels: ['uber_eats'], brands: ['Alpha'], since: '2026-11-04', until: '2026-11-05' });
      expect(rows).toEqual([]);
      expect(fixture.calls).toContainEqual(['range', 0, 11]);
      for (const entry of [['status', ['accepted']], ['location_code', ['NDG']], ['channel', ['uber_eats']], ['brand_name', ['Alpha']]]) expect(fixture.calls).toContainEqual(['in', ...entry]);
      expect(fixture.calls).toContainEqual(['gte', 'created_at', '2026-11-04']);
      expect(fixture.calls).toContainEqual(['lt', 'created_at', '2026-11-05']);
    } finally { vi.unstubAllEnvs(); }
  });
});
