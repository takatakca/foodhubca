// TAKATAK Suite: Clover App Market apps that work alone and together through Food Hub (docs/TAKATAK_SUITE.md).
import { beforeEach, describe, expect, it } from 'vitest';
import { getRepo } from '../lib/foodhub/repo';
import { connectedSuiteApps, suiteApp, SUITE_APPS } from '../lib/foodhub/suite/apps';
import { deliverOutbox, detectOrderChanges, OUTBOX, orderView, type OutboxItem, type SuiteEvent } from '../lib/foodhub/suite/bus';
import { signSuite, verifySuite } from '../lib/foodhub/suite/sign';
import { POST as eventsRoute } from '../app/api/suite/v1/events/route';
import { GET as ordersRoute } from '../app/api/suite/v1/orders/route';
import { GET as directoryRoute } from '../app/api/suite/v1/directory/route';
import { installCounts } from '../lib/foodhub/suite/directory';
import type { NormalizedOrder } from '../lib/foodhub/types';

const SECRET_A = 'l'.repeat(40);
const SECRET_B = 'r'.repeat(40);
const order = (id: string, extra: Partial<NormalizedOrder> = {}): NormalizedOrder => ({
  channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: id, displayId: id.toUpperCase(), channelStoreId: 'uber-store', brandName: 'Po Poulet',
  customerName: 'Ana B.', fulfillment: 'pickup', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 20, tax: 3, deliveryFee: 0, tip: 2, discount: 0, total: 25,
  lines: [{ name: 'Poulet', quantity: 1, unitPrice: 20, total: 20, posItemRef: 'CLV1', modifiers: [] }], raw: { eater: { phone: '+15145550101' } }, ...extra,
});
const outbox = async () => (await getRepo().listDocs<OutboxItem>(OUTBOX, { limit: 1000 })).map((d) => d.data);

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const a of SUITE_APPS) for (const p of ['URL', 'SECRET', 'EVENTS']) delete process.env[`FOODHUB_SUITE_${a.key.toUpperCase()}_${p}`];
  delete process.env.FOODHUB_SUITE_CUSTOMER_SALT;
  // Two apps connected: LOY4LTY (order.status_changed, app.event) and REW4RD (app.event).
  process.env.FOODHUB_SUITE_LOY4LTY_URL = 'https://loyalty.example.ca/foodhub/events';
  process.env.FOODHUB_SUITE_LOY4LTY_SECRET = SECRET_A;
  process.env.FOODHUB_SUITE_REW4RD_URL = 'https://rewards.example.ca/foodhub/events';
  process.env.FOODHUB_SUITE_REW4RD_SECRET = SECRET_B;
});

describe('signatures', () => {
  it('verifies its own signature and refuses a changed body, a wrong secret or an old one', () => {
    const now = Date.parse('2026-10-28T20:00:00Z');
    const h = signSuite(SECRET_A, '{"a":1}', now);
    expect(verifySuite(SECRET_A, h, '{"a":1}', now)).toBe(true);
    expect(verifySuite(SECRET_A, h, '{"a":2}', now)).toBe(false);
    expect(verifySuite(SECRET_B, h, '{"a":1}', now)).toBe(false);
    expect(verifySuite(SECRET_A, h, '{"a":1}', now + 301_000)).toBe(false);
    expect(verifySuite(SECRET_A, 'garbage', '{"a":1}', now)).toBe(false);
    expect(verifySuite(SECRET_A, null, '{"a":1}', now)).toBe(false);
  });
});

describe('apps', () => {
  it('lists the nine Clover apps; connected only with an https address and a long secret', () => {
    expect(SUITE_APPS.map((a) => a.repo)).toEqual(['C4ISSE', 'T4CTILE', '4CCOUNTING', 'TR4CKER', 'ST4FF', 'M4RKETING', 'LOY4LTY', 'REW4RD', 'CH4T']);
    expect(connectedSuiteApps().map((a) => a.key)).toEqual(['loy4lty', 'rew4rd']);
    process.env.FOODHUB_SUITE_CH4T_URL = 'http://chat.example.ca/';
    process.env.FOODHUB_SUITE_CH4T_SECRET = SECRET_A;
    expect(suiteApp('ch4t')).toMatchObject({ connected: false, problem: 'URL must be https' });
    process.env.FOODHUB_SUITE_CH4T_URL = 'https://chat.example.ca/';
    process.env.FOODHUB_SUITE_CH4T_SECRET = 'short';
    expect(suiteApp('ch4t')?.connected).toBe(false);
    process.env.FOODHUB_SUITE_CH4T_URL = 'https://u:p@chat.example.ca/';
    process.env.FOODHUB_SUITE_CH4T_SECRET = SECRET_A;
    expect(suiteApp('ch4t')?.connected).toBe(false);
  });
});

