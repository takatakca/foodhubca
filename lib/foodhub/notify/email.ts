// The one place that sends email. Two ways out, chosen from the environment:
//   1. SMTP (any mailbox, e.g. the owner's own domain mailboxes): SMTP_HOST + SMTP_USER + SMTP_PASS,
//      optional SMTP_PORT (default 465 = TLS from the start; 587 = STARTTLS) and SMTP_SECURE.
//   2. Resend (HTTP API): RESEND_API_KEY.
// SMTP wins when it is fully set. Either way a From address is needed (AUTH_EMAIL_FROM / REPORT_EMAIL_FROM).
// Nothing here logs or returns the password, and nothing throws: callers get a result they can show.
// Keep this file free of repo / database imports: both notify/index.ts and reports.ts depend on it.
import { createTransport } from 'nodemailer';
import { timedFetch } from '../env-utils';

export type EmailProvider = 'smtp' | 'resend';
/** 'auth' = sign-in codes, invitations, alerts (AUTH_EMAIL_FROM first); 'report' = scheduled / manual reports (REPORT_EMAIL_FROM first). */
export type EmailPurpose = 'auth' | 'report';

export const SMTP_TIMEOUT_MS = 10_000;

export interface SmtpSettings { host: string; port: number; secure: boolean; user: string; pass: string; servername?: string }
export interface MailAttachment { filename: string; content: Uint8Array | Buffer }
export interface MailMessage { to: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] }
export interface MailFailure { kind: 'config' | 'http' | 'network' | 'smtp'; status?: number; detail: string }
export type MailResult =
  | { ok: true; provider: EmailProvider; ref?: string }
  | { ok: false; provider: EmailProvider | null; failure: MailFailure };

const flag = (raw: string | undefined): boolean | undefined => {
  const v = (raw ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return undefined;
};

/** The SMTP settings, or null unless SMTP_HOST, SMTP_USER and SMTP_PASS are all set. */
export function smtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS; // never trimmed or logged
  if (!host || !user || !pass) return null;
  const rawPort = Number(process.env.SMTP_PORT?.trim());
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 465;
  // 465 is implicit TLS; any other port (587) starts in clear text and upgrades with STARTTLS (required, see below).
  const secure = flag(process.env.SMTP_SECURE) ?? port === 465;
  const servername = process.env.SMTP_TLS_SERVERNAME?.trim() || undefined;
  return { host, port, secure, user, pass, ...(servername ? { servername } : {}) };
}

export function emailProvider(): EmailProvider | null {
  if (smtpSettings()) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

export function emailFrom(purpose: EmailPurpose = 'auth'): string | undefined {
  const auth = process.env.AUTH_EMAIL_FROM || undefined;
  const report = process.env.REPORT_EMAIL_FROM || undefined;
  return purpose === 'report' ? report || auth : auth || report;
}

export function emailConfigured(purpose: EmailPurpose = 'auth'): boolean {
  return Boolean(emailProvider() && emailFrom(purpose));
}

/** What is missing, in words the owner can act on. Mentions both ways to send. */
export function emailSetupMessage(purpose: EmailPurpose = 'auth'): string {
  const from = purpose === 'report' ? 'REPORT_EMAIL_FROM (or AUTH_EMAIL_FROM)' : 'AUTH_EMAIL_FROM';
  if (!emailProvider()) {
    const partial = process.env.SMTP_HOST?.trim() ? ` SMTP_HOST is set, but SMTP_USER and SMTP_PASS must be set too.` : '';
    return `Email is not set up: add SMTP_HOST + SMTP_USER + SMTP_PASS (a mailbox on your own domain) or RESEND_API_KEY, plus ${from} (npm run setup).${partial}`;
  }
  return `Email is not set up: add ${from} (the From address; npm run setup).`;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);
const scrub = (s: string, secret?: string) => (secret ? s.split(secret).join('***') : s);

async function sendSmtp(smtp: SmtpSettings, from: string, m: MailMessage): Promise<MailResult> {
  const transport = createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    // Not implicit TLS: the connection must upgrade (STARTTLS) before the password is sent.
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS,
    ...(smtp.servername ? { tls: { servername: smtp.servername } } : {}),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      transport.sendMail({
        from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })) } : {}),
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${SMTP_TIMEOUT_MS / 1000} s`)), SMTP_TIMEOUT_MS); }),
    ]);
    if (Array.isArray(info?.accepted) && info.accepted.length === 0) {
      return { ok: false, provider: 'smtp', failure: { kind: 'smtp', detail: oneLine(`the server accepted no recipient${info.rejected?.length ? ` (rejected: ${info.rejected.map(String).join(', ')})` : ''}`) } };
    }
    return { ok: true, provider: 'smtp', ref: typeof info?.messageId === 'string' ? info.messageId : undefined };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const text = scrub(err?.message ?? String(e), smtp.pass);
    return { ok: false, provider: 'smtp', failure: { kind: 'smtp', detail: oneLine(`${err?.code && !text.includes(err.code) ? `${err.code}: ` : ''}${text}`) } };
  } finally {
    if (timer) clearTimeout(timer);
    try { transport.close?.(); } catch { /* already closed */ }
  }
}

async function sendResend(from: string, m: MailMessage): Promise<MailResult> {
  try {
    const res = await timedFetch(`${(process.env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
      }),
    });
    const raw = await res.text().catch(() => '');
    let json: { id?: unknown; message?: unknown } | null = null;
    try { json = JSON.parse(raw); } catch { /* not JSON */ }
    if (!res.ok) {
      // Resend answers { name, message } ("The gmail.com domain is not verified", "Invalid `to` field"): that is what the operator needs to see.
      return { ok: false, provider: 'resend', failure: { kind: 'http', status: res.status, detail: oneLine(typeof json?.message === 'string' ? json.message : raw) } };
    }
    return { ok: true, provider: 'resend', ref: typeof json?.id === 'string' ? json.id : undefined };
  } catch (e) {
    return { ok: false, provider: 'resend', failure: { kind: 'network', detail: e instanceof Error ? e.message : String(e) } };
  }
}

/** Sends one message through SMTP when it is set, else Resend. Never throws. */
export async function sendMail(m: MailMessage, purpose: EmailPurpose = 'auth'): Promise<MailResult> {
  const from = emailFrom(purpose);
  const smtp = smtpSettings();
  const provider = smtp ? 'smtp' : process.env.RESEND_API_KEY ? 'resend' : null;
  if (!provider || !from) return { ok: false, provider, failure: { kind: 'config', detail: emailSetupMessage(purpose) } };
  return smtp ? sendSmtp(smtp, from, m) : sendResend(from, m);
}
