import { customerRoute, jsonFail, jsonOk, readBody, requireCustomer } from '@/lib/foodhub/customers/http';
import { validateAddresses } from '@/lib/foodhub/customers/profile';
import { updateCustomer } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';

// Contract § A.5 — PUT { addresses: [{ label?, street, unit?, city, province?, postalCode, instructions? }] } (max 5) → { ok, addresses }.
export const PUT = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  const body = await readBody(req);
  if (body === undefined) return jsonFail('Invalid JSON.', 400);
  const v = validateAddresses(body);
  if (!v.ok) return jsonFail(v.error, v.status);
  const next = await updateCustomer(who.customer.id, (c) => ({ ...c, addresses: v.addresses }));
  if (!next) return jsonFail('Customer not found.', 401);
  return jsonOk({ addresses: next.addresses });
});
