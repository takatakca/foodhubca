// Reviews hub: the numbers. Average rating, count, 1–5 distribution, 7 / 30 / 90-day trend against the period before,
// reviews waiting for a reply, top themes and the worst recent reviews; overall and per brand × platform × kitchen.
// Pure: the caller passes the reviews (already filtered to the person's kitchens) and the clock.
import { needsReply, type Review, type ReviewPlatform } from './model';
import { THEME_KEYS, type ThemeKey } from './themes';

const DAY = 86_400_000;
/** DoorDash lets the restaurant answer a review in its portal for 7 days. */
export const DOORDASH_REPLY_DAYS = 7;
export const TREND_WINDOWS = [7, 30, 90] as const;

export interface TrendWindow { days: number; count: number; avg: number | null; prevCount: number; prevAvg: number | null; delta: number | null }
export interface ReviewStats {
  count: number; rated: number; avg: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  unanswered: number; trend: TrendWindow[]; themes: Array<{ key: ThemeKey; count: number }>;
}
export interface ReviewGroup extends ReviewStats { brandName: string | null; platform: ReviewPlatform; locationCode: string | null; worst: Review[] }

const round2 = (n: number) => Math.round(n * 100) / 100;
const avgOf = (rs: Review[]) => { const s = rs.filter((r) => r.stars !== null); return s.length ? round2(s.reduce((a, r) => a + (r.stars ?? 0), 0) / s.length) : null; };

/**
 * Days left to answer in the DoorDash portal (7 minus the review's age in whole days, never below 0). Null for other
 * platforms, for reviews already answered and for star-only ratings. Informational: a person posts the reply there.
 */
export function daysLeftToReply(r: Pick<Review, 'platform' | 'at' | 'reply' | 'text'>, now = Date.now()): number | null {
  if (r.platform !== 'doordash' || !needsReply(r)) return null;
  const age = Math.floor((now - Date.parse(r.at)) / DAY);
  if (!Number.isFinite(age)) return null;
  return Math.max(0, DOORDASH_REPLY_DAYS - Math.max(0, age));
}

export function statsOf(reviews: Review[], now = Date.now()): ReviewStats {
  const distribution: ReviewStats['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) if (r.stars && r.stars >= 1 && r.stars <= 5) distribution[r.stars as 1 | 2 | 3 | 4 | 5]++;
  const trend = TREND_WINDOWS.map((days) => {
    const cur = reviews.filter((r) => { const t = Date.parse(r.at); return t > now - days * DAY && t <= now; });
    const prev = reviews.filter((r) => { const t = Date.parse(r.at); return t > now - 2 * days * DAY && t <= now - days * DAY; });
    const avg = avgOf(cur); const prevAvg = avgOf(prev);
    return { days, count: cur.length, avg, prevCount: prev.length, prevAvg, delta: avg !== null && prevAvg !== null ? round2(avg - prevAvg) : null };
  });
  const themeCount = new Map<ThemeKey, number>();
  for (const r of reviews) for (const k of r.themes ?? []) themeCount.set(k, (themeCount.get(k) ?? 0) + 1);
  const themes = THEME_KEYS.map((key) => ({ key, count: themeCount.get(key) ?? 0 })).filter((t) => t.count > 0).sort((a, b) => b.count - a.count);
  return {
    count: reviews.length, rated: reviews.filter((r) => r.stars !== null).length, avg: avgOf(reviews), distribution,
    unanswered: reviews.filter(needsReply).length, trend, themes,
  };
}

/** The 5 lowest-rated reviews of the last 30 days (newest first among equal stars); older ones when there are none. */
export function worstRecent(reviews: Review[], now = Date.now(), n = 5): Review[] {
  const rated = reviews.filter((r) => r.stars !== null && r.stars <= 3);
  const recent = rated.filter((r) => Date.parse(r.at) > now - 30 * DAY);
  const pool = recent.length ? recent : rated;
  return [...pool].sort((a, b) => (a.stars! - b.stars!) || b.at.localeCompare(a.at)).slice(0, n);
}

/** Overall stats plus one group per brand × platform × kitchen (most reviews first). */
export function summarizeReviews(reviews: Review[], now = Date.now()): { overall: ReviewStats; groups: ReviewGroup[] } {
  const groups = new Map<string, Review[]>();
  for (const r of reviews) {
    const k = `${r.brandName ?? ''}|${r.platform}|${r.locationCode ?? ''}`;
    const list = groups.get(k);
    if (list) list.push(r); else groups.set(k, [r]);
  }
  return {
    overall: statsOf(reviews, now),
    groups: [...groups.values()].map((rs) => ({
      brandName: rs[0].brandName, platform: rs[0].platform, locationCode: rs[0].locationCode, ...statsOf(rs, now), worst: worstRecent(rs, now),
    })).sort((a, b) => b.count - a.count || (a.brandName ?? '').localeCompare(b.brandName ?? '')),
  };
}
