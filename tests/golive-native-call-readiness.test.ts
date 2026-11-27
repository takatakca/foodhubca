import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { goLiveKitchenCoverage, goLiveProgress, nativeTabletCallGoLiveSteps, type GoLiveTablet, type RelayGoLiveInput } from '../app/(console)/settings/go-live/steps';
import { GET as readCatalog } from '../app/api/foodhub/catalog/route';
import { GET as readDevices, POST as pairDevice } from '../app/api/foodhub/devices/route';
import { GET as readWatchSettings } from '../app/api/foodhub/watch/settings/route';
import type { Actor } from '../lib/foodhub/activity';
import { saveLocation, type Catalog } from '../lib/foodhub/catalog';
import { saveWatchSettings } from '../lib/foodhub/watch/engine';
import { DEFAULT_RULES, type WatchSettings } from '../lib/foodhub/watch/types';

const PAIRED = { code: 'FIXTURE_PAIRED', name: 'Paired fixture', address: '', active: true, phone: '+15145550123' };
const NO_TABLET = { code: 'FIXTURE_UNPAIRED', name: 'Unpaired fixture', address: '', active: true };
const RETIRED = { code: 'FIXTURE_RETIRED', name: 'Retired fixture', address: '', active: true };
const owner: Actor = { username: 'owner', name: 'Synthetic owner', source: 'dashboard' };
const password = 'native-tablet-voice-readiness-fixture';
const blocker = vi.fn().mockRejectedValue(new Error('No provider traffic in configuration tests'));
const en = (_fr: string, english: string) => english;
const fr = (french: string, _en: string) => french;
const locName = (code: string) => code;

function ownerRequest(path: string, device?: { name: string; locationCode: string }) {
  const headers = { authorization: `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`, 'content-type': 'application/json' };
  return new Request(`http://127.0.0.1/api/foodhub/${path}`, { headers, ...(device ? { method: 'POST', body: JSON.stringify(device) } : {}) });
}

async function pair(locationCode = PAIRED.code) {
  expect((await pairDevice(ownerRequest('devices', { name: 'Synthetic native tablet', locationCode }), undefined)).status).toBe(200);
}

async function configuration(enabled = true, escalate = true, screenAlertPhone: string | null = null) {
  await saveWatchSettings({ enabled: true, screenAlertPhone, rules: { ...DEFAULT_RULES, device_offline: { enabled, escalate } } }, owner);
}

async function renderRows(translate = en) {
  const [watchResult, deviceResult, catalogResult] = await Promise.all([
    readWatchSettings(ownerRequest('watch/settings'), undefined),
    readDevices(ownerRequest('devices'), undefined),
    readCatalog(ownerRequest('catalog'), undefined),
  ]);
  expect([watchResult.status, deviceResult.status, catalogResult.status]).toEqual([200, 200, 200]);
  const data = await watchResult.json() as { settings: Pick<WatchSettings, 'enabled' | 'rules'>; channels: { call: boolean }; screenAlertPhoneConfigured: boolean };
  const { devices } = await deviceResult.json() as { devices: GoLiveTablet[] };
  const catalog = await catalogResult.json() as Catalog;
  const { activeLocations, kitchenPhoneLocations } = goLiveKitchenCoverage(null, catalog.locations, [PAIRED, NO_TABLET, RETIRED]);
  const watch: RelayGoLiveInput['watch'] = { enabled: data.settings.enabled, rules: data.settings.rules, callConfigured: data.channels.call, sharedPhoneConfigured: data.screenAlertPhoneConfigured };
  return nativeTabletCallGoLiveSteps({ activeLocations, devices, watch, kitchenPhoneLocations }, translate, locName);
}

beforeEach(async () => {
  vi.stubGlobal('__foodhubMem', undefined);
  blocker.mockClear();
  vi.stubGlobal('fetch', blocker);
  for (const [key, value] of Object.entries({
    FOODHUB_FORCE_MEMORY: 'true', DASHBOARD_PASSWORD: password, SESSION_SECRET: 'synthetic-device-ready-cookie-secret',
    TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'inert-test-only', TWILIO_FROM: '+15145550199',
    TWILIO_BASE_URL: 'http://127.0.0.1:1', FOODHUB_WATCH_INTERVAL_S: '0', FOODHUB_INTERNAL_SYNC_MIN: '0',
  })) vi.stubEnv(key, value);
  for (const kitchen of [PAIRED, NO_TABLET, RETIRED]) await saveLocation(kitchen);
});

afterEach(() => {
  expect(blocker).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  { enabled: false, escalate: true, copy: 'Enable the “Tablet off” rule.' },
  { enabled: true, escalate: false, copy: 'Enable escalation for the “Tablet off” rule to allow calls.' },
])('reports the actionable disabled or alert-only rule even with an otherwise configured path', async ({ enabled, escalate, copy }) => {
  await pair();
  await configuration(enabled, escalate, '+15145550124');
  const rows = await renderRows();
  expect(rows).toMatchObject([{ state: 'warn', optional: true, href: '/settings/alerts', body: copy }]);
  expect(goLiveProgress([{ state: 'done' }, ...rows])).toMatchObject({ percent: 100, todo: 0 });
});

it('considers only paired active kitchens and labels their usable fallback as configuration', async () => {
  await pair();
  await pair(RETIRED.code);
  await saveLocation({ ...RETIRED, active: false });
  await configuration();
  const [row] = await renderRows(fr);
  expect(row).toMatchObject({ state: 'done', title: 'Appels pour les tablettes hors ligne' });
  expect(row.body).toContain('Un téléphone est configuré pour chaque cuisine avec une tablette jumelée.');
  expect(row.body).toContain('Confirmez la réception du premier appel lors d’un essai contrôlé.');
  expect(JSON.stringify(row)).not.toContain(PAIRED.phone);
});

it('offers a phone setup action when the enrolled kitchen lacks a usable fallback and no common number is set', async () => {
  await pair(NO_TABLET.code);
  await configuration();
  expect(await renderRows()).toMatchObject([{ state: 'warn', href: '/settings/business', body: expect.stringContaining(NO_TABLET.code) }]);
  await configuration(true, true, '+15145550124');
  expect(await renderRows()).toMatchObject([{ state: 'done', body: expect.stringContaining('controlled test') }]);
  expect(JSON.stringify(await renderRows())).not.toContain('+15145550124');
});

it('identifies missing Twilio Voice and omits the row if only retired devices exist', async () => {
  await pair(RETIRED.code);
  await saveLocation({ ...RETIRED, active: false });
  await configuration();
  expect(await renderRows()).toEqual([]);
  await pair();
  vi.stubEnv('TWILIO_AUTH_TOKEN', '');
  expect(await renderRows()).toMatchObject([{ state: 'warn', href: '/settings/alerts', body: 'Set up Twilio Voice to make alert calls.' }]);
});
