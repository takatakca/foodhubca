import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { setItemAvailability } from '@/lib/foodhub/ops';

export const dynamic = 'force-dynamic';

// 86 / un-86 items AND modifiers on every channel at once. minutes = auto re-enable.
export const POST = withPerm('items:toggle', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.brand) return fail('brand is required');
  const refs: string[] = Array.isArray(b.itemRefs) ? b.itemRefs.map(String) : Array.isArray(b.refs) ? b.refs.map(String) : [];
  if (!refs.length) return fail('itemRefs is required');
  const locationCode = b.locationCode ? String(b.locationCode) : undefined;
  if (actor.locations.length && (!locationCode || !inScope(actor, locationCode))) return fail('Choose one of your locations.', 403);
  if (!b.available) {
    const gate = await approvalGate(req, actor, 'item.86', locationCode, `${refs.length} item(s)`);
    if (gate) return gate;
  }
  const minutes = Number(b.minutes || 0);
  const results = await setItemAvailability(String(b.brand), refs, Boolean(b.available), {
    locationCode,
    untilMs: !b.available && minutes > 0 ? Date.now() + minutes * 60_000 : undefined,
    actor,
  });
  return ok({ results });
});
