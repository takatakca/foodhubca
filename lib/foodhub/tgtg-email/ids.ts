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

/**
 * A Too Good To Go bag handed over at the counter (« Sac remis », lib/foodhub/tgtg.ts recordBagPickup) is its own sale,
 * with its own invoice. With its reservation code, its order id is that code: a TGTG e-mail read later for the same
 * reservation is then never a second sale (ingest.ts).
 */
export const PICKUP_PREFIX = 'tgtg-pickup-';

/** "#ab-12 34" → "AB-1234": the reservation code as Food Hub keys it (same shape as parse.ts codeFrom). */
export function normalizeTgtgCode(code: string | null | undefined): string | undefined {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40) || undefined;
}

export function tgtgPickupOrderId(code: string): string {
  return `${PICKUP_PREFIX}${normalizeTgtgCode(code) ?? ''}`;
}
