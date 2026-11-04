import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetVisibleScreenTiles, revealScreenScope, screenChannel, screenInScope, screenWallState } from '../lib/ui/screens-scope';
import { validScope, WORKSPACE_CHANNELS, type Scope } from '../lib/foodhub/scope';
import { saveLocation } from '../lib/foodhub/catalog';
import { POST as setupRoute } from '../app/api/foodhub/screens/setup/route';
import { POST as heartbeatRoute } from '../app/api/foodhub/screens/heartbeat/route';
import { GET as listRoute } from '../app/api/foodhub/screens/route';

const screens = Array.from({ length: 54 }, (_, i) => ({
  id: `s${String(i + 1).padStart(2, '0')}`,
  name: `Screen ${i + 1}`,
  platform: i < 18 ? 'doordash' : i < 36 ? 'ubereats' : 'skip',
  locationCode: i % 2 ? 'NORTH' : 'SOUTH',
  status: 'online',
  titleCount: i === 53 ? 3 : 0,
}));
const all: Scope = { kitchen: null, brand: null };

describe('platform screen workspaces', () => {
  it('shows all 54 accounts together or 18 independent screens per platform without changing them', () => {
    expect(screenWallState(screens, all, {}).visible).toEqual(screens);
    for (const [channel, platform] of [['doordash', 'doordash'], ['uber_eats', 'ubereats'], ['skip', 'skip']]) {
      const visible = screenWallState(screens, { ...all, channel }, {}).visible;
      expect(visible).toHaveLength(18);
      expect(visible.every((s) => s.platform === platform)).toBe(true);
      expect(visible.every((s) => screens.includes(s))).toBe(true);
    }
    expect(screens[18].platform).toBe('ubereats');
  });

  it('combines kitchen and provider filters while keeping multi-brand account screens', () => {
    const state = screenWallState(screens, { ...all, kitchen: 'NORTH', brand: 'Brand A', channel: 'uber_eats' } as Scope, {});
    expect(state.visible).toHaveLength(9);
    expect(state.visible.every((s) => s.locationCode === 'NORTH' && s.platform === 'ubereats')).toBe(true);
    expect(screenWallState(screens, { ...all, kitchen: 'MISSING' }, {}).visible).toEqual([]);
  });

  it('does not show another provider for unsupported channels', () => {
    expect(screenWallState(screens, { ...all, channel: 'tgtg' }, {}).visible).toEqual([]);
    expect(screenWallState(screens, { ...all, channel: 'invalid' }, {}).visible).toEqual([]);
    expect(screenChannel('other')).toBeUndefined();
    expect(screenInScope({ ...screens[0], platform: 'other' }, all)).toBe(true);
    expect(screenInScope({ ...screens[0], platform: 'other' }, { ...all, channel: 'doordash' })).toBe(false);
  });

  it('keeps waiting orders on hidden platforms in the global alarm and named jump list', () => {
    const { visible, ring } = screenWallState(screens, { ...all, channel: 'doordash' }, {});
    expect(visible.some((s) => s.id === 's54')).toBe(false);
    expect(ring).toMatchObject({ tone: 'order', waiting: 3, waitingOn: ['Screen 54'] });
    expect(Object.keys(ring.memory)).toHaveLength(54);
  });

  it('still raises an alert for a hidden screen dropping after being online', () => {
    const down = screens.map((s) => s.id === 's19' ? { ...s, status: 'login_required' } : s);
    const { ring } = screenWallState(down, { ...all, kitchen: 'NORTH', channel: 'doordash' }, { s19: 'online' });
    expect(ring).toMatchObject({ tone: 'alert', newlyDown: ['Screen 19'] });
  });

  it('reveals a waiting account by location and platform, clearing a prior brand safely', () => {
    expect(revealScreenScope(screens[53])).toEqual({ kitchen: 'NORTH', brand: null, channel: 'skip' });
    expect(revealScreenScope(screens[18])).toEqual({ kitchen: 'SOUTH', brand: null, channel: 'uber_eats' });
    const other = revealScreenScope({ ...screens[0], platform: 'other' });
    expect(Object.hasOwn(other, 'channel')).toBe(true);
    expect(other.channel).toBeUndefined();
    expect(screenInScope(screens[18], revealScreenScope(screens[18]))).toBe(true);
  });

  it('keeps hidden custom positions while resetting the visible provider layout', () => {
    const hidden = { id: 's54', x: 6, y: 6, w: 4, h: 4 };
    const saved = [{ id: 's01', x: 8, y: 8, w: 2, h: 2 }, hidden];
    const reset = resetVisibleScreenTiles(saved, ['s01', 's02']);
    expect(reset.find((tile) => tile.id === 's54')).toBe(hidden);
    expect(reset.filter((tile) => tile.id !== 's54')).toHaveLength(2);
    expect(saved[0]).toEqual({ id: 's01', x: 8, y: 8, w: 2, h: 2 });
    expect(new Set(reset.map((tile) => tile.id)).size).toBe(reset.length);
  });
});

