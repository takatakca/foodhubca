import { NextResponse } from 'next/server';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceFromRequest, forgetDeviceCookie, getDevice, revokeDevice, updateDevice } from '@/lib/foodhub/identity/devices';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPerm<Ctx>('stores:map', async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const d = await getDevice(id);
  if (!d || !inScope(actor, d.locationCode)) return fail('Device not found', 404);
  const b = await readJson(req);
  if (b.locationCode != null && typeof b.locationCode !== 'string') return fail('Choisissez une succursale. / Choose a location.');
  const code = b.locationCode?.trim();
  if (code && code !== d.locationCode) {
    if (!inScope(actor, code)) return fail('Not one of your locations.', 403);
    const catalog = await getCatalog();
    if (!catalog.locations.some((l) => l.code === code && l.active)) return fail('Choisissez une succursale. / Choose a location.');
  }
  const updated = await updateDevice(id, { name: b.name, locationCode: code }, actor);
  return ok({ device: updated && { ...updated, lastHeartbeat: undefined } });
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
