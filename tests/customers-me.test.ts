// « Mon compte » order history: a customer's website orders must survive other customers' volume.
// Regression: websiteOrdersFor used to scan only the newest 500 direct orders of EVERY customer
// before filtering by phone, so older orders silently vanished once the shop passed 500 orders.
// All data below is invented (555-01xx phones, placeholder brands).
import { beforeEach, describe, expect, it } from 'vitest';
import { ME_ORDERS_MAX, websiteOrdersFor } from '../lib/foodhub/customers/me';
import { DIRECT_ORDERS } from '../lib/foodhub/delivery/store';
import { getRepo } from '../lib/foodhub/repo';

const TARGET = '+15145550199';
const BASE = Date.parse('2026-10-01T00:00:00.000Z');
const atMinute = (m: number) => new Date(BASE + m * 60_000).toISOString();

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_TIMEZONE = 'America/Toronto';
  (globalThis as any).__foodhubMem = undefined;
});

let seq = 0;
async function seed(minute: number, opts: { phone?: string; source?: string } = {}) {
  const id = `do_${++seq}`;
  const when = atMinute(minute);
  const data = {
    id, number: `T-${seq}`, source: opts.source ?? 'website', brandName: 'Brand A', locationCode: 'LOC_A',
    customer: { name: 'Test Person', phone: opts.phone ?? TARGET }, fulfillment: 'pickup',
    dropoff: { street: '1 Test Street', city: 'Testville', postalCode: 'H0H 0H0' },
    lines: [], subtotal: 20, tax: 0, deliveryFee: 0, tip: 0, total: 20, currency: 'CAD', payment: 'paid',
    status: 'completed', containsAlcohol: false, placedAt: when, events: [], createdAt: when, updatedAt: when,
  };
  await getRepo().putDocs(DIRECT_ORDERS, [{ id, key: data.locationCode, at: when, data }]);
  return id;
}

describe('websiteOrdersFor', () => {
  it('finds the customer’s orders buried under more than 500 newer orders from other customers', async () => {
    const buried: string[] = [];
    for (let m = 0; m < 22; m++) buried.push(await seed(m)); // the target's 22 website orders, all old
    for (let m = 100; m < 700; m++) await seed(m, { phone: `+1514556${String(m).padStart(4, '0')}` }); // 600 newer orders, other people

    const orders = await websiteOrdersFor(TARGET);
    expect(orders).toHaveLength(ME_ORDERS_MAX);
    // Newest first, and every one of them is the target's — including the buried ones.
    expect(orders.map((o) => o.id)).toEqual([...buried].reverse().slice(0, ME_ORDERS_MAX));
  });

  it('keeps only website orders of that phone', async () => {
    await seed(1);
    await seed(2, { source: 'phone' }); // same phone, not a website order
    await seed(3, { phone: '+15145550100' }); // website, someone else
    const orders = await websiteOrdersFor(TARGET);
    expect(orders).toHaveLength(1);
    expect(orders[0].at).toBe(atMinute(1));
  });

  it('returns nothing without a phone', async () => {
    await seed(1);
    expect(await websiteOrdersFor('')).toEqual([]);
  });
});
