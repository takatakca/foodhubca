// Kitchen order tools — the minutes each "Rupture" (86) choice sends. Pure (no server import): the order drawer and
// the tests both use it.
//
// The drawer can stay open for hours (it polls the order), so the closing time comes as an absolute instant (closesAt,
// from GET /api/foodhub/order-tools/<id>/line-refs) and the minutes are counted at the moment of the tap, never from a
// number fetched when the list was opened.
import { localParts, localWallToUtcMs } from '../time';

export type Quick86Choice = 'close' | 'four' | 'today' | 'forever';

/** Next local midnight after `now` (epoch ms), DST-safe: the wall clock of tomorrow 00:00, not "+ 24 h". */
export function nextLocalMidnightMs(now = Date.now(), timeZone?: string): number {
  const p = localParts(now, timeZone);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return localWallToUtcMs(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 0, 0, timeZone);
}

/**
 * Minutes each choice means at `now`; null = not offered.
 *   close   until this brand closes here (null when hours are not set, or the closing time has passed);
 *   four    4 h;
 *   today   until close; without a known closing time, until local midnight;
 *   forever 0 (= until someone turns it back on).
 */
export function quick86Minutes(choice: Quick86Choice, closesAt: string | null | undefined, now = Date.now(), timeZone?: string): number | null {
  if (choice === 'forever') return 0;
  if (choice === 'four') return 240;
  const close = closesAt ? Date.parse(closesAt) : NaN;
  if (Number.isFinite(close) && close > now) return Math.max(1, Math.ceil((close - now) / 60_000));
  if (choice === 'today') return Math.max(1, Math.ceil((nextLocalMidnightMs(now, timeZone) - now) / 60_000));
  return null;
}
