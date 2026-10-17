// Status history: every pause, resume, platform change, busy mode, prep time, holiday closure and guard action, with
// its reason and result — read from the activity log (kinds store_status and hours). No downtime percentages here:
// analytics.ts (offlineIntervals) and the operations-quality page compute those.
import { HOLIDAY_REASON } from '../ops';
import { getRepo } from '../repo';
import type { ActivityEntry, ChannelKey } from '../types';
import { BUSY_KEPT_ACTION, BUSY_SCHEDULE_ACTION, GUARD_ACTOR } from './common';

export type HistoryEvent = 'pause' | 'resume' | `platform_${string}` | 'busy_on' | 'busy_off' | 'prep_time' | 'holiday_closure' | 'holiday'
  | 'hours' | 'guard_pause' | 'guard_resume' | 'reopen_failed' | 'busy_schedule' | 'busy_kept';
export type HistoryResult = 'ok' | 'blocked' | 'failed';

export interface HistoryRow {
  at: string;
  brand: string | null;
  kitchen: string | null;
  channel: ChannelKey | null;
  event: HistoryEvent;
  until: string | null;
  reason: string | null;
  by: string;
  result: HistoryResult;
  summary: string;
}

export interface HistoryFilter { from?: string; to?: string; locationCode?: string; locationCodes?: string[]; brandName?: string; channel?: ChannelKey }

function eventOf(a: ActivityEntry): HistoryEvent | null {
  const guard = a.actor === GUARD_ACTOR.name;
  switch (a.action) {
    case 'pause': return guard ? 'guard_pause' : a.summary.includes(`(${HOLIDAY_REASON})`) ? 'holiday_closure' : 'pause';
    case 'resume': return guard ? 'guard_resume' : 'resume';
    case 'busy_on': case 'busy_off': case 'prep_time': case 'reopen_failed': return a.action;
    case 'uber_prep_time': return 'prep_time';
    case 'store_deactivated': return 'platform_deactivated';
    case 'hours_saved': case 'skip_service_times': case 'retail_store_hours_pull': return 'hours';
    case 'special_days_added': return 'holiday';
    case BUSY_SCHEDULE_ACTION: return 'busy_schedule';
    case BUSY_KEPT_ACTION: return 'busy_kept';
    default: return a.action.startsWith('platform_') ? (a.action as HistoryEvent) : null;
  }
}

function resultOf(a: ActivityEntry): HistoryResult {
  if (a.status !== 'failed') return 'ok';
  const res = (a.detail?.result ?? null) as { status?: string } | null;
  // A switched-off live connector (or a missing key) refuses before anything is sent: shown as blocked, never as done.
  return res?.status === 'blocked' ? 'blocked' : 'failed';
}

/** "Store paused until 15:30 (Kitchen too busy) — Brand · LOC on Uber Eats" → "Kitchen too busy". */
function reasonOf(a: ActivityEntry): string | null {
  if (typeof a.detail?.reason === 'string' && a.detail.reason) return a.detail.reason;
  if (a.action !== 'pause') return null;
  const head = a.summary.split(' — ')[0];
  return head.match(/\(([^)]*)\)\s*$/)?.[1] ?? null;
}

function untilOf(a: ActivityEntry): string | null {
  const ms = Number(a.detail?.untilMs);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/** Most activity lines read for one history (newest first); beyond it the result says truncated. */
export const HISTORY_READ_LIMIT = 5000;

export async function statusHistory(filter: HistoryFilter = {}): Promise<HistoryRow[]> {
  return (await statusHistoryPage(filter)).rows;
}

/** The history, and whether older lines of the period were left out (more than HISTORY_READ_LIMIT log lines). */
export async function statusHistoryPage(filter: HistoryFilter = {}): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  // The log's upper bound is exclusive: one second ahead keeps a line written in this very millisecond (coarse clocks).
  const to = filter.to ?? new Date(Date.now() + 1000).toISOString();
  const from = filter.from ?? new Date(Date.parse(to) - 7 * 86400_000).toISOString();
  const locations = [...new Set([...(filter.locationCodes ?? []), ...(filter.locationCode ? [filter.locationCode] : [])])];
  const entries = await getRepo().listActivity({ since: from, until: to, kinds: ['store_status', 'hours'], ...(locations.length ? { locationCodes: locations } : {}), limit: HISTORY_READ_LIMIT });
  const rows: HistoryRow[] = [];
  for (const a of entries) {
    const event = eventOf(a);
    if (!event) continue;
    // The "not applied on any platform" line repeats the per-store lines just above it.
    if (a.kind === 'store_status' && !a.storeId && a.detail?.notSent && (a.action === 'pause' || a.action === 'resume')) continue;
    if (locations.length) {
      // Hours saved for every kitchen have no location: kept; any other line without a location is not this kitchen's.
      if (a.locationCode ? !locations.includes(a.locationCode) : a.kind !== 'hours') continue;
    }
    if (filter.brandName && a.brandName !== filter.brandName) continue;
    if (filter.channel && a.channel !== filter.channel) continue;
    rows.push({
      at: a.at, brand: a.brandName ?? null, kitchen: a.locationCode ?? null, channel: (a.channel ?? null) as ChannelKey | null,
      event, until: untilOf(a), reason: reasonOf(a), by: a.actor, result: resultOf(a), summary: a.summary,
    });
  }
  return { rows: rows.sort((x, y) => y.at.localeCompare(x.at)), truncated: entries.length >= HISTORY_READ_LIMIT };
}

const CSV_COLUMNS: Array<keyof HistoryRow> = ['at', 'kitchen', 'brand', 'channel', 'event', 'until', 'reason', 'by', 'result', 'summary'];

function cell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Quote everything that could break a cell. A formula start (= + - @, also after spaces) or a leading tab / carriage
  // return is neutralised with a quote, so a spreadsheet never runs a store name or a typed reason as a formula.
  const safe = /^\s*[=+\-@]|^[\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV (UTF-8 with BOM, so Excel shows the accents), one line per event. */
export function toCsv(rows: HistoryRow[]): string {
  const lines = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
