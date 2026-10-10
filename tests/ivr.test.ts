// ON2GO phone menu (IVR): the menu tree and its validation, the greeting and language choice (FR / EN / ES), the AI
// routing (route_to) with the frozen system prompt, the keypad fallback (digits at any time, 0 = person, two
// misunderstandings → keypad menu), the keyword router on French / English / Spanish phrases, the platform order
// (reference record saved BEFORE the <Dial> to the platform's official line; text link when it has no phone line),
// card-number refusal, voicemail (ticket + transcript + email), the hand-off to the ordering agent, the Calls-log
// search, and the Twilio signature check on every new route.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocation } from '../lib/foodhub/catalog';
import { saveDirectOrder } from '../lib/foodhub/delivery/store';
import { setFeature } from '../lib/foodhub/expansion/features';
import { getCall } from '../lib/foodhub/phone/calls';
import { findOwnOrders, IVR_TOOLS, ivrPromptBlock } from '../lib/foodhub/phone/ivr/agent';
import { cleanIvrSettings, DEFAULT_IVR, DEFAULT_TREE, getIvrSettings, OWNER_GREETING, platformHelpUrl, saveIvrSettings, validateTree, type IvrNode } from '../lib/foodhub/phone/ivr/config';
import { tickIvr } from '../lib/foodhub/phone/ivr/engine';
import { callMatches, getIvrCall, IVR_REFS, listPlatformRefs, listTickets, newIvrCall } from '../lib/foodhub/phone/ivr/records';
import { detectPlatform, hasCardNumber, keywordIntent, languageWord, menuSpeech, normalizeOrderId, redactCards } from '../lib/foodhub/phone/ivr/words';
import { savePhoneSettings } from '../lib/foodhub/phone/settings';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { POST as ivrIncoming } from '../app/api/foodhub/webhooks/ivr/route';
import { POST as ivrStep } from '../app/api/foodhub/webhooks/ivr/[step]/route';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const BASE = 'https://hub.test';
const IVR_NUMBER = '+15145550579';
const CALLER = '+15145551234';
const realFetch = globalThis.fetch;
let claude: any[] = [];
let claudeRequests: Array<{ body: any }> = [];
let sms: Array<Record<string, string>> = [];
let emails: any[] = [];

