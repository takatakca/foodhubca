import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepo } from '../lib/foodhub/repo';
import { collectionRevision, replaceCollection } from '../lib/foodhub/customers/collections';
import { anonymiseCustomer, CUSTOMERS, getCustomer, updateCustomer, upsertVerifiedCustomer } from '../lib/foodhub/customers/store';
import type { MasterCustomer } from '../lib/foodhub/customers/types';

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const create = () => upsertVerifiedCustomer({ phone: '+15145550142', tenant: 'on2go' });

describe('durable customer update contract', () => {
  it('rejects an observed stale version even after another worker restores the same JSON data', async () => {
    const repo = getRepo();
    await repo.putDocs('cas-version', [{ id: 'x', data: { value: 'original' } }]);
    const before = (await repo.getDoc('cas-version', 'x'))!;
    expect(before.updatedAt).toEqual(expect.any(String));
    expect(await repo.compareAndSwapDoc('cas-version', before, { ...before, data: { value: 'temporary' } })).toBe(true);
    const middle = (await repo.getDoc('cas-version', 'x'))!;
    expect(await repo.compareAndSwapDoc('cas-version', middle, { ...middle, data: before.data })).toBe(true);
    expect(await repo.compareAndSwapDoc('cas-version', before, { ...before, data: { stale: true } })).toBe(false);
    expect((await repo.getDoc('cas-version', 'x'))?.data).toEqual(before.data);
    expect((await repo.listDocs('cas-version'))[0]).not.toHaveProperty('updatedAt');
  });
  it('uses JSON object semantics for memory CAS and collection revisions, preserving array order', async () => {
    const repo = getRepo();
    await repo.putDocs('cas-test', [{ id: 'x', data: { a: 1, b: { x: 2, y: 3 } } }]);
    expect(await repo.compareAndSwapDoc('cas-test', { id: 'x', data: { b: { y: 3, x: 2 }, a: 1 } }, { id: 'x', data: { result: true } })).toBe(true);
    expect(await repo.compareAndSwapDoc('cas-test', { id: 'missing', data: {} }, { id: 'missing', data: {} })).toBe(false);
    await repo.setKv('claim-test', { a: 1, b: 2 });
    expect(await repo.compareAndSwapKv('claim-test', { b: 2, a: 1 }, { id: 'winner' })).toBe(true);
    expect(await repo.compareAndSwapKv('claim-test', { a: 1, b: 2 }, { id: 'loser' })).toBe(false);
    expect(collectionRevision([{ street: 'X', city: 'Y' }])).toBe(collectionRevision([{ city: 'Y', street: 'X' }]));
    expect(collectionRevision(['a', 'b'])).not.toBe(collectionRevision(['b', 'a']));
  });
  it('reapplies a profile patch to a competing worker’s newer data instead of losing its favourites', async () => {
    const { customer } = await create();
    const repo = getRepo();
    vi.spyOn(repo, 'compareAndSwapDoc').mockImplementationOnce(async (collection, expected) => {
      const data = expected.data as MasterCustomer;
      await repo.putDocs(collection, [{ ...expected, data: { ...data, favourites: ['other-worker'] } }]);
      return false;
    });
    const next = await updateCustomer(customer.id, (cur) => ({ ...cur, name: 'Profile edit' }));
    expect(next).toMatchObject({ name: 'Profile edit', favourites: ['other-worker'] });
  });
  it('returns a list conflict if another worker changes the same list after the first read', async () => {
    const { customer } = await create();
    const repo = getRepo();
    vi.spyOn(repo, 'compareAndSwapDoc').mockImplementationOnce(async (collection, expected) => {
      await repo.putDocs(collection, [{ ...expected, data: { ...(expected.data as MasterCustomer), favourites: ['other-worker'] } }]);
      return false;
    });
    const result = await replaceCollection(customer, { field: 'favourites', value: ['this-worker'] }, collectionRevision([]));
    expect(result).toMatchObject({ status: 409, body: { error: 'collection_changed', favourites: ['other-worker'] } });
    expect((await getCustomer(customer.id))?.favourites).toEqual(['other-worker']);
  });
  it('cannot resurrect a profile anonymised between its read and write', async () => {
    const { customer } = await create();
    const repo = getRepo();
    vi.spyOn(repo, 'compareAndSwapDoc').mockImplementationOnce(async (collection, expected) => {
      await repo.putDocs(collection, [{ ...expected, key: 'deleted', data: { ...(expected.data as MasterCustomer), deletedAt: new Date().toISOString(), phone: '', name: undefined, favourites: [], addresses: [] } }]);
      return false;
    });
    expect(await updateCustomer(customer.id, (cur) => ({ ...cur, name: 'Must not return' }))).toBeNull();
    expect((await getCustomer(customer.id))?.name).toBeUndefined();
  });
  it('fails closed when the unique phone claim cannot be stored', async () => {
    const repo = getRepo();
    vi.spyOn(repo, 'claimKv').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(create()).rejects.toThrow('storage unavailable');
    expect(await repo.listDocs(CUSTOMERS)).toEqual([]);
  });
  it('does not steal a phone claim while its winning worker is still creating the customer', async () => {
    const repo = getRepo(); let phoneClaim = '';
    vi.spyOn(repo, 'claimKv').mockImplementationOnce(async (key) => {
      phoneClaim = key; await repo.setKv(key, { id: 'cus_pending_winner' }); return false;
    });
    await expect(create()).rejects.toThrow('in progress');
    expect(await repo.getKv(phoneClaim)).toEqual({ id: 'cus_pending_winner' });
    expect(await repo.listDocs(CUSTOMERS)).toEqual([]);
  });
  it('clears a deleted identity’s phone claim conditionally and allows a newly verified identity', async () => {
    const first = await create();
    await anonymiseCustomer(first.customer.id);
    const second = await create();
    expect(second.created).toBe(true);
    expect(second.customer.id).not.toBe(first.customer.id);
    expect((await getCustomer(first.customer.id))?.deletedAt).toBeTruthy();
  });
  it('anonymises through CAS using the latest token version after another worker changes the profile', async () => {
    const { customer } = await create();
    const repo = getRepo();
    vi.spyOn(repo, 'compareAndSwapDoc').mockImplementationOnce(async (collection, expected) => {
      const data = expected.data as MasterCustomer;
      await repo.putDocs(collection, [{ ...expected, data: { ...data, name: 'Other worker', tokenVersion: data.tokenVersion + 1 } }]);
      return false;
    });
    expect(await anonymiseCustomer(customer.id)).toMatchObject({ deletedAt: expect.any(String), tokenVersion: customer.tokenVersion + 2, phone: '', addresses: [], favourites: [] });
    expect((await getCustomer(customer.id))?.name).toBeUndefined();
  });
});
