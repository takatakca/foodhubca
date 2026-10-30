import { inScope, withPerm } from '@/lib/foodhub/auth';
import { nowIso } from '@/lib/foodhub/config';
import { getDirectOrder, saveDirectOrder } from '@/lib/foodhub/delivery/store';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { claimOrderPrint } from '@/lib/foodhub/mev/print-claim';
import { copyOf } from '@/lib/foodhub/mev/printable';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// The 80 mm ticket asks to print the order's Revenu Québec document: { model: stored|direct, copy: FAC|RPR|DUP }.
// Granted once per document (« Modes d'impression »: printed or sent once); later tickets get { granted: false, at }.
export const POST = withPerm<Ctx>('view', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const copy = copyOf(typeof b.copy === 'string' ? b.copy : null);
  const by = actor.name || actor.username || 'staff';
  if (b.model === 'direct') {
    const d = await getDirectOrder(id);
    if (!d || !inScope(actor, d.locationCode)) return fail('Order not found.', 404);
    const r = await claimOrderPrint(d.mev, copy, by);
    if (r.granted && d.mev) {
      const cur = (await getDirectOrder(id)) ?? d;
      if (cur.mev) await saveDirectOrder({ ...cur, mev: { ...cur.mev, printed: { ...(cur.mev.printed ?? {}), [r.key]: r.at }, updatedAt: nowIso() } });
    }
    return ok(r);
  }
  const repo = getRepo();
  const o = await repo.getOrder(id);
  if (!o || !inScope(actor, o.locationCode)) return fail('Order not found.', 404);
  const mev = o.timeline?.mev;
  const r = await claimOrderPrint(mev, copy, by);
  if (r.granted && mev) await repo.patchOrder(o.id, { mev: { ...mev, printed: { ...(mev.printed ?? {}), [r.key]: r.at }, updatedAt: nowIso() } });
  return ok(r);
});
