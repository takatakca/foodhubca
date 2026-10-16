// DoorDash sandbox-safe mode: DoorDash Marketplace SANDBOX webhooks can reach the production Food Hub without any
// effect on real operations.
//
// When is a DoorDash webhook sandbox traffic? (any one of these is enough)
//   0. it was authenticated with DOORDASH_SANDBOX_WEBHOOK_SECRET (the Sandbox subscription's own Authorization value):
//      always a test, whatever DOORDASH_ENV says;
//   1. the whole integration is a sandbox one: DOORDASH_ENV=sandbox. Then EVERY DoorDash Marketplace webhook is a test;
//   2. the payload names a DoorDash test store listed in DOORDASH_SANDBOX_STORE_IDS (location id = merchant_supplied_id,
//      or DoorDash's own store id), comma separated — never a store mapped in Food Hub's stores table (a real store);
//   3. while the mode is configured (0, 1 or 2 set up), the payload itself says so: a store provider_type ending _sandbox;
//   4. it is about a sandbox test order Food Hub already recorded: our own client_order_id prefix, or an order id in the
//      permanent sandbox id set (a cancel, a Dasher update, an adjustment… even after the env changed).
//
// The decision is taken when the webhook ARRIVES and saved on the webhook-inbox entry (InboxEntry.sandbox): a retry,
// the recovery runner or a Replay made after DOORDASH_ENV changed never sends a sandbox order to the kitchen, and the
// inbox's answer-window cutoff never hands a sandbox entry to a person.
//
// A sandbox order is kept in its own list (Settings → Platforms → DoorDash sandbox tests), NEVER in the orders table:
// so it is never sent to Clover, never printed, never rings a kitchen screen, never raises a Watchtower alert, SMS or
// call, and never counts in money or reports. Its DoorDash-facing flow (confirm, reject, ready, cancel, menu pull,
// menu push, item and store availability) uses the same DoorDash calls as a real order, aimed only at the test store.
//
// Without DOORDASH_ENV=sandbox, DOORDASH_SANDBOX_STORE_IDS and DOORDASH_SANDBOX_WEBHOOK_SECRET, Food Hub behaves as
// before: a DOORDASH_PROVIDER_TYPE ending with _sandbox alone changes nothing (the status only warns about it), and
// rule 4 can only match orders Food Hub itself recorded as tests.
// Webhook authentication is not weakened: the routes check DOORDASH_WEBHOOK_SECRET (or the separate sandbox secret)
// before anything is read.
import { checkSharedSecret, nowIso } from '../config';
import { menuLockOf } from '../menu/lock';
import { getRepo } from '../repo';
import type { ChannelStore, CourierStatus, NormalizedOrder } from '../types';

const SANDBOX_SUFFIX = /_sandbox$/i;

/** A protected DoorDash store (Po Poulet NDG, any menu lock): the rule of doordash/guard.ts, read here without an import cycle. */
const isProtectedDoorDashId = (id: string) => menuLockOf({ channel: 'doordash', channelStoreId: id, meta: {} }).locked;
/** The merchant_supplied_id Food Hub sends when it confirms a sandbox order (comes back as client_order_id). */
export const SANDBOX_CLIENT_PREFIX = 'takatak-test-';
/** The reason saved on a webhook authenticated with the sandbox subscription's own secret. */
export const SANDBOX_AUTH_REASON = 'sandbox webhook secret (DOORDASH_SANDBOX_WEBHOOK_SECRET)';

type Env = Record<string, string | undefined>;

/** DOORDASH_ENV as written: 'sandbox', 'production' or '' (unset). */
export function doorDashEnvSetting(env: Env = process.env): string {
  return String(env.DOORDASH_ENV ?? '').trim().toLowerCase();
}

/** The whole DoorDash Marketplace integration is a sandbox one (sandbox credentials): every webhook is a test. */
export function doorDashIntegrationIsSandbox(env: Env = process.env): boolean {
  return doorDashEnvSetting(env) === 'sandbox';
}

/** The provider type looks like a DoorDash sandbox one. Only a status warning: it never switches the mode on. */
export function doorDashProviderTypeLooksSandbox(env: Env = process.env): boolean {
  return SANDBOX_SUFFIX.test(String(env.DOORDASH_PROVIDER_TYPE ?? '').trim());
}

