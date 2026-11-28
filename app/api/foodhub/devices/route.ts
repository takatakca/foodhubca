import { NextResponse } from 'next/server';
import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceFromRequest, deviceStatus, enrollDevice, listDevices } from '@/lib/foodhub/identity/devices';
import { listPrintListenerObservations } from '@/lib/foodhub/identity/print-listener';

export const dynamic = 'force-dynamic';

// Kitchen tablets: list (with live status) and "make this screen a kitchen tablet".
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const now = Date.now();
  const here = await deviceFromRequest(req);
  const visibleDevices = (await listDevices()).filter((d) => !d.revoked && inScope(actor, d.locationCode));
  const printListener = await listPrintListenerObservations(visibleDevices);
  const devices = visibleDevices.map((d) => ({
    ...d, status: deviceStatus(d, now), userAgent: undefined, printListenerObservedAt: printListener.get(d.id),
  }));
  return ok({ devices, thisDevice: here ? here.id : null });
});

// { name, locationCode } → this browser becomes a kitchen tablet (signed device cookie, 1 year).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const code = String(b.locationCode || '');
  const catalog = await getCatalog();
  if (!catalog.locations.some((l) => l.code === code && l.active)) return fail('Choisissez une succursale. / Choose a location.');
  if (!inScope(actor, code)) return fail('Not one of your locations.', 403);
  const gate = await approvalGate(req, actor, 'team.manage', code, `enrol tablet ${b.name || ''}`);
  if (gate) return gate;
  const { device, cookie } = await enrollDevice({ name: String(b.name || ''), locationCode: code }, actor);
  const res = NextResponse.json({ ok: true, device });
  res.headers.append('Set-Cookie', cookie);
  return res;
});
