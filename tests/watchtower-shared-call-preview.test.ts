import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/foodhub/watch/test/route';
import type { Actor } from '../lib/foodhub/activity';
import { hashPassword, sessionCookieFor } from '../lib/foodhub/auth';
import { saveLocation } from '../lib/foodhub/catalog';
import { enrollDevice } from '../lib/foodhub/identity/devices';
import { listOutbox } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import { getWatchSettings, listIncidents, saveWatchSettings } from '../lib/foodhub/watch/engine';

const PREVIEW_URL = 'https://hub.example.test/api/foodhub/watch/test';
const PASSWORD = 'shared-call-preview-test-password';
const SHARED = '+15145550124';
const PROFILE = '+15145550125';
const KITCHEN = '+15145550127';
const KITCHEN_KINDS = ['device_offline', 'screen_down', 'screen_waiting'];
const OWNER: Actor = { username: 'owner', name: 'Test owner', source: 'dashboard' };
const fetchMock = vi.fn<typeof fetch>();

function basic(username: string) {
  return { authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` };
}

async function preview(headers: HeadersInit = basic('owner'), locationCode?: string) {
  const url = new URL(PREVIEW_URL);
  url.searchParams.set('to', PROFILE);
  if (locationCode !== undefined) url.searchParams.set('locationCode', locationCode);
  const response = await GET(new Request(url, { headers }), undefined);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return response;
}

function saveKitchen(phone: string | null, active = true) {
  return saveLocation({ code: 'TEST', name: 'Test kitchen', address: '', active, phone });
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubEnv('SESSION_SECRET', 'synthetic-session-secret-for-shared-phone-preview');
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'1'.repeat(32)}`);
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'synthetic-shared-phone-preview-token');
  vi.stubEnv('TWILIO_FROM', '+15145550126');
  vi.stubEnv('TWILIO_BASE_URL', 'https://twilio.example.test');
  vi.stubGlobal('__foodhubMem', undefined);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('External traffic was not expected in the preview test'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Shared screen call preview', () => {
  it('uses the saved shared number for both checks and leaves Watchtower records untouched', async () => {
    await saveWatchSettings({ screenAlertPhone: '514 555-0124' }, OWNER);
    const before = await getWatchSettings();
    const activity = await getRepo().listActivity();
    const response = await preview();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, callConfigured: true, checks: [
        { kind: 'screen_down', state: 'simulated', destination: '+1••••••0124' },
        { kind: 'screen_waiting', state: 'simulated', destination: '+1••••••0124' },
      ],
    });
    expect(await getWatchSettings()).toEqual(before);
    expect(await getRepo().listActivity()).toEqual(activity);
    expect(await getRepo().getKv('watch:last')).toBeNull();
    expect(await listOutbox()).toEqual([]);
    expect(await listIncidents()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows missing shared configuration instead of choosing a phone from the request', async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, callConfigured: true, checks: [
        { kind: 'screen_down', state: 'missing-number', destination: null },
        { kind: 'screen_waiting', state: 'missing-number', destination: null },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the rule enablement and escalation independently, then respects the global switch', async () => {
    const rules = (await getWatchSettings()).rules;
    rules.screen_down = { enabled: false, escalate: true };
    rules.screen_waiting = { enabled: true, escalate: false };
    await saveWatchSettings({ screenAlertPhone: SHARED, rules }, OWNER);
    expect(await (await preview()).json()).toMatchObject({ checks: [
      { kind: 'screen_down', state: 'rule-off', destination: null },
      { kind: 'screen_waiting', state: 'rule-off', destination: null },
    ] });
    await saveWatchSettings({ enabled: false }, OWNER);
    expect(await (await preview()).json()).toMatchObject({ checks: [
      { kind: 'screen_down', state: 'watch-off', destination: null },
      { kind: 'screen_waiting', state: 'watch-off', destination: null },
    ] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('simulates the saved destination while reporting missing Twilio configuration separately', async () => {
    await saveWatchSettings({ screenAlertPhone: SHARED }, OWNER);
    vi.stubEnv('TWILIO_AUTH_TOKEN', undefined);
    expect(await (await preview()).json()).toMatchObject({ callConfigured: false, checks: [
      { kind: 'screen_down', state: 'simulated', destination: '+1••••••0124' },
      { kind: 'screen_waiting', state: 'simulated', destination: '+1••••••0124' },
    ] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an account-wide owner session apart from any enrolled tablet session', async () => {
    const passwordHash = hashPassword(PASSWORD);
    const globalOwner = await getRepo().saveUser({ username: 'test-owner', name: 'Test owner', active: true, role: 'owner', locations: [], passwordHash });
    await getRepo().saveUser({ username: 'scoped-owner', name: 'Scoped owner', active: true, role: 'owner', locations: ['TEST'], passwordHash });
    await getRepo().saveUser({ username: 'manager', name: 'Test manager', active: true, role: 'manager', locations: [], passwordHash });
    const { device } = await enrollDevice({ name: 'Test tablet', locationCode: 'TEST' }, OWNER);
    const cookie = (await sessionCookieFor(globalOwner, 'pin', device.id)).split(';')[0];
    await saveKitchen(KITCHEN);
    for (const locationCode of [undefined, 'TEST']) {
      expect((await preview({}, locationCode)).status).toBe(401);
      expect((await preview(basic('manager'), locationCode)).status).toBe(403);
      expect((await preview(basic('scoped-owner'), locationCode)).status).toBe(403);
      expect((await preview({ cookie }, locationCode)).status).toBe(403);
      expect((await preview(basic('test-owner'), locationCode)).status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the existing POST call test on the signed-in profile phone', async () => {
    await getRepo().saveUser({ username: 'test-owner', name: 'Test owner', role: 'owner', locations: [], active: true, phone: PROFILE, passwordHash: hashPassword(PASSWORD) });
    await saveWatchSettings({ screenAlertPhone: SHARED }, OWNER);
    expect(await (await preview(basic('test-owner'))).json()).toMatchObject({ checks: [
      { destination: '+1••••••0124' }, { destination: '+1••••••0124' },
    ] });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ sid: `CA${'a'.repeat(32)}` }, { status: 201 }));
    const response = await POST(new Request(PREVIEW_URL, { method: 'POST', headers: basic('test-owner'), body: JSON.stringify({ channel: 'call' }) }), undefined);
    expect(await response.json()).toMatchObject({ ok: true, result: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [providerUrl, init] = fetchMock.mock.calls[0];
    expect(providerUrl).toBe(`https://twilio.example.test/2010-04-01/Accounts/AC${'1'.repeat(32)}/Calls.json`);
    expect(new URLSearchParams(String(init?.body)).get('To')).toBe(PROFILE);
  });
});

describe('Kitchen call preview', () => {
  it('simulates the saved active kitchen fallback for all three rules without sending or recording anything', async () => {
    await saveKitchen(KITCHEN);
    const activity = await getRepo().listActivity();
    const body = await (await preview(undefined, 'TEST')).json();
    expect(body).toEqual({
      ok: true, callConfigured: true, locationCode: 'TEST',
      checks: KITCHEN_KINDS.map((kind) => ({ kind, state: 'simulated', destination: '+1••••••0127', source: 'kitchen' })),
    });
    expect(JSON.stringify(body)).not.toContain(KITCHEN);
    expect(await getRepo().listActivity()).toEqual(activity);
    expect(await getRepo().getKv('watch:last')).toBeNull();
    expect(await listOutbox()).toEqual([]);
    expect(await listIncidents()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the shared number and reports Twilio configuration independently', async () => {
    await saveKitchen(KITCHEN);
    await saveWatchSettings({ screenAlertPhone: SHARED }, OWNER);
    vi.stubEnv('TWILIO_AUTH_TOKEN', undefined);
    expect(await (await preview(undefined, 'TEST')).json()).toEqual({
      ok: true, callConfigured: false, locationCode: 'TEST',
      checks: KITCHEN_KINDS.map((kind) => ({ kind, state: 'simulated', destination: '+1••••••0124', source: 'shared' })),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains the tablet rule and Watchtower gates for a kitchen without a number', async () => {
    await saveKitchen(null);
    const rules = (await getWatchSettings()).rules;
    rules.device_offline = { enabled: true, escalate: false };
    await saveWatchSettings({ rules }, OWNER);
    const missing = { state: 'missing-number', destination: null, source: null };
    expect(await (await preview(undefined, 'TEST')).json()).toMatchObject({ checks: [
      { ...missing, kind: 'device_offline', state: 'rule-off' },
      { ...missing, kind: 'screen_down' },
      { ...missing, kind: 'screen_waiting' },
    ] });
    await saveWatchSettings({ enabled: false }, OWNER);
    expect(await (await preview(undefined, 'TEST')).json()).toMatchObject({ checks: KITCHEN_KINDS.map((kind) => ({ ...missing, kind, state: 'watch-off' })) });
  });

  it('rejects an unknown or inactive kitchen, even if the shared line is configured', async () => {
    await saveKitchen(KITCHEN, false);
    await saveWatchSettings({ screenAlertPhone: SHARED }, OWNER);
    for (const code of ['TEST', 'UNKNOWN_KITCHEN']) {
      const response = await preview(undefined, code);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: 'Active kitchen not found.' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats malformed historic kitchen data as unavailable without recording a failed outbox entry', async () => {
    await getRepo().setKv('catalog', { locations: [{ code: 'TEST', name: 'Test kitchen', address: '', active: true, phone: 'broken legacy value' }] });
    const result = await (await preview(undefined, 'TEST')).json();
    expect(result.checks).toEqual(KITCHEN_KINDS.map((kind) => ({ kind, state: 'missing-number', destination: null, source: null })));
    expect(await listOutbox()).toEqual([]);
    expect(await listIncidents()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a catalog read failure without guessing a destination', async () => {
    const repo = getRepo();
    const read = repo.getKv.bind(repo);
    const lookup = vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
      if (key === 'catalog') throw new Error('Synthetic catalog unavailable');
      return read(key);
    });
    try {
      const response = await preview(undefined, 'TEST');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'Could not load the saved kitchens.' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });

  it('does not report a destination when saved watch settings cannot be read', async () => {
    await saveKitchen(KITCHEN);
    await saveWatchSettings({ screenAlertPhone: SHARED }, OWNER);
    const repo = getRepo();
    const read = repo.getKv.bind(repo);
    const lookup = vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
      if (key === 'watch:settings') throw new Error('Synthetic alert settings unavailable');
      return read(key);
    });
    try {
      for (const code of [undefined, 'TEST']) {
        const response = await preview(undefined, code);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ ok: false, error: 'Could not load the saved alert settings.' });
      }
      expect(await listOutbox()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
});
