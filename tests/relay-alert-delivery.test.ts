import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { PATCH as patchProfile } from '../app/api/foodhub/auth/me/route';
import { GET as callStatus } from '../app/api/foodhub/messages/call-status/route';
import { GET as messages } from '../app/api/foodhub/messages/route';
import { POST as heartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { sessionCookieFor } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import type { OutboxEntry } from '../lib/foodhub/notify';
import type { CallStatus } from '../lib/foodhub/notify/call-status';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen, updateScreen, type Heartbeat, type ScreenPlatform } from '../lib/foodhub/screens';
import { INCIDENTS, actOnIncident, getIncident, listIncidents, saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';

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

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
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


  it.each([
    { reason: 'the owner signs out of voice alerts', supportPhone: null },
    { reason: 'the owner profile cannot be read', supportPhone: '+15145550128' },
  ])('preserves the SMS and later routes when $reason during the owner SMS', async ({ supportPhone }) => {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    await saveWatchSettings({ smsAfterMin: 1, callAfterMin: 1, ownerAfterMin: 1, screenAlertPhone: null, supportPhones: supportPhone ? [supportPhone] : [] }, OWNER);
    const managerPhone = '+15145550126';
    const ownerPhone = '+15145550127';
    const ownerSmsSid = `SM${'4'.repeat(32)}`;
    const repo = getRepo();
    await repo.saveUser({ username: 'manager-stage-three-control', name: 'Control manager', phone: managerPhone, role: 'manager', locations: [KITCHEN], active: true });
    const owner = await repo.saveUser({ username: 'owner-stage-three-personal', name: 'Personal owner', phone: ownerPhone, role: 'owner', locations: [KITCHEN], active: true });

    const ownerSmsStarted = gate();
    const ownerSmsReleased = gate();
    const requests: Array<{ channel: 'sms' | 'call'; to: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(TWILIO_BASE);
      const channel = url.pathname.endsWith('/Messages.json') ? 'sms' : 'call';
      if (channel === 'call') expect(String(input)).toBe(`${CALLS}.json`);
      const form = new URLSearchParams(String(init?.body));
      const to = form.get('To');
      requests.push({ channel, to });
      if (channel === 'sms' && to === ownerPhone) {
        expect(form.get('Body')).toContain('min sans réponse');
        ownerSmsStarted.resolve();
        await ownerSmsReleased.promise;
        return Response.json({ sid: ownerSmsSid }, { status: 201 });
      }
      return Response.json({ sid: channel === 'call' ? CALL_SID : `SM${'3'.repeat(32)}` }, { status: 201 });
    });

    const expected = [
      { channel: 'sms', to: managerPhone },
      ...(supportPhone ? [{ channel: 'sms', to: supportPhone }] : []),
      { channel: 'call', to: managerPhone },
      { channel: 'sms', to: ownerPhone },
    ];
    const readUser = supportPhone ? vi.spyOn(repo, 'getUser') : undefined;
    const pending = tick(1);
    try {
      await Promise.race([
        ownerSmsStarted.promise,
        pending.then(() => { throw new Error('Expected the personal owner SMS to be in flight'); }),
      ]);
      expect(requests).toEqual(expected);
      if (readUser) {
        readUser.mockRejectedValueOnce(new Error('Temporary user storage error'));
      } else {
        const cookie = (await sessionCookieFor(owner, 'password')).split(';')[0];
        const response = await patchProfile(new Request(`${BASE}/auth/me`, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ prefs: { alertCall: false } }),
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ user: { prefs: { alertCall: false } } });
      }
    } finally {
      ownerSmsReleased.resolve();
      try { await pending; } finally { readUser?.mockRestore(); }
    }

    const receipts = (await readOutbox()).filter((entry) => entry.incidentId === incident.id);
    expect(receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sms', purpose: 'alert_owner', ok: true, ref: ownerSmsSid }),
      expect.objectContaining({ channel: 'call', purpose: 'alert', ok: true, ref: CALL_SID }),
    ]));
    expect(await getIncident(incident.id)).toMatchObject({ level: 3 });
    await tick(2);
    expect(requests).toEqual(supportPhone ? [...expected, { channel: 'call', to: supportPhone }] : expected);
    if (supportPhone) expect(receipts).toContainEqual(expect.objectContaining({ channel: 'call', purpose: 'alert_support', ok: true, ref: CALL_SID }));
  });

  async function prepareManagerVoice(secondRole: 'manager' | 'owner' = 'manager') {
    const { incident, tick } = await openScreenIncident(offlineScreen);
    await saveWatchSettings({ callAfterMin: 2, ownerAfterMin: 30 }, OWNER);
    const repo = getRepo();
    const firstPhone = '+15145550126';
    const secondPhone = '+15145550127';
    if (secondRole === 'manager') await repo.saveUser({ username: 'manager-a', name: 'First manager', phone: firstPhone, role: 'manager', locations: [KITCHEN], active: true, prefs: { alertSms: false } });
    const second = await repo.saveUser({ username: 'manager-b', name: 'Second recipient', phone: secondPhone, role: secondRole, locations: [KITCHEN], active: true, prefs: { alertSms: false } });
    await tick(1);
    return { incident, tick, firstPhone, second, secondPhone };
  }

  it.each([
    { reason: 'the next manager goes off duty', prefs: { onDuty: false } },
    { reason: 'the next manager disables calls', prefs: { alertCall: false } },
    { reason: 'the next manager cannot be read', prefs: null },
  ])('preserves the first call when $reason while it is in progress', async ({ prefs }) => {
    const { incident, tick, firstPhone, second } = await prepareManagerVoice();
    const firstStarted = gate();
    const firstReleased = gate();
    const calls: Array<string | null> = [];
    fetchMock.mockImplementation(async (input, init) => {
      expect(input).toBe(`${CALLS}.json`);
      const to = new URLSearchParams(String(init?.body)).get('To');
      calls.push(to);
      if (to === firstPhone) {
        firstStarted.resolve();
        await firstReleased.promise;
      }
      return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
    });

    const readUser = prefs ? undefined : vi.spyOn(getRepo(), 'getUser');
    const pending = tick(2);
    try {
      await firstStarted.promise;
      if (prefs) {
        const cookie = (await sessionCookieFor(second, 'password')).split(';')[0];
        const response = await patchProfile(new Request(`${BASE}/auth/me`, {
          method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ prefs }),
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ user: { prefs } });
      } else {
        readUser?.mockRejectedValueOnce(new Error('Temporary user storage error'));
      }
    } finally {
      firstReleased.resolve();
      try { await pending; } finally { readUser?.mockRestore(); }
    }
    await tick(3);
    expect(calls).toEqual([firstPhone]);
    expect(await getIncident(incident.id)).toMatchObject({ level: 2 });
    expect(await readOutbox()).toMatchObject([{ incidentId: incident.id, purpose: 'alert', ok: true, ref: CALL_SID }]);
  });

  it('defers an unreadable owner fallback before starting any manager-stage voice request', async () => {
    const { incident, tick, secondPhone } = await prepareManagerVoice('owner');
    fetchMock.mockResolvedValue(Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 }));
    const readUser = vi.spyOn(getRepo(), 'getUser').mockRejectedValueOnce(new Error('Temporary user storage error'));
    try {
      await tick(2);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await getIncident(incident.id)).toMatchObject({ level: 1 });
    } finally {
      readUser.mockRestore();
    }
    await tick(3);
    await tick(4);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${CALLS}.json`, expect.objectContaining({ method: 'POST' }));
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('To')).toBe(secondPhone);
    expect(await getIncident(incident.id)).toMatchObject({ level: 2 });
  });

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
    const claim = vi.spyOn(getRepo(), 'claimKv').mockRejectedValueOnce(new Error('Temporary database failure'));
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