function signed(path: string, fields: Record<string, string>, token = 'tw-token') {
  const params = new URLSearchParams(fields);
  const url = `${BASE}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, token) }, body: params.toString() });
}
const unsigned = (path: string, fields: Record<string, string>) => new Request(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const stepCtx = (step: string) => ({ params: Promise.resolve({ step }) });

async function start(sid = 'CA1', from = CALLER) {
  return (await ivrIncoming(signed('/api/foodhub/webhooks/ivr', { CallSid: sid, From: from, To: IVR_NUMBER }))).text();
}
async function turn(fields: Record<string, string>, sid = 'CA1') {
  return (await ivrStep(signed('/api/foodhub/webhooks/ivr/turn', { CallSid: sid, ...fields }), stepCtx('turn'))).text();
}
async function step(name: string, fields: Record<string, string>, query = '') {
  return ivrStep(signed(`/api/foodhub/webhooks/ivr/${name}${query}`, fields), stepCtx(name));
}

const claudeResponse = (content: any[], stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } });
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `tu_${name}_${Math.random().toString(36).slice(2, 7)}`, name, input });
const text = (t: string) => ({ type: 'text', text: t });
const route = (branch: string, platform = '', order_id = '') => claudeResponse([toolUse('route_to', { branch, platform, order_id, note: '' })], 'tool_use');

const MENU: MasterMenu = {
  brandName: 'Po Poulet', updatedAt: '', posMerchantId: 'MID1',
  categories: [{ ref: 'c1', name: 'Mains', nameFr: 'Plats', sortOrder: 1 }],
  items: [{ ref: 'i1', name: 'Whole chicken', nameFr: 'Poulet entier', price: 24.99, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
};

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_PUBLIC_URL = BASE;
  Object.assign(process.env, {
    ANTHROPIC_API_KEY: 'sk-test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000',
    FOODHUB_IVR_NUMBER: IVR_NUMBER, RESEND_API_KEY: 're_test', AUTH_EMAIL_FROM: 'hub@example.test', FOODHUB_VOICEMAIL_EMAIL: 'team@example.test',
  });
  for (const k of ['ANTHROPIC_BASE_URL', 'FOODHUB_IVR_HANDOFF_NUMBER', 'FOODHUB_MAIN_PHONE', 'TWILIO_MESSAGING_SERVICE_SID']) delete process.env[k];
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  claude = []; claudeRequests = []; sms = []; emails = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('/v1/messages')) {
      claudeRequests.push({ body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(claude.shift() ?? claudeResponse([text('Pouvez-vous préciser ?')])), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/Messages.json')) { sms.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return new Response('{"sid":"SM1"}', { status: 201 }); }
    if (u.includes('/emails')) { emails.push(JSON.parse(String(init.body))); return new Response('{"id":"em_1"}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------

describe('menu tree', () => {
  it('the default tree is valid and covers every branch of the spec', () => {
    expect(validateTree(DEFAULT_TREE)).toEqual([]);
    const ids = DEFAULT_TREE.flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)]);
    for (const id of ['online_problem', 'place_order', 'card_charge', 'platform_ubereats', 'platform_doordash', 'platform_skip', 'billing', 'merchant', 'courier', 'customer_service', 'voicemail', 'person']) expect(ids).toContain(id);
    expect(DEFAULT_IVR.greeting).toEqual(OWNER_GREETING);
    expect(OWNER_GREETING.fr).toBe('Bienvenue au service ON2GO, votre service de livraison numéro un au Canada.');
  });

  it('refuses duplicate keys, 0 for anything but a person, nested submenus, missing labels and unknown actions', () => {
    const tree: IvrNode[] = JSON.parse(JSON.stringify(DEFAULT_TREE));
    tree[1].digit = '1';
    expect(validateTree(tree).join(' ')).toMatch(/key 1 is used twice/);
    const t2: IvrNode[] = JSON.parse(JSON.stringify(DEFAULT_TREE));
    t2[2].digit = '0';
    expect(validateTree(t2).join(' ')).toMatch(/0 is kept/);
    const t3: IvrNode[] = JSON.parse(JSON.stringify(DEFAULT_TREE));
    t3[0].children![0] = { ...t3[0].children![0], action: { kind: 'menu' }, children: [{ ...t3[2], id: 'deep' }] };
    expect(validateTree(t3).join(' ')).toMatch(/cannot hold another submenu/);
    const t4: IvrNode[] = JSON.parse(JSON.stringify(DEFAULT_TREE));
    t4[3].label.es = '';
    expect(validateTree(t4).join(' ')).toMatch(/label missing \(es\)/);
    const t5: any[] = JSON.parse(JSON.stringify(DEFAULT_TREE));
    t5[3].action = { kind: 'refund' };
    expect(validateTree(t5).join(' ')).toMatch(/unknown action/);
    expect(() => cleanIvrSettings({ tree: t5 }, true)).toThrow(/Phone menu/);
    // Lenient read: a broken stored tree falls back to the default instead of breaking the line.
    expect(cleanIvrSettings({ tree: t5 }).tree).toEqual(DEFAULT_TREE);
  });

  it('saves and reads settings (strict checks on numbers, links and email)', async () => {
    await expect(saveIvrSettings({ handoffNumber: 'abc' }, actor)).rejects.toThrow(/Hand-off number/);
    await expect(saveIvrSettings({ links: { ...DEFAULT_IVR.links, merchant: 'http://not-https' } }, actor)).rejects.toThrow(/https/);
    const s = await saveIvrSettings({ handoffNumber: '514 555 0100', mode: 'keypad', greeting: { ...OWNER_GREETING, fr: 'Bienvenue au service ON2GO, votre service de livraison local au Québec.' } }, actor);
    expect(s.handoffNumber).toBe('+15145550100');
    expect(s.mode).toBe('keypad');
    expect((await getIvrSettings()).greeting.fr).toContain('local au Québec');
  });

  it('reads the keypad menu in each language with 0 = person and star = repeat', () => {
    expect(menuSpeech(DEFAULT_TREE, '', 'fr')).toMatch(/^Pour une commande en ligne .*faites le 1\. Pour une commande Uber Eats, DoorDash ou SkipTheDishes, faites le 2\..*Pour parler à quelqu’un, faites le 0\..*étoile/);
    expect(menuSpeech(DEFAULT_TREE, '', 'en')).toMatch(/For billing, press 3\..*For talk to someone, press 0\..*press star/);
    expect(menuSpeech(DEFAULT_TREE, 'platform_order', 'es')).toMatch(/^Pedidos de una aplicación\. Para Uber Eats, marque el 1\. Para DoorDash, marque el 2\./);
  });

  it('platform support lines and help links (each platform its own page)', () => {
    const s = cleanIvrSettings({});
    expect(s.platforms.doordash.phones).toEqual({ fr: '+18556438439', en: '+18554310459', es: '+18558348733' });
    expect(s.platforms.ubereats.phones).toEqual({});
    expect(s.platforms.skip.phones).toEqual({});
    expect(platformHelpUrl(s, 'doordash', 'fr')).toBe('https://help.doordash.com/consumers/s/contactsupport?language=fr_CA');
    expect(platformHelpUrl(s, 'ubereats', 'en')).toBe('https://help.uber.com/ubereats');
  });
});

describe('keyword router (fallback when the AI is off or fails): intent → branch in French, English and Spanish', () => {
  const cases: Array<[string, string, string?]> = [
    ['J’ai un problème avec ma commande', 'online_problem'],
    ['Ma commande est en retard', 'online_problem'],
    ['Je voudrais commander du poulet', 'place_order'],
    ['Je vois des frais sur ma carte de crédit', 'card_charge'],
    ['Ma commande DoorDash est arrivée froide', 'platform_doordash', 'doordash'],
    ['C’est pour une commande Uber Eats', 'platform_ubereats', 'ubereats'],
    ['J’ai une question sur ma facture', 'billing'],
    ['Je veux inscrire mon restaurant', 'merchant'],
    ['Je voudrais devenir livreur', 'courier'],
    ['Je veux parler à quelqu’un', 'person'],
    ['Je veux laisser un message', 'voicemail'],
    ['I have a problem with my order', 'online_problem'],
    ['I’d like to order food for pickup', 'place_order'],
    ['There is a charge on my credit card', 'card_charge'],
    ['My SkipTheDishes order never arrived', 'platform_skip', 'skip'],
    ['I need a receipt for my invoice', 'billing'],
    ['I want to become a driver', 'courier'],
    ['Can I talk to a real person', 'person'],
    ['Tengo un problema con mi pedido', 'online_problem'],
    ['Quiero hacer un pedido', 'place_order'],
    ['Hay un cargo en mi tarjeta', 'card_charge'],
    ['Mi pedido de DoorDash no llegó', 'platform_doordash', 'doordash'],
    ['Quiero trabajar como repartidor', 'courier'],
    ['Quiero hablar con una persona', 'person'],
  ];
  it.each(cases)('%s → %s', (phrase, id, platform) => {
    const r = keywordIntent(phrase, DEFAULT_TREE);
    expect(r?.node.id).toBe(id);
    if (platform) expect(r?.platform).toBe(platform);
  });

  it('language words, platform names, order numbers', () => {
    expect(languageWord('English please')).toBe('en');
    expect(languageWord('español')).toBe('es');
    expect(languageWord('en français')).toBe('fr');
    expect(languageWord('je veux commander du poulet en anglais pour mon ami ce soir')).toBeNull();
    expect(detectPlatform('door dash')).toBe('doordash');
    expect(normalizeOrderId('le numéro de commande c’est D 4 2 A 9')).toBe('D42A9');
    expect(normalizeOrderId('#88231')).toBe('88231');
    expect(normalizeOrderId('euh')).toBeNull();
  });
});

describe('card numbers', () => {
  it('detects real card numbers (Luhn) and leaves phone and order numbers alone', () => {
    expect(hasCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(hasCardNumber('ma carte 5555-5555-5555-4444')).toBe(true);
    expect(hasCardNumber('4111111111111112')).toBe(false);
    expect(hasCardNumber('514 555 1234')).toBe(false);
    expect(hasCardNumber('commande 88231')).toBe(false);
    expect(redactCards('my card is 4111 1111 1111 1111 ok')).toBe('my card is [card number removed] ok');
  });

  it('a caller who starts giving a card number is stopped; nothing reaches the AI, the transcript or the records', async () => {
    await start();
    const r = await turn({ SpeechResult: 'mon numéro de carte est 4111 1111 1111 1111' });
    expect(r).toMatch(/ne donnez jamais un numéro de carte/);
    expect(claudeRequests).toHaveLength(0);
    const call = await getIvrCall('CA1');
    expect(JSON.stringify(call)).not.toMatch(/4111/);
  });

  it('a card number typed as an order number is refused, twice → carries on without a number', async () => {
    await start();
    claude.push(route('platform_doordash', 'doordash'));
    await turn({ SpeechResult: 'C’est pour une commande DoorDash' });
    const r1 = await turn({ Digits: '4111111111111111' });
    expect(r1).toMatch(/ne donnez jamais/);
    const r2 = await turn({ Digits: '4111111111111111' });
    expect(r2).toMatch(/<Dial[^>]*>\+18556438439<\/Dial>/);
    const refs = await listPlatformRefs();
    expect(refs[0].orderId).toBe('');
    expect(JSON.stringify(await getIvrCall('CA1'))).not.toMatch(/4111111111111111/);
  });
});

describe('greeting and language', () => {
  it('greets with the owner’s text and the marketing line in fr-CA, offers English and Spanish in their own voices, then the AI listens', async () => {
    const r = await start();
    expect(r).toMatch(/<Gather input="speech dtmf" numDigits="1" finishOnKey="" action="\/api\/foodhub\/webhooks\/ivr\/turn" method="POST" language="fr-CA"/);
    expect(r).toMatch(/<Say voice="Polly.Gabrielle-Neural" language="fr-CA">Bienvenue au service ON2GO, votre service de livraison numéro un au Canada\. Poulet grillé.*Comment puis-je vous aider \?<\/Say>/);
    expect(r).toMatch(/<Say voice="Polly.Joanna-Neural" language="en-US">For English, say English or press 2\.<\/Say>/);
    expect(r).toMatch(/<Say voice="Polly.Lupe-Neural" language="es-US">Para español, diga español o marque 3\.<\/Say>/);
  });

  it('plays a recorded greeting when an MP3 is set', async () => {
    await saveIvrSettings({ audio: { greeting: { fr: 'https://cdn.example.test/on2go-fr.mp3' }, voicemail: {} } }, actor);
    expect(await start()).toMatch(/<Play>https:\/\/cdn.example.test\/on2go-fr.mp3<\/Play>/);
  });

  it('switches language by voice or keypad: English (en-US) and Spanish (es-US)', async () => {
    await start('CA1');
    const en = await turn({ SpeechResult: 'English' }, 'CA1');
    expect(en).toMatch(/language="en-US"/);
    expect(en).toMatch(/How can I help you\?/);
    expect((await getIvrCall('CA1'))!.lang).toBe('en');
    await start('CA2');
    const es = await turn({ Digits: '3' }, 'CA2');
    expect(es).toMatch(/<Gather[^>]*language="es-US"/);
    expect(es).toMatch(/<Say voice="Polly.Lupe-Neural" language="es-US">Muy bien, en español\. ¿Cómo puedo ayudarle\?<\/Say>/);
  });

  it('the AI can switch the language (set_language) and the next listen uses that language', async () => {
    await start();
    claude.push(claudeResponse([toolUse('set_language', { language: 'es' })], 'tool_use'), claudeResponse([text('Claro. ¿Su pedido fue en línea o en una aplicación?')]));
    const r = await turn({ SpeechResult: 'ola tengo un problema con mi pedido' });
    expect(r).toMatch(/<Gather[^>]*language="es-US"/);
    expect(r).toMatch(/Polly.Lupe-Neural/);
  });
});

describe('AI routing (route_to) with the keypad as fallback', () => {
  it('the AI talks first and routes with a tool; the system prompt is frozen for the whole call', async () => {
    await start();
    claude.push(claudeResponse([text('Bien sûr. Votre commande a été passée sur notre site ou sur une application ?')]));
    const r1 = await turn({ SpeechResult: 'Bonjour, j’ai un souci avec une commande' });
    expect(r1).toMatch(/notre site ou sur une application/);
    claude.push(route('platform_doordash', 'doordash'));
    const r2 = await turn({ SpeechResult: 'Sur DoorDash' });
    expect(r2).toMatch(/Dites ou tapez le numéro de commande DoorDash/);
    expect(r2).toMatch(/finishOnKey="#"/);
    expect(claudeRequests).toHaveLength(2);
    const [a, b] = claudeRequests.map((x) => x.body);
    expect(b.system).toEqual(a.system);
    expect(a.tools.map((t: any) => t.name)).toEqual(IVR_TOOLS.map((t) => t.name));
    expect(a.system[1].text).toContain('platform_doordash');
    const call = await getIvrCall('CA1');
    expect(call!.path.map((p) => p.node)).toContain('platform_doordash');
    expect(call!.state).toBe('order_id');
  });

  it.each([
    ['fr', 'Je voudrais devenir livreur', 'courier'],
    ['en', 'I want to sign up my restaurant', 'merchant'],
    ['es', 'Quiero hablar con alguien', 'person'],
  ])('%s: "%s" → route_to %s', async (lang, phrase, branch) => {
    await saveIvrSettings({ handoffNumber: '+15145550100' }, actor);
    await start();
    if (lang !== 'fr') await turn({ Digits: lang === 'en' ? '2' : '3' });
    claude.push(route(branch));
    if (branch !== 'person') claude.push(claudeResponse([text(lang === 'en' ? 'Great! What is the name of your restaurant?' : 'Super ! Quel est votre nom ?')]));
    const r = await turn({ SpeechResult: phrase });
    const call = await getIvrCall('CA1');
    expect(call!.path.map((p) => p.node)).toContain(branch);
    if (branch === 'person') expect(r).toMatch(/<Dial callerId="\+15145550579"[^>]*>\+15145550100<\/Dial>/);
    else expect(r).toMatch(/<Gather/);
    const code = { fr: 'fr-CA', en: 'en-US', es: 'es-US' }[lang]!;
    expect(r).toContain(`language="${code}"`);
  });

  it('keypad digits work at any time during the AI conversation: 2 → platform submenu, 0 → a person', async () => {
    await saveIvrSettings({ handoffNumber: '+15145550100' }, actor);
    await start();
    claude.push(claudeResponse([text('Comment puis-je vous aider ?')]));
    await turn({ SpeechResult: 'allo' });
    await turn({ Digits: '1' }); // greeting step passed: 1 = online order submenu
    const sub = await turn({ Digits: '*' });
    expect(sub).toMatch(/Commande en ligne\. Pour un problème avec votre commande en ligne, faites le 1\./);
    const person = await turn({ Digits: '0' });
    expect(person).toMatch(/<Dial[^>]*>\+15145550100<\/Dial>/);
  });

  it('two misunderstandings → the short keypad menu', async () => {
    await start();
    claude.push(claudeResponse([toolUse('not_understood', {})], 'tool_use'), claudeResponse([text('Pardon, pouvez-vous répéter en quelques mots ?')]));
    const r1 = await turn({ SpeechResult: 'brrr zzz' });
    expect(r1).toMatch(/répéter/);
    claude.push(claudeResponse([toolUse('not_understood', {})], 'tool_use'));
    const r2 = await turn({ SpeechResult: 'grrr' });
    expect(r2).toMatch(/Je n’ai pas bien compris\. Voici nos options\. Pour une commande en ligne/);
    expect((await getIvrCall('CA1'))!.state).toBe('menu');
  });

  it('an AI error falls back to the keyword router once (no loop back into the AI): link by text, then a message', async () => {
    await start();
    globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
      const u = String(url);
      if (u.includes('/v1/messages')) { claudeRequests.push({ body: JSON.parse(String(init.body)) }); return new Response('{"type":"error","error":{"type":"api_error","message":"down"}}', { status: 500, headers: { 'content-type': 'application/json' } }); }
      if (u.includes('/Messages.json')) { sms.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return new Response('{"sid":"SM1"}', { status: 201 }); }
      return new Response('{}', { status: 200 });
    }) as any;
    const r = await turn({ SpeechResult: 'Je voudrais devenir livreur' });
    expect(r).toMatch(/<Record /);
    expect(r).toMatch(/Je vous ai envoyé le lien officiel par texto/);
    expect(sms[0].Body).toContain('https://on2go.ca/livreurs');
    expect(claudeRequests.length).toBeLessThanOrEqual(2); // one call (+ one SDK retry), never again in the same request
    const call = await getIvrCall('CA1');
    expect(call!.path.map((p) => p.node)).toContain('courier');
    expect(call!.transcript.some((t) => t.text.startsWith('AI fallback'))).toBe(true);
  });

  it('without an AI key, words go to the keyword router, then the keypad', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const g = await start();
    expect(g).toMatch(/Pour le français, faites le 1\./);
    const r = await turn({ SpeechResult: 'Ma commande Uber Eats est en retard' });
    expect(r).toMatch(/numéro de commande Uber Eats/);
    expect(claudeRequests).toHaveLength(0);
  });

  it('keypad-only mode: greeting → 1 français → main menu → 2 platforms → 2 DoorDash', async () => {
    await saveIvrSettings({ mode: 'keypad' }, actor);
    await start();
    const menu = await turn({ Digits: '1' });
    expect(menu).toMatch(/Pour une commande en ligne/);
    const plat = await turn({ Digits: '2' });
    expect(plat).toMatch(/Pour DoorDash, faites le 2/);
    const id = await turn({ Digits: '2' });
    expect(id).toMatch(/numéro de commande DoorDash/);
    expect(claudeRequests).toHaveLength(0);
  });

  it('the AI flows use our own orders only (lookup by caller number) and open tickets', async () => {
    await saveLocation({ code: 'NDG', name: 'Notre-Dame-de-Grâce', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
    const now = new Date().toISOString();
    await saveDirectOrder({ id: 'do_1', number: 'W-1043', source: 'website', brandName: 'Po Poulet', locationCode: 'NDG', customer: { name: 'Ana', phone: CALLER }, fulfillment: 'delivery', lines: [], subtotal: 30, tax: 4.5, deliveryFee: 0, tip: 0, total: 34.5, currency: 'CAD', payment: 'paid', status: 'out_for_delivery', containsAlcohol: false, placedAt: now, createdAt: now, events: [], updatedAt: now } as any);
    expect((await findOwnOrders({ phone: CALLER }))[0].number).toBe('W-1043');
    expect((await findOwnOrders({ orderNumber: 'w 1043' }))[0].number).toBe('W-1043');
    await start();
    claude.push(
      claudeResponse([toolUse('route_to', { branch: 'online_problem', platform: '', order_id: '', note: '' }), toolUse('lookup_order', { order_number: '', use_caller_number: true })], 'tool_use'),
      claudeResponse([toolUse('open_ticket', { category: 'online_order', summary: 'Ana: order W-1043 late, wants a person to call', order_ref: 'W-1043' })], 'tool_use'),
      claudeResponse([text('Votre commande W-1043 de Po Poulet est en route avec le livreur. J’ai noté votre demande.')]),
    );
    const r = await turn({ SpeechResult: 'Ma commande en ligne est en retard' });
    expect(r).toMatch(/en route avec le livreur/);
    expect(JSON.stringify(claudeRequests[1].body.messages)).toMatch(/Order W-1043 \| Po Poulet/);
    const tickets = await listTickets();
    expect(tickets[0]).toMatchObject({ category: 'online_order', orderRef: 'W1043', from: CALLER, status: 'open' });
    const call = await getIvrCall('CA1');
    expect(call!.orderIds).toContain('W-1043');
    expect(call!.brand).toBe('Po Poulet');
  });

  it('send_link texts an ON2GO page from the ON2GO number', async () => {
    await start();
    claude.push(claudeResponse([toolUse('route_to', { branch: 'courier', platform: '', order_id: '', note: '' }), toolUse('send_link', { link: 'courier' })], 'tool_use'), claudeResponse([text('C’est envoyé par texto !')]));
    await turn({ SpeechResult: 'devenir livreur' });
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ To: CALLER, From: IVR_NUMBER });
    expect(sms[0].Body).toBe('ON2GO — Devenir livreur : https://on2go.ca/livreurs');
  });
});

describe('platform orders', () => {
  it('saves the reference record BEFORE the <Dial> to the platform’s official line, and passes the caller’s own number', async () => {
    const put = vi.spyOn(getRepo(), 'putDocs');
    await start();
    claude.push(route('platform_doordash', 'doordash'));
    await turn({ SpeechResult: 'C’est une commande DoorDash' });
    const confirm = await turn({ SpeechResult: 'D 4 2 A 9' });
    expect(confirm).toMatch(/J’ai noté : D, 4, 2, A, 9\./);
    const saves = put.mock.calls.length;
    const r = await turn({ Digits: '1' });
    // The reference was written during this request, before the TwiML with the <Dial> came back.
    const refWrite = put.mock.calls.slice(saves).findIndex((c) => c[0] === IVR_REFS);
    expect(refWrite).toBeGreaterThanOrEqual(0);
    const ref = (await listPlatformRefs())[0];
    expect(ref).toMatchObject({ callId: 'CA1', from: CALLER, platform: 'doordash', orderId: 'D42A9', next: 'transfer', transferredTo: '+18556438439', lang: 'fr' });
    expect(r).toMatch(/Je vous transfère au service à la clientèle de DoorDash/);
    expect(r).toMatch(/<Dial callerId="\+15145551234" timeout="30" action="\/api\/foodhub\/webhooks\/ivr\/dial-done\?kind=platform&amp;ref=[^"]+" method="POST">\+18556438439<\/Dial>/);
    // No other platform is named in what the platform hears or what the caller is told at this step.
    expect(r).not.toMatch(/Uber|Skip/);
    const call = await getIvrCall('CA1');
    expect(call!.refs).toEqual([ref.id]);
    expect(call!.outcome).toBe('platform_transfer');
    const lines = call!.transcript.map((t) => t.text);
    expect(lines.findIndex((l) => l.startsWith('Platform reference saved'))).toBeLessThan(lines.findIndex((l) => l.includes('Je vous transfère')));
  });

  it('a Spanish caller is sent to the Spanish DoorDash line; an unanswered transfer texts DoorDash’s own help page', async () => {
    await start();
    await turn({ Digits: '3' });
    claude.push(route('platform_doordash', 'doordash', '88231'));
    const confirm = await turn({ SpeechResult: 'mi pedido de DoorDash 88231' });
    expect(confirm).toMatch(/Anoté: 8, 8, 2, 3, 1\./);
    const r = await turn({ SpeechResult: 'sí' });
    expect(r).toMatch(/>\+18558348733<\/Dial>/);
    const ref = (await listPlatformRefs())[0];
    const done = await (await step('dial-done', { CallSid: 'CA1', DialCallStatus: 'no-answer' }, `?kind=platform&ref=${ref.id}`)).text();
    expect(done).toMatch(/El servicio de DoorDash no contesta/);
    expect(sms.at(-1)!.Body).toBe('DoorDash — ayuda oficial para su pedido 88231: https://help.doordash.com/consumers/s/contactsupport?language=es_US');
    expect((await listPlatformRefs())[0].next).toBe('sms_link');
  });

  it('Uber Eats has no phone line: the record is saved, its official help link is texted, no <Dial>, no other platform named', async () => {
    await start();
    claude.push(route('platform_ubereats', 'ubereats'));
    await turn({ SpeechResult: 'Uber Eats' });
    await turn({ Digits: '123456' });
    const r = await turn({ Digits: '1' });
    expect(r).not.toMatch(/<Dial/);
    expect(r).toMatch(/Uber Eats n’offre pas de ligne téléphonique/);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ To: CALLER, From: IVR_NUMBER });
    expect(sms[0].Body).toBe('Uber Eats — aide officielle pour votre commande 123456 : https://help.uber.com/ubereats');
    expect(sms[0].Body).not.toMatch(/DoorDash|Skip/);
    expect((await listPlatformRefs())[0]).toMatchObject({ platform: 'ubereats', orderId: '123456', next: 'sms_link' });
  });

  it('pound alone (no order number) still saves the reference and transfers', async () => {
    await start();
    claude.push(route('platform_doordash', 'doordash'));
    await turn({ SpeechResult: 'DoorDash' });
    const r = await turn({});
    expect(r).toMatch(/<Dial/);
    expect((await listPlatformRefs())[0].orderId).toBe('');
  });
});

describe('ordering agent, person, voicemail', () => {
  it('"place an order" hands the same call to the AI ordering agent (voice/turn), in the caller’s language', async () => {
    await saveLocation({ code: 'NDG', name: 'Notre-Dame-de-Grâce', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
    await getRepo().saveMenu(MENU);
    await getRepo().saveMenu({ ...MENU, brandName: 'Pi Pita' });
    await savePhoneSettings({ lines: [{ number: '+15145550177', name: 'Pi Pita', locationCode: 'NDG', brands: ['Pi Pita'], enabled: true, delivery: false } as any] }, actor);
    await setFeature('phone', true, actor);
    await start();
    await turn({ Digits: '2' });
    claude.push(route('place_order'));
    const r = await turn({ SpeechResult: 'I want to order a chicken' });
    expect(r).toMatch(/action="\/api\/foodhub\/webhooks\/voice\/turn"/);
    expect(r).toMatch(/language="en-US"/);
    expect(r).toMatch(/I’ll take your order/);
    const pc = await getCall('CA1');
    expect(pc).toMatchObject({ id: 'CA1', lineName: 'Pi Pita', lang: 'en', from: CALLER, status: 'active' });
    expect((await getIvrCall('CA1'))!.outcome).toBe('order_agent');
  });

  it('no hand-off number → voicemail with live transcription; the message becomes a ticket and is emailed once', async () => {
    await start();
    const r = await turn({ Digits: '0' });
    expect(r).toMatch(/<Start><Transcription name="vm-CA1" languageCode="fr-CA" track="inbound_track"/);
    expect(r).toMatch(/statusCallbackUrl="https:\/\/hub.test\/api\/foodhub\/webhooks\/ivr\/transcript"/);
    expect(r).toMatch(/<Record maxLength="180" playBeep="true"[^>]*action="\/api\/foodhub\/webhooks\/ivr\/voicemail-done"/);
    const done = await (await step('voicemail-done', { CallSid: 'CA1', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1', RecordingSid: 'RE1', RecordingDuration: '14' })).text();
    expect(done).toMatch(/<Stop><Transcription name="vm-CA1"\/><\/Stop>/);
    expect(done).toMatch(/votre message est enregistré/);
    const tk = (await listTickets())[0];
    expect(tk).toMatchObject({ category: 'callback', from: CALLER, status: 'open' });
    expect(emails).toHaveLength(0); // waits for the transcript
    await step('transcript', { CallSid: 'CA1', TranscriptionEvent: 'transcription-content', Final: 'true', TranscriptionData: JSON.stringify({ transcript: 'Bonjour c’est Ana, rappelez-moi svp, ma carte 4111 1111 1111 1111', confidence: 0.9 }) });
    await step('transcript', { CallSid: 'CA1', TranscriptionEvent: 'transcription-stopped' });
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['team@example.test']);
    expect(emails[0].text).toMatch(/Bonjour c’est Ana, rappelez-moi svp/);
    expect(emails[0].text).not.toMatch(/4111/);
    expect(emails[0].text).toMatch(/https:\/\/hub.test\/direct\/ivr\?id=CA1/);
    expect((await listTickets())[0].transcript).toMatch(/rappelez-moi/);
    // Never twice (status callback, tick).
    await step('status', { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '40' });
    await tickIvr(Date.now() + 10 * 60_000);
    expect(emails).toHaveLength(1);
    expect((await getIvrCall('CA1'))).toMatchObject({ status: 'ended', durationSec: 40, outcome: 'voicemail' });
  });

  it('a person who does not answer → voicemail', async () => {
    await saveIvrSettings({ handoffNumber: '+15145550100' }, actor);
    await start();
    await turn({ Digits: '0' });
    const r = await (await step('dial-done', { CallSid: 'CA1', DialCallStatus: 'no-answer' }, '?kind=person')).text();
    expect(r).toMatch(/Personne n’est disponible/);
    expect(r).toMatch(/<Record/);
    expect((await getIvrCall('CA1'))!.outcome).toBe('handoff_missed');
  });
});

describe('Calls log search and the Twilio signature', () => {
  it('finds a call by phone number digits or by order number', () => {
    const c = { ...newIvrCall('CA9', CALLER, IVR_NUMBER), orderIds: ['D42A9'] };
    expect(callMatches(c, [], [], '1234')).toBe(true);
    expect(callMatches(c, [], [], '(514) 555-1234')).toBe(true);
    expect(callMatches(c, [], [], 'd42a9')).toBe(true);
    expect(callMatches(c, [], [], '9999')).toBe(false);
    expect(callMatches(c, [{ id: 'r', callId: 'CA9', at: '', from: CALLER, lang: 'fr', platform: 'skip', orderId: 'SK777', next: 'sms_link' }], [], 'SK777')).toBe(true);
  });

  it('every new route refuses an unsigned or wrongly signed request', async () => {
    expect((await ivrIncoming(unsigned('/api/foodhub/webhooks/ivr', { CallSid: 'CA1', From: CALLER, To: IVR_NUMBER }))).status).toBe(403);
    for (const s of ['turn', 'wait', 'dial-done', 'voicemail-done', 'recording', 'transcript', 'status', 'nope']) {
      expect((await ivrStep(unsigned(`/api/foodhub/webhooks/ivr/${s}`, { CallSid: 'CA1' }), stepCtx(s))).status).toBe(403);
      expect((await ivrStep(signed(`/api/foodhub/webhooks/ivr/${s}`, { CallSid: 'CA1' }, 'wrong-token'), stepCtx(s))).status).toBe(403);
    }
    expect((await ivrStep(signed('/api/foodhub/webhooks/ivr/nope', { CallSid: 'CA1' }), stepCtx('nope'))).status).toBe(404);
  });

  it('the AI prompt block lists the branches and says what the caller ID allows', () => {
    const block = ivrPromptBlock(cleanIvrSettings({}), { from: 'anonymous' }, Date.parse('2026-10-09T15:00:00Z'));
    expect(block).toMatch(/- online_order \[submenu/);
    expect(block).toMatch(/ {2}- platform_skip \[platform order \(SkipTheDishes\)\]/);
    expect(block).toMatch(/DoorDash: the menu transfers to its official support line/);
    expect(block).toMatch(/Uber Eats: no public phone line/);
    expect(block).toMatch(/Caller ID: hidden/);
  });
});
