// Kitchen order tools — the money of ONE order, read-only: what the platform should pay, what it paid, the gap, error
// charges, adjustments, refunds, promotions, payout date and the dispute case when there is one.
//
// It reuses the reconciliation engine as it is (reconcile + listCases), on a three-day window around the order, then
// keeps only this order. Nothing here submits, approves or changes anything: disputes are filed by the owner in each
// platform's portal (AI and money rule); the screen only links to /money/disputes.
import { listCases, reconcile, type CaseStatus, type CaseType, type OrderRecon, type ReconCase, type ReconStatus } from '../recon/engine';
import type { ChannelKey, StoredOrder } from '../types';

export interface OrderMoneyCase { id: string; type: CaseType; status: CaseStatus; amount: number }

export interface OrderMoneyReady {
  status: Exclude<ReconStatus, 'pending' | 'not_covered'>;
  /** Net the platform should pay (after commission and fees). */
  expected: number;
  actual: number | null;
  diff: number | null;
  errorCharges: number;
  adjustments: number;
  refunds: number;
  promotions: number;
  payoutDate: string | null;
  case: OrderMoneyCase | null;
}

/** No statement covers the order yet (or the payout is not due): nothing to compare. */
export interface OrderMoneyNotYet { status: 'not_yet'; expected?: number; payoutDate?: string | null; case: OrderMoneyCase | null }

export type OrderMoney = OrderMoneyReady | OrderMoneyNotYet;

export interface OrderMoneyDeps {
  reconcile: (q: { from: string; to: string; channels?: ChannelKey[]; locationCodes?: string[] }) => Promise<{ orders: OrderRecon[] }>;
  listCases: (filter: { channels?: ChannelKey[] }) => Promise<ReconCase[]>;
  now: () => number;
}

const DEFAULT_DEPS: OrderMoneyDeps = { reconcile, listCases, now: () => Date.now() };

export const ORDER_MONEY_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: OrderMoney }>();

/** Empties the 60-second cache (tests, or after a statement import). */
export function clearOrderMoneyCache(): void { cache.clear(); }

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The case worth showing: an open / disputed one first, then the largest. */
function pickCase(cases: ReconCase[]): OrderMoneyCase | null {
  if (!cases.length) return null;
  const live = (c: ReconCase) => (c.status === 'open' || c.status === 'disputed' ? 0 : 1);
  const c = [...cases].sort((a, b) => live(a) - live(b) || b.amount - a.amount)[0];
  return { id: c.id, type: c.type, status: c.status, amount: c.amount };
}

export async function orderMoney(order: Pick<StoredOrder, 'id' | 'channel' | 'createdAt' | 'locationCode'>, deps: Partial<OrderMoneyDeps> = {}): Promise<OrderMoney> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const now = d.now();
  const hit = cache.get(order.id);
  if (hit && now - hit.at < ORDER_MONEY_TTL_MS) return hit.value;

  const created = Date.parse(order.createdAt);
  const at = Number.isFinite(created) ? created : now;
  const [recon, cases] = await Promise.all([
    d.reconcile({ from: day(at - 86400_000), to: day(at + 86400_000), channels: [order.channel], ...(order.locationCode ? { locationCodes: [order.locationCode] } : {}) }),
    d.listCases({ channels: [order.channel] }),
  ]);
  const row = recon.orders.find((o) => o.orderId === order.id);
  const theCase = pickCase(cases.filter((c) => c.orderId === order.id));

  let value: OrderMoney;
  if (!row || row.status === 'pending' || row.status === 'not_covered') {
    value = { status: 'not_yet', case: theCase, ...(row ? { expected: row.expected.net, payoutDate: row.payoutDate } : {}) };
  } else {
    value = {
      status: row.status,
      expected: row.expected.net,
      actual: row.actual,
      diff: row.diff,
      errorCharges: row.errorCharges,
      adjustments: row.adjustments,
      refunds: row.refunds,
      promotions: row.promotions,
      payoutDate: row.payoutDate,
      case: theCase,
    };
  }
  cache.set(order.id, { at: now, value });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return value;
}
