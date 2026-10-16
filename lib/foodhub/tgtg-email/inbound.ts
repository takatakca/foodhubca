// Inbound webhook for Too Good To Go e-mails forwarded by a mail service (Mailgun / SendGrid inbound parse, Postmark,
// Cloudflare Email Workers, a Zapier / Make step, a Gmail script…). Accepted bodies:
//   - raw MIME (Content-Type message/rfc822 or text/plain)                       → parsed like an IMAP message;
//   - JSON { from, subject, text, html, messageId?, date? } or { raw | mime: "<MIME source>" };
//   - multipart / urlencoded form fields (Mailgun: from, subject, body-plain, body-html, Message-Id, Date;
//     SendGrid: from, subject, text, html, headers, or email = the raw MIME).
// Protected by TGTG_EMAIL_WEBHOOK_SECRET: Authorization: Bearer <secret>, X-Takatak-Token, X-Api-Key, or ?token=<secret>.
import { checkSharedSecret, safeEqual } from '../config';
import { mailFromMime } from './mime';
import type { TgtgMail } from './parse';

export function verifyTgtgEmailWebhook(headers: Headers, url: URL): boolean {
  const secret = process.env.TGTG_EMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  if (checkSharedSecret(headers, 'TGTG_EMAIL_WEBHOOK_SECRET', ['authorization', 'x-takatak-token', 'x-api-key'])) return true;
  const q = url.searchParams.get('token');
  return Boolean(q && safeEqual(q.trim(), secret));
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

function headerFrom(headers: string, name: string): string {
  const m = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(headers);
  return m ? m[1].trim() : '';
}

/** A JSON or form body (already a plain object) → TgtgMail; null when it carries no e-mail. */
export async function mailFromFields(f: Record<string, unknown>): Promise<TgtgMail | null> {
  const raw = str(f.raw ?? f.mime ?? f.email ?? f['body-mime']);
  if (raw.trim()) return mailFromMime(raw);
  const headers = str(f.headers);
  const mail: TgtgMail = {
    from: str(f.from ?? f.sender ?? f.From ?? headerFrom(headers, 'From')),
    senders: [str(f['X-Original-From'] ?? f.replyTo ?? f['Reply-To'] ?? headerFrom(headers, 'Reply-To')), str(f.envelopeFrom ?? f['X-Envelope-From'])].filter(Boolean),
    to: str(f.to ?? f.recipient ?? f.To),
    subject: str(f.subject ?? f.Subject ?? headerFrom(headers, 'Subject')),
    text: str(f.text ?? f['body-plain'] ?? f.TextBody ?? f.plain),
    html: str(f.html ?? f['body-html'] ?? f.HtmlBody),
    messageId: str(f.messageId ?? f['Message-Id'] ?? f['message-id'] ?? f.MessageID ?? headerFrom(headers, 'Message-ID')) || undefined,
    date: str(f.date ?? f.Date ?? headerFrom(headers, 'Date')) || undefined,
  };
  if (mail.date && !Number.isFinite(Date.parse(mail.date))) mail.date = undefined;
  else if (mail.date) mail.date = new Date(mail.date).toISOString();
  if (!mail.from && !mail.subject && !mail.text && !mail.html) return null;
  return mail;
}

/** Reads the request body in whatever form the forwarding service sent it. */
export async function mailFromRequest(req: Request): Promise<TgtgMail | null> {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    const f: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) f[k] = typeof v === 'string' ? v : await v.text();
    return mailFromFields(f);
  }
  const body = await req.text();
  if (!body.trim()) return null;
  if (type.includes('json') || /^\s*\{/.test(body)) {
    try { return await mailFromFields(JSON.parse(body) as Record<string, unknown>); } catch { /* not JSON: read it as MIME */ }
  }
  return mailFromMime(body);
}
