// Customer records in the generic fh_docs store (collection "customers"): one document per customer, found by id or by
// phone. The phone index key is a hash of the number (the raw number only lives inside the record's data).
// Creation is race-free: an in-process lock per phone (withKeyLock) plus an atomic claim in fh_kv (claimKv) across
// containers, so two verifications of the same number at the same instant end up on ONE record.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso } from '../config';
import { maskContact } from '../notify';
import { getRepo } from '../repo';
import { withKeyLock } from '../storefront/rate-limit';
import type { CustomerAddress, CustomerLang, MasterCustomer } from './types';

export const CUSTOMERS = 'customers';
const phoneKey = (phone: string) => `ph:${crypto.createHash('sha256').update(`customer|${phone}`).digest('hex').slice(0, 32)}`;
const claimKey = (phone: string) => `customer_phone:${phoneKey(phone)}`;

export function newCustomerId(): string {
  return `cus_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
}

export async function getCustomer(id: string): Promise<MasterCustomer | null> {
  if (!id) return null;
  return (await getRepo().getDoc<MasterCustomer>(CUSTOMERS, id))?.data ?? null;
}

/** The live (not deleted) customer behind a verified E.164 number. */
export async function findCustomerByPhone(phone: string): Promise<MasterCustomer | null> {
  const docs = await getRepo().listDocs<MasterCustomer>(CUSTOMERS, { keys: [phoneKey(phone)], limit: 10 });
  return docs.map((d) => d.data).find((c) => c.phone === phone && !c.deletedAt) ?? null;
}

/** Initial verified-record creation and isolated fixtures. Existing customer mutations use updateCustomer. */
export async function saveCustomer(c: MasterCustomer): Promise<MasterCustomer> {
  await getRepo().putDocs<MasterCustomer>(CUSTOMERS, [{ id: c.id, key: c.deletedAt ? 'deleted' : phoneKey(c.phone), at: c.createdAt, data: c }]);
  return c;
}

/** The local lock limits contention; the conditional database write also protects independent workers. */
export async function updateCustomer(id: string, patch: (cur: MasterCustomer) => MasterCustomer): Promise<MasterCustomer | null> {
  return withKeyLock(`cust_id:${id}`, async () => {
    const repo = getRepo();
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await repo.getDoc<MasterCustomer>(CUSTOMERS, id, { withVersion: true });
      if (!stored || stored.data.deletedAt) return null;
      const next = patch(JSON.parse(JSON.stringify(stored.data)) as MasterCustomer);
      if (next.id !== id) throw new Error('Customer identity cannot change.');
      if (await repo.compareAndSwapDoc(CUSTOMERS, stored, { id, key: next.deletedAt ? 'deleted' : phoneKey(next.phone), at: next.createdAt, data: next })) return next;
    }
    throw new Error('Customer changed during the update. Please try again.');
  });
}

/**
 * After a successful code check: the customer behind that number, created on the spot the first time. Also records
 * the brand website in tenants[], the language chosen on the site, and the verification time.
 */
export async function upsertVerifiedCustomer(input: { phone: string; tenant: string; lang?: CustomerLang; via?: 'text' | 'takatak' }): Promise<{ customer: MasterCustomer; created: boolean }> {
  const { phone, tenant } = input;
  const how = input.via === 'takatak' ? 'through TAKATAK' : 'by text';
  return withKeyLock(`cust_phone:${phoneKey(phone)}`, async () => {
    const repo = getRepo();
    const at = nowIso();
    const existing = await findCustomerByPhone(phone);
    if (existing) {
      const next = await updateCustomer(existing.id, (cur) => ({ ...cur, verifiedAt: at, lang: input.lang ?? cur.lang, tenants: cur.tenants.includes(tenant) ? cur.tenants : [...cur.tenants, tenant] }));
      if (!next) throw new Error('Customer changed during verification. Please try again.');
      await logActivity({ actor: tenant, source: 'api', kind: 'customer', action: 'customer_verified', status: 'success', summary: `Customer ${maskContact(phone)} verified ${how} on ${tenant}` });
      return { customer: next, created: false };
    }
    const fresh: MasterCustomer = {
      id: newCustomerId(), phone, tenants: [tenant], lang: input.lang ?? 'fr', marketingConsent: false, createdAt: at, verifiedAt: at, tokenVersion: 1, addresses: [], favourites: [],
    };
    // Cross-container race: the first claim wins; a loser takes the winner's record (or a stale pointer to a deleted one).
    const key = claimKey(phone);
    let won = await repo.claimKv(key, { id: fresh.id });
    for (let attempt = 0; !won && attempt < 8; attempt++) {
      const other = await repo.getKv<{ id?: string | null }>(key);
      if (!other || (other.id !== null && typeof other.id !== 'string')) throw new Error('Customer verification is temporarily unavailable.');
      const theirs = other?.id ? await getCustomer(other.id) : null;
      if (theirs && !theirs.deletedAt && theirs.phone === phone) {
        const next = await updateCustomer(theirs.id, (cur) => ({ ...cur, verifiedAt: at, lang: input.lang ?? cur.lang, tenants: cur.tenants.includes(tenant) ? cur.tenants : [...cur.tenants, tenant] }));
        if (!next) throw new Error('Customer changed during verification. Please try again.');
        return { customer: next, created: false };
      }
      // A winner may still be writing its record. Never steal that claim or create a second identity.
      if (other.id && !theirs) throw new Error('Customer verification is in progress. Please try again.');
      if (theirs && !theirs.deletedAt) throw new Error('Customer verification needs review.');
      won = await repo.compareAndSwapKv(key, other, { id: fresh.id });
    }
    if (!won) throw new Error('Customer changed during verification. Please try again.');
    await saveCustomer(fresh);
    await logActivity({ actor: tenant, source: 'api', kind: 'customer', action: 'customer_created', status: 'success', summary: `Customer account created for ${maskContact(phone)} (verified ${how} on ${tenant})` });
    return { customer: fresh, created: true };
  });
}

/** Logout: every token of that customer is void (contract § A.7). */
export async function bumpTokenVersion(id: string): Promise<MasterCustomer | null> {
  return updateCustomer(id, (c) => ({ ...c, tokenVersion: c.tokenVersion + 1 }));
}

/**
 * DELETE /me: the record is anonymised in place — phone, name, e-mail, addresses, favourites and consent are removed,
 * tokens are void, the id and dates stay (so order history keeps a stable owner id without any personal data).
 * The same number verifying again later starts a brand-new record.
 */
export async function anonymiseCustomer(id: string, by = 'customer'): Promise<MasterCustomer | null> {
  let phone = '';
  const gone = await updateCustomer(id, (cur) => {
    phone = cur.phone;
    const at = nowIso();
    return {
      id: cur.id, phone: '', tenants: cur.tenants, lang: cur.lang, marketingConsent: false, createdAt: cur.createdAt, verifiedAt: cur.verifiedAt,
      tokenVersion: cur.tokenVersion + 1, addresses: [], favourites: [], deletedAt: at,
    };
  });
  if (!gone) return null;
  // A newer verification may already own this number. Do not clear its claim.
  await getRepo().compareAndSwapKv(claimKey(phone), { id: gone.id }, { id: null });
  await logActivity({ actor: by, source: 'api', kind: 'customer', action: 'customer_deleted', status: 'success', summary: `Customer ${maskContact(phone)} deleted their account (record anonymised)` });
  return gone;
}

/** Newest first (by creation). Deleted records are left out unless asked. */
export async function listCustomers(opts: { limit?: number; includeDeleted?: boolean } = {}): Promise<MasterCustomer[]> {
  const docs = await getRepo().listDocs<MasterCustomer>(CUSTOMERS, { limit: opts.limit ?? 100_000 });
  const list = docs.map((d) => d.data);
  return opts.includeDeleted ? list : list.filter((c) => !c.deletedAt);
}

export async function countCustomers(): Promise<{ total: number; deleted: number }> {
  const all = await listCustomers({ includeDeleted: true });
  const deleted = all.filter((c) => c.deletedAt).length;
  return { total: all.length - deleted, deleted };
}

export function cleanAddress(raw: Partial<CustomerAddress> | null | undefined): CustomerAddress | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const street = s(raw.street, 120);
  const city = s(raw.city, 80);
  if (!street || !city) return null;
  const out: CustomerAddress = { street, city, province: s(raw.province, 30) || 'QC', postalCode: s(raw.postalCode, 10) };
  const label = s(raw.label, 40);
  const unit = s(raw.unit, 20);
  const instructions = s(raw.instructions, 200);
  if (label) out.label = label;
  if (unit) out.unit = unit;
  if (instructions) out.instructions = instructions;
  return out;
}
