import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { ok } from '@/lib/foodhub/http';
import { availabilityBoard } from '@/lib/foodhub/store-availability/board';

export const dynamic = 'force-dynamic';

// Store availability center — "Statut maintenant": every kitchen, brand and platform store, who paused it and when it
// reopens. Read-only (pause / resume stay on /api/foodhub/stores/status). ?locations=A,B &brands=X,Y narrow it.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const list = (k: string) => (q.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const brands = list('brands');
  const board = await availabilityBoard({ locationCodes: scopeFilter(actor, list('locations')), brandNames: brands.length ? brands : undefined });
  return ok({ board });
});
