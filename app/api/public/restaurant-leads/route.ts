import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { LEAD_MAX_BODY_BYTES, LEAD_RATE_WINDOW_MS, leadCorsHeaders, notifyLead, parseLead } from '@/lib/foodhub/restaurant-leads';
import { submitRestaurantLead } from '@/lib/foodhub/restaurant-lead-submission';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// POST /api/public/restaurant-leads: the "Join / get listed" form on ON2GO.ca. No sign-in (this exact path is in proxy.ts
// PUBLIC_PATHS); CORS for on2go.ca only; JSON in, { ok: true } with 202 out. Contract: docs/RESTAURANT_LEADS.md.
//   202 ok            stored (or silently dropped by the honeypot: a bot learns nothing)
//   400 ok:false      { errors: { field: 'required' | 'invalid' | 'too_long' } }
//   413 / 415 / 429   body too large / not JSON / quota spent for this IP (Retry-After in seconds)
function headers(req: Request, extra: Record<string, string> = {}): Record<string, string> {
  return { ...leadCorsHeaders(req.headers.get('origin')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}
const reply = (req: Request, status: number, body: Record<string, unknown>, extra?: Record<string, string>) => NextResponse.json(body, { status, headers: headers(req, extra) });

export async function POST(req: Request) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return reply(req, 415, { ok: false, error: 'Send JSON (Content-Type: application/json).' });
  if (Number(req.headers.get('content-length') || 0) > LEAD_MAX_BODY_BYTES) return reply(req, 413, { ok: false, error: 'Too large.' });
  let raw = '';
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > LEAD_MAX_BODY_BYTES) { await reader.cancel().catch(() => undefined); return reply(req, 413, { ok: false, error: 'Too large.' }); }
        chunks.push(next.value);
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } catch { return reply(req, 400, { ok: false, errors: { body: 'invalid' } }); }
    finally { reader.releaseLock(); }
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(req, 400, { ok: false, errors: { body: 'invalid' } }); }

  const parsed = parseLead(body);
  if (parsed.kind === 'honeypot') return reply(req, 202, { ok: true });
  if (parsed.kind === 'invalid') return reply(req, 400, { ok: false, errors: parsed.errors });

  const submission = await submitRestaurantLead(parsed.lead, req.headers.get('idempotency-key'), clientIp(req.headers));
  if (submission.kind === 'invalid_key') return reply(req, 400, { ok: false, errors: { request: 'invalid' } });
  if (submission.kind === 'rate') {
    return reply(req, 429, { ok: false, error: 'Too many requests. Please try again in a few minutes.' }, { 'Retry-After': String(LEAD_RATE_WINDOW_MS / 1000) });
  }

  if (submission.kind === 'conflict' || submission.kind === 'pending') return reply(req, 409, { ok: false, error: submission.kind === 'conflict' ? 'request_changed' : 'request_pending' }, { 'Retry-After': '5' });
  if (submission.kind === 'unavailable') return reply(req, 503, { ok: false, error: 'unavailable' });
  if (submission.kind !== 'accepted') return reply(req, 503, { ok: false, error: 'unavailable' });
  const lead = submission.lead;
  if (lead) {
    // Storage is the acceptance boundary. Optional mail/activity failures must not invite another lead submission.
    try {
      const mail = await notifyLead(lead);
      await logActivity({
        actor: lead.source === 'foodhub' ? 'Food Hub' : 'on2go.ca', source: 'api', kind: 'message', action: 'restaurant-lead', status: 'info',
        summary: `Nouvelle demande de restaurant : ${lead.restaurant} (${lead.city})`,
        detail: { leadId: lead.id, platforms: lead.platforms, lang: lead.lang, supportMail: mail.support?.ok ?? null, replyMail: mail.reply.ok },
      });
    } catch { /* the stored request remains available in the owner inbox */ }
  }
  return reply(req, 202, { ok: true });
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: leadCorsHeaders(req.headers.get('origin')) });
}
