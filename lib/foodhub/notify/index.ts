// Outbound messages: email (SMTP or Resend, see email.ts), SMS + voice calls (Twilio), team chat (Slack / Teams / Discord /
// Google Chat incoming webhook). Every attempt is written to the "messages" outbox (recipient masked),
// so the owner can see what was sent, to whom and whether it worked. Nothing here ever throws.
import crypto from 'node:crypto';
import { getRepo } from '../repo';
import { timedFetch } from '../env-utils';
import { emailConfigured, emailFrom, emailProvider, emailSetupMessage, sendMail } from './email';

// The shared email helpers live in ./email; re-exported so existing imports from '../notify' keep working.
export { emailConfigured, emailFrom };

export type MessageChannel = 'email' | 'sms' | 'call' | 'chat';
export interface SendResult { ok: boolean; channel: MessageChannel; message: string; ref?: string; skipped?: boolean }
export interface OutboxEntry {
  id: string; at: string; channel: MessageChannel; to: string; purpose: string; ok: boolean; skipped?: boolean;
  message: string; ref?: string; incidentId?: string; orderId?: string; by?: string; preview?: string;
}

export const OUTBOX = 'messages';
const strip = (u: string) => u.replace(/\/+$/, '');

export function smsConfigured(): boolean { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)); }
export function callConfigured(): boolean { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM); }
export function chatConfigured(): boolean { return Boolean(process.env.ALERT_WEBHOOK_URL); }
export function aiConfigured(): boolean { return Boolean(process.env.ANTHROPIC_API_KEY); }

export function channelsStatus() {
  return { email: emailConfigured(), emailProvider: emailProvider(), sms: smsConfigured(), call: callConfigured(), chat: chatConfigured(), ai: aiConfigured() };
}

/** North-American numbers to E.164 (+15145550123). Returns null when it does not look like a phone number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/[^\d]/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

export function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return d ? `${u.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : e;
}
export function maskPhone(p: string): string { return p.length <= 6 ? p : `${p.slice(0, 2)}${'•'.repeat(p.length - 6)}${p.slice(-4)}`; }
export function maskContact(c: string): string { return c.includes('@') ? maskEmail(c) : maskPhone(c); }

async function record(e: Omit<OutboxEntry, 'id' | 'at'>): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    await getRepo().putDocs<OutboxEntry>(OUTBOX, [{ id, at, key: e.incidentId ?? e.orderId ?? e.purpose, data: { ...e, id, at } }]);
  } catch (err) {
    console.error('[foodhub] outbox write failed', err);
  }
}

type Meta = { purpose: string; incidentId?: string; orderId?: string; by?: string; /** do not keep the text (sign-in codes) */ secret?: boolean };

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }, meta: Meta): Promise<SendResult> {
  const to = normalizeEmail(input.to);
  let r: SendResult;
  if (!to) r = { ok: false, channel: 'email', message: 'Invalid email address.' };
  else if (!emailConfigured()) r = { ok: false, skipped: true, channel: 'email', message: emailSetupMessage('auth') };
  else {
    const m = await sendMail({ to: [to], subject: input.subject, text: input.text, ...(input.html ? { html: input.html } : {}) }, 'auth');
    if (m.ok) r = { ok: true, channel: 'email', message: 'Sent', ref: m.ref };
    else {
      const f = m.failure;
      r = { ok: false, channel: 'email', message: f.kind === 'http' ? `Resend HTTP ${f.status}: ${f.detail}`.trim() : f.kind === 'smtp' ? `SMTP error: ${f.detail}` : f.kind === 'network' ? `Network error: ${f.detail}` : f.detail };
    }
  }
  await record({ channel: 'email', to: to ? maskEmail(to) : String(input.to).slice(0, 3), purpose: meta.purpose, ok: r.ok, skipped: r.skipped, message: r.message, ref: r.ref, incidentId: meta.incidentId, orderId: meta.orderId, by: meta.by, preview: meta.secret ? undefined : input.subject });
  return r;
}

