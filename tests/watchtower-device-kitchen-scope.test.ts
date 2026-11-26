import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { POST as relayHeartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { getCatalog, saveLocation } from '../lib/foodhub/catalog';
import { enrollDevice, getDevice, heartbeat } from '../lib/foodhub/identity/devices';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen } from '../lib/foodhub/screens';
import { getIncident, listIncidents, saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';
import { DEFAULT_RULES, WATCH_BACKGROUND_COMPLETION_KEY } from '../lib/foodhub/watch/types';

const owner: Actor = { username: 'owner', name: 'Synthetic owner', source: 'dashboard' };
const kitchen = { code: 'RETIRING_FIXTURE', name: 'Retiring test kitchen', active: true, address: '' };
const cronSecret = 'native-tablet-scope-fixture-secret';
const relayToken = 'relay-screen-scope-fixture-secret';
const start = Date.parse('2026-11-26T17:00:00Z'); // Noon in Montréal, inside fallback opening hours.
const blockedFetch = vi.fn().mockRejectedValue(new Error('Provider traffic disabled'));

function advanceTo(minute: number) {
  vi.setSystemTime(start + minute * 60_000);
}

function signedCron() {
  return cronWatch(new NextRequest('http://127.0.0.1/api/foodhub/cron/watch', { headers: { authorization: `Bearer ${cronSecret}` } }));
}

async function tick(minute: number): Promise<WatchReport> {
  advanceTo(minute);
  const response = await signedCron();
  expect(response.status).toBe(200);
  return (await response.json()).report;
}

async function pairTablet(locationCode = kitchen.code) {
  const { device } = await enrollDevice({ name: 'Synthetic kitchen tablet', locationCode }, owner);
  return device;
}

async function deviceIncidents(deviceId: string) {
  return (await listIncidents()).filter((incident) => incident.deviceId === deviceId);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  advanceTo(0);
  vi.stubGlobal('__foodhubMem', undefined);
  blockedFetch.mockClear();
  vi.stubGlobal('fetch', blockedFetch);
  const env = {
    CRON_SECRET: cronSecret, FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto',
    FOODHUB_WATCH_INTERVAL_S: '0', FOODHUB_INTERNAL_SYNC_MIN: '0', LIVE_CONNECTORS_GLOBAL_ENABLED: 'false',
    FOODHUB_CLOVER_WEBSITE_ORDERS: 'off', FOODHUB_MEV_CLOVER_REGISTER: 'off',
    FOODHUB_SCREENS_AGENT_TOKEN: relayToken, FOODHUB_SCREENS_VIEW_HOSTS: '',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '', TWILIO_MESSAGING_SERVICE_SID: '',
    ALERT_WEBHOOK_URL: '', ANTHROPIC_API_KEY: '', TGTG_IMAP_HOST: '',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await saveLocation(kitchen);
  await saveWatchSettings({
    enabled: true, postToChat: false, aiExplain: false,
    rules: {
      ...DEFAULT_RULES,
      device_offline: { enabled: true, escalate: false },
      device_muted: { enabled: true, escalate: false },
      screen_down: { enabled: true, escalate: false },
      screen_waiting: { enabled: true, escalate: false },
    },
  }, owner);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['device_offline', 'device_muted'] as const)('suppresses %s for an inactive kitchen and resumes after reactivation', async (kind) => {
  const device = await pairTablet();
  await saveLocation({ ...kitchen, active: false });
  if (kind === 'device_muted') {
    advanceTo(6);
    await heartbeat(device, { soundOn: false });
  }
  await tick(6);
  expect(await deviceIncidents(device.id)).toEqual([]);
  expect(await getDevice(device.id)).toMatchObject({ id: device.id, locationCode: kitchen.code });
  expect((await getDevice(device.id))?.revoked).toBeFalsy();

  await saveLocation(kitchen);
  await tick(7);
  expect(await deviceIncidents(device.id)).toMatchObject([{ kind, status: 'open', locationCode: kitchen.code }]);
  expect(blockedFetch).not.toHaveBeenCalled();
});

it.each(['screen_down', 'screen_waiting'] as const)('suppresses %s for an inactive kitchen and resumes after reactivation', async (kind) => {
  const screen = await addScreen({ name: 'Synthetic relay screen', platform: 'doordash', locationCode: kitchen.code, viewUrl: 'http://127.0.0.1/s01/' }, owner);
  if ('error' in screen) throw new Error(screen.error);

  const sendHeartbeat = async () => {
    const response = await relayHeartbeat(new Request('http://127.0.0.1/api/foodhub/screens/heartbeat', {
      method: 'POST',
      headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ screens: [{ id: screen.id, state: 'ok', title: kind === 'screen_waiting' ? '(3) Orders' : 'Orders' }] }),
    }));
    expect(response.status).toBe(200);
  };

  await sendHeartbeat();
  await saveLocation({ ...kitchen, active: false });
  if (kind === 'screen_waiting') {
    advanceTo(6);
    await sendHeartbeat();
  }
  await tick(6);
  expect(await deviceIncidents(screen.id)).toEqual([]);
  expect(await getScreen(screen.id)).toMatchObject({ id: screen.id, locationCode: kitchen.code });

  await saveLocation(kitchen);
  await tick(7);
  expect(await deviceIncidents(screen.id)).toMatchObject([{ kind, status: 'open', locationCode: kitchen.code }]);
  expect(blockedFetch).not.toHaveBeenCalled();
});

