import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { DELETE as revokeTablet } from '../app/api/foodhub/devices/[id]/route';
import { GET as incidentsById } from '../app/api/foodhub/incidents/route';
import { GET as getCallStatus } from '../app/api/foodhub/messages/call-status/route';
import { POST as relayHeartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import { PATCH as updateRelayScreen } from '../app/api/foodhub/screens/[id]/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { enrollDevice, heartbeat as tabletHeartbeat } from '../lib/foodhub/identity/devices';
import { listOutbox } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, SCREENS, type Heartbeat } from '../lib/foodhub/screens';
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

it('checks device scope again after reserving the first call and retries when no request started', async () => {
  const { incident, tick } = await openIncident('device_offline');
  const repo = getRepo();
  const firstCallKey = `watch:first-screen-call:${incident.id}`;
  const stageKey = `watch:screen-stage:${incident.id}:1`;
  const claimKv = repo.claimKv.bind(repo);
  const getKv = repo.getKv.bind(repo);
  let failNextCatalogRead = false;
  const read = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
    if (key === 'catalog' && failNextCatalogRead) {
      failNextCatalogRead = false;
      throw new Error('Synthetic catalog outage immediately after reservation');
    }
    return getKv<T>(key);
  });
  const claim = vi.spyOn(repo, 'claimKv').mockImplementation(async (key, value) => {
    const reserved = await claimKv(key, value);
    if (key === firstCallKey && reserved) failNextCatalogRead = true;
    return reserved;
  });
  try {
    expect(await tick(7)).toMatchObject({ escalated: 0, resolved: 0 });
  } finally {
    claim.mockRestore();
    read.mockRestore();
  }
  expect(provider).not.toHaveBeenCalled();
  expect(await listOutbox()).toEqual([]);
  expect(await repo.getKv(firstCallKey)).toBeNull();
  expect(await repo.getKv(stageKey)).toBeNull();
  expect(await tick(8)).toMatchObject({ escalated: 1, resolved: 0 });
  expect((await listOutbox()).filter(({ channel }) => channel === 'call')).toMatchObject([
    { incidentId: incident.id, purpose: 'alert_shared_screen', ok: true },
  ]);
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

it('leaves a later incident unclaimed when its kitchen is deactivated during another call', async () => {
  const laterKitchen = { ...KITCHEN, code: 'TEST_Z_LATER_KITCHEN' };
  await saveLocation(laterKitchen);
  await enrollDevice({ name: 'First kitchen tablet', locationCode: KITCHEN.code }, OWNER);
  await enrollDevice({ name: 'Later kitchen tablet', locationCode: laterKitchen.code }, OWNER);
  at(6);
  expect(await runCron()).toMatchObject({ opened: 2, escalated: 0 });
  const incidents = (await listIncidents()).filter((item) => item.kind === 'device_offline');
  const first = incidents.find((item) => item.locationCode === KITCHEN.code);
  const later = incidents.find((item) => item.locationCode === laterKitchen.code);
  if (!first || !later) throw new Error('Missing tablet fixture incident');
  const respond = provider.getMockImplementation();
  if (!respond) throw new Error('Missing mock provider');
  provider.mockImplementationOnce(async (...args) => {
    expect(String(args[0])).toMatch(/Calls\.json$/);
    await saveLocation({ ...laterKitchen, active: false });
    return respond(...args);
  });
  at(7);
  await runCron();

  const receipts = await listOutbox();
  expect(receipts).toContainEqual(expect.objectContaining({ incidentId: first.id, channel: 'call', ok: true }));
  expect(receipts.filter((entry) => entry.incidentId === later.id)).toEqual([]);
  expect(await getRepo().getKv(`watch:first-screen-call:${later.id}`)).toBeNull();
  expect(await getRepo().getKv(`watch:screen-stage:${later.id}:1`)).toBeNull();
});

const ACCEPTED_CALL_SID = `CA${'2'.repeat(32)}`;
const BACKUP_PHONE = '+15145550106';
const OWNER_PHONE = '+15145550107';
const SUPPORT_PHONE = '+15145550108';

