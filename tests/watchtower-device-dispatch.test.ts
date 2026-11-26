import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { POST as relayHeartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { enrollDevice, heartbeat as tabletHeartbeat } from '../lib/foodhub/identity/devices';
import { listOutbox } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, type Heartbeat } from '../lib/foodhub/screens';
import { listIncidents, saveWatchSettings } from '../lib/foodhub/watch/engine';

const BASE = 'https://foodhub.example.test/api/foodhub';
const START = Date.parse('2026-11-26T17:00:00Z');
const OWNER: Actor = { username: 'owner', name: 'Fixture owner', source: 'dashboard' };
const CRON_TOKEN = 'fixture-watch-catalog-cron-token';
const RELAY_TOKEN = 'fixture-watch-catalog-relay-token';
const KITCHEN = { code: 'TEST_KITCHEN', name: 'Fixture kitchen', address: '', active: true, phone: '+15145550101' };
const LEGACY_KITCHEN = 'TEST_LEGACY_KITCHEN';
const HOTLINE = '+15145550102';
const MANAGER_PHONE = '+15145550103';
const TWILIO_ACCOUNT = `AC${'1'.repeat(32)}`;
const TWILIO_BASE = 'https://twilio.example.test';
const kinds = ['device_offline', 'device_muted', 'screen_down', 'screen_waiting'] as const;
const provider = vi.fn<typeof fetch>();

function at(minute: number) {
  vi.setSystemTime(START + minute * 60_000);
}

async function relayReport(screen: Heartbeat['screens'][number]) {
  const response = await relayHeartbeat(new Request(`${BASE}/screens/heartbeat`, {
    method: 'POST', headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ screens: [screen] }),
  }));
  expect(response.status).toBe(200);
}

async function runCron() {
  const response = await cronWatch(new NextRequest(`${BASE}/cron/watch`, { headers: { authorization: `Bearer ${CRON_TOKEN}` } }));
  expect(response.status).toBe(200);
  return (await response.json()).report;
}

