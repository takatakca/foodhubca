import { customerRoute, jsonFail, jsonOk, readBody } from '@/lib/foodhub/customers/http';
import { startVerification } from '@/lib/foodhub/customers/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Contract § A.1 — POST { tenant, phone, lang? } → 200 { ok, expiresInS: 600, channel: "sms" } · 429 { retryAfterS } · 400/422 bad phone.
// Bearer FOODHUB_WEBSITE_ORDER_SECRET first (401). The code is texted, never returned.
export const POST = customerRoute(async (req) => {
  const body = await readBody(req);
  if (body === undefined) return jsonFail('Invalid JSON.', 400);
  const r = await startVerification(body);
  if (!r.ok) return jsonFail(r.error, r.status, r.retryAfterS ? { retryAfterS: r.retryAfterS } : {});
  return jsonOk({ expiresInS: r.expiresInS, channel: r.channel });
});