async function configureSameIncidentRecipients() {
  await getRepo().saveUser({ username: 'backup-manager', name: 'Backup manager', role: 'manager', locations: [KITCHEN.code], active: true, phone: BACKUP_PHONE, passwordHash: 'unused-fixture-hash' });
  await getRepo().saveUser({ username: 'next-owner', name: 'Fixture escalation owner', role: 'owner', locations: [], active: true, phone: OWNER_PHONE, passwordHash: 'unused-fixture-hash' });
  await saveWatchSettings({ callAfterMin: 2, ownerAfterMin: 3, supportPhones: [SUPPORT_PHONE] }, OWNER);
}

function afterFirstAcceptedCall(work: () => Promise<unknown>, destination = HOTLINE) {
  const respond = provider.getMockImplementation();
  if (!respond) throw new Error('Missing simulated provider');
  provider.mockImplementationOnce(async (...args) => {
    expect(String(args[0])).toMatch(/Calls\.json$/);
    expect(new URLSearchParams(String(args[1]?.body)).get('To')).toBe(destination);
    const response = await respond(...args);
    await work();
    return response;
  });
}

it('keeps the accepted receipt and stops all remaining sends for the same incident after kitchen deactivation', async () => {
  await configureSameIncidentRecipients();
  const password = 'same-incident-synthetic-session-password';
  vi.stubEnv('DASHBOARD_PASSWORD', password);
  const manager = { username: 'scoped-receipt-manager', name: 'Scoped manager', role: 'manager' as const, active: true, passwordHash: hashPassword(password), locations: [KITCHEN.code] };
  await getRepo().saveUser(manager);
  const actorHeaders = (username: string) => ({ authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` });
  const { incident, tick } = await openIncident('device_offline');
  const focus = (username: string) => incidentsById(new Request(`${BASE}/incidents?id=${incident.id}`, { headers: actorHeaders(username) }), undefined);
  expect(await (await focus(manager.username)).json()).toMatchObject({ incidents: [{ id: incident.id }] });

  afterFirstAcceptedCall(() => saveLocation({ ...KITCHEN, active: false }));
  expect(await tick(9)).toMatchObject({ escalated: 1 });
  const [receipt] = await listOutbox();
  expect(await listOutbox()).toMatchObject([{ channel: 'call', purpose: 'alert_shared_screen', ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await tick(10)).toMatchObject({ resolved: 1, escalated: 0 });
  const final = await (await focus('owner')).json();
  const resolved = final.incidents[0];
  expect(resolved).toMatchObject({ id: incident.id, status: 'resolved', resolvedBy: 'auto' });
  expect(resolved.steps).toContainEqual(expect.objectContaining({ kind: 'call', ok: true }));
  expect(resolved.steps.at(-1)).toMatchObject({ kind: 'resolved', message: expect.stringContaining('inactive kitchen') });

  await getRepo().saveUser({ ...manager, locations: [LEGACY_KITCHEN] });
  expect(await (await focus(manager.username)).json()).toMatchObject({ incidents: [] });
  const receiptRequest = (username: string) => getCallStatus(new Request(`${BASE}/messages/call-status?id=${receipt.id}`, { headers: actorHeaders(username) }), undefined);
  expect((await receiptRequest(manager.username)).status).toBe(403);
  expect(provider).toHaveBeenCalledTimes(1);
  provider.mockResolvedValueOnce(Response.json({ sid: ACCEPTED_CALL_SID, status: 'completed', to: 'provider-only fixture value' }));
  const status = await receiptRequest('owner');
  expect(status.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await status.json()).toEqual({ ok: true, status: 'completed' });
  expect(provider.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
});

it('recovers unstarted stages after a same-incident read failure without replaying its accepted call', async () => {
  await configureSameIncidentRecipients();
  const { incident, tick } = await openIncident('screen_waiting');
  const repo = getRepo();
  const readCatalog = repo.getKv.bind(repo);
  let catalogFailurePending = false;
  let failureSeen = false;
  const fault = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
    if (key === 'catalog' && catalogFailurePending) {
      catalogFailurePending = false;
      failureSeen = true;
      throw new Error('Temporary catalog read error after the accepted call');
    }
    return readCatalog<T>(key);
  });
  afterFirstAcceptedCall(async () => { catalogFailurePending = true; });
  try {
    expect(await tick(9)).toMatchObject({ escalated: 1, resolved: 0 });
  } finally {
    fault.mockRestore();
  }
  expect(await listOutbox()).toMatchObject([{ channel: 'call', purpose: 'alert_shared_screen', ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);
  expect(failureSeen).toBe(true);
  expect(provider).toHaveBeenCalledTimes(1);

  expect(await tick(10)).toMatchObject({ escalated: 1, resolved: 0 });
  const entries = await listOutbox();
  expect(entries.filter((entry) => entry.purpose === 'alert_shared_screen')).toHaveLength(1);
  const requests = provider.mock.calls.map(([input, init]) => ({ path: String(input).split('/').at(-1), to: new URLSearchParams(String(init?.body)).get('To') }));
  expect(requests.filter((request) => request.to === HOTLINE)).toEqual([{ path: 'Calls.json', to: HOTLINE }]);
  expect(requests).toEqual(expect.arrayContaining([
    { path: 'Messages.json', to: MANAGER_PHONE }, { path: 'Messages.json', to: BACKUP_PHONE },
    { path: 'Calls.json', to: MANAGER_PHONE }, { path: 'Calls.json', to: BACKUP_PHONE },
    { path: 'Messages.json', to: OWNER_PHONE }, { path: 'Calls.json', to: OWNER_PHONE },
    { path: 'Messages.json', to: SUPPORT_PHONE }, { path: 'Calls.json', to: SUPPORT_PHONE },
  ]));
  expect(entries.every((entry) => entry.incidentId === incident.id)).toBe(true);
});


it('recovers a muted tablet SMS without replaying its already accepted kitchen call', async () => {
  const { incident, tick } = await openIncident('device_muted');
  const repo = getRepo();
  const readCatalog = repo.getKv.bind(repo);
  let catalogFailurePending = false;
  let failureSeen = false;
  const fault = vi.spyOn(repo, 'getKv').mockImplementation(async <T>(key: string) => {
    if (key === 'catalog' && catalogFailurePending) {
      catalogFailurePending = false;
      failureSeen = true;
      throw new Error('Temporary catalog read error after the accepted kitchen call');
    }
    return readCatalog<T>(key);
  });
  afterFirstAcceptedCall(async () => { catalogFailurePending = true; }, KITCHEN.phone);
  try {
    expect(await tick(7)).toMatchObject({ escalated: 1, resolved: 0 });
  } finally {
    fault.mockRestore();
  }
  expect(failureSeen).toBe(true);
  expect(await listOutbox()).toMatchObject([{ channel: 'call', purpose: 'alert_kitchen', ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);

  expect(await tick(8)).toMatchObject({ escalated: 1, resolved: 0 });
  expect(provider.mock.calls.map(([input, init]) => ({ path: String(input).split('/').at(-1), to: new URLSearchParams(String(init?.body)).get('To') }))).toEqual([
    { path: 'Calls.json', to: KITCHEN.phone }, { path: 'Messages.json', to: MANAGER_PHONE },
  ]);
  const receipts = await listOutbox();
  expect(receipts.filter((entry) => entry.channel === 'call')).toHaveLength(1);
  expect(receipts).toContainEqual(expect.objectContaining({ channel: 'sms', incidentId: incident.id, ok: true }));
  expect(await repo.getKv(`watch:first-screen-call:${incident.id}`)).toEqual(expect.objectContaining({ at: expect.any(String) }));
});


it.each(['move to another active kitchen', 'clear the waiting count'] as const)('stops follow-up sends when a relay screen changes during its initial call: %s', async (change) => {
  await configureSameIncidentRecipients();
  const password = 'fixture-relay-move-password';
  vi.stubEnv('DASHBOARD_PASSWORD', password);
  const destination = { ...KITCHEN, code: 'TEST_NEW_KITCHEN' };
  await saveLocation(destination);
  const { incident, tick } = await openIncident('screen_waiting');
  const id = incident.deviceId;
  if (!id) throw new Error('Missing relay fixture id');

  afterFirstAcceptedCall(async () => {
    if (change === 'move to another active kitchen') {
      const move = await updateRelayScreen(new Request(`${BASE}/screens/${id}`, {
        method: 'PATCH', headers: { authorization: `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ locationCode: destination.code }),
      }), { params: Promise.resolve({ id }) });
      expect(move.status).toBe(200);
      expect(await move.json()).toMatchObject({ screen: { id, locationCode: destination.code } });
    } else {
      await relayReport({ id, state: 'ok', mode: 'android', waiting: 0 });
    }
  });
  expect(await tick(9)).toMatchObject({ escalated: 1 });
  expect(provider.mock.calls.map(([input]) => String(input).split('/').at(-1))).toEqual(['Calls.json']);
  expect(await listOutbox()).toMatchObject([{ channel: 'call', purpose: 'alert_shared_screen', ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);
  expect(await getRepo().getKv(`watch:first-screen-call:${incident.id}`)).toBeTruthy();
  expect((await listIncidents()).find((item) => item.id === incident.id)?.level).toBe(0);
  if (change === 'clear the waiting count') {
    at(10);
    expect(await runCron()).toMatchObject({ resolved: 1, escalated: 0 });
    expect((await listIncidents()).find((item) => item.id === incident.id)).toMatchObject({ status: 'resolved' });
  }
});


