// Settings → Go-live (MASTER_PLAN Phase 0 item 3): each row says what really works, not merely which key exists.
// Clover needs a merchant that can receive orders; Skip counts through the Food Hub Order Relay, labelled as such;
// SESSION_SECRET is required, long and stable; the outside uptime monitor is shown but never counted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goLiveFacts, sessionSecretCheck, SESSION_SECRET_SEEN_KEY } from '../lib/foodhub/go-live';
import { envCloverMerchants } from '../lib/foodhub/pos/clover';
import { getRepo } from '../lib/foodhub/repo';
import { resetThrottle } from '../lib/foodhub/session';
import { translator } from '../lib/i18n';
import {
  BACK_ONLINE_DOC_URL, cloverStep, goLiveProgress, goLiveSteps, platformStep, sessionSecretStep,
  type ChannelsData, type GoLiveInput, type Store,
} from '../lib/ui/go-live-core';

const en = translator('en');
const fr = translator('fr');
const DAY = 86_400_000;
const STRONG = 'a'.repeat(20) + '-stable-session-secret-0123456789';
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

type Over = Partial<Omit<ChannelsData, 'goLive'>> & { goLive?: Partial<NonNullable<ChannelsData['goLive']>> };
function channels(over: Over = {}): ChannelsData {
  const { goLive, ...rest } = over;
  return {
    mode: 'supabase', publicUrl: 'https://hub.example', liveEnabled: false, dashboardProtected: true,
    clover: { configured: true, missing: [], app: { configured: false, merchants: [] } },
    channels: [
      { channel: 'uber_eats', label: 'Uber Eats', configured: false, canSend: false, missing: ['UBER_CLIENT_ID', 'UBER_CLIENT_SECRET'] },
      { channel: 'doordash', label: 'DoorDash', configured: false, canSend: false, missing: ['DOORDASH_DEVELOPER_ID'] },
      { channel: 'skip', label: 'SkipTheDishes', configured: false, canSend: false, missing: ['SKIP_JET_API_KEY'] },
    ],
    relay: { webhookReady: true, callbackReady: false, channels: ['tgtg'] },
    ...rest,
    goLive: {
      clover: { envMerchantIds: [], tokenMapInvalid: false, injectionEnabled: true },
      sessionSecret: { source: 'env', set: true, strong: true, since: '2026-09-01T12:00:00.000Z', changedAt: null },
      ...goLive,
    },
  };
}
const withApp = (merchants: Array<{ merchantId?: string; status?: string; needsReconnect?: boolean }>, configured = true): Over => ({ clover: { configured: true, missing: ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN'], app: { configured, merchants } } });
const skipStore = (id: string): Store => ({ channel: 'skip', channelStoreId: id, brandName: 'Po Poulet', locationCode: 'NDG' });

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_TOKENS', 'CLOVER_CLIENT_ID', 'CLOVER_CLIENT_SECRET', 'FOODHUB_POS_INJECTION', 'SESSION_SECRET', 'DASHBOARD_PASSWORD', 'LIVE_CONNECTORS_GLOBAL_ENABLED']) vi.stubEnv(k, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Clover merchants with a token in the environment', () => {
  it('counts CLOVER_MERCHANT_ID only with CLOVER_ACCESS_TOKEN, and token-map entries that carry a token', () => {
    expect(envCloverMerchants()).toEqual({ merchants: [], tokenMapInvalid: false });
    vi.stubEnv('CLOVER_ACCESS_TOKEN', 'tok-default');
    expect(envCloverMerchants().merchants).toEqual([]); // a token naming no merchant
    vi.stubEnv('CLOVER_MERCHANT_ID', 'MID1');
    expect(envCloverMerchants().merchants).toEqual(['MID1']);
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ MID1: 'tok-1', MID2: 'tok-2', MID3: '', MID4: null }));
    expect(envCloverMerchants()).toEqual({ merchants: ['MID1', 'MID2'], tokenMapInvalid: false });
    vi.stubEnv('CLOVER_ACCESS_TOKEN', undefined);
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', '{}');
    expect(envCloverMerchants().merchants).toEqual([]); // the app/env "configured" flag is not enough
  });

  it('flags a token map that cannot be read', () => {
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', '{MID1: tok}');
    expect(envCloverMerchants()).toEqual({ merchants: [], tokenMapInvalid: true });
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', '["tok"]');
    expect(envCloverMerchants().tokenMapInvalid).toBe(true);
  });
});

