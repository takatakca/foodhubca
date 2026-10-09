// DoorDash Marketplace order endpoints beyond confirm / reject / ready / cancel (those stay in adapters/doordash.ts):
//   PATCH /api/v1/orders/{id}/adjustment            remove, change the quantity of, or substitute items after confirming
//   PATCH /api/v1/orders/{id}/events/{event_type}   order events (only order_ready_for_pickup exists today)
//   POST  /api/v1/orders/{id}/return                retail only: items returned in store
// Spec: https://developer.doordash.com/en-US/docs/marketplace/how_to/merchant_order_adjustment ,
//       https://developer.doordash.com/en-US/docs/marketplace/how_to/merchant_order_returns/
// Adjustments and returns are allowlisted by DoorDash per integration ("ask your technical account manager"), so each is
// offered only when the owner turns it on: DOORDASH_ORDER_ADJUSTMENT=true / DOORDASH_ORDER_RETURNS=true.
import { result } from '../config';
import type { ChannelResult, OrderLine, StoredOrder } from '../types';
import { ddRequest, type DdResult } from './api';
import { guardDoorDashOrder } from './guard';

const KEY = 'doordash' as const;
const enc = encodeURIComponent;

export const doorDashAdjustEnabled = () => process.env.DOORDASH_ORDER_ADJUSTMENT === 'true';
export const doorDashReturnsEnabled = () => process.env.DOORDASH_ORDER_RETURNS === 'true';

export type AdjustmentType = 'ITEM_UPDATE' | 'ITEM_REMOVE' | 'ITEM_SUBSTITUTE';
export interface AdjustmentOption { line_option_id: string; adjustment_type: 'ITEM_UPDATE' | 'ITEM_REMOVE'; quantity?: number }
export interface AdjustmentItem {
  line_item_id: string;
  adjustment_type: AdjustmentType;
  /** New quantity (ITEM_UPDATE). */
  quantity?: number;
  options?: AdjustmentOption[];
  /** ITEM_SUBSTITUTE: the replacement (price in cents). */
  substituted_item?: { name: string; merchant_supplied_id: string; price: number; quantity: number };
}

const blockedFor = (message: string): ChannelResult => result(KEY, 'blocked', message);

/**
 * What the kitchen picked in the "Missing item" window (line index + how many are missing) as DoorDash adjustments:
 * all of a line missing → ITEM_REMOVE, some → ITEM_UPDATE with the quantity that is left. DoorDash ignores the removal of
 * the only item of a cart ("use the cancellation endpoint"), so that is refused here with the same advice.
 */
export function adjustmentFromMissing(order: Pick<StoredOrder, 'lines'>, picks: Array<{ line: number; quantity: number }>): { items?: AdjustmentItem[]; error?: string } {
  const items: AdjustmentItem[] = [];
  const left = new Map<number, number>();
  for (const pick of picks) {
    const line: OrderLine | undefined = order.lines[pick.line];
    const qty = Math.round(pick.quantity);
    if (!line || !(qty >= 1) || qty > line.quantity) return { error: 'Choose the missing item(s) and a quantity that is on the order.' };
    if (!line.lineItemId) return { error: `"${line.name}" has no DoorDash line id (the order arrived before Food Hub kept it) — remove it on the DoorDash tablet.` };
    if (items.some((i) => i.line_item_id === line.lineItemId)) return { error: `"${line.name}" is listed twice.` };
    const remaining = line.quantity - qty;
    left.set(pick.line, remaining);
    items.push(remaining === 0 ? { line_item_id: line.lineItemId, adjustment_type: 'ITEM_REMOVE' } : { line_item_id: line.lineItemId, adjustment_type: 'ITEM_UPDATE', quantity: remaining });
  }
  if (!items.length) return { error: 'Choose the missing item(s) and quantity.' };
  const anythingLeft = order.lines.some((l, idx) => (left.has(idx) ? left.get(idx)! : l.quantity) > 0);
  if (!anythingLeft) return { error: 'Every item of the order is missing: cancel the order instead (DoorDash does not change a cart to nothing).' };
  return { items };
}

