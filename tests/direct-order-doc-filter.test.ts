import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ db: false, calls: [] as Array<[string, ...unknown[]]>, pages: [] as unknown[][] }));
vi.mock('../lib/supabase/server', () => ({
  hasSupabaseEnv: () => h.db,
  createServiceClient: () => ({ from: (table: string) => {
    h.calls.push(['from', table]);
    const query = Object.fromEntries(['select', 'eq', 'order', 'range', 'gte', 'lt', 'contains', 'in', 'or'].map((method) => [method, (...args: unknown[]) => { h.calls.push([method, ...args]); return query; }])) as Record<string, unknown> & { then: (resolve: (value: unknown) => unknown) => unknown };
    query.then = (resolve) => resolve({ data: h.pages.shift() ?? [], error: null });
    return query;
  } }),
}));
import { DOC_REVIEW_PATHS, getRepo } from '../lib/foodhub/repo';

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  h.db = false; h.calls = []; h.pages = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('direct-order document filter parity', () => {
  it('scopes memory documents before the limit, including source-ref keys that are not location codes', async () => {
    const repo = getRepo();
    await repo.putDocs('filter-proof', [
      { id: 'owned', key: 'website:source', at: '2026-11-03', data: { locationCode: 'OWN' } },
      { id: 'foreign', key: 'OTHER', at: '2026-11-04', data: { locationCode: 'OTHER' } },
    ]);
    expect((await repo.listDocs('filter-proof', { dataLocationCodes: ['OWN'], limit: 1 })).map((doc) => doc.id)).toEqual(['owned']);
    expect(await repo.listDocs('filter-proof', { dataLocationCodes: [] })).toEqual([]);
  });
  it('matches non-null JSON presence, not truthiness, for the fixed review paths', async () => {
    const repo = getRepo();
    const fixtures = [
      { id: 'absent', data: {} }, { id: 'null', data: { attention: null, paylink: null } },
      { id: 'blank', data: { attention: '' } }, { id: 'array', data: { paylink: { extraPayments: [] } } },
      { id: 'flag', data: { paylink: { flag: 'review' } } }, { id: 'late', data: { interac: { lateTransfers: [] } } },
    ];
    await repo.putDocs<Record<string, unknown>>('filter-proof', fixtures);
    expect((await repo.listDocs('filter-proof', { dataAnyPresent: [...DOC_REVIEW_PATHS] })).map((doc) => doc.id).sort()).toEqual(['array', 'blank', 'flag', 'late']);
    expect((await repo.listDocs('filter-proof', { ids: ['absent', 'flag'] })).map((doc) => doc.id).sort()).toEqual(['absent', 'flag']);
    expect(await repo.listDocs('filter-proof', { ids: [] })).toEqual([]);
  });
  it.each([false, true])('rejects unsafe filters in memory/database mode (database=%s)', async (db) => {
    h.db = db; vi.stubEnv('FOODHUB_FORCE_MEMORY', db ? 'false' : 'true');
    const repo = getRepo();
    await expect(repo.listDocs('filter-proof', { dataAnyPresent: ['customer.phone'] as never })).rejects.toThrow('Invalid document review filter');
    await expect(repo.listDocs('filter-proof', { dataAnyPresent: ['attention.not.is.null'] as never })).rejects.toThrow('Invalid document review filter');
    await expect(repo.listDocs('filter-proof', { dataLocationCodes: ['OWN\u0000OTHER'] })).rejects.toThrow('Invalid document location filter');
    await expect(repo.listDocs('filter-proof', { ids: Array(501).fill('too-many') })).rejects.toThrow('Invalid document id filter');
    expect(h.calls).toEqual([]);
  });
  it('applies the same location/presence/id predicates in every bounded database page', async () => {
    h.db = true; vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    h.pages = [Array.from({ length: 1000 }, (_, i) => ({ id: `doc-${i}`, key: null, at: '2026-11-04', data: { locationCode: 'OWN' } })), [{ id: 'doc-1000', key: null, at: '2026-11-03', data: { locationCode: 'OWN' } }]];
    const rows = await getRepo().listDocs('filter-proof', { dataLocationCodes: ['OWN'], dataAnyPresent: [...DOC_REVIEW_PATHS], dataEquals: { status: 'awaiting_payment' }, since: '2026-10-01', limit: 1001 });
    expect(rows).toHaveLength(1001);
    expect(h.calls.filter(([method]) => method === 'range')).toEqual([['range', 0, 999], ['range', 1000, 1000]]);
    expect(h.calls.filter(([method]) => method === 'in')).toEqual([['in', 'data->>locationCode', ['OWN']], ['in', 'data->>locationCode', ['OWN']]]);
    expect(h.calls.filter(([method]) => method === 'or')).toEqual(Array(2).fill(['or', 'data->>attention.not.is.null,data->paylink->>flag.not.is.null,data->paylink->>extraPayments.not.is.null,data->interac->>lateTransfers.not.is.null']));
    expect(h.calls.filter(([method]) => method === 'contains')).toEqual(Array(2).fill(['contains', 'data', { status: 'awaiting_payment' }]));
    h.calls = [];
    await getRepo().listDocs('filter-proof', { ids: ['delivery-1'], limit: 1 });
    expect(h.calls).toContainEqual(['in', 'id', ['delivery-1']]);
  });
  it('does not turn explicit empty database scope/id lists into an unrestricted query', async () => {
    h.db = true; vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    expect(await getRepo().listDocs('filter-proof', { ids: [] })).toEqual([]);
    expect(await getRepo().listDocs('filter-proof', { dataLocationCodes: [] })).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});