describe('Clover row: done only with a merchant that can receive orders', () => {
  it('the Clover app keys alone are not enough', () => {
    const s = cloverStep(channels(withApp([])), en);
    expect(s.state).toBe('todo');
    expect(s.body).toMatch(/app keys are set, but no merchant is connected/);
    expect(cloverStep(channels(withApp([])), fr).body).toMatch(/aucun marchand n’est branché/);
  });

  it('a merchant waiting for approval or with an expired access does not count', () => {
    expect(cloverStep(channels(withApp([{ status: 'pending' }])), en)).toMatchObject({ state: 'todo', body: expect.stringMatching(/1 merchant\(s\) waiting for your approval/) });
    expect(cloverStep(channels(withApp([{ status: 'active', needsReconnect: true }])), en)).toMatchObject({ state: 'todo', body: expect.stringMatching(/to reconnect/) });
  });

  it('a merchant connected through the app, or an env token, makes it done and says where it comes from', () => {
    expect(cloverStep(channels(withApp([{ status: 'active', needsReconnect: false }])), en)).toMatchObject({ state: 'done', body: expect.stringMatching(/1 merchant\(s\) ready \(1 through the Clover app\)/) });
    const env = cloverStep(channels({ goLive: { clover: { envMerchantIds: ['MID1', 'MID2'], tokenMapInvalid: false, injectionEnabled: true } } }), en);
    expect(env).toMatchObject({ state: 'done', body: expect.stringMatching(/2 merchant\(s\) ready \(2 from the server settings\)/) });
  });

  it('a merchant both in the env and in the app is counted once, and its expired app access does not matter', () => {
    const both = { ...withApp([{ merchantId: 'MID1', status: 'active', needsReconnect: true }, { merchantId: 'MID2', status: 'active', needsReconnect: false }]), goLive: { clover: { envMerchantIds: ['MID1'], tokenMapInvalid: false, injectionEnabled: true } } };
    expect(cloverStep(channels(both), en)).toMatchObject({ state: 'done', body: 'Orders go into the register: 2 merchant(s) ready (1 from the server settings, 1 through the Clover app).' });
  });

  it('one merchant to reconnect next to a working one is still a to-do', () => {
    const s = cloverStep(channels({ ...withApp([{ status: 'active', needsReconnect: true }]), goLive: { clover: { envMerchantIds: ['MID1'], tokenMapInvalid: false, injectionEnabled: true } } }), en);
    expect(s).toMatchObject({ state: 'todo', cta: 'Reconnect' });
  });

  it('says why nothing works: unreadable token map, nothing at all', () => {
    expect(cloverStep(channels({ clover: { configured: false, missing: ['CLOVER_MERCHANT_ID'] }, goLive: { clover: { envMerchantIds: [], tokenMapInvalid: true, injectionEnabled: true } } }), en).body).toMatch(/CLOVER_MERCHANT_TOKENS cannot be read.*Missing: CLOVER_MERCHANT_ID \+ CLOVER_ACCESS_TOKEN/);
  });

  it('injection turned off is optional and never says orders reach the register', () => {
    const s = cloverStep(channels({ goLive: { clover: { envMerchantIds: ['MID1'], tokenMapInvalid: false, injectionEnabled: false } } }), en);
    expect(s.state).toBe('warn');
    expect(s.body).toMatch(/FOODHUB_POS_INJECTION=off/);
    expect(s.body).not.toMatch(/go into the register/);
  });
});

