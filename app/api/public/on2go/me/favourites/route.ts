import { on2goCustomer, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { validateFavourites } from '@/lib/foodhub/customers/profile';
import { replaceCollection } from '@/lib/foodhub/customers/collections';

export const dynamic = 'force-dynamic';
const M = 'PUT';

export const PUT = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  const body = await readSmallJson(req, 8192);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON object required (maximum 8 KB).' }, 400);
  const value = validateFavourites(body);
  if (!value.ok) return on2goJson(req, M, { ok: false, error: value.error }, value.status);
  const result = await replaceCollection(who.customer, { field: 'favourites', value: value.favourites }, body.expectedRevision);
  return on2goJson(req, M, result.body, result.status);
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
