import { after, NextResponse } from 'next/server';
import { logActivity } from './activity';
import { CHANNEL_LABELS } from './config';
import { getRepo } from './repo';
import { processIncomingOrder } from './pipeline';
import type { ActivityKind, ChannelKey, CourierStatus, NormalizedOrder } from './types';

/** What to keep when deferred webhook work fails: the platform already got its 2xx and will not retry. */
export interface BackgroundContext { channel: ChannelKey; body?: unknown; reference?: string | null; kind?: ActivityKind }

/**
 * Run work after the HTTP response is sent (platforms need a fast 200), and never let it crash silently:
 * a failure keeps the payload under Channels → Unparsed payloads (Command Center alert) and logs a failed activity entry.
 */
export function background(label: string, work: () => Promise<unknown>, ctx?: BackgroundContext) {
  after(async () => {
    try {
      await work();
    } catch (error) {
      console.error(`[foodhub] ${label} failed:`, error);
      await recordBackgroundFailure(label, error, ctx);
    }
  });
}

/** Persist a deferred-work failure (exported so it can be unit-tested without a request scope). */
export async function recordBackgroundFailure(label: string, error: unknown, ctx?: BackgroundContext) {
  const reason = error instanceof Error ? error.message : String(error);
  let kept = false;
  if (ctx) {
    try {
      await getRepo().addJob({ kind: 'webhook_unparsed', channel: ctx.channel, reference: ctx.reference ?? null, status: 'error', request: { body: ctx.body as Record<string, unknown>, label }, result: { reason } });
      kept = true;
    } catch (e) { console.error(`[foodhub] could not keep failed ${label} payload:`, e); }
  }
  await logActivity({
    actor: ctx ? CHANNEL_LABELS[ctx.channel] : 'Webhook', source: 'platform', kind: ctx?.kind ?? 'settings', action: 'webhook_failed', status: 'failed', channel: ctx?.channel ?? null,
    summary: `${label} failed: ${reason}${kept ? ' — payload kept under Channels → Unparsed payloads' : ''}`, detail: { label, reason, reference: ctx?.reference ?? null },
  });
}

export function unauthorized(channel: ChannelKey) {
  return NextResponse.json({ ok: false, error: `Webhook signature/token check failed for ${channel}.` }, { status: 401 });
}

export function parseJson(raw: string): any | undefined {
  try { return raw ? JSON.parse(raw) : {}; } catch { return undefined; }
}

export function queueOrder(order: NormalizedOrder) {
  background(`order ${order.channel}:${order.externalOrderId}`, () => processIncomingOrder(order), { channel: order.channel, body: order, reference: order.externalOrderId, kind: 'order' });
}

/** Uber delivery.state_changed (body.meta.status) → courier status; null when the state is not one we map with confidence. */
export function uberDeliveryStatus(state: unknown): CourierStatus | null {
  const s = String(state ?? '').toLowerCase().replace(/[^a-z]+/g, '_');
  if (!s) return null;
  if (/complete|delivered|dropoff_complete/.test(s)) return 'delivered';
  if (/en_route_to_drop|picked_up|pickup_complete|left_pickup/.test(s)) return 'picked_up';
  if (/arrived_at_pick|at_pickup|at_store|at_restaurant/.test(s)) return 'at_store';
  if (/en_route_to_pick|assigned|accepted/.test(s)) return 'assigned';
  if (/unassign/.test(s)) return 'unassigned';
  return null;
}

/** Keep payloads we could not parse so nothing is silently lost. */
export async function keepUnparsed(channel: ChannelKey, body: unknown, reason: string, reference: string | null = null) {
  await getRepo().addJob({ kind: 'webhook_unparsed', channel, reference, status: 'error', request: { body: body as Record<string, unknown> }, result: { reason } });
}