/** A substitution of one line (the customer sees the new item on their receipt). Price in dollars here, cents on the wire. */
export function substitutionFor(order: Pick<StoredOrder, 'lines'>, lineIndex: number, replacement: { name: string; merchantSuppliedId: string; price: number; quantity?: number }): { item?: AdjustmentItem; error?: string } {
  const line = order.lines[lineIndex];
  if (!line) return { error: 'Choose the item to replace.' };
  if (!line.lineItemId) return { error: `"${line.name}" has no DoorDash line id.` };
  if (!replacement.name?.trim() || !replacement.merchantSuppliedId?.trim()) return { error: 'The replacement needs a name and an item id from the menu.' };
  const price = Math.round(Number(replacement.price) * 100);
  if (!(price >= 0)) return { error: 'The replacement needs a price.' };
  return { item: { line_item_id: line.lineItemId, adjustment_type: 'ITEM_SUBSTITUTE', substituted_item: { name: replacement.name.trim().slice(0, 200), merchant_supplied_id: replacement.merchantSuppliedId.trim(), price, quantity: Math.max(1, Math.round(replacement.quantity ?? line.quantity)) } } };
}

/** Option-level change: remove an option (quantity 0 is not used by DoorDash) or set its quantity. */
export function optionAdjustment(order: Pick<StoredOrder, 'lines'>, lineIndex: number, optionIndex: number, quantity: number): { item?: AdjustmentItem; error?: string } {
  const line = order.lines[lineIndex];
  const opt = line?.modifiers[optionIndex];
  if (!line || !opt) return { error: 'Choose the option.' };
  if (!line.lineItemId || !opt.lineOptionId) return { error: `"${opt.name}" has no DoorDash option id.` };
  const q = Math.round(quantity);
  if (!(q >= 0) || q > opt.quantity) return { error: 'The option quantity must be between 0 and what was ordered.' };
  return { item: { line_item_id: line.lineItemId, adjustment_type: 'ITEM_UPDATE', options: [{ line_option_id: opt.lineOptionId, adjustment_type: q === 0 ? 'ITEM_REMOVE' : 'ITEM_UPDATE', ...(q === 0 ? {} : { quantity: q }) }] } };
}

/**
 * PATCH /api/v1/orders/{id}/adjustment. {id} is the DoorDash order UUID (our externalOrderId). 202 = received; DoorDash
 * then sends the updated order on the "Order Adjustment" webhook (webhooks/doordash.ts). 400 = the order is not confirmed,
 * already cancelled or malformed; 500 can mean a line id that is not on the order.
 */
export async function adjustDoorDashOrder(order: Pick<StoredOrder, 'externalOrderId' | 'channelStoreId'>, items: AdjustmentItem[]): Promise<DdResult> {
  if (!doorDashAdjustEnabled()) return blockedFor('DoorDash order adjustments need DoorDash’s approval (allowlist): ask your DoorDash technical account manager, then set DOORDASH_ORDER_ADJUSTMENT=true. Until then, change the order on the DoorDash tablet.');
  const refused = await guardDoorDashOrder(order, 'write');
  if (refused) return blockedFor(refused);
  if (!items.length) return blockedFor('Nothing to adjust.');
  const res = await ddRequest({ method: 'PATCH', path: `/api/v1/orders/${enc(order.externalOrderId)}/adjustment`, body: { items }, kind: 'write', okStatus: 'queued' });
  if (!res.ok && (res.httpStatus === 401 || res.httpStatus === 403)) {
    return { ...result(KEY, 'blocked', 'DoorDash refused the adjustment: this integration is not on the adjustment allowlist yet — change the order on the DoorDash tablet and ask your technical account manager.', { httpStatus: res.httpStatus }) };
  }
  return res.ok ? { ...res, message: 'Adjustment sent to DoorDash (DoorDash confirms it on the Order Adjustment webhook).' } : res;
}

