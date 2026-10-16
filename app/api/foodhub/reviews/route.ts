import { withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { parseLimit } from '@/lib/foodhub/report-filter';
import { PLATFORM_LABELS, REVIEW_PLATFORMS } from '@/lib/foodhub/reviews/model';
import { findReviews, parseReviewQuery, reviewView } from '@/lib/foodhub/reviews/query';
import { summarizeReviews } from '@/lib/foodhub/reviews/summary';
import { THEME_KEYS, THEMES } from '@/lib/foodhub/reviews/themes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/foodhub/reviews?brand=Po%20Poulet&platform=doordash&kitchen=HOCHELAGA&stars=1,2&unanswered=1&theme=cold&from=2026-09-01&to=2026-09-30
// The list and the summary respect the date range; the 7/30/90-day trend looks back from today. Only the person's kitchens.
export const GET = withPerm('analytics:view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const f = parseReviewQuery(q);
  const now = Date.now();
  const { all, listed } = await findReviews(actor, f);
  const limit = parseLimit(q.get('limit'), 100, 500);
  const brands = [...new Set(all.map((r) => r.brandName).filter((b): b is string => Boolean(b)))].sort();
  return ok({
    reviews: listed.slice(0, limit).map((r) => reviewView(r, now)),
    total: listed.length,
    summary: summarizeReviews(listed, now),
    trend: summarizeReviews(all, now).overall.trend,
    brands,
    platforms: REVIEW_PLATFORMS.map((key) => ({ key, label: PLATFORM_LABELS[key] })),
    themes: THEME_KEYS.map((key) => ({ key, fr: THEMES[key].fr, en: THEMES[key].en, negative: THEMES[key].negative })),
    aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});
