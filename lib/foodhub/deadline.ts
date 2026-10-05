// How long each platform gives you to answer a new order before it cancels or re-routes it.
import type { ChannelKey, StoredOrder } from './types';

/** Minutes a platform gives you to answer a new order before it is cancelled / re-routed. */
export const ORDER_DEADLINE_MIN: Partial<Record<ChannelKey, number>> = { uber_eats: 11.5, skip: 5 };

export function deadlineFor(o: Pick<StoredOrder, 'channel' | 'createdAt'>): string | null {
  const min = ORDER_DEADLINE_MIN[o.channel];
  return min ? new Date(new Date(o.createdAt).getTime() + min * 60_000).toISOString() : null;
}