async function openIncident(kind: typeof kinds[number], locationCode = KITCHEN.code) {
  let deviceId: string;
  let refresh = async () => {};
  if (kind === 'device_offline' || kind === 'device_muted') {
    const { device } = await enrollDevice({ name: 'Fixture tablet', locationCode }, OWNER);
    deviceId = device.id;
    if (kind === 'device_muted') refresh = async () => { await tabletHeartbeat(device, { soundOn: false }); };
  } else {
    const screen = await addScreen({ name: 'Fixture relay screen', platform: 'skip', locationCode, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
    if ('error' in screen) throw new Error(screen.error);
    deviceId = screen.id;
    const report: Heartbeat['screens'][number] = { id: deviceId, state: 'ok', mode: 'android', waiting: kind === 'screen_waiting' ? 2 : 0 };
    await relayReport(report);
    if (kind === 'screen_waiting') refresh = () => relayReport(report);
  }
  async function tick(minute: number) {
    at(minute);
    await refresh();
    return runCron();
  }
  expect(await tick(6)).toMatchObject({ opened: 1, escalated: 0 });
  const incident = (await listIncidents()).find((item) => item.deviceId === deviceId && item.kind === kind);
  if (!incident) throw new Error(`Missing detected fixture incident: ${kind}`);
  expect(incident).toMatchObject({ status: 'open', locationCode, level: 0 });
  return { incident, tick };
}

function interruptDispatchCatalog(work: () => Promise<unknown>) {
  const repo = getRepo();
  const getKv = repo.getKv;
  let catalogReads = 0;
  let completed = false;
  const spy = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
    if (key === 'catalog' && ++catalogReads === 2) {
      completed = true;
      await work();
    }
    return getKv<T>(key);
  });
  return { spy, interrupted: () => completed };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  const env = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto', LIVE_CONNECTORS_GLOBAL_ENABLED: 'false',
    FOODHUB_CLOVER_WEBSITE_ORDERS: 'off', FOODHUB_MEV_CLOVER_REGISTER: 'off', TGTG_IMAP_HOST: '',
    FOODHUB_SCREENS_VIEW_HOSTS: 'relay.example.test', FOODHUB_SCREENS_AGENT_TOKEN: RELAY_TOKEN,
    CRON_SECRET: CRON_TOKEN, SESSION_SECRET: 'fixture-device-signing-secret',
    TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT, TWILIO_AUTH_TOKEN: 'fixture-twilio-token', TWILIO_FROM: '+15145550104', TWILIO_BASE_URL: TWILIO_BASE,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  provider.mockReset().mockImplementation(async (input, init) => {
    expect(init?.method).toBe('POST');
    const path = String(input);
    const prefix = `${TWILIO_BASE}/2010-04-01/Accounts/${TWILIO_ACCOUNT}/`;
    expect([`${prefix}Calls.json`, `${prefix}Messages.json`]).toContain(path);
    const sid = `${path.endsWith('Calls.json') ? 'CA' : 'SM'}${'2'.repeat(32)}`;
    return Response.json({ sid, status: 'queued' }, { status: 201 });
  });
  vi.stubGlobal('fetch', provider);
  await saveLocation(KITCHEN);
  await saveHours({ locations: { [KITCHEN.code]: allDayWeek(), [LEGACY_KITCHEN]: allDayWeek() }, brands: {}, holidays: [] });
  await getRepo().saveUser({ username: 'fixture-manager', name: 'Fixture manager', role: 'manager', locations: [], active: true, passwordHash: 'unused-fixture-hash', phone: MANAGER_PHONE });
  await saveWatchSettings({ enabled: true, screenAlertPhone: HOTLINE, smsAfterMin: 1, postToChat: false, aiExplain: false }, OWNER);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it.each(kinds)('does not dispatch a detected %s once its kitchen is deactivated', async (kind) => {
  const { incident, tick } = await openIncident(kind);
  const { spy, interrupted } = interruptDispatchCatalog(() => saveLocation({ ...KITCHEN, active: false }));
  const report = await tick(7);
  spy.mockRestore();

  expect(interrupted()).toBe(true);
  expect(report).toMatchObject({ escalated: 0, resolved: 0 });
  expect((await listIncidents()).find((item) => item.id === incident.id)).toMatchObject({ status: 'open', level: 0 });
  expect(provider).not.toHaveBeenCalled();
  expect(await listOutbox()).toEqual([]);
  expect(await getRepo().getKv(`watch:first-screen-call:${incident.id}`)).toBeNull();
  expect(await getRepo().getKv(`watch:screen-stage:${incident.id}:1`)).toBeNull();
});

it('defers on a dispatch catalog read error and then runs the same open alert', async () => {
  const { incident, tick } = await openIncident('device_offline');
  const { spy, interrupted } = interruptDispatchCatalog(() => Promise.reject(new Error('Synthetic catalog read failure')));
  const report = await tick(7);
  spy.mockRestore();

  expect(interrupted()).toBe(true);
  expect(report).toMatchObject({ escalated: 0, resolved: 0 });
  expect((await listIncidents()).find((item) => item.id === incident.id)).toMatchObject({ status: 'open', level: 0 });
  expect(provider).not.toHaveBeenCalled();
  expect(await listOutbox()).toEqual([]);
  expect(await getRepo().getKv(`watch:first-screen-call:${incident.id}`)).toBeNull();
  expect(await getRepo().getKv(`watch:screen-stage:${incident.id}:1`)).toBeNull();

  expect(await tick(8)).toMatchObject({ escalated: 1, resolved: 0 });
  expect(await listOutbox()).toContainEqual(expect.objectContaining({ incidentId: incident.id, purpose: 'alert_shared_screen', channel: 'call', ok: true }));
});

it('keeps the shared route for an existing device with a legacy unlisted kitchen', async () => {
  const { incident, tick } = await openIncident('device_offline', LEGACY_KITCHEN);
  expect(await tick(7)).toMatchObject({ escalated: 1, resolved: 0 });
  expect(await listOutbox()).toContainEqual(expect.objectContaining({ incidentId: incident.id, purpose: 'alert_shared_screen', channel: 'call', ok: true }));
});

it('still notifies the manager about an unseen order during the catalog read failure', async () => {
  const { order } = await getRepo().insertOrderIfNew({
    channel: 'skip', marketplace: 'skip', locationCode: KITCHEN.code, channelStoreId: 'fixture-store',
    externalOrderId: 'fixture-order', placedAt: new Date().toISOString(), fulfillment: 'pickup', currency: 'CAD',
    subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10, lines: [], raw: {},
  });
  await getRepo().updateOrder(order.id, { status: 'accepted' });
  at(6);
  expect(await runCron()).toMatchObject({ opened: 1, escalated: 0 });
  const incident = (await listIncidents()).find((item) => item.orderId === order.id && item.kind === 'order_unseen');
  if (!incident) throw new Error('Missing unseen order fixture incident');

  const { spy, interrupted } = interruptDispatchCatalog(() => Promise.reject(new Error('Synthetic catalog read failure')));
  at(7);
  const report = await runCron();
  spy.mockRestore();

  expect(interrupted()).toBe(true);
  expect(report).toMatchObject({ escalated: 1, resolved: 0 });
  expect(await listOutbox()).toContainEqual(expect.objectContaining({ incidentId: incident.id, purpose: 'alert', channel: 'sms', ok: true }));
});
