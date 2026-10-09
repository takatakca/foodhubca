// DoorDash Marketplace (legacy) API: the older reference at https://pointofsale.doordash.com, still served for integrations that
// were built on it. Same JWT, same resources, different paths for activation:
//   GET /api/v1/stores/{id}                                  store info
//   PUT /api/v1/stores/{id}/activation-status                activate / deactivate the store
//   PUT /api/v1/stores/{id}/item/activation-status           86 items
//   PUT /api/v1/stores/{id}/item_option/activation-status    86 item options
// plus the menus / orders / menu_details / store_menu endpoints, which keep the same paths as the current API.
// Spec: https://developer.doordash.com/en-US/api/marketplace_legacy . New work uses the current API (api.ts, the adapter);
// this client exists so an old integration can be moved over one store at a time without losing a capability.
import { stripSlash } from '../config';
import { ddRequest, type DdResult } from './api';

const enc = encodeURIComponent;
export const legacyBase = () => stripSlash(process.env.DOORDASH_LEGACY_BASE_URL || 'https://pointofsale.doordash.com');
const url = (path: string) => `${legacyBase()}${path}`;

export const legacy = {
  createMenu: (body: unknown, storeId?: string): Promise<DdResult> => ddRequest({ method: 'POST', url: url('/api/v1/menus'), body, storeId, kind: 'menu' }),
  updateMenu: (menuId: string, body: unknown, storeId?: string): Promise<DdResult> => ddRequest({ method: 'PATCH', url: url(`/api/v1/menus/${enc(menuId)}`), body, storeId, kind: 'menu' }),
  confirmOrder: (orderId: string, body: unknown): Promise<DdResult> => ddRequest({ method: 'PATCH', url: url(`/api/v1/orders/${enc(orderId)}`), body, kind: 'write' }),
  adjustOrder: (orderId: string, body: unknown): Promise<DdResult> => ddRequest({ method: 'PATCH', url: url(`/api/v1/orders/${enc(orderId)}/adjustment`), body, kind: 'write' }),
  cancelOrder: (orderId: string, body: unknown): Promise<DdResult> => ddRequest({ method: 'PATCH', url: url(`/api/v1/orders/${enc(orderId)}/cancellation`), body, kind: 'write' }),
  orderEvent: (orderId: string, eventType: string, body: unknown): Promise<DdResult> => ddRequest({ method: 'PATCH', url: url(`/api/v1/orders/${enc(orderId)}/events/${enc(eventType)}`), body, kind: 'write' }),
  storeInfo: (storeId: string): Promise<DdResult> => ddRequest({ method: 'GET', url: url(`/api/v1/stores/${enc(storeId)}`), storeId }),
  setStoreActivation: (storeId: string, body: { is_active: boolean; reason?: string; notes?: string; end_time?: string }): Promise<DdResult> => ddRequest({ method: 'PUT', url: url(`/api/v1/stores/${enc(storeId)}/activation-status`), body, storeId, kind: 'write' }),
  setItemActivation: (storeId: string, items: Array<{ merchant_supplied_id: string; is_active: boolean }>): Promise<DdResult> => ddRequest({ method: 'PUT', url: url(`/api/v1/stores/${enc(storeId)}/item/activation-status`), body: items, storeId, kind: 'menu' }),
  setItemOptionActivation: (storeId: string, options: Array<{ merchant_supplied_id: string; is_active: boolean }>): Promise<DdResult> => ddRequest({ method: 'PUT', url: url(`/api/v1/stores/${enc(storeId)}/item_option/activation-status`), body: options, storeId, kind: 'menu' }),
  menuDetails: (storeId: string): Promise<DdResult> => ddRequest({ method: 'GET', url: url(`/api/v1/stores/${enc(storeId)}/menu_details`), storeId }),
  storeMenu: (storeId: string): Promise<DdResult> => ddRequest({ method: 'GET', url: url(`/api/v1/stores/${enc(storeId)}/store_menu`), storeId }),
};
