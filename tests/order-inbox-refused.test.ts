// Regression (PR #6 review): the inbox write reaches the database but its response is lost (timeout / connection reset after the
// commit). queueInbox answers 503 — for Skip that means JET sends the order to the Skip tablet — yet the record is
// in fh_docs as 'queued', so the sync sweep processes it 2+ minutes later: Clover ticket + "sent-to-pos-success" for
// an order the Skip tablet already has (cooked twice).
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void Promise.resolve().then(fn); },
}));
const injectMock = vi.fn();
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover')>()),
  cloverInjectionEnabled: () => true,
  cloverExpected: () => true,
  allCloverMerchants: async () => ['M1'],
  injectOrder: (...args: unknown[]) => injectMock(...args),
  printCloverOrder: async () => ({ ok: true, message: 'printed' }),
}));

import { INBOX_STALE_MS, sweepOrderInbox } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const SECRET = 'skip-hmac-secret-review';
const realFetch = globalThis.fetch;
const skipOrder = { id: 'skip-503-1', posLocationId: 'skip-store-1', type: 'delivery', items: [{ plu: 'P1', name: 'Poutine', quantity: 1, price: 1000 }], payment: { final: { total: 1150 } } };

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.SKIP_WEBHOOK_HMAC_SECRET = SECRET;
  injectMock.mockReset();
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
  await getRepo().upsertStore({ channel: 'skip', channelStoreId: 'skip-store-1', brandName: 'Po Poulet', locationCode: 'NDG', cloverMerchantId: 'M1', autoAccept: true, online: true, meta: {} });
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); delete process.env.SKIP_WEBHOOK_HMAC_SECRET; });

describe('503 answered, but the inbox write was committed', () => {
  it('an order Food Hub refused (non-2xx → Skip tablet) is never processed later by the sweep', async () => {
    injectMock.mockResolvedValue({ ok: true, posOrderId: 'CLV-1' });
    const repo = getRepo();
    const realPut = repo.putDocs.bind(repo);
    // Write committed, then the client sees an error (fetch timeout / ECONNRESET on the response).
    vi.spyOn(repo, 'putDocs').mockImplementationOnce(async (c: string, d: any[]) => { await realPut(c, d); throw new Error('Supabase: fetch failed (socket hang up)'); });

    const raw = JSON.stringify(skipOrder);
    const sig = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('base64');
    const { POST } = await import('../app/api/foodhub/webhooks/skip/orders/route');
    const res = await POST(new Request('http://hub.local/api/foodhub/webhooks/skip/orders', { method: 'POST', body: raw, headers: { 'x-jet-connect-hash': `signature=${sig}` } }) as any);
    expect(res.status).toBe(503); // JET: not injected → backup flow, the Skip tablet takes the order
    await new Promise((r) => setTimeout(r, 30));
    expect((await repo.listOrders()).filter((o) => o.externalOrderId === 'skip-503-1')).toHaveLength(0);

    // Next sync, 2.5 min later (inside Skip's 5-minute window, so not "late").
    await sweepOrderInbox({ now: Date.now() + INBOX_STALE_MS + 30_000 });
    // Before the fix: the sweep creates the order and sends it to Clover.
    expect(injectMock).not.toHaveBeenCalled();
    expect((await repo.listOrders()).filter((o) => o.externalOrderId === 'skip-503-1')).toHaveLength(0);
  });
});
