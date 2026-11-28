import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cronWatch } from '../app/api/foodhub/cron/watch/route';
import { PATCH as moveTablet } from '../app/api/foodhub/devices/[id]/route';
import { GET as getScopedIncidents, POST as actScopedIncident } from '../app/api/foodhub/incidents/route';
import { PATCH as moveScreen, POST as screenCommand } from '../app/api/foodhub/screens/[id]/route';
import { POST as heartbeat } from '../app/api/foodhub/screens/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { enrollDevice, getDevice, heartbeat as tabletHeartbeat } from '../lib/foodhub/identity/devices';
import { listOutbox } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import { addScreen, getScreen, requestReload, SCREENS, type AgentCommand, type Heartbeat } from '../lib/foodhub/screens';
import { INCIDENTS, actOnIncident, getIncident, saveWatchSettings, type WatchReport } from '../lib/foodhub/watch/engine';
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
const callSid = (sequence: number) => `CA${String(sequence).padStart(32, '0')}`;
const fetchMock = vi.fn<typeof fetch>();

function advanceTo(minute: number) {
  vi.setSystemTime(START + minute * 60_000);
}

function basicHeaders(username: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` };
}

function relayRequest(...screens: Heartbeat['screens']) {
  return heartbeat(new Request(`${BASE}/screens/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ screens }),
  }));
}

async function relayReport(screen: Heartbeat['screens'][number]) {
  const response = await relayRequest(screen);
  expect(response.status).toBe(200);
  return await response.json() as { commands: AgentCommand[] };
}

async function addQueuedScreen(slot: string) {
  const screen = await addScreen({ name: slot, platform: 'skip', locationCode: ORIGINAL.code, viewUrl: `https://relay.example.test/${slot}/` }, OWNER);
  if ('error' in screen) throw new Error(screen.error);
  await requestReload(screen.id, OWNER);
  return screen.id;
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
    return Response.json({ sid: callSid(fetchMock.mock.calls.length), status: 'queued' }, { status: 201 });
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

it('keeps a kitchen reassignment when an in-flight heartbeat already read the old screen', async () => {
  await saveWatchSettings({ smsAfterMin: 0 }, OWNER);
  const screen = await addScreen({ name: 'Test screen', platform: 'skip', locationCode: ORIGINAL.code,
    viewUrl: 'https://relay.example.test/s01/', storeIds: ['store-before-move'] }, OWNER);
  if ('error' in screen) throw new Error(screen.error);
  const repo = getRepo();
  // Existing screen rows can have no stored revision until their first conditional update.
  await repo.putDocs(SCREENS, [{ id: screen.id, key: screen.locationCode, at: screen.createdAt, data: screen }]);
  const getDoc = repo.getDoc.bind(repo);
  let readFinished!: () => void;
  const read = new Promise<void>((resolve) => { readFinished = resolve; });
  let resume!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  let blockFirstRead = true;
  const reader = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, id) => {
    const doc = await getDoc(collection, id);
    if (collection !== SCREENS || id !== screen.id || !blockFirstRead) return doc;
    blockFirstRead = false;
    const snapshot = structuredClone(doc);
    readFinished();
    await blocked;
    return snapshot;
  });
  const pending = relayReport({ id: screen.id, state: 'login' });
  try {
    await read;
    const move = await moveScreen(new Request(`${BASE}/screens/${screen.id}`, {
      method: 'PATCH', headers: { ...basicHeaders('owner'), 'content-type': 'application/json' },
      body: JSON.stringify({ locationCode: DESTINATION.code, storeIds: ['store-after-move'] }),
    }), { params: Promise.resolve({ id: screen.id }) });
    expect(move.status).toBe(200);
    const moved = (await move.json()).screen;
    expect(moved).toMatchObject({ locationCode: DESTINATION.code, storeIds: ['store-after-move'] });
    expect(moved).not.toHaveProperty('revision');
    const queued = await screenCommand(new Request(`${BASE}/screens/${screen.id}`, {
      method: 'POST', headers: { ...basicHeaders('owner'), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reload' }),
    }), { params: Promise.resolve({ id: screen.id }) });
    expect(queued.status).toBe(200);
    expect((await queued.json()).screen.command).toMatchObject({ kind: 'reload' });
  } finally {
    resume();
    await pending;
    reader.mockRestore();
  }
  expect(await pending).toMatchObject({ commands: [] });
  expect(await getScreen(screen.id)).toMatchObject({ locationCode: DESTINATION.code, storeIds: ['store-after-move'], lastSeenAt: null, command: { kind: 'reload' } });
  expect(await runCron()).toMatchObject({ opened: 0, escalated: 0 });
  expect(fetchMock).not.toHaveBeenCalled();

  advanceTo(1);
  expect(await relayReport({ id: screen.id, state: 'login' })).toMatchObject({ commands: [{ id: screen.id, kind: 'reload' }] });
  expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
  expect((await readIncidents(DESTINATION.manager)).map((incident) => incident.locationCode)).toEqual([DESTINATION.code]);
  expect(await readIncidents(ORIGINAL.manager)).toEqual([]);
  expect(calls().map((call) => call.get('To'))).toEqual([DESTINATION.phone]);
  expect(await relayReport({ id: screen.id, state: 'login' })).toMatchObject({ commands: [] });
});

