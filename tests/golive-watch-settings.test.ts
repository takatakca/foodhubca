import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GoLivePage from '@/app/(console)/settings/go-live/page';
import { goLiveProgress, type Step } from '@/app/(console)/settings/go-live/steps';

const ui = vi.hoisted(() => ({
  lang: 'en',
  values: new Map<unknown, unknown>(),
  mount: [] as Array<() => void>,
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => { ui.mount.push(effect); },
  useState: (initial: unknown) => [initial, (value: unknown) => ui.values.set(initial, value)],
}));
vi.mock('@/components/ui/celebration', () => ({ useCelebrateOnce: () => false }));
vi.mock('@/components/shell/viewer', () => ({
  shortLoc: (name: string) => name,
  useViewer: () => ({ locations: [{ code: 'KITCHEN', name: 'Kitchen' }], locName: () => 'Kitchen', can: () => true }),
}));
vi.mock('@/lib/i18n/client', () => ({
  useI18n: () => ({ t: (fr: string, en: string) => ui.lang === 'fr' ? fr : en, loc: ui.lang === 'fr' ? 'fr-CA' : 'en-CA' }),
}));

const platforms = ['uber_eats', 'doordash', 'skip'];
const rule = { enabled: true, escalate: true };
const responses: Record<string, unknown> = {
  channels: {
    mode: 'supabase', dashboardProtected: true, liveEnabled: true, clover: { configured: true, missing: [] },
    channels: platforms.map((channel) => ({ channel, label: channel, viaClover: true })),
    goLive: { clover: { unreachableStores: [] }, sessionSecret: { set: true, strong: true } },
  },
  'watch/settings': {
    channels: { email: true, sms: true, call: true, chat: true, ai: true },
    settings: { enabled: true, rules: { screen_down: rule, screen_waiting: rule } },
    screenAlertPhoneConfigured: true,
  },
  users: { users: [{ role: 'owner', phone: '+15555550123', active: true, hasPin: true, locations: [] }] },
  devices: { devices: [{ locationCode: 'KITCHEN', status: 'online' }] },
  stores: { stores: [] },
  'recon/fees': { fees: { confirmed: Object.fromEntries(platforms.map((platform) => [platform, true])) } },
  catalog: { locations: [{ code: 'KITCHEN', name: 'Kitchen', active: true, phone: '+15555550123' }] },
  'clover-labels': { report: null },
  screens: { agentConfigured: true, screens: [{ platform: 'doordash', locationCode: 'KITCHEN', status: 'online' }] },
};

async function loadPage(failure?: { route: string; status: number }) {
  vi.stubGlobal('fetch', async (url: string) => {
    const route = url.replace('/api/foodhub/', '');
    if (route === failure?.route) return Response.json({ error: 'Request failed' }, { status: failure.status });
    if (!Object.hasOwn(responses, route)) throw new Error(`Unexpected request to ${url}`);
    return Response.json(responses[route]);
  });
  GoLivePage();
  ui.mount.forEach((effect) => effect());
  await vi.waitFor(() => expect(ui.values.get(false)).toBe(false));
  return { steps: ui.values.get(null) as Step[] | undefined, error: ui.values.get('') };
}

beforeEach(() => { ui.lang = 'en'; ui.values.clear(); ui.mount.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  ['fr', 'Réglages d’alerte indisponibles', 'Réglages des appels indisponibles.', 'Chaque cuisine a un téléphone configuré.'],
  ['en', 'Alert settings unavailable', 'Call settings unavailable.', 'Every kitchen has a phone configured.'],
])('keeps the %s checklist visible with required alert readiness unknown on a 503', async (lang, alertTitle, callBody, phoneBody) => {
  ui.lang = lang;
  const { steps, error } = await loadPage({ route: 'watch/settings', status: 503 });

  expect(error).toBe('');
  expect(steps).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'db', state: 'done' }),
    expect.objectContaining({ key: 'screens-relay', state: 'done' }),
    expect.objectContaining({ key: 'alerts-settings', state: 'todo', title: alertTitle }),
    expect.objectContaining({ key: 'screens-calls', state: 'warn', body: callBody }),
    expect.objectContaining({ key: 'kphone', state: 'done', body: phoneBody }),
  ]));
  expect(goLiveProgress(steps ?? [])).toMatchObject({ complete: false, todo: 1 });
});

it('keeps verified alert rows ready when settings are available', async () => {
  const { steps, error } = await loadPage();
  expect(error).toBe('');
  expect(steps).toEqual(expect.arrayContaining(['email', 'sms', 'screens-calls'].map((key) => expect.objectContaining({ key, state: 'done' }))));
  expect(steps?.find((step) => step.key === 'kphone')).toMatchObject({ body: 'Every kitchen has a phone configured.' });
  expect(goLiveProgress(steps ?? [])).toMatchObject({ complete: true, todo: 0 });
});

it.each([{ route: 'watch/settings', status: 403 }, { route: 'channels', status: 503 }])(
  'preserves the normal page error for $route HTTP $status',
  async (failure) => {
    expect(await loadPage(failure)).toEqual({ steps: undefined, error: 'Request failed' });
  },
);
