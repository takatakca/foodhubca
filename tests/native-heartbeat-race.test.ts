import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DELETE as revokeTablet, PATCH as moveTablet } from '../app/api/foodhub/devices/[id]/route';
import { POST as reportHeartbeat } from '../app/api/foodhub/devices/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation } from '../lib/foodhub/catalog';
import { DEVICES, enrollDevice, getDevice, type Device } from '../lib/foodhub/identity/devices';
import { getRepo, type Doc } from '../lib/foodhub/repo';

const owner: Actor = { username: 'owner', name: 'Fixture owner', source: 'dashboard' };
const base = 'https://fixture.example.test/api/foodhub/devices';
const start = Date.parse('2026-11-26T18:00:00Z');
const password = 'fixture-native-heartbeat-race-password';
const authorization = `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`;
const original = { code: 'FIXTURE_ORIGINAL', name: 'Fixture original', address: '', active: true };
const destination = { ...original, code: 'FIXTURE_DESTINATION', name: 'Fixture destination' };

beforeEach(async () => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SESSION_SECRET', 'fixture-native-heartbeat-race-signing-secret');
  vi.stubEnv('DASHBOARD_PASSWORD', password);
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
  await saveLocation(original);
  await saveLocation(destination);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it.each(['move', 'revoke'] as const)('preserves an authenticated owner %s even when an older signed native heartbeat is in flight', async (action) => {
  const { device, cookie } = await enrollDevice({ name: 'Fixture native tablet', locationCode: original.code }, owner);
  const report = (body: { visible?: boolean; soundOn: boolean }) => reportHeartbeat(new Request(`${base}/heartbeat`, {
    method: 'POST', headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  expect((await report({ soundOn: true })).status).toBe(200);
  const originalPulse = { at: new Date(start).toISOString(), locationCode: original.code };
  vi.setSystemTime(start + 30_000);
  const heartbeatAt = new Date().toISOString();
  let enter!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  const repo = getRepo();
  const observeOrders = vi.spyOn(repo, 'listOrders');
  const pauseOlderWrite = async <T>(collection: string, doc: Doc<T> | undefined) => {
    const candidate = doc?.data as Device | undefined;
    if (collection === DEVICES && candidate?.id === device.id && candidate.lastSeenAt === heartbeatAt) {
      enter();
      await paused;
    }
  };
  const putDocs = repo.putDocs.bind(repo);
  vi.spyOn(repo, 'putDocs').mockImplementation(async <T>(collection: string, docs: Doc<T>[]) => {
    await pauseOlderWrite(collection, docs[0]);
    return putDocs(collection, docs);
  });
  const replace = repo.replaceDocIfRevision.bind(repo);
  vi.spyOn(repo, 'replaceDocIfRevision').mockImplementation(async <T extends { revision?: string }>(collection: string, doc: Doc<T>, expected?: string) => {
    await pauseOlderWrite(collection, doc);
    return replace(collection, doc, expected);
  });

  const heartbeat = report({ visible: true, soundOn: true });
  await entered;
  const target = action === 'move' ? { locationCode: destination.code } : { revoked: true };
  try {
    const ctx = { params: Promise.resolve({ id: device.id }) };
    const response = action === 'move'
      ? await moveTablet(new Request(`${base}/${device.id}`, { method: 'PATCH', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ locationCode: destination.code }) }), ctx)
      : await revokeTablet(new Request(`${base}/${device.id}`, { method: 'DELETE', headers: { authorization } }), ctx);
    expect(response.status).toBe(200);
    if (action === 'move') expect((await response.json()).device).not.toHaveProperty('lastHeartbeat');
    expect(await getDevice(device.id)).toMatchObject({ ...target, lastHeartbeat: originalPulse });
  } finally {
    resume();
  }
  const heartbeatResponse = await heartbeat;
  const stored = await getDevice(device.id);
  expect(stored).toMatchObject(target);
  expect(stored?.lastSeenAt).toBe(device.lastSeenAt);
  expect(stored?.lastHeartbeat).toEqual(originalPulse);
  expect(heartbeatResponse.status).toBe(action === 'move' ? 409 : 403);
  expect(observeOrders).not.toHaveBeenCalled();
  if (action === 'move') {
    const next = await report({ soundOn: true });
    expect(next.status).toBe(200);
    const response = await next.json();
    expect(response).toMatchObject({ device: { locationCode: destination.code } });
    expect(response.device).not.toHaveProperty('lastHeartbeat');
    expect(await getDevice(device.id)).toMatchObject({
      lastSeenAt: heartbeatAt,
      lastHeartbeat: { at: heartbeatAt, locationCode: destination.code },
    });
    expect(observeOrders).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ locationCodes: [destination.code] }));
  }
});


it('updates an older unversioned tablet using its signed telemetry and keeps revisions private', async () => {
  const { device, cookie } = await enrollDevice({ name: 'Legacy tablet', locationCode: original.code }, owner);
  const repo = getRepo();
  await repo.putDocs(DEVICES, [{ id: device.id, key: device.locationCode, at: device.enrolledAt, data: device }]);
  vi.setSystemTime(start + 30_000);
  const response = await reportHeartbeat(new Request(`${base}/heartbeat`, {
    method: 'POST', headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify({ visible: true, soundOn: false, battery: 0.8 }),
  }));
  expect(response.status).toBe(200);
  const current = await getDevice(device.id);
  expect(current).toMatchObject({ locationCode: original.code, soundOn: false, visible: true, battery: 0.8 });
  expect(current).not.toHaveProperty('revision');
  expect((await response.json()).device).not.toHaveProperty('revision');
  expect((await repo.getDoc<Device & { revision?: string }>(DEVICES, device.id))?.data.revision).toEqual(expect.any(String));
});
