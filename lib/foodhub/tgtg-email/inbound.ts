// Inbound webhook for Too Good To Go e-mails forwarded by a mail service (Mailgun / SendGrid inbound parse, Postmark,
// Cloudflare Email Workers, a Zapier / Make step, a Gmail script…). Accepted bodies:
//   - raw MIME (Content-Type message/rfc822 or text/plain)                       → parsed like an IMAP message;
//   - JSON { from, subject, text, html, messageId?, date?, authResults? } or { raw | mime: "<MIME source>" };
//   - multipart / urlencoded form fields (Mailgun: from, subject, body-plain, body-html, Message-Id, Date,
//     message-headers; SendGrid: from, subject, text, html, headers, dkim, or email = the raw MIME).
// Protected by TGTG_EMAIL_WEBHOOK_SECRET in a header: Authorization: Bearer <secret>, X-Takatak-Token or X-Api-Key.
// ?token=<secret> in the URL is refused unless TGTG_EMAIL_WEBHOOK_QUERY_TOKEN=on (a URL ends up in access logs).
import { checkSharedSecret, safeEqual } from '../config';
import { mailFromMime } from './mime';
import { authResultsFromHeaders, type TgtgMail } from './parse';

/** The URL ?token= form, only when the owner opted in (some forwarders cannot set a header). */
export function queryTokenAllowed(): boolean {
  return /^(on|true|1|yes)$/i.test(process.env.TGTG_EMAIL_WEBHOOK_QUERY_TOKEN?.trim() ?? '');
}

export function verifyTgtgEmailWebhook(headers: Headers, url: URL): boolean {
  const secret = process.env.TGTG_EMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  if (checkSharedSecret(headers, 'TGTG_EMAIL_WEBHOOK_SECRET', ['authorization', 'x-takatak-token', 'x-api-key'])) return true;
  if (!queryTokenAllowed()) return false;
  const q = url.searchParams.get('token');
  return Boolean(q && safeEqual(q.trim(), secret));
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

function headerFrom(headers: string, name: string): string {
  const m = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(headers);
  return m ? m[1].trim() : '';
}

/** Authentication-Results the forwarding service passed along (its own field, a raw header block, Mailgun's list, SendGrid's dkim). */
function authResultsFromFields(f: Record<string, unknown>): string[] {
  const direct = f.authResults ?? f.authenticationResults ?? f['Authentication-Results'] ?? f['authentication-results'];
  if (Array.isArray(direct)) return direct.map(str).filter(Boolean);
  if (str(direct).trim()) return [str(direct).trim()];
  const block = str(f.headers);
  if (block.trim()) {
    const found = authResultsFromHeaders(block);
    if (found.length) return found;
  }
  const mg = str(f['message-headers']);
  if (mg.trim()) {
    try {
      const rows = JSON.parse(mg) as unknown;
      if (Array.isArray(rows)) {
        const found = rows.filter((r): r is [string, string] => Array.isArray(r) && /^authentication-results$/i.test(str(r[0]))).map((r) => str(r[1]).trim()).filter(Boolean);
        if (found.length) return found;
      }
    } catch { /* not Mailgun's list */ }
  }
  // SendGrid Inbound Parse: dkim = "{@toogoodtogo.com : pass}" (its own check of the message).
  const sg = /\{\s*@([^\s:}]+)\s*:\s*pass\s*\}/i.exec(str(f.dkim));
  return sg ? [`inbound-parse; dkim=pass header.d=${sg[1]}`] : [];
}

/** A JSON or form body (already a plain object) → TgtgMail; null when it carries no e-mail. */
export async function mailFromFields(f: Record<string, unknown>): Promise<TgtgMail | null> {
  const raw = str(f.raw ?? f.mime ?? f.email ?? f['body-mime']);
  if (raw.trim()) return mailFromMime(raw);
  const headers = str(f.headers);
  const mail: TgtgMail = {
    from: str(f.from ?? f.From ?? headerFrom(headers, 'From')),
    authResults: authResultsFromFields(f),
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

export class BodyTooLargeError extends Error {
  constructor(max: number) { super(`E-mail larger than ${Math.round(max / 1024 / 1024)} MB.`); this.name = 'BodyTooLargeError'; }
}

/** The request body, read with a byte counter: past `max` bytes the read stops (chunked bodies have no Content-Length). */
export async function readBodyLimited(req: Request, max: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(max);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Reads the request body in whatever form the forwarding service sent it, never more than `max` bytes. */
export async function mailFromRequest(req: Request, max = 5 * 1024 * 1024): Promise<TgtgMail | null> {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  const bytes = await readBodyLimited(req, max);
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await new Response(bytes, { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
    const f: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) f[k] = typeof v === 'string' ? v : await v.text();
    return mailFromFields(f);
  }
  const body = new TextDecoder().decode(bytes);
  if (!body.trim()) return null;
  if (type.includes('json') || /^\s*\{/.test(body)) {
    try { return await mailFromFields(JSON.parse(body) as Record<string, unknown>); } catch { /* not JSON: read it as MIME */ }
  }
  return mailFromMime(body);
}
