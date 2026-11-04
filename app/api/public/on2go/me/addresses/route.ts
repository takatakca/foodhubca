import { on2goCustomer, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { validateAddresses } from '@/lib/foodhub/customers/profile';
import { updateCustomer } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';
const M = 'PUT';

/** The same structured address contract as /customers/me/addresses, with ON2GO browser authentication. */
export const PUT = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  const body = await readSmallJson(req, 8192);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON object required (maximum 8 KB).' }, 400);
  const value = validateAddresses(body);
  if (!value.ok) return on2goJson(req, M, { ok: false, error: value.error }, value.status);
  const next = await updateCustomer(who.customer.id, (c) => ({ ...c, addresses: value.addresses }));
  if (!next) return on2goJson(req, M, { ok: false, error: 'Customer not found.' }, 401);
  return on2goJson(req, M, { ok: true, addresses: next.addresses });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
