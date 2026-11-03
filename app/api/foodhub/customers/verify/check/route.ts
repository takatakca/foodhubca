import { customerRoute, jsonFail, jsonOk, readBody, requestIp } from '@/lib/foodhub/customers/http';
import { completeVerification } from '@/lib/foodhub/customers/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Contract § A.2 — POST { tenant, phone, code } → 200 { ok, token, expiresAt, customer }. A verified number Food Hub does
// not know is created on the spot (that is the account). Wrong code → 401 { attemptsLeft }; 5 wrong → 410 (start again).
export const POST = customerRoute(async (req) => {
  const body = await readBody(req);
  if (body === undefined) return jsonFail('Invalid JSON.', 400);
  const r = await completeVerification(body, requestIp(req));
  if (!r.ok) return jsonFail(r.error, r.status, r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {});
  return jsonOk({ token: r.token, expiresAt: r.expiresAt, customer: r.customer, created: r.created });
});
