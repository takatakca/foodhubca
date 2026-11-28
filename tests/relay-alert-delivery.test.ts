import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { POST as incidentAction } from '../app/api/foodhub/incidents/route';
import { GET as callStatus } from '../app/api/foodhub/messages/call-status/route';
import { GET as messages } from '../app/api/foodhub/messages/route';
import { POST as heartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import { GET as watchSettingsRead, PUT as watchSettingsWrite } from '../app/api/foodhub/watch/settings/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { enrollDevice, heartbeat as tabletHeartbeat } from '../lib/foodhub/identity/devices';
import type { OutboxEntry } from '../lib/foodhub/notify';
import type { CallStatus } from '../lib/foodhub/notify/call-status';
import { getRepo, type Doc } from '../lib/foodhub/repo';
import { addScreen, getScreen, updateScreen, type Heartbeat, type ScreenPlatform } from '../lib/foodhub/screens';
import { INCIDENTS, actOnIncident, getIncident, listIncidents, runWatch, saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';
import { WATCH_BACKGROUND_COMPLETION_KEY, type Incident } from '../lib/foodhub/watch/types';

const BASE = 'https://hub.example.test/api/foodhub';
const RELAY_TOKEN = 'test-relay-token-for-alert-delivery';
const CRON_TOKEN = 'test-cron-token-for-alert-delivery';
const OWNER_PASSWORD = 'test-owner-alert-delivery-password';
const OWNER: Actor = { username: 'owner', name: 'Test owner', source: 'dashboard' };
const KITCHEN = 'NDG_6284';
const KITCHEN_PHONE = '+15145550123';
const SHARED_PHONE = '+15145550124';
const TWILIO_FROM = '+15145550125';
const TWILIO_ACCOUNT = `AC${'1'.repeat(32)}`;
const TWILIO_TOKEN = 'test-twilio-alert-delivery-token';
const TWILIO_BASE = 'https://twilio.example.test';
const CALLS = `${TWILIO_BASE}/2010-04-01/Accounts/${TWILIO_ACCOUNT}/Calls`;
const CALL_SID = `CA${'2'.repeat(32)}`;
const TWILIO_AUTH = `Basic ${Buffer.from(`${TWILIO_ACCOUNT}:${TWILIO_TOKEN}`).toString('base64')}`;
const START = Date.parse('2026-11-26T17:00:00Z');
const fetchMock = vi.fn<typeof fetch>();

function advanceTo(minute: number) {
  vi.setSystemTime(START + minute * 60_000);
}

function relayRequest(screen: Heartbeat['screens'][number], token = RELAY_TOKEN) {
  return heartbeat(new Request(`${BASE}/screens/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ version: 'test-relay-v2', screens: [screen] }),
  }));
}

async function reportScreen(id: string, platform: ScreenPlatform, waiting: number) {
  const response = await relayRequest(platform === 'doordash'
    ? { id, state: 'ok', mode: 'android', waiting }
    : { id, state: 'ok', title: waiting ? `(${waiting}) Orders` : 'Orders' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, unknown: [], commands: [] });
}

function cronRequest(token = CRON_TOKEN) {
  return cronWatch(new NextRequest(`${BASE}/cron/watch`, { headers: { authorization: `Bearer ${token}` } }));
}

async function runCron(): Promise<WatchReport> {
  const response = await cronRequest();
  expect(response.status).toBe(200);
  const { report }: { report: WatchReport } = await response.json();
  expect(report).toMatchObject({ trigger: 'cron', ran: true });
  return report;
}

function ownerRequest(path: string) {
  return new Request(`${BASE}/${path}`, {
    headers: { authorization: `Basic ${Buffer.from(`owner:${OWNER_PASSWORD}`).toString('base64')}` },
  });
}

async function readOutbox(): Promise<OutboxEntry[]> {
  const response = await messages(ownerRequest('messages'), undefined);
  expect(response.status).toBe(200);
  return (await response.json()).messages;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  advanceTo(0);
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto', LIVE_CONNECTORS_GLOBAL_ENABLED: 'false',
    FOODHUB_CLOVER_WEBSITE_ORDERS: 'off', FOODHUB_MEV_CLOVER_REGISTER: 'off', TGTG_IMAP_HOST: '',
    FOODHUB_SCREENS_VIEW_HOSTS: 'relay.example.test', FOODHUB_SCREENS_AGENT_TOKEN: RELAY_TOKEN,
    CRON_SECRET: CRON_TOKEN, DASHBOARD_PASSWORD: OWNER_PASSWORD,
    TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT, TWILIO_AUTH_TOKEN: TWILIO_TOKEN, TWILIO_FROM, TWILIO_BASE_URL: TWILIO_BASE,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('Unexpected external fetch in relay alert test'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Screen relay alerts without a console open', () => {
  const scenarios = (['doordash', 'ubereats', 'skip'] as const).flatMap((platform) => [
    { platform, kind: 'screen_waiting', detectedAt: 2 },
    { platform, kind: 'screen_down', detectedAt: 6 },
  ]);

  const offlineScreen = { platform: 'skip' as const, kind: 'screen_down', detectedAt: 6 };

  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  async function prepareZeroMinuteScreenCall() {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: SHARED_PHONE, smsAfterMin: 0, postToChat: false, aiExplain: false }, OWNER);
    const screen = await addScreen({ name: 'Test platform screen', platform: 'skip', locationCode: KITCHEN, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    await reportScreen(screen.id, 'skip', 0);
    advanceTo(6);
    return screen.id;
  }

  it('leaves disabled Watchtower and its prior markers untouched when the settings read fails', async () => {
    await prepareZeroMinuteScreenCall();
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: KITCHEN_PHONE });
    await saveWatchSettings({ enabled: false, screenAlertPhone: SHARED_PHONE }, OWNER);
    const repo = getRepo();
    const prior = { at: new Date(START).toISOString(), trigger: 'timer' };
    await repo.setKv('watch:last', prior);
    await repo.setKv(WATCH_BACKGROUND_COMPLETION_KEY, prior);

    const getKv = repo.getKv.bind(repo);
    const read = vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
      if (key === 'watch:settings') throw new Error('Synthetic settings read failure');
      return getKv(key);
    });
    try {
      expect((await cronRequest()).status).toBe(500);
      advanceTo(8);
      await expect(runWatch({ trigger: 'timer' })).rejects.toThrow('Synthetic settings read failure');
    } finally {
      read.mockRestore();
    }
    expect(await getKv('watch:last')).toEqual(prior);
    expect(await getKv(WATCH_BACKGROUND_COMPLETION_KEY)).toEqual(prior);
    expect(await getKv('watch:settings')).toMatchObject({ enabled: false, screenAlertPhone: SHARED_PHONE });
    expect(await listIncidents()).toEqual([]);
    expect(await readOutbox()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns unavailable without displaying defaults or overwriting saved settings on read failure', async () => {
    await saveWatchSettings({ enabled: false, screenAlertPhone: SHARED_PHONE }, OWNER);
    const repo = getRepo();
    const getKv = repo.getKv.bind(repo);
    const persisted = await getKv('watch:settings');
    const read = vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
      if (key === 'watch:settings') throw new Error('Synthetic settings read failure');
      return getKv(key);
    });
    const request = ownerRequest('watch/settings');
    try {
      for (const response of [await watchSettingsRead(request, undefined), await watchSettingsWrite(new Request(request, {
        method: 'PUT', body: JSON.stringify({ settings: { smsAfterMin: 4 } }),
      }), undefined)]) {
        expect(response.status).toBe(503);
        expect(await response.json()).not.toHaveProperty('settings');
      }
    } finally {
      read.mockRestore();
    }
    expect(await getKv('watch:settings')).toEqual(persisted);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues to use defaults when no settings have ever been saved', async () => {
    const repo = getRepo();
    expect(await repo.getKv('watch:settings')).toBeNull();
    const request = ownerRequest('watch/settings');
    const read = await watchSettingsRead(request, undefined);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ settings: { enabled: true, smsAfterMin: 2, screenAlertPhone: null } });

    expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
    expect(await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY)).toMatchObject({ trigger: 'cron' });
    const saved = await watchSettingsWrite(new Request(request, {
      method: 'PUT', body: JSON.stringify({ settings: { smsAfterMin: 4 } }),
    }), undefined);
    expect(saved.status).toBe(200);
    expect(await repo.getKv('watch:settings')).toMatchObject({ enabled: true, smsAfterMin: 4, screenAlertPhone: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not redial a zero-minute screen call after interruption saving its incident', async () => {
    await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    const repo = getRepo();
    const replaceDoc = repo.replaceDocIfRevision.bind(repo);
    const save = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, expected) => {
      if (collection === INCIDENTS && (doc.data as Incident).steps.some((step) => step.kind === 'call')) {
        throw new Error('Synthetic interruption persisting the incident after its call');
      }
      return replaceDoc(collection, doc, expected);
    });
    try {
      expect((await cronRequest()).status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      save.mockRestore();
    }

    advanceTo(7);
    await runCron();
    const evidence = (await readOutbox()).filter((entry) => entry.channel === 'call');
    expect(evidence.map((entry) => entry.incidentId)).toEqual([evidence[0]?.incidentId]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listIncidents({ status: ['open'] })).toHaveLength(1);
  });

  it('does not redial a zero-minute screen call during an overlapping Watchtower tick', async () => {
    await prepareZeroMinuteScreenCall();
    const whenFirstCallStarts = gate();
    const letFirstCallFinish = gate();
    fetchMock.mockImplementationOnce(async () => {
      whenFirstCallStarts.resolve();
      await letFirstCallFinish.promise;
      return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
    }).mockResolvedValueOnce(Response.json({ sid: `CA${'3'.repeat(32)}`, status: 'queued' }, { status: 201 }));
    const firstTick = runWatch({ trigger: 'timer' });
    try {
      await whenFirstCallStarts.promise;
      expect(await runWatch({ trigger: 'manual', force: true, now: Date.now() + 59_000 })).toMatchObject({ ran: false });
      advanceTo(7);
      await runWatch({ trigger: 'manual', force: true });
    } finally {
      letFirstCallFinish.resolve();
      await firstTick;
    }

    const evidence = (await readOutbox()).filter((entry) => entry.channel === 'call');
    expect(evidence.map((entry) => entry.incidentId)).toEqual([evidence[0]?.incidentId]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listIncidents({ status: ['open'] })).toHaveLength(1);
  });

  it('calls the owner who opted into urgent voice and opted out of SMS', async () => {
    await prepareZeroMinuteScreenCall();
    await saveWatchSettings({ callAfterMin: 1, ownerAfterMin: 2 }, OWNER);
    const managerPhone = '+15145550126';
    const callOnlyPhone = '+15145550127';
    const smsOnlyPhone = '+15145550128';
    const offDutyPhone = '+15145550129';
    const otherKitchenPhone = '+15145550130';
    const repo = getRepo();
    await repo.saveUser({ username: 'manager', name: 'Manager', role: 'manager', locations: [KITCHEN], active: true, phone: managerPhone });
    await repo.saveUser({ username: 'voice-owner', name: 'Voice only owner', role: 'owner', locations: [KITCHEN], active: true,
      phone: callOnlyPhone, prefs: { onDuty: true, alertSms: false, alertCall: true } });
    await repo.saveUser({ username: 'sms-owner', name: 'SMS only owner', role: 'owner', locations: [KITCHEN], active: true,
      phone: smsOnlyPhone, prefs: { onDuty: true, alertSms: true, alertCall: false } });
    await repo.saveUser({ username: 'off-duty-owner', name: 'Off duty owner', role: 'owner', locations: [KITCHEN], active: true,
      phone: offDutyPhone, prefs: { onDuty: false, alertSms: true, alertCall: true } });
    await repo.saveUser({ username: 'other-kitchen-owner', name: 'Other kitchen owner', role: 'owner', locations: ['OTHER_KITCHEN'], active: true,
      phone: otherKitchenPhone, prefs: { onDuty: true, alertSms: true, alertCall: true } });
    const sent: { channel: 'call' | 'sms'; to: string | null }[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(TWILIO_BASE);
      expect(url.pathname).toMatch(/\/(Calls|Messages)\.json$/);
      const channel = url.pathname.endsWith('Calls.json') ? 'call' : 'sms';
      sent.push({ channel, to: new URLSearchParams(String(init?.body)).get('To') });
      return Response.json({ sid: channel === 'call' ? CALL_SID : 'SMsimulated' }, { status: 201 });
    });

    await runCron();
    const [incident] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    await runCron();
    expect(sent).toContainEqual({ channel: 'call', to: managerPhone });
    expect(await getIncident(incident.id)).toMatchObject({ level: 2 });
    const mark = sent.length;
    advanceTo(8);
    await runCron();
    const ownerLevel = (await getIncident(incident.id))?.level;
    const ownerMessages = (await readOutbox()).filter((entry) => entry.incidentId === incident.id && entry.purpose === 'alert_owner');
    advanceTo(9);
    await runCron();
    const observed = { messages: sent.slice(mark).sort((a, b) => a.channel.localeCompare(b.channel)), ownerLevel,
      outbox: ownerMessages.map((entry) => entry.channel).sort() };
    expect(observed).toEqual({ messages: [{ channel: 'call', to: callOnlyPhone }, { channel: 'sms', to: smsOnlyPhone }], ownerLevel: 3,
      outbox: ['call', 'sms'] });
  });

  it.each([
    { scenario: 'a changed line matches the manager', nextLine: KITCHEN_PHONE, managerPhone: KITCHEN_PHONE, recipient: KITCHEN_PHONE },
    { scenario: 'the same destination has different formatting', nextLine: '514.555.0124', managerPhone: '(514) 555-0124', recipient: null },
    { scenario: 'a changed line leaves the original number with the manager', nextLine: KITCHEN_PHONE, managerPhone: SHARED_PHONE, recipient: null },
    { scenario: 'the first provider outcome was uncertain', nextLine: KITCHEN_PHONE, managerPhone: KITCHEN_PHONE, recipient: KITCHEN_PHONE, uncertain: true },
    { scenario: 'the historical claim has no destination', nextLine: KITCHEN_PHONE, managerPhone: KITCHEN_PHONE, recipient: KITCHEN_PHONE, legacy: true },
    { scenario: 'the claim receipt is briefly inaccessible', nextLine: KITCHEN_PHONE, managerPhone: KITCHEN_PHONE, recipient: KITCHEN_PHONE, readError: true },
  ])('uses the recorded first-call destination when $scenario', async ({ nextLine, managerPhone, recipient, uncertain, legacy, readError }) => {
    await prepareZeroMinuteScreenCall();
    await saveWatchSettings({ screenAlertPhone: null, callAfterMin: 2, ownerAfterMin: 3 }, OWNER);
    const repo = getRepo();
    await repo.saveUser({ username: 'manager', name: 'On duty manager', role: 'manager', locations: [KITCHEN], phone: managerPhone, active: true, prefs: { alertSms: false } });
    const destinations: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(TWILIO_BASE);
      expect(url.pathname).toMatch(/Calls\.json$/);
      destinations.push(new URLSearchParams(String(init?.body)).get('To') ?? '');
      const sid = uncertain && destinations.length === 1 ? undefined : `CA${destinations.length.toString(16).padStart(32, '0')}`;
      return Response.json({ sid, status: 'queued' }, { status: 201 });
    });
    await runCron();
    const [incident] = await listIncidents({ status: ['open'] });
    expect(incident).toMatchObject({ level: 1, screenFirstCallPending: true });

    advanceTo(7);
    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    const replaceDoc = repo.replaceDocIfRevision.bind(repo);
    const save = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, expected) => {
      if (collection === INCIDENTS && doc.id === incident.id && (doc.data as Incident).steps.some((entry) => entry.kind === 'call')) {
        throw new Error('Synthetic crash before saving the first-call outcome to the incident');
      }
      return replaceDoc(collection, doc, expected);
    });
    try {
      expect((await cronRequest()).status).toBe(500);
    } finally {
      save.mockRestore();
    }
    expect(destinations).toEqual([SHARED_PHONE]);
    expect(await getIncident(incident.id)).toMatchObject({ level: 1, screenFirstCallPending: true });
    const firstCallKey = `watch:first-screen-call:${incident.id}`;
    const receipt = await repo.getKv(firstCallKey);
    expect(receipt).toMatchObject({ destinationFingerprint: expect.stringMatching(/^[\da-f]{64}$/) });
    expect(JSON.stringify(receipt)).not.toContain(SHARED_PHONE);
    if (legacy) await repo.setKv(firstCallKey, { at: new Date().toISOString() });

    advanceTo(8);
    await saveWatchSettings({ screenAlertPhone: nextLine }, OWNER);
    if (readError) {
      const getKv = repo.getKv.bind(repo);
      const read = vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
        if (key === firstCallKey) throw new Error('Synthetic first-call receipt lookup failure');
        return getKv(key);
      });
      try {
        await runCron();
        expect(destinations).toEqual([SHARED_PHONE]);
        expect(await getIncident(incident.id)).toMatchObject({ level: 1, screenFirstCallPending: true });
      } finally {
        read.mockRestore();
      }
      advanceTo(8.5);
    }
    await runCron();
    const outbox = (await readOutbox()).filter((entry) => entry.channel === 'call' && entry.incidentId === incident.id);
    const firstCalls = outbox.filter((entry) => entry.purpose === 'alert_shared_screen');
    expect(firstCalls).toHaveLength(1);
    expect(Boolean(firstCalls[0]?.uncertain)).toBe(Boolean(uncertain));
    expect(outbox.filter((entry) => entry.purpose === 'alert')).toHaveLength(recipient ? 1 : 0);
    expect(destinations).toEqual(recipient ? [SHARED_PHONE, recipient] : [SHARED_PHONE]);
    expect(await getIncident(incident.id)).toMatchObject({ level: 2 });
  });

  it.each([
    { role: 'manager', threshold: 1, priorLevel: 1, phone: '+15145550126', purpose: 'alert' },
    { role: 'owner', threshold: 2, priorLevel: 2, phone: '+15145550127', purpose: 'alert_owner' },
  ] as const)('does not redial the $role when a second process reads the first process pre-call write', async ({ role, threshold, priorLevel, phone, purpose }) => {
    await prepareZeroMinuteScreenCall();
    await saveWatchSettings({ callAfterMin: 1, ownerAfterMin: 2 }, OWNER);
    const repo = getRepo();
    const createdAt = new Date().toISOString();
    await repo.saveUser({ id: 'manager', username: 'manager', name: 'On duty manager', role: 'manager', locations: [KITCHEN], phone: '+15145550126', active: true, createdAt });
    await repo.saveUser({ id: 'owner2', username: 'owner2', name: 'On duty owner', role: 'owner', locations: [KITCHEN], phone: '+15145550127', active: true, createdAt });
    const firstDestinationStarts = gate();
    const letFirstDestinationFinish = gate();
    const calls: string[] = [];
    const sms: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const to = new URLSearchParams(String(init?.body)).get('To') ?? '';
      if (url.pathname.endsWith('Messages.json')) {
        sms.push(to);
        return Response.json({ sid: 'SMsimulated' }, { status: 201 });
      }
      if (url.origin !== TWILIO_BASE || !url.pathname.endsWith('Calls.json')) throw new Error('Unexpected external call');
      calls.push(to);
      if (to === phone && calls.filter((destination) => destination === phone).length === 1) {
        firstDestinationStarts.resolve();
        await letFirstDestinationFinish.promise;
      }
      const sid = `CA${calls.length.toString(16).padStart(32, '0')}`;
      return Response.json({ sid, status: 'queued' }, { status: 201 });
    });
    expect(await runWatch({ trigger: 'timer' })).toMatchObject({ opened: 1, escalated: 1 });
    const [incident] = await listIncidents({ status: ['open'] });
    expect(incident.level).toBe(1);
    if (threshold === 2) {
      advanceTo(7);
      expect(await runWatch({ trigger: 'timer' })).toMatchObject({ escalated: 1 });
    }
    advanceTo(6 + threshold);
    const firstTime = new Date().toISOString();
    const firstWorker = runWatch({ trigger: 'timer' });
    try {
      await firstDestinationStarts.promise;
      const persisted = await getIncident(incident.id);
      expect(persisted).toMatchObject({ updatedAt: firstTime, level: priorLevel });
      // A second server process has a different global guard but reads the same incident revisions and KV rows.
      const workerGlobal = globalThis as typeof globalThis & { __takatakWatchRunning?: number };
      workerGlobal.__takatakWatchRunning = 0;
      vi.setSystemTime(Date.now() + 1);
      expect(await runWatch({ trigger: 'manual', force: true })).toMatchObject({ ran: true });
    } finally {
      letFirstDestinationFinish.resolve();
      await firstWorker;
    }
    const evidence = (await readOutbox()).filter((entry) => entry.incidentId === incident.id && entry.channel === 'call' && entry.purpose === purpose);
    const history = (await getIncident(incident.id))?.steps.filter((entry) => entry.kind === 'call' && entry.to?.includes(phone.slice(-4)));
    const report = { role, callsToDestination: calls.filter((destination) => destination === phone).length, outboxCalls: evidence.length, historyCalls: history?.length, ownerMessages: sms.filter((destination) => destination === '+15145550127').length };
    expect(report).toMatchObject({ callsToDestination: 1, outboxCalls: 1, historyCalls: 1, ownerMessages: role === 'owner' ? 1 : 0 });
  });

  it.each(['open', 'acknowledged'] as const)('honors grouping and escalation order when the operator leaves the incident %s', async (status) => {
    await prepareZeroMinuteScreenCall();
    const phone = '+15145550126';
    const secondManagerPhone = '+15145550128';
    const support = '+15145550129';
    await saveWatchSettings({ callAfterMin: 1, ownerAfterMin: 1, supportPhones: [support] }, OWNER);
    const repo = getRepo();
    await repo.saveUser({ username: 'manager', name: 'On duty manager', role: 'manager', locations: [KITCHEN], phone, active: true });
    if (status === 'acknowledged') {
      await repo.saveUser({ username: 'manager-z', name: 'Second manager', role: 'manager', locations: [KITCHEN], phone: secondManagerPhone, active: true });
    }
    await repo.saveUser({ username: 'owner2', name: 'On duty owner', role: 'owner', locations: [KITCHEN], phone, active: true });

    const reachedManager = gate();
    const releaseManager = gate();
    const calls: string[] = [];
    const messages: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(TWILIO_BASE);
      const form = new URLSearchParams(String(init?.body));
      if (url.pathname.endsWith('Messages.json')) {
        messages.push(form.get('Body') ?? '');
        return Response.json({ sid: 'SMsimulated' }, { status: 201 });
      }
      expect(url.pathname).toMatch(/Calls\.json$/);
      const called = form.get('To') ?? '';
      calls.push(called);
      if (called === phone && calls.filter((destination) => destination === phone).length === 1) {
        reachedManager.resolve();
        await releaseManager.promise;
      }
      return Response.json({ sid: CALL_SID }, { status: 201 });
    });

    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    const [incident] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    const worker = runWatch({ trigger: 'timer' });
    try {
      await reachedManager.promise;
      const workerGlobal = globalThis as typeof globalThis & { __takatakWatchRunning?: number };
      workerGlobal.__takatakWatchRunning = 0;
      vi.setSystemTime(Date.now() + 1);
      expect(await runWatch({ trigger: 'manual', force: true })).toMatchObject({ ran: true, escalated: 0 });
      expect((await getIncident(incident.id))?.level).toBe(1);
      expect(calls).toEqual([SHARED_PHONE, phone]);
      expect(messages.filter((message) => message.includes('min sans réponse'))).toHaveLength(0);
      if (status === 'acknowledged') await actOnIncident(incident.id, 'ack', OWNER);
    } finally {
      releaseManager.resolve();
      await worker;
    }
    const expectedCalls = status === 'open' ? [SHARED_PHONE, phone, support] : [SHARED_PHONE, phone];
    expect(calls).toEqual(expectedCalls);
    expect(messages.filter((message) => message.includes('min sans réponse'))).toHaveLength(status === 'open' ? 1 : 0);
    advanceTo(8);
    await runCron();
    advanceTo(9);
    await runCron();
    expect(await getIncident(incident.id)).toMatchObject({ status, level: status === 'open' ? 3 : 1 });
    expect(calls).toEqual(expectedCalls);
    if (status === 'acknowledged') {
      expect(calls).not.toContain(secondManagerPhone);
      const history = (await getIncident(incident.id))?.steps.filter((step) => step.kind === 'call' && step.to?.includes(phone.slice(-4)));
      expect(history).toHaveLength(1);
      const outbox = (await readOutbox()).filter((entry) => entry.incidentId === incident.id && entry.channel === 'call');
      expect(outbox).toHaveLength(2);
    }
  });

  it.each(['database error', 'abandoned reservation'] as const)('defers later sends on %s and resumes without replaying a claim', async (reason) => {
    await prepareZeroMinuteScreenCall();
    await saveWatchSettings({ callAfterMin: 1, ownerAfterMin: 1 }, OWNER);
    const repo = getRepo();
    const managerPhone = '+15145550126';
    const ownerPhone = '+15145550127';
    await repo.saveUser({ username: 'manager', name: 'On duty manager', role: 'manager', locations: [KITCHEN], phone: managerPhone, active: true });
    await repo.saveUser({ username: 'owner2', name: 'On duty owner', role: 'owner', locations: [KITCHEN], phone: ownerPhone, active: true });
    const calls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(TWILIO_BASE);
      if (url.pathname.endsWith('Messages.json')) return Response.json({ sid: 'SMsimulated' }, { status: 201 });
      expect(url.pathname).toMatch(/Calls\.json$/);
      calls.push(new URLSearchParams(String(init?.body)).get('To') ?? '');
      return Response.json({ sid: CALL_SID }, { status: 201 });
    });
    await runCron();
    const [incident] = await listIncidents({ status: ['open'] });
    const key = `watch:screen-stage:${incident.id}:2`;
    advanceTo(7);
    if (reason === 'abandoned reservation') expect(await repo.claimKv(key, { startedAt: Date.now() })).toBe(true);
    const claim = repo.claimKv.bind(repo);
    const ruled = vi.spyOn(repo, 'claimKv').mockImplementation(async (name, value) => {
      if (name === key && reason === 'database error') throw new Error('Synthetic database failure');
      return claim(name, value);
    });
    try {
      await runCron();
      expect((await getIncident(incident.id))?.level).toBe(1);
      expect(calls).toEqual([SHARED_PHONE]);
    } finally {
      ruled.mockRestore();
    }
    advanceTo(9);
    await runCron();
    if (reason === 'abandoned reservation') {
      const deferred = await getIncident(incident.id);
      expect(deferred?.level).toBe(2);
      expect(deferred?.steps).toContainEqual(expect.objectContaining({ kind: 'note', message: expect.stringContaining('Stage 3 already reserved') }));
      expect(calls).toEqual([SHARED_PHONE]);
      advanceTo(10);
      await runCron();
    }
    expect((await getIncident(incident.id))?.level).toBe(3);
    expect(calls).toEqual(reason === 'database error' ? [SHARED_PHONE, managerPhone, ownerPhone] : [SHARED_PHONE, ownerPhone]);
  });

  it('does not start a manager call when the operator acknowledged during the reservation response', async () => {
    await prepareZeroMinuteScreenCall();
    await saveWatchSettings({ callAfterMin: 1, ownerAfterMin: 2 }, OWNER);
    const repo = getRepo();
    const managerPhone = '+15145550126';
    await repo.saveUser({ id: 'manager', username: 'manager', name: 'On duty manager', role: 'manager', locations: [KITCHEN], phone: managerPhone, active: true, createdAt: new Date().toISOString() });
    const providerCalls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith('Calls.json')) providerCalls.push(new URLSearchParams(String(init?.body)).get('To') ?? '');
      return Response.json({ sid: pathname.endsWith('Calls.json') ? CALL_SID : 'SMsimulated', status: 'queued' }, { status: 201 });
    });
    await runWatch({ trigger: 'timer' });
    const [incident] = await listIncidents({ status: ['open'] });
    expect(incident.level).toBe(1);
    const originalClaim = repo.claimKv.bind(repo);
    const claim = vi.spyOn(repo, 'claimKv').mockImplementation(async (key, value) => {
      const won = await originalClaim(key, value);
      if (won && key === `watch:screen-stage:${incident.id}:2`) {
        expect(await actOnIncident(incident.id, 'ack', OWNER)).toMatchObject({ status: 'acknowledged' });
      }
      return won;
    });
    try {
      advanceTo(7);
      await runWatch({ trigger: 'timer' });
    } finally {
      claim.mockRestore();
    }
    expect(await getIncident(incident.id)).toMatchObject({ status: 'acknowledged' });
    expect(providerCalls).not.toContain(managerPhone);
  });

  it.each(['recent', 'exact'] as const)('coordinates the zero-minute call when overlapping ticks both read no incident in the %s query', async (query) => {
    await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    const snapshotRead = gate();
    const releaseSnapshot = gate();
    const repo = getRepo();
    const originalListDocs = repo.listDocs.bind(repo);
    let firstIncidentRead = true;
    const listDocs = vi.spyOn(repo, 'listDocs').mockImplementation(async (collection, filter) => {
      const snapshot = await originalListDocs(collection, filter);
      const targetRead = query === 'exact' ? filter?.keys?.length : filter?.since;
      if (collection === INCIDENTS && firstIncidentRead && targetRead) {
        firstIncidentRead = false;
        snapshotRead.resolve();
        await releaseSnapshot.promise;
      }
      return snapshot;
    });
    const firstTick = runWatch({ trigger: 'timer' });
    try {
      await snapshotRead.promise;
      advanceTo(7);
      await runWatch({ trigger: 'manual', force: true });
    } finally {
      releaseSnapshot.resolve();
      await firstTick;
      listDocs.mockRestore();
    }

    const evidence = (await readOutbox()).filter((entry) => entry.channel === 'call');
    expect(evidence.map((entry) => entry.incidentId)).toEqual([evidence[0]?.incidentId]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listIncidents({ status: ['open'] })).toHaveLength(1);
  });

  it('defers the zero-minute call when it cannot read the previous incident', async () => {
    await prepareZeroMinuteScreenCall();
    const repo = getRepo();
    const originalListDocs = repo.listDocs.bind(repo);
    const listDocs = vi.spyOn(repo, 'listDocs').mockImplementation(async (collection, filter) => {
      if (collection === INCIDENTS && filter?.keys?.length) throw new Error('Synthetic incident lookup failure');
      return originalListDocs(collection, filter);
    });
    try {
      expect((await cronRequest()).status).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      listDocs.mockRestore();
    }

    advanceTo(7);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers the same incident after the zero-minute allocation response is lost', async () => {
    await prepareZeroMinuteScreenCall();
    const repo = getRepo();
    const originalInsert = repo.insertDocIfAbsent.bind(repo);
    const insert = vi.spyOn(repo, 'insertDocIfAbsent').mockImplementationOnce(async (collection, doc) => {
      await originalInsert(collection, doc);
      throw new Error('Synthetic lost incident allocation response');
    });
    try {
      expect((await cronRequest()).status).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      insert.mockRestore();
    }

    const [allocated] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 1 });
    expect((await readOutbox()).map((entry) => entry.incidentId)).toEqual([allocated.id]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { action: 'ack', status: 'acknowledged' }, { action: 'resolve', status: 'resolved' },
  ] as const)('preserves operator $action and one call-result step when the zero-minute call returns', async ({ action, status }) => {
    const screenId = await prepareZeroMinuteScreenCall();
    const enteredCall = gate();
    const releaseCall = gate();
    fetchMock.mockImplementationOnce(async () => {
      enteredCall.resolve();
      await releaseCall.promise;
      return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
    });
    const running = runWatch({ trigger: 'timer' });
    let incidentId: string;
    try {
      await enteredCall.promise;
      const [active] = await listIncidents({ status: ['open'] });
      incidentId = active.id;
      advanceTo(6.5);
      expect(await actOnIncident(incidentId, action, OWNER)).toMatchObject({ status });
    } finally {
      releaseCall.resolve();
      await running;
    }

    const saved = await getIncident(incidentId);
    expect(saved).toMatchObject({
      status, locationCode: KITCHEN, level: 0, updatedAt: new Date(START + 6.5 * 60_000).toISOString(),
      ...(action === 'ack' ? { ackBy: OWNER.name } : { resolvedBy: OWNER.name }),
    });
    expect(saved?.steps.filter((step) => step.kind === 'call')).toMatchObject([{ kind: 'call', ok: true, message: 'Calling', dispatchId: expect.any(String) }]);
    expect((await readOutbox()).map((entry) => entry.incidentId)).toEqual([incidentId]);
    expect(await running).toMatchObject({ escalated: 1 });
    advanceTo(7);
    if (action === 'resolve') await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still saves another tablet alert when all attempts to append an earlier call result conflict', async () => {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: KITCHEN_PHONE });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: SHARED_PHONE, smsAfterMin: 0, postToChat: false, aiExplain: false }, OWNER);
    const { device: offline } = await enrollDevice({ name: 'A offline tablet', locationCode: KITCHEN }, OWNER);
    const { device: muted } = await enrollDevice({ name: 'B muted tablet', locationCode: KITCHEN }, OWNER);
    advanceTo(6);
    await tabletHeartbeat(muted, { soundOn: false, visible: true });
    fetchMock.mockImplementationOnce(async () => {
      const [first] = await listIncidents({ status: ['open'] });
      expect(first.deviceId).toBe(offline.id);
      await actOnIncident(first.id, 'ack', OWNER);
      return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
    }).mockResolvedValueOnce(Response.json({ sid: `CA${'3'.repeat(32)}`, status: 'queued' }, { status: 201 }));

    const repo = getRepo();
    const originalReplace = repo.replaceDocIfRevision.bind(repo);
    let conflicts = 0;
    const replace = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, expected) => {
      const incident = doc.data as Incident;
      if (collection === INCIDENTS && incident.deviceId === offline.id && incident.steps.some((step) => step.kind === 'call')) {
        conflicts++;
        return false;
      }
      return originalReplace(collection, doc, expected);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await runWatch({ trigger: 'timer' })).toMatchObject({ opened: 2, escalated: 2 });
      expect(conflicts).toBe(3);
      expect(warning).toHaveBeenCalledExactlyOnceWith('[foodhub] Watchtower could not save a call result after a concurrent incident update.');
    } finally {
      replace.mockRestore();
      warning.mockRestore();
    }
    const incidents = await listIncidents();
    expect(incidents.find((entry) => entry.deviceId === offline.id)).toMatchObject({ status: 'acknowledged' });
    expect(incidents.find((entry) => entry.deviceId === muted.id)).toMatchObject({
      kind: 'device_muted', level: 1, steps: expect.arrayContaining([expect.objectContaining({ kind: 'call', ok: true })]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    advanceTo(7);
    await tabletHeartbeat(muted, { soundOn: false, visible: true });
    expect(await runCron()).toMatchObject({ escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the zero-minute call across a short recovery and re-arms it for a later outage', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    const [original] = await listIncidents({ status: ['open'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });
    advanceTo(13);
    expect(await runCron()).toMatchObject({ opened: 0 });
    expect(await listIncidents({ status: ['open'] })).toMatchObject([{ id: original.id }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advanceTo(14);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });
    advanceTo(25);
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    const [newIncident] = await listIncidents({ status: ['open'] });
    expect(newIncident.id).not.toBe(original.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers a reserved zero-minute successor without reactivating its resolved predecessor', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [first] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });

    advanceTo(18);
    const insert = vi.spyOn(getRepo(), 'insertDocIfAbsent').mockRejectedValueOnce(new Error('Synthetic successor insert failure'));
    try {
      expect((await cronRequest()).status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await getIncident(first.id)).toMatchObject({ status: 'resolved', successorReserved: true });
      expect(await listIncidents({ status: ['open'] })).toEqual([]);
    } finally {
      insert.mockRestore();
    }

    advanceTo(19);
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    expect(await getIncident(first.id)).toMatchObject({ status: 'resolved', successorReserved: true });
    const [next] = await listIncidents({ status: ['open'] });
    expect(next.id).not.toBe(first.id);
    expect((await readOutbox()).map((entry) => entry.incidentId)).toEqual([next.id, first.id]);
    const reopen = new Request(ownerRequest('incidents'), {
      method: 'POST', body: JSON.stringify({ id: first.id, action: 'reopen' }),
    });
    expect((await incidentAction(reopen, undefined)).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([{ action: 'reopen', status: 'open' }, { action: 'snooze', status: 'snoozed' }])(
    'can $action an abandoned successor after the detector clears', async ({ action, status }) => {
      const screenId = await prepareZeroMinuteScreenCall();
      fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
      await runCron();
      const [first] = await listIncidents({ status: ['open'] });
      advanceTo(7);
      await reportScreen(screenId, 'skip', 0);
      expect(await runCron()).toMatchObject({ resolved: 1 });

      advanceTo(18);
      const repo = getRepo();
      let delayedInsert: Doc<Incident> | undefined;
      const insert = vi.spyOn(repo, 'insertDocIfAbsent').mockImplementationOnce(async (_collection, doc) => {
        delayedInsert = doc as Doc<Incident>;
        throw new Error('Synthetic successor insert failure');
      });
      try {
        expect((await cronRequest()).status).toBe(500);
      } finally {
        insert.mockRestore();
      }
      if (!delayedInsert) throw new Error('Expected a reserved successor');
      advanceTo(19);
      await reportScreen(screenId, 'skip', 0);
      expect(await runCron()).toMatchObject({ detections: 0, opened: 0 });

      const request = new Request(ownerRequest('incidents'), { method: 'POST', body: JSON.stringify({ id: first.id, action }) });
      const response = await incidentAction(request, undefined);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ incident: { id: delayedInsert.id, status, level: 0 } });
      expect(await repo.insertDocIfAbsent(INCIDENTS, delayedInsert)).toBe(false);
      expect(await getIncident(first.id)).toMatchObject({ status: 'resolved', successorReserved: true });
      expect(await getIncident(delayedInsert.id)).toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['warning', 'critical'] as const)('keeps quiet hours when a reserved %s starts with a fresh warning', async (reservedSeverity) => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [first] = await listIncidents({ status: ['open'] });
    expect(first.severity).toBe('critical');
    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });
    await saveWatchSettings({ quietFrom: '11:00', quietTo: '15:00' }, OWNER);
    if (reservedSeverity === 'warning') { advanceTo(15); await reportScreen(screenId, 'skip', 0); }

    advanceTo(18);
    const insert = vi.spyOn(getRepo(), 'insertDocIfAbsent').mockRejectedValueOnce(new Error('Synthetic successor insert failure'));
    try {
      expect((await cronRequest()).status).toBe(500);
    } finally {
      insert.mockRestore();
    }
    expect(await getIncident(first.id)).toMatchObject({ successorDetection: { severity: reservedSeverity, locationCode: KITCHEN } });
    if (reservedSeverity === 'critical') await reportScreen(screenId, 'skip', 0);
    const reopen = new Request(ownerRequest('incidents'), { method: 'POST', body: JSON.stringify({ id: first.id, action: 'reopen' }) });
    const response = await incidentAction(reopen, undefined);
    expect(response.status).toBe(200);
    const { incident: successor } = await response.json();
    expect(successor).toMatchObject({ severity: reservedSeverity, awaitingFreshDetection: true });
    advanceTo(reservedSeverity === 'warning' ? 19 : 21);
    expect(await runCron()).toMatchObject({ updated: 1, escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getIncident(successor.id)).toMatchObject({ severity: 'warning', status: 'open', level: 0 });
    expect((await getIncident(successor.id))?.awaitingFreshDetection).toBeUndefined();
  });

  it('rejects a prior-kitchen operator reopening or snoozing a reserved successor at a different kitchen', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [first] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });

    const destination = 'TEST_DESTINATION';
    await saveLocation({ code: destination, name: 'Synthetic destination', address: '', active: true });
    await saveHours({ locations: { [KITCHEN]: allDayWeek(), [destination]: allDayWeek() }, brands: {}, holidays: [] });
    const manager = 'original-kitchen-manager';
    const password = 'synthetic-prior-kitchen-password';
    await getRepo().saveUser({ username: manager, name: manager, role: 'manager', active: true, locations: [KITCHEN], passwordHash: hashPassword(password) });
    advanceTo(15);
    await updateScreen(screenId, { locationCode: destination }, OWNER);
    await reportScreen(screenId, 'skip', 0);
    advanceTo(18);
    const insert = vi.spyOn(getRepo(), 'insertDocIfAbsent').mockRejectedValueOnce(new Error('Synthetic successor insert failure'));
    try {
      expect((await cronRequest()).status).toBe(500);
    } finally {
      insert.mockRestore();
    }
    const historical = await getIncident(first.id);
    expect(historical).toMatchObject({ status: 'resolved', locationCode: KITCHEN, successorDetection: { locationCode: destination } });
    const [visible] = await listIncidents({ status: ['resolved'], locationCodes: [KITCHEN] });
    expect(visible.successorDetection).toBeUndefined();
    for (const action of ['reopen', 'snooze']) {
      const reopen = new Request(`${BASE}/incidents`, {
        method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${manager}:${password}`).toString('base64')}` },
        body: JSON.stringify({ id: first.id, action }),
      });
      expect((await incidentAction(reopen, undefined)).status).toBe(409);
    }
    expect(await getIncident(first.id)).toEqual(historical);
    expect(await listIncidents({ status: ['open', 'snoozed'] })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('closes a recovered successor in its original kitchen if the next detection comes from a new kitchen', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [first] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });

    advanceTo(18);
    const insert = vi.spyOn(getRepo(), 'insertDocIfAbsent').mockRejectedValueOnce(new Error('Synthetic successor insert failure'));
    try {
      expect((await cronRequest()).status).toBe(500);
    } finally {
      insert.mockRestore();
    }
    const restored = await actOnIncident(first.id, 'reopen', OWNER);
    if (!restored) throw new Error('Expected a recovered successor');
    expect(restored).toMatchObject({ locationCode: KITCHEN, awaitingFreshDetection: true });

    const destination = 'TEST_DESTINATION';
    await saveLocation({ code: destination, name: 'Synthetic destination', address: '', active: true });
    await saveHours({ locations: { [KITCHEN]: allDayWeek(), [destination]: allDayWeek() }, brands: {}, holidays: [] });
    advanceTo(19);
    await updateScreen(screenId, { locationCode: destination }, OWNER);
    expect(await runCron()).toMatchObject({ opened: 0, resolved: 1, escalated: 0 });
    expect(await getIncident(restored.id)).toMatchObject({ locationCode: KITCHEN, status: 'resolved', resolvedBy: 'Watchtower' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advanceTo(20);
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
    const [current] = await listIncidents({ status: ['open'] });
    expect(current).toMatchObject({ locationCode: destination, deviceId: screenId });
    expect(current.id).not.toBe(restored.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a manual reopen that wins the zero-minute successor reservation race', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [first] = await listIncidents({ status: ['open'] });
    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });

    advanceTo(18);
    const repo = getRepo();
    const replaceDoc = repo.replaceDocIfRevision.bind(repo);
    let competingReopen = true;
    const save = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, expected) => {
      if (competingReopen && collection === INCIDENTS && (doc.data as Incident).successorReserved) {
        competingReopen = false;
        expect(await actOnIncident(first.id, 'reopen', OWNER)).toMatchObject({ status: 'open' });
      }
      return replaceDoc(collection, doc, expected);
    });
    try {
      expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
    } finally {
      save.mockRestore();
    }
    expect(await listIncidents({ status: ['open'] })).toMatchObject([{ id: first.id }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still closes a screen incident opened outside the three-day history window', async () => {
    const screenId = await prepareZeroMinuteScreenCall();
    fetchMock.mockImplementation(async () => Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await runCron();
    const [incident] = await listIncidents({ status: ['open'] });
    const openedAt = new Date(START - 4 * 86_400_000).toISOString();
    await getRepo().putDocs(INCIDENTS, [{ id: incident.id, key: incident.key, at: openedAt, data: { ...incident, openedAt } }]);

    advanceTo(7);
    await reportScreen(screenId, 'skip', 0);
    expect(await runCron()).toMatchObject({ resolved: 1 });
    expect(await getIncident(incident.id)).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  async function openScreenIncident({ platform, kind, detectedAt }: typeof scenarios[number], kitchenPhone: string | null = null) {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: kitchenPhone });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: null, smsAfterMin: 1, unacceptedAfterSec: 60, postToChat: false, aiExplain: false }, OWNER);
    const screen = await addScreen({ name: 'Test platform screen', platform, locationCode: KITCHEN, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    const screenId = screen.id;

    const waiting = kind === 'screen_waiting';
    await reportScreen(screenId, platform, 0);
    if (waiting) {
      advanceTo(1);
      await reportScreen(screenId, platform, 2);
    }
    async function tick(offset: number) {
      advanceTo(detectedAt + offset);
      if (waiting) await reportScreen(screenId, platform, 2);
      return runCron();
    }
    expect(await tick(0)).toMatchObject({ opened: 1, escalated: 0 });
    const opened = await listIncidents({ status: ['open'] });
    expect(opened).toHaveLength(1);
    const [incident] = opened;
    expect(incident).toMatchObject({ kind, severity: 'critical', deviceId: screenId, level: 0 });
    return { incident, tick };
  }

  it.each(scenarios)('sends the first $platform $kind call once when a shared number is saved after the SMS stage', async (scenario) => {
    const { incident, tick } = await openScreenIncident(scenario);
    expect(await tick(1)).toMatchObject({ opened: 0, escalated: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readOutbox()).toEqual([]);
    const waitingSteps = (await getIncident(incident.id))?.steps.filter((step) => step.kind === 'sms');
    expect(waitingSteps).toHaveLength(1);

    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await tick(2)).toMatchObject({ opened: 0, escalated: 1 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${CALLS}.json`, expect.objectContaining({ method: 'POST' }));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('To')).toBe(SHARED_PHONE);

    expect(await tick(3)).toMatchObject({ opened: 0, escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert_shared_screen', ok: true, ref: CALL_SID }]);
    const updated = await getIncident(incident.id);
    expect(updated?.level).toBe(1);
    expect(updated?.steps.filter((step) => step.kind === 'sms')).toEqual(waitingSteps);
  });

  it('keeps the first call completed at the kitchen number when a shared number is saved later', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen, KITCHEN_PHONE);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await tick(1)).toMatchObject({ escalated: 1 });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('To')).toBe(KITCHEN_PHONE);

    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    expect(await tick(2)).toMatchObject({ opened: 0, escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert_kitchen', ok: true, ref: CALL_SID }]);
  });

  it('uses the owner’s newly saved shared number for the next screen without losing the first call receipt', async () => {
    const codes = ['FIXTURE_CALL_A', 'FIXTURE_CALL_B'];
    const screens: Array<{ id: string; locationCode: string }> = [];
    for (const [index, code] of codes.entries()) {
      await saveLocation({ code, name: code, address: '', active: true, phone: KITCHEN_PHONE });
      const screen = await addScreen({ name: `Fixture screen ${index + 1}`, platform: 'skip', locationCode: code,
        viewUrl: `https://relay.example.test/s0${index + 1}/` }, OWNER);
      if ('error' in screen) throw new Error(screen.error);
      screens.push({ id: screen.id, locationCode: code });
      await reportScreen(screen.id, 'skip', 0);
    }
    await saveHours({ locations: Object.fromEntries(codes.map((code) => [code, allDayWeek()])), brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: SHARED_PHONE, smsAfterMin: 1, callAfterMin: 20, ownerAfterMin: 30, postToChat: false, aiExplain: false }, OWNER);
    advanceTo(6);
    expect(await runCron()).toMatchObject({ opened: 2, escalated: 0 });
    const incidents = (await listIncidents({ status: ['open'] })).filter(({ kind }) => kind === 'screen_down');
    for (const screen of screens) expect(incidents).toContainEqual(expect.objectContaining({ deviceId: screen.id, locationCode: screen.locationCode }));
    const nextPhone = '+15145550126';
    const laterSid = `CA${'3'.repeat(32)}`;
    fetchMock.mockImplementationOnce(async () => {
      const request = new Request(ownerRequest('watch/settings'), { method: 'PUT', body: JSON.stringify({ settings: { screenAlertPhone: '514 555-0126' } }) });
      const response = await watchSettingsWrite(request, undefined);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ settings: { screenAlertPhone: nextPhone } });
      return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
    });
    fetchMock.mockResolvedValueOnce(Response.json({ sid: laterSid, status: 'queued' }, { status: 201 }));

    advanceTo(7);
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 2 });
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), form: new URLSearchParams(String(init?.body)) }));
    expect(calls.map(({ url, form }) => [url, form.get('To')])).toEqual([[`${CALLS}.json`, SHARED_PHONE], [`${CALLS}.json`, nextPhone]]);
    const receipts = await readOutbox();
    expect(receipts).toHaveLength(2);
    for (const [index, ref] of [CALL_SID, laterSid].entries()) {
      const receipt = receipts.find((entry) => entry.ref === ref);
      expect(receipt).toMatchObject({ purpose: 'alert_shared_screen', ok: true });
      const attributed = incidents.find(({ id }) => id === receipt?.incidentId);
      if (!attributed?.locationCode) throw new Error('Missing the receipt’s kitchen');
      expect(calls[index].form.get('Twiml')).toContain(attributed.locationCode);
    }
    advanceTo(8);
    expect(await runCron()).toMatchObject({ escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves the first call unclaimed when the fresh settings read fails and retries on the next tick', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen, KITCHEN_PHONE);
    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    const repo = getRepo();
    const read = repo.getKv.bind(repo);
    let settingsReads = 0;
    const spy = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
      if (key === 'watch:settings' && ++settingsReads === 2) throw new Error('Fixture settings read unavailable');
      return read<T>(key);
    });
    try {
      expect(await tick(1)).toMatchObject({ escalated: 0 });
      expect(settingsReads).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await getRepo().getKv(`watch:first-screen-call:${incident.id}`)).toBeNull();
      expect(await getRepo().getKv(`watch:screen-stage:${incident.id}:1`)).toBeNull();
      expect(await getIncident(incident.id)).toMatchObject({ status: 'open', level: 0 });
    } finally {
      spy.mockRestore();
    }
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await tick(2)).toMatchObject({ escalated: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert_shared_screen', ok: true, ref: CALL_SID }]);
  });

  it('does not redial when the first call was sent but the stored incident still shows it as pending', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    expect(await tick(1)).toMatchObject({ escalated: 1 });
    const pending = structuredClone(await getIncident(incident.id));
    if (!pending) throw new Error('Expected an open screen incident');
    expect(pending.screenFirstCallPending).toBe(true);

    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await tick(2)).toMatchObject({ escalated: 1 });

    // Simulate interruption after the call claim and outbox were saved, before the incident update was durable.
    await getRepo().putDocs(INCIDENTS, [{ id: pending.id, key: pending.key, at: pending.openedAt, data: pending }]);
    expect((await getIncident(incident.id))?.screenFirstCallPending).toBe(true);
    await tick(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getIncident(incident.id))?.screenFirstCallPending).toBeUndefined();
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert_shared_screen', ok: true, ref: CALL_SID }]);
  });

  it('keeps the first call pending until its database claim can be stored', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    const repo = getRepo();
    const original = repo.claimKv.bind(repo);
    let failFirstClaim = true;
    const claim = vi.spyOn(repo, 'claimKv').mockImplementation(async (key, value) => {
      if (key === `watch:first-screen-call:${incident.id}` && failFirstClaim) {
        failFirstClaim = false;
        throw new Error('Temporary database failure');
      }
      return original(key, value);
    });
    try {
      expect(await tick(1)).toMatchObject({ escalated: 1 });
      expect(await getIncident(incident.id)).toMatchObject({ level: 1, screenFirstCallPending: true });
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
      expect(await tick(2)).toMatchObject({ escalated: 1 });
      expect((await getIncident(incident.id))?.screenFirstCallPending).toBeUndefined();
      expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert_shared_screen', ok: true, ref: CALL_SID }]);
    } finally {
      claim.mockRestore();
    }
  });

  it('shows an existing first-call reservation without repeating a request or fabricating a receipt', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    await tick(1);
    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);
    expect(await getRepo().claimKv(`watch:first-screen-call:${incident.id}`, { at: new Date().toISOString() })).toBe(true);

    await tick(2);
    await tick(3);
    const saved = await getIncident(incident.id);
    expect(saved?.steps.filter((step) => step.kind === 'note' && step.message?.includes('First call already reserved'))).toHaveLength(1);
    expect(saved?.screenFirstCallPending).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readOutbox()).toEqual([]);
  });

  it.each([
    { ...offlineScreen, phone: SHARED_PHONE, purpose: 'alert_shared_screen' },
    { platform: 'doordash' as const, kind: 'screen_waiting', detectedAt: 2, phone: KITCHEN_PHONE, purpose: 'alert_kitchen' },
  ])('requests the first $kind call after Twilio Voice becomes configured', async ({ phone, purpose, ...scenario }) => {
    const kitchenFallback = purpose === 'alert_kitchen';
    const { incident, tick } = await openScreenIncident(scenario, kitchenFallback ? phone : null);
    if (!kitchenFallback) await saveWatchSettings({ screenAlertPhone: phone }, OWNER);
    vi.stubEnv('TWILIO_FROM', undefined);

    expect(await tick(1)).toMatchObject({ escalated: 1 });
    await tick(2);
    expect(fetchMock).not.toHaveBeenCalled();
    const pending = structuredClone(await getIncident(incident.id));
    const claimWhileBlocked = await getRepo().getKv(`watch:first-screen-call:${incident.id}`);

    vi.stubEnv('TWILIO_FROM', TWILIO_FROM);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    await tick(3);
    await tick(4);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${CALLS}.json`, expect.objectContaining({ method: 'POST' }));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('To')).toBe(phone);
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose, ok: true, ref: CALL_SID }]);
    expect(pending).toMatchObject({ level: 1, screenFirstCallPending: true });
    expect(pending?.steps.filter((step) => step.kind === 'note' && step.message?.includes('Twilio Voice'))).toHaveLength(1);
    expect(claimWhileBlocked).toBeNull();
    expect((await getIncident(incident.id))?.screenFirstCallPending).toBeUndefined();
  });

  it('leaves an acknowledged screen incident quiet when a shared number is saved later', async () => {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    expect(await tick(1)).toMatchObject({ escalated: 1 });
    await actOnIncident(incident.id, 'ack', OWNER);
    await saveWatchSettings({ screenAlertPhone: SHARED_PHONE }, OWNER);

    expect(await tick(2)).toMatchObject({ opened: 0, escalated: 0 });
    expect(await getIncident(incident.id)).toMatchObject({ status: 'acknowledged' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readOutbox()).toEqual([]);
  });

  it('keeps an unconfirmed provider response without retrying the same stage', async () => {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: KITCHEN_PHONE });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: SHARED_PHONE, smsAfterMin: 1, postToChat: false, aiExplain: false }, OWNER);
    const screen = await addScreen({ name: 'Test platform screen', platform: 'skip', locationCode: KITCHEN, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    await reportScreen(screen.id, 'skip', 0);

    advanceTo(6);
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 0 });
    const [incident] = await listIncidents({ status: ['open'] });
    expect(incident).toMatchObject({ kind: 'screen_down' });

    advanceTo(7);
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ escalated: 1 });
    const entries = await readOutbox();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({ channel: 'call', incidentId: incident.id, ok: false, uncertain: true });
    expect(entry.ref).toBeUndefined();
    expect((await getIncident(incident.id))?.steps).toContainEqual(expect.objectContaining({ kind: 'call', ok: false, uncertain: true }));
    const status = await callStatus(ownerRequest(`messages/call-status?id=${entry.id}`), undefined);
    expect(status.status).toBe(404);

    advanceTo(8);
    expect(await runCron()).toMatchObject({ escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(scenarios)('routes $platform $kind to the shared phone and reads its recorded call status', async ({ platform, kind, detectedAt }) => {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: KITCHEN_PHONE });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: '514 555-0124', smsAfterMin: 1, unacceptedAfterSec: 60, postToChat: false, aiExplain: false }, OWNER);
    const screen = await addScreen({ name: 'Test platform screen', platform, locationCode: KITCHEN, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);

    // The relay and scheduler use their own bearer tokens. No console or live pulse runs in this test.
    expect((await relayRequest({ id: screen.id, state: 'ok', waiting: 2 }, 'wrong')).status).toBe(401);
    await reportScreen(screen.id, platform, 0);
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
    expect(await listIncidents()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    const waiting = kind === 'screen_waiting';
    if (waiting) {
      advanceTo(1);
      await reportScreen(screen.id, platform, 2);
      expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
    }
    advanceTo(detectedAt);
    if (waiting) {
      await reportScreen(screen.id, platform, 2);
      expect(await getScreen(screen.id)).toMatchObject({ titleCount: 2, waitingSince: new Date(START + 60_000).toISOString() });
    }
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 0 });
    const opened = await listIncidents({ status: ['open'] });
    expect(opened).toHaveLength(1);
    const [incident] = opened;
    expect(incident).toMatchObject({ kind, severity: 'critical', locationCode: KITCHEN, deviceId: screen.id });
    expect(fetchMock).not.toHaveBeenCalled();

    advanceTo(detectedAt + 1);
    if (waiting) await reportScreen(screen.id, platform, 2);
    expect((await cronRequest('wrong')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 1 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${CALLS}.json`, expect.objectContaining({
      method: 'POST', headers: { Authorization: TWILIO_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
    const form = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(form.get('To')).toBe(SHARED_PHONE);
    expect(form.get('From')).toBe(TWILIO_FROM);
    expect(form.get('Twiml')).toContain('language="fr-CA"');

    const outbox = await readOutbox();
    expect(outbox).toHaveLength(1);
    const [call] = outbox;
    expect(call).toMatchObject({ channel: 'call', purpose: 'alert_shared_screen', ok: true, ref: CALL_SID, incidentId: incident.id, to: '+1••••••0124' });

    advanceTo(detectedAt + 2);
    if (waiting) await reportScreen(screen.id, platform, 2);
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const status: CallStatus = 'completed';
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status, to: SHARED_PHONE, from: TWILIO_FROM }));
    const response = await callStatus(ownerRequest(`messages/call-status?id=${call.id}`), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, status });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(`${CALLS}/${CALL_SID}.json`, expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Authorization: TWILIO_AUTH },
    }));
    expect(await readOutbox()).toEqual(outbox);

    advanceTo(detectedAt + 3);
    await reportScreen(screen.id, platform, 0);
    expect(await runCron()).toMatchObject({ resolved: 1, escalated: 0 });
    expect(await getIncident(incident.id)).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('calls for an unavailable screen when a lost switch reply leaves the old provider open', async () => {
    await saveLocation({ code: KITCHEN, name: 'Test kitchen', address: '', active: true, phone: KITCHEN_PHONE });
    await saveHours({ locations: { [KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
    await saveWatchSettings({ enabled: true, screenAlertPhone: SHARED_PHONE, smsAfterMin: 1, unacceptedAfterSec: 60, postToChat: false, aiExplain: false }, OWNER);
    const screen = await addScreen({ name: 'Test platform screen', platform: 'doordash', locationCode: KITCHEN, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    const oldBeat = { id: screen.id, state: 'ok' as const, title: '(2) Orders', url: 'https://order.doordash.com/' };
    expect((await relayRequest(oldBeat)).status).toBe(200);
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });

    advanceTo(1);
    await updateScreen(screen.id, { platform: 'ubereats' }, OWNER);
    const lostReply = await relayRequest(oldBeat);
    expect(await lostReply.json()).toMatchObject({ commands: [{ id: screen.id, kind: 'open' }] });

    advanceTo(2);
    expect((await relayRequest(oldBeat)).status).toBe(200);
    expect(await runCron()).toMatchObject({ opened: 1, escalated: 0 });
    const incidents = await listIncidents({ status: ['open'] });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ kind: 'screen_down', deviceId: screen.id, locationCode: KITCHEN });

    advanceTo(3);
    expect((await relayRequest(oldBeat)).status).toBe(200);
    fetchMock.mockResolvedValueOnce(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    expect(await runCron()).toMatchObject({ opened: 0, escalated: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe(`${CALLS}.json`);
    expect(new URLSearchParams(String(request[1]?.body)).get('To')).toBe(SHARED_PHONE);
    expect(await readOutbox()).toMatchObject([{ purpose: 'alert_shared_screen', incidentId: incidents[0].id }]);

    advanceTo(4);
    const current = { id: screen.id, state: 'ok' as const, title: 'Orders', url: 'https://merchants.ubereats.com/manager/orders' };
    expect((await relayRequest(current)).status).toBe(200);
    expect(await runCron()).toMatchObject({ resolved: 1, escalated: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
