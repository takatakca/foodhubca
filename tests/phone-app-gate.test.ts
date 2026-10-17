// TAKATAK Phone (the second Clover app) wired into the phone module: the live-call check at the start of an ordering
// call (a refused call is handed to a person, never hung up), the set-up check when a line is switched on (FR / EN
// reason), and the exact old behaviour without CLOVER_PHONE_APP_ID or for our own merchants. Nothing real is called:
// fetch is mocked, and the Clover answer is either the real check (no phone token = not installed) or a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The entitlement answer: the real check unless a test sets `answer` (LAPSED, Clover down…). Every ask is recorded.
const ent = vi.hoisted(() => ({ answer: null as null | ((mid: string, purpose: string) => any), asked: [] as Array<{ mid: string; purpose: string }> }));
vi.mock('../lib/foodhub/pos/clover-entitlement', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/pos/clover-entitlement')>();
  return {
    ...real,
    voiceAiEntitled: async (mid: string, purpose: 'call' | 'setup' = 'call', opts?: { now?: number }) => {
      ent.asked.push({ mid, purpose });
      if (ent.answer) return { billable: false, status: null, inTrial: false, plan: null, planId: null, checkedAt: null, cached: true, ...ent.answer(mid, purpose) };
      return real.voiceAiEntitled(mid, purpose, opts);
    },
  };
});

import { saveLocation } from '../lib/foodhub/catalog';
import { setFeature } from '../lib/foodhub/expansion/features';
import { getCall } from '../lib/foodhub/phone/calls';
import { linePhoneGate, phoneGateMessage } from '../lib/foodhub/phone/gate';
import { getPhoneSettings, savePhoneSettings } from '../lib/foodhub/phone/settings';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { startCall } from '../lib/foodhub/phone/voice';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { resetAiHealth } from '../lib/foodhub/phone/ai-health';
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
const ENV = ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'PHONE_OWN_MERCHANTS', 'CLOVER_PHONE_APP_NAME'];

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
  ent.answer = null; ent.asked = []; outbound = [];
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
    expect(c.handoffReason).toMatch(/TAKATAK Phone not active for kitchen NDG \(not_installed\)/);
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

  it('the check itself failing never drops the call: a person takes it', async () => {
    ent.answer = () => { throw new Error('database down'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const xml = await call('CA1');
    expect(xml).toContain('<Dial');
    expect((await getCall('CA1'))!.handoffReason).toContain('(check_failed)');
    err.mockRestore();
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
    expect(err?.message).toMatch(/TAKATAK Phone n’est pas actif pour Pi Pita Express \(cuisine NDG\) : l’app n’est pas installée pour ce marchand Clover\. La ligne reste éteinte\./);
    expect(err?.message).toMatch(/TAKATAK Phone is not active for Pi Pita Express \(kitchen NDG\): the app is not installed for this Clover merchant\. The line stays off\./);
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
