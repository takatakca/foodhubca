import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as messages } from '../app/api/foodhub/messages/route';
import { hashPassword, sessionCookieFor } from '../lib/foodhub/auth';
import { enrollDevice } from '../lib/foodhub/identity/devices';
import { OUTBOX, type OutboxEntry } from '../lib/foodhub/notify';
import { getRepo } from '../lib/foodhub/repo';
import type { Role } from '../lib/foodhub/types';
import { INCIDENTS } from '../lib/foodhub/watch/engine';
import { proxy } from '../proxy';

const URL = 'https://hub.example.test/api/foodhub/messages';
const PASSWORD = 'fixture-message-history-password';
const A = 'FIXTURE_KITCHEN_A';
const B = 'FIXTURE_KITCHEN_B';
const AT = '2026-11-27T17:00:00.000Z';
const basic = (username: string) => ({ authorization: `Basic ${Buffer.from(`${username}:${PASSWORD}`).toString('base64')}` });
const read = (headers: HeadersInit) => messages(new Request(URL, { headers }), undefined);

async function account(username: string, locations: string[], role: Role = 'manager') {
  return getRepo().saveUser({ username, name: username, role, locations, active: true, passwordHash: hashPassword(PASSWORD) });
}

async function incident(locationCode: string | null, id: string = crypto.randomUUID()): Promise<string> {
  await getRepo().putDocs(INCIDENTS, [{ id, at: AT, data: { locationCode } }]);
  return id;
}

function row(id: string, at: string, source: Pick<OutboxEntry, 'incidentId' | 'orderId'> = {}): OutboxEntry {
  return { id, at, channel: 'call', to: '+1••••••0123', purpose: 'alert_shared_screen', ok: true, message: 'Calling', preview: `Fixture ${id}`, ...source };
}

async function saveRows(rows: OutboxEntry[]) {
  await getRepo().putDocs(OUTBOX, rows.map((entry) => ({ id: entry.id, at: entry.at, data: entry })));
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
  vi.stubEnv('SESSION_SECRET', 'fixture-message-history-session-secret');
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected external request')));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('prevents caching the anonymous rejection issued before the history route', async () => {
  const response = await proxy(new NextRequest(URL));
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).not.toHaveProperty('messages');
});

it('shows only incident history attributable to the signed-in kitchens and preserves the global log', async () => {
  const repo = getRepo();
  const a = await incident(A, '132a3459-5acc-8e70-a51f-9cbb2a5729fd');
  const b = await incident(B);
  const unattributed = await incident(null);
  const { order } = await repo.insertOrderIfNew({
    channel: 'skip', marketplace: 'skip', fulfillment: 'delivery', channelStoreId: 'fixture-store',
    externalOrderId: 'fixture-order', placedAt: AT, currency: 'CAD', subtotal: 0, tax: 0,
    deliveryFee: 0, tip: 0, discount: 0, total: 0, lines: [], raw: {}, locationCode: B,
  });
  const entries = [
    row('a-recent', '2026-11-27T17:00:05.000Z', { incidentId: a, orderId: order.id }),
    row('b', '2026-11-27T17:00:04.000Z', { incidentId: b }),
    row('no-kitchen', '2026-11-27T17:00:03.000Z', { incidentId: unattributed, orderId: order.id }),
    row('old-order', '2026-11-27T17:00:02.000Z', { orderId: order.id }),
    row('missing-incident', '2026-11-27T17:00:01.000Z', { incidentId: crypto.randomUUID() }),
    row('a-earlier', AT, { incidentId: a }),
    row('unlinked', '2026-11-27T16:59:59.000Z'),
  ];
  await saveRows(entries);
  await account('manager-a', [A]);
  await account('manager-b', [B]);
  await account('global-manager', []);
  await account('operator-a', [A], 'operator');
  for (const [username, expected] of [
    ['manager-a', [entries[0], entries[5]]], ['manager-b', [entries[1]]],
    ['global-manager', entries], ['owner', entries],
  ] as const) {
    const response = await read(basic(username));
    expect(response.status).toBe(200);
    expect.soft((await response.json()).messages).toEqual(expected);
    expect.soft(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  const denied = await read(basic('operator-a'));
  expect(denied.status).toBe(403);
  expect(denied.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await read({})).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it('restricts a tablet session to its assigned kitchen within the user scope', async () => {
  const a = await incident(A);
  const b = await incident(B);
  const first = row('on-the-tablet', '2026-11-27T17:00:02.000Z', { incidentId: a });
  const second = row('other-tablet', '2026-11-27T17:00:01.000Z', { incidentId: b });
  await saveRows([first, second]);
  const { device } = await enrollDevice({ name: 'Fixture tablet', locationCode: A }, { username: 'owner', name: 'Owner', source: 'dashboard' });
  const users = [await account('owner-without-location-limit', [], 'owner'), await account('manager-with-scope', [A, B]), await account('manager-other-kitchen', [B])];
  for (const [index, user] of users.entries()) {
    const cookie = (await sessionCookieFor(user, 'pin', device.id)).split(';')[0];
    const response = await read({ cookie });
    expect(response.status).toBe(200);
    expect.soft((await response.json()).messages).toEqual(index === 2 ? [] : [first]);
  }
});

it('queries incident ownership in bounded batches and fails closed if a batch cannot be read', async () => {
  const repo = getRepo();
  await account('manager-a', [A]);
  const ids = await Promise.all(Array.from({ length: 105 }, () => incident(A)));
  expect(await repo.listDocs(INCIDENTS, { ids: [] })).toEqual([]);
  await saveRows(ids.map((id, index) => row(`alert-${index}`, AT, { incidentId: id })));
  const original = repo.listDocs.bind(repo);
  const docs = vi.spyOn(repo, 'listDocs');
  const single = vi.spyOn(repo, 'getDoc');
  const result = await read(basic('manager-a'));
  expect(result.status).toBe(200);
  expect((await result.json()).messages).toHaveLength(ids.length);
  const loads = docs.mock.calls.filter(([collection]) => collection === INCIDENTS);
  expect(loads.map(([, filter]) => filter?.ids?.length)).toEqual([50, 50, 5]);
  expect(single).not.toHaveBeenCalled();

  docs.mockImplementation((collection, filter) => collection === INCIDENTS
    ? Promise.reject(new Error('Fixture history unavailable')) : original(collection, filter));
  const unavailable = await read(basic('manager-a'));
  expect.soft(unavailable.status).toBe(503);
  expect(unavailable.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await unavailable.json()).not.toHaveProperty('messages');
});