function twilioAuth() {
  return `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
}
function twilioUrl(path: string) {
  return `${strip(process.env.TWILIO_BASE_URL || 'https://api.twilio.com')}/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID || '')}/${path}`;
}

export async function sendSms(input: { to: string; body: string; /** Our own Twilio number to send from (e.g. the number the customer called); default TWILIO_FROM / the messaging service. */ from?: string }, meta: Meta): Promise<SendResult> {
  const to = normalizePhone(input.to);
  let r: SendResult;
  if (!to) r = { ok: false, channel: 'sms', message: 'Invalid phone number.' };
  else if (!smsConfigured()) r = { ok: false, skipped: true, channel: 'sms', message: 'SMS is not set up (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).' };
  else {
    const form = new URLSearchParams({ To: to, Body: input.body.slice(0, 1500) });
    const own = normalizePhone(input.from);
    if (own) form.set('From', own);
    else if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set('From', process.env.TWILIO_FROM!);
    try {
      const res = await timedFetch(twilioUrl('Messages.json'), { method: 'POST', headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const body = await res.json().catch(() => ({}));
      r = res.ok ? { ok: true, channel: 'sms', message: 'Sent', ref: body?.sid } : { ok: false, channel: 'sms', message: `Twilio HTTP ${res.status}: ${body?.message ?? ''}`.trim() };
    } catch (e) {
      r = { ok: false, channel: 'sms', message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  await record({ channel: 'sms', to: to ? maskPhone(to) : '?', purpose: meta.purpose, ok: r.ok, skipped: r.skipped, message: r.message, ref: r.ref, incidentId: meta.incidentId, orderId: meta.orderId, by: meta.by, preview: meta.secret ? undefined : input.body.slice(0, 160) });
  return r;
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

/** A short spoken alert, read twice. */
export async function placeCall(input: { to: string; say: string; lang?: 'fr' | 'en' }, meta: Meta): Promise<SendResult> {
  const to = normalizePhone(input.to);
  let r: SendResult;
  if (!to) r = { ok: false, channel: 'call', message: 'Invalid phone number.' };
  else if (!callConfigured()) r = { ok: false, skipped: true, channel: 'call', message: 'Phone calls are not set up (Twilio + TWILIO_FROM).' };
  else {
    const fr = (input.lang ?? 'fr') === 'fr';
    const voice = fr ? 'language="fr-CA" voice="Polly.Chantal"' : 'language="en-US" voice="Polly.Joanna"';
    const twiml = `<Response><Say ${voice}>${xml(input.say)}</Say><Pause length="1"/><Say ${voice}>${xml(input.say)}</Say></Response>`;
    try {
      const res = await timedFetch(twilioUrl('Calls.json'), {
        method: 'POST', headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Twiml: twiml }).toString(),
      });
      const body = await res.json().catch(() => ({}));
      r = res.ok ? { ok: true, channel: 'call', message: 'Calling', ref: body?.sid } : { ok: false, channel: 'call', message: `Twilio HTTP ${res.status}: ${body?.message ?? ''}`.trim() };
    } catch (e) {
      r = { ok: false, channel: 'call', message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  await record({ channel: 'call', to: to ? maskPhone(to) : '?', purpose: meta.purpose, ok: r.ok, skipped: r.skipped, message: r.message, ref: r.ref, incidentId: meta.incidentId, orderId: meta.orderId, by: meta.by, preview: input.say.slice(0, 160) });
  return r;
}

/** Slack / Microsoft Teams / Google Chat / Discord incoming webhook (one URL in ALERT_WEBHOOK_URL). */
export async function postToChat(input: { title: string; text?: string; severity?: 'critical' | 'warning' | 'info'; link?: string }, meta: Meta): Promise<SendResult> {
  let r: SendResult;
  const icon = input.severity === 'critical' ? '🔴' : input.severity === 'warning' ? '🟠' : '🔵';
  const text = `${icon} *${input.title}*${input.text ? `\n${input.text}` : ''}${input.link ? `\n${input.link}` : ''}`;
  if (!chatConfigured()) r = { ok: false, skipped: true, channel: 'chat', message: 'Team chat is not set up (ALERT_WEBHOOK_URL).' };
  else {
    try {
      const res = await timedFetch(process.env.ALERT_WEBHOOK_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text.replace(/\*/g, '**') }) });
      r = res.ok ? { ok: true, channel: 'chat', message: 'Posted' } : { ok: false, channel: 'chat', message: `Chat webhook HTTP ${res.status}` };
    } catch (e) {
      r = { ok: false, channel: 'chat', message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  await record({ channel: 'chat', to: 'team chat', purpose: meta.purpose, ok: r.ok, skipped: r.skipped, message: r.message, incidentId: meta.incidentId, orderId: meta.orderId, by: meta.by, preview: input.title });
  return r;
}

export async function listOutbox(limit = 200): Promise<OutboxEntry[]> {
  return (await getRepo().listDocs<OutboxEntry>(OUTBOX, { limit })).map((d) => d.data);
}
