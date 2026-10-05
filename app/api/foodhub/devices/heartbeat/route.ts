import { getActor } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceFromRequest, heartbeat } from '@/lib/foodhub/identity/devices';
import { getRepo } from '@/lib/foodhub/repo';
import { isWaitingScheduled } from '@/lib/foodhub/scheduling';

export const dynamic = 'force-dynamic';

// Kitchen tablet heartbeat (every 30 s, even on the PIN screen): sound on, screen visible, battery.
// Public route (see proxy.ts) — the signed device cookie is the credential.
export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return fail('Not an enrolled device', 403);
  const b = await readJson(req);
  const actor = await getActor(req).catch(() => null);
  const d = await heartbeat(device, { soundOn: b.soundOn, visible: b.visible, battery: b.battery, charging: b.charging, screen: b.screen, signedIn: actor?.deviceId === device.id ? actor.name : null }, req.headers.get('user-agent'));
  // The locked PIN screen beeps when orders wait at this location (count only — no order details without a PIN).
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const recent = await getRepo().listOrders({ since, limit: 400, statuses: ['new', 'accepted', 'cancelled'], locationCodes: [d.locationCode] });
  const waiting = recent.filter((o) => o.status !== 'cancelled' && !isWaitingScheduled(o) && (o.status === 'new' || !o.timeline?.seenAt)).length;
  // Cancelled by the customer / platform in the last 30 min and not yet confirmed in the kitchen.
  const cancelled = recent.filter((o) => o.status === 'cancelled' && o.timeline?.cancelledBy && o.timeline.cancelledBy !== 'store' && !o.timeline.cancelSeenAt
    && Date.now() - Date.parse(o.timeline.cancelledAt ?? o.updatedAt) < 30 * 60_000).length;
  return ok({ device: { id: d.id, name: d.name, locationCode: d.locationCode }, waiting, cancelled, serverTime: new Date().toISOString() });
}
