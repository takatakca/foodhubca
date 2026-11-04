// Real authenticated finance reads: workspace filters change reported money, never authorization or the ledger boundary.
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as reconGet } from '../app/api/foodhub/recon/route';
import { GET as casesGet } from '../app/api/foodhub/recon/cases/route';
import { GET as importsGet } from '../app/api/foodhub/recon/imports/route';
import { GET as payoutsGet } from '../app/api/foodhub/recon/payouts/route';
import { GET as ledgerGet } from '../app/api/foodhub/recon/ledger/route';
import { sessionCookieFor } from '../lib/foodhub/auth';
import { COL, importStatement, syncCases, reconcile } from '../lib/foodhub/recon/engine';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelKey, NormalizedOrder } from '../lib/foodhub/types';

const at = '2026-09-10T16:00:00.000Z';
const range = 'from=2026-09-01&to=2026-09-30';
const enc = (s: string) => new TextEncoder().encode(s);
const actor = { username: 'test', name: 'Test', source: 'dashboard' as const };
const uberHeader = 'Order ID,Workflow ID,Order Status,Order Date,Payout Date,Sales (excluding tax),Tax on Sales,Marketplace fee,Tax on Marketplace fee,Other payments,Other payments description,Total payout,Payout reference ID';
const ddHeader = 'Timestamp local date,Transaction type,DoorDash order ID,Merchant Store ID,Subtotal,Subtotal tax passed to merchant,Commission,Error charges,Net total,Payout date';

async function addOrder(id: string, channel: ChannelKey, brandName: string, locationCode: string) {
  const order: NormalizedOrder & { locationCode: string; createdAt: string } = {
    channel, marketplace: channel, externalOrderId: id, displayId: id.toUpperCase(), channelStoreId: `${channel}-${brandName}-${locationCode}`,
    brandName, locationCode, fulfillment: 'delivery', placedAt: at, createdAt: at, currency: 'CAD', subtotal: 20, tax: 2.99, total: 22.99,
    deliveryFee: 0, tip: 0, discount: 0, lines: [], raw: {},
  };
  const { order: saved } = await getRepo().insertOrderIfNew(order);
  await getRepo().updateOrder(saved.id, { status: 'completed' });
}

async function seed() {
  await addOrder('uber-a-ndg', 'uber_eats', 'Brand A', 'NDG');
  await addOrder('uber-a-verdun', 'uber_eats', 'Brand A', 'VERDUN');
  await addOrder('uber-b-ndg', 'uber_eats', 'Brand B', 'NDG');
  await addOrder('dd-a-ndg', 'doordash', 'Brand A', 'NDG');
  await importStatement({ fileName: 'uber.csv', bytes: enc([
    uberHeader,
    'UBER-A-NDG,uber-a-ndg,Completed,2026-09-10,2026-09-17,20,2.99,-5,-0.75,0,,12.24,P-U',
    'UBER-A-VERDUN,uber-a-verdun,Completed,2026-09-10,2026-09-17,20,2.99,-5,-0.75,0,,10.24,P-U',
    'UBER-B-NDG,uber-b-ndg,Completed,2026-09-10,2026-09-17,20,2.99,-5,-0.75,0,,9.24,P-U',
    'UNKNOWN,uber-unknown,Completed,2026-09-10,2026-09-17,20,2.99,-5,-0.75,0,,17.24,P-U',
    ',,,,2026-09-17,0,0,0,0,-15,Ads campaign,-15,P-U',
  ].join('\n')), actor });
  await importStatement({ fileName: 'dd.csv', bytes: enc([
    ddHeader, '2026-09-10,DELIVERY,dd-a-ndg,dd-store,20,2.99,-5,0,8.24,2026-09-17',
  ].join('\n')), actor });
  await syncCases(await reconcile({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }), actor);
}

