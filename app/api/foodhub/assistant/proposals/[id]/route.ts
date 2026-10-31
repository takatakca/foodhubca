import { withPerm } from '@/lib/foodhub/auth';
import { decideProposal } from '@/lib/foodhub/assistant/approve';
import { updateProposalInChat } from '@/lib/foodhub/assistant/history';
import { getProposal, viewOf } from '@/lib/foodhub/assistant/proposals';
import { fail, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

// POST { decision: 'approve' | 'dismiss' } on one assistant card. Approve runs Food Hub's existing gated route as the
// signed-in person (role, kitchens, manager PIN via 428 + x-approval-pin, locks, live switch); Dismiss changes nothing.
// Only the card's author decides, once. The assistant itself never calls this.
export const POST = withPerm<Ctx>('view', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (b.decision !== 'approve' && b.decision !== 'dismiss') return fail('decision must be approve or dismiss');
  const res = await decideProposal(req, actor, id, b.decision);
  const rec = await getProposal(id);
  if (rec && rec.createdBy === actor.username && rec.status !== 'pending') await updateProposalInChat(actor.username, rec.chatId, viewOf(rec)).catch(() => undefined);
  return res;
});
