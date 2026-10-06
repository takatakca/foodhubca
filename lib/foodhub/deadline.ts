// How long each platform gives you to answer a new order before it cancels or re-routes it.
import type { ChannelKey, StoredOrder } from './types';

/**
 * Minutes a platform gives you to answer a new order before it is cancelled / re-routed.
 * DoorDash fails an unconfirmed order after 3–8 minutes: the lower bound is shown.
 */
export const ORDER_DEADLINE_MIN: Partial<Record<ChannelKey, number>> = { uber_eats: 11.5, skip: 5, doordash: 3 };

/**
 * The platform's clock starts when the order was placed. placedAt is used when it is plausible (up to 30 minutes
 * before Food Hub received the order), so a slow webhook never makes the countdown look longer than it is.
 */
export function deadlineFor(o: Pick<StoredOrder, 'channel' | 'createdAt'> & { placedAt?: string | null }): string | null {
  const min = ORDER_DEADLINE_MIN[o.channel];
  if (!min) return null;
  const created = new Date(o.createdAt).getTime();
  const placed = o.placedAt ? Date.parse(o.placedAt) : NaN;
  const start = Number.isFinite(placed) && placed <= created && created - placed <= 30 * 60_000 ? placed : created;
  return new Date(start + min * 60_000).toISOString();
}
