import { customerRoute, jsonFail, jsonOk, readBody, requireCustomer } from '@/lib/foodhub/customers/http';
import { validateFavourites } from '@/lib/foodhub/customers/profile';
import { updateCustomer } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';

// Contract § A.6 — PUT { favourites: ["<ref>"] } (max 50) → { ok, favourites }.
export const PUT = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  const body = await readBody(req);
  if (body === undefined) return jsonFail('Invalid JSON.', 400);
  const v = validateFavourites(body);
  if (!v.ok) return jsonFail(v.error, v.status);
  const next = await updateCustomer(who.customer.id, (c) => ({ ...c, favourites: v.favourites }));
  if (!next) return jsonFail('Customer not found.', 401);
  return jsonOk({ favourites: next.favourites });
});
