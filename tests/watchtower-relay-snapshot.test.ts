import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { POST as relayHeartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation } from '../lib/foodhub/catalog';
import { enrollDevice } from '../lib/foodhub/identity/devices';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen, removeScreen, SCREENS } from '../lib/foodhub/screens';
import { getIncident, listIncidents, saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';
import { DEFAULT_RULES, WATCH_BACKGROUND_COMPLETION_KEY } from '../lib/foodhub/watch/types';

const owner: Actor = { username: 'owner', name: 'Synthetic owner', source: 'dashboard' };
const location = { code: 'RELAY_FAILURE', name: 'Synthetic kitchen', active: true, address: '' };
const cronSecret = 'fixture-cron-credential-never-production';
const relayToken = 'fixture-relay-credential-never-production';
const start = Date.parse('2026-11-26T17:00:00Z');
const syntheticAccount = 'AC' + 'a'.repeat(32);
const syntheticPhone = '+15145550123';
const provider = 'http://127.0.0.1:1';
const fetchFixture = vi.fn(async (url: string, init?: RequestInit) => {
  expect(url).toBe(`${provider}/2010-04-01/Accounts/${syntheticAccount}/Calls.json`);
  expect(init?.method).toBe('POST');
  expect(new URLSearchParams(String(init?.body)).get('To')).toBe(syntheticPhone);
  return Response.json({ sid: 'CA' + 'a'.repeat(32), status: 'queued' }, { status: 201 });
});

function advanceTo(minute: number) { vi.setSystemTime(start + minute * 60_000); }

async function tick(minute: number): Promise<WatchReport> {
  advanceTo(minute);
  const response = await cronWatch(new NextRequest('http://127.0.0.1/api/foodhub/cron/watch', { headers: { authorization: `Bearer ${cronSecret}` } }));
  expect(response.status).toBe(200);
  return (await response.json()).report;
}

async function tickWithoutRelay(minute: number): Promise<WatchReport> {
  const repo = getRepo();
  const read = repo.listDocs.bind(repo);
  const broken = vi.spyOn(repo, 'listDocs').mockImplementation(async <T>(collection: string, filter?: Parameters<typeof repo.listDocs>[1]) => {
    if (collection === SCREENS) throw new Error('Synthetic one-pass relay storage timeout');
    return read<T>(collection, filter);
  });
  try {
    return await tick(minute);
  } finally {
    broken.mockRestore();
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  advanceTo(0);
  vi.stubGlobal('__foodhubMem', undefined);
  fetchFixture.mockClear();
  vi.stubGlobal('fetch', fetchFixture); // Entire provider surface is inert; even the configured base is local port 1.
  const env = {
    CRON_SECRET: cronSecret, FOODHUB_SCREENS_AGENT_TOKEN: relayToken, FOODHUB_SCREENS_VIEW_HOSTS: '',
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto', FOODHUB_WATCH_INTERVAL_S: '0',
    FOODHUB_INTERNAL_SYNC_MIN: '0', LIVE_CONNECTORS_GLOBAL_ENABLED: 'false',
    FOODHUB_CLOVER_WEBSITE_ORDERS: 'off', FOODHUB_MEV_CLOVER_REGISTER: 'off', TGTG_IMAP_HOST: '',
    ALERT_WEBHOOK_URL: '', ANTHROPIC_API_KEY: '', TWILIO_ACCOUNT_SID: syntheticAccount,
    TWILIO_AUTH_TOKEN: 'unroutable-fixture-credential', TWILIO_FROM: '+15145550124', TWILIO_BASE_URL: provider,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await saveLocation(location);
  await saveWatchSettings({ enabled: true, screenAlertPhone: syntheticPhone, smsAfterMin: 2, postToChat: false, aiExplain: false,
    rules: { ...DEFAULT_RULES, device_offline: { enabled: true, escalate: false } } }, owner);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['screen_down', 'screen_waiting'] as const)('keeps %s and monitors native tablets while the relay list is unavailable', async (kind) => {
  const screen = await addScreen({ name: 'Synthetic relay', platform: 'doordash', locationCode: location.code, viewUrl: 'http://127.0.0.1/s01/' }, owner);
  if ('error' in screen) throw new Error(screen.error);
  const screenId = screen.id;
  async function sendSignal() {
    const response = await relayHeartbeat(new Request('http://127.0.0.1/api/foodhub/screens/heartbeat', {
      method: 'POST', headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ screens: [{ id: screenId, state: 'ok', title: kind === 'screen_waiting' ? '(3) Orders' : 'Orders' }] }),
    }));
    expect(response.status).toBe(200);
  }
  await sendSignal();
  if (kind === 'screen_waiting') { advanceTo(6); await sendSignal(); }
  expect(await tick(6)).toMatchObject({ opened: 1, escalated: 0 });
  const [opened] = (await listIncidents()).filter(({ deviceId }) => deviceId === screen.id);
  expect(opened).toMatchObject({ kind, status: 'open', level: 0 });
  const lastGoodIncident = structuredClone(opened);
  const { device: native } = await enrollDevice({ name: 'Synthetic healthy native at pair', locationCode: location.code }, owner);
  if (kind === 'screen_waiting') { advanceTo(8); await sendSignal(); }
  const lastGoodScreen = await getScreen(screen.id);
  const repo = getRepo();
  const lastCompleted = await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY);
  expect(await tickWithoutRelay(8)).toMatchObject({ ran: true, relayUnavailable: true, opened: 1, resolved: 0, escalated: 0 });
  expect(await getIncident(opened.id)).toEqual(lastGoodIncident);
  expect(await getScreen(screen.id)).toEqual(lastGoodScreen);
  expect((await listIncidents()).find(({ deviceId }) => deviceId === native.id)).toMatchObject({ status: 'open', kind: 'device_offline' });
  expect(await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY)).toEqual(lastCompleted);
  expect(fetchFixture).not.toHaveBeenCalled();

  const restored = await tick(9);
  expect(restored).toMatchObject({ opened: 0, resolved: 0, escalated: 1 });
  expect(restored.relayUnavailable).toBeUndefined();
  expect(await repo.getKv(WATCH_BACKGROUND_COMPLETION_KEY)).toMatchObject({ at: new Date(start + 9 * 60_000).toISOString(), trigger: 'cron' });
  expect(await getIncident(opened.id)).toMatchObject({ status: 'open', level: 1 });
  expect((await getIncident(opened.id))?.steps.map(({ kind: step }) => step)).toEqual(['opened', 'call', 'sms']);
  expect(fetchFixture).toHaveBeenCalledTimes(1);
});

