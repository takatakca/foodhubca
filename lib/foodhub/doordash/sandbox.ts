// DoorDash sandbox-safe mode: DoorDash Marketplace SANDBOX webhooks can reach the production Food Hub without any
// effect on real operations.
//
// When is a DoorDash webhook sandbox traffic? (any one of these is enough)
//   1. the whole integration is a sandbox one: DOORDASH_ENV=sandbox, or DOORDASH_PROVIDER_TYPE ends with "_sandbox"
//      (DoorDash names sandbox provider types that way). Then EVERY DoorDash Marketplace webhook is a test;
//   2. the payload names a DoorDash test store listed in DOORDASH_SANDBOX_STORE_IDS (location id = merchant_supplied_id,
//      or DoorDash's own store id), comma separated;
//   3. the payload itself says so: a store provider_type ending with "_sandbox";
//   4. it is about a sandbox test order Food Hub already holds (a cancel, a Dasher update, an adjustment…).
//
// A sandbox order is kept in its own list (Settings → Platforms → DoorDash sandbox tests), NEVER in the orders table:
// so it is never sent to Clover, never printed, never rings a kitchen screen, never raises a Watchtower alert, SMS or
// call, and never counts in money or reports. Its DoorDash-facing flow (confirm, reject, ready, cancel, menu pull,
// menu push, item and store availability) uses the same DoorDash calls as a real order, aimed only at the test store.
//
// Without DOORDASH_ENV, a sandbox provider type and DOORDASH_SANDBOX_STORE_IDS, Food Hub behaves exactly as before
// (rule 3 only matches payloads DoorDash marks as sandbox, which real traffic never is).
// Webhook authentication is not touched here: the route checks DOORDASH_WEBHOOK_SECRET before anything is read.
import { nowIso } from '../config';
import { menuLockOf } from '../menu/lock';
import { getRepo } from '../repo';
import type { ChannelStore, CourierStatus, NormalizedOrder } from '../types';

const SANDBOX_SUFFIX = /_sandbox$/i;

/** A protected DoorDash store (Po Poulet NDG, any menu lock): the rule of doordash/guard.ts, read here without an import cycle. */
const isProtectedDoorDashId = (id: string) => menuLockOf({ channel: 'doordash', channelStoreId: id, meta: {} }).locked;
/** The merchant_supplied_id Food Hub sends when it confirms a sandbox order (comes back as client_order_id). */
export const SANDBOX_CLIENT_PREFIX = 'takatak-test-';

type Env = Record<string, string | undefined>;

/** DOORDASH_ENV as written: 'sandbox', 'production' or '' (unset). */
export function doorDashEnvSetting(env: Env = process.env): string {
  return String(env.DOORDASH_ENV ?? '').trim().toLowerCase();
}

/** The whole DoorDash Marketplace integration is a sandbox one (sandbox credentials): every webhook is a test. */
export function doorDashIntegrationIsSandbox(env: Env = process.env): boolean {
  return doorDashEnvSetting(env) === 'sandbox' || SANDBOX_SUFFIX.test(String(env.DOORDASH_PROVIDER_TYPE ?? '').trim());
}

/**
 * DoorDash test stores (DOORDASH_SANDBOX_STORE_IDS: location ids and/or DoorDash store ids, comma / space separated).
 * A protected store (Po Poulet NDG, any menu lock) is never a test store: it is dropped from the list.
 */
export function doorDashSandboxStoreIds(env: Env = process.env): string[] {
  const ids = String(env.DOORDASH_SANDBOX_STORE_IDS ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(ids)].filter((id) => !isProtectedDoorDashId(id));
}

/** Sandbox-safe mode is on: the integration is a sandbox one, or at least one test store is listed. */
export function doorDashSandboxActive(env: Env = process.env): boolean {
  return doorDashIntegrationIsSandbox(env) || doorDashSandboxStoreIds(env).length > 0;
}

export function isDoorDashSandboxStoreId(id: unknown, env: Env = process.env): boolean {
  const v = String(id ?? '').trim();
  return Boolean(v) && doorDashSandboxStoreIds(env).includes(v);
}

/**
 * May Food Hub change this DoorDash store (menu, items, open/closed) right now? With a sandbox integration, only a
 * listed test store: the sandbox credentials must never be aimed at a real store. Null = allowed.
 */
export function doorDashSandboxStoreRefusal(channelStoreId: unknown, env: Env = process.env): string | null {
  if (!doorDashIntegrationIsSandbox(env) || isDoorDashSandboxStoreId(channelStoreId, env)) return null;
  return `Not sent: DoorDash is in sandbox mode (DOORDASH_ENV / provider type) — only the sandbox test store(s) in DOORDASH_SANDBOX_STORE_IDS are changed, never store ${String(channelStoreId ?? '') || '(none)'}.`;
}

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);

/** Every store object a DoorDash webhook can carry (order, cancel, Dasher status, release, menu, store events). */
function storeObjects(body: any): Array<Record<string, any>> {
  return [obj(body?.store), obj(body?.order?.store), obj(body?.delivery?.store), obj(body?.event?.store)].filter((s): s is Record<string, any> => Boolean(s));
}

