import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { allowLead, LEAD_MAX_BODY_BYTES, LEAD_RATE_WINDOW_MS, leadCorsHeaders, notifyLead, parseLead, saveLead } from '@/lib/foodhub/restaurant-leads';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// POST /api/public/restaurant-leads: the "Join / get listed" form on ON2GO.ca. No sign-in (proxy.ts lets /api/public/
// through); CORS for on2go.ca only; JSON in, { ok: true } with 202 out. Contract: docs/RESTAURANT_LEADS.md.
//   202 ok            stored (or silently dropped by the honeypot: a bot learns nothing)
//   400 ok:false      { errors: { field: 'required' | 'invalid' | 'too_long' } }
//   413 / 415 / 429   body too large / not JSON / quota spent for this IP (Retry-After in seconds)
function headers(req: Request, extra: Record<string, string> = {}): Record<string, string> {
  return { ...leadCorsHeaders(req.headers.get('origin')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}
const reply = (req: Request, status: number, body: Record<string, unknown>, extra?: Record<string, string>) => NextResponse.json(body, { status, headers: headers(req, extra) });

export async function POST(req: Request) {
  const type = req.headers.get('content-type') || '';
  if (!/application\/json/i.test(type)) return reply(req, 415, { ok: false, error: 'Send JSON (Content-Type: application/json).' });
  const raw = await req.text().catch(() => '');
  if (Buffer.byteLength(raw, 'utf8') > LEAD_MAX_BODY_BYTES) return reply(req, 413, { ok: false, error: 'Too large.' });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(req, 400, { ok: false, errors: { body: 'invalid' } }); }

  const parsed = parseLead(body);
  if (parsed.kind === 'honeypot') return reply(req, 202, { ok: true });
  if (parsed.kind === 'invalid') return reply(req, 400, { ok: false, errors: parsed.errors });

  if (!allowLead(clientIp(req.headers))) {
    return reply(req, 429, { ok: false, error: 'Too many requests. Please try again in a few minutes.' }, { 'Retry-After': String(LEAD_RATE_WINDOW_MS / 1000) });
  }

  const lead = await saveLead(parsed.lead);
  const mail = await notifyLead(lead);
  await logActivity({
    actor: 'on2go.ca', source: 'api', kind: 'message', action: 'restaurant-lead', status: 'info',
    summary: `Nouvelle demande de restaurant : ${lead.restaurant} (${lead.city})`,
    detail: { leadId: lead.id, platforms: lead.platforms, lang: lead.lang, supportMail: mail.support?.ok ?? null, replyMail: mail.reply.ok },
  });
  return reply(req, 202, { ok: true });
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: leadCorsHeaders(req.headers.get('origin')) });
}
