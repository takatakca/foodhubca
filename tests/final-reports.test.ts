// 1.4.0 final — reports, schedules, analytics and filters: cron catch-up (EST + EDT), send-then-claim with
// retry, strict schedule reads, hasOwn report keys, Resend error detail, numeric CSV cells, DST-safe previous
// period, uptime seeded from the store record, limit sanitising.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { duePeriod, isReportKey, ownsSchedule, toCsv } from '../lib/foodhub/reports';
import { seedState } from '../lib/foodhub/analytics';
import { parseLimit, parseRange } from '../lib/foodhub/report-filter';
import type { ActivityEntry } from '../lib/foodhub/types';

const manager = { username: 'marie', name: 'Marie', source: 'dashboard' as const };
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('report schedule periods (catch-up, Montréal time)', () => {
  beforeEach(() => { process.env.FOODHUB_TIMEZONE = 'America/Toronto'; });

  it('is not due before 8:00 local in winter either (12:05Z = 07:05 EST), due at 13:05Z year-round', () => {
    expect(duePeriod('daily', Date.parse('2026-12-15T12:05:00Z'))).toBeNull();
    const d = duePeriod('daily', Date.parse('2026-12-15T13:05:00Z'));
    expect(d).toMatchObject({ key: 'd:2026-12-14', from: '2026-12-14T05:00:00.000Z', to: '2026-12-15T05:00:00.000Z', label: '2026-12-14' });
    expect(duePeriod('daily', Date.parse('2026-07-15T13:05:00Z'))?.key).toBe('d:2026-07-14'); // 09:05 EDT
  });

  it('weekly: the last complete Mon–Sun whatever the weekday', () => {
    // Wednesday Dec 16 2026 → Mon Dec 7 → Sun Dec 13 (this week's Monday is Dec 14)
    const w = duePeriod('weekly', Date.parse('2026-12-16T13:05:00Z'));
    expect(w).toMatchObject({ key: 'w:2026-12-07', from: '2026-12-07T05:00:00.000Z', to: '2026-12-14T05:00:00.000Z' });
    expect(duePeriod('weekly', Date.parse('2026-12-14T13:05:00Z'))?.key).toBe('w:2026-12-07'); // Monday itself
    expect(duePeriod('weekly', Date.parse('2026-12-20T13:05:00Z'))?.key).toBe('w:2026-12-07'); // Sunday: week not complete yet
  });

  it('monthly: the previous calendar month on any day, across the DST change', () => {
    const m = duePeriod('monthly', Date.parse('2026-11-15T13:05:00Z'));
    expect(m).toMatchObject({ key: 'm:2026-10', from: '2026-10-01T04:00:00.000Z', to: '2026-11-01T04:00:00.000Z', label: '2026-10' });
    expect(duePeriod('monthly', Date.parse('2027-01-01T13:05:00Z'))?.key).toBe('m:2026-12'); // Jan 1 08:05 EST
    expect(duePeriod('monthly', Date.parse('2027-01-02T13:05:00Z'))?.key).toBe('m:2026-12'); // missed Jan 1 → still sent
  });
});

describe('report keys and CSV cells', () => {
  it('only real report keys pass (no "constructor" / "toString" via the prototype)', () => {
    expect(isReportKey('order_transactions')).toBe(true);
    expect(isReportKey('constructor')).toBe(false);
    expect(isReportKey('toString')).toBe(false);
    expect(isReportKey('__proto__')).toBe(false);
    expect(isReportKey(undefined)).toBe(false);
  });
  it('numeric-looking strings stay numbers; formula-like text is still neutralised', () => {
    const csv = toCsv({ key: 'order_transactions', title: 'T', filename: 'f', columns: ['A', 'B', 'C', 'D'], rows: [['-3.40', '=SUM(A1)', '-x', -5]] });
    expect(csv.replace(/^﻿/, '').split('\r\n')[1]).toBe(`-3.40,"'=SUM(A1)","'-x",-5`);
  });
  it('ownership: by username when recorded, by display name for older schedules', () => {
    const base = { id: '1', report: 'items_summary' as const, frequency: 'daily' as const, emails: [], format: 'csv' as const, filter: {}, createdAt: '' };
    expect(ownsSchedule({ ...base, createdBy: 'Someone', createdByUsername: 'marie' }, manager)).toBe(true);
    expect(ownsSchedule({ ...base, createdBy: 'Marie', createdByUsername: 'owner' }, manager)).toBe(false);
    expect(ownsSchedule({ ...base, createdBy: 'Marie' }, manager)).toBe(true);
  });
});

