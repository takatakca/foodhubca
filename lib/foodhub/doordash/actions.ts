// Every DoorDash API Food Hub can call, as named actions the console can run (Settings → DoorDash). One registry means one place
// where permissions, the protected-store guard, activity logging and the result shape are applied, and one place a test walks
// through to prove that no action reaches a protected store.
//   read    changes nothing on DoorDash (needs the credentials only)
//   write   changes something on DoorDash (needs LIVE_CONNECTORS_GLOBAL_ENABLED, an allowlist or a feature switch where DoorDash asks for one)
import { logActivity, type Actor } from '../activity';
import { missingEnv, nowIso } from '../config';
import {
  autocompleteDriveAddress, cancelDriveDelivery, checkDriveServiceability, compareDriveStores, createCheckoutSession, createDriveBusiness, createDriveStore, driveClassic, getDriveBusiness, getDriveStore,
  itemsSubstitutionRecommendation, listDriveBusinesses, listDriveStoresOf, sendCheckoutAuditSignal, setDriveTip, updateDriveBusiness, updateDriveDelivery, updateDriveStore, allDrivePages, type CheckoutSession,
} from '../delivery/drive-api';
import { driveBusinessId, driveReadiness, getDriveStores } from '../delivery/doordash-drive';
import { getRepo } from '../repo';
import type { ChannelResult, ChannelStore, StoredOrder } from '../types';
import * as adsApi from './ads';
import { ddRequest, getDoorDashAvailability, getDoorDashMenuDetails, getDoorDashStoreDetails, getDoorDashStoreMenu, DOORDASH_CREDENTIALS } from './api';
import { doorDashStoreRefusal, guardDoorDashOrder } from './guard';
import { legacy } from './legacy';
import { nvMultiLocationOnboardingIntent, managedMerchantConnectUrl, requestDoorDashActivation, ssio, type ManagedMerchantConnect } from './onboarding';
import { adjustDoorDashOrder, doorDashAdjustEnabled, optionAdjustment, returnDoorDashOrder, sendOrderEvent, substitutionFor, type ReturnItem } from './orders';
import { buildPharmacyDeeplink } from './pharmacy';
import { createRetailPullJob, doorDashRetailReadiness, pushRetailCatalog, pushRetailPromotion, pushRetailStoreHours, pushRetailStoreItems, setRetailFulfillmentCapacity, updateRetailBusinessItems, authorizeCheckoutTransaction, addCheckoutTransactions, type CheckoutTransaction, type RetailPromotion } from './retail';
import { getDoorDashReportFile, listDoorDashReports, refreshDoorDashReport, REPORT_TYPES, requestDoorDashReport } from './reports';
import { reconcileDoorDashAvailability, setDoorDashMenuActive, setDoorDashStoreStatus, STORE_STATUS_REASONS, verifyDoorDashHours, type StoreStatusReason } from './stores';
import { listProducts } from '../retail/catalog';
import type { Permission } from '../session';
import type { PolicyAction } from '../policy';


export type ParamType = 'store' | 'order' | 'text' | 'number' | 'bool' | 'json' | 'date' | 'select';
export interface ActionParam { name: string; type: ParamType; label: string; required?: boolean; options?: string[]; placeholder?: string; default?: string }
export interface ActionOut { ok: boolean; message: string; data?: unknown }
export interface ActionCtx { actor: Actor; input: Record<string, any> }
export interface DoorDashAction {
  id: string; group: string; label: string; labelFr: string; help: string;
  perm: Permission; write: boolean; policy?: PolicyAction;
  params: ActionParam[];
  run(ctx: ActionCtx): Promise<ActionOut>;
}

async function guardDoorDashStoreRow(storeRowId: string, kind: 'read' | 'write'): Promise<string | null> {
  const s = await getRepo().getStore(storeRowId).catch(() => null);
  return s && s.channel === 'doordash' ? doorDashStoreRefusal(s, kind) : null;
}
async function guardDoorDashOrderRow(orderId: string, kind: 'read' | 'write'): Promise<string | null> {
  const o = await getRepo().getOrder(orderId).catch(() => null);
  return o && o.channel === 'doordash' ? guardDoorDashOrder(o, kind) : null;
}

const fromResult = (r: ChannelResult & { data?: unknown }): ActionOut => ({ ok: r.ok, message: r.message, data: r.data ?? r.response });
const fromDrive = (r: { ok: boolean; message: string; data?: unknown }): ActionOut => ({ ok: r.ok, message: r.message, data: r.data });
const bad = (message: string): ActionOut => ({ ok: false, message });