/** PATCH /api/v1/orders/{id}/events/{event_type}. DoorDash supports one event type: order_ready_for_pickup. */
export type OrderEventType = 'order_ready_for_pickup';
export async function sendOrderEvent(order: Pick<StoredOrder, 'externalOrderId' | 'channelStoreId' | 'id' | 'posOrderId'>, eventType: OrderEventType = 'order_ready_for_pickup'): Promise<DdResult> {
  if (eventType !== 'order_ready_for_pickup') return blockedFor(`DoorDash has no order event "${eventType}" (only order_ready_for_pickup).`);
  const refused = await guardDoorDashOrder(order, 'write');
  if (refused) return blockedFor(refused);
  return ddRequest({ method: 'PATCH', path: `/api/v1/orders/${enc(order.externalOrderId)}/events/${eventType}`, body: { merchant_supplied_id: order.posOrderId || order.id }, kind: 'write' });
}

// ---------------------------------------------------------------------------------------------- returns (retail)

export const RETURN_REASONS = ['incorrect_item_received', 'dashmart_only_item_not_found', 'incorrect_size_or_weight', 'incorrect_quantity', 'sub_not_satisfactory', 'item_not_received', 'missing_item',
  'incorrect_size', 'poorly_packaged_or_handled', 'shopped_item_not_fresh', 'did_not_meet_expectations', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export interface ReturnItem { merchant_supplied_id: string; quantity: number; reason?: ReturnReason }

/**
 * POST /api/v1/orders/{id}/return — a retail order's items were returned in store (Merchant Pick). One request per order,
 * all items at once, after the in-store return is complete; it cannot be changed. 409 = already submitted.
 */
export async function returnDoorDashOrder(order: Pick<StoredOrder, 'externalOrderId' | 'channelStoreId' | 'lines'>, returnItems: ReturnItem[], returnLocationId: string): Promise<DdResult> {
  if (!doorDashReturnsEnabled()) return blockedFor('DoorDash order returns (retail) need DoorDash’s approval (allowlist): ask your technical account manager, then set DOORDASH_ORDER_RETURNS=true.');
  const refused = await guardDoorDashOrder(order, 'write');
  if (refused) return blockedFor(refused);
  const toLocation = await guardDoorDashOrder({ channelStoreId: returnLocationId }, 'write');
  if (toLocation) return blockedFor(toLocation);
  if (!returnItems.length) return blockedFor('Choose the returned items.');
  if (!returnLocationId.trim()) return blockedFor('Say which store accepted the return (return_location_id).');
  for (const it of returnItems) {
    if (!it.merchant_supplied_id || !(Math.round(it.quantity) >= 1)) return blockedFor('Every returned item needs its id and a quantity of at least 1.');
    if (it.reason && !RETURN_REASONS.includes(it.reason)) return blockedFor(`Return reason "${it.reason}" is not one DoorDash knows.`);
    const ordered = order.lines.filter((l) => l.externalId === it.merchant_supplied_id).reduce((s, l) => s + l.quantity, 0);
    if (ordered && it.quantity > ordered) return blockedFor(`More returned than ordered for ${it.merchant_supplied_id} (${it.quantity} > ${ordered}).`);
  }
  const res = await ddRequest({ method: 'POST', path: `/api/v1/orders/${enc(order.externalOrderId)}/return`, body: { return_items: returnItems.map((i) => ({ merchant_supplied_id: i.merchant_supplied_id, quantity: Math.round(i.quantity), ...(i.reason ? { reason: i.reason } : {}) })), return_location_id: returnLocationId }, kind: 'write', okStatus: 'queued' });
  if (res.httpStatus === 409) return { ...res, message: 'DoorDash already has a return for this order (one request per order, it cannot be changed).' };
  return res;
}
