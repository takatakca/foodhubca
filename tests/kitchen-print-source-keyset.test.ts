import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  { table: 'fh_orders', column: 'created_at', boundary: '00000000-0000-4000-8000-000000001000' },
  { table: 'fh_docs', column: 'at', boundary: 'm"\\,(document)' },
] as const)('does not skip an unread $table row when an earlier row leaves the filter', async ({ table, column, boundary }) => {
  vi.resetModules();
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-print-repo-fixture-key');
  const at = '2026-11-28T07:50:00.123456+00:00';
  const unread = table === 'fh_orders' ? '00000000-0000-4000-8000-000000001001' : 'z-unread';
  const row = (id: string) => ({ id, [column]: at, status: 'new', data: { locationCode: 'NDG' } });
  let rows = [...Array.from({ length: 999 }, (_, i) => row(String(i + 1).padStart(4, '0'))), row(boundary), row(unread)];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.pathname).toBe(`/rest/v1/${table}`);
    expect(url.searchParams.get('limit')).toBe('1000');
    if (fetch.mock.calls.length === 1) {
      const first = rows.slice(0, 1000);
      rows = rows.slice(1);
      return Response.json(first);
    }
    const keyset = url.searchParams.get('or');
    if (!keyset) return Response.json(rows.slice(Number(url.searchParams.get('offset')), 2000));
    expect(url.searchParams.has('offset')).toBe(false);
    expect(keyset).toBe(`(${column}.lt.${JSON.stringify(at)},and(${column}.eq.${JSON.stringify(at)},id.gt.${JSON.stringify(boundary)}))`);
    return Response.json(rows.slice(rows.findIndex((x) => x.id === boundary) + 1));
  });
  vi.stubGlobal('fetch', fetch);
  const { getRepo } = await import('../lib/foodhub/repo');
  const repo = getRepo();
  const filter = { since: '2026-11-27T08:00:00Z', until: '2026-11-28T08:00:00Z', limit: Number.POSITIVE_INFINITY };
  const result = table === 'fh_orders'
    ? await repo.listOrders({ ...filter, locationCodes: ['NDG'], statuses: ['new'] })
    : await repo.listDocs('direct_orders', { ...filter, locationCode: 'NDG' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result).toHaveLength(1001);
  expect(result.at(-1)?.id).toBe(unread);
});
