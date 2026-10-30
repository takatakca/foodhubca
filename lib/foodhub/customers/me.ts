// GET /api/foodhub/customers/me: the projection the website shows on "Mon compte" — profile, addresses, favourites,
// loyalty and gift cards (adapters), and that number's recent website orders (newest first, at most 20).
import { listDirectOrders } from '../delivery/store';
import type { DirectOrder } from '../delivery/types';
import { giftCardsFor, loyaltyFor, type GiftCardsInfo, type LoyaltyInfo } from './adapters';
import { toPublicCustomer, type CustomerAddress, type MasterCustomer, type PublicCustomer } from './types';

export const ME_ORDERS_MAX = 20;
/** How far back the order list looks (the newest 500 direct orders of every source). */
const ORDERS_SCAN = 500;

export interface MeOrder {
  id: string;
  number: string;
  at: string;
  total: number;
  status: DirectOrder['status'];
  brand: string;
  fulfillment: DirectOrder['fulfillment'];
}

export interface MeView {
  customer: PublicCustomer;
  addresses: CustomerAddress[];
  favourites: string[];
  loyalty: LoyaltyInfo;
  giftCards: GiftCardsInfo;
  orders: MeOrder[];
}

/** Website orders placed with this phone, newest first. Phone / Clover / manual orders are not the website's business. */
export async function websiteOrdersFor(phone: string, limit = ME_ORDERS_MAX): Promise<MeOrder[]> {
  if (!phone) return [];
  const all = await listDirectOrders({ limit: ORDERS_SCAN });
  return all
    .filter((o) => o.source === 'website' && o.customer?.phone === phone)
    .sort((a, b) => (b.placedAt || b.createdAt).localeCompare(a.placedAt || a.createdAt))
    .slice(0, limit)
    .map((o) => ({ id: o.id, number: o.number, at: o.placedAt || o.createdAt, total: o.total, status: o.status, brand: o.brandName, fulfillment: o.fulfillment }));
}

export async function buildMe(customer: MasterCustomer): Promise<MeView> {
  const [loyalty, giftCards, orders] = await Promise.all([loyaltyFor(customer.phone), giftCardsFor(customer.phone), websiteOrdersFor(customer.phone)]);
  return { customer: toPublicCustomer(customer), addresses: customer.addresses, favourites: customer.favourites, loyalty, giftCards, orders };
}
