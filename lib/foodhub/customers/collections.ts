import crypto from 'node:crypto';
import { updateCustomer } from './store';
import type { CustomerAddress, MasterCustomer } from './types';

export const collectionRevision = (value: unknown[]) => crypto.createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest('hex');
type Replacement = { field: 'addresses'; value: CustomerAddress[] } | { field: 'favourites'; value: string[] };
class CollectionChanged extends Error {
  constructor(public current: MasterCustomer) { super('collection_changed'); }
}
class SessionChanged extends Error {}

/** Optional revisions preserve the legacy replace contract while preventing stale modern-client writes. */
export async function replaceCollection(customer: MasterCustomer, replacement: Replacement, expected: unknown) {
  if (expected !== undefined && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) {
    return { status: 422, body: { ok: false, error: 'Invalid saved-list revision.' } };
  }
  const revisionField = replacement.field === 'addresses' ? 'addressesRevision' : 'favouritesRevision';
  try {
    const next = await updateCustomer(customer.id, (cur) => {
      if (cur.tokenVersion !== customer.tokenVersion) throw new SessionChanged();
      if (expected !== undefined && collectionRevision(cur[replacement.field]) !== expected) throw new CollectionChanged(cur);
      return replacement.field === 'addresses' ? { ...cur, addresses: replacement.value } : { ...cur, favourites: replacement.value };
    });
    return next
      ? { status: 200, body: { ok: true, [replacement.field]: next[replacement.field], [revisionField]: collectionRevision(next[replacement.field]) } }
      : { status: 401, body: { ok: false, error: 'Customer not found.' } };
  } catch (error) {
    if (error instanceof CollectionChanged) {
      const value = error.current[replacement.field];
      return { status: 409, body: { ok: false, error: 'collection_changed', [replacement.field]: value, [revisionField]: collectionRevision(value) } };
    }
    if (error instanceof SessionChanged) return { status: 401, body: { ok: false, error: 'Sign in again.' } };
    throw error;
  }
}
