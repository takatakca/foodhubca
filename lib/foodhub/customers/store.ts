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

export async function saveCustomer(c: MasterCustomer): Promise<MasterCustomer> {
  await getRepo().putDocs<MasterCustomer>(CUSTOMERS, [{ id: c.id, key: c.deletedAt ? 'deleted' : phoneKey(c.phone), at: c.createdAt, data: c }]);
  return c;
}

/** Re-read, patch, write under the customer's lock (two website calls never overwrite each other's fields). */
export async function updateCustomer(id: string, patch: (cur: MasterCustomer) => MasterCustomer): Promise<MasterCustomer | null> {
  return withKeyLock(`cust_id:${id}`, async () => {
    const cur = await getCustomer(id);
    if (!cur || cur.deletedAt) return null;
    return saveCustomer(patch(cur));
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
      const next: MasterCustomer = { ...existing, verifiedAt: at, lang: input.lang ?? existing.lang, tenants: existing.tenants.includes(tenant) ? existing.tenants : [...existing.tenants, tenant] };
      await saveCustomer(next);
      await logActivity({ actor: tenant, source: 'api', kind: 'customer', action: 'customer_verified', status: 'success', summary: `Customer ${maskContact(phone)} verified ${how} on ${tenant}` });
      return { customer: next, created: false };
    }
    const fresh: MasterCustomer = {
      id: newCustomerId(), phone, tenants: [tenant], lang: input.lang ?? 'fr', marketingConsent: false, createdAt: at, verifiedAt: at, tokenVersion: 1, addresses: [], favourites: [],
    };
    // Cross-container race: the first claim wins; a loser takes the winner's record (or a stale pointer to a deleted one).
    const key = claimKey(phone);
    const won = await repo.claimKv(key, { id: fresh.id }).catch(() => true);
    if (!won) {
      const other = await repo.getKv<{ id?: string }>(key).catch(() => null);
      const theirs = other?.id ? await getCustomer(other.id) : null;
      if (theirs && !theirs.deletedAt && theirs.phone === phone) {
        const next: MasterCustomer = { ...theirs, verifiedAt: at, lang: input.lang ?? theirs.lang, tenants: theirs.tenants.includes(tenant) ? theirs.tenants : [...theirs.tenants, tenant] };
        await saveCustomer(next);
        return { customer: next, created: false };
      }
      await repo.setKv(key, { id: fresh.id }).catch(() => undefined);
    }
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
  return withKeyLock(`cust_id:${id}`, async () => {
    const cur = await getCustomer(id);
    if (!cur || cur.deletedAt) return null;
    const at = nowIso();
    const gone: MasterCustomer = {
      id: cur.id, phone: '', tenants: cur.tenants, lang: cur.lang, marketingConsent: false, createdAt: cur.createdAt, verifiedAt: cur.verifiedAt,
      tokenVersion: cur.tokenVersion + 1, addresses: [], favourites: [], deletedAt: at,
    };
    await saveCustomer(gone);
    await getRepo().setKv(claimKey(cur.phone), { id: null }).catch(() => undefined);
    await logActivity({ actor: by, source: 'api', kind: 'customer', action: 'customer_deleted', status: 'success', summary: `Customer ${maskContact(cur.phone)} deleted their account (record anonymised)` });
    return gone;
  });
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
