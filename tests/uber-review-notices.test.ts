import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as channels } from '../app/api/foodhub/channels/route';
import { GET as reviewNotices } from '../app/api/foodhub/channels/uber-review/route';
import { sessionCookieFor } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import type { FoodHubUser } from '../lib/foodhub/types';
import { UBER_POLL_MISMATCH_REASON, type UberReviewPage } from '../lib/foodhub/uber-review';

const base = 'https://foodhub.example.test/api/foodhub/channels';
const firstKitchen = 'FIXTURE_A';
const secondKitchen = 'FIXTURE_B';
const firstStore = 'fixture-uber-a';
const secondStore = 'fixture-uber-b';

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('SESSION_SECRET', 'private-synthetic-session-seed-for-notice-tests');
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T14:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function actor(role: FoodHubUser['role'], locations: string[]) {
  const user = await getRepo().saveUser({ username: 'notice-reviewer', name: 'Notice reviewer', active: true, role, locations });
  return (await sessionCookieFor(user, 'password')).split(';')[0];
}

function request(cookie?: string, query = '') {
  return new Request(`${base}/uber-review${query}`, { headers: cookie ? { cookie } : {} });
}

function saveStore(channelStoreId: string, locationCode: string) {
  return getRepo().upsertStore({
    channel: 'uber_eats', channelStoreId, locationCode, brandName: 'Fixture brand', cloverMerchantId: null,
    autoAccept: true, online: true, meta: {},
  });
}

function saveNotice(storeRef: string, orderRef: string) {
  return getRepo().addJob({
    channel: 'uber_eats', kind: 'webhook_unparsed', status: 'error', reference: orderRef,
    request: { replayable: false, body: { meta: { resource_id: orderRef, user_id: storeRef }, fixturePrivatePayload: 'omit-from-public-response' } },
    result: { reason: UBER_POLL_MISMATCH_REASON, fixturePrivateDetails: 'omit-from-public-response' },
  });
}

describe('Uber review-only polling notices', () => {
  it('serves older eligible notices behind the 40 latest unrelated jobs and pages by stable timestamp and id', async () => {
    const cookie = await actor('owner', []);
    const notices = await Promise.all(Array.from({ length: 6 }, (_, i) => saveNotice(firstStore, `order-${i}`)));
    vi.setSystemTime(new Date('2026-11-26T14:30:00.000Z'));
    for (let i = 0; i < 41; i++) await getRepo().addJob({ channel: 'uber_eats', kind: 'menu_push', status: 'done', request: {} });
    expect((await getRepo().listJobs(40)).every((job) => job.kind === 'menu_push')).toBe(true);

    const first = await reviewNotices(request(cookie), undefined);
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
    const page: UberReviewPage = await first.json();
    const sorted = notices.sort((a, b) => b.id.localeCompare(a.id));
    expect(page).toEqual({
      ok: true, offset: 0, hasMore: true,
      notices: sorted.slice(0, 5).map((job) => ({
        id: job.id, createdAt: job.createdAt, reason: 'order_store_mismatch', orderRef: job.reference, storeRef: firstStore,
      })),
    });
    const last = await reviewNotices(request(cookie, '?offset=5'), undefined);
    expect(await last.json()).toMatchObject({ offset: 5, hasMore: false, notices: [{ id: sorted[5].id }] });
  });

  it('filters by allowed stores before choosing a page and keeps review notices out of generic Channels', async () => {
    const cookie = await actor('manager', [firstKitchen]);
    await saveStore(firstStore, firstKitchen);
    await saveStore(secondStore, secondKitchen);
    const own = await saveNotice(firstStore, 'own-listed-order');
    vi.setSystemTime(new Date('2026-11-26T14:30:00.000Z'));
    for (let i = 0; i < 6; i++) await saveNotice(secondStore, `other-listed-order-${i}`);
    const generic = await getRepo().addJob({
      channel: 'uber_eats', kind: 'webhook_unparsed', status: 'error', reference: 'ordinary',
      request: { body: { ordinary: true } }, result: { reason: 'Ordinary parser notice' },
    });

    const scoped = await reviewNotices(request(cookie), undefined);
    expect(await scoped.json()).toEqual({
      ok: true, offset: 0, hasMore: false,
      notices: [{ id: own.id, createdAt: own.createdAt, reason: 'order_store_mismatch', orderRef: 'own-listed-order', storeRef: firstStore }],
    });
    const response = await channels(new Request(base, { headers: { cookie } }), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unparsed: [{ id: generic.id, request: { body: { ordinary: true } } }] });
  });

  it('returns an empty page to a mapped manager with zero eligible stores and rejects anonymous reads', async () => {
    const cookie = await actor('manager', [firstKitchen]);
    await saveStore(secondStore, secondKitchen);
    await saveNotice(secondStore, 'other-listed-order');
    const empty = await reviewNotices(request(cookie), undefined);
    expect(await empty.json()).toEqual({ ok: true, offset: 0, hasMore: false, notices: [] });
    expect((await reviewNotices(request(), undefined)).status).toBe(401);
    expect((await reviewNotices(request(cookie, '?offset=-1'), undefined)).status).toBe(400);
    const operator = await actor('operator', [firstKitchen]);
    expect((await reviewNotices(request(operator), undefined)).status).toBe(403);
  });
});
