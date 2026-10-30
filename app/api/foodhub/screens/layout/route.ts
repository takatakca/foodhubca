import { withPerm } from '@/lib/foodhub/auth';
import { ok, readJson } from '@/lib/foodhub/http';
import { getSharedWall, saveSharedWall } from '@/lib/foodhub/screens';

export const dynamic = 'force-dynamic';

// The screens wall layout shared by every device: a device with no layout of its own starts from it.
export const GET = withPerm('view', async () => ok({ wall: await getSharedWall() }));

// { wall } — the layout of the device that shares it (view, order, page, tab, custom board).
export const PUT = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  return ok({ wall: await saveSharedWall(b.wall, actor) });
});
