// Kitchen order tools — the read-only routes: permissions, kitchen scope, unknown orders. Memory repo, no platform call.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { clearOrderMoneyCache } from '../lib/foodhub/order-tools/order-money';
import { FORBIDDEN_STORE_IDS } from '../lib/foodhub/public-directory';
import { getRepo } from '../lib/foodhub/repo';
import type { FoodHubUser, NormalizedOrder } from '../lib/foodhub/types';

process.env.FOODHUB_FORCE_MEMORY = 'true';
process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
process.env.FOODHUB_TRUST_PROXY = 'true';

const PASS = 'Kitchen-tools-42';
const basic = (u: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${PASS}`).toString('base64')}`, 'x-forwarded-for': `10.0.0.${u.length}` });
const get = (path: string, user: string) => new Request(`http://hub.local${path}`, { headers: basic(user) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const baseOrder = (externalOrderId: string, locationCode: string): NormalizedOrder & { locationCode: string } => ({
  channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId, channelStoreId: 'store-1', brandName: 'Test Tools', fulfillment: 'delivery', placedAt: new Date().toISOString(),
  currency: 'CAD', subtotal: 20, tax: 3, deliveryFee: 0, tip: 0, discount: 0, total: 23, raw: {}, locationCode,
  lines: [{ name: 'Poutine', externalId: 'it-poutine', quantity: 1, unitPrice: 10, total: 10, modifiers: [{ name: 'BBQ', quantity: 1, unitPrice: 0 }] }, { name: 'Pizza inconnue', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }],
});

let ndgOrder = '';
let otherOrder = '';
const fetchSpy = vi.fn(async () => new Response('{}', { status: 599 }));

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy); // any outbound call would show up here
  const repo = getRepo();
  const mk = (username: string, role: FoodHubUser['role'], locations: string[]) => repo.saveUser({ username, name: username, role, locations, active: true, lastLoginAt: null, passwordHash: hashPassword(PASS) } as unknown as FoodHubUser);
  await mk('tools_mgr', 'manager', ['NDG_TOOLS']);
  await mk('tools_op', 'operator', ['NDG_TOOLS']);
  await mk('tools_analyst', 'analyst', ['NDG_TOOLS']);
  ndgOrder = (await repo.insertOrderIfNew(baseOrder('tools-ndg-1', 'NDG_TOOLS'))).order.id;
  otherOrder = (await repo.insertOrderIfNew(baseOrder('tools-sl-1', 'SL_TOOLS'))).order.id;
  await repo.saveMenu({
    brandName: 'Test Tools', categories: [{ ref: 'c', name: 'C', sortOrder: 0 }], updatedAt: new Date().toISOString(),
    items: [{ ref: 'it-poutine', name: 'Poutine', price: 10, categoryRef: 'c', available: true, modifierGroupRefs: ['g'] }],
    modifierGroups: [{ ref: 'g', name: 'Sauce', min: 0, max: 1, modifiers: [{ ref: 'm-bbq', name: 'BBQ', price: 0, available: true }] }],
  });
  await repo.upsertStore({ channel: 'doordash', channelStoreId: [...FORBIDDEN_STORE_IDS][0], brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: true, meta: {} });
});

beforeEach(() => clearOrderMoneyCache());

describe('GET /api/foodhub/order-tools/[id]/line-refs', () => {
  it('returns the menu refs of each line for an order in the person’s kitchen', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/line-refs/route');
    const res = await GET(get(`/api/foodhub/order-tools/${ndgOrder}/line-refs`, 'tools_op'), ctx(ndgOrder));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ brand: 'Test Tools', locationCode: 'NDG_TOOLS', hasMenu: true });
    expect(body.lines[0]).toMatchObject({ itemRef: 'it-poutine', match: 'ref', modifierRefs: [{ name: 'BBQ', ref: 'm-bbq', match: 'name' }] });
    expect(body.lines[1]).toMatchObject({ match: 'none' });
  });

  it('404 for an order in another kitchen (same answer as an unknown order), 401 when signed out', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/line-refs/route');
    expect((await GET(get(`/api/foodhub/order-tools/${otherOrder}/line-refs`, 'tools_op'), ctx(otherOrder))).status).toBe(404);
    expect((await GET(get('/api/foodhub/order-tools/nope/line-refs', 'tools_op'), ctx('nope'))).status).toBe(404);
    expect((await GET(new Request('http://hub.local/api/foodhub/order-tools/x/line-refs'), ctx(ndgOrder))).status).toBe(401);
  });
});

describe('GET /api/foodhub/order-tools/[id]/money', () => {
  it('needs analytics:view: an operator gets 403, a manager of the kitchen gets the read-only money', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/money/route');
    expect((await GET(get(`/api/foodhub/order-tools/${ndgOrder}/money`, 'tools_op'), ctx(ndgOrder))).status).toBe(403);
    const res = await GET(get(`/api/foodhub/order-tools/${ndgOrder}/money`, 'tools_mgr'), ctx(ndgOrder));
    expect(res.status).toBe(200);
    expect((await res.json()).money).toMatchObject({ status: 'not_yet' }); // no statement imported in this test
  });

  it('404 out of scope and 404 unknown: the same answer', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/money/route');
    expect((await GET(get(`/api/foodhub/order-tools/${otherOrder}/money`, 'tools_mgr'), ctx(otherOrder))).status).toBe(404);
    expect((await GET(get('/api/foodhub/order-tools/nope/money', 'tools_analyst'), ctx('nope'))).status).toBe(404);
  });
});

