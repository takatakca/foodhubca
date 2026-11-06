import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { enterScreenOrder, screenEntryOptions } from '@/lib/foodhub/screen-entry';
import { getScreen } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// "Enter in Clover" from a platform screen (lib/foodhub/screen-entry.ts). Anyone on the kitchen team may enter an order.
// GET: the screen's stores and each brand's menu at the platform's prices (what the form shows).
export const GET = withPerm<Ctx>('orders:act', async (_req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  return ok({ ...(await screenEntryOptions(s)) });
});

// POST { channelStoreId?, orderCode, customerName?, fulfillment?, note?, lines: [{ ref | name+unitPrice, quantity, note?, modifiers? }] }
// → Clover order, recorded as paid with the platform tender, kitchen ticket printed.
export const POST = withPerm<Ctx>('orders:act', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const s = await getScreen(id);
  if (!s || !inScope(actor, s.locationCode)) return fail('Screen not found', 404);
  const r = await enterScreenOrder(s, await readJson(req), actor);
  if (!r.ok) return fail(r.error, r.status);
  return ok({ orderId: r.order.id, inClover: r.inClover, paid: r.paid, printed: r.printed, message: r.message, total: r.order.total });
});
