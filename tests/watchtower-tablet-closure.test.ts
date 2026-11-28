import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as deviceHeartbeat } from '../app/api/foodhub/devices/heartbeat/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation } from '../lib/foodhub/catalog';
import { emptyWeek, saveHours } from '../lib/foodhub/hours';
import { DEVICES, enrollDevice, getDevice, updateDevice } from '../lib/foodhub/identity/devices';
import { getRepo, type DocFilter } from '../lib/foodhub/repo';
import { getIncident, listIncidents, runWatch, saveWatchSettings } from '../lib/foodhub/watch/engine';

const OWNER: Actor = { username: 'owner', name: 'Fixture owner', source: 'dashboard' };
const KITCHEN = 'TEST_OVERNIGHT';
const OPEN_AT = Date.parse('2026-11-28T07:58:00Z');
const CLOSED_AT = Date.parse('2026-11-28T08:01:00Z');
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(OPEN_AT - 10 * 60_000);
  for (const [key, value] of Object.entries({
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_TIMEZONE: 'America/Toronto',
    SESSION_SECRET: 'synthetic-watchtower-tablet-session-secret',
    TWILIO_ACCOUNT_SID: 'fixture-twilio-sid', TWILIO_AUTH_TOKEN: 'fixture-twilio-token',
    TWILIO_FROM: '+15145550102', TWILIO_BASE_URL: 'http://127.0.0.1:1',
  })) vi.stubEnv(key, value);
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset().mockRejectedValue(new Error('Provider requests are disabled in this fixture'));
  vi.stubGlobal('fetch', fetchMock);
  await saveLocation({ code: KITCHEN, name: 'Kitchen fixture', address: '', active: true, phone: '+15145550103' });
  await saveHours({ locations: { [KITCHEN]: { ...emptyWeek(), saturday: [{ open: '00:00', close: '03:00' }] } }, brands: {}, holidays: [] });
  await saveWatchSettings({ smsAfterMin: 1, postToChat: false, aiExplain: false }, OWNER);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function openOfflineAlert() {
  const enrollment = await enrollDevice({ name: 'Native tablet fixture', locationCode: KITCHEN }, OWNER);
  vi.setSystemTime(OPEN_AT);
  await runWatch({ force: true });
  const incident = (await listIncidents()).find((record) => record.kind === 'device_offline');
  if (!incident) throw new Error('Fixture did not open a native tablet alert');
  expect(incident.status).toBe('open');
  return { ...enrollment, incident };
}

function sendHeartbeat(cookie: string) {
  return deviceHeartbeat(new Request('http://hub.local/api/foodhub/devices/heartbeat', {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], 'content-type': 'application/json' },
    body: JSON.stringify({ visible: true, soundOn: true }),
  }));
}

describe('Native tablet automatic closure evidence', () => {
  it('records the end of monitoring hours while the same tablet remains offline', async () => {
    const { device, incident } = await openOfflineAlert();
    vi.setSystemTime(CLOSED_AT);
    await runWatch({ force: true });

    const closed = await getIncident(incident.id);
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
    expect(closed?.steps.at(-1)).toMatchObject({ kind: 'resolved', deviceOfflineResolution: 'monitoring-hours-ended' });
    expect((await getDevice(device.id))?.lastSeenAt).toBe(device.lastSeenAt);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records recovery only when the same enrolled tablet has sent a fresh signed heartbeat', async () => {
    const { device, cookie, incident } = await openOfflineAlert();
    vi.setSystemTime(OPEN_AT + 65_000);
    const response = await sendHeartbeat(cookie);
    expect(response.status).toBe(200);
    const at = new Date().toISOString();
    expect(await getDevice(device.id)).toMatchObject({ lastSeenAt: at, lastHeartbeat: { at, locationCode: KITCHEN } });

    await runWatch({ force: true });
    const closed = await getIncident(incident.id);
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
    expect(closed?.steps.at(-1)).toMatchObject({ kind: 'resolved', deviceOfflineResolution: 'heartbeat-restored' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('labels an automatic closure unconfirmed if the configured hours could not be read', async () => {
    const { device, incident } = await openOfflineAlert();
    const repo = getRepo();
    const read = repo.getKv.bind(repo);
    vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
      if (key === 'hours') throw new Error('Synthetic opening-hours read failure');
      return read(key);
    });
    vi.setSystemTime(OPEN_AT + 65_000);
    await runWatch({ force: true });

    const closed = await getIncident(incident.id);
    expect(closed?.steps.at(-1)).toMatchObject({ kind: 'resolved', deviceOfflineResolution: 'unconfirmed' });
    expect((await getDevice(device.id))?.lastSeenAt).toBe(device.lastSeenAt);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not confirm recovery from a heartbeat recorded at another kitchen between two moves', async () => {
    const { device, cookie, incident } = await openOfflineAlert();
    vi.setSystemTime(OPEN_AT + 65_000);
    await updateDevice(device.id, { locationCode: 'TEST_OTHER_KITCHEN' }, OWNER);
    expect((await sendHeartbeat(cookie)).status).toBe(200);
    await updateDevice(device.id, { locationCode: KITCHEN }, OWNER);
    expect(await getDevice(device.id)).toMatchObject({ locationCode: KITCHEN, lastHeartbeat: { locationCode: 'TEST_OTHER_KITCHEN' } });

    await runWatch({ force: true });
    const closed = await getIncident(incident.id);
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: 'auto' });
    expect(closed?.steps.at(-1)).toMatchObject({ kind: 'resolved', deviceOfflineResolution: 'unconfirmed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the device collection time for a late observed heartbeat unless time was injected (%s)', async (injected) => {
    const { cookie, incident } = await openOfflineAlert();
    const start = OPEN_AT + 65_000;
    vi.setSystemTime(start);
    const repo = getRepo();
    const list = repo.listDocs.bind(repo);
    let heartbeatStatus: number | undefined;
    vi.spyOn(repo, 'listDocs').mockImplementation(async <T>(collection: string, filter?: DocFilter) => {
      if (collection === DEVICES) {
        vi.setSystemTime(start + 5_000);
        heartbeatStatus = (await sendHeartbeat(cookie)).status;
      }
      return list<T>(collection, filter);
    });

    await runWatch({ force: true, ...(injected ? { now: start } : {}) });
    expect(heartbeatStatus).toBe(200);
    const closed = await getIncident(incident.id);
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: 'auto', resolvedAt: new Date(start).toISOString() });
    expect(closed?.steps.at(-1)).toMatchObject({
      kind: 'resolved', deviceOfflineResolution: injected ? 'unconfirmed' : 'heartbeat-restored',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not confirm recovery from the last-seen timestamp of a legacy device record', async () => {
    const { device, incident } = await openOfflineAlert();
    vi.setSystemTime(OPEN_AT + 65_000);
    await getRepo().putDocs(DEVICES, [{
      id: device.id, key: device.locationCode, at: device.enrolledAt,
      data: { ...device, lastSeenAt: new Date().toISOString() },
    }]);

    await runWatch({ force: true });
    const closed = await getIncident(incident.id);
    expect(closed?.steps.at(-1)).toMatchObject({ kind: 'resolved', deviceOfflineResolution: 'unconfirmed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