describe('POST /api/foodhub/order-tools/kitchen/status — refused on the SERVER, whatever the tablet sends', () => {
  const post = (user: string, json: Record<string, unknown>) => new Request('http://hub.local/api/foodhub/order-tools/kitchen/status', {
    method: 'POST', headers: { ...basic(user), 'content-type': 'application/json' }, body: JSON.stringify(json),
  });
  const idOf = async (channel: 'doordash' | 'uber_eats', channelStoreId: string) => (await getRepo().findStore(channel, channelStoreId))!.id;

  it('a hand-made pause of the protected DoorDash store pauses nothing and makes no call', async () => {
    const { POST } = await import('../app/api/foodhub/order-tools/kitchen/status/route');
    const protectedId = await idOf('doordash', [...FORBIDDEN_STORE_IDS][0]);
    const before = fetchSpy.mock.calls.length;
    const res = await POST(post('tools_mgr', { locationCode: 'NDG_TOOLS', storeIds: [protectedId], online: false, minutes: 30, reason: 'Kitchen too busy' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.notSent).toEqual([{ storeId: protectedId, reason: 'forbidden' }]);
    expect(fetchSpy.mock.calls.length).toBe(before);
    expect((await getRepo().getStore(protectedId))!.online).toBe(true); // untouched
  });

  it('the same store mapped under another id but carrying the protected number, a "Do not touch" store and another kitchen’s store are refused too', async () => {
    const { POST } = await import('../app/api/foodhub/order-tools/kitchen/status/route');
    const repo = getRepo();
    const alias = (await repo.upsertStore({ channel: 'doordash', channelStoreId: 'tools-alias', brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: true, meta: { platformStoreId: [...FORBIDDEN_STORE_IDS][0] } })).id;
    const dnt = (await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'tools-dnt', brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: true, meta: { doNotTouch: true } })).id;
    const elsewhere = (await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'tools-sl', brandName: 'Test Tools', locationCode: 'SL_TOOLS', autoAccept: true, online: true, meta: {} })).id;
    const before = fetchSpy.mock.calls.length;
    const body = await (await POST(post('tools_mgr', { locationCode: 'NDG_TOOLS', storeIds: [alias, dnt, elsewhere, 'nope'], online: false, minutes: 15 }), {})).json();
    expect(body.results).toEqual([]);
    expect(body.notSent).toEqual([
      { storeId: alias, reason: 'forbidden' }, { storeId: dnt, reason: 'do_not_touch' }, { storeId: elsewhere, reason: 'other_kitchen' }, { storeId: 'nope', reason: 'unknown' },
    ]);
    expect(fetchSpy.mock.calls.length).toBe(before);
    for (const id of [alias, dnt, elsewhere]) expect((await repo.getStore(id))!.online).toBe(true);
  });

  it('"Tout rouvrir" leaves a holiday closure and a platform deactivation closed', async () => {
    const { POST } = await import('../app/api/foodhub/order-tools/kitchen/status/route');
    const repo = getRepo();
    const holiday = (await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'tools-holiday', brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: false,
      meta: { platformStatus: { state: 'paused', detail: 'Holiday closure', checkedAt: new Date().toISOString(), source: 'dashboard' } } })).id;
    const shut = (await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'tools-shut', brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: false,
      meta: { platformStatus: { state: 'deactivated', checkedAt: new Date().toISOString(), source: 'webhook' } } })).id;
    const body = await (await POST(post('tools_op', { locationCode: 'NDG_TOOLS', storeIds: [holiday, shut], online: true }), {})).json();
    expect(body.results).toEqual([]);
    expect(body.notSent).toEqual([{ storeId: holiday, reason: 'holiday' }, { storeId: shut, reason: 'platform' }]);
    expect((await repo.getStore(holiday))!.online).toBe(false);
    expect((await repo.getStore(shut))!.online).toBe(false);
  });

  it('keeps the manager PIN rule for a pause (operator without PIN → 428), checks the kitchen scope and the permission', async () => {
    const { POST } = await import('../app/api/foodhub/order-tools/kitchen/status/route');
    const open = (await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'tools-open', brandName: 'Test Tools', locationCode: 'NDG_TOOLS', autoAccept: true, online: true, meta: {} })).id;
    expect((await POST(post('tools_op', { locationCode: 'NDG_TOOLS', storeIds: [open], online: false, minutes: 15 }), {})).status).toBe(428);
    expect((await getRepo().getStore(open))!.online).toBe(true);
    expect((await POST(post('tools_op', { locationCode: 'SL_TOOLS', storeIds: [open], online: false }), {})).status).toBe(403);
    expect((await POST(post('tools_analyst', { locationCode: 'NDG_TOOLS', storeIds: [open], online: false }), {})).status).toBe(403);
    expect((await POST(post('tools_op', { locationCode: 'NDG_TOOLS', storeIds: [] }), {})).status).toBe(400);
  });
});

describe('GET /api/foodhub/order-tools/kitchen', () => {
  it('sends the protected store ids and the closing minutes for the kitchen; 403 for another kitchen', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/kitchen/route');
    const res = await GET(get('/api/foodhub/order-tools/kitchen?locationCode=NDG_TOOLS', 'tools_op'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forbiddenStoreIds).toEqual([...FORBIDDEN_STORE_IDS]);
    expect(body.brandsCloseInMin).toEqual({ 'Test Tools': null }); // no hours set here
    expect(body.closesInMin).toBeNull();
    expect((await GET(get('/api/foodhub/order-tools/kitchen?locationCode=SL_TOOLS', 'tools_op'), {})).status).toBe(403);
    expect((await GET(get('/api/foodhub/order-tools/kitchen', 'tools_op'), {})).status).toBe(400);
  });

  it('made no outbound call', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
