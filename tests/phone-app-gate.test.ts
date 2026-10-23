// TAKATAK Phone (the second Clover app) wired into the phone module: the live-call check at the start of an ordering
// call (a refused call is handed to a person, never hung up), the set-up check when a line is switched on (FR / EN
// reason), and the exact old behaviour without CLOVER_PHONE_APP_ID or for our own merchants. Nothing real is called:
// fetch is mocked, and the Clover answer is either the real check (no phone token = not installed) or a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The entitlement answer: the real check unless a test sets `answer` (LAPSED, Clover down…). Every ask is recorded.
const ent = vi.hoisted(() => ({ answer: null as null | ((mid: string, purpose: string) => any), asked: [] as Array<{ mid: string; purpose: string }>, budgets: [] as Array<number | undefined> }));
vi.mock('../lib/foodhub/pos/clover-entitlement', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/pos/clover-entitlement')>();
  return {
    ...real,
    voiceAiEntitled: async (mid: string, purpose: 'call' | 'setup' = 'call', opts?: { now?: number; budgetMs?: number }) => {
      ent.asked.push({ mid, purpose });
      ent.budgets.push(opts?.budgetMs);
      if (ent.answer) return { billable: false, status: null, inTrial: false, plan: null, planId: null, checkedAt: null, cached: true, ...ent.answer(mid, purpose) };
      return real.voiceAiEntitled(mid, purpose, opts);
    },
  };
});