it('hands one queued command to only one of two heartbeats reading the same screen revision', async () => {
  const screen = await addScreen({ name: 'Test screen', platform: 'skip', locationCode: ORIGINAL.code, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
  if ('error' in screen) throw new Error(screen.error);
  const queued = await screenCommand(new Request(`${BASE}/screens/${screen.id}`, {
    method: 'POST', headers: { ...basicHeaders('owner'), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reload' }),
  }), { params: Promise.resolve({ id: screen.id }) });
  expect(queued.status).toBe(200);
  const repo = getRepo();
  const getDoc = repo.getDoc.bind(repo);
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
  let readers = 0;
  const reader = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, id) => {
    const doc = await getDoc(collection, id);
    if (collection !== SCREENS || id !== screen.id || readers === 2) return doc;
    const snapshot = structuredClone(doc);
    if (++readers === 2) releaseReads();
    await bothRead;
    return snapshot;
  });
  try {
    const reports = await Promise.all([relayReport({ id: screen.id, state: 'ok' }), relayReport({ id: screen.id, state: 'ok' })]);
    expect(reports.flatMap((report) => report.commands)).toEqual([{ id: screen.id, kind: 'reload' }]);
  } finally {
    releaseReads();
    reader.mockRestore();
  }
  expect((await getScreen(screen.id))?.command).toBeNull();
});

it('returns saved commands for the batch when another screen repeatedly conflicts', async () => {
  const first = await addQueuedScreen('s01');
  const contended = await addQueuedScreen('s02');
  const repo = getRepo();
  const replace = repo.replaceDocIfRevision.bind(repo);
  let conflicts = 0;
  const update = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, revision) => {
    if (collection === SCREENS && doc.id === contended) {
      conflicts++;
      return false;
    }
    return replace(collection, doc, revision);
  });
  try {
    const response = await relayRequest({ id: first, state: 'ok' }, { id: contended, state: 'ok' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ commands: [{ id: first, kind: 'reload' }], unknown: [] });
    expect(body).not.toHaveProperty('partial');
  } finally {
    update.mockRestore();
  }
  expect(conflicts).toBe(3);
  expect((await getScreen(first))?.command).toBeNull();
  expect(await getScreen(contended)).toMatchObject({ lastSeenAt: null, command: { kind: 'reload' } });
  expect(await relayReport({ id: contended, state: 'ok' })).toMatchObject({ commands: [{ id: contended, kind: 'reload' }] });
});

it.each(['read', 'write response'] as const)('returns only confirmed commands after a later screen loses its storage %s', async (failure) => {
  const first = await addQueuedScreen('s01');
  const failed = await addQueuedScreen('s02');
  const later = await addQueuedScreen('s03');
  const repo = getRepo();
  const read = repo.getDoc.bind(repo);
  const replace = repo.replaceDocIfRevision.bind(repo);
  const error = new Error('Synthetic storage error with private detail');
  const getDoc = vi.spyOn(repo, 'getDoc').mockImplementation(async (collection, id) => {
    if (failure === 'read' && collection === SCREENS && id === failed) throw error;
    return read(collection, id);
  });
  const save = vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async (collection, doc, revision) => {
    const saved = await replace(collection, doc, revision);
    if (failure === 'write response' && collection === SCREENS && doc.id === failed) {
      expect(saved).toBe(true);
      throw error;
    }
    return saved;
  });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const reports = [first, failed, later].map((id) => ({ id, state: 'ok' as const }));
  try {
    const response = await relayRequest(...reports);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, partial: true, unknown: [], commands: [{ id: first, kind: 'reload' }] });
    expect(JSON.stringify(body)).not.toContain(error.message);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(error.message);
    await expect(relayRequest({ id: failed, state: 'ok' })).rejects.toBe(error);
  } finally {
    getDoc.mockRestore();
    save.mockRestore();
    warning.mockRestore();
  }
  expect((await getScreen(first))?.command).toBeNull();
  expect((await getScreen(failed))?.command?.kind ?? null).toBe(failure === 'read' ? 'reload' : null);
  expect(await getScreen(later)).toMatchObject({ lastSeenAt: null, command: { kind: 'reload' } });
  const retry = await relayRequest(...reports);
  expect(retry.status).toBe(200);
  const body = await retry.json();
  const retryIds = failure === 'read' ? [failed, later] : [later];
  expect(body.commands).toEqual(retryIds.map((id) => ({ id, kind: 'reload' })));
  expect(body).not.toHaveProperty('partial');
});

