// Ids of orders read from Too Good To Go e-mails. No imports: the Clover bookkeeping reads it without a cycle.
import type { StoredOrder } from '../types';

export const ORDER_ID_PREFIX = 'tgtg-mail-';

export function tgtgMailOrderId(code: string): string {
  return `${ORDER_ID_PREFIX}${code.toUpperCase()}`;
}

/** An order that came from a TGTG e-mail (its Clover copy is flagged, never deleted, when cancelled). */
export function isTgtgEmailOrder(o: Pick<StoredOrder, 'channel' | 'raw' | 'externalOrderId'> | null | undefined): boolean {
  if (!o || o.channel !== 'tgtg') return false;
  return (o.raw as { source?: string } | undefined)?.source === 'tgtg_email' || o.externalOrderId.startsWith(ORDER_ID_PREFIX);
}