describe('order events', () => {
  it('never sends the customer name, phone or raw payload; customerKey only with the salt and a real phone', async () => {
    const { order: o } = await getRepo().insertOrderIfNew(order('a1'));
    const plain = orderView(o);
    expect(JSON.stringify(plain)).not.toMatch(/Ana|5550101|eater/);
    expect(plain).not.toHaveProperty('customerKey');
    process.env.FOODHUB_SUITE_CUSTOMER_SALT = 's'.repeat(32);
    const keyed = orderView(o);
    expect(keyed.customerKey).toMatch(/^[0-9a-f]{32}$/);
    const { order: o2 } = await getRepo().insertOrderIfNew(order('a2'));
    expect(orderView(o2).customerKey).toBe(keyed.customerKey); // same customer, same key in every app
    const { order: masked } = await getRepo().insertOrderIfNew(order('a3', { raw: { eater: { phone: '+15145550199', phone_code: '123 45' } } }));
    expect(orderView(masked)).not.toHaveProperty('customerKey'); // platform relay number: not a customer
  });

  it('first run is a baseline; then one event per change, to the apps that take it, never twice', async () => {
    const repo = getRepo();
    const { order: old } = await repo.insertOrderIfNew(order('old'));
    expect(await detectOrderChanges()).toEqual({ queued: 0, baseline: true });
    const { order: fresh } = await repo.insertOrderIfNew(order('new'));
    // order.created goes to nobody here (LOY4LTY takes status changes, REW4RD app events).
    expect((await detectOrderChanges()).queued).toBe(0);
    await repo.updateOrder(fresh.id, { status: 'accepted' });
    await repo.updateOrder(old.id, { status: 'completed' });
    expect((await detectOrderChanges()).queued).toBe(2);
    expect((await detectOrderChanges()).queued).toBe(0);
    const items = await outbox();
    expect(items.map((i) => `${i.app}:${i.event.id}`).sort()).toEqual([`loy4lty:ord_${fresh.id}_accepted`, `loy4lty:ord_${old.id}_completed`].sort());
    const ev = items.find((i) => i.event.id === `ord_${old.id}_completed`)!.event;
    expect(ev).toMatchObject({ type: 'order.status_changed', data: { previousStatus: 'new', order: { status: 'completed', total: 25 } } });
  });

  it('delivers signed copies; a failure is retried later, the others are not held', async () => {
    const repo = getRepo();
    await repo.insertOrderIfNew(order('x'));
    await detectOrderChanges();
    const { order: o } = await repo.insertOrderIfNew(order('y'));
    await detectOrderChanges();
    await repo.updateOrder(o.id, { status: 'completed' });
    await detectOrderChanges();
    const seen: Array<{ url: string; ok: boolean }> = [];
    let down = true;
    const fetcher = (async (url: string, init: RequestInit) => {
      const body = String(init.body);
      const sig = (init.headers as Record<string, string>)['x-takatak-signature'];
      seen.push({ url, ok: verifySuite(SECRET_A, sig, body) });
      return new Response('{}', { status: down ? 503 : 200 });
    }) as unknown as typeof fetch;
    const now = Date.now();
    expect(await deliverOutbox(now, fetcher)).toEqual({ sent: 0, failed: 0, retrying: 1 });
    expect(seen).toEqual([{ url: 'https://loyalty.example.ca/foodhub/events', ok: true }]);
    expect(await deliverOutbox(now + 1000, fetcher)).toEqual({ sent: 0, failed: 0, retrying: 0 }); // waits for its backoff
    down = false;
    expect(await deliverOutbox(now + 31_000, fetcher)).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });
});