async function request(query: string, cookie = '', path = '/api/foodhub/recon') {
  return new Request(`https://hub.test${path}?${query}`, { headers: cookie ? { cookie } : {} });
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.SESSION_SECRET = 'finance-workspace-test-secret-0123456789-abcdef';
  process.env.DASHBOARD_PASSWORD = 'finance-workspace-owner-password';
  (globalThis as typeof globalThis & { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

describe('finance workspace API reads', () => {
  it('intersects platform, brand and kitchen, with only their order money and channel summaries', async () => {
    await seed();
    const cookie = (await sessionCookieFor(null, 'password')).split(';')[0];
    const response = await reconGet(await request(`${range}&channels=uber_eats&brands=Brand%20A&locations=NDG`, cookie), {});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orders.map((o: { ref: string }) => o.ref)).toEqual(['uber-a-ndg']);
    expect(body.channels.map((c: { channel: string }) => c.channel)).toEqual(['uber_eats']);
    expect(body.totals).toMatchObject({ orders: 1, paid: 12.24, missingMoney: 5, unknownOrders: 0, otherCharges: 0 });
    expect(body.other).toEqual([]);
    expect(body.unmatched).toEqual([]);

    const allRestaurants = await (await reconGet(await request(`${range}&channels=uber_eats`, cookie), {})).json();
    expect(allRestaurants.orders).toHaveLength(3);
    expect(allRestaurants.totals).toMatchObject({ paid: 31.72, missingMoney: 20, unknownOrders: 1, otherCharges: -15 });
    expect(allRestaurants.other).toHaveLength(1);
    const skip = await (await reconGet(await request(`${range}&channels=skip`, cookie), {})).json();
    expect(skip.imports).toBe(0);
    expect(skip.totals.paid).toBe(0);
  });

  it('filters disputes across the same dimensions and keeps unassigned disputes in the full platform view', async () => {
    await seed();
    const cookie = (await sessionCookieFor(null, 'password')).split(';')[0];
    const all = await (await casesGet(await request('channels=uber_eats', cookie), {})).json();
    expect(all.cases).toHaveLength(4);
    expect(all.cases.some((c: { type: string }) => c.type === 'unknown_order')).toBe(true);
    const scoped = await (await casesGet(await request('channels=uber_eats&brands=Brand%20A&locations=NDG&status=open', cookie), {})).json();
    expect(scoped.cases).toHaveLength(1);
    expect(scoped.cases[0]).toMatchObject({ ref: 'UBER-A-NDG', amount: 5, brandName: 'Brand A', locationCode: 'NDG' });
    expect((await getRepo().listDocs(COL.cases, {}))).toHaveLength(5); // a read never closes or deletes the other platform's cases
  });

  it('limits statement lists, bank payouts and ledger entries to the selected platform', async () => {
    await seed();
    const cookie = (await sessionCookieFor(null, 'password')).split(';')[0];
    const imported = await (await importsGet(await request('channels=doordash', cookie), {})).json();
    expect(imported.imports).toHaveLength(1);
    expect(imported.imports[0].channel).toBe('doordash');
    const payouts = await (await payoutsGet(await request(`${range}&channels=doordash`, cookie), {})).json();
    expect(payouts.payouts).toHaveLength(1);
    expect(payouts.payouts[0]).toMatchObject({ channel: 'doordash', net: 8.24 });
    const ledger = await (await ledgerGet(await request(`${range}&channels=doordash`, cookie), {})).json();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].channel).toBe('doordash');
    expect(ledger.entries[0].balanced).toBe(true);
  });

  it('keeps authentication, role and all-location finance restrictions even for a scoped query', async () => {
    const query = `${range}&channels=uber_eats&locations=NDG`;
    expect((await reconGet(await request(query), {})).status).toBe(401);
    await getRepo().saveUser({ username: 'local-analyst', name: 'Local analyst', role: 'analyst', locations: ['NDG'], active: true, passwordHash: null });
    const user = (await getRepo().getUser('local-analyst'))!;
    const localCookie = (await sessionCookieFor(user, 'otp')).split(';')[0];
    for (const get of [reconGet, casesGet, importsGet, payoutsGet, ledgerGet]) {
      expect((await get(await request(query, localCookie), {})).status).toBe(403);
    }
    await getRepo().saveUser({ username: 'cook', name: 'Cook', role: 'operator', locations: [], active: true, passwordHash: null });
    const cookCookie = (await sessionCookieFor((await getRepo().getUser('cook'))!, 'otp')).split(';')[0];
    expect((await reconGet(await request(query, cookCookie), {})).status).toBe(403);
  });
});
