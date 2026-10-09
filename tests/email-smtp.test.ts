// Email sending: SMTP (the owner's own mailbox) or Resend, chosen from the environment. The SMTP transport and
// fetch are mocked everywhere: no real network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport: h.createTransport, default: { createTransport: h.createTransport } }));

import { emailConfigured, emailFrom, emailProvider, emailSetupMessage, sendMail, smtpSettings } from '../lib/foodhub/notify/email';

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'SMTP_TLS_SERVERNAME', 'RESEND_API_KEY', 'RESEND_BASE_URL', 'AUTH_EMAIL_FROM', 'REPORT_EMAIL_FROM', 'FOODHUB_FORCE_MEMORY'];
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn<typeof fetch>();
const PASS = 'S3cret-pw!';

function smtpEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, { SMTP_HOST: 'mail.takatak.example', SMTP_USER: 'connexion@takatak.example', SMTP_PASS: PASS, AUTH_EMAIL_FROM: 'TAKATAK <connexion@takatak.example>', ...extra });
}
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const msg = { to: ['a@b.co'], subject: 'Hello', text: 'Body' };

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  h.createTransport.mockReset().mockImplementation(() => ({ sendMail: h.sendMail, close: h.close }));
  h.sendMail.mockReset().mockResolvedValue({ messageId: '<m1@takatak.example>', accepted: ['a@b.co'], rejected: [] });
  h.close.mockReset();
  fetchMock.mockReset().mockRejectedValue(new Error('unexpected network call'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('which way email goes out', () => {
  it('nothing set: no provider, not configured, and the message names both options', () => {
    expect(emailProvider()).toBeNull();
    expect(emailConfigured()).toBe(false);
    const m = emailSetupMessage('auth');
    expect(m).toContain('SMTP_HOST');
    expect(m).toContain('SMTP_USER');
    expect(m).toContain('SMTP_PASS');
    expect(m).toContain('RESEND_API_KEY');
    expect(m).toContain('AUTH_EMAIL_FROM');
    expect(emailSetupMessage('report')).toContain('REPORT_EMAIL_FROM');
  });

  it('RESEND_API_KEY alone: Resend', () => {
    process.env.RESEND_API_KEY = 're_test';
    expect(emailProvider()).toBe('resend');
    expect(emailConfigured()).toBe(false); // still needs a From address
    process.env.AUTH_EMAIL_FROM = 'a@takatak.example';
    expect(emailConfigured()).toBe(true);
  });

  it('SMTP_HOST + SMTP_USER + SMTP_PASS: SMTP, and it wins over a Resend key', () => {
    smtpEnv();
    expect(emailProvider()).toBe('smtp');
    expect(emailConfigured()).toBe(true);
    process.env.RESEND_API_KEY = 're_test';
    expect(emailProvider()).toBe('smtp');
  });

  it('SMTP half set: not SMTP. Resend if its key is there, else not configured, and the message says what is missing', () => {
    process.env.SMTP_HOST = 'mail.takatak.example';
    process.env.AUTH_EMAIL_FROM = 'a@takatak.example';
    expect(smtpSettings()).toBeNull();
    expect(emailProvider()).toBeNull();
    expect(emailConfigured()).toBe(false);
    expect(emailSetupMessage()).toContain('SMTP_HOST is set, but SMTP_USER and SMTP_PASS must be set too');
    process.env.RESEND_API_KEY = 're_test';
    expect(emailProvider()).toBe('resend');
    expect(emailConfigured()).toBe(true);
  });

  it('a provider without a From address is not configured, and the message asks for the address', () => {
    smtpEnv(); delete process.env.AUTH_EMAIL_FROM;
    expect(emailConfigured()).toBe(false);
    expect(emailSetupMessage()).toContain('AUTH_EMAIL_FROM');
    expect(emailSetupMessage()).not.toContain('RESEND_API_KEY');
  });

  it('From address: sign-in prefers AUTH_EMAIL_FROM, reports prefer REPORT_EMAIL_FROM, each falls back to the other', () => {
    expect(emailFrom('auth')).toBeUndefined();
    process.env.AUTH_EMAIL_FROM = 'auth@x.co';
    expect(emailFrom('auth')).toBe('auth@x.co');
    expect(emailFrom('report')).toBe('auth@x.co');
    process.env.REPORT_EMAIL_FROM = 'report@x.co';
    expect(emailFrom('auth')).toBe('auth@x.co');
    expect(emailFrom('report')).toBe('report@x.co');
    delete process.env.AUTH_EMAIL_FROM;
    expect(emailFrom('auth')).toBe('report@x.co');
  });

  it('SMTP port and TLS mode: 465 is TLS by default, 587 is STARTTLS, SMTP_SECURE overrides, a bad port falls back to 465', () => {
    smtpEnv();
    expect(smtpSettings()).toMatchObject({ host: 'mail.takatak.example', port: 465, secure: true, user: 'connexion@takatak.example', pass: PASS });
    process.env.SMTP_PORT = '587';
    expect(smtpSettings()).toMatchObject({ port: 587, secure: false });
    process.env.SMTP_SECURE = 'true';
    expect(smtpSettings()).toMatchObject({ port: 587, secure: true });
    process.env.SMTP_PORT = '465'; process.env.SMTP_SECURE = 'false';
    expect(smtpSettings()).toMatchObject({ port: 465, secure: false });
    delete process.env.SMTP_SECURE; process.env.SMTP_PORT = 'abc';
    expect(smtpSettings()).toMatchObject({ port: 465, secure: true });
  });
});

describe('sending by SMTP', () => {
  it('opens the transport with a 10 s timeout, sends from the configured address, and never touches Resend', async () => {
    smtpEnv({ RESEND_API_KEY: 're_test' });
    const r = await sendMail({ ...msg, html: '<b>Body</b>', attachments: [{ filename: 'r.csv', content: new Uint8Array([97, 44, 98]) }] }, 'auth');
    expect(r).toEqual({ ok: true, provider: 'smtp', ref: '<m1@takatak.example>' });
    expect(h.createTransport).toHaveBeenCalledTimes(1);
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({
      host: 'mail.takatak.example', port: 465, secure: true, requireTLS: false,
      auth: { user: 'connexion@takatak.example', pass: PASS },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    });
    const sent = h.sendMail.mock.calls[0][0];
    expect(sent).toMatchObject({ from: 'TAKATAK <connexion@takatak.example>', to: ['a@b.co'], subject: 'Hello', text: 'Body', html: '<b>Body</b>' });
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe('r.csv');
    expect(Buffer.isBuffer(sent.attachments[0].content)).toBe(true);
    expect(sent.attachments[0].content.toString()).toBe('a,b');
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('port 587 requires STARTTLS before the password is sent; SMTP_TLS_SERVERNAME is passed to TLS', async () => {
    smtpEnv({ SMTP_PORT: '587', SMTP_TLS_SERVERNAME: 'host.mochahost.example' });
    await sendMail(msg, 'auth');
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({ port: 587, secure: false, requireTLS: true, tls: { servername: 'host.mochahost.example' } });
  });

  it('reports use REPORT_EMAIL_FROM when set', async () => {
    smtpEnv({ REPORT_EMAIL_FROM: 'Rapports <rapports@takatak.example>' });
    await sendMail(msg, 'report');
    expect(h.sendMail.mock.calls[0][0].from).toBe('Rapports <rapports@takatak.example>');
  });

  it('a server error comes back as a failure, never thrown, and never contains the password', async () => {
    smtpEnv();
    h.sendMail.mockRejectedValueOnce(Object.assign(new Error(`Invalid login: 535 Authentication failed for ${PASS}`), { code: 'EAUTH' }));
    const r = await sendMail(msg, 'auth');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.provider).toBe('smtp');
    expect(r.failure.kind).toBe('smtp');
    expect(r.failure.detail).toContain('EAUTH');
    expect(r.failure.detail).toContain('535');
    expect(JSON.stringify(r)).not.toContain(PASS);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('gives up after 10 s when the server never answers', async () => {
    smtpEnv();
    vi.useFakeTimers();
    h.sendMail.mockReturnValueOnce(new Promise(() => { /* never answers */ }));
    const p = sendMail(msg, 'auth');
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r).toMatchObject({ ok: false, provider: 'smtp', failure: { kind: 'smtp' } });
    if (!r.ok) expect(r.failure.detail).toContain('timed out after 10 s');
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('a server that accepted nobody is a failure', async () => {
    smtpEnv();
    h.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['a@b.co'] });
    const r = await sendMail(msg, 'auth');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toContain('a@b.co');
  });
});

describe('sending by Resend (unchanged)', () => {
  beforeEach(() => { process.env.RESEND_API_KEY = 're_test'; process.env.AUTH_EMAIL_FROM = 'TAKATAK <connexion@takatak.example>'; });

  it('posts to the Resend API with the bearer key, the From address, base64 attachments, and no SMTP transport', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(jsonRes(200, { id: 'email-1' }));
    const r = await sendMail({ ...msg, html: '<b>x</b>', attachments: [{ filename: 'r.csv', content: Buffer.from('a,b') }] }, 'auth');
    expect(r).toEqual({ ok: true, provider: 'resend', ref: 'email-1' });
    expect(h.createTransport).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init!.body))).toEqual({
      from: 'TAKATAK <connexion@takatak.example>', to: ['a@b.co'], subject: 'Hello', text: 'Body', html: '<b>x</b>',
      attachments: [{ filename: 'r.csv', content: Buffer.from('a,b').toString('base64') }],
    });
  });

  it('RESEND_BASE_URL is honoured, and an HTTP error carries the provider message', async () => {
    process.env.RESEND_BASE_URL = 'http://127.0.0.1:9/resend/';
    fetchMock.mockReset().mockResolvedValueOnce(jsonRes(422, { message: 'Invalid `to` field' }));
    const r = await sendMail(msg, 'auth');
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:9/resend/emails');
    expect(r).toEqual({ ok: false, provider: 'resend', failure: { kind: 'http', status: 422, detail: 'Invalid `to` field' } });
  });

  it('a network error is a failure, not an exception', async () => {
    fetchMock.mockReset().mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await sendMail(msg, 'auth')).toEqual({ ok: false, provider: 'resend', failure: { kind: 'network', detail: 'ECONNRESET' } });
  });
});