it.each([false, true])('accepts independently confirmed resolution (inactive catalog during failure: %s)', async (inactive) => {
  const screen = await addScreen({ name: 'Synthetic relay', platform: 'doordash', locationCode: location.code, viewUrl: 'http://127.0.0.1/s01/' }, owner);
  if ('error' in screen) throw new Error(screen.error);
  const response = await relayHeartbeat(new Request('http://127.0.0.1/api/foodhub/screens/heartbeat', {
    method: 'POST', headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ screens: [{ id: screen.id, state: 'crashed', title: 'Orders' }] }),
  }));
  expect(response.status).toBe(200);
  expect(await tick(0)).toMatchObject({ opened: 1 });
  const [opened] = (await listIncidents()).filter(({ deviceId }) => deviceId === screen.id);
  if (inactive) {
    await saveLocation({ ...location, active: false });
    expect(await tickWithoutRelay(2)).toMatchObject({ relayUnavailable: true, resolved: 1, escalated: 0 });
  } else {
    expect(await removeScreen(screen.id, owner, (code) => code === location.code)).toBe(true);
    const report = await tick(2);
    expect(report).toMatchObject({ resolved: 1, escalated: 0 });
    expect(report.relayUnavailable).toBeUndefined();
  }
  const resolved = await getIncident(opened.id);
  expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
  expect(resolved?.steps.at(-1)?.message).toContain(inactive ? 'inactive kitchen' : 'Fixed');
  expect(fetchFixture).not.toHaveBeenCalled();
});
