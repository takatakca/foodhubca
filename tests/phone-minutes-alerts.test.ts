// TAKATAK Phone on a real call: when the AI's minutes start and stop (never the hold or the person after a transfer),
// the status callback metering the ended call for the kitchen's own Clover merchant, and the low-credit alert ("one
// ping, not a stream") for Anthropic and Twilio. Nothing real is called: fetch is mocked, metering stays a dry run or
// the phone app is not set.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A slow AI turn: while `gate` is set, the agent waits for it, then answers (no Anthropic request).
const agentHold = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock('../lib/foodhub/phone/agent', async (orig) => {
  const real = await orig<typeof import('../lib/foodhub/phone/agent')>();
  return {
    ...real,
    runAgentTurn: async (...args: Parameters<typeof real.runAgentTurn>) => {
      if (!agentHold.gate) return real.runAgentTurn(...args);
      await agentHold.gate;
      const [call, text] = args;
      return { call: { ...call, turns: call.turns + 1, transcript: [...call.transcript, { at: new Date().toISOString(), who: 'caller' as const, text }] }, reply: { say: 'Parfait.', next: 'listen' as const, lang: 'fr' as const } };
    },
  };
});
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

import { saveLocation } from '../lib/foodhub/catalog';
import { setFeature } from '../lib/foodhub/expansion/features';
import { sendSms } from '../lib/foodhub/notify';
import { noteAiFailure, noteAiSuccess, resetAiHealth } from '../lib/foodhub/phone/ai-health';
import { getCall, saveCall } from '../lib/foodhub/phone/calls';
import { creditIncidents, noteCreditRecovered, noteLowCredit, twilioLowBalance } from '../lib/foodhub/phone/credit-alert';
import { meterEndedCall } from '../lib/foodhub/phone/metering';
import { savePhoneSettings } from '../lib/foodhub/phone/settings';
import { twilioSignature } from '../lib/foodhub/phone/twilio';
import { callerTurn, startCall, waitTurn } from '../lib/foodhub/phone/voice';
import { getMinuteRecord } from '../lib/foodhub/pos/clover-phone-minutes';
import { getRepo } from '../lib/foodhub/repo';
import type { MasterMenu } from '../lib/foodhub/types';
import { POST as statusRoute } from '../app/api/foodhub/webhooks/voice/status/route';
import { openAllDay } from './helpers/phone-harness';

const actor = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
const URL_BASE = 'https://hub.test';
// Made-up IDs (public repository).
const KITCHEN_MID = 'TESTMERCH0009';
const LINE = { number: '+15145550199', name: 'Pi Pita NDG', locationCode: 'NDG', brands: ['Pi Pita'], enabled: true, delivery: false };
const MENU: MasterMenu = {
  brandName: 'Pi Pita', updatedAt: '', posMerchantId: KITCHEN_MID,
  categories: [{ ref: 'c1', name: 'Chickens', sortOrder: 1 }],
  items: [{ ref: 'i3', name: 'Fries', price: 4.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }],
  modifierGroups: [],
};

let chat: string[] = [];
let other: string[] = [];
/** Answer of Twilio's Messages.json. */
let smsAnswer: { status: number; body: unknown } = { status: 201, body: { sid: 'SM1' } };
/** The team chat webhook answer (500 = chat down). */
let chatStatus = 200;