async function storeOf(input: Record<string, any>, key = 'store'): Promise<ChannelStore | string> {
  const id = String(input[key] ?? '');
  const s = id ? await getRepo().getStore(id).catch(() => null) : null;
  if (!s) return 'Choose a store.';
  if (s.channel !== 'doordash') return 'Choose a DoorDash store.';
  return s;
}
async function orderOf(input: Record<string, any>): Promise<StoredOrder | string> {
  const id = String(input.order ?? '');
  const o = id ? await getRepo().getOrder(id).catch(() => null) : null;
  if (!o) return 'Choose an order.';
  if (o.channel !== 'doordash') return 'Choose a DoorDash order.';
  return o;
}
const json = (v: unknown): any => { if (v && typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return undefined; } };
const withStore = (fn: (s: ChannelStore, c: ActionCtx) => Promise<ActionOut>) => async (c: ActionCtx): Promise<ActionOut> => { const s = await storeOf(c.input); return typeof s === 'string' ? bad(s) : fn(s, c); };
const withOrder = (fn: (o: StoredOrder, c: ActionCtx) => Promise<ActionOut>) => async (c: ActionCtx): Promise<ActionOut> => { const o = await orderOf(c.input); return typeof o === 'string' ? bad(o) : fn(o, c); };
const withJson = (name: string, fn: (body: any, c: ActionCtx) => Promise<ActionOut>) => async (c: ActionCtx): Promise<ActionOut> => { const b = json(c.input[name]); return b === undefined ? bad(`“${name}” must be valid JSON.`) : fn(b, c); };

const STORE: ActionParam = { name: 'store', type: 'store', label: 'DoorDash store', required: true };
const ORDER: ActionParam = { name: 'order', type: 'order', label: 'DoorDash order', required: true };
const body = (name = 'body', label = 'JSON body'): ActionParam => ({ name, type: 'json', label, required: true, placeholder: '{ }' });

// ---------------------------------------------------------------------------------------------- operation tables for the big APIs

type Args = { type?: string; id?: string; id2?: string; body?: any };
type Op = (a: Args) => Promise<ActionOut> | ActionOut;
const campaignType = (a: Args) => (a.type === 'sb' ? 'sb' : 'sp') as adsApi.CampaignType;
const adsOut = (r: Promise<adsApi.AdsResult> | adsApi.AdsResult): Promise<ActionOut> => Promise.resolve(r).then(fromResult);

export const ADS_OPS: Record<string, Op> = {
  createCampaign: (a) => adsOut(adsApi.createCampaign(campaignType(a), a.body)),
  updateCampaign: (a) => adsOut(adsApi.updateCampaign(campaignType(a), a.body)),
  listCampaigns: (a) => adsOut(adsApi.listCampaigns(campaignType(a), a.body ?? {})),
  getCampaign: (a) => adsOut(adsApi.getCampaign(campaignType(a), a.id ?? '')),
  campaignRecommendations: (a) => adsOut(adsApi.campaignRecommendations(a.id ?? '')),
  createAdGroup: (a) => adsOut(adsApi.createAdGroup(campaignType(a), a.body)),
  updateAdGroup: (a) => adsOut(adsApi.updateAdGroup(campaignType(a), a.body)),
  listAdGroups: (a) => adsOut(adsApi.listAdGroups(campaignType(a), a.body ?? {})),
  getAdGroup: (a) => adsOut(adsApi.getAdGroup(campaignType(a), a.id ?? '')),
  createProductAd: (a) => adsOut(adsApi.createProductAd(campaignType(a), a.body)),
  listProductAds: (a) => adsOut(adsApi.listProductAds(campaignType(a), a.body ?? {})),
  deleteProductAd: (a) => adsOut(adsApi.deleteProductAd(campaignType(a), a.body)),
  createAsset: (a) => adsOut(adsApi.createAsset(a.body)),
  getAsset: (a) => adsOut(adsApi.getAsset(a.id ?? '')),
  registerAsset: (a) => adsOut(adsApi.registerAsset(a.id ?? '')),
  createCreatives: (a) => adsOut(adsApi.createCreatives(a.body)),
  listCreatives: (a) => adsOut(adsApi.listCreatives(a.id ?? '', a.body ?? {})),
  getMerchants: () => adsOut(adsApi.getMerchants()),
  recommendedKeywords: (a) => adsOut(adsApi.recommendedKeywords(a.body)),
  recommendedKeywordsForAdGroup: (a) => adsOut(adsApi.recommendedKeywordsForAdGroup(a.id ?? '', a.body)),
  searchResources: (a) => adsOut(adsApi.searchResources(a.body)),
  validateCatalog: (a) => adsOut(adsApi.validateCatalog(a.body ?? [])),
  menuLabels: () => adsOut(adsApi.menuLabels()),
  audienceEstimate: (a) => adsOut(adsApi.audienceEstimate(a.body)),
  createReport: (a) => adsOut(adsApi.createAdsReport(String(a.id) as adsApi.AdsRecordType, a.body ?? {})),
  downloadReport: (a) => adsOut(adsApi.downloadAdsReport(a.id ?? '')),
  listReports: (a) => adsOut(adsApi.listAdsReports(a.body ?? {})),
};

