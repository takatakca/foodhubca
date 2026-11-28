import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as reportHeartbeat } from '../app/api/foodhub/devices/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { enrollDevice, type Device } from '../lib/foodhub/identity/devices';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';

const { refreshDevice } = vi.hoisted(() => ({ refreshDevice: vi.fn<(id: string) => Promise<Device | null>>() }));
vi.mock('../lib/foodhub/identity/devices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/foodhub/identity/devices')>();
  refreshDevice.mockImplementation(actual.getDevice);
  return { ...actual, getDevice: refreshDevice };
});

const owner: Actor = { username: 'owner', name: 'Fixture owner', source: 'dashboard' };
const kitchen = 'FIXTURE_KITCHEN';
const otherKitchen = 'FIXTURE_OTHER';
const start = Date.parse('2026-11-26T18:00:00Z');

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SESSION_SECRET', 'fixture-counter-test-signing-key');
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')));
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function signedReport(cookie: string) {
  return reportHeartbeat(new Request('https://fixture.example.test/api/foodhub/devices/heartbeat', {
    method: 'POST', headers: { cookie: cookie.split(';', 1)[0], 'content-type': 'application/json' },
    body: JSON.stringify({ soundOn: false, visible: true, battery: 0.8 }),
  }));
}

async function seedOrder(externalOrderId: string, locationCode: string) {
  const fixture: NormalizedOrder = {
    channel: 'skip', marketplace: 'skip', channelStoreId: 'fixture-store', externalOrderId, fulfillment: 'pickup',
    placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, discount: 0, tip: 0,
    total: 10, lines: [], raw: {},
  };
  return (await getRepo().insertOrderIfNew({ ...fixture, locationCode })).order;
}

it('returns signed telemetry and only the active kitchen counters for a stable binding', async () => {
  const { device, cookie } = await enrollDevice({ name: 'Fixture tablet', locationCode: kitchen }, owner);
  await seedOrder('fixture-waiting', kitchen);
  await seedOrder('fixture-unrelated', otherKitchen);
  const cancelled = await seedOrder('fixture-cancelled', kitchen);
  await getRepo().updateOrder(cancelled.id, { status: 'cancelled', timeline: { cancelledBy: 'customer', cancelledAt: new Date().toISOString() } });
  vi.setSystemTime(start + 30_000);
  const response = await signedReport(cookie);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true, device: { id: device.id, name: device.name, locationCode: kitchen }, waiting: 1, cancelled: 1,
    serverTime: new Date().toISOString(),
  });
  expect(refreshDevice).toHaveBeenCalledExactlyOnceWith(device.id);
  expect(await refreshDevice(device.id)).toMatchObject({ soundOn: false, visible: true, battery: 0.8 });
});

it.each(['missing', 'revoked', 'moved', 'different enrollment'] as const)('withholds counters for a %s binding returned by the final device read', async (state) => {
  const { device, cookie } = await enrollDevice({ name: 'Fixture tablet', locationCode: kitchen }, owner);
  const current = state === 'missing' ? null : {
    ...device,
    revoked: state === 'revoked',
    locationCode: state === 'moved' ? otherKitchen : kitchen,
    enrolledAt: state === 'different enrollment' ? new Date(start + 1).toISOString() : device.enrolledAt,
  };
  refreshDevice.mockResolvedValueOnce(current);
  const response = await signedReport(cookie);
  const unavailable = state === 'missing' || state === 'revoked';

  expect(response.status).toBe(unavailable ? 403 : 409);
  expect(await response.json()).toEqual({
    ok: false, error: unavailable ? 'Not an enrolled device' : 'Device location changed. Retry with the current location.',
  });
  expect(refreshDevice).toHaveBeenCalledExactlyOnceWith(device.id);
});
