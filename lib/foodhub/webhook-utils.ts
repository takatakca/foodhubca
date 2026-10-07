import { after, NextResponse } from 'next/server';
import { logActivity } from './activity';
import { CHANNEL_LABELS, nowIso } from './config';
import { getRepo } from './repo';
import { uberCourierState } from './courier';
import { runInbox, refuseInbox, saveToInbox } from './inbox';
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

/**
 * Durable intake: the order is saved in the inbox (lib/foodhub/inbox.ts) BEFORE the platform gets its 2xx, then
 * processed after the response; a server that stops in between loses nothing (the sync replays it, or flags it for
 * a person once the platform's answer window has passed).
 * false = it could not be saved: answer intakeUnavailable() so the platform retries (Skip/DoorDash: their tablet takes
 * it) — never a 2xx for an order Food Hub does not have.
 */
export async function queueOrder(order: NormalizedOrder): Promise<boolean> {
  return queueInbox({ channel: order.channel, externalOrderId: order.externalOrderId, order }, `order ${order.channel}:${order.externalOrderId}`, order);
}

/** Uber only notifies (the order is fetched after the 200): the notification is what the inbox keeps. */
export async function queueUberOrder(orderId: string, href: string, storeId: string | null | undefined, body: unknown): Promise<boolean> {
  return queueInbox({ channel: 'uber_eats', externalOrderId: orderId, uber: { href, storeId: storeId ?? null } }, `uber order ${orderId}`, body);
}

async function queueInbox(input: Parameters<typeof saveToInbox>[0], label: string, body: unknown): Promise<boolean> {
  let saved: Awaited<ReturnType<typeof saveToInbox>>;
  const receivedAt = nowIso();
  try { saved = await saveToInbox(input, receivedAt); } catch (error) {
    console.error(`[foodhub] ${label}: could not save to the order inbox — answering 503 so the platform retries:`, error);
    // The write may have gone through with only its answer lost: never process an order the platform kept.
    await refuseInbox(input, receivedAt, error instanceof Error ? error.message : String(error));
    return false;
  }
  // Processing failures are recorded on the inbox record by runInbox; this context only catches a failure to record them.
  background(label, () => runInbox(saved.id, saved.record, 'webhook'), { channel: input.channel, body, reference: saved.record.externalOrderId, kind: 'order' });
  return true;
}

/** Non-2xx for an order Food Hub could not save: the sender retries (or the platform tablet takes it). */
export function intakeUnavailable() {
  return NextResponse.json({ ok: false, error: 'Order intake temporarily unavailable — please retry.' }, { status: 503, headers: { 'Retry-After': '30' } });
}

/** Uber delivery.state_changed (body.meta.status) → courier status; null when the state is not one we map with confidence. */
export function uberDeliveryStatus(state: unknown): CourierStatus | null {
  return uberCourierState(state);
}

/** Keep payloads we could not parse so nothing is silently lost. */
export async function keepUnparsed(channel: ChannelKey, body: unknown, reason: string, reference: string | null = null) {
  await getRepo().addJob({ kind: 'webhook_unparsed', channel, reference, status: 'error', request: { body: body as Record<string, unknown> }, result: { reason } });
}