export const SSIO_OPS: Record<string, Op> = {
  exchangeToken: async (a) => fromResult(await ssio.exchangeToken(a.body)),
  storeCandidates: async (a) => fromResult(await ssio.storeCandidates(String(a.body?.merchantJwt ?? ''), a.body?.limit, a.body?.offset)),
  initialize: async (a) => fromResult(await ssio.initialize(String(a.body?.merchantJwt ?? ''), a.body?.request ?? {})),
  status: async (a) => fromResult(await ssio.status(a.id ?? '')),
  putMenu: async (a) => fromResult(await ssio.putMenu(a.id ?? '', a.body ?? {})),
  enable: async (a) => fromResult(await ssio.enable(a.id ?? '')),
  signupUrl: async (a) => fromResult(await ssio.signupUrl(a.body ?? {})),
  reset: async (a) => fromResult(await ssio.reset(a.id ?? '')),
  onboardingMenu: async (a) => fromResult(await ssio.onboardingMenu(a.id ?? '')),
};

export const LEGACY_OPS: Record<string, Op> = {
  createMenu: async (a) => fromResult(await legacy.createMenu(a.body, a.id)),
  updateMenu: async (a) => fromResult(await legacy.updateMenu(a.id ?? '', a.body)),
  confirmOrder: async (a) => fromResult(await legacy.confirmOrder(a.id ?? '', a.body)),
  adjustOrder: async (a) => fromResult(await legacy.adjustOrder(a.id ?? '', a.body)),
  cancelOrder: async (a) => fromResult(await legacy.cancelOrder(a.id ?? '', a.body)),
  orderEvent: async (a) => fromResult(await legacy.orderEvent(a.id ?? '', a.id2 ?? 'order_ready_for_pickup', a.body)),
  storeInfo: async (a) => fromResult(await legacy.storeInfo(a.id ?? '')),
  setStoreActivation: async (a) => fromResult(await legacy.setStoreActivation(a.id ?? '', a.body)),
  setItemActivation: async (a) => fromResult(await legacy.setItemActivation(a.id ?? '', a.body)),
  setItemOptionActivation: async (a) => fromResult(await legacy.setItemOptionActivation(a.id ?? '', a.body)),
  menuDetails: async (a) => fromResult(await legacy.menuDetails(a.id ?? '')),
  storeMenu: async (a) => fromResult(await legacy.storeMenu(a.id ?? '')),
};

export const DRIVE_OPS: Record<string, Op> = {
  listBusinesses: async (a) => fromDrive(await listDriveBusinesses(a.body ?? {})),
  allBusinesses: async () => fromDrive(await allDrivePages((t) => listDriveBusinesses({ continuationToken: t }))),
  getBusiness: async (a) => fromDrive(await getDriveBusiness(a.id ?? '')),
  createBusiness: async (a) => fromDrive(await createDriveBusiness(a.body)),
  updateBusiness: async (a) => fromDrive(await updateDriveBusiness(a.id ?? '', a.body)),
  listStores: async (a) => fromDrive(await listDriveStoresOf(a.id ?? '', a.body ?? {})),
  allStores: async (a) => fromDrive(await allDrivePages((t) => listDriveStoresOf(a.id ?? '', { continuationToken: t }))),
  getStore: async (a) => fromDrive(await getDriveStore(a.id ?? '', a.id2 ?? '')),
  createStore: async (a) => fromDrive(await createDriveStore(a.id ?? '', a.body)),
  updateStore: async (a) => fromDrive(await updateDriveStore(a.id ?? '', a.id2 ?? '', a.body)),
  serviceability: async (a) => fromDrive(await checkDriveServiceability(a.body)),
  autocomplete: async (a) => fromDrive(await autocompleteDriveAddress(a.body)),
  updateDelivery: async (a) => fromDrive(await updateDriveDelivery(a.id ?? '', a.body ?? {})),
  cancelDelivery: async (a) => fromDrive(await cancelDriveDelivery(a.id ?? '', a.body ?? {})),
  setTip: async (a) => fromDrive(await setDriveTip(a.id ?? '', Number(a.body?.tip))),
  substitutionRecommendation: async (a) => fromDrive(await itemsSubstitutionRecommendation(a.body)),
  checkoutAuditSignal: async (a) => fromDrive(await sendCheckoutAuditSignal(a.body)),
  classicEstimate: async (a) => fromDrive(await driveClassic.estimate(a.body)),
  classicValidate: async (a) => fromDrive(await driveClassic.validate(a.body)),
  classicCreate: async (a) => fromDrive(await driveClassic.create(a.body)),
  classicGet: async (a) => fromDrive(await driveClassic.get(a.id ?? '')),
  classicUpdate: async (a) => fromDrive(await driveClassic.update(a.id ?? '', a.body ?? {})),
  classicCancel: async (a) => fromDrive(await driveClassic.cancel(a.id ?? '')),
  compareStores: async () => { const reg = await getDriveStores(); return fromDrive(await compareDriveStores(reg?.businessId ?? driveBusinessId(), reg?.stores)); },
};

const opParams = (ops: string[]): ActionParam[] => [
  { name: 'op', type: 'select', label: 'Operation', required: true, options: ops },
  { name: 'type', type: 'text', label: 'Type (sp / sb)', placeholder: 'sp' },
  { name: 'id', type: 'text', label: 'Id (campaign, delivery, business, onboarding, store…)' },
  { name: 'id2', type: 'text', label: 'Second id (store id, event type)' },
  { name: 'body', type: 'json', label: 'JSON body / filters', placeholder: '{ }' },
];
const runOp = (table: Record<string, Op>) => async ({ input }: ActionCtx): Promise<ActionOut> => {
  const op = table[String(input.op ?? '')];
  if (!op) return bad(`Unknown operation “${input.op}”.`);
  const parsed = input.body === undefined || input.body === '' ? undefined : json(input.body);
  if (input.body !== undefined && input.body !== '' && parsed === undefined) return bad('The JSON body is not valid JSON.');
  return Promise.resolve(op({ type: input.type, id: input.id, id2: input.id2, body: parsed }));
};

