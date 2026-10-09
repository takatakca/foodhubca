// Courier fleet webhooks (DoorDash Drive, Uber Direct): verified, answered at once, applied after the response.
// A payload that cannot be read or matched is kept ("delivery_webhooks"), never dropped.
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { nowIso } from '../config';
import { getRepo } from '../repo';
import { background, parseJson } from '../webhook-utils';
import { applyFleetEvent, FLEETS } from './dispatch';
import type { FleetKey } from './types';
import { uberDirectRefund } from './uber-direct';

export const DELIVERY_WEBHOOKS = 'delivery_webhooks';

async function keep(fleet: FleetKey, body: unknown, reason: string): Promise<void> {
  const id = crypto.randomUUID();
  await getRepo().putDocs(DELIVERY_WEBHOOKS, [{ id, key: fleet, at: nowIso(), data: { fleet, reason, body } }]).catch(() => undefined);
}

export async function handleFleetWebhook(fleet: FleetKey, req: Request): Promise<Response> {
  const raw = await req.text();
  const adapter = FLEETS[fleet];
  if (!adapter.verifyWebhook(req.headers, raw)) return NextResponse.json({ ok: false, error: `${adapter.label} webhook check failed.` }, { status: 401 });
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  // Uber Direct refund request (event.refund_request): kept with the money split, and said in the activity log.
  const refund = fleet === 'uber_direct' ? uberDirectRefund(body) : null;
  if (refund) {
    background(`uber_direct refund ${refund.fleetDeliveryId}`, async () => {
      await keep(fleet, body, 'Uber Direct refund request');
      await logActivity({ actor: 'Uber Direct', source: 'platform', kind: 'order', action: 'courier_refund_request', status: 'info',
        summary: `Uber Direct refund for delivery ${refund.ref ?? refund.fleetDeliveryId}: Uber adjusts ${refund.uberRefund.toFixed(2)} ${refund.currency} on its invoice; the restaurant refunds ${refund.partnerRefund.toFixed(2)} ${refund.currency} to the customer${refund.reasons.length ? ` — ${refund.reasons.join('; ')}` : ''}` });
    });
    return NextResponse.json({ ok: true });
  }
  const ev = adapter.parseWebhook(body);
  if (!ev) {
    background(`keep ${fleet} webhook`, () => keep(fleet, body, 'Not a delivery event'));
    return NextResponse.json({ ok: true, ignored: 'not a delivery event' });
  }
  background(`${fleet} ${ev.event} ${ev.ref}`, async () => {
    const r = await applyFleetEvent(ev);
    if (!r.applied && r.reason) await keep(fleet, body, r.reason);
  });
  return NextResponse.json({ ok: true });
}
