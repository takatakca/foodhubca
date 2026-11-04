// Bounded own-order observations: recent history plus older operational work and recorded exceptions.
import { DOC_REVIEW_PATHS, getRepo, type DocFilter } from '../repo';
import { directOrderReview } from './operator-state';
import { DELIVERIES, DIRECT_ORDERS } from './store';
import type { Delivery, DirectOrder } from './types';

export const DIRECT_BOARD_RECENT_LIMIT = 1000;
export const DIRECT_BOARD_ACTIVE_LIMIT = 1000;
export const DIRECT_BOARD_REVIEW_LIMIT = 5000;
export const DIRECT_BOARD_RESULT_LIMIT = 3000;
export const DIRECT_BOARD_DELIVERY_FILTER_BYTES = 4000;
export const DIRECT_BOARD_DELIVERY_BATCH_LIMIT = 100;
export const DIRECT_BOARD_ACTIVE_STATUSES: DirectOrder['status'][] = ['awaiting_payment', 'new', 'in_kitchen', 'ready', 'out_for_delivery'];

export interface DirectBoardCoverage {
  recentSince: string;
  recentLimit: number;
  recentLimitReached: boolean;
  activePerStatusLimit: number;
  activeStatusesLimited: DirectOrder['status'][];
  reviewScanLimit: number;
  reviewScanLimitReached: boolean;
  resultLimit: number;
  resultLimitReached: boolean;
  partial: boolean;
}

/** Actor/request scope is applied by the database before every independent result limit. */
export async function listDirectOrderBoard(options: { since: string; locationCodes?: string[]; brandName?: string }): Promise<{ orders: DirectOrder[]; coverage: DirectBoardCoverage }> {
  const repo = getRepo();
  const scope: DocFilter = { ...(options.locationCodes === undefined ? {} : { dataLocationCodes: options.locationCodes }), ...(options.brandName ? { dataEquals: { brandName: options.brandName } } : {}) };
  const [recent, reviews, ...active] = await Promise.all([
    repo.listDocs<DirectOrder>(DIRECT_ORDERS, { ...scope, since: options.since, limit: DIRECT_BOARD_RECENT_LIMIT + 1 }),
    repo.listDocs<DirectOrder>(DIRECT_ORDERS, { ...scope, dataAnyPresent: [...DOC_REVIEW_PATHS], limit: DIRECT_BOARD_REVIEW_LIMIT + 1 }),
    ...DIRECT_BOARD_ACTIVE_STATUSES.map((status) => repo.listDocs<DirectOrder>(DIRECT_ORDERS, { ...scope, dataEquals: { ...scope.dataEquals, status }, limit: DIRECT_BOARD_ACTIVE_LIMIT + 1 })),
  ]);
  const coverage: DirectBoardCoverage = {
    recentSince: options.since, recentLimit: DIRECT_BOARD_RECENT_LIMIT, recentLimitReached: recent.length > DIRECT_BOARD_RECENT_LIMIT,
    activePerStatusLimit: DIRECT_BOARD_ACTIVE_LIMIT, activeStatusesLimited: DIRECT_BOARD_ACTIVE_STATUSES.filter((_status, index) => active[index].length > DIRECT_BOARD_ACTIVE_LIMIT),
    reviewScanLimit: DIRECT_BOARD_REVIEW_LIMIT, reviewScanLimitReached: reviews.length > DIRECT_BOARD_REVIEW_LIMIT,
    resultLimit: DIRECT_BOARD_RESULT_LIMIT, resultLimitReached: false, partial: false,
  };
  const candidates = [
    ...recent.slice(0, DIRECT_BOARD_RECENT_LIMIT),
    ...active.flatMap((rows) => rows.slice(0, DIRECT_BOARD_ACTIVE_LIMIT)),
    ...reviews.slice(0, DIRECT_BOARD_REVIEW_LIMIT).filter((row) => directOrderReview(row.data).needsPerson),
  ];
  const allowed = options.locationCodes === undefined ? null : new Set(options.locationCodes);
  const unique = new Map<string, DirectOrder>();
  for (const { data: order } of candidates) {
    if (allowed && !allowed.has(order.locationCode)) continue;
    if (options.brandName && order.brandName !== options.brandName) continue;
    const existing = unique.get(order.id);
    if (!existing || order.updatedAt >= existing.updatedAt) unique.set(order.id, order);
  }
  const priority = (order: DirectOrder) => directOrderReview(order).needsPerson ? 0 : DIRECT_BOARD_ACTIVE_STATUSES.includes(order.status) ? 1 : 2;
  const ordered = [...unique.values()].sort((a, b) => priority(a) - priority(b) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  coverage.resultLimitReached = ordered.length > DIRECT_BOARD_RESULT_LIMIT;
  coverage.partial = coverage.recentLimitReached || coverage.activeStatusesLimited.length > 0 || coverage.reviewScanLimitReached || coverage.resultLimitReached;
  return { orders: ordered.slice(0, DIRECT_BOARD_RESULT_LIMIT), coverage };
}

/** Exact attached references, including older couriers; a mismatched order reference is never exposed. */
export async function boardDeliveries(orders: DirectOrder[]): Promise<Map<string, Delivery>> {
  const ids = [...new Set(orders.flatMap((order) => order.deliveryId ? [order.deliveryId] : []))];
  const found = new Map<string, Delivery>();
  const chunks: string[][] = [];
  let chunk: string[] = [];
  const baseBytes = new URLSearchParams({ id: 'in.()' }).toString().length;
  let filterBytes = baseBytes;
  for (const id of ids) {
    // Quote/escape every value for an upper bound on the SDK's .in URL encoding.
    // A count-only batch can exceed HTTP request limits even with ordinary UUIDs.
    const valueBytes = new URLSearchParams({ v: JSON.stringify(id) }).toString().length - 2;
    if (baseBytes + valueBytes > DIRECT_BOARD_DELIVERY_FILTER_BYTES) throw new Error('Delivery reference exceeds the supported read budget.');
    if (chunk.length && (chunk.length >= DIRECT_BOARD_DELIVERY_BATCH_LIMIT || filterBytes + 3 + valueBytes > DIRECT_BOARD_DELIVERY_FILTER_BYTES)) {
      chunks.push(chunk); chunk = []; filterBytes = baseBytes;
    }
    filterBytes += (chunk.length ? 3 : 0) + valueBytes;
    chunk.push(id);
  }
  if (chunk.length) chunks.push(chunk);
  for (const chunk of chunks) {
    const docs = await getRepo().listDocs<Delivery>(DELIVERIES, { ids: chunk, limit: chunk.length });
    for (const doc of docs) if (doc.id === doc.data.id) found.set(doc.id, doc.data);
  }
  const byOrder = new Map<string, Delivery>();
  for (const order of orders) {
    const delivery = order.deliveryId ? found.get(order.deliveryId) : null;
    if (delivery?.orderId === order.id) byOrder.set(order.id, delivery);
  }
  return byOrder;
}
