import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { clearReply, draftAndSave, markReplied } from '@/lib/foodhub/reviews/drafts';
import { getReview } from '@/lib/foodhub/reviews/model';
import { reviewInScope, reviewView } from '@/lib/foodhub/reviews/query';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

// POST { action: 'draft' }   → proposes a reply, saved as a draft (never posted on any platform)
// POST { action: 'replied' } → a person posted the reply in the platform's portal
// POST { action: 'clear' }   → removes the draft and the replied mark
export const POST = withPerm<Ctx>('menu:edit', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const r = await getReview(id);
  if (!r || !reviewInScope(actor, r)) return fail('Review not found', 404);
  const b = await readJson(req);
  if (b.action === 'draft') {
    const out = await draftAndSave(id, actor);
    return out ? ok({ review: reviewView(out.review), source: out.draft.source, rejected: out.draft.rejected ?? [] }) : fail('Review not found', 404);
  }
  if (b.action === 'replied' || b.action === 'clear') {
    const out = b.action === 'replied' ? await markReplied(id, actor) : await clearReply(id);
    return out ? ok({ review: reviewView(out) }) : fail('Review not found', 404);
  }
  return fail('Unknown action: use "draft", "replied" or "clear".');
});
