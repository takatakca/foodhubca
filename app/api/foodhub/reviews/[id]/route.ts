import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { clearReply, draftAndSave, markReplied, MAX_DRAFT_CHARS, saveDraft } from '@/lib/foodhub/reviews/drafts';
import { getReview } from '@/lib/foodhub/reviews/model';
import { reviewInScope, reviewView } from '@/lib/foodhub/reviews/query';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = () => fail('Review not found', 404, { errorFr: 'Avis introuvable' });

// POST { action: 'draft' }          → proposes a reply, saved as a draft (never posted on any platform)
// POST { action: 'save', draft }    → saves the draft a person edited (same guard as the AI, 600 characters at most)
// POST { action: 'replied' }        → a person posted the reply in the platform's portal
// POST { action: 'clear' }          → removes the draft and the replied mark
export const POST = withPerm<Ctx>('menu:edit', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const r = await getReview(id);
  if (!r || !reviewInScope(actor, r)) return NOT_FOUND();
  const b = await readJson(req);
  if (b.action === 'draft') {
    const out = await draftAndSave(id, actor);
    return out ? ok({ review: reviewView(out.review), source: out.draft.source, rejected: out.draft.rejected ?? [] }) : NOT_FOUND();
  }
  if (b.action === 'save') {
    if (typeof b.draft !== 'string') return fail('Give the draft text.', 400, { errorFr: 'Donnez le texte du brouillon.' });
    if (b.draft.length > MAX_DRAFT_CHARS * 2) return fail(`Draft longer than ${MAX_DRAFT_CHARS} characters.`, 400, { errorFr: `Brouillon de plus de ${MAX_DRAFT_CHARS} caractères.`, reasons: [`longer than ${MAX_DRAFT_CHARS} characters`], reasonsFr: [`plus de ${MAX_DRAFT_CHARS} caractères`] });
    const out = await saveDraft(id, b.draft, actor);
    if (out.ok) return ok({ review: reviewView(out.review) });
    if (out.notFound) return NOT_FOUND();
    return fail(`Draft not saved: ${out.reasons.join(', ')}.`, 422, { errorFr: `Brouillon non enregistré : ${out.reasonsFr.join(', ')}.`, reasons: out.reasons, reasonsFr: out.reasonsFr });
  }
  if (b.action === 'replied' || b.action === 'clear') {
    const out = b.action === 'replied' ? await markReplied(id, actor) : await clearReply(id);
    return out ? ok({ review: reviewView(out) }) : NOT_FOUND();
  }
  return fail('Unknown action: use "draft", "save", "replied" or "clear".');
});
