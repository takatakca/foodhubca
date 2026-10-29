// Platform screens: the relay host's Uber Eats / DoorDash order screens inside Food Hub (docs/PLATFORM_SCREENS.md).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../lib/foodhub/activity';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import {
  addScreen, agentAuthorized, allowedScreenUrl, checkViewUrl, cleanStoreIds, getScreen, listScreens, nextWaitingSince, orderPaths, protectedStoreIds,
  recordHeartbeat, removeScreen, requestOpen, requestReload, SCREEN_OFFLINE_AFTER_MS, screenStartUrl, screenStatus, setupScreens, titleCount, updateScreen,
  getSharedWall, saveSharedWall, type PlatformScreen,
} from '../lib/foodhub/screens';
import { listIncidents, runWatch } from '../lib/foodhub/watch/engine';
import { POST as heartbeatRoute } from '../app/api/foodhub/screens/heartbeat/route';

const ACTOR: Actor = { username: 'owner', name: 'Owner', source: 'dashboard' };
const TOKEN = 'a'.repeat(32);
const hbReq = (body: unknown, auth?: string) => new Request('http://hub.local/api/foodhub/screens/heartbeat', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body),
});

async function newScreen(): Promise<PlatformScreen> {
  const s = await addScreen({ name: 'Uber St-Léonard', platform: 'ubereats', locationCode: 'SAINT_LEONARD', viewUrl: 'https://screens.example.ca/uber-1/' }, ACTOR);
  if ('error' in s) throw new Error(s.error);
  return s;
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_SCREENS_AGENT_TOKEN = TOKEN;
});

describe('view address', () => {
  it('accepts https and refuses credentials, plain http and junk', () => {
    expect(checkViewUrl('https://screens.example.ca/uber-1/')).toEqual({ url: 'https://screens.example.ca/uber-1/' });
    expect(checkViewUrl('http://localhost:3101/')).toEqual({ url: 'http://localhost:3101/' });
    expect('error' in checkViewUrl('https://user:pass@screens.example.ca/')).toBe(true);
    expect('error' in checkViewUrl('https://user@screens.example.ca/')).toBe(true);
    expect('error' in checkViewUrl('http://screens.example.ca/')).toBe(true);
    expect('error' in checkViewUrl('javascript:alert(1)')).toBe(true);
    expect('error' in checkViewUrl('')).toBe(true);
    expect('error' in checkViewUrl('not a url')).toBe(true);
  });
});

describe('screens', () => {
  it('adds, edits, lists and removes; refuses an unknown platform or a bad address', async () => {
    const s = await newScreen();
    expect(s.platform).toBe('ubereats');
    expect(screenStatus(s)).toBe('never');
    expect(await addScreen({ platform: 'grubhub', locationCode: 'X', viewUrl: 'https://a.b/' }, ACTOR)).toHaveProperty('error');
    expect(await updateScreen(s.id, { viewUrl: 'https://u:p@a.b/' }, ACTOR)).toHaveProperty('error');
    const u = await updateScreen(s.id, { name: 'Uber 1', platform: 'doordash' }, ACTOR);
    expect(u && !('error' in u) && u.platform).toBe('doordash');
    expect((await listScreens()).map((x) => x.name)).toEqual(['Uber 1']);
    expect(await removeScreen(s.id, ACTOR)).toBe(true);
    expect(await listScreens()).toEqual([]);
  });

  it('status follows the heartbeat: online, sign-in needed, crashed, offline after 120 s', () => {
    const now = Date.parse('2026-10-28T18:00:00Z');
    const base = { id: 'x', name: 'x', platform: 'ubereats', locationCode: 'L', viewUrl: 'https://a.b/', createdBy: 'o', createdAt: '' } as PlatformScreen;
    const seen = new Date(now - 10_000).toISOString();
    expect(screenStatus({ ...base, lastSeenAt: seen, state: 'ok' }, now)).toBe('online');
    expect(screenStatus({ ...base, lastSeenAt: seen, state: 'login' }, now)).toBe('login_required');
    expect(screenStatus({ ...base, lastSeenAt: seen, state: 'crashed' }, now)).toBe('error');
    expect(screenStatus({ ...base, lastSeenAt: seen, state: 'blank' }, now)).toBe('error');
    expect(screenStatus({ ...base, lastSeenAt: new Date(now - SCREEN_OFFLINE_AFTER_MS - 1).toISOString(), state: 'ok' }, now)).toBe('offline');
  });

  it('reads the waiting count platforms put first in the page title', () => {
    expect(titleCount('(3) Orders')).toBe(3);
    expect(titleCount(' (12+) Uber Eats Orders')).toBe(12);
    expect(titleCount('Orders')).toBeNull();
    expect(titleCount(null)).toBeNull();
  });
});

