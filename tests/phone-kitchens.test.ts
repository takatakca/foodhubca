// AI phone ordering on a line that serves several kitchens (brand@kitchen groups: the same number for NDG and
// Saint-Léonard): the line settings, the agent asking which kitchen (choose_kitchen) before any item, the menu and the
// Clover ticket of the chosen kitchen, a switch that re-checks the cart, the hand-off ringing the chosen kitchen, the
// delivery-area hint — and our own orders (AI phone included) on the kitchen screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveLocation } from '../lib/foodhub/catalog';
import { listKitchenOwnOrders } from '../lib/foodhub/delivery/kitchen';
import { createDirectOrder, runDirectAction } from '../lib/foodhub/delivery/orders';
import { listDirectOrders, saveDeliverySettings } from '../lib/foodhub/delivery/store';
import { setFeature } from '../lib/foodhub/expansion/features';
import { getCall } from '../lib/foodhub/phone/calls';
import { setOrderDetails } from '../lib/foodhub/phone/order';
import { buildPhoneMenu } from '../lib/foodhub/phone/cart';
import { brandLockedAt, cleanLine, getPhoneSettings, isMultiKitchen, kitchenView, lineKitchens, savePhoneSettings } from '../lib/foodhub/phone/settings';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { callerTurn, simulateTurn, startCall } from '../lib/foodhub/phone/voice';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let claude: any[] = [];
let claudeRequests: Array<{ body: any }> = [];

const MENU = (brandName: string): MasterMenu => ({
  brandName, updatedAt: '', posMerchantId: 'MID1',
  categories: [{ ref: 'c1', name: 'Mains', nameFr: 'Plats', sortOrder: 1 }],
  items: [
    { ref: 'i1', name: 'Whole chicken', nameFr: 'Poulet entier', price: 24.99, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
    { ref: 'i3', name: 'Fries', nameFr: 'Frites', price: 4.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] },
  ],
  modifierGroups: [],
  // Fries are sold out (86) at NDG only.
  unavailableByLocation: { NDG: ['i3'] },
});

const MULTI = {
  number: '+15145550177', name: 'TAKATAK', enabled: true, delivery: false,
  // Po Poulet only from Saint-Léonard (owner's lock: never from NDG); Taco Montréal from both kitchens.
  kitchens: [{ locationCode: 'NDG', brands: ['Pi Pita', 'Taco Montréal'] }, { locationCode: 'JT', brands: ['Po Poulet', 'Taco Montréal'] }],
};
const URL_BASE = 'https://hub.test';

