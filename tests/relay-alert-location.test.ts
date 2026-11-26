import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { PATCH as moveTablet } from '../app/api/foodhub/devices/[id]/route';
import { GET as getScopedIncidents } from '../app/api/foodhub/incidents/route';
import { PATCH as moveScreen } from '../app/api/foodhub/screens/[id]/route';
import { POST as heartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { enrollDevice, getDevice } from '../lib/foodhub/identity/devices';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, type Heartbeat } from '../lib/foodhub/screens';
import { saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';
import type { Incident } from '../lib/foodhub/watch/types';

const BASE = 'https://foodhub.example.test/api/foodhub';
const START = Date.parse('2026-11-26T17:00:00Z');
const OWNER: Actor = { username: 'owner', name: 'Test owner', source: 'dashboard' };
const PASSWORD = 'test-screen-kitchen-password';
const RELAY_TOKEN = 'test-screen-kitchen-relay-token';
const CRON_TOKEN = 'test-screen-kitchen-cron-token';
const ORIGINAL = { code: 'TEST_ORIGINAL', name: 'Original kitchen fixture', phone: '+15145550123', address: '', active: true, manager: 'original-manager' };
const DESTINATION = { code: 'TEST_DESTINATION', name: 'Destination kitchen fixture', phone: '+15145550124', address: '', active: true, manager: 'destination-manager' };
const TWILIO_BASE = 'https://twilio.example.test';
const TWILIO_ACCOUNT = `AC${'1'.repeat(32)}`;
const CALLS = `${TWILIO_BASE}/2010-04-01/Accounts/${TWILIO_ACCOUNT}/Calls.json`;
const CALL_SID = `CA${'2'.repeat(32)}`;
const fetchMock = vi.fn<typeof fetch>();

function advanceTo(minute: number) {
  vi.setSystemTime(START + minute * 60_000);
}

function basicHeaders(username: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` };
}

async function relayReport(screen: Heartbeat['screens'][number]) {
  const response = await heartbeat(new Request(`${BASE}/screens/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ screens: [screen] }),
  }));
  expect(response.status).toBe(200);
}

async function runCron(): Promise<WatchReport> {
  const response = await cronWatch(new NextRequest(`${BASE}/cron/watch`, { headers: { authorization: `Bearer ${CRON_TOKEN}` } }));
  expect(response.status).toBe(200);
  const { report } = await response.json();
  return report;
}

async function readIncidents(manager: string): Promise<Incident[]> {
  const response = await getScopedIncidents(new Request(`${BASE}/incidents`, { headers: basicHeaders(manager) }), undefined);
  expect(response.status).toBe(200);
  return (await response.json()).incidents;
}

