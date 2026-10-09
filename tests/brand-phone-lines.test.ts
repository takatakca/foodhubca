// Brand phone lines: the number → brand map (no numbers in git), the Twilio signature check on every step, the TwiML
// (<Dial> to the main number with a French whisper, voicemail when nobody answers), the voicemail email with its signed
// listen link, the forwarded text, and the rule that no line exists for Po Poulet NDG.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/foodhub/voice/[step]/route';
import { brandLineFor, parseBrandPhones, recordingLink } from '../lib/foodhub/phone/brand-lines';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { listOutbox } from '../lib/foodhub/notify';
import { proxy } from '../proxy';

const realFetch = globalThis.fetch;
const BASE = 'https://hub.test';
const OOEUF = '+15145550101';
const BIN = '+15145550102';
const MAIN = '+15145559000';
const CALLER = '+15145558888';
let emails: Array<{ to: string[]; subject: string; text: string }> = [];
let twilioGets: Array<{ url: string; auth: string | null }> = [];
let chats: string[] = [];

const ctx = (step: string) => ({ params: Promise.resolve({ step }) });
function signed(step: string, fields: Record<string, string>, query = '', token = 'tw-token') {
  const params = new URLSearchParams(fields);
  const url = `${BASE}/api/foodhub/voice/${step}${query}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, token) }, body: params.toString() });
}
async function call(step: string, fields: Record<string, string>, query = ''): Promise<string> {
  const res = await POST(signed(step, fields, query), ctx(step));
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  Object.assign(process.env, {
    FOODHUB_PUBLIC_URL: BASE, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', RESEND_API_KEY: 're_test', AUTH_EMAIL_FROM: 'Food Hub <codes@hub.test>',
    FOODHUB_MAIN_PHONE: '514 555-9000', FOODHUB_VOICEMAIL_EMAIL: 'owner@hub.test',
    FOODHUB_BRAND_PHONES: JSON.stringify({ [OOEUF]: 'OOeuf', [BIN]: { brand: 'Bin molle & Bin Dure', kitchen: 'NDG', say: 'Bine mol et Bine dure' } }),
  });
  for (const k of ['FOODHUB_VOICE_RING_SECONDS', 'ALERT_WEBHOOK_URL', 'TWILIO_BASE_URL', 'FOODHUB_OWNER_EMAIL']) delete process.env[k];
  emails = []; twilioGets = []; chats = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('api.resend.com/emails')) { emails.push(JSON.parse(String(init.body))); return new Response('{"id":"em_1"}', { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (u.includes('/Recordings/')) { twilioGets.push({ url: u, auth: new Headers(init.headers as HeadersInit).get('authorization') }); return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); }
    if (u.startsWith('https://chat.test')) { chats.push(String(init.body)); return new Response('ok', { status: 200 }); }
    return new Response('{}', { status: 200 });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('FOODHUB_BRAND_PHONES', () => {
  it('reads a map (brand text or details) and a list, and normalises the numbers', () => {
    const map = parseBrandPhones(JSON.stringify({ '514 555-0101': 'OOeuf', '+15145550102': { brand: 'Pi Pita', kitchen: 'Jean-Talon', say: 'Pi Pita' } }));
    expect(map.lines).toEqual([{ number: '+15145550101', brand: 'OOeuf' }, { number: '+15145550102', brand: 'Pi Pita', kitchen: 'Jean-Talon', say: 'Pi Pita' }]);
    const list = parseBrandPhones(JSON.stringify([{ number: '(438) 555-0103', brand: 'OCRÊPE' }]));
    expect(list.lines).toEqual([{ number: '+14385550103', brand: 'OCRÊPE' }]);
  });
  it('ignores bad lines and bad JSON without throwing, and never keeps a number in the problem text', () => {
    const r = parseBrandPhones(JSON.stringify({ '123': 'Short', '+15145550101': '', '+15145550102': 'Ok', '+15145550103': { brand: 'Ok again' } }));
    expect(r.lines.map((l) => l.brand)).toEqual(['Ok', 'Ok again']);
    expect(r.problems).toHaveLength(2);
    expect(parseBrandPhones('{nope').problems).toEqual(['FOODHUB_BRAND_PHONES is not valid JSON.']);
    expect(parseBrandPhones(undefined)).toEqual({ lines: [], problems: [] });
    expect(parseBrandPhones(JSON.stringify([{ number: '+15145550101', brand: 'A' }, { number: '514-555-0101', brand: 'B' }])).lines).toHaveLength(1);
  });
  it('has no line for Po Poulet NDG: refused with no kitchen or NDG; Poulet Poulet is a different brand', () => {
    const r = parseBrandPhones(JSON.stringify([
      { number: '+15145550101', brand: 'Po Poulet' },
      { number: '+15145550102', brand: 'PO POULET', kitchen: 'NDG' },
      { number: '+15145550103', brand: 'Po-Poulet NDG' },
      { number: '+15145550104', brand: 'Po Poulet', kitchen: 'Jean-Talon' },
      { number: '+15145550105', brand: 'Poulet Poulet' },
    ]));
    expect(r.lines.map((l) => l.number)).toEqual(['+15145550104', '+15145550105']);
    expect(r.problems).toHaveLength(3);
  });
  it('maps the called number to its brand', () => {
    expect(brandLineFor('514-555-0101')?.brand).toBe('OOeuf');
    expect(brandLineFor('+15145550199')).toBeNull();
    expect(brandLineFor(null)).toBeNull();
  });
});

describe('Twilio signature on every step', () => {
  it('refuses an unsigned request, a wrong token and a tampered body; answers 404 to an unknown step', async () => {
    const fields = { To: OOEUF, From: CALLER };
    const unsigned = new Request(`${BASE}/api/foodhub/voice/incoming`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    expect((await POST(unsigned, ctx('incoming'))).status).toBe(403);
    expect((await POST(signed('incoming', fields, '', 'other-token'), ctx('incoming'))).status).toBe(403);
    const good = signed('incoming', fields);
    const tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: new URLSearchParams({ ...fields, To: BIN }).toString() });
    expect((await POST(tampered, ctx('incoming'))).status).toBe(403);
    expect((await POST(signed('incoming', fields), ctx('incoming'))).status).toBe(200);
    for (const step of ['whisper', 'dial-done', 'voicemail', 'sms']) expect((await POST(new Request(`${BASE}/api/foodhub/voice/${step}`, { method: 'POST', body: '' }), ctx(step))).status).toBe(403);
    expect((await POST(signed('nope', fields), ctx('nope'))).status).toBe(404);
  });
  it('refuses everything when TWILIO_AUTH_TOKEN is missing', async () => {
    const req = signed('incoming', { To: OOEUF });
    delete process.env.TWILIO_AUTH_TOKEN;
    expect((await POST(req, ctx('incoming'))).status).toBe(403);
  });
  it('is reachable without a console sign-in (the proxy lets /api/foodhub/voice/ through), and the rest of the API is not', async () => {
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    try {
      const open = await proxy(new NextRequest(`${BASE}/api/foodhub/voice/incoming`, { method: 'POST' }));
      expect(open.status).toBe(200);
      expect(open.headers.get('x-middleware-next')).toBe('1');
      expect((await proxy(new NextRequest(`${BASE}/api/foodhub/phone`, { method: 'POST' }))).status).toBe(401);
      // The other public entries stay public (a comment swallowing them once broke the Uber and Clover callbacks).
      for (const path of ['/api/foodhub/webhooks/voice', '/api/foodhub/cron/watch', '/api/foodhub/uber-connect/callback', '/api/foodhub/clover-connect/callback', '/api/foodhub/clover-connect/test-order', '/api/foodhub/auth/login', '/api/foodhub/devices/heartbeat']) {
        expect((await proxy(new NextRequest(`${BASE}${path}`))).headers.get('x-middleware-next'), path).toBe('1');
      }
    } finally { delete process.env.DASHBOARD_PASSWORD; }
  });
});

describe('incoming call', () => {
  it('dials the main number with a whisper, the real caller as caller ID, and a voicemail fallback', async () => {
    const xml = await call('incoming', { To: OOEUF, From: CALLER });
    expect(xml).toContain('<Dial timeout="20" answerOnBridge="true" callerId="+15145558888" method="POST" action="https://hub.test/api/foodhub/voice/dial-done?n=%2B15145550101">');
    expect(xml).toContain('<Number url="https://hub.test/api/foodhub/voice/whisper?n=%2B15145550101" method="POST">+15145559000</Number>');
    expect(xml).not.toContain('<Record');
  });
  it('shows the brand number when the caller is hidden, and takes the ring time from the setting', async () => {
    process.env.FOODHUB_VOICE_RING_SECONDS = '12';
    const xml = await call('incoming', { To: OOEUF, From: '+266696687' });
    expect(xml).toContain('timeout="12"');
    expect(xml).toContain('callerId="+15145550101"');
    process.env.FOODHUB_VOICE_RING_SECONDS = '999';
    expect(await call('incoming', { To: OOEUF, From: CALLER })).toContain('timeout="20"');
  });
  it('goes straight to the voicemail when no main number is set, and still answers on an unknown number', async () => {
    delete process.env.FOODHUB_MAIN_PHONE;
    const xml = await call('incoming', { To: OOEUF, From: CALLER });
    expect(xml).not.toContain('<Dial');
    expect(xml).toContain('vous avez joint OOeuf');
    expect(xml).toContain('you have reached OOeuf');
    expect(xml).toContain('<Record maxLength="120"');
    expect(xml).toContain('action="https://hub.test/api/foodhub/voice/voicemail?n=%2B15145550101"');
    process.env.FOODHUB_MAIN_PHONE = MAIN;
    const unknown = await call('incoming', { To: '+15145550199', From: CALLER });
    expect(unknown).toContain('<Dial');
    expect(unknown).toContain('whisper?n=%2B15145550199');
  });
});

describe('whisper', () => {
  it('says the brand in French, with the kitchen and the pronunciation when given, escaped for XML', async () => {
    const plain = await call('whisper', { CallSid: 'CA1' }, `?n=${encodeURIComponent(OOEUF)}`);
    expect(plain).toContain('language="fr-CA"');
    expect(plain).toContain('Appel pour OOeuf.');
    const detailed = await call('whisper', {}, `?n=${encodeURIComponent(BIN)}`);
    expect(detailed).toContain('Appel pour Bine mol et Bine dure, cuisine NDG.');
    process.env.FOODHUB_BRAND_PHONES = JSON.stringify({ [BIN]: 'Bin molle & Bin Dure' });
    expect(await call('whisper', {}, `?n=${encodeURIComponent(BIN)}`)).toContain('Appel pour Bin molle &amp; Bin Dure.');
  });
  it('says so when the number is not in the map', async () => {
    expect(await call('whisper', {}, `?n=${encodeURIComponent('+15145550199')}`)).toContain('Appel sur une ligne non configurée, se terminant par 0 1 9 9.');
  });
});

describe('when nobody answers', () => {
  it('hangs up after a conversation, goes to the voicemail otherwise (no answer, busy, declined)', async () => {
    const q = `?n=${encodeURIComponent(OOEUF)}`;
    expect(await call('dial-done', { DialCallStatus: 'completed', DialBridged: 'true', DialCallDuration: '40' }, q)).toContain('<Hangup/>');
    const cases: Array<Record<string, string>> = [{ DialCallStatus: 'no-answer' }, { DialCallStatus: 'busy' }, { DialCallStatus: 'failed' }, { DialCallStatus: 'completed', DialBridged: 'false' }];
    for (const f of cases) {
      const xml = await call('dial-done', f, q);
      expect(xml).toContain('<Record');
      expect(xml).toContain('vous avez joint OOeuf');
    }
  });
});

describe('voicemail email', () => {
  const sid = `RE${'a'.repeat(32)}`;
  const q = `?n=${encodeURIComponent(OOEUF)}`;

  it('emails the owner in French with a listen link, thanks the caller, and records it in the outbox', async () => {
    const xml = await call('voicemail', { From: CALLER, RecordingSid: sid, RecordingUrl: 'https://api.twilio.com/x', RecordingDuration: '24' }, q);
    expect(xml).toContain('Merci, votre message a été enregistré');
    expect(xml).toContain('<Hangup/>');
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['owner@hub.test']);
    expect(emails[0].subject).toBe('Message vocal : OOeuf (+1 514 555-8888, 24 s)');
    expect(emails[0].text).toContain('Message vocal pour OOeuf.');
    expect(emails[0].text).toMatch(/https:\/\/hub\.test\/api\/foodhub\/voice\/recording\?sid=RE[a]{32}&exp=\d+&t=[\w-]+/);
    expect((await listOutbox()).filter((e) => e.purpose === 'brand_voicemail' && e.ok)).toHaveLength(1);
  });
  it('sends nothing for a hang-up without a message, and falls back to the team chat when email cannot be sent', async () => {
    await call('voicemail', { From: CALLER, RecordingSid: sid, RecordingDuration: '0' }, q);
    expect(emails).toHaveLength(0);
    delete process.env.RESEND_API_KEY;
    process.env.ALERT_WEBHOOK_URL = 'https://chat.test/hook';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await call('voicemail', { From: CALLER, RecordingSid: sid, RecordingDuration: '9' }, q);
    err.mockRestore();
    expect(emails).toHaveLength(0);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toContain('Message vocal : OOeuf');
    expect(chats[0]).not.toContain('8888');
  });
  it('sends to several addresses and falls back to the owner email', async () => {
    process.env.FOODHUB_VOICEMAIL_EMAIL = 'a@hub.test, b@hub.test; not-an-email';
    await call('voicemail', { From: CALLER, RecordingSid: sid, RecordingDuration: '5' }, q);
    expect(emails.map((e) => e.to[0])).toEqual(['a@hub.test', 'b@hub.test']);
    delete process.env.FOODHUB_VOICEMAIL_EMAIL;
    process.env.FOODHUB_OWNER_EMAIL = 'boss@hub.test';
    emails = [];
    await call('voicemail', { From: CALLER, RecordingSid: sid, RecordingDuration: '5' }, q);
    expect(emails.map((e) => e.to[0])).toEqual(['boss@hub.test']);
  });
});

describe('voicemail listen link', () => {
  const sid = `RE${'b'.repeat(32)}`;
  const listen = (link: string) => GET(new Request(link), ctx('recording'));

  it('streams the recording from Twilio with the account login kept on the server', async () => {
    const link = recordingLink(sid)!;
    expect(link.startsWith(`${BASE}/api/foodhub/voice/recording?sid=${sid}&exp=`)).toBe(true);
    const res = await listen(link);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(twilioGets).toEqual([{ url: `https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/${sid}.mp3`, auth: `Basic ${Buffer.from('AC1:tw-token').toString('base64')}` }]);
  });
  it('refuses a tampered, foreign or expired link and a recording id that is not a Twilio one', async () => {
    const link = recordingLink(sid)!;
    expect((await listen(link.replace('t=', 't=x'))).status).toBe(404);
    expect((await listen(link.replace(sid, `RE${'c'.repeat(32)}`))).status).toBe(404);
    expect((await listen(link.replace(/exp=\d+/, 'exp=99999999999'))).status).toBe(404);
    expect(recordingLink('../../Accounts')).toBeNull();
    expect((await listen(`${BASE}/api/foodhub/voice/recording?sid=../x&exp=1&t=a`)).status).toBe(404);
    const old = recordingLink(sid, Date.now() - 31 * 86_400_000)!;
    expect((await listen(old)).status).toBe(410);
    expect(twilioGets).toHaveLength(0);
    process.env.TWILIO_AUTH_TOKEN = 'rotated';
    expect((await listen(link)).status).toBe(404);
    expect((await GET(new Request(`${BASE}/api/foodhub/voice/incoming`), ctx('incoming'))).status).toBe(404);
  });
  it('says so when Twilio does not have the recording yet', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as any;
    expect((await listen(recordingLink(sid)!)).status).toBe(404);
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    expect((await listen(recordingLink(sid)!)).status).toBe(502);
  });
});

describe('texts to a brand number', () => {
  it('emails the text (a Google code, for instance) and keeps the text out of the outbox', async () => {
    const xml = await call('sms', { To: OOEUF, From: '+15555550100', Body: 'G-123456 is your Google verification code.' });
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe('Texto reçu : OOeuf (+1 555 555-0100)');
    expect(emails[0].text).toContain('G-123456 is your Google verification code.');
    const out = (await listOutbox()).find((e) => e.purpose === 'brand_sms');
    expect(out?.ok).toBe(true);
    expect(out?.preview).toBeUndefined();
  });
});
