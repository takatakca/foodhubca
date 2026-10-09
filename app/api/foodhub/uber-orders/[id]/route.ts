import {
  fetchUberOrderCurrent, getUberReplacementRecommendations, patchUberGroceryCart, resolveUberRetailIssues, setUberCourierCount, setUberRestaurantDeliveryStatus,
  validateUberItemFulfillment, type UberRetailIssue,
} from '@/lib/foodhub/adapters/uber-api';
import { logActivity } from '@/lib/foodhub/activity';
import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

// Uber Eats order tools beyond the kitchen buttons (for the console, the ON2GO app and grocery/retail stores):
// GET  = the order as Uber's current Order API shows it (carts with cart_item_id, deliveries, payment).
// POST { action }: courier_count (Dispatch Multiple Courier), delivery_status (own driver: started / arriving /
// delivered), retail_validate (barcode dry run), retail_resolve (remove / replace / substitute / quantities),
// replacements (Uber's suggestions for an item), grocery_cart (previous-version Patch Cart).

async function uberOrder(id: string, actor: Parameters<typeof inScope>[0]) {
  const o = await getRepo().getOrder(id);
  return o && o.channel === 'uber_eats' && !o.viaHub && inScope(actor, o.locationCode) ? o : null;
}

const asIssue = (x: any): UberRetailIssue => ({
  issueType: x?.issueType, actionType: x?.actionType || undefined, cartItemId: String(x?.cartItemId ?? ''), scannedBarcode: x?.scannedBarcode ? String(x.scannedBarcode) : undefined,
  itemAvailability: x?.itemAvailability && typeof x.itemAvailability === 'object' ? x.itemAvailability : undefined, itemSubstitute: x?.itemSubstitute && typeof x.itemSubstitute === 'object' ? x.itemSubstitute : undefined,
});
const ISSUE_TYPES = ['OUT_OF_ITEM', 'PARTIAL_AVAILABILITY', 'FOUND_ITEM'];

export const GET = withPerm<Ctx>('view', async (_req, ctx, actor) => {
  const o = await uberOrder((await ctx.params).id, actor);
  if (!o) return fail('Uber Eats order not found.', 404);
  const r = await fetchUberOrderCurrent(o.externalOrderId);
  return r.ok ? ok({ uber: r.order }) : fail(r.error ?? 'Uber did not answer.', 502);
});

export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const o = await uberOrder((await ctx.params).id, actor);
  if (!o) return fail('Uber Eats order not found.', 404);
  const b = await readJson(req);
  const action = String(b.action || '');
  let out: { ok: boolean; message?: string; [k: string]: unknown };
  if (action === 'courier_count') {
    const r = await setUberCourierCount(o.externalOrderId, Number(b.count));
    out = { ok: r.ok, message: r.ok ? `Uber Eats will send ${Number(b.count)} courier(s).` : r.message };
  } else if (action === 'delivery_status') {
    const s = String(b.status);
    if (!['started', 'arriving', 'delivered'].includes(s)) return fail('status: started, arriving or delivered.');
    const r = await setUberRestaurantDeliveryStatus(o.externalOrderId, s as 'started' | 'arriving' | 'delivered');
    out = { ok: r.ok, message: r.ok ? `Uber Eats shows "${s}" to the customer.` : r.message };
  } else if (action === 'retail_validate' || action === 'retail_resolve') {
    const issues = (Array.isArray(b.issues) ? b.issues : [b.issue]).filter(Boolean).map(asIssue);
    if (!issues.length || issues.some((i: UberRetailIssue) => !ISSUE_TYPES.includes(i.issueType) || !i.cartItemId)) return fail('Each issue needs issueType and cartItemId.');
    if (action === 'retail_validate') {
      const v = await validateUberItemFulfillment(o.externalOrderId, issues[0]);
      out = { ok: v.ok, message: v.ok ? (v.blocking ? 'Uber says this will fail — check the item.' : 'Uber accepts it.') : v.error, results: v.results, blocking: v.blocking };
    } else {
      const r = await resolveUberRetailIssues(o.externalOrderId, issues);
      out = { ok: r.ok, message: r.ok ? `Sent to Uber Eats (${issues.length} item(s)).` : r.message, response: r.response ?? null };
    }
  } else if (action === 'replacements') {
    const r = await getUberReplacementRecommendations(o.externalOrderId, o.channelStoreId, String(b.itemId ?? ''));
    out = { ok: r.ok, message: r.error, recommendations: r.recommendations };
  } else if (action === 'grocery_cart') {
    const issues = (Array.isArray(b.issues) ? b.issues : []).map((x: any) => ({ type: x?.type, action: x?.action || undefined, instanceId: String(x?.instanceId ?? ''), substitute: x?.substitute, adjustment: x?.adjustment }));
    if (!issues.length || issues.some((i: any) => !ISSUE_TYPES.includes(i.type) || !i.instanceId)) return fail('Each change needs type and instanceId.');
    const r = await patchUberGroceryCart(o.externalOrderId, issues);
    out = { ok: r.ok, message: r.ok ? 'Cart updated on Uber Eats.' : r.message };
  } else return fail('Unknown action.');
  if (action !== 'replacements' && action !== 'retail_validate') {
    await getRepo().addEvent(o.id, out.ok ? `uber_${action}` : `uber_${action}_failed`, { message: out.message, by: actor.name });
    await logActivity({ actor: actor.name, source: actor.source, kind: 'order', action: `uber_${action}`, status: out.ok ? 'success' : 'failed', channel: 'uber_eats', brandName: o.brandName, locationCode: o.locationCode, orderId: o.id,
      summary: `Uber Eats #${o.displayId || o.externalOrderId.slice(0, 8)}: ${out.message ?? action}` });
  }
  return out.ok ? ok(out) : fail(out.message ?? 'Uber refused.', 409, out);
});
