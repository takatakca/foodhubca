// Regression (PR #6 review): GET /api/foodhub/channels/inbox (and the `inbox` field of GET /api/foodhub/channels) lists failed
// orders of EVERY location to a manager limited to one location; the orders list hides them from that same manager.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { INBOX, saveToInbox, type InboxRecord } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';
import { resetThrottle } from '../lib/foodhub/session';
import type { NormalizedOrder } from '../lib/foodhub/types';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const LINA = basic('lina', 'manager-ndg-pass-1');

function plateauOrder(id: string): NormalizedOrder {
  return { channel: 'doordash', marketplace: 'doordash', externalOrderId: id, displayId: 'PLT-42', channelStoreId: 'dd-store-plateau', brandName: 'Burger Plateau', fulfillment: 'delivery',
    placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 88.4, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 88.4, customerName: 'Jean P.',
    lines: [{ name: 'Burger', quantity: 1, unitPrice: 88.4, total: 88.4, modifiers: [] }], raw: {} };
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  resetThrottle();
  const repo = getRepo();
  await repo.saveUser({ username: 'lina', name: 'Lina', role: 'manager', locations: ['NDG'], passwordHash: hashPassword('manager-ndg-pass-1'), active: true } as any);
  await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-store-plateau', brandName: 'Burger Plateau', locationCode: 'PLATEAU', cloverMerchantId: null, autoAccept: true, online: true, meta: {} } as any);
  // An order of the PLATEAU location: once processed (in fh_orders) and once failed (order inbox).
  await repo.insertOrderIfNew({ ...plateauOrder('dd-plateau-ok'), locationCode: 'PLATEAU' });
  const { id, record } = await saveToInbox({ channel: 'doordash', externalOrderId: 'dd-plateau-failed', order: plateauOrder('dd-plateau-failed') });
  await repo.putDocs<InboxRecord>(INBOX, [{ id, key: 'error', at: record.receivedAt, data: { ...record, status: 'error', error: 'Supabase: connection reset' } }]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('location scope of the order inbox', () => {
  it('a manager limited to NDG does not see PLATEAU orders in the orders list (the rule)', async () => {
    const { GET } = await import('../app/api/foodhub/orders/route');
    const body = await (await GET(new Request('http://hub.local/api/foodhub/orders', { headers: { authorization: LINA } }), {})).json();
    expect(body.orders.map((o: any) => o.externalOrderId)).not.toContain('dd-plateau-ok');
  });

  it('…but the order inbox shows that NDG manager the PLATEAU order (brand, number, total, error)', async () => {
    const { GET } = await import('../app/api/foodhub/channels/inbox/route');
    const res = await GET(new Request('http://hub.local/api/foodhub/channels/inbox', { headers: { authorization: LINA } }), {});
    expect(res.status).toBe(200);
    const { inbox } = await res.json();
    expect(inbox.map((i: any) => i.externalOrderId)).not.toContain('dd-plateau-failed');
  });

  it('…and so does the inbox block of GET /api/foodhub/channels', async () => {
    const { GET } = await import('../app/api/foodhub/channels/route');
    const res = await GET(new Request('http://hub.local/api/foodhub/channels', { headers: { authorization: LINA } }), {});
    expect(res.status).toBe(200);
    const { inbox } = await res.json();
    expect(inbox.map((i: any) => i.externalOrderId)).not.toContain('dd-plateau-failed');
  });
});
