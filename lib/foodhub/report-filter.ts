// Parses report/analytics filters from a query string and applies the signed-in user's location scope.
import type { AuthUser } from './auth';
import { scopeFilter } from './auth';
import { isChannelKey } from './adapters';
import { startOfLocalDayMs } from './time';
import type { ChannelKey, OrderStatus } from './types';

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** from/to accept YYYY-MM-DD (local business days, `to` inclusive) or full ISO timestamps. */
export function parseRange(q: URLSearchParams, defaultDays = 1): { from: string; to: string } {
  const now = Date.now();
  const day = (s: string) => startOfLocalDayMs(Date.parse(`${s}T12:00:00Z`));
  // Default start = (defaultDays - 1) local days back, stepped by day so a DST change does not land it at 23:00/01:00.
  const defaultFrom = () => { let ms = startOfLocalDayMs(now); for (let i = 1; i < defaultDays; i++) ms = startOfLocalDayMs(ms - 12 * 3600_000); return ms; };
  const fromQ = q.get('from'); const toQ = q.get('to');
  const from = fromQ ? (/^\d{4}-\d{2}-\d{2}$/.test(fromQ) ? day(fromQ) : Date.parse(fromQ)) : defaultFrom();
  const to = toQ ? (/^\d{4}-\d{2}-\d{2}$/.test(toQ) ? startOfLocalDayMs(day(toQ) + 36 * 3600_000) : Date.parse(toQ)) : startOfLocalDayMs(startOfLocalDayMs(now) + 36 * 3600_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Invalid date range.');
  if (to - from > 400 * 86400_000) throw new Error('Pick a range of 400 days or less.');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** `limit` query value → a positive integer ≤ max (NaN, "all", 0, negatives and fractions fall back / floor). */
export function parseLimit(v: string | null | undefined, def: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

export function parseFilters(q: URLSearchParams, actor: AuthUser) {
  return {
    locationCodes: scopeFilter(actor, list(q.get('locations'))),
    channels: list(q.get('channels')).filter(isChannelKey) as ChannelKey[],
    brands: list(q.get('brands')),
    statuses: list(q.get('statuses')) as OrderStatus[],
  };
}