const scenarios = [
  { description: 'an offline platform screen', kind: 'screen_down', platform: 'skip', detectedAt: 6, priorAlert: 'opened' },
  { description: 'a platform screen with waiting orders', kind: 'screen_waiting', platform: 'doordash', detectedAt: 2, priorAlert: 'opened' },
  { description: 'an offline native tablet', kind: 'device_offline', platform: null, detectedAt: 6, priorAlert: 'opened' },
  { description: 'a muted native tablet', kind: 'device_muted', platform: null, detectedAt: 2, priorAlert: 'opened' },
  { description: 'an acknowledged offline screen with an earlier call, then returning to its original kitchen', kind: 'screen_down', platform: 'skip', detectedAt: 6, priorAlert: 'called' },
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
    if (kind === 'device_offline') await tabletHeartbeat(device, { soundOn: true, visible: true });
  }

  async function tick(minute: number) {
    advanceTo(minute);
    if (kind === 'screen_waiting') await relayReport({ id, state: 'ok', mode: 'android', waiting: 2 });
    if (kind === 'device_muted') {
      const device = await getDevice(id);
      if (!device) throw new Error('Expected a native tablet');
      await tabletHeartbeat(device, { soundOn: false, visible: true });
    }
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
    expect(await actOnIncident(original.id, 'ack', OWNER)).toMatchObject({ status: 'acknowledged' });
  } else if (recoveredBeforeMove) {
    advanceTo(detectedAt + 1);
    await relayReport({ id, state: 'ok', title: 'Orders' });
    expect(await runCron()).toMatchObject({ resolved: 1, escalated: 0 });
    expect(await readIncidents(ORIGINAL.manager)).toMatchObject([{ id: original.id, status: 'resolved', resolvedBy: 'auto' }]);
  }

  const movedAt = detectedAt + (priorAlert === 'opened' ? 1 : 2);
  advanceTo(movedAt);
  function moveAs(username: string, locationCode = DESTINATION.code) {
    return (platform ? moveScreen : moveTablet)(new Request(`${BASE}/${platform ? 'screens' : 'devices'}/${id}`, {
      method: 'PATCH',
      headers: { ...basicHeaders(username), 'content-type': 'application/json' },
      body: JSON.stringify({ locationCode }),
    }), { params: Promise.resolve({ id }) });
  }
  if (!platform) {
    expect((await moveAs(ORIGINAL.manager)).status).toBe(403);
    expect(await getDevice(id)).toMatchObject({ locationCode: ORIGINAL.code });
  }
  const offlinePulse = kind === 'device_offline' ? (await getDevice(id))?.lastHeartbeat : undefined;
  expect((await moveAs(OWNER.username)).status).toBe(200);
  if (recoveredBeforeMove) await relayReport({ id, state: 'crashed' });
  expect(await tick(movedAt)).toMatchObject({ opened: 1, resolved: recoveredBeforeMove ? 0 : 1, escalated: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(alreadyCalled ? 1 : 0);

  const history = await readIncidents(ORIGINAL.manager);
  expect(history).toMatchObject([{ id: original.id, locationCode: ORIGINAL.code, status: 'resolved', title: original.title }]);
  expect(history[0].successorDetection).toBeUndefined();
  if (kind === 'device_offline') {
    expect(offlinePulse).toMatchObject({ locationCode: ORIGINAL.code });
    expect(await getDevice(id)).toMatchObject({
      locationCode: DESTINATION.code, lastSeenAt: offlinePulse?.at, lastHeartbeat: offlinePulse,
    });
    expect(history[0].resolvedBy).toBe('Watchtower');
    expect(history[0].steps.at(-1)).toMatchObject({
      kind: 'resolved', by: 'Watchtower', deviceOfflineResolution: 'reassigned',
    });
  }
  const current = await readIncidents(DESTINATION.manager);
  expect(current).toMatchObject([{ kind, deviceId: id, locationCode: DESTINATION.code, status: 'open' }]);
  expect(current[0].id).not.toBe(original.id);

  expect(await tick(movedAt + 1)).toMatchObject({ opened: 0, escalated: 1 });
  expect(calls().map((call) => call.get('To'))).toEqual(alreadyCalled ? [ORIGINAL.phone, DESTINATION.phone] : [DESTINATION.phone]);
  expect(calls().at(-1)?.get('Twiml')).toContain(DESTINATION.name);

  if (alreadyCalled) {
    const crossScope = new Request(`${BASE}/incidents`, {
      method: 'POST', headers: basicHeaders(ORIGINAL.manager), body: JSON.stringify({ id: current[0].id, action: 'ack' }),
    });
    expect((await actScopedIncident(crossScope, undefined)).status).toBe(404);
    advanceTo(movedAt + 2);
    expect((await moveAs(OWNER.username, ORIGINAL.code)).status).toBe(200);
    expect(await tick(movedAt + 2)).toMatchObject({ opened: 1, resolved: 1, escalated: 0 });
    const previousKitchen = await readIncidents(ORIGINAL.manager);
    const reopened = previousKitchen.find((incident) => incident.status === 'open');
    expect(reopened).toMatchObject({ locationCode: ORIGINAL.code, deviceId: id });
    expect(reopened?.id).not.toBe(original.id);
    expect(reopened?.id).not.toBe(current[0].id);
    expect(previousKitchen.find((incident) => incident.id === original.id)).toMatchObject({ status: 'resolved', ackBy: OWNER.name });
    expect(await readIncidents(DESTINATION.manager)).toMatchObject([{ id: current[0].id, status: 'resolved', locationCode: DESTINATION.code }]);
    expect(await tick(movedAt + 3)).toMatchObject({ opened: 0, escalated: 1 });
    expect(calls().map((call) => call.get('To'))).toEqual([ORIGINAL.phone, DESTINATION.phone, ORIGINAL.phone]);
    expect((await listOutbox()).filter((entry) => entry.channel === 'call')).toMatchObject([
      { incidentId: reopened?.id, ref: callSid(3) },
      { incidentId: current[0].id, ref: callSid(2) },
      { incidentId: original.id, ref: callSid(1) },
    ]);
  }
});

