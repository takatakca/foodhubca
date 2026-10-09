// Our own orders on the kitchen screen: the AI phone agent's orders, phone orders typed by staff, our website's orders
// and orders typed in by hand. Food Hub created them (and sent them to Clover, which prints the ticket), so the kitchen
// tablet shows them next to the platform orders with the same Seen / Ready / Picked up steps.
// Not here: Clover Online Ordering website orders (their own mirror, pos/clover-website-orders.ts) and Clover "Delivery"
// orders read back from Clover (staff entered them in Clover; they show on the courier strip).
import { listDirectOrders } from './store';
import type { DirectOrder, DirectSource } from './types';

export const KITCHEN_SOURCES: DirectSource[] = ['phone_ai', 'phone', 'website', 'manual'];
const OPEN: DirectOrder['status'][] = ['new', 'in_kitchen', 'ready'];
/** Older open orders are a forgotten "done" tap, not a ticket to cook: the Own orders board still lists them. */
const WINDOW_MS = 12 * 3600_000;

export function onKitchenScreen(o: Pick<DirectOrder, 'source' | 'status'>): boolean {
  return KITCHEN_SOURCES.includes(o.source) && OPEN.includes(o.status);
}

export async function listKitchenOwnOrders(opts: { locationCodes?: string[]; now?: number } = {}): Promise<DirectOrder[]> {
  const now = opts.now ?? Date.now();
  const list = await listDirectOrders({ since: new Date(now - WINDOW_MS).toISOString(), limit: 1000, locationCodes: opts.locationCodes });
  return list.filter(onKitchenScreen).sort((a, b) => (a.readyAt ?? a.placedAt).localeCompare(b.readyAt ?? b.placedAt));
}