/** The sandbox subscription's own Authorization value, when it is set and differs from the production one. */
function sandboxWebhookSecret(env: Env = process.env): string | null {
  const s = String(env.DOORDASH_SANDBOX_WEBHOOK_SECRET ?? '').trim();
  if (!s) return null;
  // The same value as production could not tell a sandbox request from a real one: ignored, and the status warns.
  return s === String(env.DOORDASH_WEBHOOK_SECRET ?? '').trim() ? null : s;
}

export function doorDashSandboxSecretSet(env: Env = process.env): boolean {
  return sandboxWebhookSecret(env) !== null;
}

/**
 * Was this request authenticated with DOORDASH_SANDBOX_WEBHOOK_SECRET? The routes ask only when the production secret
 * did not match. Such a request is always a sandbox test.
 */
export function verifyDoorDashSandboxWebhook(headers: Headers): boolean {
  if (!doorDashSandboxSecretSet()) return false;
  return checkSharedSecret(headers, 'DOORDASH_SANDBOX_WEBHOOK_SECRET', ['authorization', 'x-takatak-token']);
}

/**
 * DoorDash test stores (DOORDASH_SANDBOX_STORE_IDS: location ids and/or DoorDash store ids, comma / space separated).
 * A protected store (Po Poulet NDG, any menu lock) is never a test store: it is dropped from the list. A store mapped in
 * Food Hub (a real store) is dropped too wherever the stores table is read (doorDashTestStoreIds / isDoorDashTestStore).
 */
export function doorDashSandboxStoreIds(env: Env = process.env): string[] {
  const ids = String(env.DOORDASH_SANDBOX_STORE_IDS ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(ids)].filter((id) => !isProtectedDoorDashId(id));
}

/** Sandbox-safe mode is configured: sandbox integration, a listed test store, or the sandbox webhook secret. */
export function doorDashSandboxActive(env: Env = process.env): boolean {
  return doorDashIntegrationIsSandbox(env) || doorDashSandboxStoreIds(env).length > 0 || doorDashSandboxSecretSet(env);
}

/** Listed in DOORDASH_SANDBOX_STORE_IDS (env only: isDoorDashTestStore also checks it is not a real store). */
export function isDoorDashSandboxStoreId(id: unknown, env: Env = process.env): boolean {
  const v = String(id ?? '').trim();
  return Boolean(v) && doorDashSandboxStoreIds(env).includes(v);
}

/** Every id a mapped (real) DoorDash store is known by: its location id and DoorDash's own store number. */
export async function mappedDoorDashStoreIds(stores?: ChannelStore[]): Promise<Set<string>> {
  const list = stores ?? (await getRepo().listStores('doordash'));
  const out = new Set<string>();
  for (const s of list) {
    if (s.channel !== 'doordash') continue;
    if (s.channelStoreId) out.add(String(s.channelStoreId).trim());
    const own = s.meta?.platformStoreId;
    if (own !== undefined && own !== null && String(own).trim()) out.add(String(own).trim());
  }
  return out;
}

/** The listed test stores that are not real (mapped) stores: a real store is never turned into a test store. */
export async function doorDashTestStoreIds(env: Env = process.env): Promise<string[]> {
  const ids = doorDashSandboxStoreIds(env);
  if (!ids.length) return [];
  const mapped = await mappedDoorDashStoreIds();
  return ids.filter((id) => !mapped.has(id));
}

/** A listed test store that is not a mapped real store. */
export async function isDoorDashTestStore(id: unknown, env: Env = process.env): Promise<boolean> {
  const v = String(id ?? '').trim();
  return Boolean(v) && (await doorDashTestStoreIds(env)).includes(v);
}

/**
 * May Food Hub change this DoorDash store (menu, items, open/closed) right now? With a sandbox integration, only a
 * listed test store: the sandbox credentials must never be aimed at a real store. Null = allowed. (Sync backstop used by
 * the adapter and the guard; the webhook routes use doorDashStoreAccess, which also reads the stores table.)
 */
export function doorDashSandboxStoreRefusal(channelStoreId: unknown, env: Env = process.env): string | null {
  if (!doorDashIntegrationIsSandbox(env) || isDoorDashSandboxStoreId(channelStoreId, env)) return null;
  return `Not sent: DoorDash is in sandbox mode (DOORDASH_ENV=sandbox) — only the sandbox test store(s) in DOORDASH_SANDBOX_STORE_IDS are changed, never store ${String(channelStoreId ?? '') || '(none)'}.`;
}