describe('Platform rows: direct, through Clover, or through the Food Hub Order Relay', () => {
  const relaySkip = (over: Over = {}) => channels({ relay: { webhookReady: true, callbackReady: false, channels: ['skip', 'tgtg'] }, ...over });

  it('Skip through the relay with a relay:<id> store is done and labelled as such', () => {
    const s = platformStep('skip', relaySkip(), [skipStore('relay:182304')], en);
    expect(s.state).toBe('done');
    expect(s.title).toBe('SkipTheDishes · Food Hub Order Relay');
    expect(s.body).toMatch(/come through the Food Hub Order Relay: 1 store\(s\) mapped \(relay:<id>\)/);
    expect(platformStep('skip', relaySkip(), [skipStore('relay:182304')], fr).title).toBe('SkipTheDishes · relais de commandes Food Hub');
  });

  it('through the relay without a relay store, or without the relay address, is still a to-do', () => {
    expect(platformStep('skip', relaySkip(), [skipStore('jet-1234')], en)).toMatchObject({ state: 'todo', href: '/stores/mapping', body: expect.stringMatching(/no store mapped as relay:<id>/) });
    const noSecret = relaySkip({ relay: { webhookReady: false, callbackReady: false, channels: ['skip'] } });
    expect(platformStep('skip', noSecret, [skipStore('relay:1')], en)).toMatchObject({ state: 'todo', body: expect.stringMatching(/FOODHUB_RELAY_SECRET/) });
  });

  it('a relay store does not make the direct connection count', () => {
    const direct = channels({ channels: [{ channel: 'skip', label: 'SkipTheDishes', configured: true, canSend: true, missing: [] }] });
    expect(platformStep('skip', direct, [skipStore('relay:1')], en)).toMatchObject({ state: 'todo', body: 'Connected, but no store mapped.' });
    expect(platformStep('skip', direct, [skipStore('relay:1'), skipStore('jet-1')], en)).toMatchObject({ state: 'done', body: '1 store(s) mapped.' });
  });

  it('direct keys AND the relay for the same platform is flagged (each order would come in twice)', () => {
    const both = relaySkip({ channels: [{ channel: 'skip', label: 'SkipTheDishes', configured: true, canSend: true, missing: [] }] });
    expect(platformStep('skip', both, [skipStore('jet-1'), skipStore('relay:1')], en)).toMatchObject({ state: 'todo', body: expect.stringMatching(/come in twice/) });
  });

  it('nothing set: missing keys, with the relay as the way out for Skip; linked through Clover stays done', () => {
    expect(platformStep('skip', channels(), [], en).body).toBe('Missing: SKIP_JET_API_KEY Or: a partner sends Skip orders through the Food Hub Order Relay (FOODHUB_RELAY_CHANNELS=skip,tgtg).');
    expect(platformStep('uber_eats', channels(), [], en).body).toBe('Missing: UBER_CLIENT_ID, UBER_CLIENT_SECRET');
    const via = channels({ channels: [{ channel: 'doordash', label: 'DoorDash', configured: false, canSend: false, missing: [], viaClover: true }] });
    expect(platformStep('doordash', via, [], en).state).toBe('done');
  });
});

