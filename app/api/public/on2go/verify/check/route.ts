// on2go.ca, browser: POST { phone, code } → { ok, token, expiresAt, customer, created }: the customer (created the
// first time) and a customer token signed for "on2go". 401 wrong code { attemptsLeft } · 410 expired · 429 locked.
import { allowOn2go, on2goIp, on2goJson, on2goPreflight, on2goRoute, readSmallJson } from '@/lib/foodhub/customers/on2go-public';
import { ON2GO_TENANT } from '@/lib/foodhub/customers/types';
import { completeVerification } from '@/lib/foodhub/customers/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const M = 'POST';

export const POST = on2goRoute(M, async (req) => {
  const body = await readSmallJson(req);
  if (!body) return on2goJson(req, M, { ok: false, error: 'JSON body required.' }, 400);
  const ip = on2goIp(req);
  const gate = allowOn2go('check', ip);
  if (!gate.ok) return on2goJson(req, M, { ok: false, error: 'Trop d’essais. Attendez une minute. / Too many tries — wait a minute.', retryAfterS: gate.retryAfterS }, 429, { 'Retry-After': String(gate.retryAfterS) });
  const r = await completeVerification({ tenant: ON2GO_TENANT, phone: body.phone, code: body.code }, ip);
  if (!r.ok) return on2goJson(req, M, { ok: false, error: r.error, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) }, r.status);
  return on2goJson(req, M, { ok: true, token: r.token, expiresAt: r.expiresAt, customer: r.customer, created: r.created });
});

export const OPTIONS = (req: Request) => on2goPreflight(req, M);