function signed(path: string, fields: Record<string, string>) {
  const params = new URLSearchParams(fields);
  const url = `${URL_BASE}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, 'tw-token') }, body: params.toString() });
}
const form = async (req: Request) => new URLSearchParams(await req.text());
const claudeResponse = (content: any[], stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } });
const toolUse = (name: string, input: unknown, id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });
/** The tool results the agent got back in the last request (the last user message). */
const lastToolResults = () => JSON.stringify([...claudeRequests.at(-1)!.body.messages].reverse().find((m: any) => m.role === 'user'));

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_PUBLIC_URL = URL_BASE;
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000' });
  delete process.env.ANTHROPIC_BASE_URL;
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  claude = []; claudeRequests = [];
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('/v1/messages')) {
      claudeRequests.push({ body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(claude.shift() ?? claudeResponse([text('Autre chose ?')])), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/Messages.json')) return new Response('{"sid":"SM1"}', { status: 201 });
    return new Response('{}', { status: 200 });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'Notre-Dame-de-Grâce', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await saveLocation({ code: 'JT', name: 'Saint-Léonard', address: '5839 Rue Jean-Talon E', city: 'Montréal', postalCode: 'H1S 1M2', phone: '514 555-0200', active: true });
  for (const b of ['Po Poulet', 'Pi Pita', 'Taco Montréal']) await getRepo().saveMenu(MENU(b));
  await savePhoneSettings({ lines: [MULTI as any] }, actor);
  await setFeature('phone', true, actor);
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('line settings: brand@kitchen groups', () => {
  it('keeps several kitchens, folds one back into a classic line, and refuses bad groups', () => {
    const multi = cleanLine(MULTI);
    expect(multi).toMatchObject({ locationCode: 'NDG', brands: ['Pi Pita', 'Taco Montréal', 'Po Poulet'], kitchens: MULTI.kitchens });
    expect(isMultiKitchen(multi)).toBe(true);
    expect(kitchenView(multi, 'JT')).toMatchObject({ locationCode: 'JT', brands: ['Po Poulet', 'Taco Montréal'] });
    expect(kitchenView(multi, 'JT')!.kitchens).toBeUndefined();
    expect(kitchenView(multi, 'HOCH')).toBeNull();

    const one = cleanLine({ ...MULTI, kitchens: [{ locationCode: 'JT', brands: ['Po Poulet'] }] });
    expect(one).toMatchObject({ locationCode: 'JT', brands: ['Po Poulet'] });
    expect(one.kitchens).toBeUndefined();
    expect(lineKitchens(one)).toEqual([{ locationCode: 'JT', brands: ['Po Poulet'] }]);
    // A classic line (no kitchens) is unchanged.
    expect(cleanLine({ number: '+15145550199', locationCode: 'NDG', brands: ['Pi Pita'] })).toMatchObject({ locationCode: 'NDG', brands: ['Pi Pita'] });

    expect(() => cleanLine({ ...MULTI, kitchens: [MULTI.kitchens[0], MULTI.kitchens[0]] })).toThrow(/listed twice/);
    expect(() => cleanLine({ ...MULTI, kitchens: [MULTI.kitchens[0], { locationCode: 'JT', brands: [] }] })).toThrow(/at least one brand sold from JT/);
  });

  it('saves and reads the line back with its kitchens', async () => {
    const line = (await getPhoneSettings()).lines[0];
    expect(line.kitchens).toHaveLength(2);
    expect(line.number).toBe('+15145550177');
  });
});

describe('owner lock: Po Poulet never by phone from NDG', () => {
  it('refuses a line that sells Po Poulet from NDG, accepts it from Saint-Léonard', async () => {
    await expect(savePhoneSettings({ lines: [{ ...MULTI, kitchens: [{ locationCode: 'NDG', brands: ['Pi Pita', 'Po Poulet'] }, MULTI.kitchens[1]] } as any] }, actor)).rejects.toThrow(/Po Poulet is never sold by phone from Notre-Dame-de-Grâce/);
    await expect(savePhoneSettings({ lines: [{ number: '+15145550199', name: 'Po Poulet', locationCode: 'NDG', brands: ['Po-Poulet'], enabled: true, delivery: false } as any] }, actor)).rejects.toThrow(/owner's lock/);
    const ok = await savePhoneSettings({ lines: [{ number: '+15145550199', name: 'Po Poulet', locationCode: 'JT', brands: ['Po Poulet'], enabled: true, delivery: false } as any] }, actor);
    expect(ok.lines[0]).toMatchObject({ locationCode: 'JT', brands: ['Po Poulet'] });
    expect(brandLockedAt('Poulet Poulet', undefined, 'NDG')).toBe(false);
  });

  it('a line saved before the lock still never offers Po Poulet at NDG', async () => {
    const menu = await buildPhoneMenu({ locationCode: 'NDG', brands: ['Po Poulet', 'Pi Pita'] });
    expect(menu.text).not.toContain('BRAND: Po Poulet');
    expect(menu.text).toContain('BRAND: Pi Pita');
    expect((await buildPhoneMenu({ locationCode: 'JT', brands: ['Po Poulet'] })).text).toContain('BRAND: Po Poulet');
  });
});

describe('a call on a line with two kitchens', () => {
  it('asks which kitchen first, then takes the order on that kitchen’s menu and sends it there', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA1', From: '+15145551234', To: '+15145550177' })));
    expect((await getCall('CA1'))!.locationCode).toBe('');

    claude = [
      // The model jumps ahead: the tool refuses until a kitchen is chosen.
      claudeResponse([toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i3', quantity: 1, option_refs: [], notes: '' })], 'tool_use'),
      claudeResponse([toolUse('choose_kitchen', { location_code: 'jt' })], 'tool_use'),
      claudeResponse([toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i3', quantity: 2, option_refs: [], notes: '' })], 'tool_use'),
      claudeResponse([text('Deux frites à Saint-Léonard. Votre nom ?')]),
    ];
    const t1 = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', SpeechResult: 'Deux frites Po Poulet à Saint-Léonard' })))).text();
    expect(t1).toContain('Deux frites à Saint-Léonard');
    // First request: the KITCHENS list, no menu yet.
    const sys0 = claudeRequests[0].body.system[1].text as string;
    expect(sys0).toContain('KITCHENS');
    expect(sys0).toContain('location_code=NDG | Notre-Dame-de-Grâce, 6280 Somerled Ave');
    expect(sys0).toContain('location_code=JT | Saint-Léonard, 5839 Rue Jean-Talon E');
    expect(sys0).toContain('brands: Po Poulet, Taco Montréal');
    expect(sys0).not.toContain('item_ref=');
    expect(claudeRequests[0].body.messages[0].content).toMatch(/serves 2 kitchens/);
    expect(JSON.stringify(claudeRequests[1].body.messages.at(-1))).toContain('No kitchen chosen yet');
    // The system prompt never changes during the call (thinking blocks are bound to it): the chosen kitchen's menu
    // arrives as an appended system message, right after the tool results.
    expect(new Set(claudeRequests.map((r) => r.body.system[1].text)).size).toBe(1);
    const msgs = claudeRequests[2].body.messages;
    expect(msgs.at(-2).role).toBe('user');
    expect(msgs.at(-1).role).toBe('system');
    // Saint-Léonard's menu (fries are not 86'd there); Pi Pita (NDG only) is not on it.
    const sys2 = msgs.at(-1).content as string;
    expect(sys2).toContain('Kitchen: Saint-Léonard');
    expect(sys2).toContain('item_ref=i3 | Frites / Fries');
    expect(sys2).toContain('BRAND: Taco Montréal');
    expect(sys2).not.toContain('BRAND: Pi Pita');
    expect(sys2).toContain('other kitchens on this number: location_code=NDG');
    expect(claudeRequests[2].body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(claudeRequests[3].body.messages.at(-1).role).toBe('user');
    const call = (await getCall('CA1'))!;
    expect(call).toMatchObject({ locationCode: 'JT', brands: ['Po Poulet', 'Taco Montréal'] });
    expect(call.cart).toHaveLength(1);

    claude = [
      claudeResponse([toolUse('set_order_details', { customer_name: 'Ana', fulfillment: 'pickup', address: '', address_details: '', callback_phone: '', wanted_time: '' }), toolUse('place_order', { caller_confirmed: true })], 'tool_use'),
      claudeResponse([text('Commande confirmée. Au revoir !'), toolUse('end_call', { reason: 'order placed' })], 'tool_use'),
      claudeResponse([text('Bonne journée !')]),
    ];
    const t2 = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', SpeechResult: 'Ana, pour emporter, oui je confirme' })))).text();
    expect(t2).toContain('<Hangup/>');
    const orders = await listDirectOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ source: 'phone_ai', locationCode: 'JT', brandName: 'Po Poulet', fulfillment: 'pickup' });
    const ended = (await getCall('CA1'))!;
    expect(ended.status).toBe('ordered');
    // The AI history and the frozen prompt are dropped when the call ends; the transcript stays.
    expect(ended.messages).toEqual([]);
    expect(ended.prompt).toBeUndefined();
  });

  it('freezes the system prompt for the whole call: an 86 between turns is enforced by the tools', async () => {
    await savePhoneSettings({ lines: [MULTI as any, { number: '+15145550199', name: 'Po Poulet JT', locationCode: 'JT', brands: ['Po Poulet'], enabled: true, delivery: false } as any] }, actor);
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA7', From: '+15145551234', To: '+15145550199' })));
    claude = [claudeResponse([text('Que puis-je vous préparer ?')])];
    await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA7', SpeechResult: 'Bonjour' })));
    // Fries sell out at Saint-Léonard during the call.
    await getRepo().saveMenu({ ...MENU('Po Poulet'), unavailableByLocation: { NDG: ['i3'], JT: ['i3'] } });
    claude = [
      claudeResponse([toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i3', quantity: 1, option_refs: [], notes: '' })], 'tool_use'),
      claudeResponse([text('Désolé, les frites sont épuisées.')]),
    ];
    await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA7', SpeechResult: 'Des frites' })));
    expect(new Set(claudeRequests.map((r) => r.body.system[1].text)).size).toBe(1);
    expect(claudeRequests[0].body.system[1].text).toContain('item_ref=i3');
    expect(lastToolResults()).toContain('not on the menu right now');
    expect((await getCall('CA7'))!.prompt).toContain('Kitchen: Saint-Léonard');
  });

  it('a switch re-checks the cart: an item sold out at the other kitchen blocks it', async () => {
    const first = await simulateTurn((await getPhoneSettings()).lines[0].id, null, '');
    claude = [
      claudeResponse([toolUse('choose_kitchen', { location_code: 'JT' }), toolUse('add_item', { brand: 'Po Poulet', item_ref: 'i3', quantity: 1, option_refs: [], notes: '' })], 'tool_use'),
      claudeResponse([toolUse('choose_kitchen', { location_code: 'NDG' })], 'tool_use'),
      claudeResponse([text('Les frites ne sont pas disponibles à NDG.')]),
    ];
    await simulateTurn(first.call.lineId, first.call.id, 'Des frites… finalement à NDG');
    expect(lastToolResults()).toContain('Cannot switch to NDG');
    expect((await getCall(first.call.id))!.locationCode).toBe('JT');

    claude = [
      claudeResponse([toolUse('remove_item', { line_number: 1 }), toolUse('add_item', { brand: 'Taco Montréal', item_ref: 'i1', quantity: 1, option_refs: [], notes: '' }), toolUse('choose_kitchen', { location_code: 'NDG' })], 'tool_use'),
      claudeResponse([text('C’est noté, à NDG.')]),
    ];
    await simulateTurn(first.call.lineId, first.call.id, 'Alors un poulet entier à NDG');
    const call = (await getCall(first.call.id))!;
    expect(call.locationCode).toBe('NDG');
    expect(call.cart.map((l) => l.itemRef)).toEqual(['i1']);
    expect(lastToolResults()).toContain('ask pickup or delivery again');
  });

  it('hands off to the first kitchen before a choice, and to the chosen kitchen after it', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA2', From: '+15145551234', To: '+15145550177' })));
    const before = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA2', Digits: '0' })))).text();
    expect(before).toContain('+15145550100</Dial>');

    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA3', From: '+15145551234', To: '+15145550177' })));
    claude = [
      claudeResponse([toolUse('choose_kitchen', { location_code: 'JT' }), toolUse('transfer_to_human', { reason: 'catering order' })], 'tool_use'),
      claudeResponse([text('Je vous transfère.')]),
    ];
    const after = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA3', SpeechResult: 'Un traiteur pour 80 personnes à Saint-Léonard' })))).text();
    expect(after).toContain('+15145550200</Dial>');
  });

  it('delivery outside the chosen kitchen’s area points to the kitchen that delivers there', async () => {
    await setFeature('delivery', true, actor);
    await saveDeliverySettings({ locations: { NDG: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 0, postalPrefixes: ['H4A', 'H4V'], maxAutoFee: 15 }, JT: { enabled: true, autoDispatch: false, leadMinutes: 10, maxDistanceKm: 0, postalPrefixes: ['H1S', 'H1T'], maxAutoFee: 15 } } });
    const line = { ...cleanLine(MULTI), delivery: true };
    const call: any = { id: 'x', lineId: line.id, locationCode: 'NDG', from: '+15145551234', customer: {}, cart: [], transcript: [] };
    const r = await setOrderDetails(call, kitchenView(line, 'NDG')!, { customer_name: 'Ana', fulfillment: 'delivery', address: '5900 Rue Jean-Talon E, Montréal, H1S 1M5', address_details: '', callback_phone: '', wanted_time: '' }, ['JT']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('outside this kitchen');
    expect(r.message).toContain('delivery area of kitchen location_code=JT');
  });
});

describe('our own orders on the kitchen screen', () => {
  it('lists AI phone / website / typed-in orders to cook, Seen once, then Ready and Picked up', async () => {
    const base = { brandName: 'Po Poulet', customer: { name: 'Ana', phone: '+15145551234' }, fulfillment: 'pickup' as const, payment: 'pay_at_pickup' as const, lines: [{ externalId: 'i1', name: 'Poulet entier', quantity: 1, unitPrice: 24.99, total: 24.99, modifiers: [] }] };
    const phone = await createDirectOrder({ ...base, source: 'phone_ai', locationCode: 'JT' }, actor);
    await createDirectOrder({ ...base, brandName: 'Pi Pita', source: 'website', locationCode: 'NDG' }, actor);
    await createDirectOrder({ ...base, source: 'clover_online', locationCode: 'JT', posOrderId: 'CLV9' }, actor);

    expect((await listKitchenOwnOrders()).map((o) => o.source).sort()).toEqual(['phone_ai', 'website']);
    expect((await listKitchenOwnOrders({ locationCodes: ['JT'] })).map((o) => o.id)).toEqual([phone.id]);

    const seen = await runDirectAction(phone.id, 'seen', actor);
    expect(seen.seenAt).toBeTruthy();
    expect((await runDirectAction(phone.id, 'seen', actor)).events.filter((e) => e.type === 'seen')).toHaveLength(1);
    await runDirectAction(phone.id, 'ready', actor);
    expect((await listKitchenOwnOrders({ locationCodes: ['JT'] }))[0].status).toBe('ready');
    await runDirectAction(phone.id, 'picked_up', actor);
    expect(await listKitchenOwnOrders({ locationCodes: ['JT'] })).toHaveLength(0);
  });
});