describe('schedules in the memory store: strict reads, send-then-claim, retry, no clobber', () => {
  const now = Date.parse('2026-10-02T13:00:00Z'); // 09:00 EDT, Friday
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    process.env.FOODHUB_TIMEZONE = 'America/Toronto';
    process.env.RESEND_API_KEY = 're_test';
    process.env.REPORT_EMAIL_FROM = 'reports@takatak.example';
    (globalThis as any).__foodhubMem = undefined;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects prototype keys, records the creator, and never wipes the list on a failed read', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { listReportSchedules, saveReportSchedule, deleteReportSchedule } = await import('../lib/foodhub/reports');
    await expect(saveReportSchedule({ report: 'constructor' as any, frequency: 'daily', emails: ['a@b.co'], format: 'csv', filter: {} }, manager)).rejects.toThrow(/Unknown report/);
    const s = await saveReportSchedule({ report: 'items_summary', frequency: 'daily', emails: ['a@b.co'], format: 'csv', filter: {} }, manager);
    expect(s).toMatchObject({ createdBy: 'Marie', createdByUsername: 'marie' });
    vi.spyOn(getRepo(), 'getKv').mockRejectedValueOnce(new Error('Supabase: statement timeout'));
    await expect(saveReportSchedule({ report: 'item_wise', frequency: 'weekly', emails: ['c@d.co'], format: 'xlsx', filter: {} }, manager)).rejects.toThrow(/timeout/);
    expect((await listReportSchedules()).map((x) => x.id)).toEqual([s.id]); // the five-existing-schedules-gone scenario cannot happen
    vi.spyOn(getRepo(), 'getKv').mockRejectedValueOnce(new Error('Supabase: down'));
    await expect(deleteReportSchedule(s.id, manager)).rejects.toThrow(/down/);
    expect(await listReportSchedules()).toHaveLength(1);
  });

  it('claims the period only after a successful send; failures record lastError + a failed activity entry and retry hourly', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { listReportSchedules, saveReportSchedule, sendDueReports } = await import('../lib/foodhub/reports');
    const s = await saveReportSchedule({ report: 'items_summary', frequency: 'daily', emails: ['a@b.co'], format: 'csv', filter: {} }, manager);

    fetchMock.mockResolvedValueOnce(jsonRes(403, { name: 'validation_error', message: 'The takatak.example domain is not verified' }));
    expect(await sendDueReports(now)).toBe(0);
    let [after] = await listReportSchedules();
    expect(after.lastPeriod).toBeUndefined();
    expect(after.lastSentAt).toBeUndefined();
    expect(after.lastError).toBe('Email provider returned HTTP 403: The takatak.example domain is not verified');
    const failed = (await getRepo().listActivity({ kinds: ['settings'] })).filter((e) => e.action === 'report_email');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: 'failed', source: 'schedule' });
    expect(failed[0].summary).toContain('domain is not verified');

    // Within the hour (the 2-minute auto-sync) → no new attempt.
    expect(await sendDueReports(now + 10 * 60_000)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Next run after the back-off: sent, claimed, error cleared.
    fetchMock.mockResolvedValueOnce(jsonRes(200, { id: 'email-1' }));
    expect(await sendDueReports(now + 2 * 3600_000)).toBe(1);
    [after] = await listReportSchedules();
    expect(after).toMatchObject({ id: s.id, lastPeriod: 'd:2026-10-01', lastError: null });
    expect(after.lastSentAt).toBe(new Date(now + 2 * 3600_000).toISOString());
    expect(await sendDueReports(now + 3 * 3600_000)).toBe(0); // never twice for the same period
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a build error is contained: other schedules still run and the failing one keeps its period due', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { listReportSchedules, saveReportSchedule, sendDueReports } = await import('../lib/foodhub/reports');
    const bad = await saveReportSchedule({ report: 'order_transactions', frequency: 'weekly', emails: ['a@b.co'], format: 'csv', filter: {} }, manager);
    const good = await saveReportSchedule({ report: 'store_actions', frequency: 'daily', emails: ['a@b.co'], format: 'csv', filter: {} }, manager);
    vi.spyOn(getRepo(), 'listOrders').mockRejectedValueOnce(new Error('Supabase: canceling statement due to statement timeout'));
    fetchMock.mockResolvedValue(jsonRes(200, { id: 'email-2' }));
    expect(await sendDueReports(now)).toBe(1);
    const all = await listReportSchedules();
    expect(all.find((x) => x.id === bad.id)).toMatchObject({ lastError: expect.stringMatching(/^Report failed: .*statement timeout/) });
    expect(all.find((x) => x.id === bad.id)?.lastPeriod).toBeUndefined();
    expect(all.find((x) => x.id === good.id)).toMatchObject({ lastPeriod: 'd:2026-10-01', lastError: null });
  });

  it('a schedule created by a user during the run survives (per-schedule patch, no whole-list rewrite)', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { listReportSchedules, saveReportSchedule, sendDueReports } = await import('../lib/foodhub/reports');
    const first = await saveReportSchedule({ report: 'items_summary', frequency: 'daily', emails: ['a@b.co'], format: 'csv', filter: {} }, manager);
    let added: string | undefined;
    fetchMock.mockImplementationOnce(async () => {
      // Someone saves a second schedule while the first report is being emailed.
      added = (await saveReportSchedule({ report: 'option_wise', frequency: 'monthly', emails: ['z@b.co'], format: 'xlsx', filter: {} }, manager)).id;
      return jsonRes(200, { id: 'email-3' });
    });
    expect(await sendDueReports(now)).toBe(1);
    const ids = (await listReportSchedules()).map((x) => x.id).sort();
    expect(ids).toEqual([first.id, added].sort());
    expect((await getRepo().getKv<any[]>('report_schedules'))!.find((x) => x.id === first.id).lastPeriod).toBe('d:2026-10-01');
  });

  it('Resend error bodies are surfaced (truncated to 300 chars)', async () => {
    const { emailReport } = await import('../lib/foodhub/reports');
    const table = { key: 'items_summary' as const, title: 'Items', filename: 'f', columns: ['a'], rows: [] };
    fetchMock.mockResolvedValueOnce(jsonRes(422, { message: 'Invalid `to` field' }));
    expect((await emailReport(table, ['x@y.z'], 'csv')).message).toBe('Email provider returned HTTP 422: Invalid `to` field');
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(1000), { status: 500 }));
    const long = (await emailReport(table, ['x@y.z'], 'csv')).message;
    expect(long.startsWith('Email provider returned HTTP 500: xxx')).toBe(true);
    expect(long.length).toBeLessThanOrEqual('Email provider returned HTTP 500: '.length + 300);
  });
});