/** The DoorDash store ids a payload names (merchant_supplied_id / location id, and DoorDash's own store id). */
export function payloadStoreIds(body: any): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) out.add(String(v).trim()); };
  for (const s of storeObjects(body)) { add(s.merchant_supplied_id); add(s.id); add(s.doordash_store_id); add(s.store_id); add(s.location_id); }
  add(body?.location_id); add(body?.delivery?.location_id); add(body?.store_location_id);
  // Menu Status: our own reference "takatak-<merchant_supplied_id>-<timestamp>" names the store.
  const ref = String(body?.event?.reference ?? body?.reference ?? '');
  if (ref.startsWith('takatak-') && !ref.startsWith(SANDBOX_CLIENT_PREFIX)) add(ref.slice('takatak-'.length).replace(/-\d+$/, ''));
  return [...out];
}

/** A provider_type DoorDash marks as sandbox, anywhere a store is described. */
export function sandboxProviderTypeIn(body: any): string | null {
  for (const s of [...storeObjects(body), obj(body) ?? {}]) {
    const p = String(s.provider_type ?? '').trim();
    if (p && SANDBOX_SUFFIX.test(p)) return p;
  }
  return null;
}

/** The order ids a webhook refers to: DoorDash's order id, and the merchant_supplied_id we sent (client_order_id). */
export function payloadOrderRefs(body: any): { doordashId: string; clientOrderId: string } {
  const b = obj(body?.delivery) ? { ...body, ...body.delivery } : body;
  return {
    doordashId: String(b?.external_order_id || b?.order?.external_order_id || b?.order?.id || b?.order_id || b?.id || ''),
    clientOrderId: String(b?.client_order_id || b?.order?.client_order_id || ''),
  };
}

/** Why this payload is sandbox traffic, from the environment and the payload alone (null = not sandbox by these rules). */
export function doorDashSandboxReasonSync(body: any, env: Env = process.env): string | null {
  if (doorDashEnvSetting(env) === 'sandbox') return 'DOORDASH_ENV=sandbox';
  if (SANDBOX_SUFFIX.test(String(env.DOORDASH_PROVIDER_TYPE ?? '').trim())) return 'sandbox provider type (DOORDASH_PROVIDER_TYPE)';
  const ids = doorDashSandboxStoreIds(env);
  const hit = ids.length ? payloadStoreIds(body).find((id) => ids.includes(id)) : undefined;
  if (hit) return `test store ${hit} (DOORDASH_SANDBOX_STORE_IDS)`;
  const marker = sandboxProviderTypeIn(body);
  if (marker) return `payload provider_type ${marker}`;
  if (payloadOrderRefs(body).clientOrderId.startsWith(SANDBOX_CLIENT_PREFIX)) return 'a sandbox test order (client_order_id)';
  return null;
}

/**
 * Why this webhook is sandbox traffic, or null. Also recognises events about a test order Food Hub already holds
 * (looked up only while sandbox-safe mode is on: without the new settings nothing extra is read).
 */
export async function doorDashSandboxReason(body: any, env: Env = process.env): Promise<string | null> {
  const direct = doorDashSandboxReasonSync(body, env);
  if (direct || !doorDashSandboxActive(env)) return direct;
  const { doordashId, clientOrderId } = payloadOrderRefs(body);
  if (!doordashId && !clientOrderId) return null;
  const state = await readSandboxState().catch(() => null);
  const hit = state && findSandboxOrder(state, doordashId, clientOrderId);
  return hit ? `about sandbox test order ${hit.id}` : null;
}

// ---------------------------------------------------------------------------------------------- the test list (KV)

export type SandboxOrderStatus = 'received' | 'confirmed' | 'failed' | 'ready' | 'cancelled';

export interface SandboxEvent { at: string; text: string; ok?: boolean }

export interface SandboxOrder {
  /** DoorDash's order id. */
  id: string;
  /** What Food Hub sends as merchant_supplied_id (DoorDash echoes it as client_order_id). */
  clientOrderId: string;
  displayId?: string;
  storeId: string;
  reason: string;
  status: SandboxOrderStatus;
  /** A cancel that arrived before the order: kept so the order is never confirmed when it lands. */
  placeholder?: boolean;
  order?: NormalizedOrder;
  courier?: CourierStatus;
  receivedAt: string;
  updatedAt: string;
  events: SandboxEvent[];
}

export interface SandboxLogEntry { at: string; kind: string; text: string; ok?: boolean; storeId?: string | null }

export interface SandboxState {
  orders: SandboxOrder[];
  log: SandboxLogEntry[];
  /** DoorDash menu id per test store (DoorDash returns it on Menu Status): the next push updates that menu. */
  menuIds: Record<string, string>;
  /** Test stores paused from Food Hub (the sandbox store's own open/closed state, never a real store's). */
  paused: Record<string, boolean>;
}

export interface SandboxConfig {
  /** The brand whose menu the test store gets (menu pull and push). */
  brandName?: string;
  /** The location whose prices, hours and 86s apply. */
  locationCode?: string;
  /** Confirm each test order on DoorDash as soon as it arrives (as auto-accept does for a real one). */
  autoConfirm: boolean;
}