describe('app → Food Hub API', () => {
  const signedPost = (app: string, secret: string, body: unknown) => {
    const text = JSON.stringify(body);
    return new Request('http://hub.local/api/suite/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-takatak-app': app, 'x-takatak-signature': signSuite(secret, text) }, body: text });
  };

  it('an app event is passed on to the other connected apps (not back to its sender), once', async () => {
    const ev = { id: 'pts-1', type: 'loy4lty.points_awarded', data: { customerKey: 'abc', points: 25 } };
    const res = await eventsRoute(signedPost('loy4lty', SECRET_A, ev));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ forwardedTo: 1 });
    const items = await outbox();
    expect(items).toHaveLength(1);
    expect(items[0].app).toBe('rew4rd');
    expect(items[0].event as SuiteEvent).toMatchObject({ type: 'app.event', source: 'loy4lty', data: { type: 'loy4lty.points_awarded' } });
    expect(await (await eventsRoute(signedPost('loy4lty', SECRET_A, ev))).json()).toMatchObject({ forwardedTo: 0 });
  });

  it('refuses unsigned calls, another app’s secret, another app’s event type and disconnected apps', async () => {
    const ev = { id: 'e1', type: 'loy4lty.points_awarded' };
    const unsigned = new Request('http://hub.local/api/suite/v1/events', { method: 'POST', headers: { 'x-takatak-app': 'loy4lty' }, body: JSON.stringify(ev) });
    expect((await eventsRoute(unsigned)).status).toBe(401);
    expect((await eventsRoute(signedPost('loy4lty', SECRET_B, ev))).status).toBe(401);
    expect((await eventsRoute(signedPost('rew4rd', SECRET_B, ev))).status).toBe(403);
    expect((await eventsRoute(signedPost('ch4t', SECRET_A, { id: 'e2', type: 'ch4t.sent' }))).status).toBe(403);
    expect((await eventsRoute(signedPost('nope', SECRET_A, ev))).status).toBe(401);
  });

  it('GET /orders: signed path, PII-free orders for catching up', async () => {
    await getRepo().insertOrderIfNew(order('c1'));
    const path = '/api/suite/v1/orders?limit=10';
    const req = (sig: string) => new Request(`http://hub.local${path}`, { headers: { 'x-takatak-app': 'rew4rd', 'x-takatak-signature': sig } });
    expect((await ordersRoute(req(signSuite(SECRET_B, '/api/suite/v1/orders?limit=99')))).status).toBe(401);
    const res = await ordersRoute(req(signSuite(SECRET_B, path)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/Ana|5550101/);
  });
});

describe('suite directory (which restaurant has which app)', () => {
  const MID = 'MERCHANT0001';
  const signedPost = (app: string, secret: string, body: unknown) => {
    const text = JSON.stringify(body);
    return new Request('http://hub.local/api/suite/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-takatak-app': app, 'x-takatak-signature': signSuite(secret, text) }, body: text });
  };
  const ask = (app: string, secret: string, merchant = MID) => {
    const path = `/api/suite/v1/directory?merchant=${merchant}`;
    return directoryRoute(new Request(`http://hub.local${path}`, { headers: { 'x-takatak-app': app, 'x-takatak-signature': signSuite(secret, path) } }));
  };

  it('an app announces itself; another app reads it; an uninstall clears it; nobody speaks for another app', async () => {
    const installed = { id: `installed:${MID}:1`, type: 'loy4lty.installed', data: { cloverMerchantId: MID, appUrl: 'https://loyalty.example.ca/' } };
    expect((await eventsRoute(signedPost('loy4lty', SECRET_A, installed))).status).toBe(200);
    let body = await (await ask('rew4rd', SECRET_B)).json();
    expect(body.apps).toHaveLength(SUITE_APPS.length);
    expect(body.apps.find((a: any) => a.key === 'loy4lty')).toMatchObject({ installed: true, url: 'https://loyalty.example.ca' });
    expect(body.apps.find((a: any) => a.key === 'rew4rd')).toMatchObject({ installed: false, url: null });
    expect(await installCounts()).toEqual({ loy4lty: 1 });
    // REW4RD cannot claim LOY4LTY's events.
    expect((await eventsRoute(signedPost('rew4rd', SECRET_B, { id: 'x', type: 'loy4lty.uninstalled', data: { cloverMerchantId: MID } }))).status).toBe(403);
    expect((await eventsRoute(signedPost('loy4lty', SECRET_A, { id: `uninstalled:${MID}:2`, type: 'loy4lty.uninstalled', data: { cloverMerchantId: MID } }))).status).toBe(200);
    body = await (await ask('rew4rd', SECRET_B)).json();
    expect(body.apps.find((a: any) => a.key === 'loy4lty')).toMatchObject({ installed: false, url: null });
    expect(await installCounts()).toEqual({});
  });

  it('refuses unsigned reads and bad merchant IDs; drops unsafe addresses', async () => {
    const path = `/api/suite/v1/directory?merchant=${MID}`;
    expect((await directoryRoute(new Request(`http://hub.local${path}`, { headers: { 'x-takatak-app': 'rew4rd' } }))).status).toBe(401);
    expect((await ask('rew4rd', SECRET_B, 'bad-id')).status).toBe(400);
    await eventsRoute(signedPost('loy4lty', SECRET_A, { id: 'i2', type: 'loy4lty.installed', data: { cloverMerchantId: MID, appUrl: 'javascript:alert(1)' } }));
    const body = await (await ask('rew4rd', SECRET_B)).json();
    expect(body.apps.find((a: any) => a.key === 'loy4lty')).toMatchObject({ installed: true, url: null });
  });
});
