// RC10.2 — Clover App Market app: OAuth v2 connect, token refresh, uninstall, token lookup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveCloverMerchant, cloverOAuthToken, cloverWebUrl, finishCloverConnect, handleCloverAppEvents, listCloverConnections, startCloverConnect,
} from '../lib/foodhub/pos/clover-oauth';
import { allCloverMerchants, cloverReadiness, cloverToken } from '../lib/foodhub/pos/clover';

const MID = 'YJ4W50YPJQSQ1';
const realFetch = globalThis.fetch;
type Call = { url: string; body: any };
let calls: Call[] = [];
let tokenSeq = 0;

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const now = Math.floor(Date.now() / 1000);
    if (url.endsWith('/oauth/v2/token')) {
      if (body?.code !== 'GOOD-CODE' || body?.client_secret !== 'app-secret-test') return json(400, { message: 'invalid code' });
      tokenSeq++;
      return json(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    if (url.endsWith('/oauth/v2/refresh')) {
      if (!String(body?.refresh_token || '').startsWith('RT-')) return json(401, {});
      tokenSeq++;
      return json(200, { access_token: `AT-${tokenSeq}`, access_token_expiration: now + 1800, refresh_token: `RT-${tokenSeq}`, refresh_token_expiration: now + 86400 * 30 });
    }
    if (url.endsWith(`/v3/merchants/${MID}`)) return json(200, { id: MID, name: 'On2GO.CA' });
    return json(404, {});
  }) as any;
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_CLIENT_ID = '629HFYHNVMZYR';
  process.env.CLOVER_CLIENT_SECRET = 'app-secret-test';
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.FOODHUB_PUBLIC_URL = 'https://foodhub.example';
  delete process.env.CLOVER_ACCESS_TOKEN; delete process.env.CLOVER_MERCHANT_ID; delete process.env.CLOVER_MERCHANT_TOKENS; delete process.env.CLOVER_WEB_URL;
  process.env.CLOVER_ALLOWED_MERCHANTS = MID; // the owner's own merchant: trusted when it opens the app from Clover
  calls = []; tokenSeq = 0;
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Clover app connection (OAuth v2)', () => {
  it('builds the authorize URL on the right Clover site with the Food Hub callback', async () => {
    const url = new URL(await startCloverConnect('Owner'));
    expect(url.origin).toBe('https://www.clover.com');
    expect(url.pathname).toBe('/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('629HFYHNVMZYR');
    expect(url.searchParams.get('redirect_uri')).toBe('https://foodhub.example/api/foodhub/clover-connect/callback');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{36}$/);
    process.env.CLOVER_BASE_URL = 'https://apisandbox.dev.clover.com';
    expect(cloverWebUrl()).toBe('https://sandbox.dev.clover.com');
  });

  it('connects a merchant launched from Clover (no state), stores tokens and never lists them', async () => {
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: '629HFYHNVMZYR' });
    expect(r).toEqual({ ok: true, merchantId: MID, name: 'On2GO.CA', pending: false });
    const tokenCall = calls.find((c) => c.url.endsWith('/oauth/v2/token'));
    expect(tokenCall?.body).toEqual({ client_id: '629HFYHNVMZYR', client_secret: 'app-secret-test', code: 'GOOD-CODE' });
    const list = await listCloverConnections();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('On2GO.CA');
    expect(JSON.stringify(list)).not.toMatch(/AT-|RT-/);
    expect(await cloverToken(MID)).toBe('AT-1');
    expect(await allCloverMerchants([])).toContain(MID);
    expect(cloverReadiness().configured).toBe(true);
  });

  it('rejects a wrong app, a bad merchant id, a reused state and a refused code', async () => {
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: 'OTHERAPP' })).ok).toBe(false);
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: 'x' })).ok).toBe(false);
    expect((await finishCloverConnect({ code: 'BAD', merchantId: MID })).ok).toBe(false);
    const state = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state })).ok).toBe(true);
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state })).ok).toBe(false);
    expect((await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state: 'f'.repeat(36) })).ok).toBe(false);
  });

  it('refreshes the access token shortly before it expires', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const now = Math.floor(Date.now() / 1000);
    expect(await cloverOAuthToken(MID, now)).toBe('AT-1');                 // 30 minutes left: kept
    expect(await cloverOAuthToken(MID, now + 1800 - 60)).toBe('AT-2');     // 1 minute left: refreshed
    const refreshCall = calls.find((c) => c.url.endsWith('/oauth/v2/refresh'));
    expect(refreshCall?.body).toEqual({ client_id: '629HFYHNVMZYR', refresh_token: 'RT-1' });
    expect(await cloverOAuthToken(MID)).toBe('AT-2');
  });

  it('forgets a merchant that uninstalls the app, and ignores other apps', async () => {
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    const other = await handleCloverAppEvents({ appId: 'OTHER', merchants: { [MID]: [{ objectId: 'A:OTHERAPP', type: 'DELETE' }] } });
    expect(other.uninstalled).toEqual([]);
    const r = await handleCloverAppEvents({ appId: '629HFYHNVMZYR', merchants: { [MID]: [{ objectId: 'A:629HFYHNVMZYR', type: 'DELETE' }] } });
    expect(r.uninstalled).toEqual([MID]);
    expect(await cloverToken(MID)).toBeNull();
    expect(await listCloverConnections()).toEqual([]);
  });

  it('keeps an unknown merchant that installs from Clover pending until the owner approves it', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, clientId: '629HFYHNVMZYR' });
    expect(r).toEqual({ ok: true, merchantId: MID, name: 'On2GO.CA', pending: true });
    expect((await listCloverConnections())[0].status).toBe('pending');
    expect(await cloverToken(MID)).toBeNull();                 // no orders, no sync
    expect(await allCloverMerchants([])).not.toContain(MID);
    expect(await approveCloverMerchant(MID, 'Owner')).toBe(true);
    expect((await listCloverConnections())[0].status).toBe('active');
    expect(await cloverToken(MID)).toBe('AT-1');
    expect(await allCloverMerchants([])).toContain(MID);
  });

  it('approves at once when the owner starts the connection from Food Hub', async () => {
    delete process.env.CLOVER_ALLOWED_MERCHANTS;
    const state = new URL(await startCloverConnect('Owner')).searchParams.get('state');
    const r = await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID, state });
    expect(r.ok && r.pending).toBe(false);
    expect(await cloverToken(MID)).toBe('AT-1');
  });

  it('keeps environment tokens first (existing installs keep working)', async () => {
    process.env.CLOVER_MERCHANT_ID = MID; process.env.CLOVER_ACCESS_TOKEN = 'ENV-TOKEN';
    await finishCloverConnect({ code: 'GOOD-CODE', merchantId: MID });
    expect(await cloverToken(MID)).toBe('ENV-TOKEN');
  });
});

