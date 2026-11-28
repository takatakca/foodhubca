import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as report } from '../app/api/foodhub/devices/print-listener/route';
import { GET as devices } from '../app/api/foodhub/devices/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword } from '../lib/foodhub/auth';
import { enrollDevice, getDevice, heartbeat, revokeDevice, updateDevice } from '../lib/foodhub/identity/devices';
import { listPrintListenerObservations, PRINT_LISTENER_OBSERVATIONS } from '../lib/foodhub/identity/print-listener';
import { getRepo } from '../lib/foodhub/repo';
import { proxy } from '../proxy';

const API = 'https://foodhub.example.test/api/foodhub/devices';
const ORIGIN = 'TEST_KITCHEN_A';
const DESTINATION = 'TEST_KITCHEN_B';
const OWNER: Actor = { name: 'Test owner', username: 'owner', source: 'dashboard' };
const PASSWORD = 'fixture-tablet-observation-password';
const ENROLLED = '2026-11-28T15:00:00.000Z';
const REPORTED = '2026-11-28T15:04:00.000Z';
const body = (locationCode: unknown) => JSON.stringify({ locationCode });

function credentials(username = 'owner') {
  return { authorization: 'Basic ' + Buffer.from(username + ':' + PASSWORD).toString('base64') };
}

function signedReport(json: string, cookie = '', headers: Record<string, string> = {}) {
  return report(new Request(API + '/print-listener', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: json }));
}

async function list(username = 'owner') {
  const res = await devices(new Request(API, { headers: credentials(username) }), undefined);
  expect(res.status).toBe(200);
  return (await res.json()).devices as Array<Record<string, unknown>>;
}

async function enrol(locationCode = ORIGIN) {
  const added = await enrollDevice({ locationCode, name: 'Test device' }, OWNER);
  return { device: added.device, cookie: added.cookie.split(';')[0] };
}

