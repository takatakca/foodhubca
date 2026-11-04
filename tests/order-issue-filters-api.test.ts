import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelKey, NormalizedOrder, StoredOrder } from '../lib/foodhub/types';

process.env.FOODHUB_FORCE_MEMORY = 'true';
process.env.DASHBOARD_PASSWORD = 'Order-investigation-owner-42';
process.env.FOODHUB_TRUST_PROXY = 'true';
const pass = 'Order-investigation-user-42';
const repo = getRepo();
const ids: Record<string, string> = {};
const fetchSpy = vi.fn(async () => new Response('{}', { status: 599 }));
const request = (query = '', user = 'issue_op') => new Request(`http://hub.local/api/foodhub/orders?${query}`, { headers: { authorization: `Basic ${Buffer.from(`${user}:${user === 'owner' ? process.env.DASHBOARD_PASSWORD : pass}`).toString('base64')}`, 'x-forwarded-for': '10.1.42.5' } });
const make = async (key: string, patch: Partial<StoredOrder> = {}) => {
  const channel: ChannelKey = patch.channel ?? 'uber_eats';
  const o: NormalizedOrder & { locationCode: string; createdAt: string } = { channel, marketplace: channel, externalOrderId: `issue-${key}`, displayId: key, channelStoreId: 'issue-test', brandName: 'Alpha', fulfillment: 'delivery', placedAt: '2026-11-04T12:00:00Z', currency: 'CAD', subtotal: 10, tax: 1, deliveryFee: 0, tip: 0, discount: 0, total: 11, lines: [], raw: { secret: 'must stay server-side' }, locationCode: 'ISSUE_NDG', createdAt: '2026-11-04T12:00:00Z' };
  const id = (await repo.insertOrderIfNew(o)).order.id;
  await repo.updateOrder(id, { status: 'completed', ...patch });
  ids[key] = id;
};
const read = async (q = '', user = 'issue_op') => {
  const { GET } = await import('../app/api/foodhub/orders/route');
  const response = await GET(request(q, user), {});
  return { response, body: await response.json() };
};

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  await repo.saveUser({ username: 'issue_op', name: 'Issue operator', role: 'operator', locations: ['ISSUE_NDG'], active: true, lastLoginAt: null, passwordHash: hashPassword(pass) });
  await make('match', { status: 'accepted', channelError: 'Platform rejected update', timeline: { courier: { status: 'at_store', source: 'webhook', updatedAt: '2026-11-04T12:02:00Z' } } });
  await make('store-cancel', { status: 'cancelled', timeline: { cancelledBy: 'store' } });
  await make('unknown-cancel', { status: 'cancelled' });
  await make('other-kitchen', { locationCode: 'ISSUE_OTHER', channelError: 'Other kitchen secret' });
  await make('other-brand', { brandName: 'Beta', channelError: 'Another brand' });
  await make('other-provider', { channel: 'doordash', channelError: 'Another provider' });
  // Newer nonmatches must not consume the requested number of matching results.
  for (let n = 0; n < 8; n++) await make(`recent-${n}`, { createdAt: `2026-11-04T13:0${n}:00Z` });
});

describe('authenticated Orders investigation route', () => {
  it('ANDs filters on the server and retains kitchen/provider/brand restrictions without returning raw payloads', async () => {
    const { response, body } = await read('channels=uber_eats&brands=Alpha&issue=platform&outcome=in_progress&courier=at_store&limit=1');
    expect(response.status).toBe(200);
    expect(body.orders.map((o: StoredOrder) => o.id)).toEqual([ids.match]);
    expect(body.orders[0].raw).toBeUndefined();
    expect(body.coverage).toMatchObject({ scanLimitReached: false, resultLimitReached: false });
    expect(body.orders[0].actions).toBeInstanceOf(Array);
  });
  it('cannot broaden the signed-in location restriction through query parameters', async () => {
    expect((await read('locations=ISSUE_OTHER&issue=any')).body.orders).toEqual([]);
    const body = (await read('locations=ISSUE_NDG,ISSUE_OTHER&issue=platform')).body;
    expect(body.orders.some((o: StoredOrder) => o.id === ids['other-kitchen'])).toBe(false);
  });
  it('cancellation source and unknown courier remain explicit, not inferred from completed orders', async () => {
    expect((await read('outcome=cancelled_store')).body.orders.map((o: StoredOrder) => o.id)).toEqual([ids['store-cancel']]);
    expect((await read('outcome=cancelled_unknown')).body.orders.map((o: StoredOrder) => o.id)).toEqual([ids['unknown-cancel']]);
    expect((await read('courier=delivered')).body.orders).toEqual([]);
    expect((await read('outcome=completed&courier=not_reported')).body.orders.length).toBeGreaterThan(0);
  });
  it('finds an older matching order before applying response limit, and reports result truncation', async () => {
    const { body } = await read('issue=platform&channels=uber_eats&brands=Alpha&limit=1');
    expect(body.orders.map((o: StoredOrder) => o.id)).toEqual([ids.match]);
    expect((await read('limit=1')).body.coverage.resultLimitReached).toBe(true);
  });
  it('provider and brand storage filters run before the repository limit', async () => {
    const rows = await repo.listOrders({ locationCodes: ['ISSUE_NDG'], channels: ['doordash'], brands: ['Alpha'], limit: 1 });
    expect(rows.map((o) => o.id)).toEqual([ids['other-provider']]);
    expect(await repo.listOrders({ locationCodes: ['ISSUE_NDG'], channels: ['doordash'], brands: ['Beta'], limit: 1 })).toEqual([]);
  });
  it('uses the same server filters for an exact search, accepts # numbers and never leaks another kitchen', async () => {
    expect((await read('q=%23match&issue=any')).body.orders.map((o: StoredOrder) => o.id)).toEqual([ids.match]);
    expect((await read('q=other-kitchen')).body.orders).toEqual([]);
  });
  it('reports an incomplete 5,000-candidate scan rather than claiming all matching orders were checked', async () => {
    const o = (await repo.getOrder(ids.match))!;
    const candidates = Array.from({ length: 5001 }, (_, n) => ({ ...o, id: `bounded-${n}`, channelError: n === 5000 ? 'outside read window' : undefined }));
    const spy = vi.spyOn(repo, 'listOrders').mockResolvedValueOnce(candidates);
    try {
      const { body } = await read('issue=platform&limit=1');
      expect(body.orders).toEqual([]);
      expect(body.coverage).toEqual({ scanLimitReached: true, resultLimitReached: false, scanned: 5000 });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ limit: 5001, locationCodes: ['ISSUE_NDG'] }));
    } finally { spy.mockRestore(); }
  });
  it('requires a signed-in viewer even for filtered requests', async () => {
    const { GET } = await import('../app/api/foodhub/orders/route');
    expect((await GET(new Request('http://hub.local/api/foodhub/orders?issue=any'), {})).status).toBe(401);
  });
  it.each(['issue=bogus', 'outcome=delivered', 'courier=none', 'status=bogus'])('rejects invalid %s instead of silently broadening results', async (q) => {
    const { response, body } = await read(q);
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Invalid .* filter/);
  });
  it('does not perform any provider calls for read-only investigation', () => expect(fetchSpy).not.toHaveBeenCalled());
});
