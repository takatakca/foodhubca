import { NextResponse } from 'next/server';
import { ingestTgtgMail } from '@/lib/foodhub/tgtg-email/ingest';
import { mailFromRequest, verifyTgtgEmailWebhook } from '@/lib/foodhub/tgtg-email/inbound';
import { getTgtgEmailSettings, webhookSecretSet } from '@/lib/foodhub/tgtg-email/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;

// Too Good To Go e-mails forwarded by a mail service (raw MIME, JSON or form fields — lib/foodhub/tgtg-email/inbound.ts).
// Same reader and same pipeline as the IMAP mailbox: a reservation becomes a kitchen order + Clover ticket, a cancellation
// cancels it. Idempotent (Message-ID + TGTG code): a resend answers "duplicate", nothing is printed twice.
// Off (404) while TGTG_EMAIL_WEBHOOK_SECRET is not set; 503 while the owner switched the feature off (the sender retries).
export async function POST(req: Request) {
  if (!webhookSecretSet()) return NextResponse.json({ ok: false, error: 'Too Good To Go e-mail webhook is not configured (TGTG_EMAIL_WEBHOOK_SECRET).' }, { status: 404 });
  if (!verifyTgtgEmailWebhook(req.headers, new URL(req.url))) return NextResponse.json({ ok: false, error: 'Webhook token check failed for Too Good To Go e-mails.' }, { status: 401 });
  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) return NextResponse.json({ ok: false, error: 'E-mail too large.' }, { status: 413 });
  if (!(await getTgtgEmailSettings()).enabled) {
    return NextResponse.json({ ok: false, error: 'Too Good To Go e-mails are switched off in Food Hub (Settings → Platforms). Send again later.' }, { status: 503, headers: { 'Retry-After': '300' } });
  }
  let mail;
  try {
    mail = await mailFromRequest(req);
  } catch (error) {
    return NextResponse.json({ ok: false, error: `E-mail could not be read: ${error instanceof Error ? error.message : String(error)}` }, { status: 400 });
  }
  if (!mail) return NextResponse.json({ ok: false, error: 'No e-mail in the request body.' }, { status: 400 });
  try {
    const r = await ingestTgtgMail(mail, 'webhook');
    return NextResponse.json({ ok: true, status: r.status, ...(r.reason ? { reason: r.reason } : {}), ...(r.orderId ? { orderId: r.orderId } : {}), ...(r.code ? { code: r.code } : {}) });
  } catch (error) {
    // Could not be saved (database): the sender must try again — nothing was half done (the e-mail id was not recorded).
    console.error('[foodhub] TGTG e-mail webhook failed', error);
    return NextResponse.json({ ok: false, error: 'Food Hub could not save this e-mail — please send it again.' }, { status: 503, headers: { 'Retry-After': '30' } });
  }
}