it('closes an existing offline incident on deactivation and reopens it without inventing a tablet signal', async () => {
  const device = await pairTablet();
  await tick(6);
  const [opened] = await deviceIncidents(device.id);
  expect(opened).toMatchObject({ status: 'open' });

  await saveLocation({ ...kitchen, active: false });
  expect(await tick(7)).toMatchObject({ resolved: 1, escalated: 0 });
  expect(await getIncident(opened.id)).toMatchObject({ status: 'resolved', resolvedBy: 'auto', lastSeenAt: opened.lastSeenAt });
  expect((await getIncident(opened.id))?.steps.at(-1)?.message).toContain('Monitoring stopped for this inactive kitchen');
  expect((await getDevice(device.id))?.lastSeenAt).toBe(device.lastSeenAt);

  await saveLocation(kitchen);
  await tick(8);
  expect(await deviceIncidents(device.id)).toMatchObject([{ id: opened.id, kind: 'device_offline', status: 'open' }]);
  expect(blockedFetch).not.toHaveBeenCalled();
});

it('retains monitoring for a legacy tablet whose location is absent from a successfully loaded catalog', async () => {
  const locationCode = 'LEGACY_UNCATALOGED';
  expect((await getCatalog({ strict: true })).locations.some((location) => location.code === locationCode)).toBe(false);
  const device = await pairTablet(locationCode);
  await tick(6);
  expect(await deviceIncidents(device.id)).toMatchObject([{ kind: 'device_offline', status: 'open', locationCode }]);
  expect(blockedFetch).not.toHaveBeenCalled();
});

it('keeps existing incidents and the completion marker intact if the catalog read fails', async () => {
  const device = await pairTablet();
  await tick(6);
  const [opened] = await deviceIncidents(device.id);
  const repo = getRepo();
  const previousCompletion = await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY);
  expect(previousCompletion).toMatchObject({ trigger: 'cron' });
  await saveLocation({ ...kitchen, active: false });
  advanceTo(7);
  await heartbeat(device, { soundOn: true });

  const read = repo.getKv.bind(repo);
  const failedCatalog = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
    if (key === 'catalog') throw new Error('Synthetic catalog read failure');
    return read<T>(key);
  });
  try {
    expect((await signedCron()).status).toBe(500);
  } finally {
    failedCatalog.mockRestore();
  }
  expect(await getIncident(opened.id)).toMatchObject({ status: 'open', lastSeenAt: opened.lastSeenAt });
  expect(await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY)).toEqual(previousCompletion);
  expect(blockedFetch).not.toHaveBeenCalled();
  expect(await tick(8)).toMatchObject({ resolved: 1, escalated: 0 });
});
