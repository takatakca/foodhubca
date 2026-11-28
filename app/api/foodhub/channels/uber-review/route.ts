import { inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { UBER_REVIEW_PAGE_SIZE, type UberReviewPage } from '@/lib/foodhub/uber-review';

export const dynamic = 'force-dynamic';

const readPage = withPerm('stores:map', async (req, _ctx, actor) => {
  const requested = new URL(req.url).searchParams.get('offset') ?? '0';
  const offset = Number(requested);
  if (!/^\d+$/.test(requested) || offset > 1_000_000) return fail('Invalid page offset.');
  const repo = getRepo();
  const storeRefs = actor.locations.length
    ? (await repo.listStores('uber_eats')).filter((store) => inScope(actor, store.locationCode)).map((store) => store.channelStoreId)
    : undefined;
  const notices = await repo.listUberReviewNotices({ offset, limit: UBER_REVIEW_PAGE_SIZE + 1, storeRefs });
  const page: UberReviewPage = {
    offset,
    hasMore: notices.length > UBER_REVIEW_PAGE_SIZE,
    notices: notices.slice(0, UBER_REVIEW_PAGE_SIZE),
  };
  return ok(page);
});

export async function GET(req: Request, context: unknown) {
  const response = await readPage(req, context);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
