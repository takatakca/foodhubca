// on2go.ca, browser: POST with Authorization: Bearer <on2go customer token> → { ok }: every token of that customer is void.
import { on2goCustomer, on2goJson, on2goPreflight, on2goRoute } from '@/lib/foodhub/customers/on2go-public';
import { bumpTokenVersion } from '@/lib/foodhub/customers/store';

export const dynamic = 'force-dynamic';
const M = 'POST';

export const POST = on2goRoute(M, async (req) => {
  const who = await on2goCustomer(req);
  if (!who.ok) return on2goJson(req, M, { ok: false, error: who.error }, who.status);
  await bumpTokenVersion(who.customer.id);
  return on2goJson(req, M, { ok: true });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