export const SANDBOX_STATE_KEY = 'doordash:sandbox';
export const SANDBOX_CONFIG_KEY = 'doordash:sandbox:config';
const MAX_ORDERS = 50;
const MAX_LOG = 100;
const MAX_EVENTS = 30;

export async function readSandboxState(): Promise<SandboxState> {
  const s = (await getRepo().getKv<Partial<SandboxState>>(SANDBOX_STATE_KEY).catch(() => null)) ?? {};
  return { orders: Array.isArray(s.orders) ? s.orders : [], log: Array.isArray(s.log) ? s.log : [], menuIds: s.menuIds ?? {}, paused: s.paused ?? {} };
}

export async function writeSandboxState(s: SandboxState): Promise<void> {
  await getRepo().setKv(SANDBOX_STATE_KEY, { ...s, orders: s.orders.slice(0, MAX_ORDERS), log: s.log.slice(0, MAX_LOG) });
}

export async function readSandboxConfig(): Promise<SandboxConfig> {
  const c = (await getRepo().getKv<Partial<SandboxConfig>>(SANDBOX_CONFIG_KEY).catch(() => null)) ?? {};
  return { ...(c.brandName ? { brandName: String(c.brandName) } : {}), ...(c.locationCode ? { locationCode: String(c.locationCode) } : {}), autoConfirm: c.autoConfirm !== false };
}

export async function writeSandboxConfig(patch: Partial<SandboxConfig>): Promise<SandboxConfig> {
  const next = { ...(await readSandboxConfig()), ...patch };
  await getRepo().setKv(SANDBOX_CONFIG_KEY, next);
  return next;
}

export function findSandboxOrder(state: SandboxState, doordashId: string, clientOrderId = ''): SandboxOrder | undefined {
  return state.orders.find((o) => (doordashId && o.id === doordashId) || (clientOrderId && o.clientOrderId === clientOrderId));
}

/** Adds a line to an order's history (newest last, capped). */
export function addSandboxEvent(o: SandboxOrder, text: string, ok?: boolean): SandboxOrder {
  const at = nowIso();
  o.events = [...o.events, { at, text, ...(ok === undefined ? {} : { ok }) }].slice(-MAX_EVENTS);
  o.updatedAt = at;
  return o;
}

export function addSandboxLog(state: SandboxState, entry: Omit<SandboxLogEntry, 'at'>): void {
  state.log = [{ at: nowIso(), ...entry }, ...state.log].slice(0, MAX_LOG);
}

/**
 * The test store as a store row, for the DoorDash calls (menu pull / push, items, open/closed). It is never written to
 * the stores table: Watchtower, the store sync and the reports never see it. Null when the id is not a test store.
 */
export async function sandboxStoreFor(channelStoreId: string, state?: SandboxState): Promise<ChannelStore | null> {
  const id = String(channelStoreId ?? '').trim();
  if (!isDoorDashSandboxStoreId(id)) return null;
  const [cfg, st] = await Promise.all([readSandboxConfig(), state ? Promise.resolve(state) : readSandboxState()]);
  return {
    id: `sandbox:${id}`, channel: 'doordash', channelStoreId: id, brandName: cfg.brandName ?? '', locationCode: cfg.locationCode ?? '',
    cloverMerchantId: null, autoAccept: cfg.autoConfirm, online: !st.paused[id], pausedUntil: null,
    meta: { sandbox: true, ...(st.menuIds[id] ? { doordashMenuId: st.menuIds[id] } : {}) },
  };
}

/** What the settings page shows about the mode. */
export function doorDashSandboxStatus(env: Env = process.env) {
  const integration = doorDashIntegrationIsSandbox(env);
  const envSetting = doorDashEnvSetting(env);
  const providerSandbox = SANDBOX_SUFFIX.test(String(env.DOORDASH_PROVIDER_TYPE ?? '').trim());
  const listed = String(env.DOORDASH_SANDBOX_STORE_IDS ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const storeIds = doorDashSandboxStoreIds(env);
  const warnings: string[] = [];
  if (envSetting === 'sandbox' && env.DOORDASH_PROVIDER_TYPE && !providerSandbox) warnings.push('DOORDASH_ENV=sandbox but DOORDASH_PROVIDER_TYPE does not end with _sandbox: every DoorDash order is treated as a TEST — set DOORDASH_ENV=production once DoorDash gives production keys.');
  if (envSetting === 'production' && providerSandbox) warnings.push('DOORDASH_ENV=production but DOORDASH_PROVIDER_TYPE ends with _sandbox: Food Hub keeps sandbox-safe mode on (the provider type is a sandbox one).');
  if (integration && !storeIds.length) warnings.push('No test store in DOORDASH_SANDBOX_STORE_IDS yet: menu pushes, items and open/closed changes are refused until it is set.');
  if (listed.length > storeIds.length) warnings.push('A protected store was listed in DOORDASH_SANDBOX_STORE_IDS and was ignored (it is never touched).');
  return { active: integration || storeIds.length > 0, integration, env: envSetting || null, providerSandbox, storeIds, warnings };
}