describe('platform markup (in-store prices in Clover, +X% on delivery apps)', async () => {
  const { priceFor, modifierPriceFor, withMarkup, toDoorDashMenu, toUberMenu, toSkipMenu } = await import('../lib/foodhub/menu/translate');
  const base = {
    brandName: 'Po Poulet', updatedAt: new Date().toISOString(),
    categories: [{ ref: 'c1', name: 'Poulet', sortOrder: 0 }],
    items: [
      { ref: 'i1', name: '15 MCX', price: 23.99, categoryRef: 'c1', available: true, modifierGroupRefs: ['g1'] },
      { ref: 'i2', name: 'Feta', price: 3.33, categoryRef: 'c1', available: true, modifierGroupRefs: [], channelPrices: { doordash: 3.99 } },
    ],
    modifierGroups: [{ ref: 'g1', name: 'Extras', min: 0, max: 2, modifiers: [{ ref: 'm1', name: 'Sauce', price: 1.25, available: true }, { ref: 'm2', name: 'Rien', price: 0, available: true }] }],
    channelMarkupPct: { doordash: 20, uber_eats: 15 },
  } as any;
  it('rounds to the cent and gives back the old DoorDash prices', () => {
    expect(withMarkup(23.99, 20)).toBe(28.79);
    expect(withMarkup(16.99, 20)).toBe(20.39);
    expect(withMarkup(0, 20)).toBe(0);
    expect(withMarkup(10, 0)).toBe(10);
  });
  it('applies the markup per platform; a per-item price wins; Skip without markup stays in-store', () => {
    expect(priceFor(base.items[0], 'doordash', base)).toBe(28.79);
    expect(priceFor(base.items[0], 'uber_eats', base)).toBe(27.59);
    expect(priceFor(base.items[0], 'skip', base)).toBe(23.99);
    expect(priceFor(base.items[1], 'doordash', base)).toBe(3.99);
    expect(modifierPriceFor(base.modifierGroups[0].modifiers[0], 'doordash', base)).toBe(1.5);
    expect(priceFor(base.items[0], 'doordash')).toBe(23.99); // no menu given = base price
  });
  it('publishes marked-up prices in the DoorDash, Uber and Skip menu payloads', () => {
    const dd = JSON.stringify(toDoorDashMenu(base, 'store', 'prov', 'ref'));
    expect(dd).toContain('"price":2879');
    expect(dd).toContain('"price":399');
    expect(dd).toContain('"price":150');
    const ub = JSON.stringify(toUberMenu(base));
    expect(ub).toContain('"price":2759');
    const sk = JSON.stringify(toSkipMenu(base, ['r1']));
    expect(sk).toContain('"price":2399');
    expect(sk).toContain('"price":125');
  });
});
