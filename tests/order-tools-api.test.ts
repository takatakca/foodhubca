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

  it('403 for an order in another kitchen, 404 for an unknown order, 401 when signed out', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/line-refs/route');
    expect((await GET(get(`/api/foodhub/order-tools/${otherOrder}/line-refs`, 'tools_op'), ctx(otherOrder))).status).toBe(403);
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

  it('403 out of scope, 404 unknown', async () => {
    const { GET } = await import('../app/api/foodhub/order-tools/[id]/money/route');
    expect((await GET(get(`/api/foodhub/order-tools/${otherOrder}/money`, 'tools_mgr'), ctx(otherOrder))).status).toBe(403);
    expect((await GET(get('/api/foodhub/order-tools/nope/money', 'tools_analyst'), ctx('nope'))).status).toBe(404);
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
