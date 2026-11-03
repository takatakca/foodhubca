import { customerRoute, jsonFail, jsonOk, requireCustomer } from '@/lib/foodhub/customers/http';
import { bumpTokenVersion } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';

// Contract § A.7 — POST → { ok } : every token of that customer is void (tokenVersion++), on every device and brand website.
export const POST = customerRoute(async (req) => {
  const who = await requireCustomer(req);
  if (!who.ok) return jsonFail(who.error, who.status);
  await bumpTokenVersion(who.customer.id);
  return jsonOk();
});
