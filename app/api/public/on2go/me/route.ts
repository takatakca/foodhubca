// on2go.ca « Mon compte », browser, Authorization: Bearer <on2go customer token>:
//   GET    → profile, addresses, favourites, loyalty / gift cards (adapters), recent website orders (task 72's buildMe)
//   PATCH  { name?, email?, lang?, marketingConsent? } → { ok, customer }
//   DELETE → Loi 25: the record is anonymised and every token is void
import { buildMe } from '@/lib/foodhub/customers/me';
import { on2goCustomer, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { applyProfilePatch, validateProfilePatch } from '@/lib/foodhub/customers/profile';
import { anonymiseCustomer, updateCustomer } from '@/lib/foodhub/customers/store';
import { toPublicCustomer } from '@/lib/foodhub/customers/types';

export const dynamic = 'force-dynamic';
const M = 'GET, PATCH, DELETE';

export const GET = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  return on2goJson(req, M, { ok: true, ...(await buildMe(who.customer)) });
});

export const PATCH = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  const body = await readSmallJson(req);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON body required.' }, 400);
  const v = validateProfilePatch(body);
  if (!v.ok) return on2goJson(req, M, { ok: false, error: v.error }, v.status);
  const next = await updateCustomer(who.customer.id, (c) => applyProfilePatch(c, v.patch));
  if (!next) return on2goJson(req, M, { ok: false, error: 'Customer not found.' }, 401);
  return on2goJson(req, M, { ok: true, customer: toPublicCustomer(next) });
});

export const DELETE = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  const gone = await anonymiseCustomer(who.customer.id, who.tenant);
  if (!gone) return on2goJson(req, M, { ok: false, error: 'Customer not found.' }, 401);
  return on2goJson(req, M, { ok: true, deleted: true, id: gone.id, deletedAt: gone.deletedAt });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
