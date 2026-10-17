// AI phone ordering: cart rules, Twilio signatures and TwiML, the agent's Claude request (model, strict tools, cached
// menu, refusal fallback), a full call that places an order, hand-off to a person, the console simulator — and the
// locked rule: the agent has no tool that can refund, cancel, discount or take a payment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocation } from '../lib/foodhub/catalog';
import { listDirectOrders } from '../lib/foodhub/delivery/store';
import { setFeature } from '../lib/foodhub/expansion/features';
import { TOOLS } from '../lib/foodhub/phone/agent';
import { addToCart, buildPhoneMenu, cartSummary } from '../lib/foodhub/phone/cart';
import { getCall } from '../lib/foodhub/phone/calls';
import { getPhoneSettings, savePhoneSettings } from '../lib/foodhub/phone/settings';
import { GREETING, twilioSignature, verifyTwilio } from '../lib/foodhub/phone/twilio';
import { callerTurn, simulateTurn, startCall } from '../lib/foodhub/phone/voice';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { openAllDay } from './helpers/phone-harness';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let claude: any[] = [];
let claudeRequests: Array<{ body: any; headers: Record<string, string> }> = [];
let sms: string[] = [];

const MENU: MasterMenu = {
  brandName: 'Pi Pita', updatedAt: '', posMerchantId: 'MID1',
  categories: [{ ref: 'c1', name: 'Chickens', nameFr: 'Poulets', sortOrder: 1 }, { ref: 'c2', name: 'Drinks', nameFr: 'Boissons', sortOrder: 2 }],
  items: [
    { ref: 'i1', name: 'Whole chicken', nameFr: 'Poulet entier', price: 24.99, categoryRef: 'c1', available: true, posItemRef: 'CLV1', modifierGroupRefs: ['g1', 'g2'] },
    { ref: 'i2', name: 'Beer', nameFr: 'Bière', price: 7, categoryRef: 'c2', available: true, modifierGroupRefs: [], tags: ['alcohol'] },
    { ref: 'i3', name: 'Fries', nameFr: 'Frites', price: 4.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [
    { ref: 'g1', name: 'Spice', nameFr: 'Épices', min: 1, max: 1, modifiers: [{ ref: 'm1', name: 'Mild', nameFr: 'Doux', price: 0, available: true }, { ref: 'm2', name: 'Piri-piri', price: 0, available: true }] },
    { ref: 'g2', name: 'Sauces', min: 0, max: 2, modifiers: [{ ref: 'm3', name: 'Gravy', nameFr: 'Sauce brune', price: 1.5, available: true }] },
  ],
  unavailableByLocation: { NDG: ['i3'] },
};

const LINE = { number: '+15145550199', name: 'Pi Pita NDG', locationCode: 'NDG', brands: ['Pi Pita'], enabled: true, delivery: false };
const URL_BASE = 'https://hub.test';

function signed(path: string, fields: Record<string, string>) {
  const params = new URLSearchParams(fields);
  const url = `${URL_BASE}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, 'tw-token') }, body: params.toString() });
}
const form = async (req: Request) => new URLSearchParams(await req.text());

function claudeResponse(content: any[], stop_reason = 'end_turn') {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } };
}
const toolUse = (name: string, input: unknown, id = `tu_${name}`) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_PUBLIC_URL = URL_BASE;
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000' });
  delete process.env.ANTHROPIC_BASE_URL;
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  claude = []; claudeRequests = []; sms = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('/v1/messages')) {
      claudeRequests.push({ body: JSON.parse(String(init.body)), headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
      return new Response(JSON.stringify(claude.shift() ?? claudeResponse([text('Autre chose ?')])), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/Messages.json')) { sms.push(new URLSearchParams(String(init.body)).get('Body') ?? ''); return new Response('{"sid":"SM1"}', { status: 201 }); }
    return new Response('{}', { status: 200 });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await getRepo().saveMenu(MENU);
  await savePhoneSettings({ lines: [LINE as any] }, actor);
  await setFeature('phone', true, actor);
  await openAllDay(['NDG']);
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('menu and cart', () => {
  it('reads the live menu: 86s and alcohol left out, required choices enforced', async () => {
    const menu = await buildPhoneMenu(LINE);
    expect(menu.text).toContain('item_ref=i1 | Poulet entier / Whole chicken | 24.99 $');
    expect(menu.text).toContain('choose exactly 1 (REQUIRED)');
    expect(menu.text).not.toContain('i3');
    expect(menu.text).not.toContain('Bière');
    const missing = addToCart(menu, [], { brand: 'Pi Pita', item_ref: 'i1', quantity: 1, option_refs: [], notes: '' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/"Spice" needs exactly 1.*Doux \(m1/);
    const ok = addToCart(menu, [], { brand: 'Pi Pita', item_ref: 'i1', quantity: 2, option_refs: ['m2', 'm3'], notes: 'bien cuit' });
    expect(ok.ok).toBe(true);
    expect(cartSummary(ok.cart)).toContain('2 × Poulet entier (Piri-piri, Sauce brune) — note: bien cuit = 52.98 $');
    expect(addToCart(menu, [], { brand: 'Pi Pita', item_ref: 'i2', quantity: 1, option_refs: [], notes: '' }).ok).toBe(false);
  });
});

describe('Twilio', () => {
  it('accepts only requests signed with the auth token', async () => {
    const params = new URLSearchParams({ CallSid: 'CA1', From: '+15145551234' });
    const sig = twilioSignature(`${URL_BASE}/api/foodhub/webhooks/voice`, params, 'tw-token');
    expect(verifyTwilio(new Headers({ 'x-twilio-signature': sig }), 'http://localhost:3000/api/foodhub/webhooks/voice', params)).toBe(true);
    expect(verifyTwilio(new Headers({ 'x-twilio-signature': sig }), 'http://localhost:3000/api/foodhub/webhooks/voice', new URLSearchParams({ CallSid: 'CA2' }))).toBe(false);
  });

  it('greets in French, offers English, and switches without asking the AI', async () => {
    const res = await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA1', From: '+15145551234', To: '+15145550199' })));
    const xml = await res.text();
    expect(xml).toContain('<Gather input="speech dtmf"');
    expect(xml).toContain('language="fr-CA"');
    expect(xml).toContain('speechModel="googlev2_telephony" speechTimeout="2"');
    // One sentence per voice: the French voice never reads English, and Spanish is offered too.
    expect(xml).toMatch(/<Say voice="Polly.Gabrielle-Neural" language="fr-CA">Bonjour, merci d’avoir appelé Pi Pita NDG\. Je suis l’assistante automatisée\. L’appel est transcrit pour prendre votre commande\. Pour parler à une personne, faites le 0\. Qu’est-ce que je peux vous préparer \?<\/Say>/);
    expect(xml).toMatch(/<Say voice="Polly.Joanna-Neural" language="en-US">For English, press 2\.<\/Say><Say voice="Polly.Lupe-Neural" language="es-US">Para español, marque el 3\.<\/Say>/);
    const en = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', Digits: '2' })))).text();
    expect(en).toContain('language="en-US"');
    expect(claudeRequests).toHaveLength(0);
    expect((await getCall('CA1'))!.lang).toBe('en');
  });

  it('without an AI key (or with the switch off) the call goes straight to the kitchen phone', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const xml = await (await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA9', From: '+15145551234', To: '+15145550199' })))).text();
    expect(xml).toContain('<Dial callerId="+15145550199"');
    expect(xml).toContain('+15145550100</Dial>');
  });
});

describe('the agent', () => {
  it('takes a whole order: tools checked by Food Hub, total confirmed, Clover order + SMS, goodbye', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA1', From: '+15145551234', To: '+15145550199' })));
    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Pi Pita', item_ref: 'i1', quantity: 1, option_refs: [], notes: '' })], 'tool_use'),
      claudeResponse([text('Doux ou piri-piri ?')]),
    ];
    const t1 = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', SpeechResult: 'Un poulet entier svp' })))).text();
    expect(t1).toContain('Doux ou piri-piri ?');
    // The tool result told the AI exactly what was missing.
    expect(JSON.stringify(claudeRequests[1].body.messages.at(-1))).toContain('needs exactly 1');
    const req = claudeRequests[0];
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' }, fallbacks: 'default' });
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(req.body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.body.system[1].text).toContain('item_ref=i1');
    expect(req.body.tools.every((t: any) => t.strict === true && t.input_schema.additionalProperties === false)).toBe(true);
    expect(req.body.messages[0].content).toMatch(/^\[Call started .*Caller ID: known/);

    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Pi Pita', item_ref: 'i1', quantity: 1, option_refs: ['m2'], notes: '' }), toolUse('set_order_details', { customer_name: 'Ana', fulfillment: 'pickup', address: '', address_details: '', callback_phone: '', wanted_time: '' }, 'tu_2')], 'tool_use'),
      claudeResponse([toolUse('view_cart', {})], 'tool_use'),
      claudeResponse([text('Un poulet entier piri-piri, total 28,73 $. Je confirme ?')]),
    ];
    await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', SpeechResult: 'Piri-piri, pour emporter, Ana' })));
    expect(JSON.stringify(claudeRequests.at(-1)!.body.messages.at(-1))).toContain('TOTAL 28.73 $');

    claude = [
      claudeResponse([toolUse('place_order', { caller_confirmed: true, payment: 'counter' })], 'tool_use'),
      claudeResponse([text('Merci d’avoir commandé chez Pi Pita !'), toolUse('end_call', { reason: 'order placed' }, 'tu_end')], 'tool_use'),
      claudeResponse([text('Bonne journée !')]),
    ];
    const t3 = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', SpeechResult: 'Oui' })))).text();
    expect(t3).toContain('<Hangup/>');
    // The order number, the ready time and the payment are said by Food Hub itself (digits only, no "IA-"), then the
    // model's words of every step, in order.
    expect(t3).toMatch(/Votre commande numéro 1001 est confirmée, prête vers \d{1,2} h( \d{2})?, payable au comptoir\. Merci d’avoir commandé chez Pi Pita ! Bonne journée !<\/Say><Hangup\/>/);
    expect(t3).not.toContain('IA-1001');
    const orders = await listDirectOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ source: 'phone_ai', sourceRef: 'CA1', fulfillment: 'pickup', payment: 'pay_at_pickup', total: 28.73, customer: { name: 'Ana', phone: '+15145551234', lang: 'fr' } });
    expect(orders[0].lines[0]).toMatchObject({ name: 'Poulet entier', posItemRef: 'CLV1', modifiers: [{ name: 'Piri-piri' }] });
    expect(sms[0]).toMatch(/commande IA-\d+ reçue — total 28,73 \$/);
    const call = (await getCall('CA1'))!;
    expect(call).toMatchObject({ status: 'ordered', orderNumber: orders[0].number, messages: [] });
    expect(call.usage!.requests).toBe(8);
    expect(call.transcript.some((t) => t.who === 'caller' && t.text === 'Oui')).toBe(true);
  });

  it('never places an unconfirmed order, and hands off on request', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA2', From: '+15145551234', To: '+15145550199' })));
    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Pi Pita', item_ref: 'i1', quantity: 1, option_refs: ['m1'], notes: '' }), toolUse('place_order', { caller_confirmed: false }, 'tu_p')], 'tool_use'),
      claudeResponse([toolUse('transfer_to_human', { reason: 'wants a refund for yesterday' })], 'tool_use'),
      claudeResponse([text('Je vous transfère à un membre de l’équipe.')]),
    ];
    const xml = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA2', SpeechResult: 'Je veux un remboursement' })))).text();
    expect(xml).toContain('<Dial');
    expect(await listDirectOrders()).toHaveLength(0);
    expect((await getCall('CA2'))!).toMatchObject({ status: 'handoff', handoffReason: 'wants a refund for yesterday' });
  });

  it('has no tool that can refund, cancel, discount or take a payment (the link is only checked or texted again)', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(['add_item', 'add_upsell', 'check_payment', 'choose_kitchen', 'end_call', 'place_order', 'remove_item', 'resend_payment_link', 'set_language', 'set_order_details', 'transfer_to_human', 'view_cart']);
    // No tool takes card details: no input field for a card, a CVV or an amount.
    expect(JSON.stringify(TOOLS.map((t) => t.input_schema))).not.toMatch(/card|cvv|amount|refund|discount/i);
  });

  it('the console simulator never sends an order anywhere', async () => {
    const first = await simulateTurn((await getPhoneSettings()).lines[0].id, null, '');
    expect(first.reply.say).toMatch(/^Bonjour/);
    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Pi Pita', item_ref: 'i1', quantity: 1, option_refs: ['m1'], notes: '' }), toolUse('set_order_details', { customer_name: 'Test', fulfillment: 'pickup', address: '', address_details: '', callback_phone: '5145551111', wanted_time: '' }, 'tu_d'), toolUse('place_order', { caller_confirmed: true, payment: 'counter' }, 'tu_p')], 'tool_use'),
      claudeResponse([text('Commande test confirmée.')]),
    ];
    const r = await simulateTurn(first.call.lineId, first.call.id, 'Un poulet doux pour Test, je confirme');
    expect(r.reply.say).toMatch(/^Votre commande numéro TEST est confirmée.*payable au comptoir\. Commande test confirmée\.$/);
    expect(JSON.stringify(claudeRequests.at(-1)!.body.messages.at(-1))).toContain('SIMULATION');
    expect(await listDirectOrders()).toHaveLength(0);
    expect(sms).toHaveLength(0);
  });
});

describe('automated-assistant disclosure and card numbers (legal review 2026-10-16)', () => {
  it('the greeting says automated assistant, transcription and 0 for a person, in French, English and Spanish', () => {
    const fem = { name: 'Léa', gender: 'female' as const };
    const male = { name: '', gender: 'male' as const };
    expect(GREETING.fr('Pi Pita', fem)).toBe('Bonjour, merci d’avoir appelé Pi Pita. Je suis Léa, l’assistante automatisée. L’appel est transcrit pour prendre votre commande. Pour parler à une personne, faites le 0. Qu’est-ce que je peux vous préparer ?');
    expect(GREETING.fr('Pi Pita', male)).toContain('Je suis l’assistant automatisé.');
    expect(GREETING.en('Pi Pita', fem)).toBe('Hello, thank you for calling Pi Pita. I’m Léa, the automated assistant. This call is transcribed to take your order. To speak with a person, press 0. What can I get for you?');
    expect(GREETING.es('Pi Pita', fem)).toBe('Hola, gracias por llamar a Pi Pita. Soy Léa, su asistente automatizada. La llamada se transcribe para tomar su pedido. Para hablar con una persona, marque el 0. ¿Qué le preparamos?');
    expect(GREETING.es('Pi Pita', male)).toContain('Soy su asistente automatizado.');
    for (const g of [GREETING.fr, GREETING.en, GREETING.es]) expect(g('Pi Pita', fem)).not.toMatch(/virtu/i);
  });

  it('the English greeting (key 2) carries the disclosure, and 0 still reaches a person', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA3', From: '+15145551234', To: '+15145550199' })));
    const en = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA3', Digits: '2' })))).text();
    expect(en).toMatch(/I’m the automated assistant\. This call is transcribed to take your order\. To speak with a person, press 0\./);
    const zero = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA3', Digits: '0' })))).text();
    expect(zero).toContain('<Dial callerId="+15145550199"');
    expect(zero).toContain('+15145550100</Dial>');
    expect(claudeRequests).toHaveLength(0);
    expect((await getCall('CA3'))!).toMatchObject({ status: 'handoff', handoffReason: 'Caller pressed 0' });
  });

  it('a card number said on the ordering line is refused, never stored and never sent to the AI', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA4', From: '+15145551234', To: '+15145550199' })));
    const xml = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA4', SpeechResult: 'ma carte c’est 4111 1111 1111 1111' })))).text();
    expect(xml).toMatch(/ne donnez jamais un numéro de carte/);
    expect(xml).toContain('<Gather');
    expect(claudeRequests).toHaveLength(0);
    const stored = JSON.stringify(await getCall('CA4'));
    expect(stored).not.toMatch(/4111/);
    expect(stored).toContain('card number: refused, not kept');
    // Anything that still reaches a transcript (the AI's own words, the simulator) is redacted.
    const sim = await simulateTurn((await getPhoneSettings()).lines[0].id, null, '');
    const r = await simulateTurn(sim.call.lineId, sim.call.id, '5555-5555-5555-4444');
    expect(r.reply.say).toMatch(/ne donnez jamais/);
    expect(JSON.stringify(r.call)).not.toMatch(/5555-5555-5555-4444|5555555555554444/);
    claude = [claudeResponse([text('J’ai noté 4111 1111 1111 1111.')])];
    const t = await simulateTurn(sim.call.lineId, sim.call.id, 'Un poulet');
    expect(JSON.stringify(t.call.transcript)).not.toMatch(/4111 1111/);
    expect(JSON.stringify(t.call.transcript)).toContain('[card number removed]');
    // The AI's own words are redacted in the stored AI history too, not only in the transcript.
    expect(JSON.stringify(t.call)).not.toMatch(/4111/);
  });

  it('a card read in groups with punctuation or double spaces is still refused and never stored', async () => {
    let n = 10;
    for (const said of ['4111, 1111, 1111, 1111', '4111. 1111. 1111. 1111', '4111  1111  1111  1111', 'ma carte: 4111 - 1111 - 1111 - 1111']) {
      const sid = `CA${n++}`;
      await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: sid, From: '+15145551234', To: '+15145550199' })));
      const xml = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: sid, SpeechResult: said })))).text();
      expect(xml).toMatch(/ne donnez jamais un numéro de carte/);
      expect(JSON.stringify(await getCall(sid))).not.toMatch(/4111/);
    }
    expect(claudeRequests).toHaveLength(0);
  });

  it('a card typed one key at a time is refused at the 13th key; the keys already typed are scrubbed; 0 still reaches a person', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA6', From: '+15145551234', To: '+15145550199' })));
    const press = async (d: string) => (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA6', Digits: d })))).text();
    const keys = '4111111111111111'.split('');
    for (const d of keys.slice(0, 12)) expect(await press(d)).not.toMatch(/ne donnez jamais/);
    expect(claudeRequests).toHaveLength(12);
    expect(await press(keys[12])).toMatch(/ne donnez jamais un numéro de carte/);
    // The rest of the card is refused too, and never reaches the AI.
    for (const d of keys.slice(13)) expect(await press(d)).toMatch(/ne donnez jamais/);
    expect(claudeRequests).toHaveLength(12);
    const stored = (await getCall('CA6'))!;
    expect(JSON.stringify(stored)).not.toMatch(/\(pressed \d\)/);
    expect(JSON.stringify(stored)).toContain('card number: refused, not kept');
    expect(stored.transcript.filter((t) => t.text === '(pressed a key)')).toHaveLength(12);
    expect(await press('0')).toContain('+15145550100</Dial>');
  });

  it('a few keys mid-order still go to the AI', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA7', From: '+15145551234', To: '+15145550199' })));
    await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA7', SpeechResult: 'Un poulet entier' })));
    for (const d of ['2', '1']) await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA7', Digits: d })));
    expect(claudeRequests).toHaveLength(3);
    expect(JSON.stringify((await getCall('CA7'))!.transcript)).toContain('(pressed 1)');
  });

  it('"English, I want a chicken" on the greeting: the English notice is said before the answer (call and simulator)', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA8', From: '+15145551234', To: '+15145550199' })));
    claude = [claudeResponse([text('Sure, which spice?')])];
    const xml = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA8', SpeechResult: 'English, I want a chicken' })))).text();
    expect(xml).toMatch(/<Response><Say voice="Polly.Joanna-Neural" language="en-US">I’m the automated assistant\. This call is transcribed to take your order\. To speak with a person, press 0\.<\/Say><Gather[^>]*language="en-US"[^>]*><Say[^>]*>Sure, which spice\?<\/Say>/);
    expect(JSON.stringify(claudeRequests[0].body.messages.at(-1))).toContain('i want a chicken');
    expect((await getCall('CA8'))!.transcript.some((t) => t.who === 'agent' && /automated assistant/.test(t.text))).toBe(true);
    const sim = await simulateTurn((await getPhoneSettings()).lines[0].id, null, '');
    claude = [claudeResponse([text('Sure, which spice?')])];
    const r = await simulateTurn(sim.call.lineId, sim.call.id, 'English, I want a chicken');
    expect(r.reply.say).toBe('I’m the automated assistant. This call is transcribed to take your order. To speak with a person, press 0. Sure, which spice?');
  });

  it('the Spanish words follow the Spanish voice’s gender, not the French one', async () => {
    await savePhoneSettings({ voiceFr: 'Polly.Liam-Neural' }, actor);
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA9', From: '+15145551234', To: '+15145550199' })));
    const es = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA9', Digits: '3' })))).text();
    expect(es).toContain('Soy su asistente automatizada.');
    expect(JSON.stringify((await getCall('CA9'))!.transcript[0])).toContain('l’assistant automatisé');
    await savePhoneSettings({ voiceFr: 'Polly.Gabrielle-Neural', voiceEs: 'Polly.Pedro-Neural' }, actor);
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA10', From: '+15145551234', To: '+15145550199' })));
    expect(await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA10', Digits: '3' })))).text()).toContain('Soy su asistente automatizado.');
  });
});