describe('native print queue observations', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(ENROLLED));
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
    vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
    vi.stubEnv('SESSION_SECRET', 'fixture-tablet-observation-signing-key');
    vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
    vi.stubGlobal('__foodhubMem', undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reports the exact signed route without exposing nearby routes or other methods', async () => {
    const path = API + '/print-listener';
    const post = await proxy(new NextRequest(path, { method: 'POST' }));
    expect(post.headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(new NextRequest(path))).status).toBe(401);
    expect((await proxy(new NextRequest(path + '-extra', { method: 'POST' }))).status).toBe(401);
    expect((await proxy(new NextRequest(path + '/other', { method: 'POST' }))).status).toBe(401);
  });

  it('updates a single observation from the server clock and leaves screen status, visibility, audio and power intact', async () => {
    const { device, cookie } = await enrol();
    await heartbeat(device, { visible: false, soundOn: false, battery: 0.4, charging: true, screen: 'kitchen' }, 'Fixture screen');
    const before = await getDevice(device.id);
    expect((await list()).map(d => d.printListenerObservedAt)).toEqual([undefined]);
    vi.setSystemTime(new Date(REPORTED));

    const first = await signedReport(JSON.stringify({ locationCode: ORIGIN, observedAt: 'ignored' }), cookie);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toEqual({ ok: true, locationCode: ORIGIN, observedAt: REPORTED });
    const next = '2026-11-28T15:05:00.000Z';
    vi.setSystemTime(new Date(next));
    expect((await signedReport(body(ORIGIN), cookie)).status).toBe(200);

    expect(await getRepo().listDocs(PRINT_LISTENER_OBSERVATIONS)).toEqual([{
      id: device.id, key: device.id, at: next, data: { locationCode: ORIGIN, enrolledAt: ENROLLED, observedAt: next },
    }]);
    expect(await getDevice(device.id)).toEqual(before);
    expect(await list()).toMatchObject([{
      id: device.id, status: 'offline', lastSeenAt: ENROLLED, visible: false, soundOn: false, battery: 0.4,
      charging: true, screen: 'kitchen', printListenerObservedAt: next,
    }]);
  });

  it('rejects staff-only, malformed, mismatched and revoked requests without recording an observation', async () => {
    const { device, cookie } = await enrol();
    expect((await signedReport(body(ORIGIN), '', credentials())).status).toBe(403);
    expect((await signedReport(body(ORIGIN), cookie + 'x')).status).toBe(403);
    expect((await signedReport(body(DESTINATION), cookie, credentials())).status).toBe(403);
    for (const json of ['broken json', 'null', '{}', body(42), body(''), body(' ' + ORIGIN)]) {
      expect((await signedReport(json, cookie)).status).toBe(400);
    }
    expect((await signedReport(body('A'.repeat(1024)), cookie)).status).toBe(413);
    await revokeDevice(device.id, OWNER);
    expect((await signedReport(body(ORIGIN), cookie)).status).toBe(403);
    expect(await list()).toEqual([]);
    expect(await getRepo().listDocs(PRINT_LISTENER_OBSERVATIONS)).toEqual([]);
  });

  it('filters observations by current enrollment and kitchen for the signed operator', async () => {
    const { device, cookie } = await enrol();
    const other = await enrol(DESTINATION);
    await getRepo().saveUser({
      username: 'test-manager', name: 'Test manager', role: 'manager', locations: [ORIGIN], active: true, passwordHash: hashPassword(PASSWORD),
    });
    vi.setSystemTime(new Date(REPORTED));
    expect((await signedReport(body(ORIGIN), cookie)).status).toBe(200);
    expect((await signedReport(body(DESTINATION), other.cookie)).status).toBe(200);
    const read = vi.spyOn(getRepo(), 'listDocs');
    expect(await list('test-manager')).toMatchObject([{ id: device.id, printListenerObservedAt: REPORTED }]);
    expect(read).toHaveBeenCalledWith(PRINT_LISTENER_OBSERVATIONS, { keys: [device.id], limit: 1 });
    expect(read).not.toHaveBeenCalledWith(PRINT_LISTENER_OBSERVATIONS, expect.objectContaining({ keys: expect.arrayContaining([other.device.id]) }));

    await updateDevice(device.id, { locationCode: DESTINATION }, OWNER);
    expect((await signedReport(body(ORIGIN), cookie)).status).toBe(403);
    expect((await list()).find(d => d.id === device.id)).not.toHaveProperty('printListenerObservedAt');
    expect(await list('test-manager')).toEqual([]);
    expect((await signedReport(body(DESTINATION), cookie)).status).toBe(200);
    expect((await list()).find(d => d.id === device.id)).toMatchObject({ locationCode: DESTINATION, printListenerObservedAt: REPORTED });
  });

  it.each([
    { observedAt: 'not-a-date' },
    { observedAt: '2026-11-28T15:04:00+00:00' },
    { observedAt: '2026-11-28T15:04:01.000Z' },
    { observedAt: '2026-11-28T14:59:59.000Z' },
    { locationCode: DESTINATION },
    { enrolledAt: '2026-11-28T14:58:00.000Z' },
  ])('omits an invalid or stale observation %j', async patch => {
    const { device } = await enrol();
    vi.setSystemTime(new Date(REPORTED));
    await getRepo().putDocs(PRINT_LISTENER_OBSERVATIONS, [{
      id: device.id, key: device.id, at: REPORTED, data: { locationCode: ORIGIN, enrolledAt: ENROLLED, observedAt: REPORTED, ...patch },
    }]);
    expect((await list())[0]).not.toHaveProperty('printListenerObservedAt');
  });

  it('keeps screen status readable when optional observation storage is unavailable', async () => {
    const { device, cookie } = await enrol();
    vi.setSystemTime(new Date(REPORTED));
    expect((await signedReport(body(ORIGIN), cookie)).status).toBe(200);
    const repo = getRepo();
    const lookup = repo.listDocs.bind(repo);
    vi.spyOn(repo, 'listDocs').mockImplementation((collection, filter) => {
      if (collection === PRINT_LISTENER_OBSERVATIONS) return Promise.reject(new Error('optional lookup unavailable'));
      return lookup(collection, filter);
    });
    const [screen] = await list();
    expect(screen).toMatchObject({ id: device.id, status: 'offline', lastSeenAt: ENROLLED });
    expect(screen).not.toHaveProperty('printListenerObservedAt');
  });

  it('does not present an in-flight report from the prior kitchen after reassignment', async () => {
    const { device, cookie } = await enrol();
    vi.setSystemTime(new Date(REPORTED));
    const repo = getRepo();
    let finishWrite!: () => void;
    const pending = new Promise<void>(resolve => { finishWrite = resolve; });
    let signalWriteStarted!: () => void;
    const started = new Promise<void>(resolve => { signalWriteStarted = resolve; });
    const put = repo.putDocs.bind(repo);
    vi.spyOn(repo, 'putDocs').mockImplementation(async (collection, docs) => {
      if (collection === PRINT_LISTENER_OBSERVATIONS) {
        signalWriteStarted();
        await pending;
      }
      await put(collection, docs);
    });

    const previousReport = signedReport(body(ORIGIN), cookie);
    await started;
    try {
      await updateDevice(device.id, { locationCode: DESTINATION }, OWNER);
    } finally {
      finishWrite();
    }
    expect((await previousReport).status).toBe(200);
    const [moved] = await list();
    expect(moved).toMatchObject({ locationCode: DESTINATION, lastSeenAt: ENROLLED });
    expect(moved).not.toHaveProperty('printListenerObservedAt');
  });

  it('returns a generic retryable error when an observation cannot be written', async () => {
    const { device, cookie } = await enrol();
    vi.spyOn(getRepo(), 'putDocs').mockRejectedValueOnce(new Error('fixture storage error'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await signedReport(body(ORIGIN), cookie);
    expect(log).toHaveBeenCalledOnce();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, error: 'Print listener reporting unavailable' });
    expect((await list())[0]).toMatchObject({ id: device.id, lastSeenAt: ENROLLED });
    expect(await getRepo().listDocs(PRINT_LISTENER_OBSERVATIONS)).toEqual([]);
  });

  it('does not delay screen status beyond the optional storage timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.spyOn(getRepo(), 'listDocs').mockImplementation(() => new Promise(() => {}));
    const pending = listPrintListenerObservations([{ id: 'fixture', locationCode: ORIGIN, enrolledAt: ENROLLED }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual(new Map());
  });

  it('bounds lookups to at most 100 scoped devices per batch and skips empty lists', async () => {
    const read = vi.spyOn(getRepo(), 'listDocs');
    expect(await listPrintListenerObservations([])).toEqual(new Map());
    expect(read).not.toHaveBeenCalled();

    const scoped = Array.from({ length: 201 }, (_, n) => ({ id: String(n), locationCode: ORIGIN, enrolledAt: ENROLLED }));
    await listPrintListenerObservations(scoped);
    expect(read.mock.calls.map(([collection, options]) => [collection, options?.keys?.length, options?.limit])).toEqual([
      [PRINT_LISTENER_OBSERVATIONS, 100, 100], [PRINT_LISTENER_OBSERVATIONS, 100, 100], [PRINT_LISTENER_OBSERVATIONS, 1, 1],
    ]);
  });
});
