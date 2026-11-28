import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PUT as saveWatchSettingsRoute } from '../app/api/foodhub/watch/settings/route';
import type { Actor } from '../lib/foodhub/activity';
import { getRepo } from '../lib/foodhub/repo';
import { hashPassword } from '../lib/foodhub/auth';
import { getWatchSettings, saveWatchSettings } from '../lib/foodhub/watch/engine';

const shared = 'watch:settings';
const initialPhone = '+15145550110';
const replacementPhone = '+15145550111';
const owner: Actor = { username: 'fixture-owner', name: 'Fixture account owner', source: 'dashboard' };
const settingsEditor: Actor = { username: 'fixture-editor', name: 'Fixture kitchen settings owner', source: 'dashboard' };

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubGlobal('__foodhubMem', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([replacementPhone, null])('keeps a concurrent shared phone change (%s) and an unrelated valid timing edit', async (phone) => {
  const repo = getRepo();
  await repo.setKv(shared, { screenAlertPhone: initialPhone, quietFrom: '22:15' });
  await Promise.all([
    saveWatchSettings({ screenAlertPhone: phone }, owner),
    saveWatchSettings({ unseenAfterSec: 240 }, settingsEditor),
  ]);
  const stored = await getWatchSettings({ strict: true });
  expect(stored).toMatchObject({ screenAlertPhone: phone, unseenAfterSec: 240, quietFrom: '22:15' });
  expect((await repo.listActivity()).filter(({ action }) => action === 'watch_settings')).toHaveLength(2);
});

it('keeps first-time independent settings saves and default values', async () => {
  await Promise.all([
    saveWatchSettings({ screenAlertPhone: replacementPhone }, owner),
    saveWatchSettings({ unseenAfterSec: 240 }, settingsEditor),
  ]);
  expect(await getWatchSettings({ strict: true })).toMatchObject({
    screenAlertPhone: replacementPhone, unseenAfterSec: 240, quietFrom: '23:30',
  });
});

it('reports a conflict without a success event when authorized writes remain concurrent', async () => {
  const repo = getRepo();
  const password = 'fixture-watch-settings-password';
  await repo.saveUser({ username: owner.username, name: owner.name, role: 'owner', locations: [],
    active: true, passwordHash: hashPassword(password) });
  await repo.setKv(shared, { screenAlertPhone: initialPhone });
  const read = repo.getKv.bind(repo);
  let observed = 0;
  vi.spyOn(repo, 'getKv').mockImplementation(async (key) => {
    const stored = await read(key);
    if (key === shared) await repo.setKv(shared, { screenAlertPhone: replacementPhone, unseenAfterSec: 100 + ++observed });
    return stored;
  });
  const response = await saveWatchSettingsRoute(new Request('http://hub.local/api/foodhub/watch/settings', {
    method: 'PUT',
    headers: { authorization: `Basic ${Buffer.from(`${owner.username}:${password}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { quietTo: '08:15' } }),
  }), {});
  expect(response.status).toBe(409);
  expect(observed).toBe(4);
  expect(await read(shared)).toEqual({ screenAlertPhone: replacementPhone, unseenAfterSec: 104 });
  expect((await repo.listActivity()).filter(({ action }) => action === 'watch_settings')).toHaveLength(0);
});