it('stops same-incident follow-ups when the native tablet is revoked during its initial call', async () => {
  await configureSameIncidentRecipients();
  const password = 'fixture-tablet-revocation-password';
  vi.stubEnv('DASHBOARD_PASSWORD', password);
  const { incident, tick } = await openIncident('device_offline');
  const id = incident.deviceId;
  if (!id) throw new Error('Missing native tablet fixture id');

  afterFirstAcceptedCall(async () => {
    const revoked = await revokeTablet(new Request(`${BASE}/devices/${id}`, {
      method: 'DELETE', headers: { authorization: `Basic ${Buffer.from(`owner:${password}`).toString('base64')}` },
    }), { params: Promise.resolve({ id }) });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ ok: true });
  });
  expect(await tick(9)).toMatchObject({ escalated: 1 });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await listOutbox()).toMatchObject([{ channel: 'call', ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);
  expect(await tick(10)).toMatchObject({ resolved: 1, escalated: 0 });
});

it('defers on loss of a live device read and resumes without duplicating the accepted call', async () => {
  const { incident, tick } = await openIncident('screen_waiting');
  const repo = getRepo();
  const getDoc = repo.getDoc.bind(repo);
  let interruptBinding = false;
  let failed = false;
  const fault = vi.spyOn(repo, 'getDoc').mockImplementation(async <T>(collection: string, id: string) => {
    if (collection === SCREENS && id === incident.deviceId && interruptBinding) {
      interruptBinding = false;
      failed = true;
      throw new Error('Temporary screen read failure following the accepted call');
    }
    return getDoc<T>(collection, id);
  });
  afterFirstAcceptedCall(async () => { interruptBinding = true; });
  try {
    expect(await tick(7)).toMatchObject({ escalated: 1, resolved: 0 });
  } finally {
    fault.mockRestore();
  }
  expect(failed).toBe(true);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await tick(8)).toMatchObject({ escalated: 1, resolved: 0 });
  const receipts = await listOutbox();
  expect(receipts.filter((entry) => entry.channel === 'call')).toMatchObject([{ ref: ACCEPTED_CALL_SID, ok: true, incidentId: incident.id }]);
  expect(receipts).toContainEqual(expect.objectContaining({ channel: 'sms', incidentId: incident.id, ok: true }));
});