describe('SESSION_SECRET row: required, long and stable', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const secret = (s: Partial<NonNullable<ChannelsData['goLive']>['sessionSecret']>) => channels({ goLive: { sessionSecret: { source: 'env', set: true, strong: true, since: '2026-09-01T12:00:00.000Z', changedAt: null, ...s } } });

  it('missing is a to-do, whatever signs sessions meanwhile', () => {
    const derived = sessionSecretStep(secret({ source: 'password', set: false, strong: false, since: null }), en, now);
    expect(derived).toMatchObject({ state: 'todo', key: 'session-secret' });
    expect(derived.body).toMatch(/derived from DASHBOARD_PASSWORD.*signs everyone out/);
    expect(sessionSecretStep(secret({ source: 'dev', set: false, strong: false, since: null }), en, now).state).toBe('todo');
    expect(sessionSecretStep(secret({ source: 'password', set: false, strong: false }), fr, now).body).toMatch(/Manque/);
  });

  it('too short is a to-do; set, long and unchanged is done', () => {
    expect(sessionSecretStep(secret({ strong: false, since: null }), en, now)).toMatchObject({ state: 'todo', body: expect.stringMatching(/under 32 characters/) });
    expect(sessionSecretStep(secret({}), en, now)).toMatchObject({ state: 'done', body: expect.stringMatching(/unchanged since September 1, 2026/) });
  });

  it('a change in the last 7 days is pointed out, then forgotten', () => {
    expect(sessionSecretStep(secret({ changedAt: new Date(now - 2 * DAY).toISOString() }), en, now)).toMatchObject({ state: 'warn', body: expect.stringMatching(/new one at each deploy/) });
    expect(sessionSecretStep(secret({ changedAt: new Date(now - 8 * DAY).toISOString() }), en, now).state).toBe('done');
  });

  it('the server keeps a fingerprint (never the secret) and notices a different one', async () => {
    vi.stubEnv('SESSION_SECRET', STRONG);
    const first = await sessionSecretCheck(new Date('2026-10-01T10:00:00Z'));
    expect(first).toMatchObject({ source: 'env', set: true, strong: true, since: '2026-10-01T10:00:00.000Z', changedAt: null });
    expect(await sessionSecretCheck(new Date('2026-10-05T10:00:00Z'))).toMatchObject({ since: '2026-10-01T10:00:00.000Z', changedAt: null });
    const stored = JSON.stringify(await getRepo().getKv(SESSION_SECRET_SEEN_KEY));
    expect(stored).not.toContain(STRONG);
    expect(stored).not.toContain('stable-session-secret');
    vi.stubEnv('SESSION_SECRET', `${STRONG}-new`);
    expect(await sessionSecretCheck(new Date('2026-10-06T10:00:00Z'))).toMatchObject({ since: '2026-10-06T10:00:00.000Z', changedAt: '2026-10-06T10:00:00.000Z' });
    expect(await sessionSecretCheck(new Date('2026-10-07T10:00:00Z'))).toMatchObject({ changedAt: '2026-10-06T10:00:00.000Z' });
  });

  it('a short or missing secret is reported without keeping anything; a database error still answers', async () => {
    vi.stubEnv('SESSION_SECRET', 'short');
    expect(await sessionSecretCheck()).toMatchObject({ set: true, strong: false, since: null });
    vi.stubEnv('SESSION_SECRET', undefined);
    vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-123');
    expect(await sessionSecretCheck()).toMatchObject({ source: 'password', set: false });
    expect(await getRepo().getKv(SESSION_SECRET_SEEN_KEY)).toBeNull();
    vi.stubEnv('SESSION_SECRET', STRONG);
    vi.spyOn(getRepo(), 'getKv').mockRejectedValueOnce(new Error('Supabase: down'));
    expect(await sessionSecretCheck()).toMatchObject({ set: true, strong: true, since: null, changedAt: null });
  });
});