export type DoorDashStoreAccess = { kind: 'test' | 'real' } | { kind: 'refused'; message: string };

/**
 * How a DoorDash request about one store is answered (menu pull, item polling, cart validation):
 *   'test'    — a listed test store that is not a real one: answered from the sandbox test setup, logged in the test log;
 *   'refused' — sandbox credentials (DOORDASH_ENV=sandbox) or the sandbox secret, about any other store: 409;
 *   'real'    — the usual path, unchanged.
 */
export async function doorDashStoreAccess(id: unknown, opts: { sandboxAuth?: boolean } = {}, env: Env = process.env): Promise<DoorDashStoreAccess> {
  const v = String(id ?? '').trim();
  if (await isDoorDashTestStore(v, env)) return { kind: 'test' };
  if (opts.sandboxAuth || doorDashIntegrationIsSandbox(env)) {
    return { kind: 'refused', message: `Not answered: DoorDash sandbox request (${opts.sandboxAuth ? 'sandbox webhook secret' : 'DOORDASH_ENV=sandbox'}) — only the sandbox test store(s) in DOORDASH_SANDBOX_STORE_IDS are answered, never store ${v || '(none)'}.` };
  }
  return { kind: 'real' };
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

/**
 * Why this payload is sandbox traffic, from the environment and the payload alone (null = not sandbox by these rules).
 * `mapped`: the ids of real (mapped) stores — a payload naming one is never a test-store webhook (rule 2).
 */
export function doorDashSandboxReasonSync(body: any, env: Env = process.env, mapped: Set<string> = new Set()): string | null {
  if (doorDashIntegrationIsSandbox(env)) return 'DOORDASH_ENV=sandbox';
  const ids = doorDashSandboxStoreIds(env).filter((id) => !mapped.has(id));
  if (ids.length) {
    const named = payloadStoreIds(body);
    const hit = named.find((id) => ids.includes(id));
    if (hit && !named.some((id) => mapped.has(id))) return `test store ${hit} (DOORDASH_SANDBOX_STORE_IDS)`;
  }
  if (doorDashSandboxActive(env)) {
    const marker = sandboxProviderTypeIn(body);
    if (marker) return `payload provider_type ${marker}`;
  }
  if (payloadOrderRefs(body).clientOrderId.startsWith(SANDBOX_CLIENT_PREFIX)) return 'a sandbox test order (client_order_id)';
  return null;
}

// ------------------------------------------------------------------------- the permanent sandbox order-id set (docs)

/**
 * Every DoorDash order id (and client_order_id) ever recorded as a sandbox test, one document each: never trimmed by
 * the 50-order test-list cap or by "clear", and each write is its own document (no shared read-modify-write). A later
 * DoorDash event about one of these orders stays a test even after DOORDASH_ENV or DOORDASH_SANDBOX_STORE_IDS changed.
 */
export const SANDBOX_IDS = 'doordash_sandbox_ids';

export async function rememberSandboxOrderIds(doordashId: string, clientOrderId = ''): Promise<void> {
  const at = nowIso();
  const data = { doordashId, clientOrderId };
  const docs = [
    ...(doordashId ? [{ id: `order:${doordashId}`, key: 'sandbox', at, data }] : []),
    ...(clientOrderId ? [{ id: `client:${clientOrderId}`, key: 'sandbox', at, data }] : []),
  ];
  if (docs.length) await getRepo().putDocs(SANDBOX_IDS, docs);
}

export async function isKnownSandboxOrder(doordashId: string, clientOrderId = ''): Promise<boolean> {
  const repo = getRepo();
  if (doordashId && (await repo.getDoc(SANDBOX_IDS, `order:${doordashId}`).catch(() => null))) return true;
  if (clientOrderId && (await repo.getDoc(SANDBOX_IDS, `client:${clientOrderId}`).catch(() => null))) return true;
  return false;
}

/**
 * Why this webhook is sandbox traffic, or null. Reads the stores table only when test stores are listed (a real store
 * is never a test store), and the permanent sandbox id set for events about a test order Food Hub already recorded.
 */
export async function doorDashSandboxReason(body: any, env: Env = process.env): Promise<string | null> {
  const mapped = doorDashSandboxStoreIds(env).length ? await mappedDoorDashStoreIds().catch(() => new Set<string>()) : new Set<string>();
  const direct = doorDashSandboxReasonSync(body, env, mapped);
  if (direct) return direct;
  const { doordashId, clientOrderId } = payloadOrderRefs(body);
  if (!doordashId && !clientOrderId) return null;
  if (await isKnownSandboxOrder(doordashId, clientOrderId)) return `about sandbox test order ${doordashId || clientOrderId}`;
  if (!doorDashSandboxActive(env)) return null;
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
 * the stores table: Watchtower, the store sync and the reports never see it. Null when the id is not a test store —
 * including a listed id that is a real (mapped) store: a real store's menu is never overwritten from the test screen.
 */
export async function sandboxStoreFor(channelStoreId: string, state?: SandboxState): Promise<ChannelStore | null> {
  const id = String(channelStoreId ?? '').trim();
  if (!(await isDoorDashTestStore(id))) return null;
  const [cfg, st] = await Promise.all([readSandboxConfig(), state ? Promise.resolve(state) : readSandboxState()]);
  return {
    id: `sandbox:${id}`, channel: 'doordash', channelStoreId: id, brandName: cfg.brandName ?? '', locationCode: cfg.locationCode ?? '',
    cloverMerchantId: null, autoAccept: cfg.autoConfirm, online: !st.paused[id], pausedUntil: null,
    meta: { sandbox: true, ...(st.menuIds[id] ? { doordashMenuId: st.menuIds[id] } : {}) },
  };
}

/** What the settings page shows about the mode. `stores`: the mapped stores, to warn when a real one is listed. */
export function doorDashSandboxStatus(env: Env = process.env, stores: ChannelStore[] = []) {
  const integration = doorDashIntegrationIsSandbox(env);
  const envSetting = doorDashEnvSetting(env);
  const providerSandbox = doorDashProviderTypeLooksSandbox(env);
  const sandboxSecret = doorDashSandboxSecretSet(env);
  const listed = [...new Set(String(env.DOORDASH_SANDBOX_STORE_IDS ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  const unprotected = doorDashSandboxStoreIds(env);
  const mapped = new Set<string>();
  for (const s of stores) {
    if (s.channel !== 'doordash') continue;
    if (s.channelStoreId) mapped.add(String(s.channelStoreId).trim());
    if (s.meta?.platformStoreId !== undefined && s.meta?.platformStoreId !== null) mapped.add(String(s.meta.platformStoreId).trim());
  }
  const real = unprotected.filter((id) => mapped.has(id));
  const storeIds = unprotected.filter((id) => !mapped.has(id));
  const warnings: string[] = [];
  if (providerSandbox && !integration) warnings.push('DOORDASH_PROVIDER_TYPE ends with _sandbox but DOORDASH_ENV is not sandbox: DoorDash orders are treated as REAL orders (Clover, kitchen). Set DOORDASH_ENV=sandbox while the credentials are sandbox ones.');
  if (integration && env.DOORDASH_PROVIDER_TYPE && !providerSandbox) warnings.push('DOORDASH_ENV=sandbox but DOORDASH_PROVIDER_TYPE does not end with _sandbox: every DoorDash order is treated as a TEST — set DOORDASH_ENV=production once DoorDash gives production keys.');
  if (integration && !storeIds.length) warnings.push('No test store in DOORDASH_SANDBOX_STORE_IDS yet: menu pushes, items and open/closed changes are refused until it is set.');
  if (listed.length > unprotected.length) warnings.push('A protected store was listed in DOORDASH_SANDBOX_STORE_IDS and was ignored (it is never touched).');
  if (real.length) warnings.push(`DOORDASH_SANDBOX_STORE_IDS lists ${real.join(', ')}, a real store mapped in Food Hub: ignored (its orders stay real, its menu is never changed from the test screen). Give the sandbox location its own id.`);
  if (String(env.DOORDASH_SANDBOX_WEBHOOK_SECRET ?? '').trim() && !sandboxSecret) warnings.push('DOORDASH_SANDBOX_WEBHOOK_SECRET equals DOORDASH_WEBHOOK_SECRET: ignored. Give the Sandbox subscription its own value.');
  return { active: integration || storeIds.length > 0 || sandboxSecret, integration, env: envSetting || null, providerSandbox, sandboxSecret, storeIds, warnings };
}
