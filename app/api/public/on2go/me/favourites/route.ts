import { on2goCustomer, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { validateFavourites } from '@/lib/foodhub/customers/profile';
import { updateCustomer } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';
const M = 'PUT';

export const PUT = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  const body = await readSmallJson(req, 8192);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON object required (maximum 8 KB).' }, 400);
  const value = validateFavourites(body);
  if (!value.ok) return on2goJson(req, M, { ok: false, error: value.error }, value.status);
  const next = await updateCustomer(who.customer.id, (c) => ({ ...c, favourites: value.favourites }));
  if (!next) return on2goJson(req, M, { ok: false, error: 'Customer not found.' }, 401);
  return on2goJson(req, M, { ok: true, favourites: next.favourites });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