// ---------------------------------------------------------------------------------------------- the registry

const act = (a: DoorDashAction) => a;

export const DOORDASH_ACTIONS: DoorDashAction[] = [
  // ---- live reads
  act({ id: 'store_details', group: 'Live DoorDash', label: 'Store details', labelFr: 'Détails du magasin', help: 'GET store_details: protocol, auto order release, current pauses.', perm: 'view', write: false, params: [STORE], run: withStore(async (s) => fromResult(await getDoorDashStoreDetails(s.channelStoreId))) }),
  act({ id: 'menu_details', group: 'Live DoorDash', label: 'Menus on DoorDash', labelFr: 'Menus chez DoorDash', help: 'GET menu_details: menu ids, active, last update, hours.', perm: 'view', write: false, params: [STORE], run: withStore(async (s) => fromResult(await getDoorDashMenuDetails(s.channelStoreId))) }),
  act({ id: 'store_menu', group: 'Live DoorDash', label: 'Menu JSON on DoorDash', labelFr: 'Menu tel que DoorDash le sert', help: 'GET store_menu, flattened to items and options with active / suspended.', perm: 'view', write: false, params: [STORE],
    run: withStore(async (s) => { const r = await getDoorDashStoreMenu(s.channelStoreId); return r.ok && r.data ? { ok: true, message: `${r.data.entries.length} item(s) and option(s) on DoorDash.`, data: { menus: r.data.menus, entries: r.data.entries.slice(0, 300) } } : fromResult(r); }) }),
  act({ id: 'item_availability', group: 'Live DoorDash', label: 'One item’s availability', labelFr: 'Disponibilité d’un article', help: 'GET item/availability or item_option/availability.', perm: 'view', write: false,
    params: [STORE, { name: 'itemId', type: 'text', label: 'Item or option id', required: true }, { name: 'kind', type: 'select', label: 'Kind', options: ['item', 'item_option'], default: 'item' }],
    run: withStore(async (s, c) => fromResult(await getDoorDashAvailability(s.channelStoreId, String(c.input.itemId ?? ''), c.input.kind === 'item_option' ? 'item_option' : 'item'))) }),
  act({ id: 'verify_hours', group: 'Live DoorDash', label: 'Check hours and holidays', labelFr: 'Vérifier heures et jours fériés', help: 'Compares the regular and special hours DoorDash serves with the ones Food Hub publishes.', perm: 'view', write: false, params: [STORE],
    run: withStore(async (s) => { const r = await verifyDoorDashHours(s); return { ok: r.ok, message: r.message, data: r.diffs }; }) }),
  act({ id: 'reconcile', group: 'Live DoorDash', label: 'Check 86’d items', labelFr: 'Vérifier les articles en rupture', help: 'Compares what is 86’d on DoorDash with Food Hub; fix re-86s what was lost, restock also switches back on.', perm: 'items:toggle', write: true,
    params: [STORE, { name: 'fix', type: 'bool', label: 'Fix what Food Hub has off and DoorDash still sells' }, { name: 'restock', type: 'bool', label: 'Also switch back on what DoorDash has off and Food Hub has in stock' }],
    run: withStore(async (s, c) => { const r = await reconcileDoorDashAvailability(s, { fix: c.input.fix === true || c.input.fix === 'true', restock: c.input.restock === true || c.input.restock === 'true', actor: c.actor }); return { ok: r.ok, message: r.message, data: r }; }) }),
  // ---- store and menu
  act({ id: 'store_status', group: 'Store & menu', label: 'Pause or resume a store', labelFr: 'Pause / reprise d’un magasin', help: 'PUT status with any DoorDash reason, an end time or a duration.', perm: 'stores:toggle', write: true, policy: 'store.pause',
    params: [STORE, { name: 'active', type: 'bool', label: 'Active (resume)' }, { name: 'reason', type: 'select', label: 'Reason when pausing', options: [...STORE_STATUS_REASONS], default: 'operational_issues' }, { name: 'notes', type: 'text', label: 'Notes' },
      { name: 'endTime', type: 'text', label: 'End time (ISO with offset)', placeholder: '2026-10-10T08:00:00-04:00' }, { name: 'durationHours', type: 'number', label: 'Or duration in hours' }],
    run: withStore(async (s, c) => fromResult(await setDoorDashStoreStatus(s.channelStoreId, { active: c.input.active === true || c.input.active === 'true', reason: c.input.reason as StoreStatusReason, notes: c.input.notes || undefined, endTime: c.input.endTime || undefined, durationHours: c.input.durationHours === undefined || c.input.durationHours === '' ? undefined : Number(c.input.durationHours) }))) }),
  act({ id: 'menu_active', group: 'Store & menu', label: 'Hide or show the whole menu', labelFr: 'Cacher / montrer tout le menu', help: 'Publishes the menu with its active flag on or off.', perm: 'menu:edit', write: true, policy: 'menu.publish',
    params: [STORE, { name: 'active', type: 'bool', label: 'Menu visible' }], run: withStore(async (s, c) => fromResult(await setDoorDashMenuActive(s, c.input.active === true || c.input.active === 'true', c.actor))) }),
  act({ id: 'request_activation', group: 'Store & menu', label: 'Request DoorDash activation (SOW)', labelFr: 'Demander l’activation DoorDash (SOW)', help: 'Store Onboarding Webhook: DoorDash emails the Business Admin, pulls the menu and activates.', perm: 'stores:map', write: true,
    params: [STORE, { name: 'merchantEmail', type: 'text', label: 'Merchant decision maker email (Business Admin)', required: true }, { name: 'firstName', type: 'text', label: 'Your first name', required: true }, { name: 'lastName', type: 'text', label: 'Your last name', required: true },
      { name: 'email', type: 'text', label: 'Your email (status updates)', required: true }, { name: 'phone', type: 'text', label: 'Your phone' }, { name: 'goLive', type: 'date', label: 'Expected go-live' }],
    run: withStore(async (s, c) => {
      const loc = (await (await import('../catalog')).getCatalog()).locations.find((l) => l.code === s.locationCode);
      if (!loc) return bad(`Location ${s.locationCode} is not in Brands & Locations.`);
      return fromResult(await requestDoorDashActivation(s, { name: loc.name, address: loc.address, city: loc.city, postalCode: loc.postalCode }, { firstName: String(c.input.firstName ?? ''), lastName: String(c.input.lastName ?? ''), email: String(c.input.email ?? ''), phone: c.input.phone || undefined }, String(c.input.merchantEmail ?? ''), c.actor, { expectedGoLive: c.input.goLive || undefined }));
    }) }),
  // ---- orders
  act({ id: 'order_substitute', group: 'Orders', label: 'Substitute an item', labelFr: 'Remplacer un article', help: 'ITEM_SUBSTITUTE on the order adjustment endpoint (needs DoorDash’s allowlist).', perm: 'orders:act', write: true, policy: 'order.adjust',
    params: [ORDER, { name: 'line', type: 'number', label: 'Line number (0 = first)', required: true }, { name: 'name', type: 'text', label: 'Replacement name', required: true }, { name: 'itemId', type: 'text', label: 'Replacement item id', required: true }, { name: 'price', type: 'number', label: 'Price ($)', required: true }],
    run: withOrder(async (o, c) => { const s = substitutionFor(o, Number(c.input.line), { name: String(c.input.name ?? ''), merchantSuppliedId: String(c.input.itemId ?? ''), price: Number(c.input.price) }); return s.item ? fromResult(await adjustDoorDashOrder(o, [s.item])) : bad(s.error!); }) }),
  act({ id: 'order_option', group: 'Orders', label: 'Change or remove an option', labelFr: 'Modifier / retirer une option', help: 'Option-level ITEM_UPDATE / ITEM_REMOVE.', perm: 'orders:act', write: true, policy: 'order.adjust',
    params: [ORDER, { name: 'line', type: 'number', label: 'Line number', required: true }, { name: 'option', type: 'number', label: 'Option number', required: true }, { name: 'quantity', type: 'number', label: 'New quantity (0 = remove)', required: true }],
    run: withOrder(async (o, c) => { const s = optionAdjustment(o, Number(c.input.line), Number(c.input.option), Number(c.input.quantity)); return s.item ? fromResult(await adjustDoorDashOrder(o, [s.item])) : bad(s.error!); }) }),
  act({ id: 'order_ready_event', group: 'Orders', label: 'Send “ready for pickup”', labelFr: 'Envoyer « prête »', help: 'PATCH events/order_ready_for_pickup.', perm: 'orders:act', write: true, params: [ORDER], run: withOrder(async (o) => fromResult(await sendOrderEvent(o))) }),
  act({ id: 'order_return', group: 'Orders', label: 'Retail order return', labelFr: 'Retour d’une commande (épicerie)', help: 'POST orders/{id}/return, once per order (needs DoorDash’s allowlist).', perm: 'orders:act', write: true, policy: 'order.adjust',
    params: [ORDER, { name: 'items', type: 'json', label: 'Returned items', required: true, placeholder: '[{"merchant_supplied_id":"sku","quantity":1,"reason":"missing_item"}]' }, { name: 'locationId', type: 'text', label: 'Store that took the return', required: true }],
    run: withOrder(async (o, c) => { const items = json(c.input.items) as ReturnItem[] | undefined; return Array.isArray(items) ? fromResult(await returnDoorDashOrder(o, items, String(c.input.locationId ?? ''))) : bad('“items” must be a JSON list.'); }) }),
  // ---- reports
  act({ id: 'report_request', group: 'Reports', label: 'Request a report', labelFr: 'Demander un rapport', help: 'Reporting API: financial, operations, menu and feedback reports.', perm: 'analytics:view', write: false,
    params: [{ name: 'reportType', type: 'select', label: 'Report', required: true, options: [...REPORT_TYPES] }, { name: 'from', type: 'date', label: 'From', required: true }, { name: 'to', type: 'date', label: 'To', required: true }],
    run: async (c) => { const r = await requestDoorDashReport({ reportType: String(c.input.reportType ?? ''), from: String(c.input.from ?? ''), to: String(c.input.to ?? '') }, c.actor); return 'status' in r && 'channel' in r ? fromResult(r as ChannelResult) : { ok: (r as { status: string }).status !== 'failed', message: (r as { message: string }).message, data: r }; } }),
  act({ id: 'report_refresh', group: 'Reports', label: 'Fetch a requested report', labelFr: 'Récupérer un rapport demandé', help: 'Asks DoorDash for the report link, downloads it, drops protected rows, imports payout reports into Reconciliation.', perm: 'analytics:view', write: false,
    params: [{ name: 'reportId', type: 'text', label: 'Report id', required: true }], run: async (c) => { const r = await refreshDoorDashReport(String(c.input.reportId ?? ''), c.actor); return r ? { ok: r.status !== 'failed', message: r.message, data: r } : bad('Unknown report.'); } }),
  act({ id: 'report_list', group: 'Reports', label: 'Requested reports', labelFr: 'Rapports demandés', help: 'The reports Food Hub asked for.', perm: 'analytics:view', write: false, params: [], run: async () => ({ ok: true, message: 'OK', data: await listDoorDashReports() }) }),
  act({ id: 'report_file', group: 'Reports', label: 'Read a downloaded report', labelFr: 'Lire un rapport téléchargé', help: 'The CSV of a fetched report (first 200 lines).', perm: 'analytics:view', write: false, params: [{ name: 'reportId', type: 'text', label: 'Report id', required: true }],
    run: async (c) => { const f = await getDoorDashReportFile(String(c.input.reportId ?? '')); return f ? { ok: true, message: f.fileName, data: f.csv.split('\n').slice(0, 200).join('\n') } : bad('No downloaded file for this report.'); } }),
  // ---- retail
  act({ id: 'retail_status', group: 'Retail', label: 'Retail status', labelFr: 'État de l’épicerie', help: 'Is Marketplace for Retailers switched on?', perm: 'view', write: false, params: [], run: async () => ({ ok: true, message: 'OK', data: doorDashRetailReadiness() }) }),
  act({ id: 'retail_catalog', group: 'Retail', label: 'Send the catalogue', labelFr: 'Envoyer le catalogue', help: 'POST/PATCH /items for every product (batches of 1000).', perm: 'menu:edit', write: true, policy: 'menu.publish',
    params: [{ name: 'mode', type: 'select', label: 'Mode', options: ['add', 'update'], default: 'add' }], run: async (c) => { const r = await pushRetailCatalog(await listProducts(), c.input.mode === 'update' ? 'update' : 'add', c.actor); return { ok: r.result.ok, message: r.result.message, data: { sent: r.sent, leftOut: r.leftOut } }; } }),
  act({ id: 'retail_store_items', group: 'Retail', label: 'Send store prices and stock', labelFr: 'Envoyer prix et stock', help: 'POST/PATCH /stores/{id}/items.', perm: 'menu:edit', write: true, policy: 'menu.publish',
    params: [STORE, { name: 'mode', type: 'select', label: 'Mode', options: ['update', 'add'], default: 'update' }], run: withStore(async (s, c) => { const r = await pushRetailStoreItems(s.channelStoreId, s.locationCode, c.input.mode === 'add' ? 'add' : 'update'); return { ok: r.result.ok, message: r.result.message, data: { sent: r.sent } }; }) }),
  act({ id: 'retail_store_hours', group: 'Retail', label: 'Send store hours', labelFr: 'Envoyer les heures', help: 'PATCH /stores/{id} with regular and holiday hours.', perm: 'menu:edit', write: true, params: [STORE], run: withStore(async (s) => fromResult(await pushRetailStoreHours(s.channelStoreId, s.brandName, s.locationCode))) }),
  act({ id: 'retail_capacity', group: 'Retail', label: 'Over capacity', labelFr: 'Capacité atteinte', help: 'PATCH fulfillment_capacity.', perm: 'stores:toggle', write: true, params: [STORE, { name: 'status', type: 'select', label: 'Status', options: ['OVER_CAPACITY', 'AVAILABLE'], default: 'OVER_CAPACITY' }],
    run: withStore(async (s, c) => fromResult(await setRetailFulfillmentCapacity(s.channelStoreId, c.input.status === 'AVAILABLE' ? 'AVAILABLE' : 'OVER_CAPACITY'))) }),
  act({ id: 'retail_pull_job', group: 'Retail', label: 'Ask DoorDash to pull our inventory', labelFr: 'Demander à DoorDash de lire notre inventaire', help: 'POST /jobs (REPLACE the store inventory with our answer).', perm: 'menu:edit', write: true, policy: 'menu.publish',
    params: [STORE, { name: 'paginated', type: 'bool', label: 'Paginated' }], run: withStore(async (s, c) => fromResult(await createRetailPullJob(s.channelStoreId, c.input.paginated === true || c.input.paginated === 'true'))) }),
  act({ id: 'retail_promotion', group: 'Retail', label: 'Retail promotion', labelFr: 'Promotion (épicerie)', help: 'POST/PATCH /promotions/stores/{id}.', perm: 'menu:edit', write: true, policy: 'menu.price',
    params: [STORE, { name: 'mode', type: 'select', label: 'Mode', options: ['add', 'update'], default: 'add' }, body('promotion', 'Promotion')],
    run: withStore((s, c) => withJson('promotion', async (b) => fromResult(await pushRetailPromotion(s.channelStoreId, b as RetailPromotion, c.input.mode === 'update' ? 'update' : 'add')))(c)) }),
  act({ id: 'retail_business_items', group: 'Retail', label: 'Update prices across the business', labelFr: 'Prix pour toute l’entreprise', help: 'PATCH /businesses/{id}/items.', perm: 'menu:edit', write: true, policy: 'menu.price', params: [body('items', 'Items')],
    run: withJson('items', async (b) => fromResult(await updateRetailBusinessItems(b))) }),
  act({ id: 'retail_checkout_auth', group: 'Retail', label: 'Authorise a checkout', labelFr: 'Autoriser un paiement', help: 'POST checkout/transactions/auth.', perm: 'finance:edit', write: true, params: [STORE, body('request', 'Request')],
    run: withStore((s, c) => withJson('request', async (b) => fromResult(await authorizeCheckoutTransaction(s.channelStoreId, b)))(c)) }),
  act({ id: 'retail_checkout_transactions', group: 'Retail', label: 'Send checkout transactions', labelFr: 'Envoyer les transactions', help: 'POST checkout/transactions.', perm: 'finance:edit', write: true, params: [STORE, body('transactions', 'Transactions')],
    run: withStore((s, c) => withJson('transactions', async (b) => fromResult(await addCheckoutTransactions(s.channelStoreId, b as CheckoutTransaction[])))(c)) }),
  act({ id: 'managed_connect', group: 'Onboarding', label: 'Hosted onboarding link (retail)', labelFr: 'Lien d’intégration hébergé (épicerie)', help: 'POST managed_merchant_connect_url.', perm: 'admin', write: true, params: [body()], run: withJson('body', async (b) => fromResult(await managedMerchantConnectUrl(b as ManagedMerchantConnect))) }),
  act({ id: 'nv_intent', group: 'Onboarding', label: 'Onboard up to 100 locations (retail)', labelFr: 'Intégrer jusqu’à 100 sites (épicerie)', help: 'POST nv_multi_location_onboarding_intent.', perm: 'admin', write: true, params: [body('requests', 'Locations')], run: withJson('requests', async (b) => fromResult(await nvMultiLocationOnboardingIntent(b as ManagedMerchantConnect[]))) }),
  act({ id: 'ssio', group: 'Onboarding', label: 'Self-serve onboarding (SSIO)', labelFr: 'Intégration en libre-service (SSIO)', help: 'tokens, store_candidates, store_onboarding, menus, enable, signup_url, reset.', perm: 'admin', write: true, params: opParams(Object.keys(SSIO_OPS)), run: runOp(SSIO_OPS) }),
  // ---- Drive
  act({ id: 'drive_status', group: 'Drive', label: 'Drive status', labelFr: 'État de Drive', help: 'Credentials, sandbox or production, registered kitchens.', perm: 'view', write: false, params: [], run: async () => ({ ok: true, message: 'OK', data: { readiness: driveReadiness(), registry: await getDriveStores() } }) }),
  act({ id: 'drive', group: 'Drive', label: 'Drive API', labelFr: 'API Drive', help: 'Businesses, stores, serviceability, address suggestions, update / cancel a delivery, tip, Dasher Shop, Drive classic.', perm: 'stores:map', write: true, params: opParams(Object.keys(DRIVE_OPS)), run: runOp(DRIVE_OPS) }),
  act({ id: 'checkout_session', group: 'Drive', label: 'DoorDash Checkout session', labelFr: 'Session DoorDash Checkout', help: 'POST /drive/v1/checkout: DoorDash takes the payment and creates the delivery.', perm: 'admin', write: true, params: [body('session', 'Cart, consumer, address')],
    run: withJson('session', async (b) => { const r = await createCheckoutSession(b as CheckoutSession); return { ok: r.ok, message: r.message, data: { orderSessionId: r.orderSessionId, webviewUrl: r.webviewUrl } }; }) }),
  // ---- Ads, legacy, pharmacy
  act({ id: 'ads', group: 'Ads', label: 'Ads API', labelFr: 'API Publicité', help: 'Campaigns, ad groups, product ads, creatives, assets, keywords, audiences, reports (needs a DoorDash Ads API key).', perm: 'admin', write: true, params: opParams(Object.keys(ADS_OPS)), run: runOp(ADS_OPS) }),
  act({ id: 'legacy', group: 'Legacy', label: 'Marketplace (legacy) API', labelFr: 'API Marketplace (ancienne)', help: 'The older pointofsale.doordash.com reference.', perm: 'admin', write: true, params: opParams(Object.keys(LEGACY_OPS)), run: runOp(LEGACY_OPS) }),
  act({ id: 'pharmacy_link', group: 'Pharmacy', label: 'Pharmacy deeplink', labelFr: 'Lien pharmacie', help: 'Builds (and signs) a prescription deeplink. Never put patient information in it.', perm: 'admin', write: false,
    params: [{ name: 'merchantTag', type: 'text', label: 'merchant_tag', required: true }, { name: 'storeId', type: 'text', label: 'store_id', required: true }, body('items', 'Items [{name, copayCents, expiresAtUnix}]')],
    run: withJson('items', async (items, c) => { const r = buildPharmacyDeeplink({ merchantTag: String(c.input.merchantTag ?? ''), storeId: String(c.input.storeId ?? ''), items }); return r.url ? { ok: true, message: 'OK', data: r.url } : bad(r.error!); }) }),
  // ---- raw
  act({ id: 'raw_get', group: 'Live DoorDash', label: 'Any Marketplace GET', labelFr: 'N’importe quel GET Marketplace', help: 'A read-only GET on a Marketplace path (still refuses protected stores).', perm: 'admin', write: false, params: [{ name: 'path', type: 'text', label: 'Path', required: true, placeholder: '/api/v1/stores/…/store_details' }],
    run: async (c) => { const path = String(c.input.path ?? ''); if (!/^\/api\/v[12]\//.test(path)) return bad('The path must start with /api/v1/ or /api/v2/.'); return fromResult(await ddRequest({ method: 'GET', path })); } }),
];

export function doorDashActionById(id: string): DoorDashAction | undefined { return DOORDASH_ACTIONS.find((a) => a.id === id); }

/** What is configured, area by area, in plain words (shown at the top of Settings → DoorDash). */
export function doorDashApiStatus() {
  const mk = missingEnv(DOORDASH_CREDENTIALS);
  const live = process.env.LIVE_CONNECTORS_GLOBAL_ENABLED === 'true';
  const drive = driveReadiness();
  const reports = process.env.DOORDASH_REPORTS_KEY_ID ? [] : mk;
  const area = (key: string, label: string, ready: boolean, missing: string[], note: string) => ({ key, label, ready, missing, note });
  return [
    area('marketplace', 'Marketplace (restaurants)', mk.length === 0, mk, live ? 'Live.' : 'Reads work; changes need LIVE_CONNECTORS_GLOBAL_ENABLED=true.'),
    area('adjustment', 'Order adjustments', doorDashAdjustEnabled(), doorDashAdjustEnabled() ? [] : ['DOORDASH_ORDER_ADJUSTMENT=true after DoorDash allowlists you'], 'Remove, reduce or substitute items after confirming.'),
    area('reports', 'Reporting API', reports.length === 0, reports, 'Reports integration key (DOORDASH_REPORTS_*), else the Marketplace key.'),
    area('retail', 'Marketplace for Retailers', doorDashRetailReadiness().ready, doorDashRetailReadiness().missing, 'Catalogue, store items, jobs, promotions, checkout.'),
    area('drive', `Drive (${drive.environment})`, drive.configured, drive.missing, drive.note),
    area('ads', 'Ads API', Boolean(process.env.DOORDASH_ADS_API_KEY), process.env.DOORDASH_ADS_API_KEY ? [] : ['DOORDASH_ADS_API_KEY'], 'Needs a DoorDash Ads API key.'),
    area('checkout', 'Checkout API', Boolean(process.env.DOORDASH_CHECKOUT_API_KEY), process.env.DOORDASH_CHECKOUT_API_KEY ? [] : ['DOORDASH_CHECKOUT_API_KEY'], 'DoorDash takes the payment; Drive support issues the key.'),
  ];
}

/** Runs one action: permission already checked by the route. Writes are logged; nothing throws. */
export async function runDoorDashAction(action: DoorDashAction, ctx: ActionCtx): Promise<ActionOut> {
  let out: ActionOut;
  try {
    // First line of defence, for every action: a protected store (Po Poulet NDG…) chosen as the store or as the order's store
    // stops the action here. Each call below checks again by itself (doordash/guard.ts), so this is never the only check.
    const kind = action.write ? 'write' : 'read';
    const refused = (ctx.input.store ? await guardDoorDashStoreRow(String(ctx.input.store), kind) : null) ?? (ctx.input.order ? await guardDoorDashOrderRow(String(ctx.input.order), kind) : null);
    out = refused ? { ok: false, message: refused } : await action.run(ctx);
  } catch (error) { out = { ok: false, message: error instanceof Error ? error.message : String(error) }; }
  if (action.write) {
    await logActivity({ actor: ctx.actor.name, source: ctx.actor.source, kind: 'settings', action: `doordash_${action.id}`, status: out.ok ? 'success' : 'failed', channel: 'doordash', summary: `DoorDash · ${action.label}: ${out.message}`.slice(0, 300), detail: { at: nowIso() } }).catch(() => undefined);
  }
  return out;
}