describe('54-account setup, relay and workspace contract', () => {
  const password = 'synthetic-workspace-owner-password';
  const token = 'synthetic-relay-token-with-more-than-24-chars';
  const auth = `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`;
  const request = (path: string, body?: unknown, authorization?: string) => new Request(`http://hub.local/api/foodhub/screens${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  beforeEach(async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
    vi.stubEnv('DASHBOARD_PASSWORD', password);
    vi.stubEnv('FOODHUB_SCREENS_AGENT_TOKEN', token);
    vi.stubEnv('FOODHUB_SCREENS_VIEW_HOSTS', 'screens.example.test');
    (globalThis as typeof globalThis & { __foodhubMem?: unknown }).__foodhubMem = undefined;
    await saveLocation({ code: 'NORTH', name: 'Synthetic north kitchen', address: '', active: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('creates independent accounts, authenticates relay reports, and preserves hidden alarms before any API stores exist', async () => {
    const input = { locationCode: 'NORTH', baseUrl: 'https://screens.example.test/', counts: { doordash: 18, ubereats: 18, skip: 18 } };
    expect((await setupRoute(request('/setup', input), {})).status).toBe(401);
    const setup = await setupRoute(request('/setup', input, auth), {});
    expect(setup.status).toBe(200);
    expect(await setup.json()).toMatchObject({ created: 54, kept: [] });
    const repeat = await setupRoute(request('/setup', input, auth), {});
    const again = await repeat.json();
    expect(again.created).toBe(0);
    expect(again.kept).toHaveLength(54);

    const report = { version: 'synthetic-test', screens: screens.map((s) => ({ id: s.id, state: s.id === 's19' ? 'login' : 'ok', waiting: s.id === 's54' ? 3 : 0 })) };
    expect((await heartbeatRoute(request('/heartbeat', report))).status).toBe(401);
    const heartbeat = await heartbeatRoute(request('/heartbeat', report, `Bearer ${token}`));
    expect(heartbeat.status).toBe(200);
    const delivery = await heartbeat.json();
    expect(delivery.unknown).toEqual([]);
    expect(delivery.commands).toHaveLength(54);
    expect(delivery.commands.every((command: { kind: string }) => command.kind === 'open')).toBe(true);

    expect((await listRoute(request(''), {})).status).toBe(401);
    const list = await listRoute(request('', undefined, auth), {});
    expect(list.status).toBe(200);
    const data = await list.json();
    expect(data.screens).toHaveLength(54);
    expect(new Set(data.screens.map((s: { viewUrl: string }) => s.viewUrl)).size).toBe(54);
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(data)).not.toContain(password);

    const catalog = { kitchens: ['NORTH'], brands: [], brandsByKitchen: {}, channels: [], stores: [], workspaceChannels: WORKSPACE_CHANNELS };
    const scope = validScope({ kitchen: 'NORTH', channel: 'uber_eats' }, catalog);
    expect(scope.channel).toBe('uber_eats');
    const wall = screenWallState(data.screens, scope, { s19: 'online' });
    expect(wall.visible).toHaveLength(18);
    expect(wall.visible.find((s) => s.id === 's19')).toMatchObject({ status: 'login_required' });
    expect(wall.ring).toMatchObject({ tone: 'alert', waiting: 3, newlyDown: ['Uber Eats 1'], waitingOn: ['SkipTheDishes 18'] });
    const target = data.screens.find((s: { id: string }) => s.id === 's54');
    const jumpScope = validScope(revealScreenScope(target), catalog);
    expect(screenWallState(data.screens, jumpScope, {}).visible.some((s) => s.id === 's54')).toBe(true);
    const secondHeartbeat = await heartbeatRoute(request('/heartbeat', report, `Bearer ${token}`));
    expect((await secondHeartbeat.json()).commands).toEqual([]);
  });
});
