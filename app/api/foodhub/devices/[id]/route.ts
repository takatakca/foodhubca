import { NextResponse } from 'next/server';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceFromRequest, forgetDeviceCookie, getDevice, revokeDevice, updateDevice } from '@/lib/foodhub/identity/devices';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPerm<Ctx>('stores:map', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const d = await getDevice(id);
  if (!d || !inScope(actor, d.locationCode)) return fail('Device not found', 404);
  const b = await readJson(req);
  return ok({ device: await updateDevice(id, { name: b.name, locationCode: b.locationCode }, actor) });
});

// Remove a tablet: it is signed out at once and must be enrolled again.
export const DELETE = withPerm<Ctx>('stores:map', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const d = await getDevice(id);
  if (!d || !inScope(actor, d.locationCode)) return fail('Device not found', 404);
  const gate = await approvalGate(req, actor, 'team.manage', d.locationCode, `remove tablet ${d.name}`);
  if (gate) return gate;
  await revokeDevice(id, actor);
  const here = await deviceFromRequest(req);
  const res = NextResponse.json({ ok: true });
  if (here?.id === id) res.headers.append('Set-Cookie', forgetDeviceCookie());
  return res;
});