describe('analytics: previous period in local days, uptime seed, limits', () => {
  beforeEach(() => {
    process.env.FOODHUB_FORCE_MEMORY = 'true';
    process.env.FOODHUB_TIMEZONE = 'America/Toronto';
    (globalThis as any).__foodhubMem = undefined;
  });

  it('previous period starts at local midnight across the fall-back and spring-forward changes, aligned by day', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { buildAnalytics } = await import('../lib/foodhub/analytics');
    const repo = getRepo();
    const base = { channel: 'uber_eats' as const, marketplace: 'uber_eats' as const, channelStoreId: 'store-1', fulfillment: 'delivery' as const, currency: 'CAD', subtotal: 10, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 10, lines: [], raw: {} };
    // Oct 2 2026 12:00 EDT = first day of the previous period for Nov 1–30; Oct 1 23:30 EDT is outside it.
    for (const [id, at] of [['p-1', '2026-10-02T16:00:00.000Z'], ['p-0', '2026-10-02T03:30:00.000Z']]) {
      const { order } = await repo.insertOrderIfNew({ ...base, externalOrderId: id, placedAt: at, createdAt: at });
      await repo.updateOrder(order.id, { status: 'completed' });
    }
    const a = await buildAnalytics({ from: '2026-11-01T04:00:00.000Z', to: '2026-12-01T05:00:00.000Z' }, Date.parse('2026-12-02T12:00:00Z'));
    expect(a.range).toMatchObject({ days: 30, previousFrom: '2026-10-02T04:00:00.000Z', previousTo: '2026-11-01T04:00:00.000Z', truncated: false });
    expect(a.daily[0]).toMatchObject({ date: '2026-11-01', prevSales: 10, prevOrders: 1 }); // Oct 2 lines up with Nov 1, not Nov 2
    expect(a.daily[1].prevOrders).toBe(0);
    expect(a.kpis.orders.previous).toBe(1);
    const b = await buildAnalytics({ from: '2026-03-01T05:00:00.000Z', to: '2026-04-01T04:00:00.000Z' }, Date.parse('2026-04-02T12:00:00Z'));
    expect(b.range).toMatchObject({ days: 31, previousFrom: '2026-01-29T05:00:00.000Z', previousTo: '2026-03-01T05:00:00.000Z' });
  });

  it('seeds the uptime state from the store record when no status change precedes the range', () => {
    const e = (at: string, action: string): ActivityEntry => ({ at, action, kind: 'store_status', storeId: 's1', status: 'success', actor: 'x', source: 'platform', summary: '' });
    const from = Date.parse('2026-10-01T14:00:00Z');
    expect(seedState([], { id: 's1', online: false }, from)).toBe('offline'); // deactivated two months ago, no events since
    expect(seedState([], { id: 's1', online: true }, from)).toBe('online');
    expect(seedState([e('2026-10-01T15:00:00Z', 'pause')], { id: 's1', online: false }, from)).toBe('online'); // it was online until the pause
    expect(seedState([e('2026-10-01T15:00:00Z', 'resume')], { id: 's1', online: true }, from)).toBe('offline');
    expect(seedState([e('2026-09-30T15:00:00Z', 'platform_deactivated')], { id: 's1', online: true }, from)).toBe('online'); // history decides
  });

  it('a store deactivated before the lookback window shows 0 % uptime, not 100 %', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { buildAnalytics } = await import('../lib/foodhub/analytics');
    const repo = getRepo();
    await repo.upsertStore({ channel: 'doordash', channelStoreId: 'dd-1', brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD', autoAccept: true, online: false, meta: {} });
    await repo.upsertStore({ channel: 'uber_eats', channelStoreId: 'ub-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} });
    const a = await buildAnalytics({ from: '2026-10-01T04:00:00.000Z', to: '2026-10-02T04:00:00.000Z' }, Date.parse('2026-10-03T12:00:00Z'));
    const dd = a.uptime.stores.find((s) => s.channel === 'doordash')!;
    const ub = a.uptime.stores.find((s) => s.channel === 'uber_eats')!;
    expect(dd.uptimePct).toBe(0);
    expect(dd.offlineMinutes).toBe(dd.openMinutes);
    expect(ub.uptimePct).toBe(100);
  });

  it('parseLimit never yields NaN, zero or more than the cap', () => {
    expect(parseLimit('abc', 500, 5000)).toBe(500);
    expect(parseLimit('all', 500, 5000)).toBe(500);
    expect(parseLimit(null, 50, 1000)).toBe(50);
    expect(parseLimit('0', 500, 5000)).toBe(500);
    expect(parseLimit('-3', 500, 5000)).toBe(500);
    expect(parseLimit('12.7', 500, 5000)).toBe(12);
    expect(parseLimit('99999', 500, 5000)).toBe(5000);
  });

  it('parseRange: the default start is counted in local days, not 24-hour blocks', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse('2026-11-06T04:30:00Z')); // Nov 5 23:30 EST; 6 × 24 h back would be Oct 31 00:30 EDT
      const r = parseRange(new URLSearchParams(), 7);
      expect(r.from).toBe('2026-10-30T04:00:00.000Z'); // Oct 30 00:00 EDT → 7 business days up to Nov 5
      expect(r.to).toBe('2026-11-06T05:00:00.000Z');
      expect(() => parseRange(new URLSearchParams({ from: '2026-01-10', to: '2026-01-01' }))).toThrow(/Invalid date range/);
    } finally { vi.useRealTimers(); }
  });
});
