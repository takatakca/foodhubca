// on2go.ca, browser: POST { phone, lang? } → a 6-digit code texted to that cell (task 72's verification, brand
// website fixed to "on2go"). 200 { ok, expiresInS, channel } · 422 bad number · 429 { retryAfterS }. lib/foodhub/customers/on2go-public.ts.
import { allowOn2go, on2goIp, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { ON2GO_TENANT } from '@/lib/foodhub/customers/types';
import { startVerification } from '@/lib/foodhub/customers/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const M = 'POST';

export const POST = on2goRoute(M, async (req) => {
  const body = await readSmallJson(req);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON body required.' }, 400);
  const gate = allowOn2go('start', on2goIp(req));
  if (!gate.ok) return on2goJson(req, M, { ok: false, error: 'Trop de demandes. Réessayez plus tard. / Too many requests — try again later.', retryAfterS: gate.retryAfterS }, 429, { 'Retry-After': String(gate.retryAfterS) });
  const r = await startVerification({ tenant: ON2GO_TENANT, phone: body.phone, lang: body.lang });
  if (!r.ok) return on2goJson(req, M, { ok: false, error: r.error, ...(r.retryAfterS ? { retryAfterS: r.retryAfterS } : {}) }, r.status, r.retryAfterS ? { 'Retry-After': String(r.retryAfterS) } : {});
  return on2goJson(req, M, { ok: true, expiresInS: r.expiresInS, channel: r.channel });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
