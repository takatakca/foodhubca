import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { draftBatch, MAX_BATCH } from '@/lib/foodhub/reviews/drafts';
import { findReviews, parseReviewQuery } from '@/lib/foodhub/reviews/query';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST { ids?: string[] } (+ the page's filters in the query string) → proposes replies for the unanswered reviews
// without a draft, at most 25, one after the other. Drafts only: Food Hub never posts a reply on a platform.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const f = { ...parseReviewQuery(new URL(req.url).searchParams), unanswered: true };
  const b = await readJson(req);
  const only = Array.isArray(b.ids) ? new Set<string>(b.ids.map(String)) : null;
  const { listed } = await findReviews(actor, f);
  const waiting = listed.filter((r) => (only ? only.has(r.id) : !r.reply?.draft));
  const out = await draftBatch(waiting.slice(0, MAX_BATCH), actor);
  return ok({ ...out, remaining: Math.max(0, waiting.length - out.drafted) });
});