function signed(path: string, fields: Record<string, string>) {
  const params = new URLSearchParams(fields);
  const url = `${URL_BASE}${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': twilioSignature(url, params, 'tw-token') }, body: params.toString() });
}
const form = async (req: Request) => new URLSearchParams(await req.text());
const tick = () => new Promise((r) => setTimeout(r, 0));
const creditPings = () => chat.filter((c) => c.includes('Recharger les crédits'));

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  process.env.FOODHUB_PUBLIC_URL = URL_BASE;
  process.env.ALERT_WEBHOOK_URL = 'https://chat.test/hook';
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-test', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tw-token', TWILIO_FROM: '+15145550000' });
  for (const k of ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET', 'FOODHUB_PHONE_METERED_ENABLED', 'CLOVER_PHONE_METERED_MINUTE_ID', 'FOODHUB_OWNER_EMAIL', 'ANTHROPIC_BASE_URL']) delete process.env[k];
  for (const k of ['DELIVERY', 'RETAIL', 'ALCOHOL', 'PHONE']) delete process.env[`FOODHUB_FEATURE_${k}`];
  chat = []; other = []; smsAnswer = { status: 201, body: { sid: 'SM1' } }; chatStatus = 200; agentHold.gate = null;
  globalThis.fetch = vi.fn(async (url: any, init: RequestInit = {}) => {
    const u = String(url);
    if (u.startsWith('https://chat.test/')) {
      if (chatStatus !== 200) return new Response('down', { status: chatStatus });
      chat.push(JSON.parse(String(init.body)).text);
      return new Response('ok', { status: 200 });
    }
    if (u.includes('/Messages.json')) return new Response(JSON.stringify(smsAnswer.body), { status: smsAnswer.status, headers: { 'content-type': 'application/json' } });
    other.push(u);
    return new Response('{}', { status: 200 });
  }) as any;
  await saveLocation({ code: 'NDG', name: 'NDG', address: '6280 Somerled Ave', city: 'Montréal', postalCode: 'H4V 1R9', phone: '514 555-0100', active: true });
  await getRepo().saveMenu(MENU);
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'store-ndg', brandName: 'Pi Pita', locationCode: 'NDG', cloverMerchantId: KITCHEN_MID, autoAccept: false, online: true, meta: {} });
  await savePhoneSettings({ lines: [LINE as any] }, actor);
  await setFeature('phone', true, actor);
  await openAllDay(['NDG']);
  await resetAiHealth();
});
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); agentHold.gate = null; });

describe('AI minutes on a real call', () => {
  it('start when the AI answers, stop when it hands the call to a person', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA1', From: '+15145551234', To: '+15145550199' })));
    const started = (await getCall('CA1'))!;
    expect(started.aiStartedAt).toBeTruthy();
    expect(started.aiEndedAt).toBeUndefined();
    // The caller presses 0: a person takes over; the AI's minutes stop at the transfer.
    const xml = await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA1', Digits: '0' })))).text();
    expect(xml).toContain('<Dial');
    const handed = (await getCall('CA1'))!;
    expect(handed.status).toBe('handoff');
    expect(Date.parse(handed.aiEndedAt!)).toBeGreaterThanOrEqual(Date.parse(handed.aiStartedAt!));
  });

  it('a call that never reached the AI (no AI key) has no AI minutes', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA2', From: '+15145551234', To: '+15145550199' })));
    expect((await getCall('CA2'))!.aiStartedAt).toBeUndefined();
    const res = await statusRoute(signed('/api/foodhub/webhooks/voice/status', { CallSid: 'CA2', CallStatus: 'completed', CallDuration: '240' }));
    expect(res.status).toBe(204);
    await tick(); await tick(); await tick();
    expect(await getMinuteRecord('CA2')).toMatchObject({ state: 'zero', minutes: 0, merchantId: KITCHEN_MID });
  });

  it('the status callback meters the ended call for the kitchen\'s own merchant: AI part only, dry run by default', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA3', From: '+15145551234', To: '+15145550199' })));
    const c = (await getCall('CA3'))!;
    // The AI talked 70 s, then a person took the call for 4 more minutes (Twilio's duration: 310 s).
    await saveCall({ ...c, aiStartedAt: c.startedAt, aiEndedAt: new Date(Date.parse(c.startedAt) + 70_000).toISOString(), status: 'handoff' });
    const res = await statusRoute(signed('/api/foodhub/webhooks/voice/status', { CallSid: 'CA3', CallStatus: 'completed', CallDuration: '310' }));
    expect(res.status).toBe(204);
    await tick(); await tick(); await tick();
    expect(await getMinuteRecord('CA3')).toMatchObject({ state: 'preview', minutes: 2, aiSeconds: 70, merchantId: KITCHEN_MID, wouldBill: false });
    // A second "completed" callback for the same call: still one record, nothing sent.
    expect(await meterEndedCall('CA3')).toMatchObject({ outcome: 'duplicate' });
    expect(other.filter((u) => u.includes('clover'))).toHaveLength(0);
  });

  it('metering on but the phone app not set on this server: not billed, Clover never called', async () => {
    process.env.FOODHUB_PHONE_METERED_ENABLED = 'true';
    process.env.CLOVER_PHONE_METERED_MINUTE_ID = 'METERED01';
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA4', From: '+15145551234', To: '+15145550199' })));
    await statusRoute(signed('/api/foodhub/webhooks/voice/status', { CallSid: 'CA4', CallStatus: 'completed', CallDuration: '30' }));
    await tick(); await tick(); await tick();
    expect(await getMinuteRecord('CA4')).toMatchObject({ state: 'not_billable', reason: 'gate_off', minutes: 1 });
    expect(other.filter((u) => u.includes('clover'))).toHaveLength(0);
  });

  it('console and test calls are never metered; a call still in progress is not metered', async () => {
    await saveCall({ id: 'sim-1', lineId: 'x', lineName: 'x', locationCode: 'NDG', brands: ['Pi Pita'], from: 'console', to: '', lang: 'fr', status: 'ended', startedAt: new Date().toISOString(), aiStartedAt: new Date().toISOString(), durationSec: 120, turns: 0, transcript: [], messages: [], cart: [], customer: {}, simulated: true, updatedAt: new Date().toISOString() });
    expect(await meterEndedCall('sim-1')).toMatchObject({ outcome: 'test_call' });
    expect(await getMinuteRecord('sim-1')).toBeNull();
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA5', From: '+15145551234', To: '+15145550199' })));
    expect(await meterEndedCall('CA5')).toBeNull();
  });

  it('a slow AI turn that ends after the wait hand-off never brings back the minutes of the person', async () => {
    let release!: () => void;
    agentHold.gate = new Promise<void>((r) => { release = r; });
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA6', From: '+15145551234', To: '+15145550199' })));
    // The AI has been on the line for 100 s when the caller speaks.
    const t0 = new Date(Date.now() - 100_000).toISOString();
    await saveCall({ ...(await getCall('CA6'))!, startedAt: t0, aiStartedAt: t0 });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const first = callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA6', SpeechResult: 'deux frites' })));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await (await first).text()).toContain('/wait?n=1');
    for (const n of [1, 2]) {
      const w = waitTurn(await form(signed('/api/foodhub/webhooks/voice/wait', { CallSid: 'CA6' })), n);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await (await w).text()).toContain(`/wait?n=${n + 1}`);
    }
    const last = waitTurn(await form(signed('/api/foodhub/webhooks/voice/wait', { CallSid: 'CA6' })), 3);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await (await last).text()).toContain('<Dial');
    vi.useRealTimers();
    // The AI turn finishes only now, with its copy of the call read before the hand-off.
    release();
    await tick(); await tick(); await tick();
    const after = (await getCall('CA6'))!;
    expect(after.status).toBe('handoff');
    expect(after.aiEndedAt).toBeTruthy();
    expect(after.pending).toBeUndefined();
    // The person talked with the caller: Twilio's duration is 400 s; only the AI's ~100 s count.
    await statusRoute(signed('/api/foodhub/webhooks/voice/status', { CallSid: 'CA6', CallStatus: 'completed', CallDuration: '400' }));
    await tick(); await tick(); await tick();
    expect(await getMinuteRecord('CA6')).toMatchObject({ state: 'preview', minutes: 2 });
  });

  it('the hand-off time survives any older copy of the call saved after it', async () => {
    await startCall(await form(signed('/api/foodhub/webhooks/voice', { CallSid: 'CA7', From: '+15145551234', To: '+15145550199' })));
    const t0 = new Date(Date.now() - 100_000).toISOString();
    const stale = await saveCall({ ...(await getCall('CA7'))!, startedAt: t0, aiStartedAt: t0 });
    expect(await (await callerTurn(await form(signed('/api/foodhub/webhooks/voice/turn', { CallSid: 'CA7', Digits: '0' })))).text()).toContain('<Dial');
    await saveCall(stale); // an older copy (still "active", no AI end) written back over the hand-off
    await statusRoute(signed('/api/foodhub/webhooks/voice/status', { CallSid: 'CA7', CallStatus: 'completed', CallDuration: '400' }));
    await tick(); await tick(); await tick();
    expect(await getMinuteRecord('CA7')).toMatchObject({ state: 'preview', minutes: 2 });
  });
});

describe('low credit: one ping, not a stream', () => {
  const CREDIT = { status: 400, message: 'Your credit balance is too low to access the Anthropic API.' };

  it('Anthropic out of credit: one alert for the incident, however often the breaker re-opens; re-armed after recovery', async () => {
    const t0 = Date.now();
    await noteAiFailure(CREDIT, {}, t0);
    await noteAiFailure(CREDIT, {}, t0 + 1000);
    await noteAiFailure(CREDIT, {}, t0 + 11 * 60_000); // the 10-minute pause ended: the breaker trips again
    await noteAiFailure(CREDIT, {}, t0 + 22 * 60_000);
    expect(creditPings()).toHaveLength(1);
    expect(creditPings()[0]).toMatch(/Phone AI paused/);
    expect(creditPings()[0]).toMatch(/Top up/);
    expect(creditPings()[0]).toMatch(/passe à une personne et le menu ON2GO fonctionne au clavier/); // the fallback is named
    expect((await creditIncidents()).anthropic).toMatchObject({ open: true });
    // Credit is back: the next request works, the incident closes; a later one pings again.
    await noteAiSuccess(t0 + 30 * 60_000);
    expect((await creditIncidents()).anthropic).toMatchObject({ open: false, incident: 1 });
    await noteAiFailure(CREDIT, {}, t0 + 40 * 60_000);
    expect(creditPings()).toHaveLength(2);
    // Other fatal errors keep their own alert per trip (unchanged).
    await resetAiHealth();
    await noteAiFailure({ status: 401, message: 'invalid x-api-key' }, {}, t0 + 50 * 60_000);
    expect(chat.filter((c) => c.includes('the ON2GO line runs on the keypad'))).toHaveLength(1);
    expect(creditPings()).toHaveLength(2);
  });

  it('a test conversation never opens an incident', async () => {
    await noteAiFailure(CREDIT, { test: true });
    expect(creditPings()).toHaveLength(0);
    expect((await creditIncidents()).anthropic).toBeUndefined();
  });

  it('two servers seeing the same incident send one ping', async () => {
    const [a, b] = await Promise.all([noteLowCredit('anthropic', 'credit balance too low'), noteLowCredit('anthropic', 'credit balance too low')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(creditPings()).toHaveLength(1);
    expect(await noteCreditRecovered('anthropic')).toBe(true);
    expect(await noteCreditRecovered('anthropic')).toBe(false); // nothing open: nothing to do
  });

  it('Twilio balance too low: one ping across many failed texts; a bad number is not a credit problem; re-armed by a text that goes out', async () => {
    expect(twilioLowBalance(400, { code: 21211, message: "The 'To' number is not a valid phone number." })).toBe(false);
    expect(twilioLowBalance(401, { code: 20003, message: 'Authenticate' })).toBe(false);
    expect(twilioLowBalance(403, { code: 20005, message: 'Account not active' })).toBe(true);
    smsAnswer = { status: 400, body: { code: 21211, message: "The 'To' number is not a valid phone number." } };
    await sendSms({ to: '+15145551234', body: 'x' }, { purpose: 'test' });
    expect(creditPings()).toHaveLength(0);
    smsAnswer = { status: 400, body: { code: 21606, message: 'Insufficient funds: your account balance is too low.' } };
    for (let i = 0; i < 4; i++) expect((await sendSms({ to: '+15145551234', body: 'x' }, { purpose: 'test' })).ok).toBe(false);
    expect(creditPings()).toHaveLength(1);
    expect(creditPings()[0]).toMatch(/Twilio/);
    expect(creditPings()[0]).toMatch(/paiement se fait au comptoir/);
    smsAnswer = { status: 201, body: { sid: 'SM2' } };
    expect((await sendSms({ to: '+15145551234', body: 'x' }, { purpose: 'test' })).ok).toBe(true);
    expect((await creditIncidents()).twilio).toMatchObject({ open: false, incident: 1 });
    smsAnswer = { status: 400, body: { code: 21606, message: 'Insufficient funds: your account balance is too low.' } };
    await sendSms({ to: '+15145551234', body: 'x' }, { purpose: 'test' });
    expect(creditPings()).toHaveLength(2);
  });

  it('a failed write while opening the incident never silences it', async () => {
    const repo = getRepo();
    const orig = repo.setKv.bind(repo);
    let fail = true;
    const spy = vi.spyOn(repo, 'setKv').mockImplementation(async (k: string, v: unknown) => {
      if (fail && k.startsWith('phone_credit_alert')) { fail = false; throw new Error('database down'); }
      return orig(k, v);
    });
    try {
      expect(await noteLowCredit('anthropic', 'credit balance too low')).toBe(false);
      expect(await noteLowCredit('anthropic', 'credit balance too low')).toBe(true);
    } finally { spy.mockRestore(); }
    expect(creditPings()).toHaveLength(1);
    expect(await noteLowCredit('anthropic', 'credit balance too low')).toBe(false);
  });

  it('nobody took the alert (chat down, no email): tried again on a later failure, at most every 10 minutes', async () => {
    const t0 = Date.now();
    chatStatus = 500;
    expect(await noteLowCredit('twilio', 'HTTP 400 code 21606', t0)).toBe(false);
    expect(await noteLowCredit('twilio', 'HTTP 400 code 21606', t0 + 1000)).toBe(false);
    chatStatus = 200;
    expect(await noteLowCredit('twilio', 'HTTP 400 code 21606', t0 + 10 * 60_000)).toBe(true);
    expect(await noteLowCredit('twilio', 'HTTP 400 code 21606', t0 + 20 * 60_000)).toBe(false);
    expect(creditPings()).toHaveLength(1);
  });

  it('each provider keeps its own incident; an older AI-health copy never leaves the Anthropic incident open', async () => {
    const t0 = Date.now();
    await noteAiFailure(CREDIT, {}, t0);
    await noteLowCredit('twilio', 'HTTP 400 code 21606', t0);
    expect(creditPings()).toHaveLength(2);
    expect(await noteCreditRecovered('twilio')).toBe(true);
    expect((await creditIncidents()).anthropic).toMatchObject({ open: true });
    // An older copy of the AI-health record (no creditLow flag) saved over the newer one.
    await getRepo().setKv('phone_ai_health_v1', { openUntil: 0, transient: [] });
    await noteAiSuccess(t0 + 30 * 60_000);
    expect((await creditIncidents()).anthropic).toMatchObject({ open: false, incident: 1 });
    await noteAiFailure(CREDIT, {}, t0 + 40 * 60_000);
    expect(creditPings()).toHaveLength(3);
  });

  it('names the ordering lines that have no person to go to (their calls are hung up)', async () => {
    await saveLocation({ code: 'VRD', name: 'Verdun', address: '1 rue Test', city: 'Montréal', postalCode: 'H4G 1A1', active: true });
    await savePhoneSettings({ lines: [LINE as any, { ...LINE, number: '+15145550198', name: 'Verdun Pita', locationCode: 'VRD' } as any] }, actor);
    expect(await noteLowCredit('anthropic', 'credit balance too low')).toBe(true);
    expect(creditPings()[0]).toMatch(/no fallback for: Verdun Pita/);
    expect(creditPings()[0]).not.toMatch(/Pi Pita NDG/);
    expect(creditPings()[0]).not.toMatch(/Nothing is lost/);
  });
});
