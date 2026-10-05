import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { allCloverMerchants } from '@/lib/foodhub/pos/clover';
import { assignCloverLabel, cloverLabelReport, cloverTaxCheck } from '@/lib/foodhub/pos/clover-labels';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

async function merchants() {
  const stores = await getRepo().listStores();
  return allCloverMerchants(stores.map((s) => s.cloverMerchantId));
}

// Kitchen printing check: Clover items that no printer label covers (they never print in the kitchen).
export const GET = withPerm('stores:map', async (req) => {
  const all = await merchants();
  const mid = new URL(req.url).searchParams.get('merchantId') || all[0];
  if (!mid) return ok({ merchants: all, report: null });
  if (!all.includes(mid)) return fail('Unknown Clover merchant.', 404);
  const [report, taxes] = await Promise.all([cloverLabelReport(mid), cloverTaxCheck(mid)]);
  return ok({ merchants: all, report: { ...report, unprinted: report.unprinted.slice(0, 300), unprintedCount: report.unprinted.length }, taxes });
});

// Owner adds a kitchen printer label to items: { merchantId, tagId, itemIds } or { merchantId, tagId, all: true }.
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const body = (await req.json().catch(() => ({}))) as { merchantId?: string; tagId?: string; itemIds?: string[]; all?: boolean };
  const mid = String(body.merchantId || '');
  if (!(await merchants()).includes(mid)) return fail('Unknown Clover merchant.', 404);
  const report = await cloverLabelReport(mid);
  if (!report.ok) return fail(report.error || 'Clover could not be read.', 502);
  const tag = report.kitchenLabels.find((l) => l.id === body.tagId);
  if (!tag) return fail('Choose a label that is linked to a kitchen printer in Clover.');
  const unprinted = new Set(report.unprinted.map((i) => i.id));
  const ids = body.all ? [...unprinted] : (body.itemIds ?? []).filter((id) => unprinted.has(id));
  if (!ids.length) return fail('Every item already prints in the kitchen.');
  const r = await assignCloverLabel(mid, tag.id, ids, actor.name || actor.username);
  return r.ok ? ok({ added: r.added, label: tag.name }) : fail(r.error || 'Clover refused.', 502, { added: r.added });
});