describe('relay agent heartbeat', () => {
  it('needs the exact Bearer token, and is off while the token is unset or too short', async () => {
    const ok = new Request('http://h/', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(agentAuthorized(ok)).toBe(true);
    expect(agentAuthorized(new Request('http://h/', { headers: { authorization: `Bearer ${TOKEN}x` } }))).toBe(false);
    expect(agentAuthorized(new Request('http://h/'))).toBe(false);
    process.env.FOODHUB_SCREENS_AGENT_TOKEN = 'short';
    expect(agentAuthorized(new Request('http://h/', { headers: { authorization: 'Bearer short' } }))).toBe(false);
    expect((await heartbeatRoute(hbReq({ screens: [] }, 'Bearer short'))).status).toBe(503);
    delete process.env.FOODHUB_SCREENS_AGENT_TOKEN;
    expect((await heartbeatRoute(hbReq({ screens: [] }, `Bearer ${TOKEN}`))).status).toBe(503);
  });

  it('route: 401 without the token, 400 on a bad body, saves state and title', async () => {
    const s = await newScreen();
    expect((await heartbeatRoute(hbReq({ screens: [{ id: s.id, state: 'ok' }] }))).status).toBe(401);
    expect((await heartbeatRoute(hbReq({ screens: [{ id: s.id, state: 'dancing' }] }, `Bearer ${TOKEN}`))).status).toBe(400);
    const res = await heartbeatRoute(hbReq({ version: 'agent-1.0.0', screens: [{ id: s.id, state: 'ok', title: '(2) Orders', url: 'https://merchants.ubereats.com/manager/orders?x=1', autoReloads: 1 }, { id: 'nope', state: 'ok' }] }, `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unknown).toEqual(['nope']);
    const saved = await getScreen(s.id);
    expect(saved).toMatchObject({ state: 'ok', pageTitle: '(2) Orders', pageHost: 'merchants.ubereats.com', titleCount: 2, autoReloads: 1, agentVersion: 'agent-1.0.0' });
    expect(screenStatus(saved!)).toBe('online');
  });

  it('hands a reload command to the agent exactly once', async () => {
    const s = await newScreen();
    await requestReload(s.id, ACTOR);
    expect((await getScreen(s.id))?.command?.kind).toBe('reload');
    const first = await recordHeartbeat({ screens: [{ id: s.id, state: 'ok' }] });
    expect(first.commands).toEqual([{ id: s.id, kind: 'reload' }]);
    const second = await recordHeartbeat({ screens: [{ id: s.id, state: 'ok' }] });
    expect(second.commands).toEqual([]);
  });

  it('a signed-out screen reports login_required', async () => {
    const s = await newScreen();
    await recordHeartbeat({ screens: [{ id: s.id, state: 'login', url: 'https://auth.uber.com/v2/' }] });
    expect(screenStatus((await getScreen(s.id))!)).toBe('login_required');
  });
});

describe('heartbeat v2 (Android mode, waiting count) — docs/ORDER_SCREENS_RESCUE.md', () => {
  it('a v1 report is web mode; an Android report keeps the package in front and uses the waiting count', async () => {
    const s = await newScreen();
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok', title: 'Orders' }] });
    expect(await getScreen(s.id)).toMatchObject({ mode: 'web', app: null, titleCount: null, waitingSince: null });
    await recordHeartbeat({ version: 'android-1.0.0', screens: [{ id: s.id, state: 'ok', mode: 'android', app: 'com.example.orders', waiting: 2 }] });
    const a = await getScreen(s.id);
    expect(a).toMatchObject({ mode: 'android', app: 'com.example.orders', titleCount: 2, pageTitle: null, pageHost: null });
    expect(a?.waitingSince).toBeTruthy();
    // A web report never keeps a package, even if one is sent.
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok', mode: 'web', app: 'com.example.orders', title: '(1) Orders' }] });
    expect(await getScreen(s.id)).toMatchObject({ mode: 'web', app: null, titleCount: 1 });
  });

  it('the title count wins over the waiting field; bad v2 fields are refused by the route', async () => {
    const s = await newScreen();
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok', title: '(3) Orders', waiting: 9 }] });
    expect((await getScreen(s.id))?.titleCount).toBe(3);
    const bad = [{ mode: 'ios' }, { app: 'not a package; rm -rf' }, { waiting: -1 }, { waiting: 5000 }];
    for (const extra of bad) {
      expect((await heartbeatRoute(hbReq({ screens: [{ id: s.id, state: 'ok', ...extra }] }, `Bearer ${TOKEN}`))).status).toBe(400);
    }
  });

  it('waiting since: set when orders appear, kept while they stay or grow, restarted when one is answered, cleared at 0', () => {
    const t0 = new Date('2026-10-29T20:00:00Z');
    const t1 = new Date('2026-10-29T20:01:00Z');
    expect(nextWaitingSince({ titleCount: 0, waitingSince: null }, 0, t0)).toBeNull();
    expect(nextWaitingSince({ titleCount: null, waitingSince: null }, 1, t0)).toBe(t0.toISOString());
    expect(nextWaitingSince({ titleCount: 1, waitingSince: t0.toISOString() }, 1, t1)).toBe(t0.toISOString());
    expect(nextWaitingSince({ titleCount: 1, waitingSince: t0.toISOString() }, 2, t1)).toBe(t0.toISOString());
    expect(nextWaitingSince({ titleCount: 2, waitingSince: t0.toISOString() }, 1, t1)).toBe(t1.toISOString());
    expect(nextWaitingSince({ titleCount: 2, waitingSince: t0.toISOString() }, null, t1)).toBeNull();
  });
});

describe('stores shown by a screen', () => {
  it('parses ids, refuses junk, and flags Po Poulet NDG (DoorDash 27982486) as never-act', async () => {
    expect(cleanStoreIds('28040070, 33598081 28040070')).toEqual({ ids: ['28040070', '33598081'] });
    expect(cleanStoreIds(['27870472'])).toEqual({ ids: ['27870472'] });
    expect(cleanStoreIds('')).toEqual({ ids: [] });
    expect(cleanStoreIds('123 <script>')).toHaveProperty('error');
    expect(cleanStoreIds(Array.from({ length: 31 }, (_, i) => String(i)))).toHaveProperty('error');
    const s = await addScreen({ platform: 'doordash', locationCode: 'NDG_6284', viewUrl: 'https://screens.example.ca/dd-1/', storeIds: '28040070, 27982486' }, ACTOR);
    if ('error' in s) throw new Error(s.error);
    expect(s.storeIds).toEqual(['28040070', '27982486']);
    expect(protectedStoreIds(s)).toEqual(['27982486']);
    expect(await updateScreen(s.id, { storeIds: 'bad id!' }, ACTOR)).toHaveProperty('error');
    const u = await updateScreen(s.id, { storeIds: ['28040070'] }, ACTOR);
    expect(u && !('error' in u) && protectedStoreIds(u)).toEqual([]);
  });
});

describe('Watchtower: orders waiting on a screen (screen_waiting)', () => {
  async function waitingFor(sec: number, opts: { hours?: boolean; count?: number } = {}) {
    (globalThis as any).__foodhubMem = undefined;
    if (opts.hours !== false) await saveHours({ locations: { NDG_6284: allDayWeek() }, brands: {}, holidays: [] });
    const s = await addScreen({ name: 'DoorDash NDG', platform: 'doordash', locationCode: 'NDG_6284', viewUrl: 'https://screens.example.ca/dd-1/' }, ACTOR);
    if ('error' in s) throw new Error(s.error);
    const now = Date.now();
    const count = opts.count ?? 2;
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok', title: `(${count}) Orders` }] }, new Date(now - sec * 1000));
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok', title: `(${count}) Orders` }] }, new Date(now - 5_000));
    await runWatch({ force: true, now });
    return (await listIncidents({ status: ['open'] })).filter((i) => i.kind === 'screen_waiting');
  }

  it('orders unanswered past the "order waiting" delay during opening hours → critical incident', async () => {
    const found = await waitingFor(180);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'screen_waiting', severity: 'critical', locationCode: 'NDG_6284' });
    expect(found[0].titleEn).toMatch(/2 order\(s\) waiting on DoorDash “DoorDash NDG”/);
  });

  it('a short wait, no waiting order, or a closed location → no incident', async () => {
    expect(await waitingFor(20)).toHaveLength(0);
    expect(await waitingFor(600, { count: 0 })).toHaveLength(0);
    expect(await waitingFor(600, { hours: false })).toHaveLength(0);
  });
});

describe('screens wall: when the one device rings', () => {
  it('rings "order" while orders wait on an online screen, "alert" when a screen drops, nothing otherwise', async () => {
    const { ringDecision } = await import('../lib/ui/screens-ring');
    const a = { id: 'a', name: 'Uber NDG', status: 'online', titleCount: 0 };
    const b = { id: 'b', name: 'DoorDash NDG', status: 'online', titleCount: 2 };
    let r = ringDecision([a, { ...b, titleCount: 0 }], {});
    expect(r).toMatchObject({ tone: null, waiting: 0, newlyDown: [] });
    r = ringDecision([a, b], r.memory);
    expect(r).toMatchObject({ tone: 'order', waiting: 2, waitingOn: ['DoorDash NDG'] });
    r = ringDecision([{ ...a, status: 'offline' }, b], r.memory);
    expect(r).toMatchObject({ tone: 'alert', newlyDown: ['Uber NDG'], waiting: 2 });
    // Still down at the next refresh: no new alert (the Watchtower keeps escalating), the waiting order still rings.
    r = ringDecision([{ ...a, status: 'offline' }, b], r.memory);
    expect(r).toMatchObject({ tone: 'order', newlyDown: [] });
    // A count on a screen that is not online is not trusted.
    expect(ringDecision([{ ...b, status: 'login_required' }], {}).waiting).toBe(0);
  });
});

describe('numbered screens and the open command (contract v2.1)', () => {
  it('start pages are the platforms\' own https sites; anything else is never sent', () => {
    expect(screenStartUrl('doordash', {})).toBe('https://order.doordash.com/');
    expect(screenStartUrl('ubereats', {})).toBe('https://merchants.ubereats.com/manager/orders');
    expect(screenStartUrl('skip', {})).toBe('https://restaurants.skipthedishes.com/');
    expect(screenStartUrl('other', {})).toBeNull();
    expect(screenStartUrl('skip', { FOODHUB_SCREEN_START_SKIP: 'https://partner.skipthedishes.com/orders' })).toBe('https://partner.skipthedishes.com/orders');
    expect(screenStartUrl('doordash', { FOODHUB_SCREEN_START_DOORDASH: 'https://evil.example/doordash.com' })).toBeNull();
    expect(allowedScreenUrl('https://merchant-portal.doordash.com/x')).toBe(true);
    expect(allowedScreenUrl('http://order.doordash.com/')).toBe(false);
    expect(allowedScreenUrl('https://doordash.com.evil.example/')).toBe(false);
    expect(allowedScreenUrl('https://user:pw@order.doordash.com/')).toBe(false);
  });

  it('sets up s01… with so many DoorDash, Uber Eats and Skip, each opening its sign-in page; a second run keeps them', async () => {
    const r = await setupScreens({ baseUrl: 'https://screens.example.ca', locationCode: 'NDG_6284', counts: { doordash: 8, ubereats: 6, skip: 4 } }, ACTOR);
    if ('error' in r) throw new Error(r.error);
    expect(r.created.map((x) => x.id)).toEqual(Array.from({ length: 18 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`));
    const s1 = await getScreen('s01');
    expect(s1).toMatchObject({ platform: 'doordash', name: 'DoorDash 1', viewUrl: 'https://screens.example.ca/s01/' });
    expect(s1?.command).toMatchObject({ kind: 'open', url: 'https://order.doordash.com/' });
    expect(await getScreen('s09')).toMatchObject({ platform: 'ubereats', name: 'Uber Eats 1' });
    expect(await getScreen('s18')).toMatchObject({ platform: 'skip', name: 'SkipTheDishes 4', viewUrl: 'https://screens.example.ca/s18/' });
    // The agent with SCREEN_ID=s01 gets the open command once, with the URL.
    const hb = await recordHeartbeat({ screens: [{ id: 's01', state: 'blank' }] });
    expect(hb).toEqual({ commands: [{ id: 's01', kind: 'open', url: 'https://order.doordash.com/' }], unknown: [] });
    expect((await recordHeartbeat({ screens: [{ id: 's01', state: 'login' }] })).commands).toEqual([]);
    const again = await setupScreens({ baseUrl: 'https://screens.example.ca/', locationCode: 'NDG_6284', counts: { doordash: 20 } }, ACTOR);
    if ('error' in again) throw new Error(again.error);
    expect(again.kept).toHaveLength(18);
    expect(again.created.map((x) => x.id)).toEqual(['s19', 's20']);
    expect(await setupScreens({ baseUrl: 'https://u:p@x.ca', locationCode: 'NDG_6284', counts: { doordash: 1 } }, ACTOR)).toHaveProperty('error');
    expect(await setupScreens({ baseUrl: 'https://x.ca', locationCode: 'NDG_6284', counts: {} }, ACTOR)).toHaveProperty('error');
    expect(await setupScreens({ baseUrl: 'https://x.ca', locationCode: 'NDG_6284', counts: { doordash: 40 } }, ACTOR)).toHaveProperty('error');
  });

  it('switching a screen\'s channel opens the new platform\'s page; "Sign-in page" asks it again', async () => {
    const s = await newScreen();
    const u = await updateScreen(s.id, { platform: 'skip' }, ACTOR);
    expect(u && !('error' in u) && u.command).toMatchObject({ kind: 'open', url: 'https://restaurants.skipthedishes.com/' });
    await recordHeartbeat({ screens: [{ id: s.id, state: 'ok' }] });
    const o = await requestOpen(s.id, ACTOR);
    expect(o && !('error' in o) && o.command?.url).toBe('https://restaurants.skipthedishes.com/');
    const other = await updateScreen(s.id, { platform: 'other' }, ACTOR);
    expect(other && !('error' in other) && other.platform).toBe('other');
    expect(await requestOpen(s.id, ACTOR)).toHaveProperty('error');
  });

  it('order paths say how each platform\'s orders reach Clover', async () => {
    const paths = await orderPaths();
    expect(paths.map((p) => p.platform)).toEqual(['doordash', 'ubereats', 'skip']);
    for (const p of paths) expect(['via_clover', 'direct', 'none']).toContain(p.mode);
  });
});

describe('screens wall layouts', () => {
  it('grid views, order, pages', async () => {
    const L = await import('../lib/ui/screens-layout');
    expect(L.GRID_VIEWS.map((v) => L.gridShape(v))).toEqual([
      { cols: 1, rows: 1 }, { cols: 2, rows: 1 }, { cols: 2, rows: 2 }, { cols: 4, rows: 2 }, { cols: 4, rows: 3 }, { cols: 4, rows: 4 },
    ]);
    const ids = Array.from({ length: 18 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    expect(L.orderIds(['a', 'b', 'c'], ['c', 'gone', 'a', 'c'])).toEqual(['c', 'a', 'b']);
    expect(L.moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(L.moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(L.moveId(['a', 'b'], 'a', 'zz')).toEqual(['a', 'b']);
    expect(L.pageCount(18, 16)).toBe(2);
    expect(L.pageSlice(ids, 16, 1)).toEqual(['s17', 's18']);
    expect(L.pageSlice(ids, 16, 9)).toEqual(['s17', 's18']); // past the end → last page
    expect(L.pageSlice(ids, 4, -3)).toEqual(['s01', 's02', 's03', 's04']);
  });

  it('custom board: even first layout, drag and resize stay inside 12 × 12, moved tile comes to the front', async () => {
    const L = await import('../lib/ui/screens-layout');
    const ids = Array.from({ length: 18 }, (_, i) => `s${i + 1}`);
    const board = L.defaultCustom(ids);
    expect(board).toHaveLength(18);
    for (const t of board) {
      expect(t.x + t.w).toBeLessThanOrEqual(12);
      expect(t.y + t.h).toBeLessThanOrEqual(12);
      expect(t.w).toBeGreaterThanOrEqual(2);
    }
    let tiles = L.changeTile(board, 's1', { dx: 50, dy: -50 });
    expect(tiles.at(-1)).toMatchObject({ id: 's1', x: 12 - board[0].w, y: 0 });
    tiles = L.changeTile(tiles, 's1', { dw: -10, dh: 100 });
    expect(tiles.at(-1)).toMatchObject({ w: 2, h: 12, y: 0 });
    tiles = L.removeTile(tiles, 's2');
    expect(tiles.some((t) => t.id === 's2')).toBe(false);
    tiles = L.addTile(tiles, 's2');
    expect(tiles.at(-1)).toEqual({ id: 's2', x: 4, y: 4, w: 4, h: 4 });
    expect(L.addTile(tiles, 's2')).toBe(tiles);
  });

  it('reads what the device saved, and falls back on anything odd', async () => {
    const L = await import('../lib/ui/screens-layout');
    expect(L.parseWall(null)).toEqual(L.DEFAULT_WALL);
    expect(L.parseWall('{oops')).toEqual(L.DEFAULT_WALL);
    expect(L.parseWall(JSON.stringify({ view: '99', page: -2, order: ['s01', 5], custom: [{ id: 's01', x: 20, y: 0, w: 1, h: 3 }, { id: 'bad' }] })))
      .toEqual({ view: '4', page: 0, order: ['s01'], tab: null, custom: [{ id: 's01', x: 10, y: 0, w: 2, h: 3 }] });
    expect(L.parseWall(JSON.stringify({ view: 'custom', tab: 's03' }))).toMatchObject({ view: 'custom', tab: 's03' });
  });
});

describe('wall layout shared with every device', () => {
  it('saves a cleaned layout with who shared it; nothing shared → null', async () => {
    expect(await getSharedWall()).toBeNull();
    const saved = await saveSharedWall({ view: 'custom', order: ['s02', 's01'], custom: [{ id: 's01', x: 30, y: 0, w: 4, h: 4 }], junk: true }, ACTOR);
    expect(saved).toEqual({ view: 'custom', page: 0, order: ['s02', 's01'], tab: null, custom: [{ id: 's01', x: 8, y: 0, w: 4, h: 4 }] });
    expect(await getSharedWall()).toMatchObject({ view: 'custom', order: ['s02', 's01'], savedBy: 'Owner' });
    expect(await saveSharedWall('not json', ACTOR)).toMatchObject({ view: '4', custom: [] });
  });
});
