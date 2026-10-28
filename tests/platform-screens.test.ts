// Platform screens: the relay host's Uber Eats / DoorDash order screens inside Food Hub (docs/PLATFORM_SCREENS.md).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../lib/foodhub/activity';
import {
  addScreen, agentAuthorized, checkViewUrl, getScreen, listScreens, recordHeartbeat, removeScreen, requestReload, SCREEN_OFFLINE_AFTER_MS,
  screenStatus, titleCount, updateScreen, type PlatformScreen,
} from '../lib/foodhub/screens';
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
