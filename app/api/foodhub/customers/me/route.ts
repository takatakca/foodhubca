import { customerRoute, jsonFail, jsonOk, readBody, requireCustomer } from '@/lib/foodhub/customers/http';
import { buildMe } from '@/lib/foodhub/customers/me';
import { applyProfilePatch, validateProfilePatch } from '@/lib/foodhub/customers/profile';
import { anonymiseCustomer, updateCustomer } from '@/lib/foodhub/customers/store';
import { toPublicCustomer } from '@/lib/foodhub/customers/types';

export const dynamic = 'force-dynamic';

// Contract § A.3 — GET: profile, addresses, favourites, loyalty / gift cards (adapters), recent website orders.
export const GET = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  return jsonOk(await buildMe(who.customer) as unknown as Record<string, unknown>);
});

// Contract § A.4 — PATCH { name?, email?, lang?, marketingConsent? } → { ok, customer }.
export const PATCH = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  const body = await readBody(req);
  if (body === undefined) return jsonFail('Invalid JSON.', 400);
  const v = validateProfilePatch(body);
  if (!v.ok) return jsonFail(v.error, v.status);
  const next = await updateCustomer(who.customer.id, (c) => applyProfilePatch(c, v.patch));
  if (!next) return jsonFail('Customer not found.', 401);
  return jsonOk({ customer: toPublicCustomer(next) });
});

// Loi 25 — DELETE: the record is anonymised (phone, name, e-mail, addresses, favourites, consent removed; every token void).
export const DELETE = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  const gone = await anonymiseCustomer(who.customer.id, who.tenant);
  if (!gone) return jsonFail('Customer not found.', 401);
  return jsonOk({ deleted: true, id: gone.id, deletedAt: gone.deletedAt });
});