describe('nothing configured', () => {
  it('sendMail returns a config failure without opening SMTP or the network', async () => {
    const r = await sendMail(msg, 'auth');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.provider).toBeNull();
      expect(r.failure.kind).toBe('config');
      expect(r.failure.detail).toContain('SMTP_HOST');
      expect(r.failure.detail).toContain('RESEND_API_KEY');
    }
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('callers: sign-in / alert email (notify) and reports', () => {
  beforeEach(() => { process.env.FOODHUB_FORCE_MEMORY = 'true'; (globalThis as any).__foodhubMem = undefined; });
  const table = { key: 'items_summary' as const, title: 'Items', filename: 'items', columns: ['a'], rows: [] };

  it('notify.sendEmail goes out by SMTP and is written to the outbox with the masked address', async () => {
    smtpEnv();
    const { sendEmail, listOutbox, channelsStatus } = await import('../lib/foodhub/notify');
    const r = await sendEmail({ to: 'Owner@Takatak.example', subject: 'Votre code', text: '123456' }, { purpose: 'sign_in', secret: true });
    expect(r).toMatchObject({ ok: true, channel: 'email', message: 'Sent', ref: '<m1@takatak.example>' });
    expect(h.sendMail.mock.calls[0][0].to).toEqual(['owner@takatak.example']);
    expect(channelsStatus()).toMatchObject({ email: true, emailProvider: 'smtp' });
    const out = await listOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ channel: 'email', ok: true, purpose: 'sign_in' });
    expect(out[0].to).toContain('•');
    expect(JSON.stringify(out)).not.toContain(PASS);
  });

  it('notify.sendEmail reports an SMTP failure in words, and "not set up" lists both options', async () => {
    const { sendEmail } = await import('../lib/foodhub/notify');
    const none = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { purpose: 'test' });
    expect(none).toMatchObject({ ok: false, skipped: true, channel: 'email' });
    expect(none.message).toContain('SMTP_HOST');
    expect(none.message).toContain('RESEND_API_KEY');
    smtpEnv();
    h.sendMail.mockRejectedValueOnce(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
    const bad = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { purpose: 'test' });
    expect(bad).toMatchObject({ ok: false, channel: 'email' });
    expect(bad.message).toMatch(/^SMTP error: ETIMEDOUT: Connection timeout/);
  });

  it('notify.sendEmail through Resend keeps its old messages', async () => {
    process.env.RESEND_API_KEY = 're_test'; process.env.AUTH_EMAIL_FROM = 'a@takatak.example';
    const { sendEmail } = await import('../lib/foodhub/notify');
    fetchMock.mockReset().mockResolvedValueOnce(jsonRes(200, { id: 'email-9' })).mockResolvedValueOnce(jsonRes(403, { message: 'domain not verified' })).mockRejectedValueOnce(new Error('boom'));
    expect(await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { purpose: 'test' })).toMatchObject({ ok: true, message: 'Sent', ref: 'email-9' });
    expect(await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { purpose: 'test' })).toMatchObject({ ok: false, message: 'Resend HTTP 403: domain not verified' });
    expect(await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { purpose: 'test' })).toMatchObject({ ok: false, message: 'Network error: boom' });
    expect(h.createTransport).not.toHaveBeenCalled();
  });

  it('reports go out by SMTP with the file attached, using AUTH_EMAIL_FROM when REPORT_EMAIL_FROM is not set', async () => {
    smtpEnv();
    const { emailConfigured: reportsEmailConfigured, emailReport } = await import('../lib/foodhub/reports');
    expect(reportsEmailConfigured()).toBe(true);
    const r = await emailReport(table, ['x@y.co', 'z@y.co'], 'csv', 'daily');
    expect(r).toEqual({ ok: true, message: 'Sent to x@y.co, z@y.co' });
    const sent = h.sendMail.mock.calls[0][0];
    expect(sent).toMatchObject({ from: 'TAKATAK <connexion@takatak.example>', to: ['x@y.co', 'z@y.co'], subject: 'TAKATAK — Items (daily)' });
    expect(sent.attachments[0].filename).toBe('items.csv');
    expect(Buffer.isBuffer(sent.attachments[0].content)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports: an SMTP error and the "not set up" text', async () => {
    const { emailConfigured: reportsEmailConfigured, emailReport } = await import('../lib/foodhub/reports');
    expect(reportsEmailConfigured()).toBe(false);
    const none = await emailReport(table, ['x@y.co'], 'csv');
    expect(none.ok).toBe(false);
    expect(none.message).toContain('SMTP_HOST');
    expect(none.message).toContain('RESEND_API_KEY');
    expect(none.message).toContain('REPORT_EMAIL_FROM');
    smtpEnv();
    h.sendMail.mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));
    const bad = await emailReport(table, ['x@y.co'], 'xlsx');
    expect(bad).toEqual({ ok: false, message: 'Email failed (SMTP): EAUTH: Invalid login' });
  });
});
