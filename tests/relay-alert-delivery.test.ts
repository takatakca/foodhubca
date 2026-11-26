import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { GET as callStatus } from '../app/api/foodhub/messages/call-status/route';
import { GET as messages } from '../app/api/foodhub/messages/route';
import { POST as heartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import type { OutboxEntry } from '../lib/foodhub/notify';
import type { CallStatus } from '../lib/foodhub/notify/call-status';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen, type Heartbeat, type ScreenPlatform } from '../lib/foodhub/screens';
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
});