function calls() {
  return fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  advanceTo(0);
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto', LIVE_CONNECTORS_GLOBAL_ENABLED: 'false',
    FOODHUB_CLOVER_WEBSITE_ORDERS: 'off', FOODHUB_MEV_CLOVER_REGISTER: 'off', TGTG_IMAP_HOST: '',
    FOODHUB_SCREENS_VIEW_HOSTS: 'relay.example.test', FOODHUB_SCREENS_AGENT_TOKEN: RELAY_TOKEN,
    CRON_SECRET: CRON_TOKEN, DASHBOARD_PASSWORD: PASSWORD, SESSION_SECRET: 'test-device-signing-secret',
    TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT, TWILIO_AUTH_TOKEN: 'test-twilio-token', TWILIO_FROM: '+15145550125', TWILIO_BASE_URL: TWILIO_BASE,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    expect(url).toBe(CALLS);
    expect(init?.method).toBe('POST');
    return Response.json({ sid: CALL_SID, status: 'queued' }, { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);

  const passwordHash = hashPassword(PASSWORD);
  for (const kitchen of [ORIGINAL, DESTINATION]) {
    await saveLocation(kitchen);
    await getRepo().saveUser({ username: kitchen.manager, name: kitchen.manager, role: 'manager', locations: [kitchen.code], active: true, passwordHash });
  }
  await saveHours({ locations: { [ORIGINAL.code]: allDayWeek(), [DESTINATION.code]: allDayWeek() }, brands: {}, holidays: [] });
  await saveWatchSettings({ enabled: true, screenAlertPhone: null, smsAfterMin: 1, unacceptedAfterSec: 60, postToChat: false, aiExplain: false }, OWNER);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const scenarios = [
  { description: 'an offline platform screen', kind: 'screen_down', platform: 'skip', detectedAt: 6, priorAlert: 'opened' },
  { description: 'a platform screen with waiting orders', kind: 'screen_waiting', platform: 'doordash', detectedAt: 2, priorAlert: 'opened' },
  { description: 'an offline native tablet', kind: 'device_offline', platform: null, detectedAt: 6, priorAlert: 'opened' },
  { description: 'an offline platform screen previously called at its original kitchen', kind: 'screen_down', platform: 'skip', detectedAt: 6, priorAlert: 'called' },
  { description: 'a platform screen that starts failing again after its original alert resolved', kind: 'screen_down', platform: 'skip', detectedAt: 6, priorAlert: 'resolved' },
] as const;

it.each(scenarios)('keeps the right phone and alert history when moving $description', async ({ kind, platform, detectedAt, priorAlert }) => {
  let id: string;
  if (platform) {
    const screen = await addScreen({ name: 'Test platform screen', platform, locationCode: ORIGINAL.code, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    id = screen.id;
    await relayReport({ id, state: 'ok', title: 'Orders' });
    if (kind === 'screen_waiting') {
      advanceTo(1);
      await relayReport({ id, state: 'ok', mode: 'android', waiting: 2 });
    }
  } else {
    const { device } = await enrollDevice({ name: 'Test kitchen tablet', locationCode: ORIGINAL.code }, OWNER);
    id = device.id;
  }

  async function tick(minute: number) {
    advanceTo(minute);
    if (kind === 'screen_waiting') await relayReport({ id, state: 'ok', mode: 'android', waiting: 2 });
    return runCron();
  }

  expect(await tick(detectedAt)).toMatchObject({ opened: 1, escalated: 0 });
  const [original] = await readIncidents(ORIGINAL.manager);
  expect(original).toMatchObject({ kind, deviceId: id, locationCode: ORIGINAL.code, status: 'open' });
  expect(fetchMock).not.toHaveBeenCalled();

  const alreadyCalled = priorAlert === 'called';
  const recoveredBeforeMove = priorAlert === 'resolved';
  if (alreadyCalled) {
    expect(await tick(detectedAt + 1)).toMatchObject({ escalated: 1 });
    expect(calls().map((call) => call.get('To'))).toEqual([ORIGINAL.phone]);
  } else if (recoveredBeforeMove) {
    advanceTo(detectedAt + 1);
    await relayReport({ id, state: 'ok', title: 'Orders' });
    expect(await runCron()).toMatchObject({ resolved: 1, escalated: 0 });
    expect(await readIncidents(ORIGINAL.manager)).toMatchObject([{ id: original.id, status: 'resolved', resolvedBy: 'auto' }]);
  }

  const movedAt = detectedAt + (priorAlert === 'opened' ? 1 : 2);
  advanceTo(movedAt);
  function moveAs(username: string) {
    return (platform ? moveScreen : moveTablet)(new Request(`${BASE}/${platform ? 'screens' : 'devices'}/${id}`, {
      method: 'PATCH',
      headers: { ...basicHeaders(username), 'content-type': 'application/json' },
      body: JSON.stringify({ locationCode: DESTINATION.code }),
    }), { params: Promise.resolve({ id }) });
  }
  if (!platform) {
    expect((await moveAs(ORIGINAL.manager)).status).toBe(403);
    expect(await getDevice(id)).toMatchObject({ locationCode: ORIGINAL.code });
  }
  expect((await moveAs(OWNER.username)).status).toBe(200);
  if (recoveredBeforeMove) await relayReport({ id, state: 'crashed' });
  expect(await tick(movedAt)).toMatchObject({ opened: 1, resolved: recoveredBeforeMove ? 0 : 1, escalated: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(alreadyCalled ? 1 : 0);

  const history = await readIncidents(ORIGINAL.manager);
  expect(history).toMatchObject([{ id: original.id, locationCode: ORIGINAL.code, status: 'resolved', title: original.title }]);
  const current = await readIncidents(DESTINATION.manager);
  expect(current).toMatchObject([{ kind, deviceId: id, locationCode: DESTINATION.code, status: 'open' }]);
  expect(current[0].id).not.toBe(original.id);

  expect(await tick(movedAt + 1)).toMatchObject({ opened: 0, escalated: 1 });
  expect(calls().map((call) => call.get('To'))).toEqual(alreadyCalled ? [ORIGINAL.phone, DESTINATION.phone] : [DESTINATION.phone]);
  expect(calls().at(-1)?.get('Twiml')).toContain(DESTINATION.name);
});