it('allocates no destination occurrence until the source closure and reservation are durable', async () => {
  await saveWatchSettings({ smsAfterMin: 0 }, OWNER);
  const screen = await addScreen({ name: 'Test platform screen', platform: 'skip', locationCode: ORIGINAL.code, viewUrl: 'https://relay.example.test/s01/' }, OWNER);
  if ('error' in screen) throw new Error(screen.error);
  await relayReport({ id: screen.id, state: 'ok', title: 'Orders' });
  advanceTo(6);
  expect(await runCron()).toMatchObject({ opened: 1, escalated: 1 });
  const [source] = await readIncidents(ORIGINAL.manager);

  advanceTo(7);
  const move = new Request(`${BASE}/screens/${screen.id}`, {
    method: 'PATCH', headers: basicHeaders(OWNER.username), body: JSON.stringify({ locationCode: DESTINATION.code }),
  });
  expect((await moveScreen(move, { params: Promise.resolve({ id: screen.id }) })).status).toBe(200);
  const repo = getRepo();
  const replace = vi.spyOn(repo, 'replaceDocIfRevision').mockResolvedValueOnce(false);
  try {
    expect(await runCron()).toMatchObject({ opened: 0, resolved: 0, escalated: 0 });
    expect(await getIncident(source.id)).toMatchObject({ locationCode: ORIGINAL.code, status: 'open' });
    expect(await readIncidents(DESTINATION.manager)).toEqual([]);
    expect(calls().map((call) => call.get('To'))).toEqual([ORIGINAL.phone]);
  } finally {
    replace.mockRestore();
  }

  advanceTo(8);
  const insert = repo.insertDocIfAbsent.bind(repo);
  const create = vi.spyOn(repo, 'insertDocIfAbsent').mockImplementation(async (collection, doc) => {
    if (collection === INCIDENTS) {
      expect(await getIncident(source.id)).toMatchObject({
        status: 'resolved', locationCode: ORIGINAL.code, successorReserved: true, successorDetection: { locationCode: DESTINATION.code },
      });
    }
    return insert(collection, doc);
  });
  try {
    expect(await runCron()).toMatchObject({ opened: 1, resolved: 1, escalated: 1 });
  } finally {
    create.mockRestore();
  }
  expect(await readIncidents(DESTINATION.manager)).toMatchObject([{ locationCode: DESTINATION.code, status: 'open' }]);
  expect(calls().map((call) => call.get('To'))).toEqual([ORIGINAL.phone, DESTINATION.phone]);
});
