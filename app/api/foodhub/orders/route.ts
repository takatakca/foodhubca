import { scopeFilter, withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { allowedActions } from '@/lib/foodhub/pipeline';
import { parseLimit, parseRange } from '@/lib/foodhub/report-filter';
import { getRepo } from '@/lib/foodhub/repo';
import { matchesOrderFilters, ORDER_STATUSES, parseOrderFilters } from '@/lib/foodhub/orders/issues';
import type { OrderStatus } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

const list = (v: string | null) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

// Orders list (Atlas "Orders"): date range, locations, platforms, brands, statuses, search by id/customer.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const q = new URL(req.url).searchParams;
  const statuses = list(q.get('status')) as OrderStatus[];
  if (statuses.some((s) => !ORDER_STATUSES.includes(s))) return fail('Invalid status filter.');
  let filters;
  try { filters = parseOrderFilters(q); } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  const limit = parseLimit(q.get('limit'), 100, 5000);
  let since = q.get('since') || undefined;
  let until = q.get('until') || undefined;
  // from/to = local business days (YYYY-MM-DD, `to` inclusive) like the reports.
  if (q.get('from') || q.get('to')) {
    try { const r = parseRange(q, 1); since = r.from; until = r.to; } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  }
  const repo = getRepo();
  const locationCodes = scopeFilter(actor, list(q.get('locations')));
  const channels = list(q.get('channels'));
  const brands = list(q.get('brands'));
  const search = (q.get('q') || '').trim().toLowerCase().replace(/^#/, '');
  const needsScan = Boolean(filters.issue || filters.outcome || filters.courier || search);
  const scanLimit = needsScan ? 5000 : limit;
  // Scope first, before applying a bounded read. A busy different provider/brand cannot consume this view's limit.
  const candidates = await repo.listOrders({ statuses, limit: scanLimit + 1, since, until, locationCodes, channels, brands });
  const scanLimitReached = needsScan && candidates.length > scanLimit;
  let orders = candidates.slice(0, scanLimit);
  // openAlso=1 (order board): open orders are listed whatever day they arrived, e.g. an advance order placed yesterday.
  if (q.get('openAlso') === '1') {
    const open = await repo.listOrders({ statuses: ['new', 'accepted', 'ready', 'dispatched'], limit: 500, locationCodes, channels, brands });
    const seen = new Set(orders.map((o) => o.id));
    orders = [...orders, ...open.filter((o) => !seen.has(o.id) && (!statuses.length || statuses.includes(o.status)))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (search) orders = orders.filter((o) => [o.id, o.externalOrderId, o.displayId, o.customerName, o.posOrderId, o.brandName].some((v) => v && String(v).toLowerCase().includes(search)));
  orders = orders.filter((o) => matchesOrderFilters(o, filters));
  const resultLimitReached = q.get('openAlso') !== '1' && (orders.length > limit || (!needsScan && candidates.length > limit));
  if (q.get('openAlso') !== '1') orders = orders.slice(0, limit);
  // The raw platform payload stays on the server (customer data, size); the single-order route serves the timeline page.
  return ok({ mode: repo.mode, coverage: { scanLimitReached, resultLimitReached, scanned: Math.min(candidates.length, scanLimit) }, orders: orders.map((o) => { const { raw: _raw, ...rest } = o; return { ...rest, actions: allowedActions(o) }; }) });
});