describe('the whole checklist', () => {
  const input = (ch: ChannelsData): GoLiveInput => ({
    channels: ch, notify: { email: true, sms: true, call: true, chat: true, ai: true },
    users: [{ username: 'o', name: 'Owner', role: 'owner', locations: [], email: 'o@example.com', phone: '+15145550000', active: true, hasPin: true }],
    devices: [{ id: 'd1', locationCode: 'NDG', status: 'online' }], stores: [skipStore('relay:1')], fees: { confirmed: { uber_eats: true, doordash: true, skip: true } },
    catalog: [{ code: 'NDG', name: 'NDG — Monkland', phone: '5145550000', active: true }], cloverCheck: { report: null }, locations: [{ code: 'NDG', name: 'NDG — Monkland' }],
    now: Date.parse('2026-10-07T12:00:00.000Z'),
  });

  it('has the password and SESSION_SECRET as two required rows, and the uptime monitor as an uncounted info row', () => {
    const steps = goLiveSteps(input(channels({ dashboardProtected: false, goLive: { sessionSecret: { source: 'password', set: false, strong: false, since: null, changedAt: null } } })), en);
    expect(steps.find((s) => s.key === 'secret')).toMatchObject({ state: 'todo', title: 'Recovery password (DASHBOARD_PASSWORD)' });
    expect(steps.find((s) => s.key === 'session-secret')).toMatchObject({ state: 'todo', group: 'Foundations' });
    const uptime = steps.find((s) => s.key === 'uptime')!;
    expect(uptime).toMatchObject({ state: 'info', external: true, href: BACK_ONLINE_DOC_URL, group: 'Opening' });
    expect(uptime.body).toMatch(/https:\/\/hub\.example\/api\/health/);
    expect(uptime.body).toMatch(/BACK_ONLINE_TODAY\.md, Part B step 10/);
    expect(steps.map((s) => s.key).slice(-2)).toEqual(['uptime', 'live']);
    const p = goLiveProgress(steps);
    expect(p.total).toBe(steps.length - 1);
    expect(p.done + p.todo + p.optional).toBe(p.total);
  });

  it('reaches 100 % with the uptime row still informational', () => {
    const ch = channels({
      liveEnabled: true,
      clover: { configured: true, missing: [] }, // no Clover App Market app on this server (its rows are optional)
      channels: [
        { channel: 'uber_eats', label: 'Uber Eats', configured: false, canSend: false, missing: [], viaClover: true },
        { channel: 'doordash', label: 'DoorDash', configured: false, canSend: false, missing: [], viaClover: true },
        { channel: 'skip', label: 'SkipTheDishes', configured: false, canSend: false, missing: ['SKIP_JET_API_KEY'] },
      ],
      relay: { webhookReady: true, callbackReady: false, channels: ['skip', 'tgtg'] },
      goLive: { clover: { envMerchantIds: ['MID1'], tokenMapInvalid: false, injectionEnabled: true } },
    });
    const steps = goLiveSteps(input(ch), en);
    expect(steps.filter((s) => s.state !== 'done' && s.state !== 'info').map((s) => s.key)).toEqual([]);
    const p = goLiveProgress(steps);
    expect(p.done).toBe(p.total);
    expect(steps.find((s) => s.key === 'skip')!.title).toMatch(/Food Hub Order Relay/);
  });

  it('every row is translated', () => {
    const ch = channels({ dashboardProtected: false, mode: 'memory', goLive: { sessionSecret: { source: 'password', set: false, strong: false, since: null, changedAt: null } } });
    const a = goLiveSteps(input(ch), fr);
    const b = goLiveSteps(input(ch), en);
    expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key));
    for (let i = 0; i < a.length; i++) { expect(a[i].body).not.toBe(b[i].body); expect(a[i].cta).toBeTruthy(); }
  });
});

describe('GET /api/foodhub/channels carries the go-live facts, never a secret', () => {
  it('counts env merchants and reports SESSION_SECRET without its value', async () => {
    vi.stubEnv('DASHBOARD_PASSWORD', 'Owner-pass-123');
    vi.stubEnv('SESSION_SECRET', STRONG);
    vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ MIDA: 'clover-token-aaa', MIDB: 'clover-token-bbb' }));
    resetThrottle();
    const { GET } = await import('../app/api/foodhub/channels/route');
    const res = await GET(new Request('http://hub.local/api/foodhub/channels', { headers: { authorization: basic('owner', 'Owner-pass-123') } }), {});
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.goLive).toEqual(await goLiveFacts());
    expect(body.goLive.clover).toEqual({ envMerchantIds: ['MIDA', 'MIDB'], tokenMapInvalid: false, injectionEnabled: true, unreachableStores: [] });
    expect(body.goLive.sessionSecret).toMatchObject({ source: 'env', set: true, strong: true, changedAt: null });
    expect(raw).not.toContain('clover-token-');
    expect(raw).not.toContain(STRONG);
  });
});
