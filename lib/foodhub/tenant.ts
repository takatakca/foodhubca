// The merchant (tenant) this ON2GO Hub instance serves, and the contracts with the TAKATAK control plane
// (docs/ON2GO_HUB_ECOSYSTEM.md § 4). Foundation only: nothing here changes how Food Hub behaves today.
//
//   H4-a (first): one instance per merchant → ONE tenant id for the whole instance, read from FOODHUB_TENANT_ID
//                 (default "takatak", the owner's own group). It is exposed in the detailed /api/health and goes on every
//                 usage event sent to TAKATAK.
//   H4-b (later): the same id becomes the default value of a tenant_id column on every fh_* table, scoped from the
//                 request context (never from a client parameter), RLS as the second defence. Nothing existing moves.
//
// Contracts with takatak-v1 (no shared database; takatak-v1 owns tenants, plans, Stripe and entitlements):
//   C4 entitlements — ON2GO Hub reads what its merchant's plan allows (cached). Unset control plane = everything allowed
//      (the owner's single-tenant install). A billing problem may block adding features, NEVER an order (locked rule).
//   C5 usage events — counts only (orders, calls, deliveries), no name, phone or address, idempotent by event_id.
//   Signing: HMAC-SHA256 over "<timestamp>.<event id>.<body>" with a key for ON2GO Hub only (never a key shared with another
//   product), 5-minute replay window — the pattern of takatak-v1's signed integrations.
import crypto from 'node:crypto';

export const DEFAULT_TENANT_ID = 'takatak';
export const PRODUCT_CODE = 'on2go_hub';
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** The tenant id of this instance: FOODHUB_TENANT_ID when it is a valid slug, else "takatak". */
export function tenantId(raw: string | undefined = process.env.FOODHUB_TENANT_ID): string {
  const v = String(raw ?? '').trim().toLowerCase();
  return SLUG.test(v) ? v : DEFAULT_TENANT_ID;
}

export interface ControlPlane {
  /** TAKATAK base URL (e.g. https://takatak.ca), from TAKATAK_CONTROL_PLANE_URL. */
  url: string | null;
  /** The ON2GO Hub service key for that control plane is set (TAKATAK_ON2GO_HUB_KEY); its value is never shown. */
  keySet: boolean;
  configured: boolean;
}

export function controlPlane(env: NodeJS.ProcessEnv = process.env): ControlPlane {
  const raw = String(env.TAKATAK_CONTROL_PLANE_URL ?? '').trim().replace(/\/+$/, '');
  const url = /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(raw) ? raw : null;
  const keySet = Boolean(env.TAKATAK_ON2GO_HUB_KEY);
  return { url, keySet, configured: Boolean(url && keySet) };
}

export interface TenantInfo { id: string; source: 'env' | 'default'; product: string; controlPlane: ControlPlane }

export function tenantInfo(env: NodeJS.ProcessEnv = process.env): TenantInfo {
  const id = tenantId(env.FOODHUB_TENANT_ID);
  return { id, source: env.FOODHUB_TENANT_ID && id === String(env.FOODHUB_TENANT_ID).trim().toLowerCase() ? 'env' : 'default', product: PRODUCT_CODE, controlPlane: controlPlane(env) };
}

// ---------- C4: entitlements ----------

/** What a merchant's plan can unlock (the keys of the expansion features, plus limits). */
export interface Entitlements {
  plan: string;
  features: { delivery: boolean; retail: boolean; alcohol: boolean; phone: boolean; ownFleet: boolean };
  limits: { brands: number | null; kitchens: number | null };
  /** Where this answer came from: "single_tenant" = no control plane, the owner's own install (everything allowed). */
  source: 'single_tenant' | 'control_plane' | 'cached';
}

export const SINGLE_TENANT_ENTITLEMENTS: Entitlements = {
  plan: 'owner', features: { delivery: true, retail: true, alcohol: true, phone: true, ownFleet: true }, limits: { brands: null, kitchens: null }, source: 'single_tenant',
};

/** Reads a control-plane answer defensively: anything missing is "not included", never an error that stops orders. */
export function parseEntitlements(body: unknown): Entitlements | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, any>;
  if (typeof b.plan !== 'string' || !b.plan) return null;
  const f = (b.features && typeof b.features === 'object') ? b.features : {};
  const lim = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : null);
  return {
    plan: b.plan.slice(0, 60),
    features: { delivery: f.delivery === true, retail: f.retail === true, alcohol: f.alcohol === true, phone: f.phone === true, ownFleet: f.ownFleet === true },
    limits: { brands: lim(b.limits?.brands), kitchens: lim(b.limits?.kitchens) },
    source: 'control_plane',
  };
}

// ---------- C5: usage events ----------

export type UsageEventType = 'order.created' | 'order.fulfilled' | 'call.completed' | 'delivery.completed' | 'merchant.updated';

export interface UsageEvent {
  event_id: string;
  type: UsageEventType;
  product: typeof PRODUCT_CODE;
  tenant_id: string;
  occurred_at: string;
  /** Counts only, never personal data (Loi 25: order data stays in Montréal). */
  counts: Record<string, number>;
}

const COUNT_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * A usage event for TAKATAK. `key` makes it idempotent (the same key gives the same event_id: a retry is never billed
 * twice). Only whole, non-negative counts with simple names pass.
 */
export function usageEvent(type: UsageEventType, key: string, counts: Record<string, number>, occurredAt = new Date().toISOString(), tenant = tenantId()): UsageEvent {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) if (COUNT_KEY.test(k) && Number.isInteger(v) && v >= 0) clean[k] = v;
  const event_id = `evt_${crypto.createHash('sha256').update(`${tenant}|${type}|${key}`).digest('hex').slice(0, 32)}`;
  return { event_id, type, product: PRODUCT_CODE, tenant_id: tenant, occurred_at: occurredAt, counts: clean };
}

// ---------- signing (both directions) ----------

export const SIGNATURE_WINDOW_MS = 5 * 60_000;

function mac(secret: string, ts: string, eventId: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${ts}.${eventId}.${body}`).digest('hex');
}

/** Headers for a signed call to (or from) the control plane. */
export function signContract(body: string, eventId: string, secret: string, now = Date.now()): Record<string, string> {
  const ts = String(Math.floor(now / 1000));
  return {
    'Content-Type': 'application/json', 'X-Integration-Id': PRODUCT_CODE, 'X-Event-Id': eventId, 'X-Timestamp': ts,
    'Idempotency-Key': eventId, 'X-Signature': `sha256=${mac(secret, ts, eventId, body)}`,
  };
}

/** Checks a signed request: right key, untouched body, inside the 5-minute window. */
export function verifyContract(headers: Headers, body: string, secret: string, now = Date.now()): boolean {
  const ts = headers.get('x-timestamp') || '';
  const id = headers.get('x-event-id') || '';
  const sig = (headers.get('x-signature') || '').replace(/^sha256=/, '');
  if (!secret || !/^\d{9,11}$/.test(ts) || !id || !/^[a-f0-9]{64}$/.test(sig)) return false;
  if (Math.abs(now - Number(ts) * 1000) > SIGNATURE_WINDOW_MS) return false;
  const want = Buffer.from(mac(secret, ts, id, body), 'hex');
  const got = Buffer.from(sig, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
