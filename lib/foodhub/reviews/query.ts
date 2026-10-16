// Reviews hub: filters from the page's query string, and the signed-in person's kitchens. A person limited to some
// kitchens only ever sees (and drafts for) the reviews of those kitchens; a review not linked to a kitchen is shown
// to people who see every kitchen only.
import type { AuthUser } from '../auth';
import { isReviewPlatform, listReviews, needsReply, type Review, type ReviewPlatform } from './model';
import { daysLeftToReply } from './summary';
import { isThemeKey, type ThemeKey } from './themes';

export interface ReviewQuery {
  brands: string[]; platforms: ReviewPlatform[]; kitchens: string[]; stars: number[]; unanswered: boolean; themes: ThemeKey[];
  from: string | null; to: string | null;
}

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseReviewQuery(q: URLSearchParams): ReviewQuery {
  const from = q.get('from'); const to = q.get('to');
  return {
    brands: [...list(q.get('brand')), ...list(q.get('brands'))],
    platforms: [...list(q.get('platform')), ...list(q.get('platforms'))].filter(isReviewPlatform),
    kitchens: [...list(q.get('kitchen')), ...list(q.get('locations'))],
    stars: list(q.get('stars')).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    unanswered: /^(1|true|yes)$/i.test(q.get('unanswered') ?? ''),
    themes: list(q.get('theme')).filter(isThemeKey),
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
  };
}

/** True when the person may see this review (location scope; [] = every kitchen). */
export function reviewInScope(actor: Pick<AuthUser, 'locations'>, r: Pick<Review, 'locationCode'>): boolean {
  return actor.locations.length === 0 || (!!r.locationCode && actor.locations.includes(r.locationCode));
}

/** Everything but the date range (the summary compares periods, so it needs the reviews before `from` too). */
export function matchesFilters(r: Review, f: ReviewQuery): boolean {
  if (f.brands.length && !(r.brandName && f.brands.includes(r.brandName))) return false;
  if (f.platforms.length && !f.platforms.includes(r.platform)) return false;
  if (f.kitchens.length && !(r.locationCode && f.kitchens.includes(r.locationCode))) return false;
  if (f.stars.length && !(r.stars !== null && f.stars.includes(r.stars))) return false;
  if (f.unanswered && !needsReply(r)) return false;
  if (f.themes.length && !f.themes.some((t) => r.themes.includes(t))) return false;
  return true;
}

export function inRange(r: Pick<Review, 'at'>, f: Pick<ReviewQuery, 'from' | 'to'>): boolean {
  const day = r.at.slice(0, 10);
  return (!f.from || day >= f.from) && (!f.to || day <= f.to);
}

/** The person's reviews matching the filters: `all` ignores the date range (for trends), `listed` respects it. */
export async function findReviews(actor: Pick<AuthUser, 'locations'>, f: ReviewQuery): Promise<{ all: Review[]; listed: Review[] }> {
  const all = (await listReviews()).filter((r) => reviewInScope(actor, r) && matchesFilters(r, f));
  return { all, listed: all.filter((r) => inRange(r, f)).sort((a, b) => b.at.localeCompare(a.at)) };
}

/** What the page shows for one review (days left to answer on DoorDash added). */
export function reviewView(r: Review, now = Date.now()) {
  return { ...r, daysLeft: daysLeftToReply(r, now), needsReply: needsReply(r) };
}
