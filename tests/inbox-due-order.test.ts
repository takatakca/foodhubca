import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInboxEntry, INBOX, sweepInbox, type InboxEntry } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const now = Date.parse('2026-11-28T13:30:00.000Z');
const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();

function receipt(id: string, received: number, status: InboxEntry['status'], dates: Partial<InboxEntry> = {}) {
  const entry: InboxEntry = {
    id, channel: 'uber_eats', kind: 'uber', reference: null, body: { event_type: 'orders.release' },
    status, receivedAt: at(received), updatedAt: at(received), attempts: 1, ...dates,
  };
  return { id, key: status, at: entry.receivedAt, data: entry };
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_E2E', '0');
  vi.stubEnv('LIVE_CONNECTORS_GLOBAL_ENABLED', 'false');
  vi.stubGlobal('__foodhubMem', undefined);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external request'); }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('webhook inbox due selection', () => {
  it('recovers old interrupted and due retry receipts behind 500 held, fresh or future receipts', async () => {
    const held = Array.from({ length: 500 }, (_, i) => {
      if (i % 3 === 0) return receipt(`held-${i}`, -60, 'failed', { nextAt: null });
      if (i % 3 === 1) return receipt(`held-${i}`, -60, 'received');
      return receipt(`held-${i}`, -60, 'failed', { nextAt: at(1) });
    });
    await getRepo().putDocs(INBOX, [
      receipt('oldest', -180, 'processing'),
      receipt('retry', -160, 'failed', { nextAt: at(0) }),
      receipt('pending', -120, 'received'),
      ...held,
    ]);

    expect(await sweepInbox({ now, limit: 2 })).toEqual({ processed: 2, failed: 0 });
    expect(await getInboxEntry('oldest')).toMatchObject({ status: 'done', attempts: 2 });
    expect(await getInboxEntry('retry')).toMatchObject({ status: 'done', attempts: 2 });
    expect(await getInboxEntry('pending')).toMatchObject({ status: 'received', attempts: 1 });
    expect(await sweepInbox({ now, limit: 2 })).toEqual({ processed: 1, failed: 0 });
    expect(await sweepInbox({ now, limit: 2 })).toEqual({ processed: 0, failed: 0 });
    expect(await getInboxEntry('held-0')).toMatchObject({ status: 'failed', nextAt: null, attempts: 1 });
    expect(await getInboxEntry('held-1')).toMatchObject({ status: 'received', attempts: 1 });
    expect(await getInboxEntry('held-2')).toMatchObject({ status: 'failed', nextAt: at(1), attempts: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps malformed and mismatched receipts out and breaks receipt-time ties by ID', async () => {
    const wrongKey = receipt('wrong-key', -240, 'received');
    await getRepo().putDocs(INBOX, [
      receipt('invalid-retry', -240, 'failed', { nextAt: '2026-02-30T12:30:00.000Z' }),
      receipt('invalid-update', -240, 'processing', { updatedAt: 'invalid' }),
      receipt('missing-retry', -240, 'failed'),
      { ...wrongKey, key: 'processing' },
      receipt('b-retry', -160, 'failed', { nextAt: at(0) }),
      receipt('a-interrupted', -160, 'processing'),
    ]);

    expect(await sweepInbox({ now, limit: 1 })).toEqual({ processed: 1, failed: 0 });
    expect(await getInboxEntry('a-interrupted')).toMatchObject({ status: 'done' });
    expect(await getInboxEntry('b-retry')).toMatchObject({ status: 'failed' });
    expect(await sweepInbox({ now })).toEqual({ processed: 1, failed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('queries only due cohorts in PostgREST, with bounded oldest-first pages', async () => {
    vi.stubEnv('FOODHUB_FORCE_MEMORY', 'false');
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');

    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const filters = url.searchParams;
      expect(url.origin + url.pathname).toBe('https://db.example.test/rest/v1/fh_docs');
      expect(filters.get('collection')).toBe(`eq.${INBOX}`);
      expect(filters.get('at')).toBe('not.is.null');
      expect(filters.get('order')).toBe('at.asc,id.asc');
      expect(filters.get('limit')).toBe('1');
      const retry = filters.get('key') === 'in.(failed)';
      const statuses = retry ? 'in.(failed)' : 'in.(received,processing)';
      expect(filters.get('key')).toBe(statuses);
      expect(filters.get('data->>status')).toBe(statuses);
      const date = retry ? 'nextAt' : 'updatedAt';
      const offset = filters.get('offset');
      expect(filters.getAll(`data->>${date}`)).toEqual([expect.stringMatching(/^match\./), `lte.${at(retry ? 0 : -120)}`]);

      if (!retry) {
        expect(offset).toBe('0');
        return Response.json([receipt('interrupted', -140, 'processing')]);
      }
      if (offset === '0') return Response.json([receipt('invalid', -200, 'failed', { nextAt: '2026-02-30T12:30:00.000Z' })]);
      expect(offset).toBe('1');
      return Response.json([receipt('retry', -160, 'failed', { nextAt: at(0) })]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const due = await getRepo().listDueInboxEntries(INBOX, { interruptedAt: at(-120), retryAt: at(0), limit: 1 });
    expect(due.map(({ id }) => id)).toEqual(['retry']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
