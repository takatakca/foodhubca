import { approvalGate, withPerm } from '@/lib/foodhub/auth';
import { getOwnFleet, newCourierLink, runningFor, saveOwnFleet, setShift } from '@/lib/foodhub/delivery/own-fleet';
import { fail, ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

async function view() {
  const s = await getOwnFleet();
  const couriers = await Promise.all(s.couriers.map(async (c) => ({ ...c, running: (await runningFor(c.id)).length })));
  return { settings: { ...s, couriers } };
}

// Our own couriers (the third fleet): list, settings, a personal link per courier, shift on/off.
export const GET = withPerm('stores:map', async () => ok(await view()));

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const gate = await approvalGate(req, actor, 'team.manage', null, 'our couriers');
  if (gate) return gate;
  const b = await readJson(req);
  await saveOwnFleet({ enabled: b.enabled, costPerDelivery: b.costPerDelivery, couriers: b.couriers }, actor);
  return ok(await view());
});

// { action: "link", id } → a new personal link (older links stop working) · { action: "shift", id, onShift }
export const POST = withPerm('stores:map', async (req) => {
  const b = await readJson(req);
  const id = String(b.id ?? '');
  if (b.action === 'link') return ok({ link: await newCourierLink(id), ...(await view()) });
  if (b.action === 'shift') {
    if (!(await setShift(id, Boolean(b.onShift)))) return fail('Unknown courier.', 404);
    return ok(await view());
  }
  return fail('Unknown action.');
});