import { saveLocation } from '../lib/foodhub/catalog';
import { setFeature } from '../lib/foodhub/expansion/features';
import { getCall } from '../lib/foodhub/phone/calls';
import { linePhoneGate, phoneGateMessage, phoneGateWords } from '../lib/foodhub/phone/gate';
import { getPhoneSettings, savePhoneSettings } from '../lib/foodhub/phone/settings';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { dialDone, startCall } from '../lib/foodhub/phone/voice';
import { getIvrCall } from '../lib/foodhub/phone/ivr/records';
import { aiPauseWords, phoneReadiness } from '../lib/foodhub/phone/readiness';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { noteAiFailure, resetAiHealth } from '../lib/foodhub/phone/ai-health';
import { openAllDay } from './helpers/phone-harness';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
const URL_BASE = 'https://hub.test';
// Made-up IDs and numbers (public repository).
const KITCHEN_MID = 'TESTMERCH0021';
const SL_MID = 'TESTMERCH0022';
const PH_APP = 'TESTPHONEAPP2';
const LINE = { number: '+15145550199', name: 'Pi Pita NDG', locationCode: 'NDG', brands: ['Pi Pita'], enabled: true, delivery: false, handoffNumber: '+15145550111' };
const MENU: MasterMenu = {
  brandName: 'Pi Pita', updatedAt: '', posMerchantId: KITCHEN_MID,
  categories: [{ ref: 'c1', name: 'Mains', sortOrder: 1 }],
  items: [{ ref: 'i1', name: 'Fries', price: 4.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
};
const ENV = ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'PHONE_OWN_MERCHANTS', 'CLOVER_PHONE_APP_NAME', 'CLOVER_MERCHANT_TOKENS', 'FOODHUB_BILLING_EXEMPT_MERCHANTS', 'FOODHUB_MAIN_PHONE', 'FOODHUB_IVR_HANDOFF_NUMBER'];

let outbound: string[] = [];

function signed(path: string, fields: Record<string, string>) {
  const params = new URLSearchParams(fields);
  const url = `${URL_BASE}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, 'tw-token') }, body: params.toString() });
}
const form = async (req: Request) => new URLSearchParams(await req.text());
async function call(sid: string, to = LINE.number): Promise<string> {
  return (await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: sid, From: '+15145551234', To: to })))).text();
}
const phoneAppOn = () => Object.assign(process.env, { CLOVER_PHONE_APP_ID: PH_APP, CLOVER_PHONE_APP_SECRET: 'phone-secret-test' });

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_PUBLIC_URL = URL_BASE;
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000' });
  for (const k of [...ENV, 'ALERT_WEBHOOK_URL', 'ANTHROPIC_BASE_URL', 'CLOVER_MERCHANT_ID']) delete process.env[k];
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  ent.answer = null; ent.asked = []; ent.budgets = []; outbound = [];
  globalThis.fetch = vi.fn(async (url: any) => { outbound.push(String(url)); return new Response('{}', { status: 200 }); }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await saveLocation({ code: 'SAINT_LEONARD', name: 'SAINT-LÉONARD', address: '5839 Rue Jean-Talon E', city: 'Saint-Léonard', postalCode: 'H1S 1M4', phone: '514 555-0102', active: true });
  await getRepo().saveMenu(MENU);
  await getRepo().saveMenu({ ...MENU, brandName: 'Po Poulet', posMerchantId: SL_MID });
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'store-ndg', brandName: 'Pi Pita', locationCode: 'NDG', cloverMerchantId: KITCHEN_MID, autoAccept: false, online: true, meta: {} });
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'store-sl', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', cloverMerchantId: SL_MID, autoAccept: false, online: true, meta: {} });
  // The line is switched on before the phone app exists on this server (as for the owner's lines today).
  await savePhoneSettings({ lines: [LINE as any] }, actor);
  await setFeature('phone', true, actor);
  await openAllDay(['NDG', 'SAINT_LEONARD']);
  await resetAiHealth();
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV) delete process.env[k]; ent.answer = null; });

const clover = () => outbound.filter((u) => /clover/i.test(u));

describe('live call: unchanged without the phone app, or for our own merchants', () => {
  it('CLOVER_PHONE_APP_ID not set: the AI answers as today and nothing is checked', async () => {
    const xml = await call('CA1');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Dial');
    expect((await getCall('CA1'))!.aiStartedAt).toBeTruthy();
    expect(ent.asked).toHaveLength(0);
    expect(clover()).toHaveLength(0);
    expect(await linePhoneGate(LINE, 'call')).toMatchObject({ ok: true, reason: 'gate_off', merchantId: null });
  });

  it('our own merchant (PHONE_OWN_MERCHANTS): the very same answer as without the app, Clover never asked', async () => {
    const before = await call('CA1');
    phoneAppOn();
    process.env.PHONE_OWN_MERCHANTS = `${KITCHEN_MID}, ${SL_MID}`;
    const after = await call('CA2');
    expect(after).toBe(before);
    expect((await getCall('CA2'))!.aiStartedAt).toBeTruthy();
    expect(ent.asked).toEqual([{ mid: KITCHEN_MID, purpose: 'call' }]);
    expect(clover()).toHaveLength(0);
  });

  it('a kitchen with no Clover merchant of its own is ours: no check, the AI answers', async () => {
    phoneAppOn();
    await saveLocation({ code: 'HOCHE', name: 'Hochelaga', address: '1 Rue Ontario E', city: 'Montréal', postalCode: 'H2L 1M1', phone: '514 555-0103', active: true });
    const g = await linePhoneGate({ locationCode: 'HOCHE', brands: ['Pi Pita'] }, 'call');
    expect(g).toMatchObject({ ok: true, reason: 'no_merchant', merchantId: null });
    expect(ent.asked).toHaveLength(0);
  });
});

describe('live call: gated', () => {
  beforeEach(phoneAppOn);

  it('not installed for the kitchen\'s merchant: handed to the line\'s person with a short message, never hung up, no AI minute', async () => {
    const xml = await call('CA1');
    expect(xml).toContain('Je vous transfère à un membre de notre équipe');
    expect(xml).toMatch(/<Dial [^>]*>\+15145550111<\/Dial>/);
    expect(xml).not.toContain('<Hangup/>');
    expect(xml).not.toContain('<Gather');
    const c = (await getCall('CA1'))!;
    expect(c.status).toBe('handoff');
    expect(c.handoffReason).toMatch(/TAKATAK Phone AI not active for kitchen NDG \(not_installed\)/);
    expect(c.aiStartedAt).toBeUndefined();
    expect(ent.asked).toEqual([{ mid: KITCHEN_MID, purpose: 'call' }]);
  });

  it('no hand-off number on the line: the kitchen\'s own phone rings', async () => {
    await savePhoneSettings({ lines: [{ ...(await getPhoneSettings()).lines[0], handoffNumber: undefined } as any] }, actor);
    const xml = await call('CA1');
    expect(xml).toMatch(/<Dial [^>]*>\+15145550100<\/Dial>/);
    expect(xml).not.toContain('<Hangup/>');
  });

  it('within the grace rules (LAPSED < 7 days, Clover unreachable < 3 days) the AI answers', async () => {
    for (const reason of ['lapsed_grace', 'clover_unreachable_grace', 'trial', 'active']) {
      ent.answer = () => ({ ok: true, reason });
      const xml = await call(`CA-${reason}`);
      expect(xml).toContain('<Gather');
      expect((await getCall(`CA-${reason}`))!.aiStartedAt).toBeTruthy();
    }
  });

  it('past the grace (lapsed, suspended, Clover down too long): a person takes the call', async () => {
    for (const reason of ['lapsed', 'suspended', 'clover_unreachable', 'pending_approval']) {
      ent.answer = () => ({ ok: false, reason });
      const xml = await call(`CA-${reason}`);
      expect(xml).toContain('<Dial');
      expect(xml).not.toContain('<Hangup/>');
      expect((await getCall(`CA-${reason}`))!.handoffReason).toContain(`(${reason})`);
    }
  });

  it('a line with several kitchens: every kitchen must have the app (the caller may pick any of them)', async () => {
    const multi = { ...LINE, number: '+15145550198', name: 'ON2GO Cuisine', kitchens: [{ locationCode: 'NDG', brands: ['Pi Pita'] }, { locationCode: 'SAINT_LEONARD', brands: ['Po Poulet'] }] };
    ent.answer = () => ({ ok: true, reason: 'active' });
    await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, multi as any] }, actor);
    ent.answer = (mid) => (mid === KITCHEN_MID ? { ok: true, reason: 'active' } : { ok: false, reason: 'inactive' });
    const xml = await call('CA1', multi.number);
    expect(xml).toContain('<Dial');
    expect((await getCall('CA1'))!.handoffReason).toMatch(/kitchen SAINT_LEONARD \(inactive\)/);
  });

  it('the check itself failing (database blip): a live call fails open and the AI answers; setting a line up is refused', async () => {
    ent.answer = () => { throw new Error('database down'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const xml = await call('CA1');
    expect(xml).toContain('<Gather');
    expect(xml).not.toContain('<Dial');
    expect((await getCall('CA1'))!.aiStartedAt).toBeTruthy();
    expect(await linePhoneGate(LINE, 'call')).toMatchObject({ ok: true, reason: 'check_failed' });
    expect(await linePhoneGate(LINE, 'setup')).toMatchObject({ ok: false, reason: 'check_failed' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('a refused call on a line with no hand-off number and no kitchen phone: ON2GO voicemail, never just hung up', async () => {
    await saveLocation({ code: 'NDG', name: 'NDG', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: null, active: true });
    await savePhoneSettings({ lines: [{ ...(await getPhoneSettings()).lines[0], handoffNumber: undefined } as any] }, actor);
    const xml = await call('CA1');
    expect(xml).toMatch(/<Record /);
    expect((await getCall('CA1'))!.status).toBe('handoff_missed');
    const ivr = (await getIvrCall('CA1'))!;
    expect(ivr.state).toBe('voicemail');
    expect(JSON.stringify(ivr.transcript)).toMatch(/AI ordering line: no hand-off number and no kitchen phone/);
    // ON2GO's person set (FOODHUB_MAIN_PHONE): that person rings first.
    process.env.FOODHUB_MAIN_PHONE = '+15145550120';
    expect(await call('CA2')).toMatch(/<Dial [^>]*>\+15145550120<\/Dial>/);
  });

  it('the hand-off person does not answer: ON2GO voicemail takes a message', async () => {
    await call('CA1');
    const xml = await (await dialDone(await form(signed('/api/foodhub/webhooks/voice/dial-done', { CallSid: 'CA1', DialCallStatus: 'no-answer' })))).text();
    expect(xml).toMatch(/<Record /);
    expect((await getCall('CA1'))!.status).toBe('handoff_missed');
  });

  it('the owner forgot PHONE_OWN_MERCHANTS: his env merchants (CLOVER_MERCHANT_ID, CLOVER_MERCHANT_TOKENS, exempt) still get the AI', async () => {
    for (const env of [{ CLOVER_MERCHANT_ID: KITCHEN_MID }, { CLOVER_MERCHANT_TOKENS: JSON.stringify({ [KITCHEN_MID]: 'tok' }) }, { FOODHUB_BILLING_EXEMPT_MERCHANTS: `X1, ${KITCHEN_MID}` }]) {
      for (const k of ['CLOVER_MERCHANT_ID', 'CLOVER_MERCHANT_TOKENS', 'FOODHUB_BILLING_EXEMPT_MERCHANTS']) delete process.env[k];
      Object.assign(process.env, env);
      const sid = `CA-${Object.keys(env)[0]}`;
      expect(await call(sid)).toContain('<Gather');
      expect((await getCall(sid))!.aiStartedAt).toBeTruthy();
      expect(await linePhoneGate(LINE, 'setup')).toMatchObject({ ok: true, reason: 'own_merchant' });
    }
    delete process.env.CLOVER_MERCHANT_ID;
  });

  it('a refused live call is logged on the server (not only in the call log)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await call('CA1');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/TAKATAK Phone AI not active for kitchen NDG \(not_installed\) \(merchant TESTMERCH0021\)/);
    warn.mockRestore();
  });

  it('the Clover budget is passed through to the entitlement check', async () => {
    ent.answer = () => ({ ok: true, reason: 'active' });
    await linePhoneGate(LINE, 'call', { budgetMs: 1000 });
    expect(ent.budgets.at(-1)).toBe(1000);
  });
});

describe('readiness (Settings → Expansion → AI phone)', () => {
  it('flags a kitchen whose calls the app check refuses, and names PHONE_OWN_MERCHANTS', async () => {
    phoneAppOn();
    const r = await phoneReadiness();
    const chk = r.checks.find((x) => x.id.startsWith('phone_app_'));
    expect(chk).toMatchObject({ level: 'stop' });
    // The owner reads plain words, in French and in English…
    expect(chk!.fr).toMatch(/TAKATAK Phone AI refusé, car l’app n’est pas installée pour ce marchand Clover\. L’IA ne répond pas, les appels vont à une personne\..*liste de nos restaurants\./);
    expect(chk!.en).toMatch(/TAKATAK Phone AI refused because the app is not installed for this Clover merchant\. The AI does not answer, calls go to a person\..*our restaurants list\./);
    // …and the setting name, the raw code and the merchant number are for the technician (« Détails techniques »).
    for (const s of [chk!.fr, chk!.en]) expect(s).not.toMatch(/PHONE_OWN_MERCHANTS|not_installed|TESTMERCH0021|[a-z]+_[a-z]+/);
    expect(chk!.tech).toBe('PHONE_OWN_MERCHANTS · not_installed · merchant TESTMERCH0021');
    expect(r.ready).toBe(false);
    process.env.PHONE_OWN_MERCHANTS = KITCHEN_MID;
    const ok = (await phoneReadiness()).checks.find((x) => x.id.startsWith('phone_app_'));
    expect(ok).toMatchObject({ level: 'ok', fr: expect.stringMatching(/TAKATAK Phone AI OK \(un de nos restaurants\)\.$/), en: expect.stringMatching(/TAKATAK Phone AI OK \(one of our restaurants\)\.$/) });
    expect(ok!.tech).toBe('own_merchant · merchant TESTMERCH0021');
  });

  it('every answer of the check has plain words, never the bare code', () => {
    const reasons = ['gate_off', 'own_merchant', 'no_merchant', 'not_installed', 'pending_approval', 'active', 'trial', 'lapsed_grace', 'lapsed', 'suspended', 'inactive', 'unknown_status', 'clover_unreachable_grace', 'clover_unreachable', 'check_failed'] as const;
    for (const reason of reasons) {
      const w = phoneGateWords(reason);
      // A code is never the sentence: no snake_case word in either language, and the French never borrows the code.
      for (const s of [w.fr, w.en]) { expect(s.length).toBeGreaterThan(5); expect(s).not.toBe(reason); expect(s).not.toMatch(/[a-z]+_[a-z]+/); }
      expect(w.fr).not.toContain(reason);
      expect(w.fr).not.toBe(w.en);
    }
    expect(phoneGateWords('something_new' as any)).toEqual({ fr: 'Clover a donné une réponse inconnue', en: 'Clover gave an unknown answer' });
  });

  it('a paused AI says why in plain words; the API error goes to the technical details', async () => {
    const now = Date.now();
    await noteAiFailure({ status: 401, message: 'invalid x-api-key' }, {}, now);
    const chk = (await phoneReadiness({ now })).checks.find((x) => x.id === 'ai_breaker');
    expect(chk).toMatchObject({ level: 'stop', fr: 'IA en pause encore 10 min : la clé de l’IA est refusée. Vérifiez la clé et le crédit Anthropic.', en: 'AI paused for 10 more min: the AI key is refused. Check the Anthropic key and credit.' });
    expect(chk!.tech).toBe('authentication refused (401): invalid x-api-key');
    for (const s of [chk!.fr, chk!.en]) expect(s).not.toMatch(/401|authentication|x-api-key/);
  });

  it('each kind of AI failure has its own plain words (FR / EN)', () => {
    const cases: Array<[string | undefined, RegExp, RegExp]> = [
      ['authentication refused (401): bad key', /clé de l’IA est refusée/, /AI key is refused/],
      ['permission denied (403): no access', /n’a pas accès au modèle/, /no access to the chosen model/],
      ['billing / credit (402): Your credit balance is too low', /crédit de l’IA est épuisé/, /AI credit has run out/],
      ['model or endpoint not found (404): x', /modèle d’IA choisi n’existe pas/, /AI model does not exist/],
      ['model refused (400): invalid model', /modèle d’IA choisi n’existe pas/, /AI model does not exist/],
      ['rate limited (429): slow down', /trop de demandes/, /too many AI requests/],
      ['server error (529): overloaded', /erreurs de son côté/, /errors on its side/],
      ['network / timeout: ECONNRESET', /ne répond pas \(réseau ou délai dépassé\)/, /not answering \(network or timeout\)/],
      [undefined, /plusieurs échecs de suite/, /several failures in a row/],
    ];
    for (const [reason, fr, en] of cases) {
      const w = aiPauseWords(reason);
      expect(w.fr).toMatch(fr);
      expect(w.en).toMatch(en);
      for (const s of [w.fr, w.en]) expect(s).not.toMatch(/\(\d{3}\)|ECONNRESET|endpoint/);
    }
  });

  it('no check line at all without the phone app', async () => {
    expect((await phoneReadiness()).checks.some((x) => x.id.startsWith('phone_app_'))).toBe(false);
  });
});

describe('switching a line on (set-up: strict, FR / EN reason)', () => {
  const NEW = { number: '+15145550197', name: 'Pi Pita Express', locationCode: 'NDG', brands: ['Pi Pita'], enabled: true, delivery: false };

  it('without the phone app: a new line is switched on as today, nothing checked', async () => {
    const s = await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, NEW as any] }, actor);
    expect(s.lines.filter((l) => l.enabled)).toHaveLength(2);
    expect(ent.asked).toHaveLength(0);
  });

  it('not installed: refused in French and English, nothing saved', async () => {
    phoneAppOn();
    const before = await getPhoneSettings();
    const err = await savePhoneSettings({ lines: [...before.lines, NEW as any] }, actor).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/TAKATAK Phone AI n’est pas actif pour Pi Pita Express \(cuisine NDG\) : l’app n’est pas installée pour ce marchand Clover\. La ligne reste éteinte\./);
    expect(err?.message).toMatch(/TAKATAK Phone AI is not active for Pi Pita Express \(kitchen NDG\): the app is not installed for this Clover merchant\. The line stays off\./);
    expect((await getPhoneSettings()).lines).toEqual(before.lines);
    expect(ent.asked).toEqual([{ mid: KITCHEN_MID, purpose: 'setup' }]);
  });

  it('a line already on keeps saving; a new line saved off is not checked; switching one back on is', async () => {
    phoneAppOn();
    const cur = (await getPhoneSettings()).lines;
    await savePhoneSettings({ lines: cur.map((l) => ({ ...l, name: 'Pi Pita NDG (renamed)' })) }, actor);
    await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, { ...NEW, enabled: false } as any] }, actor);
    expect(ent.asked).toHaveLength(0);
    const off = (await getPhoneSettings()).lines.map((l) => ({ ...l, enabled: false }));
    await savePhoneSettings({ lines: off }, actor);
    await expect(savePhoneSettings({ lines: off.map((l, i) => (i === 0 ? { ...l, enabled: true } : l)) }, actor)).rejects.toThrow(/is not active for Pi Pita NDG \(renamed\)/);
  });

  it('strict: LAPSED (even within the call grace) and Clover not answering are refused, with their own reason', async () => {
    phoneAppOn();
    const lines = (await getPhoneSettings()).lines;
    ent.answer = (_mid, purpose) => (purpose === 'setup' ? { ok: false, reason: 'lapsed' } : { ok: true, reason: 'lapsed_grace' });
    await expect(savePhoneSettings({ lines: [...lines, NEW as any] }, actor)).rejects.toThrow(/l’abonnement est échu.*the subscription has lapsed/s);
    expect(await call('CA1')).toContain('<Gather'); // the line already on still takes live calls in the grace
    ent.answer = () => ({ ok: false, reason: 'clover_unreachable' });
    await expect(savePhoneSettings({ lines: [...lines, NEW as any] }, actor)).rejects.toThrow(/Clover ne répond pas.*Clover is not answering/s);
  });

  it('our own merchant or an ACTIVE / trial subscription: switched on', async () => {
    phoneAppOn();
    process.env.PHONE_OWN_MERCHANTS = KITCHEN_MID;
    const s = await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, NEW as any] }, actor);
    expect(s.lines.filter((l) => l.enabled)).toHaveLength(2);
    delete process.env.PHONE_OWN_MERCHANTS;
    ent.answer = () => ({ ok: true, reason: 'trial' });
    const third = { ...NEW, number: '+15145550196', name: 'Pi Pita Trois' };
    expect((await savePhoneSettings({ lines: [...s.lines, third as any] }, actor)).lines).toHaveLength(3);
  });

  it('a line already on: reordering its brands or renaming it saves even while the check refuses', async () => {
    phoneAppOn();
    const multi = { ...LINE, id: undefined, number: '+15145550195', name: 'Deux marques', brands: ['Pi Pita', 'Taco Montréal'] };
    process.env.PHONE_OWN_MERCHANTS = KITCHEN_MID;
    await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, multi as any] }, actor);
    delete process.env.PHONE_OWN_MERCHANTS;
    ent.answer = () => ({ ok: false, reason: 'clover_unreachable' });
    ent.asked = [];
    const cur = (await getPhoneSettings()).lines;
    const s = await savePhoneSettings({ lines: cur.map((l) => (l.number === multi.number ? { ...l, brands: ['Taco Montréal', 'Pi Pita'] } : l)) }, actor);
    expect(s.lines.find((l) => l.number === multi.number)!.brands).toEqual(['Taco Montréal', 'Pi Pita']);
    expect(ent.asked).toHaveLength(0);
  });

  it('a kitchen added to a line already on and refused: the message says nothing was saved and the line stays as it was', async () => {
    phoneAppOn();
    ent.answer = (mid) => (mid === KITCHEN_MID ? { ok: true, reason: 'active' } : { ok: false, reason: 'inactive' });
    const cur = (await getPhoneSettings()).lines;
    const grown = cur.map((l) => ({ ...l, kitchens: [{ locationCode: 'NDG', brands: ['Pi Pita'] }, { locationCode: 'SAINT_LEONARD', brands: ['Po Poulet'] }] }));
    const err = await savePhoneSettings({ lines: grown as any }, actor).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/cuisine SAINT_LEONARD.*Les changements ne sont pas enregistrés ; la ligne reste comme avant\./s);
    expect(err?.message).toMatch(/Changes not saved; the line stays as it was\.$/);
    expect(err?.message).not.toMatch(/The line stays off/);
    expect((await getPhoneSettings()).lines).toEqual(cur);
  });

  it('one line may not mix our kitchens with a client\'s (the client\'s subscription would gate ours)', async () => {
    phoneAppOn();
    process.env.PHONE_OWN_MERCHANTS = KITCHEN_MID;
    ent.answer = () => ({ ok: true, reason: 'active' });
    const mixed = { ...LINE, number: '+15145550194', name: 'Mixte', kitchens: [{ locationCode: 'NDG', brands: ['Pi Pita'] }, { locationCode: 'SAINT_LEONARD', brands: ['Po Poulet'] }] };
    const err = await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, mixed as any] }, actor).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/Mixte : une même ligne ne peut pas mêler nos cuisines \(NDG\) et celles d’un client \(SAINT_LEONARD\).*La ligne reste éteinte\./s);
    expect(err?.message).toMatch(/one line cannot mix our kitchens \(NDG\) with a client's \(SAINT_LEONARD\)/);
    // Both ours: allowed.
    process.env.PHONE_OWN_MERCHANTS = `${KITCHEN_MID}, ${SL_MID}`;
    expect((await savePhoneSettings({ lines: [...(await getPhoneSettings()).lines, mixed as any] }, actor)).lines).toHaveLength(2);
  });

  it('the message names the listing (CLOVER_PHONE_APP_NAME) and every reason has words', () => {
    phoneAppOn();
    process.env.CLOVER_PHONE_APP_NAME = 'Phone Test';
    for (const reason of ['not_installed', 'pending_approval', 'lapsed', 'suspended', 'inactive', 'unknown_status', 'clover_unreachable', 'check_failed'] as const) {
      const m = phoneGateMessage({ ok: false, reason, merchantId: KITCHEN_MID, locationCode: 'NDG' }, 'L1');
      expect(m).toMatch(/^Phone Test n’est pas actif pour L1 \(cuisine NDG\) : .+ \/ Phone Test is not active for L1 \(kitchen NDG\): .+$/);
      expect(m).not.toContain(`(${reason})`);
    }
  });
});
