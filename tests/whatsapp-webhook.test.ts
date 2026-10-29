// WhatsApp inbound: signature (own token), brand menu + per-customer memory, STOP/START, rate limit, replay, non-NA senders.
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/foodhub/webhooks/whatsapp/route';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { resetWhatsAppState } from '../lib/foodhub/phone/whatsapp';

const BASE = 'https://hub.test';
const URL_ = `${BASE}/api/foodhub/webhooks/whatsapp`;
let n = 0;
function req(fields: Record<string, string>, token = 'wa-token') {
  const params = new URLSearchParams({ From: 'whatsapp:+15145558888', MessageSid: `SM${++n}`, ...fields });
  return new Request(URL_, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(URL_, params, token) }, body: params.toString() });
}
const say = async (body: string, extra: Record<string, string> = {}) => { const r = await POST(req({ Body: body, ...extra })); expect(r.status).toBe(200); return r.text(); };

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  resetWhatsAppState();
  Object.assign(process.env, {
    FOODHUB_PUBLIC_URL: BASE, TWILIO_AUTH_TOKEN: 'main-token', FOODHUB_WHATSAPP_AUTH_TOKEN: 'wa-token',
    FOODHUB_BRAND_PHONES: JSON.stringify({ '+15145550101': 'OOeuf', '+15145550102': 'Pi Pita' }),
  });
});

describe('WhatsApp webhook', () => {
  it('refuses unsigned, and signed with the wrong account token', async () => {
    const params = new URLSearchParams({ From: 'whatsapp:+15145558888', Body: 'hi' });
    expect((await POST(new Request(URL_, { method: 'POST', body: params.toString() }))).status).toBe(403);
    expect((await POST(req({ Body: 'hi' }, 'main-token'))).status).toBe(403);
  });
  it('shows the brand menu first, then remembers the choice', async () => {
    const menu = await say('Bonjour');
    expect(menu).toContain('1. OOeuf');
    expect(menu).toContain('2. Pi Pita');
    expect(await say('2')).toContain('Pi Pita : merci');
    const next = await say('une pizza svp');
    expect(next).toContain('Pi Pita : message reçu');
    expect(await say('menu')).toContain('1. OOeuf');
  });
  it('stores no phone number', async () => {
    await say('Bonjour');
    const docs = JSON.stringify((globalThis as any).__foodhubMem?.docs ? [...(globalThis as any).__foodhubMem.docs.get('wa_customers')!.values()] : []);
    expect(docs).not.toContain('5145558888');
  });
  it('STOP blocks replies until START', async () => {
    await say('1'); // menu
    expect(await say('STOP')).toContain('plus de messages');
    expect(await say('bonjour')).not.toContain('<Message>');
    expect(await say('START')).toContain('<Message>');
  });
  it('ignores non-North-American and anonymous senders, and replays', async () => {
    expect(await say('hi', { From: 'whatsapp:+33612345678' })).not.toContain('<Message>');
    expect(await say('hi', { From: 'whatsapp:+1900' })).not.toContain('<Message>');
    expect(await say('hi', { From: '' })).not.toContain('<Message>');
    expect(await say('hi', { MessageSid: 'SMdup' })).toContain('<Message>');
    expect(await say('hi', { MessageSid: 'SMdup' })).not.toContain('<Message>');
  });
  it('rate-limits one sender', async () => {
    let replies = 0;
    for (let i = 0; i < 12; i++) if ((await say('hi')).includes('<Message>')) replies++;
    expect(replies).toBe(8);
    expect(await say('hi', { From: 'whatsapp:+15145557777' })).toContain('<Message>');
  });
});
