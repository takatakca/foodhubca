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
    const opts = await say('2');
    expect(opts).toContain('Pi Pita : que voulez-vous faire');
    expect(opts).toContain('1. Commander');
    expect(opts).toContain('0. Changer de marque');
    const next = await say('une pizza svp');
    expect(next).toContain('Pi Pita : message reçu');
    expect(await say('menu')).toContain('Pi Pita : que voulez-vous faire');
    expect(await say('0')).toContain('1. OOeuf');
  });
  it('greets the customer by the first name of his WhatsApp profile, cleaned and never stored', async () => {
    expect(await say('allo', { ProfileName: 'Marie-Ève Tremblay' })).toContain('Bonjour Marie-Ève !');
    expect(await say('1', { ProfileName: 'Marie-Ève Tremblay' })).toContain('Bonjour Marie-Ève !');
    const docs = JSON.stringify([...(globalThis as any).__foodhubMem.docs.get('wa_customers')!.values()]);
    expect(docs).not.toContain('Marie');
    resetWhatsAppState();
    const odd = await say('allo', { ProfileName: '<b>http://evil.example</b>', From: 'whatsapp:+15145556666' });
    expect(odd).toContain('Bonjour ! / Hi!');
    expect(odd).not.toContain('evil');
    expect(odd).not.toContain('<b>');
  });
  it('answers each option, with the brand links when they are set', async () => {
    process.env.FOODHUB_BRAND_LINKS = JSON.stringify({ 'Pi Pita': { order: 'https://on2go.ca/pi-pita', menu: 'https://on2go.ca/pi-pita#menu', hours: '11 h à 23 h, 7 jours' }, OOeuf: { order: 'javascript:alert(1)' } });
    await say('allo');
    await say('2');
    expect(await say('1')).toContain('https://on2go.ca/pi-pita');
    expect(await say('2')).toContain('numéro de commande');
    expect(await say('3')).toContain('https://on2go.ca/pi-pita#menu');
    expect(await say('4')).toContain('11 h à 23 h');
    expect(await say('5')).toContain('une personne vous répond');
    await say('0');
    await say('1');
    expect(await say('1')).not.toContain('javascript');
    delete process.env.FOODHUB_BRAND_LINKS;
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
